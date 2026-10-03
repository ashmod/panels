use std::path::Path;
use std::process::Stdio;

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant, timeout};
use tracing::{info, warn};

use crate::error::{PanelsError, Result};
use crate::http_client::PageResponse;

const SCRIPT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/gocomics-browser.mjs");
const REQUEST_TIMEOUT: Duration = Duration::from_secs(50);
const MIN_REQUEST_INTERVAL: Duration = Duration::from_secs(1);
const RATE_LIMIT_COOLDOWN: Duration = Duration::from_secs(60);

static STATE: Mutex<State> = Mutex::const_new(State {
    helper: None,
    last_request: None,
    rate_limited_until: None,
});

struct State {
    helper: Option<Helper>,
    last_request: Option<Instant>,
    rate_limited_until: Option<Instant>,
}

struct Helper {
    _child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserReply {
    html: Option<String>,
    final_url: Option<String>,
    status: Option<u16>,
    error: Option<String>,
}

impl Helper {
    fn spawn() -> Result<Self> {
        if !Path::new(SCRIPT_PATH).exists() {
            return Err(PanelsError::ScrapeFailed(format!(
                "GoComics browser helper is missing at {}",
                SCRIPT_PATH
            )));
        }

        let mut child = Command::new("node")
            .arg(SCRIPT_PATH)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                PanelsError::ScrapeFailed(format!("failed to start GoComics browser helper: {e}"))
            })?;

        let stdin = child.stdin.take().expect("helper stdin is piped");
        let stdout = child.stdout.take().expect("helper stdout is piped");
        info!("started GoComics browser helper");

        Ok(Self {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
        })
    }

    async fn request(&mut self, url: &str) -> std::io::Result<String> {
        let mut line = serde_json::json!({ "url": url }).to_string();
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.flush().await?;
        self.stdout
            .next_line()
            .await?
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "helper exited"))
    }
}

fn rate_limited() -> PanelsError {
    PanelsError::ScrapeFailed("GoComics is rate limiting requests, backing off".into())
}

pub async fn fetch_page(url: &str) -> Result<Option<PageResponse>> {
    let mut state = STATE.lock().await;
    if state
        .rate_limited_until
        .is_some_and(|until| Instant::now() < until)
    {
        return Err(rate_limited());
    }
    if let Some(last) = state.last_request {
        tokio::time::sleep_until(last + MIN_REQUEST_INTERVAL).await;
    }
    if state.helper.is_none() {
        state.helper = Some(Helper::spawn()?);
    }
    let helper = state.helper.as_mut().expect("helper was just started");

    let result = timeout(REQUEST_TIMEOUT, helper.request(url)).await;
    state.last_request = Some(Instant::now());
    let line = match result {
        Ok(Ok(line)) => line,
        Ok(Err(e)) => {
            warn!("GoComics browser helper failed, restarting: {e}");
            state.helper = None;
            return Err(PanelsError::ScrapeFailed(format!(
                "GoComics browser helper failed: {e}"
            )));
        }
        Err(_) => {
            warn!("GoComics browser helper timed out, restarting");
            state.helper = None;
            return Err(PanelsError::ScrapeFailed(
                "GoComics browser fetch timed out".into(),
            ));
        }
    };

    let reply: BrowserReply = serde_json::from_str(&line).map_err(|e| {
        PanelsError::ScrapeFailed(format!(
            "failed to parse GoComics browser helper output: {e}"
        ))
    })?;

    if let Some(error) = reply.error {
        return Err(PanelsError::ScrapeFailed(format!(
            "GoComics browser fetch failed: {error}"
        )));
    }
    match reply.status {
        Some(404) => return Ok(None),
        Some(429) => {
            warn!(
                "GoComics rate limited us, pausing for {}s",
                RATE_LIMIT_COOLDOWN.as_secs()
            );
            state.rate_limited_until = Some(Instant::now() + RATE_LIMIT_COOLDOWN);
            return Err(rate_limited());
        }
        _ => {}
    }
    match (reply.html, reply.final_url) {
        (Some(html), Some(final_url)) => Ok(Some(PageResponse { html, final_url })),
        _ => Err(PanelsError::ScrapeFailed(
            "GoComics browser helper returned an incomplete reply".into(),
        )),
    }
}
