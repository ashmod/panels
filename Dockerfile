FROM rust:1-slim-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY tests ./tests
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --release && \
    cp target/release/panels /panels

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npx playwright install --with-deps firefox && \
    rm -rf /var/lib/apt/lists/* /root/.npm

COPY gocomics-browser.mjs ./
COPY data ./data
COPY web ./web
COPY assets ./assets

COPY --from=builder /panels /usr/local/bin/panels

ENV PANELS_PORT=3000 \
    PANELS_DATA_DIR=/app/data \
    RUST_LOG=info

EXPOSE 3000

CMD ["panels"]
