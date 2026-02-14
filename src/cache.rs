use std::time::Duration;

use moka::future::Cache;

use crate::models::ComicStrip;

#[derive(Clone)]
pub struct Caches {
    pub strips: Cache<String, ComicStrip>,
}

impl Caches {
    pub fn new(strip_max: u64, strip_ttl_secs: u64) -> Self {
        Self {
            strips: Cache::builder()
                .max_capacity(strip_max)
                .time_to_live(Duration::from_secs(strip_ttl_secs))
                .build(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn strip_cache_insert_and_get() {
        let caches = Caches::new(100, 60);
        let strip = ComicStrip {
            endpoint: "garfield".into(),
            title: "Garfield".into(),
            date: "2024-01-15".into(),
            image_url: "https://example.com/img.gif".into(),
            source_url: "https://www.gocomics.com/garfield".into(),
            prev_date: Some("2024-01-14".into()),
            next_date: Some("2024-01-16".into()),
        };
        caches
            .strips
            .insert("garfield:2024-01-15".into(), strip.clone())
            .await;
        let cached = caches.strips.get(&"garfield:2024-01-15".to_string()).await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().date, "2024-01-15");
    }
}
