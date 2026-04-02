use clap::Parser;

const DEFAULT_DEMO_NOTICE: &str = "This live demo is a smaller, simpler version of Panels featuring the full collections for the comics above. To access the complete, enhanced catalog for all other series, you can run locally or self-host it from the repository.";

#[derive(Parser, Debug, Clone)]
#[command(name = "panels", about = "Comic strip aggregator backend")]
pub struct PanelsConfig {
    #[arg(long, default_value = "3000", env = "PANELS_PORT")]
    pub port: u16,

    #[arg(long, default_value = "data", env = "PANELS_DATA_DIR")]
    pub data_dir: String,

    #[arg(long, default_value = "500", env = "PANELS_STRIP_CACHE_MAX")]
    pub strip_cache_max: u64,

    #[arg(long, default_value = "1800", env = "PANELS_STRIP_CACHE_TTL")]
    pub strip_cache_ttl_secs: u64,

    #[arg(long, default_value_t = true, env = "PANELS_DEMO_MODE")]
    pub demo_mode: bool,

    #[arg(long, default_value = DEFAULT_DEMO_NOTICE, env = "PANELS_DEMO_NOTICE")]
    pub demo_notice: String,

    #[arg(
        long,
        default_value = "https://github.com/ashmod/panels",
        env = "PANELS_REPO_URL"
    )]
    pub repo_url: String,
}
