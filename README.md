<picture>
  <source srcset="assets/panels_white.svg" media="(prefers-color-scheme: dark)">
  <img src="assets/panels.svg" alt="Panels logo">
</picture>

<br><br>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/ashmod/panels/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/ashmod/panels/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/github/actions/workflow/status/ashmod/panels/tests.yml?branch=main&label=Tests&logo=github&style=flat-square)](https://github.com/ashmod/panels/actions/workflows/tests.yml)
[![Deployment](https://img.shields.io/website?url=https%3A%2F%2Fpanels.ashmod.dev%2Fapi%2Fhealth&label=Deployment&logo=heroku&style=flat-square)](https://panels.ashmod.dev)

</div>

Panels is a simple Rust based web server for delivering the Sunday Funnies anytime, anywhere. It provides over 400 comics; select your favorites, and get random strips immediately. Panels also has a recommendation engine to help you discover new comics based on your preferences.

> [!NOTE]
Panels is a personal project and is not affiliated with any comic publishers. All comics are sourced from publicly available data and are intended for personal use and enjoyment. All comics are property of their respective creators and publishers.

## Quick Start

### 1. Prerequisites

- Rust stable toolchain
- `cargo`

### 2. Run locally

```bash
cargo run
```

Server starts on `http://localhost:3000` by default.

### 3. Check health

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok"}
```

## Configuration

Panels uses CLI flags and environment variables:

| Flag | Env | Default | Description |
|---|---|---|---|
| `--port` | `PANELS_PORT` | `3000` | HTTP server port |
| `--data-dir` | `PANELS_DATA_DIR` | `data` | Path containing `comics.json`, `tags.json`, and `badges/` |
| `--strip-cache-max` | `PANELS_STRIP_CACHE_MAX` | `500` | Max strip cache entries |
| `--strip-cache-ttl` | `PANELS_STRIP_CACHE_TTL` | `1800` | Strip cache TTL in seconds |

Example:

```bash
PANELS_PORT=4000 PANELS_DATA_DIR=./data cargo run
```

## API Overview

### `GET /api/health`

Basic liveness endpoint.

### `GET /api/comics`

Returns comics with tag metadata.

Query params:
- `search` (optional): matches `title` or `endpoint`
- `tag` (optional): exact tag filter (case-insensitive)

Example:

```bash
curl "http://localhost:3000/api/comics?search=garfield&tag=humor"
```

### `GET /api/recommendations`

Returns scored recommendations from selected comic endpoints.

Query params:
- `selected` (required for non-empty results): comma-separated endpoints
- `limit` (optional): max results, default `10`

Example:

```bash
curl "http://localhost:3000/api/recommendations?selected=garfield,peanuts&limit=8"
```

### `GET /api/comics/{endpoint}/{date}`

Returns one strip as JSON.

`{date}` supports:
- `YYYY-MM-DD`
- `latest`
- `random`

Examples:

```bash
curl "http://localhost:3000/api/comics/garfield/latest"
curl "http://localhost:3000/api/comics/garfield/random"
curl "http://localhost:3000/api/comics/garfield/2025-02-14"
```

### `GET /api/comics/{endpoint}/{date}/image`

Proxies the strip image bytes and content type.

Caching behavior:
- `date=random`: `Cache-Control: no-store`
- any non-random request: `Cache-Control: public, max-age=86400, s-maxage=604800`

Example:

```bash
curl -I "http://localhost:3000/api/comics/garfield/random/image"
```

## Development

Run the usual checks:

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
```

CI (`.github/workflows/ci.yml`) runs:
- `cargo check --all-targets`
- `cargo test --all-targets`

Tests workflow (`.github/workflows/tests.yml`) runs:
- `cargo test --all-targets`

## Contributing

Contributions are welcome. Feel free to open an issue or submit a pull request. Let me know if a comic you love is missing or if you have ideas for new features!

### Issue reporting

When reporting an issue, please include:
- A clear description of the problem.
- Steps to reproduce the issue.
- Expected vs actual behavior.
- Any relevant logs or error messages.  
 
### Pull request guidelines

1. Fork the repo and create a feature branch.
2. Make focused changes with clear commit messages.
3. Run the local quality checks.
4. Open the PR with context and testing notes.

### Local quality checks

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
```

### Pull request checklist

- Scope is limited to one feature or fix.
- API behavior changes are documented in `README.md`.
- New behavior is covered by tests in `tests/` or module tests.
- Clippy and tests pass locally.

## License

MIT. See [`LICENSE`](LICENSE).
