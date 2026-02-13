use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comic {
    pub endpoint: String,
    pub title: String,
    pub author: Option<String>,
    pub available: bool,
    pub start_date: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "gocomics".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicStrip {
    pub endpoint: String,
    pub title: String,
    pub date: String,
    pub image_url: String,
    pub source_url: String,
    pub prev_date: Option<String>,
    pub next_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicWithTags {
    #[serde(flatten)]
    pub comic: Comic,
    pub tags: Vec<String>,
}
