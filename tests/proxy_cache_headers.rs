use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use panels::AppState;
use panels::config::PanelsConfig;
use panels::error::Result;
use panels::models::ComicStrip;
use panels::routes;
use panels::sources::{ComicSource, SourceRegistry};
use tower::util::ServiceExt;

struct MockSource;

#[async_trait]
impl ComicSource for MockSource {
    fn handles(&self, endpoint: &str) -> bool {
        endpoint == "test"
    }

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>> {
        Ok(Some(mock_strip(endpoint, date)))
    }

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        Ok(Some(mock_strip(endpoint, "latest-date")))
    }

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>> {
        Ok(Some(mock_strip(endpoint, "random-date")))
    }

    async fn proxy_image(&self, _image_url: &str) -> Result<(Vec<u8>, String)> {
        Ok((vec![1, 2, 3], "image/png".to_string()))
    }
}

fn mock_strip(endpoint: &str, date: &str) -> ComicStrip {
    ComicStrip {
        endpoint: endpoint.to_string(),
        title: "Test Comic".to_string(),
        date: date.to_string(),
        image_url: "https://example.com/comic.png".to_string(),
        source_url: "https://example.com/source".to_string(),
        prev_date: None,
        next_date: None,
    }
}

fn test_app() -> axum::Router {
    let state = Arc::new(AppState {
        config: PanelsConfig {
            port: 3000,
            data_dir: "data".to_string(),
            strip_cache_max: 10,
            strip_cache_ttl_secs: 60,
        },
        comics: vec![],
        tags: HashMap::new(),
        sources: SourceRegistry::new(vec![Box::new(MockSource)]),
    });

    routes::build_router(state)
}

#[tokio::test]
async fn random_image_endpoint_disables_caching() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/api/comics/test/random/image")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
}

#[tokio::test]
async fn deterministic_image_endpoint_keeps_long_cache() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/api/comics/test/2025-01-01/image")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "public, max-age=86400, s-maxage=604800"
    );
}
