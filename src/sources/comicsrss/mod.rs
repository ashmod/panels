use async_trait::async_trait;
use rand::Rng;
use regex::Regex;
use tracing::{debug, info, warn};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::{fetch_page, random_user_agent};
use crate::models::{Comic, ComicStrip};
use crate::sources::ComicSource;

fn feed_url(slug: &str) -> String {
    format!("https://www.comicsrss.com/rss/{}.rss", slug)
}

fn parse_rss_items(xml: &str, endpoint: &str) -> Vec<ComicStrip> {
    let mut items = Vec::new();

    let item_re = Regex::new(r"(?s)<item>(.*?)</item>").unwrap();
    let title_re = Regex::new(r"(?s)<title><!\[CDATA\[(.*?)\]\]></title>").unwrap();
    let title_plain_re = Regex::new(r"(?s)<title>(.*?)</title>").unwrap();
    let link_re = Regex::new(r"<link>(.*?)</link>").unwrap();
    let guid_re = Regex::new(r"<guid[^>]*>(.*?)</guid>").unwrap();
    let img_re = Regex::new(r#"<img[^>]+src="([^"]+)""#).unwrap();
    let pub_date_re = Regex::new(r"<pubDate>(.*?)</pubDate>").unwrap();

    for item_match in item_re.captures_iter(xml) {
        let item_xml = &item_match[1];

        let image_url = img_re
            .captures(item_xml)
            .map(|c| c[1].to_string());

        let Some(image_url) = image_url else {
            continue;
        };

        let title = title_re
            .captures(item_xml)
            .map(|c| c[1].to_string())
            .or_else(|| title_plain_re.captures(item_xml).map(|c| c[1].to_string()))
            .unwrap_or_default();

        let clean_title = title
            .split(" by ")
            .next()
            .unwrap_or(&title)
            .trim()
            .to_string();

        let source_url = link_re
            .captures(item_xml)
            .map(|c| c[1].to_string())
            .unwrap_or_default();

        let date = extract_date_from_rss(item_xml, endpoint, &pub_date_re, &guid_re);

        let Some(date) = date else {
            continue;
        };

        items.push(ComicStrip {
            endpoint: endpoint.to_string(),
            title: clean_title,
            date,
            image_url,
            source_url,
            prev_date: None,
            next_date: None,
        });
    }

    items.sort_by(|a, b| a.date.cmp(&b.date));
    for i in 0..items.len() {
        if i > 0 {
            items[i].prev_date = Some(items[i - 1].date.clone());
        }
        if i + 1 < items.len() {
            items[i].next_date = Some(items[i + 1].date.clone());
        }
    }

    items
}

fn extract_date_from_rss(
    item_xml: &str,
    _endpoint: &str,
    pub_date_re: &Regex,
    guid_re: &Regex,
) -> Option<String> {
    if let Some(caps) = guid_re.captures(item_xml) {
        let guid = &caps[1];
        let date_re = Regex::new(r"(\d{4}-\d{2}-\d{2})$").ok()?;
        if let Some(date_caps) = date_re.captures(guid) {
            return Some(date_caps[1].to_string());
        }
    }

    if let Some(caps) = pub_date_re.captures(item_xml) {
        let pub_date = &caps[1];
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc2822(pub_date) {
            return Some(parsed.format("%Y-%m-%d").to_string());
        }
        let months = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ];
        let date_parts_re = Regex::new(r"(\d{1,2})\s+(\w{3})\s+(\d{4})").ok()?;
        if let Some(date_caps) = date_parts_re.captures(pub_date) {
            let day: u32 = date_caps[1].parse().ok()?;
            let month_str = &date_caps[2];
            let year: i32 = date_caps[3].parse().ok()?;
            let month = months.iter().position(|&m| m == month_str)? as u32 + 1;
            return Some(format!("{:04}-{:02}-{:02}", year, month, day));
        }
    }

    None
}

pub struct ComicsRssSource {
    client: reqwest::Client,
    comics: Vec<Comic>,
    caches: Caches,
}

impl ComicsRssSource {
    pub fn new(client: reqwest::Client, comics: Vec<Comic>, caches: Caches) -> Self {
        Self {
            client,
            comics,
            caches,
        }
    }

    async fn fetch_feed(&self, endpoint: &str) -> Result<Vec<ComicStrip>> {
        let url = feed_url(endpoint);
        let page = fetch_page(&self.client, &url, 1, 15000).await?;

        let Some(page) = page else {
            return Ok(vec![]);
        };

        let items = parse_rss_items(&page.html, endpoint);

        for item in &items {
            let cache_key = format!("{}:{}", endpoint, item.date);
            self.caches.strips.insert(cache_key, item.clone()).await;
        }

        if items.is_empty() {
            warn!(endpoint, "no items found in RSS feed");
        } else {
            debug!(endpoint, count = items.len(), "parsed RSS feed items");
        }

        Ok(items)
    }
}

#[async_trait]
impl ComicSource for ComicsRssSource {
    fn handles(&self, endpoint: &str) -> bool {
        self.comics
            .iter()
            .any(|c| c.endpoint == endpoint && c.source == "comicsrss")
    }

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        let cache_key = format!("{}:{}", endpoint, date);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(endpoint, date, "comicsrss strip cache hit");
            return Ok(Some(cached));
        }

        let items = self.fetch_feed(endpoint).await?;
        Ok(items.into_iter().find(|s| s.date == date))
    }

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let items = self.fetch_feed(endpoint).await?;
        Ok(items.into_iter().last())
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let items = self.fetch_feed(endpoint).await?;
        if items.is_empty() {
            return Ok(None);
        }
        let idx = rand::thread_rng().gen_range(0..items.len());
        info!(endpoint, date = %items[idx].date, "fetching random comicsrss strip");
        Ok(Some(items[idx].clone()))
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

        let bytes = response.bytes().await.map_err(|e| {
            PanelsError::ScrapeFailed(format!("failed to read image bytes: {}", e))
        })?;

        Ok((bytes.to_vec(), content_type))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rss_feed_basic() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Blondie</title>
<item>
<title><![CDATA[Blondie by Dean Young for Thu, 13 Feb 2026]]></title>
<link>https://www.arcamax.com/thefunnies/blondie/s-3146123</link>
<guid isPermaLink="false">blondie2026-02-13</guid>
<pubDate>Thu, 13 Feb 2026 00:00:00 GMT</pubDate>
<description><![CDATA[<img src="https://resources.arcamax.com/newspics/blondie.gif" alt="Blondie" /><a href="https://www.arcamax.com/thefunnies/blondie">Source</a>]]></description>
</item>
<item>
<title><![CDATA[Blondie by Dean Young for Wed, 12 Feb 2026]]></title>
<link>https://www.arcamax.com/thefunnies/blondie/s-3145999</link>
<guid isPermaLink="false">blondie2026-02-12</guid>
<pubDate>Wed, 12 Feb 2026 00:00:00 GMT</pubDate>
<description><![CDATA[<img src="https://resources.arcamax.com/newspics/blondie2.gif" alt="Blondie" /><a href="https://www.arcamax.com/thefunnies/blondie">Source</a>]]></description>
</item>
</channel>
</rss>"#;

        let items = parse_rss_items(xml, "blondie");
        assert_eq!(items.len(), 2);

        assert_eq!(items[0].date, "2026-02-12");
        assert_eq!(items[1].date, "2026-02-13");

        assert_eq!(items[0].prev_date, None);
        assert_eq!(items[0].next_date, Some("2026-02-13".to_string()));
        assert_eq!(items[1].prev_date, Some("2026-02-12".to_string()));
        assert_eq!(items[1].next_date, None);

        assert!(items[0].image_url.contains("arcamax.com"));
        assert_eq!(items[0].title, "Blondie");
    }
}
