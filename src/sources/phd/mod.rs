use async_trait::async_trait;
use rand::Rng;
use regex::Regex;
use tracing::{debug, info, warn};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::{fetch_page, random_user_agent};
use crate::models::ComicStrip;
use crate::sources::ComicSource;

const BASE: &str = "https://phdcomics.com/comics/archive.php";

fn parse_comic_ids(html: &str) -> Vec<u32> {
    let re = Regex::new(r"comicid=(\d+)").unwrap();
    let mut ids: Vec<u32> = re
        .captures_iter(html)
        .filter_map(|c| c[1].parse().ok())
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn parse_strip(html: &str, num: u32) -> Option<ComicStrip> {
    let img_re = Regex::new(r#"og:image['"] content='([^']*comics/archive/phd[^']*)'"#).unwrap();
    let image_url = img_re.captures(html)?.get(1)?.as_str().to_string();

    // Title spans multiple lines
    let title_re = Regex::new(r"(?is)<title>\s*PHD Comics:\s*(.*?)</title>").unwrap();
    let title = title_re
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .unwrap_or_default();

    let ids = parse_comic_ids(html);

    Some(ComicStrip {
        endpoint: "phd".to_string(),
        title,
        date: format!("#{}", num),
        image_url,
        source_url: format!("{}?comicid={}", BASE, num),
        prev_date: ids
            .iter()
            .copied()
            .filter(|&id| id < num)
            .max()
            .map(|id| format!("#{}", id)),
        next_date: ids
            .iter()
            .copied()
            .filter(|&id| id > num)
            .min()
            .map(|id| format!("#{}", id)),
    })
}

pub struct PhdSource {
    client: reqwest::Client,
    caches: Caches,
}

impl PhdSource {
    pub fn new(client: reqwest::Client, caches: Caches) -> Self {
        Self { client, caches }
    }

    async fn fetch_by_number(&self, num: u32) -> Result<Option<ComicStrip>> {
        let cache_key = format!("phd:#{}", num);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(num, "phd strip cache hit");
            return Ok(Some(cached));
        }

        let url = format!("{}?comicid={}", BASE, num);
        let page = fetch_page(&self.client, &url, 2, 10_000).await?;

        let Some(page) = page else {
            return Ok(None);
        };

        let Some(strip) = parse_strip(&page.html, num) else {
            warn!(num, "failed to parse PhD comic page");
            return Ok(None);
        };

        self.caches.strips.insert(cache_key, strip.clone()).await;
        Ok(Some(strip))
    }
}

#[async_trait]
impl ComicSource for PhdSource {
    fn handles(&self, endpoint: &str) -> bool {
        endpoint == "phd"
    }

    async fn fetch_strip(&self, _endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        let num: u32 = date
            .strip_prefix('#')
            .unwrap_or(date)
            .parse()
            .map_err(|_| {
                PanelsError::InvalidParam(format!(
                    "PhD Comics uses comic numbers (e.g. #100), not dates. Got: {}",
                    date
                ))
            })?;
        self.fetch_by_number(num).await
    }

    async fn fetch_latest(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        let cache_key = "phd:latest".to_string();
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!("phd latest cache hit");
            return Ok(Some(cached));
        }

        let page = fetch_page(&self.client, BASE, 2, 10_000).await?;
        let Some(page) = page else { return Ok(None) };

        let ids = parse_comic_ids(&page.html);
        let latest_id = *ids.last().ok_or_else(|| {
            PanelsError::ScrapeFailed("failed to find latest PhD comic ID".into())
        })?;

        let strip = parse_strip(&page.html, latest_id).ok_or_else(|| {
            PanelsError::ScrapeFailed(format!("failed to parse latest PhD comic #{}", latest_id))
        })?;

        self.caches.strips.insert(cache_key, strip.clone()).await;
        self.caches
            .strips
            .insert(format!("phd:#{}", latest_id), strip.clone())
            .await;
        Ok(Some(strip))
    }

    async fn fetch_random(&self, _endpoint: &str) -> Result<Option<ComicStrip>> {
        let page = fetch_page(&self.client, BASE, 2, 10_000).await?;
        let Some(page) = page else { return Ok(None) };

        let ids = parse_comic_ids(&page.html);
        let max_id = *ids.last().ok_or_else(|| {
            PanelsError::ScrapeFailed("failed to find latest PhD comic ID".into())
        })?;

        let num = rand::thread_rng().gen_range(1..=max_id);
        info!(num, "fetching random PhD comic");
        self.fetch_by_number(num).await
    }

    async fn proxy_image(&self, image_url: &str) -> Result<(Vec<u8>, String)> {
        let response = self
            .client
            .get(image_url)
            .header("User-Agent", random_user_agent())
            .header("Referer", "https://phdcomics.com/")
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_html(comic_id: u32) -> String {
        format!(
            r#"<html>
<head>
<title>
	PHD Comics: The Science Gap</title>
<meta property='og:image' content='http://phdcomics.com/comics/archive/phd012345s.gif'/>
</head>
<body>
<img id=comic src=http://www.phdcomics.com/comics/archive/phd012345s.gif border=0>
<a href=http://phdcomics.com/comics/archive.php?comicid={}>prev</a>
<a href=http://phdcomics.com/comics/archive.php?comicid={}>next</a>
<a href=http://phdcomics.com/comics/archive.php?comicid={}>first</a>
</body></html>"#,
            comic_id - 1,
            comic_id + 1,
            1
        )
    }

    #[test]
    fn parse_strip_extracts_fields() {
        let html = sample_html(100);
        let strip = parse_strip(&html, 100).unwrap();

        assert_eq!(
            strip.image_url,
            "http://phdcomics.com/comics/archive/phd012345s.gif"
        );
        assert_eq!(strip.title, "The Science Gap");
        assert_eq!(strip.prev_date, Some("#99".to_string()));
        assert_eq!(strip.next_date, Some("#101".to_string()));
        assert_eq!(strip.date, "#100");
        assert_eq!(strip.source_url, format!("{}?comicid=100", BASE));
    }

    #[test]
    fn parse_strip_returns_none_without_comic_image() {
        let html = r#"<html><head><title>PHD Comics: Error</title></head>
<body><img src=https://example.com/logo.png></body></html>"#;
        assert!(parse_strip(html, 9999).is_none());
    }

    #[test]
    fn parse_comic_ids_finds_max() {
        let html = r#"
<a href="archive.php?comicid=1">first</a>
<a href="archive.php?comicid=2050">prev</a>
<a href="archive.php?comicid=2051">current</a>
<a href="archive.php?comicid=1999">archive</a>"#;
        let ids = parse_comic_ids(html);
        assert_eq!(*ids.last().unwrap(), 2051);
    }

    #[test]
    fn parse_strip_no_prev_for_first() {
        let html = r#"<html><head>
<title>
	PHD Comics: First</title>
<meta property='og:image' content='http://phdcomics.com/comics/archive/phd0001.gif'/>
</head>
<body><a href=http://phdcomics.com/comics/archive.php?comicid=2>next</a></body></html>"#;
        let strip = parse_strip(html, 1).unwrap();
        assert!(strip.prev_date.is_none());
        assert_eq!(strip.next_date, Some("#2".to_string()));
    }
}
