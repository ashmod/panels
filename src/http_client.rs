use std::time::Duration;

use rand::Rng;
use reqwest::Client;
use tracing::{debug, warn};

const USER_AGENTS: &[&str] = &[
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

pub fn random_user_agent() -> &'static str {
    let idx = rand::thread_rng().gen_range(0..USER_AGENTS.len());
    USER_AGENTS[idx]
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
    fetch_page_inner(client, url, retries, timeout_ms, false, &[]).await
}

pub async fn fetch_page_with_options(
    client: &Client,
    url: &str,
    retries: u32,
    timeout_ms: u64,
    suppress_errors: bool,
    silent_statuses: &[u16],
) -> crate::error::Result<Option<PageResponse>> {
    fetch_page_inner(client, url, retries, timeout_ms, suppress_errors, silent_statuses).await
}

async fn fetch_page_inner(
    client: &Client,
    url: &str,
    retries: u32,
    timeout_ms: u64,
    suppress_errors: bool,
    silent_statuses: &[u16],
) -> crate::error::Result<Option<PageResponse>> {
    for attempt in 0..=retries {
        let result = client
            .get(url)
            .header("User-Agent", random_user_agent())
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
                    debug!("Suppressed error fetching {} (attempt {}): {}", url, attempt + 1, e);
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
    fn client_builds_successfully() {
        let _client = build_client();
    }
}
