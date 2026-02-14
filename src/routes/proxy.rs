use axum::extract::{Path, State};
use axum::http::header;
use axum::response::IntoResponse;
use std::sync::Arc;

use crate::AppState;
use crate::error::{PanelsError, Result};

pub async fn proxy_image(
    State(state): State<Arc<AppState>>,
    Path((endpoint, date)): Path<(String, String)>,
) -> Result<impl IntoResponse> {
    let source = state
        .sources
        .find(&endpoint)
        .ok_or_else(|| PanelsError::NotFound(format!("unknown comic: {}", endpoint)))?;

    let strip = match date.as_str() {
        "latest" => source.fetch_latest(&endpoint).await?,
        "random" => source.fetch_random(&endpoint).await?,
        date_str => source.fetch_strip(&endpoint, date_str).await?,
    };

    let strip = strip.ok_or_else(|| {
        PanelsError::NotFound(format!("no strip found for {}/{}", endpoint, date))
    })?;

    let (bytes, content_type) = source.proxy_image(&strip.image_url).await?;

    let cache_control = if date == "random" {
        "no-store".to_string()
    } else {
        "public, max-age=86400, s-maxage=604800".to_string()
    };

    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, cache_control),
        ],
        bytes,
    ))
}
