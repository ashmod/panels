use clap::Parser;

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
}
