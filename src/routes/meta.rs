use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaResponse {
    pub demo_mode: bool,
    pub demo_notice: String,
    pub repo_url: String,
}

pub async fn get_meta(State(state): State<Arc<AppState>>) -> Json<MetaResponse> {
    Json(MetaResponse {
        demo_mode: state.meta.demo_mode,
        demo_notice: state.meta.demo_notice.clone(),
        repo_url: state.meta.repo_url.clone(),
    })
}
