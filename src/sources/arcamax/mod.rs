use async_trait::async_trait;
use chrono::NaiveDate;
use rand::Rng;
use regex::Regex;
use scraper::{Html, Selector};
use tracing::{debug, info, warn};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::{fetch_page_with_options, random_user_agent};
use crate::models::{Comic, ComicStrip};
use crate::sources::ComicSource;

const BASE_URL: &str = "https://www.arcamax.com";
const FUNNIES_PATH: &str = "/thefunnies";
const MAX_LOOKBACK_STEPS: usize = 45;
const MAX_RANDOM_STEPS: usize = 30;

pub(crate) fn source_slug<'a>(comics: &'a [Comic], endpoint: &'a str) -> &'a str {
    comics
        .iter()
        .find(|comic| comic.endpoint == endpoint)
        .and_then(|comic| comic.source_slug.as_deref())
        .unwrap_or(endpoint)
}

fn latest_url(slug: &str) -> String {
    format!("{BASE_URL}{FUNNIES_PATH}/{slug}/")
}

fn absolute_url(href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        href.to_string()
    } else {
        format!("{BASE_URL}{href}")
    }
}

fn parse_mdy_date(text: &str) -> Option<String> {
    let re = Regex::new(r"for\s+(\d{1,2})/(\d{1,2})/(\d{4})").ok()?;
    let caps = re.captures(text)?;
    let month: u32 = caps[1].parse().ok()?;
    let day: u32 = caps[2].parse().ok()?;
    let year: i32 = caps[3].parse().ok()?;
    NaiveDate::from_ymd_opt(year, month, day).map(|date| date.format("%Y-%m-%d").to_string())
}

#[derive(Clone)]
struct ParsedPage {
    strip: ComicStrip,
    prev_url: Option<String>,
}

fn parse_page(html: &str, endpoint: &str, fallback_title: &str, current_url: &str) -> Option<ParsedPage> {
    let document = Html::parse_document(html);
    let img_sel = Selector::parse("figure.comic img.the-comic").ok()?;
    let header_sel = Selector::parse("header.fn-content-header h2 span").ok()?;
    let prev_sel = Selector::parse("a.prev").ok()?;
    let next_sel = Selector::parse("a.next").ok()?;

    let image = document.select(&img_sel).next()?;
    let image_url = image
        .value()
        .attr("data-zoom-image")
        .or_else(|| image.value().attr("src"))?
        .to_string();

    let date = image
        .value()
        .attr("alt")
        .and_then(parse_mdy_date)
        .or_else(|| image.value().attr("title").and_then(parse_mdy_date))?;

    let title = document
        .select(&header_sel)
        .next()
        .map(|node| node.text().collect::<String>().trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| fallback_title.to_string());

    let prev = document.select(&prev_sel).next();
    let next = document.select(&next_sel).next();

    let prev_url = prev
        .and_then(|node| node.value().attr("href"))
        .filter(|href| *href != "#")
        .map(absolute_url);

    let prev_date = document
        .select(&prev_sel)
        .next()
        .and_then(|node| node.value().attr("title"))
        .and_then(parse_mdy_date);

    let next_date = next
        .and_then(|node| node.value().attr("title"))
        .and_then(parse_mdy_date);

    Some(ParsedPage {
        strip: ComicStrip {
            endpoint: endpoint.to_string(),
            title,
            date,
            image_url,
            source_url: current_url.to_string(),
            prev_date,
            next_date,
        },
        prev_url,
    })
}

async fn fetch_parsed_page(
    client: &reqwest::Client,
    url: &str,
    endpoint: &str,
    fallback_title: &str,
) -> Result<Option<ParsedPage>> {
    let page = fetch_page_with_options(client, url, 1, 15000, false, &[]).await?;
    let Some(page) = page else {
        return Ok(None);
    };

    Ok(parse_page(&page.html, endpoint, fallback_title, &page.final_url))
}

pub(crate) async fn fetch_latest_strip_with_slug(
    client: &reqwest::Client,
    caches: &Caches,
    endpoint: &str,
    title: &str,
    slug: &str,
) -> Result<Option<ComicStrip>> {
    let Some(parsed) = fetch_parsed_page(client, &latest_url(slug), endpoint, title).await? else {
        return Ok(None);
    };
    let cache_key = format!("{}:{}", endpoint, parsed.strip.date);
    caches.strips.insert(cache_key, parsed.strip.clone()).await;
    Ok(Some(parsed.strip))
}

pub(crate) async fn fetch_recent_random_strip_with_slug(
    client: &reqwest::Client,
    caches: &Caches,
    endpoint: &str,
    title: &str,
    slug: &str,
) -> Result<Option<ComicStrip>> {
    let Some(mut current) = fetch_parsed_page(client, &latest_url(slug), endpoint, title).await? else {
        return Ok(None);
    };

    let steps = rand::thread_rng().gen_range(0..=MAX_RANDOM_STEPS);
    for _ in 0..steps {
        let Some(prev_url) = current.prev_url.clone() else {
            break;
        };
        let Some(next_page) = fetch_parsed_page(client, &prev_url, endpoint, title).await? else {
            break;
        };
        current = next_page;
    }

    let cache_key = format!("{}:{}", endpoint, current.strip.date);
    caches.strips.insert(cache_key, current.strip.clone()).await;
    Ok(Some(current.strip))
}

pub struct ArcaMaxSource {
    client: reqwest::Client,
    comics: Vec<Comic>,
    caches: Caches,
}

impl ArcaMaxSource {
    pub fn new(client: reqwest::Client, comics: Vec<Comic>, caches: Caches) -> Self {
        Self { client, comics, caches }
    }

    fn title_for<'a>(&'a self, endpoint: &'a str) -> &'a str {
        self.comics
            .iter()
            .find(|comic| comic.endpoint == endpoint)
            .map(|comic| comic.title.as_str())
            .unwrap_or(endpoint)
    }
}

#[async_trait]
impl ComicSource for ArcaMaxSource {
    fn handles(&self, endpoint: &str) -> bool {
        self.comics
            .iter()
            .any(|comic| comic.endpoint == endpoint && comic.source == "arcamax")
    }

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        let cache_key = format!("{}:{}", endpoint, date);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(endpoint, date, "arcamax strip cache hit");
            return Ok(Some(cached));
        }

        let title = self.title_for(endpoint);
        let slug = source_slug(&self.comics, endpoint);
        let Some(mut current) = fetch_parsed_page(&self.client, &latest_url(slug), endpoint, title).await? else {
            return Ok(None);
        };

        let current_key = format!("{}:{}", endpoint, current.strip.date);
        self.caches.strips.insert(current_key, current.strip.clone()).await;

        if current.strip.date == date {
            return Ok(Some(current.strip));
        }

        if current.strip.date.as_str() < date {
            return Ok(None);
        }

        for _ in 0..MAX_LOOKBACK_STEPS {
            let Some(prev_url) = current.prev_url.clone() else {
                break;
            };

            let Some(next_page) = fetch_parsed_page(&self.client, &prev_url, endpoint, title).await? else {
                break;
            };

            let cache_key = format!("{}:{}", endpoint, next_page.strip.date);
            self.caches.strips.insert(cache_key, next_page.strip.clone()).await;

            if next_page.strip.date == date {
                return Ok(Some(next_page.strip));
            }

            if next_page.strip.date.as_str() < date {
                return Ok(None);
            }

            current = next_page;
        }

        warn!(endpoint, date, "arcamax lookup exceeded recent lookback window");
        Ok(None)
    }

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        fetch_latest_strip_with_slug(
            &self.client,
            &self.caches,
            endpoint,
            self.title_for(endpoint),
            source_slug(&self.comics, endpoint),
        )
        .await
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        info!(endpoint, "fetching recent random arcamax strip");
        fetch_recent_random_strip_with_slug(
            &self.client,
            &self.caches,
            endpoint,
            self.title_for(endpoint),
            source_slug(&self.comics, endpoint),
        )
        .await
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
            .unwrap_or("image/gif")
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
    fn parses_arcamax_page() {
        let html = r##"
        <header class="fn-content-header"><h2><span>Peanuts</span></h2></header>
        <a class="prev" href="/thefunnies/peanuts/s-4051678" title="Peanuts for 3/31/2026"></a>
        <a class="next-off" href="#"></a>
        <figure class="comic">
          <img class="the-comic" data-zoom-image="https://resources.arcamax.com/newspics/p.gif" alt="Peanuts for 4/1/2026" />
        </figure>
        "##;

        let parsed = parse_page(html, "peanuts", "Peanuts", "https://www.arcamax.com/thefunnies/peanuts/").unwrap();
        assert_eq!(parsed.strip.date, "2026-04-01");
        assert_eq!(parsed.strip.prev_date.as_deref(), Some("2026-03-31"));
        assert_eq!(parsed.strip.image_url, "https://resources.arcamax.com/newspics/p.gif");
        assert_eq!(parsed.prev_url.as_deref(), Some("https://www.arcamax.com/thefunnies/peanuts/s-4051678"));
    }
}
