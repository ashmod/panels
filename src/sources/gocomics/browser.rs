use std::path::Path;
use std::process::Stdio;

use serde::Deserialize;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::error::{PanelsError, Result};
use crate::http_client::PageResponse;

const SCRIPT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/gocomics-browser.mjs");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserPageResponse {
    html: String,
    final_url: String,
}

pub async fn fetch_page(url: &str) -> Result<PageResponse> {
    if !Path::new(SCRIPT_PATH).exists() {
        return Err(PanelsError::ScrapeFailed(format!(
            "GoComics browser helper is missing at {}",
            SCRIPT_PATH
        )));
    }

    let mut command = Command::new("node");
    command
        .arg(SCRIPT_PATH)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = timeout(Duration::from_secs(35), command.output())
        .await
        .map_err(|_| PanelsError::ScrapeFailed("GoComics browser fetch timed out".into()))?
        .map_err(|e| PanelsError::ScrapeFailed(format!("failed to start GoComics browser helper: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("GoComics browser helper exited with status {}", output.status)
        } else {
            format!("GoComics browser helper failed: {stderr}")
        };
        return Err(PanelsError::ScrapeFailed(message));
    }

    let response: BrowserPageResponse = serde_json::from_slice(&output.stdout).map_err(|e| {
        PanelsError::ScrapeFailed(format!("failed to parse GoComics browser helper output: {e}"))
    })?;

    Ok(PageResponse {
        html: response.html,
        final_url: response.final_url,
    })
}
