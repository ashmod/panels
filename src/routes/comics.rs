use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use std::sync::Arc;

use crate::error::Result;
use crate::models::ComicWithTags;
use crate::AppState;

#[derive(Deserialize)]
pub struct ComicsQuery {
    pub search: Option<String>,
    pub tag: Option<String>,
}

pub async fn list_comics(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ComicsQuery>,
) -> Result<Json<Vec<ComicWithTags>>> {
    let mut results: Vec<ComicWithTags> = state
        .comics
        .iter()
        .map(|comic| {
            let tags = state
                .tags
                .get(&comic.endpoint)
                .cloned()
                .unwrap_or_default();
            ComicWithTags {
                comic: comic.clone(),
                tags,
            }
        })
        .collect();

    if let Some(ref search) = query.search {
        let search_lower = search.to_lowercase();
        results.retain(|c| {
            c.comic.title.to_lowercase().contains(&search_lower)
                || c.comic.endpoint.to_lowercase().contains(&search_lower)
        });
    }

    if let Some(ref tag) = query.tag {
        let tag_lower = tag.to_lowercase();
        results.retain(|c| c.tags.iter().any(|t| t.to_lowercase() == tag_lower));
    }

    Ok(Json(results))
}
