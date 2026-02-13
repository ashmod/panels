use regex::Regex;
use scraper::{Html, Selector};

use crate::models::ComicStrip;

const BASE_URL: &str = "https://www.gocomics.com";
const ASSETS: &str = "featureassets.gocomics.com";

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

fn extract_image_url(document: &Html) -> Option<String> {
    if let Ok(sel) = Selector::parse(r#"script[type="application/ld+json"]"#) {
        for script in document.select(&sel) {
            let raw = script.inner_html();
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&raw) {
                if data.get("@type").and_then(|t| t.as_str()) == Some("ImageObject") {
                    let url = data
                        .get("contentUrl")
                        .or_else(|| data.get("url"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if url.contains(ASSETS) {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }

    if let Ok(sel) = Selector::parse(r#"meta[property="og:image"]"#) {
        if let Some(el) = document.select(&sel).next() {
            if let Some(content) = el.value().attr("content") {
                if content.contains(ASSETS) {
                    return Some(content.to_string());
                }
            }
        }
    }

    if let Ok(sel) = Selector::parse("img") {
        for el in document.select(&sel) {
            if let Some(src) = el.value().attr("src") {
                if src.contains(ASSETS) {
                    return Some(src.to_string());
                }
            }
        }
    }

    None
}

pub fn parse_comic_page(html: &str, endpoint: &str, date_str: &str, title: &str) -> Option<ComicStrip> {
    let document = Html::parse_document(html);

    let image_url = extract_image_url(&document)?;

    let clean_url = image_url.split('?').next().unwrap_or(&image_url).to_string();

    Some(ComicStrip {
        endpoint: endpoint.to_string(),
        title: title.to_string(),
        date: date_str.to_string(),
        image_url: clean_url,
        source_url: format!("{}/{}", BASE_URL, endpoint),
        prev_date: None,
        next_date: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn parse_comic_page_json_ld() {
        let html = r#"
        <html><head>
        <script type="application/ld+json">
        {"@type":"ImageObject","contentUrl":"https://featureassets.gocomics.com/img.gif","name":"Garfield - January 15, 2024"}
        </script>
        </head><body></body></html>
        "#;
        let strip = parse_comic_page(html, "garfield", "2024-01-15", "Garfield").unwrap();
        assert_eq!(strip.image_url, "https://featureassets.gocomics.com/img.gif");
        assert_eq!(strip.title, "Garfield");
    }

    #[test]
    fn parse_comic_page_og_image_fallback() {
        let html = r#"
        <html><head>
        <meta property="og:image" content="https://featureassets.gocomics.com/img.gif?w=800" />
        </head><body></body></html>
        "#;
        let strip = parse_comic_page(html, "garfield", "2024-01-15", "Garfield").unwrap();
        assert_eq!(strip.image_url, "https://featureassets.gocomics.com/img.gif");
    }

    #[test]
    fn parse_comic_page_img_scan_fallback() {
        let html = r#"
        <html><body>
        <img src="https://other.com/logo.png" />
        <img src="https://featureassets.gocomics.com/strip.gif" />
        </body></html>
        "#;
        let strip = parse_comic_page(html, "garfield", "2024-01-15", "Garfield").unwrap();
        assert_eq!(strip.image_url, "https://featureassets.gocomics.com/strip.gif");
    }

    #[test]
    fn parse_comic_page_no_image_returns_none() {
        let html = "<html><body><p>No comic here</p></body></html>";
        assert!(parse_comic_page(html, "garfield", "2024-01-15", "Garfield").is_none());
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
