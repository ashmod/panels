use async_trait::async_trait;
use rand::Rng;
use serde::Deserialize;
use tracing::{debug, info};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::random_user_agent;
use crate::models::ComicStrip;
use crate::sources::ComicSource;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct XkcdComic {
    num: u32,
    title: String,
    img: String,
}

impl XkcdComic {
    fn to_strip(&self) -> ComicStrip {
        ComicStrip {
            endpoint: "xkcd".to_string(),
            title: self.title.clone(),
            date: format!("#{}", self.num),
            image_url: self.img.clone(),
            source_url: format!("https://xkcd.com/{}/", self.num),
            prev_date: if self.num > 1 {
                Some(format!("#{}", self.num - 1))
            } else {
                None
            },
            next_date: Some(format!("#{}", self.num + 1)),
        }
    }
}

pub struct XkcdSource {
    client: reqwest::Client,
    caches: Caches,
}

impl XkcdSource {
    pub fn new(client: reqwest::Client, caches: Caches) -> Self {
        Self { client, caches }
    }

    async fn fetch_comic_json(&self, url: &str) -> Result<Option<XkcdComic>> {
        let response = self
            .client
            .get(url)
            .header("User-Agent", random_user_agent())
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                let comic: XkcdComic = resp.json().await.map_err(|e| {
                    PanelsError::ScrapeFailed(format!("failed to parse xkcd JSON: {}", e))
                })?;
                Ok(Some(comic))
            }
            Ok(resp) if resp.status().as_u16() == 404 => Ok(None),
            Ok(resp) => Err(PanelsError::ScrapeFailed(format!(
                "xkcd API returned {}",
                resp.status()
            ))),
            Err(e) => Err(PanelsError::ScrapeFailed(format!(
                "failed to fetch xkcd: {}",
                e
            ))),
        }
    }

    async fn fetch_by_number(&self, num: u32) -> Result<Option<ComicStrip>> {
        let cache_key = format!("xkcd:#{}", num);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(num, "xkcd strip cache hit");
            return Ok(Some(cached));
        }

        let url = format!("https://xkcd.com/{}/info.0.json", num);
        let comic = self.fetch_comic_json(&url).await?;

        if let Some(comic) = comic {
            let strip = comic.to_strip();
            self.caches.strips.insert(cache_key, strip.clone()).await;
            Ok(Some(strip))
        } else {
            Ok(None)
        }
    }
}

#[async_trait]
impl ComicSource for XkcdSource {
    fn handles(&self, endpoint: &str) -> bool {
        endpoint == "xkcd"
    }

    async fn fetch_strip(&self, _endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        let num_str = date.strip_prefix('#').unwrap_or(date);
        let num: u32 = num_str.parse().map_err(|_| {
            PanelsError::InvalidParam(format!(
                "xkcd uses comic numbers (e.g. #123), not dates. Got: {}",
                date
            ))
        })?;
        self.fetch_by_number(num).await
    }

    async fn fetch_latest(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        let cache_key = "xkcd:latest".to_string();
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!("xkcd latest cache hit");
            return Ok(Some(cached));
        }

        let url = "https://xkcd.com/info.0.json";
        let comic = self.fetch_comic_json(url).await?;

        if let Some(comic) = comic {
            let strip = comic.to_strip();
            self.caches.strips.insert(cache_key, strip.clone()).await;
            let num_key = format!("xkcd:#{}", comic.num);
            self.caches.strips.insert(num_key, strip.clone()).await;
            Ok(Some(strip))
        } else {
            Ok(None)
        }
    }

    async fn fetch_random(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        let latest_url = "https://xkcd.com/info.0.json";
        let latest = self.fetch_comic_json(latest_url).await?;

        let Some(latest) = latest else {
            return Ok(None);
        };

        let max_num = latest.num;
        // comic #404 doesn't exist, touche.
        let mut num = 404;
        while num == 404 {
            num = rand::thread_rng().gen_range(1..=max_num);
        }

        info!(num, "fetching random xkcd");
        self.fetch_by_number(num).await
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
            .unwrap_or("image/png")
            .to_string();

        let bytes = response
            .bytes()
            .await
            .map_err(|e| PanelsError::ScrapeFailed(format!("failed to read image bytes: {}", e)))?;

        Ok((bytes.to_vec(), content_type))
    }
}
