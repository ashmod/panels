mod browser;
mod bunny;
pub mod scraper;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{Local, NaiveDate};
use rand::Rng;
use tracing::{debug, info, warn};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::{PageFetch, PageResponse, fetch_page_or_block, random_user_agent};
use crate::models::{Comic, ComicStrip};
use crate::sources::ComicSource;

use self::scraper::{StripTarget, extract_nav_date, extract_page_date_from_html, parse_comic_page};

const BASE_URL: &str = "https://www.gocomics.com";
const CHALLENGE_WINDOW: Duration = Duration::from_secs(10 * 60);
// Bunny Shield answers rate limits and outright refusals with 403 or 429. A missing strip is
// never one of these, so they always mean "stop asking for a while".
const BLOCKED_STATUSES: &[u16] = &[403, 429];
const BLOCK_COOLDOWN: Duration = Duration::from_secs(60);
const MAX_BLOCK_COOLDOWN: Duration = Duration::from_secs(15 * 60);
const RANDOM_ATTEMPTS: u32 = 2;
const FALLBACK_ARCHIVE_DAYS: i64 = 365 * 5;

#[derive(Default)]
struct Backoff {
    until: Option<Instant>,
    strikes: u32,
}

impl Backoff {
    fn remaining(&self) -> Option<Duration> {
        self.until
            .and_then(|until| until.checked_duration_since(Instant::now()))
            .filter(|left| !left.is_zero())
    }

    fn strike(&mut self) -> Duration {
        // Requests already in flight when the block starts report it too; they share one strike.
        if let Some(left) = self.remaining() {
            return left;
        }
        let cooldown = BLOCK_COOLDOWN
            .saturating_mul(2u32.saturating_pow(self.strikes))
            .min(MAX_BLOCK_COOLDOWN);
        self.strikes = self.strikes.saturating_add(1);
        self.until = Some(Instant::now() + cooldown);
        cooldown
    }

    fn clear(&mut self) {
        self.strikes = 0;
        self.until = None;
    }
}

fn rate_limited(wait: Duration) -> PanelsError {
    PanelsError::RateLimited {
        source_name: "GoComics",
        retry_after: wait.as_secs().max(1),
    }
}

fn find_title<'a>(comics: &'a [Comic], endpoint: &'a str) -> &'a str {
    comics
        .iter()
        .find(|c| c.endpoint == endpoint)
        .map(|c| c.title.as_str())
        .unwrap_or(endpoint)
}

pub struct GoComicsSource {
    client: reqwest::Client,
    comics: Vec<Comic>,
    caches: Caches,
    last_challenge: Mutex<Option<Instant>>,
    backoff: Mutex<Backoff>,
}

impl GoComicsSource {
    pub fn new(client: reqwest::Client, comics: Vec<Comic>, caches: Caches) -> Self {
        Self {
            client,
            comics,
            caches,
            last_challenge: Mutex::new(None),
            backoff: Mutex::new(Backoff::default()),
        }
    }

    fn random_date(&self, endpoint: &str) -> NaiveDate {
        let today = Local::now().date_naive();
        let start = self
            .comics
            .iter()
            .find(|c| c.endpoint == endpoint)
            .and_then(|c| c.start_date.as_deref())
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .filter(|d| *d <= today)
            .unwrap_or(today - chrono::Duration::days(FALLBACK_ARCHIVE_DAYS));
        let span = (today - start).num_days();
        start + chrono::Duration::days(rand::thread_rng().gen_range(0..=span))
    }

    fn recently_challenged(&self) -> bool {
        self.last_challenge
            .lock()
            .unwrap()
            .is_some_and(|at| at.elapsed() < CHALLENGE_WINDOW)
    }

    async fn fetch_page_handling_challenge(
        &self,
        url: &str,
        retries: u32,
        timeout_ms: u64,
        suppress_errors: bool,
        silent_statuses: &[u16],
    ) -> Result<Option<PageResponse>> {
        if let Some(wait) = self.backoff.lock().unwrap().remaining() {
            return Err(rate_limited(wait));
        }

        let fetched = if self.recently_challenged() {
            browser::fetch_page(url).await?
        } else {
            match fetch_page_or_block(
                &self.client,
                url,
                retries,
                timeout_ms,
                suppress_errors,
                silent_statuses,
                BLOCKED_STATUSES,
                bunny::is_bunny_challenge,
            )
            .await?
            {
                PageFetch::Page(page) if bunny::is_bunny_challenge(&page.html) => {
                    *self.last_challenge.lock().unwrap() = Some(Instant::now());
                    browser::fetch_page(url).await?
                }
                other => other,
            }
        };

        match fetched {
            PageFetch::Page(page) => {
                self.backoff.lock().unwrap().clear();
                Ok(Some(page))
            }
            PageFetch::Missing => Ok(None),
            PageFetch::Blocked(status) => {
                let wait = self.backoff.lock().unwrap().strike();
                warn!(
                    url,
                    status,
                    "GoComics refused the request, pausing GoComics requests for {}s",
                    wait.as_secs()
                );
                Err(rate_limited(wait))
            }
        }
    }

    async fn fetch_strip_inner(
        &self,
        endpoint: &str,
        date_str: &str,
        retries: u32,
        timeout_ms: u64,
        suppress_errors: bool,
        silent_statuses: &[u16],
    ) -> Result<Option<ComicStrip>> {
        let cache_key = format!("{}:{}", endpoint, date_str);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(endpoint, date = date_str, "strip cache hit");
            return Ok(Some(cached));
        }

        let date_path = date_str.replace('-', "/");
        let url = format!("{}/{}/{}", BASE_URL, endpoint, date_path);

        let page = self
            .fetch_page_handling_challenge(
                &url,
                retries,
                timeout_ms,
                suppress_errors,
                silent_statuses,
            )
            .await?;

        let Some(page) = page else {
            return Ok(None);
        };

        let resolved_date = extract_nav_date(&page.final_url, endpoint)
            .or_else(|| extract_page_date_from_html(&page.html, endpoint))
            .unwrap_or_else(|| date_str.to_string());

        let title = find_title(&self.comics, endpoint);
        let strip = parse_comic_page(
            &page.html,
            endpoint,
            StripTarget::Date(&resolved_date),
            title,
        );

        if let Some(ref s) = strip {
            let strip_cache_key = format!("{}:{}", endpoint, s.date);
            self.caches.strips.insert(strip_cache_key, s.clone()).await;
        }

        Ok(strip)
    }
}

#[async_trait]
impl ComicSource for GoComicsSource {
    fn handles(&self, endpoint: &str) -> bool {
        self.comics
            .iter()
            .any(|c| c.endpoint == endpoint && c.source == "gocomics")
    }

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err(PanelsError::InvalidDate(format!(
                "invalid date format: {}",
                date
            )));
        }
        self.fetch_strip_inner(endpoint, date, 1, 12000, false, &[])
            .await
    }

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let url = format!("{}/{}", BASE_URL, endpoint);
        let page = self
            .fetch_page_handling_challenge(&url, 1, 12000, false, &[])
            .await?;

        let Some(page) = page else {
            return Ok(None);
        };

        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let resolved_date = extract_nav_date(&page.final_url, endpoint)
            .or_else(|| extract_page_date_from_html(&page.html, endpoint))
            .unwrap_or(today);

        let title = find_title(&self.comics, endpoint);
        let strip = parse_comic_page(
            &page.html,
            endpoint,
            StripTarget::Latest {
                fallback: &resolved_date,
            },
            title,
        );

        if let Some(ref s) = strip {
            let cache_key = format!("{}:{}", endpoint, s.date);
            self.caches.strips.insert(cache_key, s.clone()).await;
        }

        Ok(strip)
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        // A miss here means GoComics has no strip that day (comics that skip days), so one more
        // date is worth a request. Blocks return early through `?` and are never retried.
        if let Some(wait) = self.backoff.lock().unwrap().remaining() {
            return Err(rate_limited(wait));
        }
        for _ in 0..RANDOM_ATTEMPTS {
            let date = self.random_date(endpoint).format("%Y-%m-%d").to_string();
            info!(endpoint, date = %date, "fetching random strip");
            let strip = self
                .fetch_strip_inner(endpoint, &date, 0, 12000, true, &[404])
                .await?;
            if strip.is_some() {
                return Ok(strip);
            }
        }
        Ok(None)
    }

    async fn proxy_image(&self, image_url: &str) -> Result<(Vec<u8>, String)> {
        let response = self
            .client
            .get(image_url)
            .header("User-Agent", random_user_agent())
            .header("Referer", BASE_URL)
            .send()
            .await
            .map_err(|e| PanelsError::ScrapeFailed(format!("failed to fetch image: {}", e)))?;

        if !response.status().is_success() {
            return Err(PanelsError::NotFound("image not found".into()));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_string();

        let bytes = response
            .bytes()
            .await
            .map_err(|e| PanelsError::ScrapeFailed(format!("failed to read image bytes: {}", e)))?;

        Ok((bytes.to_vec(), content_type))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source_with(start_date: Option<&str>) -> GoComicsSource {
        let comic = Comic {
            endpoint: "garfield".into(),
            title: "Garfield".into(),
            author: None,
            available: true,
            start_date: start_date.map(str::to_string),
            source: "gocomics".into(),
            keywords: vec![],
        };
        GoComicsSource::new(reqwest::Client::new(), vec![comic], Caches::new(10, 60))
    }

    #[test]
    fn backoff_doubles_per_block_and_caps() {
        let mut backoff = Backoff::default();
        assert_eq!(backoff.strike(), BLOCK_COOLDOWN);
        backoff.until = None;
        assert_eq!(backoff.strike(), BLOCK_COOLDOWN * 2);
        backoff.strikes = 30;
        backoff.until = None;
        assert_eq!(backoff.strike(), MAX_BLOCK_COOLDOWN);
    }

    #[test]
    fn concurrent_blocks_share_one_strike() {
        let mut backoff = Backoff::default();
        backoff.strike();
        let again = backoff.strike();
        assert_eq!(backoff.strikes, 1);
        assert!(again <= BLOCK_COOLDOWN);
    }

    #[test]
    fn success_clears_backoff() {
        let mut backoff = Backoff::default();
        backoff.strike();
        backoff.clear();
        assert!(backoff.remaining().is_none());
        assert_eq!(backoff.strike(), BLOCK_COOLDOWN);
    }

    #[test]
    fn random_date_stays_within_publication_range() {
        let source = source_with(Some("2024-01-01"));
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let today = Local::now().date_naive();
        for _ in 0..200 {
            let date = source.random_date("garfield");
            assert!(date >= start && date <= today, "{date} out of range");
        }
    }

    #[test]
    fn random_date_without_start_date_uses_recent_archive() {
        let source = source_with(None);
        let earliest = Local::now().date_naive() - chrono::Duration::days(FALLBACK_ARCHIVE_DAYS);
        for _ in 0..200 {
            assert!(source.random_date("garfield") >= earliest);
        }
    }

    #[tokio::test]
    async fn blocked_source_answers_without_fetching() {
        let source = source_with(None);
        source.backoff.lock().unwrap().strike();
        let result = source
            .fetch_page_handling_challenge("http://127.0.0.1:9/never", 0, 100, true, &[])
            .await;
        assert!(matches!(result, Err(PanelsError::RateLimited { .. })));
    }
}
