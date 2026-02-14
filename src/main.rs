use std::sync::Arc;

use clap::Parser;
use panels::AppState;
use panels::cache::Caches;
use panels::config::PanelsConfig;
use panels::data;
use panels::http_client;
use panels::routes;
use panels::sources::SourceRegistry;
use panels::sources::comicsrss::ComicsRssSource;
use panels::sources::dilbert::DilbertSource;
use panels::sources::gocomics::GoComicsSource;
use panels::sources::xkcd::XkcdSource;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "panels=info,tower_http=info".parse().unwrap()),
        )
        .init();

    let config = PanelsConfig::parse();
    info!(port = config.port, data_dir = %config.data_dir, "starting panels");

    let comics = data::load_comics(&config.data_dir)?;
    info!(count = comics.len(), "loaded comics directory");

    let tags = data::load_tags(&config.data_dir)?;
    info!(count = tags.len(), "loaded tags");

    let client = http_client::build_client();
    let caches = Caches::new(config.strip_cache_max, config.strip_cache_ttl_secs);

    let gocomics = GoComicsSource::new(client.clone(), comics.clone(), caches.clone());
    let dilbert = DilbertSource::new(client.clone(), &config.data_dir);
    let xkcd = XkcdSource::new(client.clone(), caches.clone());
    let comicsrss = ComicsRssSource::new(client.clone(), comics.clone(), caches);
    let sources = SourceRegistry::new(vec![
        Box::new(gocomics),
        Box::new(dilbert),
        Box::new(xkcd),
        Box::new(comicsrss),
    ]);

    let state = Arc::new(AppState {
        config: config.clone(),
        comics,
        tags,
        sources,
    });

    let app = routes::build_router(state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install CTRL+C handler");
    info!("shutdown signal received");
}
