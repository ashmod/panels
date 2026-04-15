FROM rust:1-slim-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && \
    cargo build --release && \
    rm -rf src target/release/panels* target/release/deps/panels*

COPY src ./src
COPY tests ./tests
RUN cargo build --release

FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY gocomics-browser.mjs ./
COPY data ./data
COPY web ./web
COPY assets ./assets

COPY --from=builder /app/target/release/panels /usr/local/bin/panels

ENV PANELS_PORT=3000 \
    PANELS_DATA_DIR=/app/data \
    RUST_LOG=info

EXPOSE 3000

CMD ["panels"]
