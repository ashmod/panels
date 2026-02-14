// This is a maintenance tool for Dilbert comics. Because Dilbert is discontinued and we get all our comics from Wayback Machine,
// we sometimes struggle to find exact matches for dates and their corresponding URLs. This tool performs a bulk CDX query to get all
// available timestamps for Dilbert strips, then builds a local cache of date:image mappings stored in data/dilbert_cache.json.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use panels::http_client::{build_client, fetch_page};
use panels::sources::dilbert::{DilbertCacheEntry, dilbert_strip_url};
use scraper::{Html, Selector};
use tokio::sync::Mutex;

const CACHE_PATH: &str = "data/dilbert_cache.json";
const CONCURRENCY: usize = 8;
const SAVE_INTERVAL: usize = 100;

fn normalize_url(src: &str) -> String {
    if src.starts_with("//") {
        format!("https:{}", src)
    } else {
        src.to_string()
    }
}

fn parse_dilbert_page(html: &str) -> Option<DilbertCacheEntry> {
    let document = Html::parse_document(html);

    let mut image_url: Option<String> = None;
    if let Ok(sel) = Selector::parse(".img-comic") {
        image_url = document
            .select(&sel)
            .next()
            .and_then(|el| el.value().attr("src"))
            .map(normalize_url);
    }

    if image_url.is_none()
        && let Ok(sel) = Selector::parse("img")
    {
        for el in document.select(&sel) {
            if let Some(src) = el.value().attr("src")
                && src.contains("assets.amuniversal.com")
            {
                image_url = Some(normalize_url(src));
                break;
            }
        }
    }

    let image_url = image_url?;

    let title = Selector::parse(".comic-title-name")
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Dilbert".to_string());

    Some(DilbertCacheEntry { image_url, title })
}

async fn fetch_all_cdx_timestamps(
    client: &reqwest::Client,
) -> anyhow::Result<HashMap<String, String>> {
    println!("[cdx] fetching bulk timestamps from archive.org...");
    let url = "https://web.archive.org/cdx/search/cdx\
        ?url=dilbert.com/strip/*\
        &fl=original,timestamp\
        &filter=statuscode:200\
        &collapse=urlkey\
        &to=20230312\
        &limit=100000";

    let page = fetch_page(client, url, 3, 60000)
        .await
        .map_err(|e| anyhow::anyhow!("CDX bulk fetch failed: {e}"))?
        .ok_or_else(|| anyhow::anyhow!("CDX bulk fetch returned empty"))?;

    let mut timestamps: HashMap<String, String> = HashMap::new();

    for line in page.html.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() != 2 {
            continue;
        }
        let original = parts[0];
        let timestamp = parts[1];

        // Extract date from URL like "dilbert.com/strip/2020-01-15"
        let date = original.rsplit('/').next().unwrap_or("");

        // Validate it looks like a date
        if date.len() == 10 && date.chars().filter(|c| *c == '-').count() == 2 {
            timestamps.insert(date.to_string(), timestamp.to_string());
        }
    }

    println!("[cdx] found timestamps for {} dates", timestamps.len());
    Ok(timestamps)
}

fn wayback_url(timestamp: &str, original_url: &str) -> String {
    format!("https://web.archive.org/web/{}/{}", timestamp, original_url)
}

fn load_cache() -> HashMap<String, DilbertCacheEntry> {
    let path = Path::new(CACHE_PATH);
    if !path.exists() {
        return HashMap::new();
    }
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_cache(cache: &HashMap<String, DilbertCacheEntry>) {
    let json = serde_json::to_string_pretty(cache).expect("failed to serialize cache");
    std::fs::write(CACHE_PATH, json).expect("failed to write cache file");
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let start = Instant::now();
    let client = build_client();

    let cache = load_cache();
    let already_cached = cache.len();
    println!("already cached: {already_cached}");

    let timestamps = fetch_all_cdx_timestamps(&client).await?;

    let to_fetch: Vec<(String, String)> = timestamps
        .into_iter()
        .filter(|(date, _)| !cache.contains_key(date))
        .collect();

    let total_needed = to_fetch.len();
    println!("remaining to fetch: {total_needed}");

    if total_needed == 0 {
        println!("cache is complete!");
        return Ok(());
    }

    let cache = Arc::new(Mutex::new(cache));
    let fetched = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let errors = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for chunk in to_fetch.chunks(CONCURRENCY) {
        let mut handles = Vec::new();

        for (date, timestamp) in chunk {
            let client = client.clone();
            let cache = Arc::clone(&cache);
            let fetched = Arc::clone(&fetched);
            let errors = Arc::clone(&errors);
            let date = date.clone();
            let timestamp = timestamp.clone();

            handles.push(tokio::spawn(async move {
                let original_url = dilbert_strip_url(&date);
                let archive_url = wayback_url(&timestamp, &original_url);

                let page = match fetch_page(&client, &archive_url, 2, 20000).await {
                    Ok(Some(p)) => p,
                    Ok(None) => {
                        eprintln!("[skip] {date}: wayback page not found");
                        errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        return;
                    }
                    Err(e) => {
                        eprintln!("[error] {date}: {e}");
                        errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        return;
                    }
                };

                match parse_dilbert_page(&page.html) {
                    Some(entry) => {
                        cache.lock().await.insert(date.clone(), entry);
                        let n = fetched.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                        let total = already_cached + n;
                        println!(
                            "[ok] {date} ({total}/{total_all})",
                            total_all = already_cached + total_needed
                        );
                    }
                    None => {
                        eprintln!("[skip] {date}: no image found in page");
                        errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                }
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }

        let n = fetched.load(std::sync::atomic::Ordering::Relaxed);
        if n > 0 && n % SAVE_INTERVAL < CONCURRENCY {
            let c = cache.lock().await;
            save_cache(&c);
            println!("[saved] {} total entries", c.len());
        }

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    let c = cache.lock().await;
    save_cache(&c);
    let elapsed = start.elapsed();
    let total_fetched = fetched.load(std::sync::atomic::Ordering::Relaxed);
    let total_errors = errors.load(std::sync::atomic::Ordering::Relaxed);

    println!("\ndone in {:.1}m", elapsed.as_secs_f64() / 60.0);
    println!(
        "fetched: {total_fetched}, errors: {total_errors}, total cached: {}",
        c.len()
    );

    Ok(())
}
