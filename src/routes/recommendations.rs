use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

use crate::AppState;
use crate::error::Result;
use crate::models::ComicWithTags;

#[derive(Deserialize)]
pub struct RecommendationsQuery {
    pub selected: Option<String>,
    pub limit: Option<usize>,
}

pub async fn get_recommendations(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RecommendationsQuery>,
) -> Result<Json<Vec<ComicWithTags>>> {
    let limit = query.limit.unwrap_or(10);

    let selected_endpoints: Vec<&str> = query
        .selected
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if selected_endpoints.is_empty() {
        return Ok(Json(vec![]));
    }

    let mut selected_tags: HashMap<&str, usize> = HashMap::new();
    let mut selected_authors: Vec<&str> = Vec::new();
    let mut selected_sources: Vec<&str> = Vec::new();

    for endpoint in &selected_endpoints {
        if let Some(tags) = state.tags.get(*endpoint) {
            for tag in tags {
                *selected_tags.entry(tag.as_str()).or_insert(0) += 1;
            }
        }
        if let Some(comic) = state.comics.iter().find(|c| c.endpoint == *endpoint) {
            if let Some(ref author) = comic.author {
                selected_authors.push(author.as_str());
            }
            selected_sources.push(comic.source.as_str());
        }
    }

    let has_espanol = selected_tags.contains_key("en-espanol");

    // Score all non-selected comics
    let mut scored: Vec<(f64, ComicWithTags)> = state
        .comics
        .iter()
        .filter(|c| c.available && !selected_endpoints.contains(&c.endpoint.as_str()))
        .filter_map(|comic| {
            let tags = state.tags.get(&comic.endpoint).cloned().unwrap_or_default();

            // Skip espanol comics unless user has one selected
            if !has_espanol && tags.iter().any(|t| t == "en-espanol") {
                return None;
            }

            let mut score: f64 = 0.0;

            for tag in &tags {
                if let Some(&count) = selected_tags.get(tag.as_str()) {
                    score += count as f64;
                }
            }

            if let Some(ref author) = comic.author
                && selected_authors.contains(&author.as_str())
            {
                score += 2.0;
            }

            if selected_sources.contains(&comic.source.as_str()) {
                score += 0.5;
            }

            if score > 0.0 {
                Some((
                    score,
                    ComicWithTags {
                        comic: comic.clone(),
                        tags,
                    },
                ))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    scored.truncate(limit);

    let results: Vec<ComicWithTags> = scored.into_iter().map(|(_, comic)| comic).collect();
    Ok(Json(results))
}
