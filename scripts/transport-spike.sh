#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -d /opt/otp-27/bin ]]; then
  export PATH="/opt/otp-27/bin:${PATH}"
fi
if [[ -d /opt/elixir/bin ]]; then
  export PATH="/opt/elixir/bin:${PATH}"
fi
if [[ -d "${HOME}/.cargo/bin" ]]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi
export RELAY_LOOPBACK=1
export RELAY_URL="${RELAY_URL:-http://127.0.0.1:4000}"
export SPIKE_HZ="${SPIKE_HZ:-60}"
export SPIKE_SECONDS="${SPIKE_SECONDS:-2}"
cd "${root}/apps/relay"
mix test
MIX_ENV=dev mix compile
MIX_ENV=dev mix run --no-halt >/tmp/opensekai-relay.log 2>&1 &
relay_pid=$!
cleanup() { kill "${relay_pid}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
for _ in $(seq 1 120); do
  if curl -sf "${RELAY_URL}/api/runtime" >/dev/null; then
    break
  fi
  sleep 0.25
done
curl -sf "${RELAY_URL}/api/runtime" >/dev/null
cd "${root}"
cargo test -p opensekai-transport-spike
cargo run -p opensekai-transport-spike --bin transport-spike
SPIKE_HZ=30 cargo run -p opensekai-transport-spike --bin transport-spike
