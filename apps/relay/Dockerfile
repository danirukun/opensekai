# Build context: apps/relay. `docker build -t opensekai-relay apps/relay`.
ARG ELIXIR_IMAGE=hexpm/elixir:1.18.6-erlang-27.3.4.20-debian-bookworm-20261123-slim
ARG RUNTIME_IMAGE=debian:bookworm-slim

FROM ${ELIXIR_IMAGE} AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl ca-certificates git pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/*

# ex_sctp builds a Rustler NIF, which needs a current Rust toolchain.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable

ENV MIX_ENV=prod
WORKDIR /build

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mkdir config
COPY config/config.exs config/prod.exs config/
RUN mix deps.compile

COPY lib lib
COPY config/runtime.exs config/
RUN mix release relay --path /app

FROM ${RUNTIME_IMAGE} AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends libssl3 libstdc++6 libncurses6 ca-certificates locales \
 && rm -rf /var/lib/apt/lists/* \
 && sed -i '/en_US.UTF-8/s/^# //' /etc/locale.gen \
 && locale-gen

ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8 \
    PHX_SERVER=true PORT=4000 \
    RELAY_ICE_PORT_MIN=50000 RELAY_ICE_PORT_MAX=50999

WORKDIR /app
COPY --from=builder /app /app
RUN useradd --system --no-create-home relay && chown -R relay /app
USER relay

EXPOSE 4000/tcp
EXPOSE 50000-50999/udp

CMD ["/app/bin/relay", "start"]
