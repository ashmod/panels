use axum::Json;
use axum::extract::{Path, State};
use std::sync::Arc;

use crate::AppState;
use crate::error::{PanelsError, Result};
use crate::models::ComicStrip;

pub async fn get_strip(
    State(state): State<Arc<AppState>>,
    Path((endpoint, date)): Path<(String, String)>,
) -> Result<Json<ComicStrip>> {
    let source = state
        .sources
        .find(&endpoint)
        .ok_or_else(|| PanelsError::NotFound(format!("unknown comic: {}", endpoint)))?;

    let strip = match date.as_str() {
        "latest" => source.fetch_latest(&endpoint).await?,
        "random" => source.fetch_random(&endpoint).await?,
        date_str => source.fetch_strip(&endpoint, date_str).await?,
    };

    match strip {
        Some(s) => Ok(Json(s)),
        None => Err(PanelsError::NotFound(format!(
            "no strip found for {}/{}",
            endpoint, date
        ))),
    }
}
