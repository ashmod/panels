pub mod scraper;

use async_trait::async_trait;
use chrono::{Local, NaiveDate};
use rand::Rng;
use tracing::{debug, info};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::{fetch_page, fetch_page_with_options, random_user_agent};
use crate::models::{Comic, ComicStrip};
use crate::sources::ComicSource;

use self::scraper::{extract_nav_date, extract_page_date_from_html, parse_comic_page};

const BASE_URL: &str = "https://www.gocomics.com";

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
}

impl GoComicsSource {
    pub fn new(client: reqwest::Client, comics: Vec<Comic>, caches: Caches) -> Self {
        Self {
            client,
            comics,
            caches,
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

        let page = fetch_page_with_options(
            &self.client,
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
        let strip = parse_comic_page(&page.html, endpoint, &resolved_date, title);

        if let Some(ref s) = strip {
            let strip_cache_key = format!("{}:{}", endpoint, s.date);
            self.caches
                .strips
                .insert(strip_cache_key, s.clone())
                .await;
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
        let page = fetch_page(&self.client, &url, 1, 12000).await?;

        let Some(page) = page else {
            return Ok(None);
        };

        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let resolved_date = extract_nav_date(&page.final_url, endpoint)
            .or_else(|| extract_page_date_from_html(&page.html, endpoint))
            .unwrap_or(today);

        let title = find_title(&self.comics, endpoint);
        let strip = parse_comic_page(&page.html, endpoint, &resolved_date, title);

        if let Some(ref s) = strip {
            let cache_key = format!("{}:{}", endpoint, s.date);
            self.caches.strips.insert(cache_key, s.clone()).await;
        }

        Ok(strip)
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let days_back = rand::thread_rng().gen_range(0..365 * 5);
        let random_date = Local::now().date_naive() - chrono::Duration::days(days_back);
        let date_str = random_date.format("%Y-%m-%d").to_string();
        info!(endpoint, date = %date_str, "fetching random strip");
        self.fetch_strip_inner(endpoint, &date_str, 1, 12000, false, &[])
            .await
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
