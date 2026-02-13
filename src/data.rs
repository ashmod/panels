use std::collections::HashMap;
use std::path::Path;

use crate::models::Comic;

pub fn load_comics(data_dir: &str) -> anyhow::Result<Vec<Comic>> {
    let path = Path::new(data_dir).join("comics.json");
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("failed to read {}: {}", path.display(), e))?;
    let comics: Vec<Comic> = serde_json::from_str(&contents)
        .map_err(|e| anyhow::anyhow!("failed to parse {}: {}", path.display(), e))?;
    Ok(comics)
}

pub fn load_tags(data_dir: &str) -> anyhow::Result<HashMap<String, Vec<String>>> {
    let path = Path::new(data_dir).join("tags.json");
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("failed to read {}: {}", path.display(), e))?;
    let tags: HashMap<String, Vec<String>> = serde_json::from_str(&contents)
        .map_err(|e| anyhow::anyhow!("failed to parse {}: {}", path.display(), e))?;
    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_comics_from_data_dir() {
        let comics = load_comics("data").expect("should load comics.json");
        assert!(comics.len() > 100, "expected 100+ comics, got {}", comics.len());

        let first = &comics[0];
        assert!(!first.endpoint.is_empty());
        assert!(!first.title.is_empty());
    }

    #[test]
    fn load_tags_from_data_dir() {
        let tags = load_tags("data").expect("should load tags.json");
        assert!(!tags.is_empty());

        let garfield_tags = tags.get("garfield").expect("garfield should have tags");
        assert!(garfield_tags.contains(&"humor".to_string()));
    }

    #[test]
    fn comics_without_start_date_deserialize() {
        let comics = load_comics("data").expect("should load comics.json");
        let no_start: Vec<_> = comics.iter().filter(|c| c.start_date.is_none()).collect();
        // some comics lack startDate
        assert!(no_start.len() >= 2);
    }
}
