pub mod cache;
pub mod config;
pub mod data;
pub mod error;
pub mod http_client;
pub mod models;
pub mod routes;
pub mod sources;

use std::collections::HashMap;

use models::Comic;
use sources::SourceRegistry;

#[derive(Clone)]
pub struct AppMeta {
    pub demo_mode: bool,
    pub demo_notice: String,
    pub repo_url: String,
}

pub struct AppState {
    pub config: config::PanelsConfig,
    pub meta: AppMeta,
    pub comics: Vec<Comic>,
    pub tags: HashMap<String, Vec<String>>,
    pub sources: SourceRegistry,
}
