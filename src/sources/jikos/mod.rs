use async_trait::async_trait;
use chrono::{Datelike, Duration, NaiveDate, Utc};
use rand::Rng;
use regex::Regex;
use tracing::{debug, info};

use crate::cache::Caches;
use crate::error::{PanelsError, Result};
use crate::http_client::{fetch_page_with_options, random_user_agent};
use crate::models::{Comic, ComicStrip};
use crate::sources::ComicSource;

use super::arcamax;

const BASE_URL: &str = "http://pt.jikos.cz/garfield";

fn month_url(date: NaiveDate) -> String {
    if date.month() == 1 {
        format!("{BASE_URL}/{}/", date.year())
    } else {
        format!("{BASE_URL}/{}/{}/", date.year(), date.month())
    }
}

fn find_title<'a>(comics: &'a [Comic], endpoint: &'a str) -> &'a str {
    comics
        .iter()
        .find(|comic| comic.endpoint == endpoint)
        .map(|comic| comic.title.as_str())
        .unwrap_or(endpoint)
}

fn parse_month(html: &str, endpoint: &str, title: &str, source_url: &str, start_date: Option<&str>) -> Vec<ComicStrip> {
    let Some(re) = Regex::new(r#"(\d{1,2})/(\d{1,2})/(\d{4})<br/><img src="([^"]+)""#).ok() else {
        return vec![];
    };

    let min_date = start_date
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());

    let mut strips = Vec::new();
    for caps in re.captures_iter(html) {
        let day: u32 = caps[1].parse().ok().unwrap_or_default();
        let month: u32 = caps[2].parse().ok().unwrap_or_default();
        let year: i32 = caps[3].parse().ok().unwrap_or_default();
        let Some(date) = NaiveDate::from_ymd_opt(year, month, day) else {
            continue;
        };

        if min_date.is_some_and(|min| date < min) {
            continue;
        }

        let prev_date = date.checked_sub_signed(Duration::days(1)).map(|d| d.format("%Y-%m-%d").to_string());
        let next_date = date.checked_add_signed(Duration::days(1)).map(|d| d.format("%Y-%m-%d").to_string());

        strips.push(ComicStrip {
            endpoint: endpoint.to_string(),
            title: title.to_string(),
            date: date.format("%Y-%m-%d").to_string(),
            image_url: caps[4].to_string(),
            source_url: source_url.to_string(),
            prev_date,
            next_date,
        });
    }

    strips
}

pub struct JikosSource {
    client: reqwest::Client,
    comics: Vec<Comic>,
    caches: Caches,
}

impl JikosSource {
    pub fn new(client: reqwest::Client, comics: Vec<Comic>, caches: Caches) -> Self {
        Self { client, comics, caches }
    }

    fn comic(&self, endpoint: &str) -> Option<&Comic> {
        self.comics.iter().find(|comic| comic.endpoint == endpoint)
    }

    async fn fetch_from_archive(&self, endpoint: &str, date: NaiveDate) -> Result<Option<ComicStrip>> {
        let title = find_title(&self.comics, endpoint);
        let url = month_url(date);
        let page = fetch_page_with_options(&self.client, &url, 1, 12000, false, &[]).await?;
        let Some(page) = page else {
            return Ok(None);
        };

        let strips = parse_month(
            &page.html,
            endpoint,
            title,
            &page.final_url,
            self.comic(endpoint).and_then(|comic| comic.start_date.as_deref()),
        );

        for strip in &strips {
            let cache_key = format!("{}:{}", endpoint, strip.date);
            self.caches.strips.insert(cache_key, strip.clone()).await;
        }

        Ok(strips.into_iter().find(|strip| strip.date == date.format("%Y-%m-%d").to_string()))
    }
}

#[async_trait]
impl ComicSource for JikosSource {
    fn handles(&self, endpoint: &str) -> bool {
        self.comics
            .iter()
            .any(|comic| comic.endpoint == endpoint && comic.source == "jikos")
    }

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        let cache_key = format!("{}:{}", endpoint, date);
        if let Some(cached) = self.caches.strips.get(&cache_key).await {
            debug!(endpoint, date, "jikos strip cache hit");
            return Ok(Some(cached));
        }

        let date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|e| PanelsError::InvalidDate(format!("invalid date format: {e}")))?;

        self.fetch_from_archive(endpoint, date).await
    }

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let today = Utc::now().date_naive();
        for offset in 0..7 {
            let date = today - Duration::days(offset);
            if let Some(strip) = self.fetch_from_archive(endpoint, date).await? {
                return Ok(Some(strip));
            }
        }

        let title = find_title(&self.comics, endpoint);
        arcamax::fetch_latest_strip_with_slug(
            &self.client,
            &self.caches,
            endpoint,
            title,
            arcamax::source_slug(&self.comics, endpoint),
        )
        .await
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        let Some(comic) = self.comic(endpoint) else {
            return Ok(None);
        };
        let Some(start_date) = comic.start_date.as_deref() else {
            return Ok(None);
        };
        let start = NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
            .map_err(|e| PanelsError::InvalidDate(format!("invalid start date for {endpoint}: {e}")))?;
        let today = Utc::now().date_naive();
        let days = (today - start).num_days();

        info!(endpoint, "fetching random jikos strip");
        for _ in 0..8 {
            let delta = rand::thread_rng().gen_range(0..=days.max(0));
            let date = start + Duration::days(delta);
            if let Some(strip) = self.fetch_from_archive(endpoint, date).await? {
                return Ok(Some(strip));
            }
        }

        arcamax::fetch_recent_random_strip_with_slug(
            &self.client,
            &self.caches,
            endpoint,
            comic.title.as_str(),
            arcamax::source_slug(&self.comics, endpoint),
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
    fn parses_month_archive() {
        let html = r#"
        <table>
          <tr><td>14/1/2024<br/><img src="http://picayune.uclick.com/comics/ga/2024/ga240114.jpg" alt="garfield 14/1/2024"/></td></tr>
          <tr><td>15/1/2024<br/><img src="http://picayune.uclick.com/comics/ga/2024/ga240115.gif" alt="garfield 15/1/2024"/></td></tr>
        </table>
        "#;

        let strips = parse_month(html, "garfield", "Garfield", "http://pt.jikos.cz/garfield/2024/", Some("1978-06-19"));
        assert_eq!(strips.len(), 2);
        assert_eq!(strips[1].date, "2024-01-15");
        assert_eq!(strips[1].image_url, "http://picayune.uclick.com/comics/ga/2024/ga240115.gif");
        assert_eq!(strips[1].prev_date.as_deref(), Some("2024-01-14"));
        assert_eq!(strips[1].next_date.as_deref(), Some("2024-01-16"));
    }
}
