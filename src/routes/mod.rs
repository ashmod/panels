pub mod comics;
pub mod proxy;
pub mod recommendations;
pub mod strips;

use axum::Router;
use axum::routing::get;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::AppState;

pub fn build_router(state: Arc<AppState>) -> Router {
    let badges_dir = format!("{}/badges", state.config.data_dir);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/comics", get(comics::list_comics))
        .route(
            "/api/recommendations",
            get(recommendations::get_recommendations),
        )
        .route("/api/comics/{endpoint}/{date}", get(strips::get_strip))
        .route(
            "/api/comics/{endpoint}/{date}/image",
            get(proxy::proxy_image),
        )
        .nest_service("/api/badges", ServeDir::new(badges_dir))
        .route_service("/feed", ServeFile::new("web/index.html"))
        .fallback_service(ServeDir::new("web").fallback(ServeFile::new("web/index.html")))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok" }))
}
