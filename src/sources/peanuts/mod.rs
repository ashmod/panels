use async_trait::async_trait;
use chrono::{Duration, NaiveDate};
use rand::Rng;
use tracing::debug;

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::random_user_agent;
use crate::models::{Comic, ComicStrip};
use crate::sources::ComicSource;

const BASE_URL: &str = "https://peanuts-search.com";
const START_DATE: &str = "1950-10-02";
const END_DATE: &str = "2000-02-13";

fn start_date() -> NaiveDate {
    NaiveDate::parse_from_str(START_DATE, "%Y-%m-%d").expect("valid Peanuts start date")
}

fn end_date() -> NaiveDate {
    NaiveDate::parse_from_str(END_DATE, "%Y-%m-%d").expect("valid Peanuts end date")
}

fn image_url(date: NaiveDate) -> String {
    format!("{BASE_URL}/I/{}", date.format("%Y%m%d"))
}

fn build_strip(comics: &[Comic], endpoint: &str, date: NaiveDate) -> ComicStrip {
    let title = comics
        .iter()
        .find(|comic| comic.endpoint == endpoint)
        .map(|comic| comic.title.clone())
        .unwrap_or_else(|| endpoint.to_string());

    ComicStrip {
        endpoint: endpoint.to_string(),
        title,
        date: date.format("%Y-%m-%d").to_string(),
        image_url: image_url(date),
        source_url: image_url(date),
        prev_date: (date > start_date()).then(|| (date - Duration::days(1)).format("%Y-%m-%d").to_string()),
        next_date: (date < end_date()).then(|| (date + Duration::days(1)).format("%Y-%m-%d").to_string()),
    }
}

pub struct PeanutsSource {
    client: reqwest::Client,
    comics: Vec<Comic>,
    caches: Caches,
}

impl PeanutsSource {
    pub fn new(client: reqwest::Client, comics: Vec<Comic>, caches: Caches) -> Self {
        Self { client, comics, caches }
    }

    async fn fetch_for_date(&self, endpoint: &str, date: NaiveDate) -> Result<Option<ComicStrip>> {
        if date < start_date() || date > end_date() {
            return Ok(None);
        }

        let cache_key = format!("{}:{}", endpoint, date.format("%Y-%m-%d"));
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(endpoint, date = %date, "peanuts strip cache hit");
            return Ok(Some(cached));
        }

        let strip = build_strip(&self.comics, endpoint, date);
        self.caches.strips.insert(cache_key, strip.clone()).await;
        Ok(Some(strip))
    }
}

#[async_trait]
impl ComicSource for PeanutsSource {
    fn handles(&self, endpoint: &str) -> bool {
        self.comics
            .iter()
            .any(|comic| comic.endpoint == endpoint && comic.source == "peanuts")
    }

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        let date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|e| PanelsError::InvalidDate(format!("invalid date format: {e}")))?;
        self.fetch_for_date(endpoint, date).await
    }

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        self.fetch_for_date(endpoint, end_date()).await
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let start = start_date();
        let end = end_date();
        let offset = rand::thread_rng().gen_range(0..=(end - start).num_days());
        self.fetch_for_date(endpoint, start + Duration::days(offset)).await
    }

    async fn proxy_image(&self, image_url: &str) -> Result<(Vec<u8>, String)> {
        let response = self
            .client
            .get(image_url)
            .header("User-Agent", random_user_agent())
            .send()
            .await
            .map_err(|e| PanelsError::ScrapeFailed(format!("failed to fetch image: {e}")))?;

        if !response.status().is_success() {
            return Err(PanelsError::NotFound("image not found".into()));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/png")
            .to_string();

        let bytes = response
            .bytes()
            .await
            .map_err(|e| PanelsError::ScrapeFailed(format!("failed to read image bytes: {e}")))?;

        Ok((bytes.to_vec(), content_type))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_expected_strip() {
        let date = NaiveDate::from_ymd_opt(1998, 3, 11).unwrap();
        let strip = build_strip(&[], "peanuts", date);
        assert_eq!(strip.date, "1998-03-11");
        assert_eq!(strip.image_url, "https://peanuts-search.com/I/19980311");
        assert_eq!(strip.prev_date.as_deref(), Some("1998-03-10"));
        assert_eq!(strip.next_date.as_deref(), Some("1998-03-12"));
    }

    #[test]
    fn respects_date_bounds() {
        let first = build_strip(&[], "peanuts", start_date());
        let last = build_strip(&[], "peanuts", end_date());
        assert_eq!(first.prev_date, None);
        assert_eq!(last.next_date, None);
    }
}
