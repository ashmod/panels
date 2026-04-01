pub fn is_bunny_challenge(html: &str) -> bool {
    html.contains("data-pow=") && html.contains("Establishing a secure connection")
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
    fn ignores_normal_page() {
        let html =
            r#"<html><body><img src="https://featureassets.gocomics.com/strip.gif"></body></html>"#;
        assert!(!is_bunny_challenge(html));
    }
}
