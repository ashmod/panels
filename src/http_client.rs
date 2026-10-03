use std::time::Duration;

use rand::Rng;
use reqwest::Client;
use tracing::{debug, warn};

const USER_AGENTS: &[&str] = &[
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

pub const ARCHIVE_USER_AGENT: &str = concat!(
    "panels/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/ashmod/panels)"
);

pub fn random_user_agent() -> &'static str {
    let idx = rand::thread_rng().gen_range(0..USER_AGENTS.len());
    USER_AGENTS[idx]
}

pub fn user_agent_for(url: &str) -> &'static str {
    if url.contains("web.archive.org") {
        ARCHIVE_USER_AGENT
    } else {
        random_user_agent()
    }
}

pub fn build_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .expect("failed to build HTTP client")
}

pub struct PageResponse {
    pub html: String,
    pub final_url: String,
}

pub async fn fetch_page(
    client: &Client,
    url: &str,
    retries: u32,
    timeout_ms: u64,
) -> crate::error::Result<Option<PageResponse>> {
    fetch_page_inner(client, url, retries, timeout_ms, false, &[], None).await
}

pub async fn fetch_page_with_options(
    client: &Client,
    url: &str,
    retries: u32,
    timeout_ms: u64,
    suppress_errors: bool,
    silent_statuses: &[u16],
) -> crate::error::Result<Option<PageResponse>> {
    fetch_page_inner(
        client,
        url,
        retries,
        timeout_ms,
        suppress_errors,
        silent_statuses,
        None,
    )
    .await
}

pub async fn fetch_page_accepting_error_body(
    client: &Client,
    url: &str,
    retries: u32,
    timeout_ms: u64,
    suppress_errors: bool,
    silent_statuses: &[u16],
    accept_error_body: fn(&str) -> bool,
) -> crate::error::Result<Option<PageResponse>> {
    fetch_page_inner(
        client,
        url,
        retries,
        timeout_ms,
        suppress_errors,
        silent_statuses,
        Some(accept_error_body),
    )
    .await
}

async fn fetch_page_inner(
    client: &Client,
    url: &str,
    retries: u32,
    timeout_ms: u64,
    suppress_errors: bool,
    silent_statuses: &[u16],
    accept_error_body: Option<fn(&str) -> bool>,
) -> crate::error::Result<Option<PageResponse>> {
    let user_agent = user_agent_for(url);

    for attempt in 0..=retries {
        let result = client
            .get(url)
            .header("User-Agent", user_agent)
            .header(
                "Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header("Accept-Language", "en-US,en;q=0.5")
            .timeout(Duration::from_millis(timeout_ms))
            .send()
            .await;

        match result {
            Ok(response) => {
                let status = response.status().as_u16();
                let final_url = response.url().to_string();

                if !response.status().is_success() {
                    if let Some(accept) = accept_error_body
                        && let Ok(html) = response.text().await
                        && accept(&html)
                    {
                        debug!("Returning {} body from {} to caller", status, url);
                        return Ok(Some(PageResponse { html, final_url }));
                    }
                    if !suppress_errors && !silent_statuses.contains(&status) {
                        warn!("Failed to fetch {}: {}", url, status);
                    }
                    if status == 404 {
                        return Ok(None);
                    }
                    if attempt < retries {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    return Ok(None);
                }

                let html = response.text().await.map_err(|e| {
                    crate::error::PanelsError::ScrapeFailed(format!(
                        "failed to read response body from {}: {}",
                        url, e
                    ))
                })?;

                return Ok(Some(PageResponse { html, final_url }));
            }
            Err(e) => {
                if !suppress_errors {
                    if e.is_timeout() {
                        warn!("Timed out fetching {} after {}ms", url, timeout_ms);
                    } else {
                        warn!("Error fetching {} (attempt {}): {}", url, attempt + 1, e);
                    }
                } else {
                    debug!(
                        "Suppressed error fetching {} (attempt {}): {}",
                        url,
                        attempt + 1,
                        e
                    );
                }
                if attempt < retries {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                return Ok(None);
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_rotation() {
        let ua = random_user_agent();
        assert!(ua.contains("Mozilla"));
        assert!(ua.contains("Chrome"));
    }

    #[test]
    fn user_agent_selected_per_host() {
        assert_eq!(
            user_agent_for(
                "https://web.archive.org/web/20160228070030im_/http://assets.amuniversal.com/abc",
            ),
            ARCHIVE_USER_AGENT
        );
        assert!(user_agent_for("https://xkcd.com/1/info.0.json").contains("Mozilla"));
    }

    #[test]
    fn client_builds_successfully() {
        let _client = build_client();
    }

    async fn serve_once(status: &'static str, body: &'static str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{addr}/")
    }

    #[tokio::test]
    async fn accepted_error_body_is_returned() {
        let url = serve_once("403 Forbidden", "challenge").await;
        let page =
            fetch_page_accepting_error_body(&build_client(), &url, 0, 2000, true, &[], |html| {
                html == "challenge"
            })
            .await
            .unwrap();
        assert_eq!(page.unwrap().html, "challenge");
    }

    #[tokio::test]
    async fn rejected_error_body_is_dropped() {
        let url = serve_once("403 Forbidden", "forbidden").await;
        let page =
            fetch_page_accepting_error_body(&build_client(), &url, 0, 2000, true, &[], |html| {
                html == "challenge"
            })
            .await
            .unwrap();
        assert!(page.is_none());
    }
}
