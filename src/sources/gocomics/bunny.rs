// Real comic pages also load Bunny Shield's script, so only the challenge's proof-of-work
// attribute tells the two apart; the challenge page's wording has changed before.
pub fn is_bunny_challenge(html: &str) -> bool {
    html.contains("data-pow=")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_challenge_page() {
        let html = r#"<html><head><title>Establishing a secure connection ...</title></head><body data-pow="abc#def#ghi"></body></html>"#;
        assert!(is_bunny_challenge(html));
    }

    #[test]
    fn detects_challenge_page_with_other_wording() {
        let html = r#"<html><head><title>Checking your browser</title></head><body data-pow="abc"></body></html>"#;
        assert!(is_bunny_challenge(html));
    }

    #[test]
    fn ignores_rate_limit_page() {
        let html = r#"<html><head><title>429 Too Many Requests</title></head><body><iframe src="https://shield-templates-prod.b-cdn.net/1/ratelimit.html"></iframe></body></html>"#;
        assert!(!is_bunny_challenge(html));
    }

    #[test]
    fn ignores_normal_page() {
        let html =
            r#"<html><body><img src="https://featureassets.gocomics.com/strip.gif"></body></html>"#;
        assert!(!is_bunny_challenge(html));
    }
}
