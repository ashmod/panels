use async_trait::async_trait;
use rand::Rng;
use tracing::debug;

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::random_user_agent;
use crate::models::{Comic, ComicStrip};
use crate::sources::ComicSource;

const BASE_URL: &str = "https://res.cloudinary.com/duk2zbo8e/image/upload/f_auto,q_auto/calvin-comics";
const MAX_STRIP_ID: u32 = 3152;

fn strip_label(id: u32) -> String {
    format!("Strip #{id}")
}

fn image_url(id: u32) -> String {
    format!("{BASE_URL}/{id}.jpg")
}

fn parse_strip_id(value: &str) -> Option<u32> {
    let digits: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    let id: u32 = digits.parse().ok()?;
    if (1..=MAX_STRIP_ID).contains(&id) {
        Some(id)
    } else {
        None
    }
}

fn build_strip(comics: &[Comic], endpoint: &str, id: u32) -> ComicStrip {
    let title = comics
        .iter()
        .find(|comic| comic.endpoint == endpoint)
        .map(|comic| comic.title.clone())
        .unwrap_or_else(|| endpoint.to_string());

    ComicStrip {
        endpoint: endpoint.to_string(),
        title,
        date: strip_label(id),
        image_url: image_url(id),
        source_url: image_url(id),
        prev_date: (id > 1).then(|| strip_label(id - 1)),
        next_date: (id < MAX_STRIP_ID).then(|| strip_label(id + 1)),
    }
}

pub struct CalvinCdnSource {
    client: reqwest::Client,
    comics: Vec<Comic>,
    caches: Caches,
}

impl CalvinCdnSource {
    pub fn new(client: reqwest::Client, comics: Vec<Comic>, caches: Caches) -> Self {
        Self { client, comics, caches }
    }

    async fn fetch_by_id(&self, endpoint: &str, id: u32) -> Result<Option<ComicStrip>> {
        if !(1..=MAX_STRIP_ID).contains(&id) {
            return Ok(None);
        }

        let cache_key = format!("{}:{}", endpoint, id);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(endpoint, id, "calvin cdn strip cache hit");
            return Ok(Some(cached));
        }

        let strip = build_strip(&self.comics, endpoint, id);
        self.caches.strips.insert(cache_key, strip.clone()).await;
        Ok(Some(strip))
    }
}

#[async_trait]
impl ComicSource for CalvinCdnSource {
    fn handles(&self, endpoint: &str) -> bool {
        self.comics
            .iter()
            .any(|comic| comic.endpoint == endpoint && comic.source == "calvincdn")
    }

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        let Some(id) = parse_strip_id(date) else {
            return Err(PanelsError::InvalidParam(format!(
                "invalid Calvin and Hobbes strip id: {date}"
            )));
        };

        self.fetch_by_id(endpoint, id).await
    }

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        self.fetch_by_id(endpoint, MAX_STRIP_ID).await
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let id = rand::thread_rng().gen_range(1..=MAX_STRIP_ID);
        self.fetch_by_id(endpoint, id).await
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
            .unwrap_or("image/jpeg")
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
    fn parses_numeric_and_labeled_ids() {
        assert_eq!(parse_strip_id("123"), Some(123));
        assert_eq!(parse_strip_id("Strip #123"), Some(123));
        assert_eq!(parse_strip_id("0"), None);
        assert_eq!(parse_strip_id("4000"), None);
    }

    #[test]
    fn builds_expected_strip() {
        let strip = build_strip(&[], "calvinandhobbes", 42);
        assert_eq!(strip.date, "Strip #42");
        assert_eq!(
            strip.image_url,
            "https://res.cloudinary.com/duk2zbo8e/image/upload/f_auto,q_auto/calvin-comics/42.jpg"
        );
        assert_eq!(strip.prev_date.as_deref(), Some("Strip #41"));
        assert_eq!(strip.next_date.as_deref(), Some("Strip #43"));
    }
}
