use chrono::NaiveDate;
use regex::Regex;
use scraper::{Html, Selector};
use serde_json::Value;

use crate::models::ComicStrip;

const BASE_URL: &str = "https://www.gocomics.com";
const ASSETS: &str = "featureassets.gocomics.com";

#[derive(Clone, Copy)]
pub enum StripTarget<'a> {
    Date(&'a str),
    Latest { fallback: &'a str },
}

pub fn extract_nav_date(href: &str, endpoint: &str) -> Option<String> {
    let pattern = format!(
        r"/{}/(\d{{4}})/(\d{{2}})/(\d{{2}})",
        regex::escape(endpoint)
    );
    let re = Regex::new(&pattern).ok()?;
    let caps = re.captures(href)?;
    Some(format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]))
}

pub fn extract_page_date_from_html(html: &str, endpoint: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let sel = Selector::parse(r#"link[rel="canonical"]"#).ok()?;
    let el = document.select(&sel).next()?;
    let href = el.value().attr("href")?;
    extract_nav_date(href, endpoint)
}

fn parse_strip_date(text: &str) -> Option<String> {
    if let Ok(date) = NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d") {
        return Some(date.format("%Y-%m-%d").to_string());
    }

    let re = Regex::new(r"([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})").ok()?;
    let caps = re.captures(text)?;
    let normalized = format!("{} {}, {}", &caps[1], &caps[2], &caps[3]);
    NaiveDate::parse_from_str(&normalized, "%B %d, %Y")
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}

struct LdImage {
    url: String,
    date: Option<String>,
}

fn ld_strip_images(document: &Html) -> Vec<LdImage> {
    let Ok(sel) = Selector::parse(r#"script[type="application/ld+json"]"#) else {
        return Vec::new();
    };

    let mut images = Vec::new();
    for script in document.select(&sel) {
        let Ok(data) = serde_json::from_str::<Value>(&script.inner_html()) else {
            continue;
        };
        if data.get("@type").and_then(Value::as_str) != Some("ImageObject") {
            continue;
        }

        let url = data
            .get("contentUrl")
            .or_else(|| data.get("url"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !url.contains(ASSETS) {
            continue;
        }

        let date = data
            .get("datePublished")
            .and_then(Value::as_str)
            .and_then(parse_strip_date)
            .or_else(|| {
                data.get("name")
                    .and_then(Value::as_str)
                    .and_then(parse_strip_date)
            });

        images.push(LdImage {
            url: url.to_string(),
            date,
        });
    }

    images
}
fn meta_strip_image(document: &Html) -> Option<String> {
    for selector in [
        r#"meta[property="og:image"]"#,
        r#"meta[name="twitter:image"]"#,
    ] {
        if let Ok(sel) = Selector::parse(selector)
            && let Some(el) = document.select(&sel).next()
            && let Some(content) = el.value().attr("content")
            && content.contains(ASSETS)
        {
            return Some(content.to_string());
        }
    }

    None
}

fn resolve_strip_image(document: &Html, target: StripTarget) -> Option<(String, String)> {
    let ld_images = ld_strip_images(document);

    match target {
        StripTarget::Date(date) => {
            if let Some(image) = ld_images.iter().find(|i| i.date.as_deref() == Some(date)) {
                return Some((image.url.clone(), date.to_string()));
            }
            meta_strip_image(document).map(|url| (url, date.to_string()))
        }
        StripTarget::Latest { fallback } => {
            let newest = ld_images
                .iter()
                .filter(|i| i.date.is_some())
                .max_by(|a, b| a.date.cmp(&b.date));

            if let Some(image) = newest {
                let date = image.date.clone().unwrap_or_else(|| fallback.to_string());
                return Some((image.url.clone(), date));
            }

            meta_strip_image(document).map(|url| (url, fallback.to_string()))
        }
    }
}

pub fn extract_date_links(html: &str, endpoint: &str) -> Vec<String> {
    let mut dates = Vec::new();

    let url_pattern = format!(
        r"/{}/(\d{{4}})/(\d{{2}})/(\d{{2}})",
        regex::escape(endpoint)
    );
    if let Ok(re) = Regex::new(&url_pattern) {
        for caps in re.captures_iter(html) {
            let date = format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]);
            if !dates.contains(&date) {
                dates.push(date);
            }
        }
    }

    if let Ok(re) = Regex::new(r"(20[0-3]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])") {
        for caps in re.captures_iter(html) {
            let date = format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]);
            if !dates.contains(&date) {
                dates.push(date);
            }
        }
    }

    dates
}

pub fn parse_comic_page(
    html: &str,
    endpoint: &str,
    target: StripTarget,
    title: &str,
) -> Option<ComicStrip> {
    let document = Html::parse_document(html);

    let (image_url, date) = resolve_strip_image(&document, target)?;

    let clean_url = image_url
        .split('?')
        .next()
        .unwrap_or(&image_url)
        .to_string();

    Some(ComicStrip {
        endpoint: endpoint.to_string(),
        title: title.to_string(),
        date,
        image_url: clean_url,
        source_url: format!("{}/{}", BASE_URL, endpoint),
        prev_date: None,
        next_date: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn free_window_page() -> String {
        r#"
        <html><head>
        <link rel="canonical" href="https://www.gocomics.com/garfield/2026/08/04" />
        <meta property="og:image" content="https://featureassets.gocomics.com/assets/today" />
        <script type="application/ld+json">
        {"@type":"ImageObject","name":"Garfield - August 4, 2026","contentUrl":"https://featureassets.gocomics.com/assets/today"}
        </script>
        <script type="application/ld+json">
        {"@type":"ImageObject","name":"Garfield - June 19, 1978","datePublished":"June 19, 1978","contentUrl":"https://featureassets.gocomics.com/assets/classic1"}
        </script>
        <script type="application/ld+json">
        {"@type":"ImageObject","name":"Garfield - October 22, 2023","datePublished":"October 22, 2023","contentUrl":"https://featureassets.gocomics.com/assets/classic2"}
        </script>
        </head><body></body></html>
        "#
        .to_string()
    }

    fn archive_page() -> String {
        r#"
        <html><head>
        <link rel="canonical" href="https://www.gocomics.com/garfield/2015/03/12" />
        <meta property="og:image" content="https://featureassets.gocomics.com/assets/archived" />
        <meta name="twitter:image" content="https://featureassets.gocomics.com/assets/archived" />
        <script type="application/ld+json">
        {"@type":"ComicStory","name":"Garfield - March 12, 2015","datePublished":"2015-03-12"}
        </script>
        <script type="application/ld+json">
        {"@type":"ImageObject","name":"Garfield - June 19, 1978","datePublished":"June 19, 1978","contentUrl":"https://featureassets.gocomics.com/assets/classic1"}
        </script>
        <script type="application/ld+json">
        {"@type":"ImageObject","name":"Garfield - October 22, 2023","datePublished":"October 22, 2023","contentUrl":"https://featureassets.gocomics.com/assets/classic2"}
        </script>
        </head><body></body></html>
        "#
        .to_string()
    }

    #[test]
    fn extract_nav_date_basic() {
        assert_eq!(
            extract_nav_date("/garfield/2024/01/15", "garfield"),
            Some("2024-01-15".to_string())
        );
    }

    #[test]
    fn extract_nav_date_full_url() {
        assert_eq!(
            extract_nav_date("https://www.gocomics.com/garfield/2024/01/15", "garfield"),
            Some("2024-01-15".to_string())
        );
    }

    #[test]
    fn extract_nav_date_no_match() {
        assert_eq!(extract_nav_date("/other/2024/01/15", "garfield"), None);
        assert_eq!(extract_nav_date("", "garfield"), None);
    }

    #[test]
    fn extract_nav_date_hyphenated_endpoint() {
        assert_eq!(
            extract_nav_date("/calvin-and-hobbes/2024/01/15", "calvin-and-hobbes"),
            Some("2024-01-15".to_string())
        );
    }

    #[test]
    fn parse_strip_date_human_readable() {
        assert_eq!(
            parse_strip_date("March 12, 2015"),
            Some("2015-03-12".to_string())
        );
        assert_eq!(
            parse_strip_date("Garfield - June 19, 1978"),
            Some("1978-06-19".to_string())
        );
    }

    #[test]
    fn parse_strip_date_iso_passthrough() {
        assert_eq!(
            parse_strip_date("2015-03-12"),
            Some("2015-03-12".to_string())
        );
    }

    #[test]
    fn parse_strip_date_rejects_junk() {
        assert_eq!(parse_strip_date("Garfield"), None);
        assert_eq!(parse_strip_date(""), None);
    }

    #[test]
    fn dated_page_prefers_matching_json_ld() {
        let strip = parse_comic_page(
            &free_window_page(),
            "garfield",
            StripTarget::Date("2026-08-04"),
            "Garfield",
        )
        .unwrap();
        assert_eq!(
            strip.image_url,
            "https://featureassets.gocomics.com/assets/today"
        );
        assert_eq!(strip.date, "2026-08-04");
    }

    #[test]
    fn archive_page_uses_meta_tag_not_carousel() {
        let strip = parse_comic_page(
            &archive_page(),
            "garfield",
            StripTarget::Date("2015-03-12"),
            "Garfield",
        )
        .unwrap();
        assert_eq!(
            strip.image_url,
            "https://featureassets.gocomics.com/assets/archived"
        );
        assert_eq!(strip.date, "2015-03-12");
    }

    #[test]
    fn archive_page_falls_back_to_twitter_image() {
        let html = archive_page().replace(r#"property="og:image""#, r#"property="og:unused""#);
        let strip = parse_comic_page(
            &html,
            "garfield",
            StripTarget::Date("2015-03-12"),
            "Garfield",
        )
        .unwrap();
        assert_eq!(
            strip.image_url,
            "https://featureassets.gocomics.com/assets/archived"
        );
    }

    #[test]
    fn latest_picks_newest_entry_over_carousel() {
        let strip = parse_comic_page(
            &free_window_page(),
            "garfield",
            StripTarget::Latest {
                fallback: "2026-08-06",
            },
            "Garfield",
        )
        .unwrap();
        assert_eq!(
            strip.image_url,
            "https://featureassets.gocomics.com/assets/today"
        );
        assert_eq!(strip.date, "2026-08-04");
    }

    #[test]
    fn landing_page_social_card_is_not_a_strip() {
        let html = r#"
        <html><head>
        <link rel="canonical" href="https://www.gocomics.com/garfield" />
        <meta property="og:image" content="https://gocomicscmsassets.gocomics.com/assets/GC_Social_FB_Garfield.jpg" />
        </head><body></body></html>
        "#;
        assert!(
            parse_comic_page(
                html,
                "garfield",
                StripTarget::Latest {
                    fallback: "2026-08-06"
                },
                "Garfield",
            )
            .is_none()
        );
    }

    #[test]
    fn query_string_is_stripped_from_image_url() {
        let html = r#"
        <html><head>
        <meta property="og:image" content="https://featureassets.gocomics.com/assets/img?optimizer=image&width=2800" />
        </head><body></body></html>
        "#;
        let strip = parse_comic_page(
            html,
            "garfield",
            StripTarget::Date("2015-03-12"),
            "Garfield",
        )
        .unwrap();
        assert_eq!(
            strip.image_url,
            "https://featureassets.gocomics.com/assets/img"
        );
    }

    #[test]
    fn parse_comic_page_no_image_returns_none() {
        let html = "<html><body><p>No comic here</p></body></html>";
        assert!(
            parse_comic_page(
                html,
                "garfield",
                StripTarget::Date("2024-01-15"),
                "Garfield"
            )
            .is_none()
        );
    }

    #[test]
    fn extract_page_date_from_canonical() {
        let html = r#"
        <html><head>
        <link rel="canonical" href="https://www.gocomics.com/garfield/2024/01/15" />
        </head><body></body></html>
        "#;
        assert_eq!(
            extract_page_date_from_html(html, "garfield"),
            Some("2024-01-15".to_string())
        );
    }

    #[test]
    fn extract_page_date_no_canonical_returns_none() {
        let html = "<html><head></head><body></body></html>";
        assert_eq!(extract_page_date_from_html(html, "garfield"), None);
    }
}
