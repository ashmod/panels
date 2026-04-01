use std::fmt::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use argon2::{Algorithm, Argon2, Params, Version};
use reqwest::Client;
use reqwest::Url;
use tokio::task;
use tracing::info;

use crate::error::{PanelsError, Result};

const VERIFY_PATH: &str = "/.bunny-shield/verify-pow";

#[derive(Clone, Copy)]
struct PowOptions {
    diff: usize,
    mem_cost_kib: u32,
    time_cost: u32,
    parallelism: u32,
    hash_len: usize,
}

impl Default for PowOptions {
    fn default() -> Self {
        Self {
            diff: 13,
            mem_cost_kib: 512,
            time_cost: 2,
            parallelism: 1,
            hash_len: 32,
        }
    }
}

pub fn is_bunny_challenge(html: &str) -> bool {
    html.contains("data-pow=") && html.contains("Establishing a secure connection")
}

fn extract_pow(html: &str) -> Option<String> {
    let marker = "data-pow=\"";
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn matches_bunny_difficulty(hash_hex: &str, diff: usize) -> bool {
    let prefix_len = diff / 8;
    if !hash_hex.starts_with(&"0".repeat(prefix_len)) {
        return false;
    }

    let Some(next) = hash_hex.chars().nth(prefix_len) else {
        return false;
    };

    let Some(next) = next.to_digit(16) else {
        return false;
    };

    let shift = ((prefix_len + 1) * 8).saturating_sub(diff);
    let mask = 0xff_u32 >> shift;
    next & mask == 0
}

fn hash_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn compute_hash_hex(pass: &str, salt: &str, opts: PowOptions) -> Result<String> {
    let params = Params::new(
        opts.mem_cost_kib,
        opts.time_cost,
        opts.parallelism,
        Some(opts.hash_len),
    )
    .map_err(|e| PanelsError::ScrapeFailed(format!("invalid Bunny Shield params: {e}")))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = vec![0_u8; opts.hash_len];
    argon2
        .hash_password_into(pass.as_bytes(), salt.as_bytes(), &mut out)
        .map_err(|e| PanelsError::ScrapeFailed(format!("failed to hash Bunny Shield challenge: {e}")))?;

    Ok(hash_to_hex(&out))
}

fn solve_pow_answer(pow: &str, opts: PowOptions) -> Result<u64> {
    let mut parts = pow.split('#');
    let Some(userkey) = parts.next() else {
        return Err(PanelsError::ScrapeFailed(
            "GoComics challenge page was missing a Bunny Shield key".into(),
        ));
    };
    let Some(challenge) = parts.next() else {
        return Err(PanelsError::ScrapeFailed(
            "GoComics challenge page was missing a Bunny Shield challenge".into(),
        ));
    };

    let threads = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);

    let found = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel();
    let userkey = Arc::new(userkey.to_string());
    let challenge = Arc::new(challenge.to_string());

    thread::scope(|scope| {
        for worker_id in 0..threads {
            let tx = tx.clone();
            let found = Arc::clone(&found);
            let userkey = Arc::clone(&userkey);
            let challenge = Arc::clone(&challenge);

            scope.spawn(move || {
                let mut nonce = worker_id as u64;
                while !found.load(Ordering::Relaxed) {
                    let pass = format!("{}{}", challenge.as_str(), nonce);
                    let Ok(hash_hex) = compute_hash_hex(&pass, userkey.as_str(), opts) else {
                        break;
                    };

                    if matches_bunny_difficulty(&hash_hex, opts.diff) {
                        if !found.swap(true, Ordering::SeqCst) {
                            let _ = tx.send(nonce);
                        }
                        break;
                    }

                    nonce += threads as u64;
                }
            });
        }
    });

    drop(tx);

    rx.recv().map_err(|_| {
        PanelsError::ScrapeFailed("failed to solve GoComics Bunny Shield challenge".into())
    })
}

pub async fn solve_challenge(
    client: &Client,
    page_url: &str,
    html: &str,
    user_agent: &str,
) -> Result<()> {
    let pow = extract_pow(html).ok_or_else(|| {
        PanelsError::ScrapeFailed("failed to read GoComics Bunny Shield challenge".into())
    })?;

    info!(url = %page_url, "solving GoComics Bunny Shield challenge");

    let pow_for_worker = pow.clone();
    let answer = task::spawn_blocking(move || solve_pow_answer(&pow_for_worker, PowOptions::default()))
        .await
        .map_err(|e| PanelsError::ScrapeFailed(format!("Bunny Shield task failed: {e}")))??;

    let verify_url = Url::parse(page_url)
        .map(|mut url| {
            url.set_path(VERIFY_PATH);
            url.set_query(None);
            url.to_string()
        })
        .unwrap_or_else(|_| "https://www.gocomics.com/.bunny-shield/verify-pow".to_string());

    let response = client
        .post(&verify_url)
        .header("User-Agent", user_agent)
        .header("Referer", page_url)
        .header("Content-Type", "application/json")
        .header("Accept", "*/*")
        .header("BunnyShield-Challenge-Response", format!("{pow}#{answer}"))
        .send()
        .await
        .map_err(|e| PanelsError::ScrapeFailed(format!("failed to submit Bunny Shield proof: {e}")))?;

    if response.status().as_u16() >= 400 {
        return Err(PanelsError::ScrapeFailed(format!(
            "GoComics Bunny Shield challenge was rejected: {}",
            response.status()
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_challenge_page() {
        let html = r#"<html><head><title>Establishing a secure connection ...</title></head><body data-pow="abc#def#ghi"></body></html>"#;
        assert!(is_bunny_challenge(html));
    }

    #[test]
    fn extracts_pow_value() {
        let html = r#"<body data-pow="abc#def#ghi"></body>"#;
        assert_eq!(extract_pow(html).as_deref(), Some("abc#def#ghi"));
    }

    #[test]
    fn matches_bunny_hex_rule() {
        assert!(matches_bunny_difficulty("00ffffffff", 13));
        assert!(!matches_bunny_difficulty("01ffffffff", 13));
    }

    #[test]
    fn solves_small_pow() {
        let opts = PowOptions {
            diff: 8,
            mem_cost_kib: 8,
            time_cost: 1,
            parallelism: 1,
            hash_len: 8,
        };

        let pow = "saltsalt#challenge#meta#meta";
        let answer = solve_pow_answer(pow, opts).unwrap();
        let hash = compute_hash_hex(&format!("challenge{answer}"), "saltsalt", opts).unwrap();

        assert!(matches_bunny_difficulty(&hash, opts.diff));
    }
}
