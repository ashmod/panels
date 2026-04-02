use std::collections::HashMap;
use std::path::Path;

use crate::models::Comic;

enum RenderSourceOverride {
    ArcaMax(&'static str),
    CalvinCdn,
    Jikos(&'static str),
    Peanuts,
}

const ARCAMAX_ENDPOINTS: &[(&str, &str)] = &[
    ("1-and-done", "1anddone"),
    ("9-chickweed-lane", "ninechickweedlane"),
    ("agnes", "agnes"),
    ("andycapp", "andycapp"),
    ("archie", "archie"),
    ("aunty-acid", "auntyacid"),
    ("babyblues", "babyblues"),
    ("barneyandclyde", "barneyandclyde"),
    ("bc", "bc"),
    ("blondie", "blondie"),
    ("boondocks", "boondocks"),
    ("breaking-cat-news", "breakingcatnews"),
    ("cathy", "cathy"),
    ("crabgrass", "crabgrass"),
    ("crankshaft", "crankshaft"),
    ("culdesac", "culdesac"),
    ("daddyshome", "daddyshome"),
    ("dennisthemenace", "dennisthemenace"),
    ("diamondlil", "diamondlil"),
    ("dogeatdoug", "dogeatdoug"),
    ("dogsofckennel", "dogsofckennel"),
    ("doonesbury", "doonesbury"),
    ("familycircus", "familycircus"),
    ("floandfriends", "floandfriends"),
    ("forbetterorforworse", "forbetterorforworse"),
    ("forheavenssake", "forheavenssake"),
    ("fowl-language", "fowllanguage"),
    ("freerange", "freerange"),
    ("getfuzzy", "getfuzzy"),
    ("gingermeggs", "gingermeggs"),
    ("hagarthehorrible", "hagarthehorrible"),
    ("heathcliff", "heathcliff"),
    ("herbandjamaal", "herbandjamaal"),
    ("looseparts", "looseparts"),
    ("luann", "luann"),
    ("meaningoflila", "meaningoflila"),
    ("mike-du-jour", "mikedujour"),
    ("momma", "momma"),
    ("mother-goose-and-grimm", "mothergooseandgrimm"),
    ("nonsequitur", "nonsequitur"),
    ("onebighappy", "onebighappy"),
    ("peanuts", "peanuts"),
    ("pearlsbeforeswine", "pearlsbeforeswine"),
    ("pickles", "pickles"),
    ("poorly-drawn-lines", "poorlydrawnlines"),
    ("popeye", "popeye"),
    ("redandrover", "redandrover"),
    ("roseisrose", "roseisrose"),
    ("rubes", "rubes"),
    ("sarahs-scribbles", "sarahsscribbles"),
    ("scarygary", "scarygary"),
    ("shoe", "shoe"),
    ("speedbump", "speedbump"),
    ("strangebrew", "strangebrew"),
    ("theargylesweater", "theargylesweater"),
    ("thebarn", "thebarn"),
    ("lockhorns", "thelockhorns"),
    ("theothercoast", "theothercoast"),
    ("wallace-the-brave", "wallacethebrave"),
    ("weepals", "weepals"),
    ("wizardofid", "wizardofid"),
    ("workingitout", "workingitout"),
    ("wumo", "wumo"),
    ("zackhill", "zackhill"),
];

fn render_override(endpoint: &str) -> Option<RenderSourceOverride> {
    if endpoint == "calvinandhobbes" {
        return Some(RenderSourceOverride::CalvinCdn);
    }

    if endpoint == "peanuts" {
        return Some(RenderSourceOverride::Peanuts);
    }

    if endpoint == "garfield" {
        return Some(RenderSourceOverride::Jikos("garfield"));
    }

    ARCAMAX_ENDPOINTS
        .iter()
        .find(|(candidate, _)| *candidate == endpoint)
        .map(|(_, slug)| RenderSourceOverride::ArcaMax(slug))
}

fn normalize_render_catalog(mut comics: Vec<Comic>) -> Vec<Comic> {
    for comic in &mut comics {
        match render_override(&comic.endpoint) {
            Some(RenderSourceOverride::ArcaMax(slug)) => {
                comic.available = true;
                comic.source = "arcamax".to_string();
                comic.source_slug = Some(slug.to_string());
            }
            Some(RenderSourceOverride::CalvinCdn) => {
                comic.available = true;
                comic.source = "calvincdn".to_string();
                comic.source_slug = None;
            }
            Some(RenderSourceOverride::Peanuts) => {
                comic.available = true;
                comic.source = "peanuts".to_string();
                comic.source_slug = None;
            }
            Some(RenderSourceOverride::Jikos(slug)) => {
                comic.available = true;
                comic.source = "jikos".to_string();
                comic.source_slug = Some(slug.to_string());
            }
            None if comic.source == "disabled" => {
                comic.available = false;
                comic.source_slug = None;
            }
            None => {}
        }
    }

    comics
}

pub fn load_comics(data_dir: &str) -> anyhow::Result<Vec<Comic>> {
    let path = Path::new(data_dir).join("comics.json");
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("failed to read {}: {}", path.display(), e))?;
    let comics: Vec<Comic> = serde_json::from_str(&contents)
        .map_err(|e| anyhow::anyhow!("failed to parse {}: {}", path.display(), e))?;
    Ok(normalize_render_catalog(comics))
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
        assert!(
            comics.len() > 100,
            "expected 100+ comics, got {}",
            comics.len()
        );

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

    #[test]
    fn garfield_is_remapped_off_disabled_source() {
        let comics = load_comics("data").expect("should load comics.json");
        let garfield = comics.iter().find(|c| c.endpoint == "garfield").unwrap();
        assert_eq!(garfield.source, "jikos");
        assert_eq!(garfield.source_slug.as_deref(), Some("garfield"));
    }

    #[test]
    fn unsupported_disabled_entries_are_hidden() {
        let comics = load_comics("data").expect("should load comics.json");
        let calvin = comics
            .iter()
            .find(|c| c.endpoint == "calvinandhobbesespanol")
            .unwrap();
        assert_eq!(calvin.source, "disabled");
        assert!(!calvin.available);
    }

    #[test]
    fn calvin_and_hobbes_is_remapped_to_cdn_source() {
        let comics = load_comics("data").expect("should load comics.json");
        let calvin = comics
            .iter()
            .find(|c| c.endpoint == "calvinandhobbes")
            .unwrap();
        assert_eq!(calvin.source, "calvincdn");
        assert!(calvin.available);
    }

    #[test]
    fn peanuts_is_remapped_to_peanuts_source() {
        let comics = load_comics("data").expect("should load comics.json");
        let peanuts = comics.iter().find(|c| c.endpoint == "peanuts").unwrap();
        assert_eq!(peanuts.source, "peanuts");
        assert!(peanuts.available);
    }
}
