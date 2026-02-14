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

pub struct AppState {
    pub config: config::PanelsConfig,
    pub comics: Vec<Comic>,
    pub tags: HashMap<String, Vec<String>>,
    pub sources: SourceRegistry,
}
