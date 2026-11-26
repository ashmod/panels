use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use chrono::NaiveDate;

use crate::AppState;
use crate::models::ComicStrip;

const INDEX_HTML: &str = "web/index.html";
// Link previews only need the strip's metadata; a slow source shouldn't hold back the page itself.
const LOOKUP_WAIT: Duration = Duration::from_secs(2);

pub struct Preview {
    pub title: String,
    pub description: String,
    pub image_alt: String,
    pub page_url: String,
    pub image_url: String,
}

pub async fn strip_page(
    State(state): State<Arc<AppState>>,
    Path((endpoint, date)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let Ok(html) = tokio::fs::read_to_string(INDEX_HTML).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let Some(origin) = origin(&headers) else {
        return Html(html).into_response();
    };
    if state.sources.find(&endpoint).is_none() {
        return Html(html).into_response();
    }
    // Stop waiting, but never cancel: a source can be mid-exchange with an external helper, and
    // a finished lookup also warms the cache for the page's own request for this strip.
    let lookup = tokio::spawn({
        let state = state.clone();
        let (endpoint, date) = (endpoint.clone(), date.clone());
        async move {
            let source = state.sources.find(&endpoint)?;
            source.fetch_strip(&endpoint, &date).await.ok().flatten()
        }
    });
    let strip = match tokio::time::timeout(LOOKUP_WAIT, lookup).await {
        Ok(Ok(Some(strip))) => strip,
        _ => return Html(html).into_response(),
    };

    let comic = state.comics.iter().find(|c| c.endpoint == endpoint);
    let comic_title = comic.map_or(strip.endpoint.as_str(), |c| c.title.as_str());
    let author = comic.and_then(|c| c.author.as_deref());
    let preview = preview(&origin, &strip, comic_title, author);
    Html(with_preview(&html, &preview)).into_response()
}

fn origin(headers: &HeaderMap) -> Option<String> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let host = header("x-forwarded-host").or_else(|| header("host"))?;
    let safe = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']');
    if host.is_empty() || !host.chars().all(safe) {
        return None;
    }
    let scheme = match header("x-forwarded-proto") {
        Some("https") => "https",
        _ => "http",
    };
    Some(format!("{scheme}://{host}"))
}

pub fn preview(
    origin: &str,
    strip: &ComicStrip,
    comic_title: &str,
    author: Option<&str>,
) -> Preview {
    let when = NaiveDate::parse_from_str(&strip.date, "%Y-%m-%d")
        .map(|d| d.format("%-d %B %Y").to_string())
        .unwrap_or_else(|_| strip.date.clone());
    let loose = |s: &str| {
        s.chars()
            .filter(char::is_ascii_alphanumeric)
            .collect::<String>()
            .to_ascii_lowercase()
    };
    let own_title = !strip.title.is_empty()
        && loose(&strip.title) != loose(comic_title)
        && loose(&strip.title) != loose(&strip.endpoint);
    let named = if own_title {
        format!(" “{}”", strip.title)
    } else {
        String::new()
    };
    let path = format!(
        "{}/{}",
        encode_segment(&strip.endpoint),
        encode_segment(&strip.date)
    );

    Preview {
        title: format!("{comic_title} · {when}{named}"),
        description: match author {
            Some(author) => format!("{comic_title} by {author}, on Panels."),
            None => format!("{comic_title}, on Panels."),
        },
        image_alt: format!("{comic_title}, {when}"),
        page_url: format!("{origin}/strip/{path}"),
        image_url: format!("{origin}/api/comics/{path}/image"),
    }
}

pub fn with_preview(html: &str, p: &Preview) -> String {
    let title = format!("{} | panels", p.title);
    [
        ("<title>", "</title>", title.as_str()),
        (
            "name=\"description\" content=\"",
            "\"",
            p.description.as_str(),
        ),
        ("rel=\"canonical\" href=\"", "\"", p.page_url.as_str()),
        ("property=\"og:title\" content=\"", "\"", p.title.as_str()),
        (
            "property=\"og:description\" content=\"",
            "\"",
            p.description.as_str(),
        ),
        ("property=\"og:url\" content=\"", "\"", p.page_url.as_str()),
        (
            "property=\"og:image\" content=\"",
            "\"",
            p.image_url.as_str(),
        ),
        (
            "property=\"og:image:alt\" content=\"",
            "\"",
            p.image_alt.as_str(),
        ),
        ("name=\"twitter:title\" content=\"", "\"", p.title.as_str()),
        (
            "name=\"twitter:description\" content=\"",
            "\"",
            p.description.as_str(),
        ),
        (
            "name=\"twitter:image\" content=\"",
            "\"",
            p.image_url.as_str(),
        ),
        (
            "name=\"twitter:image:alt\" content=\"",
            "\"",
            p.image_alt.as_str(),
        ),
    ]
    .into_iter()
    .fold(html.to_string(), |page, (open, close, value)| {
        replace_between(&page, open, close, &escape(value))
    })
}

fn replace_between(html: &str, open: &str, close: &str, value: &str) -> String {
    let Some(start) = html.find(open).map(|i| i + open.len()) else {
        return html.to_string();
    };
    let Some(len) = html[start..].find(close) else {
        return html.to_string();
    };
    format!("{}{}{}", &html[..start], value, &html[start + len..])
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn encode_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"<head>
  <title>panels by shehab</title>
  <meta name="description" content="Default description.">
  <link rel="canonical" href="https://panels.ashmod.dev/">
  <meta property="og:title" content="panels by shehab">
  <meta property="og:description" content="Default.">
  <meta property="og:url" content="https://panels.ashmod.dev/">
  <meta property="og:image" content="https://panels.ashmod.dev/banner.png">
  <meta property="og:image:alt" content="panels preview banner">
  <meta name="twitter:title" content="panels by shehab">
  <meta name="twitter:description" content="Default.">
  <meta name="twitter:image" content="https://panels.ashmod.dev/banner.png">
  <meta name="twitter:image:alt" content="panels preview banner">
</head>"#;

    fn strip(endpoint: &str, date: &str, title: &str) -> ComicStrip {
        ComicStrip {
            endpoint: endpoint.into(),
            title: title.into(),
            date: date.into(),
            image_url: String::new(),
            source_url: String::new(),
            prev_date: None,
            next_date: None,
        }
    }

    #[test]
    fn dated_strip_preview_points_at_the_strip() {
        let p = preview(
            "https://example.test",
            &strip("garfield", "2026-11-26", "Garfield"),
            "Garfield",
            Some("Jim Davis"),
        );
        assert_eq!(p.title, "Garfield · 26 November 2026");
        assert_eq!(p.description, "Garfield by Jim Davis, on Panels.");
        assert_eq!(p.page_url, "https://example.test/strip/garfield/2026-11-26");
        assert_eq!(
            p.image_url,
            "https://example.test/api/comics/garfield/2026-11-26/image"
        );
    }

    #[test]
    fn numbered_strip_keeps_its_own_title_and_encodes_the_hash() {
        let p = preview(
            "http://localhost:3000",
            &strip("xkcd", "#725", "Literally"),
            "xkcd",
            None,
        );
        assert_eq!(p.title, "xkcd · #725 “Literally”");
        assert_eq!(p.page_url, "http://localhost:3000/strip/xkcd/%23725");
        assert_eq!(
            p.image_url,
            "http://localhost:3000/api/comics/xkcd/%23725/image"
        );
    }

    #[test]
    fn every_preview_tag_is_rewritten_and_escaped() {
        let p = Preview {
            title: "Tom & \"Jerry\"".into(),
            description: "<b>desc</b>".into(),
            image_alt: "alt".into(),
            page_url: "https://example.test/read/a/b".into(),
            image_url: "https://example.test/api/comics/a/b/image".into(),
        };
        let page = with_preview(PAGE, &p);
        assert!(!page.contains("panels.ashmod.dev"));
        assert!(!page.contains("panels by shehab"));
        assert!(page.contains("<title>Tom &amp; &quot;Jerry&quot; | panels</title>"));
        assert!(page.contains(r#"property="og:title" content="Tom &amp; &quot;Jerry&quot;""#));
        assert!(page.contains(r#"name="description" content="&lt;b&gt;desc&lt;/b&gt;""#));
        assert!(page.contains(
            r#"name="twitter:image" content="https://example.test/api/comics/a/b/image""#
        ));
    }

    #[test]
    fn missing_tags_leave_the_page_untouched() {
        let p = preview("https://example.test", &strip("a", "b", "a"), "A", None);
        assert_eq!(with_preview("<html></html>", &p), "<html></html>");
    }

    #[test]
    fn unsafe_hosts_are_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "evil.test\"><script>".parse().unwrap());
        assert_eq!(origin(&headers), None);
        headers.insert("host", "panels.example:8080".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        assert_eq!(
            origin(&headers).as_deref(),
            Some("https://panels.example:8080")
        );
    }
}
