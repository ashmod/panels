use async_trait::async_trait;
use chrono::NaiveDate;
use rand::Rng;
use scraper::{Html, Selector};
use tracing::{debug, info};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::{fetch_page, random_user_agent};
use crate::models::ComicStrip;
use crate::sources::ComicSource;

const FIRST_COMIC: &str = "1989-04-16";
const LAST_COMIC: &str = "2023-03-12";

/// CDX API to find the best Wayback Machine snapshot for a URL.
/// fl=timestamp: only return timestamp
/// filter=statuscode:^2: only successful responses
/// limit=-1: return the last (most recent) snapshot
/// to=20230312: only consider snapshots up to the last Dilbert strip
fn cdx_url(strip_url: &str) -> String {
    format!(
        "https://web.archive.org/cdx/search/cdx?url={}&fl=timestamp&filter=statuscode:^2&limit=-1&to=20230312",
        strip_url
    )
}

fn dilbert_strip_url(date: &str) -> String {
    format!("https://dilbert.com/strip/{}", date)
}

fn wayback_url(timestamp: &str, original_url: &str) -> String {
    format!("https://web.archive.org/web/{}/{}", timestamp, original_url)
}

pub struct DilbertSource {
    client: reqwest::Client,
    caches: Caches,
}

impl DilbertSource {
    pub fn new(client: reqwest::Client, caches: Caches) -> Self {
        Self { client, caches }
    }

    async fn fetch_strip_for_date(&self, date_str: &str) -> Result<Option<ComicStrip>> {
        let cache_key = format!("dilbert:{}", date_str);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(date = date_str, "dilbert strip cache hit");
            return Ok(Some(cached));
        }

        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| PanelsError::InvalidDate(format!("invalid date: {}", date_str)))?;
        let first = NaiveDate::parse_from_str(FIRST_COMIC, "%Y-%m-%d").unwrap();
        let last = NaiveDate::parse_from_str(LAST_COMIC, "%Y-%m-%d").unwrap();

        if date < first || date > last {
            return Ok(None);
        }

        let original_url = dilbert_strip_url(date_str);

        let cdx = cdx_url(&original_url);
        let cdx_page = fetch_page(&self.client, &cdx, 1, 15000).await?;
        let Some(cdx_page) = cdx_page else {
            return Ok(None);
        };

        let timestamp = cdx_page.html.trim().to_string();
        if timestamp.is_empty() || !timestamp.chars().all(|c| c.is_ascii_digit()) {
            debug!(date = date_str, "no CDX timestamp found for dilbert strip");
            return Ok(None);
        }

        let archive_url = wayback_url(&timestamp, &original_url);
        let page = fetch_page(&self.client, &archive_url, 1, 15000).await?;
        let Some(page) = page else {
            return Ok(None);
        };

        let strip = parse_dilbert_page(&page.html, date_str);

        let Some(strip) = strip else {
            debug!(date = date_str, "no image found in dilbert archive page");
            return Ok(None);
        };

        self.caches.strips.insert(cache_key, strip.clone()).await;
        Ok(Some(strip))
    }
}

fn parse_dilbert_page(html: &str, date_str: &str) -> Option<ComicStrip> {
    let document = Html::parse_document(html);

    let mut image_url: Option<String> = None;
    if let Ok(sel) = Selector::parse(".img-comic") {
        image_url = document
            .select(&sel)
            .next()
            .and_then(|el| el.value().attr("src"))
            .map(normalize_url);
    }

    if image_url.is_none()
        && let Ok(sel) = Selector::parse("img")
    {
        for el in document.select(&sel) {
            if let Some(src) = el.value().attr("src")
                && src.contains("assets.amuniversal.com")
            {
                image_url = Some(normalize_url(src));
                break;
            }
        }
    }

    let image_url = image_url?;

    let title = Selector::parse(".comic-title-name")
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Dilbert".to_string());

    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
    let first = NaiveDate::parse_from_str(FIRST_COMIC, "%Y-%m-%d").unwrap();
    let last = NaiveDate::parse_from_str(LAST_COMIC, "%Y-%m-%d").unwrap();

    let prev_date = date
        .pred_opt()
        .filter(|d| *d >= first)
        .map(|d| d.format("%Y-%m-%d").to_string());
    let next_date = date
        .succ_opt()
        .filter(|d| *d <= last)
        .map(|d| d.format("%Y-%m-%d").to_string());

    Some(ComicStrip {
        endpoint: "dilbert".to_string(),
        title,
        date: date_str.to_string(),
        image_url,
        source_url: dilbert_strip_url(date_str),
        prev_date,
        next_date,
    })
}

fn normalize_url(src: &str) -> String {
    if src.starts_with("//") {
        format!("https:{}", src)
    } else {
        src.to_string()
    }
}

#[async_trait]
impl ComicSource for DilbertSource {
    fn handles(&self, endpoint: &str) -> bool {
        endpoint == "dilbert"
    }

    async fn fetch_strip(&self, _endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        self.fetch_strip_for_date(date).await
    }

    async fn fetch_latest(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        // Dilbert ended on 2023-03-12, so "latest" is the last strip
        self.fetch_strip_for_date(LAST_COMIC).await
    }

    async fn fetch_random(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        let first = NaiveDate::parse_from_str(FIRST_COMIC, "%Y-%m-%d").unwrap();
        let last = NaiveDate::parse_from_str(LAST_COMIC, "%Y-%m-%d").unwrap();
        let range = (last - first).num_days();
        let days_offset = rand::thread_rng().gen_range(0..=range);
        let random_date = first + chrono::Duration::days(days_offset);
        let date_str = random_date.format("%Y-%m-%d").to_string();
        info!(date = %date_str, "fetching random dilbert strip");
        self.fetch_strip_for_date(&date_str).await
    }

    async fn proxy_image(&self, image_url: &str) -> Result<(Vec<u8>, String)> {
        let response = self
            .client
            .get(image_url)
            .header("User-Agent", random_user_agent())
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
            .unwrap_or("image/gif")
            .to_string();

        let bytes = response
            .bytes()
            .await
            .map_err(|e| PanelsError::ScrapeFailed(format!("failed to read image bytes: {}", e)))?;

        Ok((bytes.to_vec(), content_type))
    }
}
