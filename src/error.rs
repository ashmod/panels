use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum PanelsError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid date: {0}")]
    InvalidDate(String),

    #[error("invalid parameter: {0}")]
    InvalidParam(String),

    #[error("scrape failed: {0}")]
    ScrapeFailed(String),

    #[error("http error: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for PanelsError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            PanelsError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            PanelsError::InvalidDate(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            PanelsError::InvalidParam(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            PanelsError::ScrapeFailed(msg) => (StatusCode::BAD_GATEWAY, msg.clone()),
            PanelsError::HttpError(e) => (StatusCode::BAD_GATEWAY, e.to_string()),
            PanelsError::Internal(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };

        let body = json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}

pub type Result<T> = std::result::Result<T, PanelsError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_maps_to_404() {
        let err = PanelsError::NotFound("test".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn invalid_date_maps_to_400() {
        let err = PanelsError::InvalidDate("bad date".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn invalid_param_maps_to_400() {
        let err = PanelsError::InvalidParam("bad param".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn scrape_failed_maps_to_502() {
        let err = PanelsError::ScrapeFailed("timeout".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }
}
