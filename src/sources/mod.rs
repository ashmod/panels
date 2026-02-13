pub mod comicsrss;
pub mod dilbert;
pub mod gocomics;
pub mod xkcd;

use async_trait::async_trait;

use crate::error::Result;
use crate::models::ComicStrip;

#[async_trait]
pub trait ComicSource: Send + Sync {
    fn handles(&self, endpoint: &str) -> bool;

    async fn fetch_strip(&self, endpoint: &str, date: &str) -> Result<Option<ComicStrip>>;

    async fn fetch_latest(&self, endpoint: &str) -> Result<Option<ComicStrip>>;

    async fn fetch_random(&self, endpoint: &str) -> Result<Option<ComicStrip>>;

    async fn proxy_image(&self, image_url: &str) -> Result<(Vec<u8>, String)>;
}

pub struct SourceRegistry {
    sources: Vec<Box<dyn ComicSource>>,
}

impl SourceRegistry {
    pub fn new(sources: Vec<Box<dyn ComicSource>>) -> Self {
        Self { sources }
    }

    pub fn find(&self, endpoint: &str) -> Option<&dyn ComicSource> {
        self.sources
            .iter()
            .find(|s| s.handles(endpoint))
            .map(|s| s.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockSource {
        endpoints: Vec<String>,
    }

    #[async_trait]
    impl ComicSource for MockSource {
        fn handles(&self, endpoint: &str) -> bool {
            self.endpoints.iter().any(|e| e == endpoint)
        }
        async fn fetch_strip(&self, _: &str, _: &str) -> Result<Option<ComicStrip>> {
            Ok(None)
        }
        async fn fetch_latest(&self, _: &str) -> Result<Option<ComicStrip>> {
            Ok(None)
        }
        async fn fetch_random(&self, _: &str) -> Result<Option<ComicStrip>> {
            Ok(None)
        }
        async fn proxy_image(&self, _: &str) -> Result<(Vec<u8>, String)> {
            Ok((vec![], "image/png".into()))
        }
    }

    #[test]
    fn registry_finds_correct_source() {
        let source = MockSource {
            endpoints: vec!["garfield".into(), "peanuts".into()],
        };
        let registry = SourceRegistry::new(vec![Box::new(source)]);
        assert!(registry.find("garfield").is_some());
        assert!(registry.find("peanuts").is_some());
        assert!(registry.find("dilbert").is_none());
    }
}
