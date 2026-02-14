use std::collections::HashMap;
use std::path::Path;

use async_trait::async_trait;
use chrono::NaiveDate;
use rand::Rng;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::error::{PanelsError, Result};
use crate::http_client::random_user_agent;
use crate::models::ComicStrip;
use crate::sources::ComicSource;

pub const FIRST_COMIC: &str = "1989-04-16";
pub const LAST_COMIC: &str = "2023-03-12";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DilbertCacheEntry {
    pub image_url: String,
    pub title: String,
}

pub fn dilbert_strip_url(date: &str) -> String {
    format!("https://dilbert.com/strip/{}", date)
}

fn load_dilbert_cache(data_dir: &str) -> HashMap<String, DilbertCacheEntry> {
    let path = Path::new(data_dir).join("dilbert_cache.json");
    match std::fs::read_to_string(&path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(cache) => {
                let cache: HashMap<String, DilbertCacheEntry> = cache;
                info!(count = cache.len(), "loaded dilbert pre-built cache");
                cache
            }
            Err(e) => {
                warn!("failed to parse dilbert cache: {}", e);
                HashMap::new()
            }
        },
        Err(_) => {
            info!("no dilbert cache file found");
            HashMap::new()
        }
    }
}

fn build_strip_from_cache(date_str: &str, entry: &DilbertCacheEntry) -> ComicStrip {
    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").unwrap();
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

    ComicStrip {
        endpoint: "dilbert".to_string(),
        title: entry.title.clone(),
        date: date_str.to_string(),
        image_url: entry.image_url.clone(),
        source_url: dilbert_strip_url(date_str),
        prev_date,
        next_date,
    }
}

pub struct DilbertSource {
    client: reqwest::Client,
    prebuilt: HashMap<String, DilbertCacheEntry>,
}

impl DilbertSource {
    pub fn new(client: reqwest::Client, data_dir: &str) -> Self {
        let prebuilt = load_dilbert_cache(data_dir);
        Self { client, prebuilt }
    }

    fn fetch_strip_for_date(&self, date_str: &str) -> Result<Option<ComicStrip>> {
        match self.prebuilt.get(date_str) {
            Some(entry) => {
                debug!(date = date_str, "dilbert strip from cache");
                Ok(Some(build_strip_from_cache(date_str, entry)))
            }
            None => Ok(None),
        }
    }
}

#[async_trait]
impl ComicSource for DilbertSource {
    fn handles(&self, endpoint: &str) -> bool {
        endpoint == "dilbert"
    }

    async fn fetch_strip(&self, _endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        self.fetch_strip_for_date(date)
    }

    async fn fetch_latest(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        self.fetch_strip_for_date(LAST_COMIC)
    }

    async fn fetch_random(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        if self.prebuilt.is_empty() {
            return Ok(None);
        }

        let keys: Vec<&String> = self.prebuilt.keys().collect();
        let idx = rand::thread_rng().gen_range(0..keys.len());
        let date_str = keys[idx];
        info!(date = %date_str, "fetching random dilbert strip");
        self.fetch_strip_for_date(date_str)
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
