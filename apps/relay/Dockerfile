FROM hexpm/elixir:1.17.3-erlang-27.2-debian-bookworm-20241202 AS build

RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.93.1
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
COPY mix.exs mix.lock* ./
RUN mix local.hex --force && mix local.rebar --force && mix deps.get --only prod
COPY config config
COPY lib lib
RUN MIX_ENV=prod mix compile

FROM hexpm/elixir:1.17.3-erlang-27.2-debian-bookworm-20241202

WORKDIR /app
COPY --from=build /app/_build /app/_build
COPY --from=build /app/deps /app/deps
COPY --from=build /app/mix.exs /app/mix.exs
COPY --from=build /app/config /app/config
COPY --from=build /app/lib /app/lib

ENV MIX_ENV=prod
CMD ["mix", "run", "--no-halt"]
