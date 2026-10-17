#!/usr/bin/env bash
# Set up an OpenSekai checkout in a Linux cloud container. See docs/agent-intake.md.
# Safe to run again: each step skips work that is already done.
# On macOS and other hosts, the cloud-only steps (Node download, apt) are skipped.
# Exit code 3: the UI kit source is not reachable.
# Private fixtures need OPENSEKAI_FIXTURES_S3_ENDPOINT, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY.
# Without them, setup skips the private fixtures and continues.
set -euo pipefail

readonly NODE_VERSION=26.10.0
readonly PNPM_VERSION=12.8.1
readonly UI_REPO=github.com/oshi-connect/oshi-connect-ui
readonly TAURI_PACKAGES=(
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
  librsvg2-dev libxdo-dev libayatana-appindicator3-dev build-essential pkg-config
)
# Software rendering: Mesa lavapipe (Vulkan) and a virtual X display for headed runs.
readonly RENDER_PACKAGES=(mesa-vulkan-drivers libvulkan1 vulkan-tools xvfb xauth)

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/opensekai"
cd "$repo_root"

log() { printf 'cloud-setup: %s\n' "$*"; }
warn() { printf 'cloud-setup: warning: %s\n' "$*" >&2; }
die() { printf 'cloud-setup: error: %s\n' "$*" >&2; exit 1; }

cloud=false
if [[ $(uname -s) == Linux && $(uname -m) == x86_64 ]]; then
  cloud=true
else
  log "host is $(uname -s) $(uname -m): skip the Node download and apt steps"
fi

# a. Node
node_dir="$cache_dir/node/node-v$NODE_VERSION-linux-x64"
if $cloud; then
  if [[ $(node -v 2>/dev/null || true) != "v$NODE_VERSION" ]]; then
    if [[ ! -x $node_dir/bin/node ]]; then
      log "download Node $NODE_VERSION"
      mkdir -p "$cache_dir/node"
      tarball="node-v$NODE_VERSION-linux-x64.tar.xz"
      base="https://nodejs.org/dist/v$NODE_VERSION"
      curl -fsSL -o "$cache_dir/node/$tarball" "$base/$tarball"
      curl -fsSL -o "$cache_dir/node/SHASUMS256.txt" "$base/SHASUMS256.txt"
      (cd "$cache_dir/node" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c --quiet -)
      tar -xJf "$cache_dir/node/$tarball" -C "$cache_dir/node"
      rm -f "$cache_dir/node/$tarball"
    fi
    export PATH="$node_dir/bin:$PATH"
  fi
  path_line="export PATH=\"$node_dir/bin:\$PATH\""
  if ! grep -qxF "$path_line" "$HOME/.bashrc" 2>/dev/null; then
    printf '%s\n' "$path_line" >>"$HOME/.bashrc"
  fi
  # Claude Code SessionStart hooks read later environment from this file.
  if [[ -n ${CLAUDE_ENV_FILE:-} ]] && ! grep -qxF "$path_line" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    printf '%s\n' "$path_line" >>"$CLAUDE_ENV_FILE"
  fi
fi
if [[ $(node -v 2>/dev/null || true) != "v$NODE_VERSION" ]]; then
  $cloud && die "node is $(node -v 2>/dev/null || echo missing), expected v$NODE_VERSION"
  warn "node is $(node -v 2>/dev/null || echo missing), expected v$NODE_VERSION"
fi

# b. pnpm through corepack
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [[ $(pnpm -v 2>/dev/null || true) != "$PNPM_VERSION" ]]; then
  if ! command -v corepack >/dev/null; then
    # Node 25 and later do not bundle corepack.
    log "install corepack"
    npm install --global --silent corepack
  fi
  corepack enable
  hash -r
fi
[[ $(pnpm -v) == "$PNPM_VERSION" ]] || die "pnpm is $(pnpm -v), expected $PNPM_VERSION"

# c. Tauri 2 Linux build packages and software rendering packages
sudo=()
[[ $(id -u) -eq 0 ]] || sudo=(sudo)
if $cloud; then
  if ! { command -v pkg-config >/dev/null && pkg-config --exists webkit2gtk-4.1 &&
    command -v Xvfb >/dev/null && compgen -G '/usr/share/vulkan/icd.d/lvp_icd*.json' >/dev/null; }; then
    log "install the Tauri 2 Linux packages and the software rendering packages"
    "${sudo[@]}" apt-get update -qq
    "${sudo[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      "${TAURI_PACKAGES[@]}" "${RENDER_PACKAGES[@]}"
  fi
fi

# d. UI kit snapshot
expected_ui=$(grep -oE 'Expected source commit: [0-9a-f]{40}' docs/dependencies.md | grep -oE '[0-9a-f]{40}' || true)
[[ -n $expected_ui ]] || die "no expected UI kit commit in docs/dependencies.md"

snapshot_commit() {
  grep -oE '"sourceCommit": "[0-9a-f]{40}"' .local/ui-snapshot.json 2>/dev/null | grep -oE '[0-9a-f]{40}' || true
}

ui_unreachable() {
  echo "UI kit not reachable: grant the Claude GitHub app access to oshi-connect/oshi-connect-ui, or set OSHI_UI_TOKEN" >&2
  exit 3
}

# Clone the UI kit with OSHI_UI_TOKEN. Return 1 when no token is set.
# Trace stays off here so that the token does not reach the log.
clone_ui_with_token() {
  local target=$1 xtrace=false status=0
  [[ $- == *x* ]] && xtrace=true
  { set +x; } 2>/dev/null
  if [[ -z ${OSHI_UI_TOKEN:-} ]]; then
    status=1
  else
    log "clone the UI kit with OSHI_UI_TOKEN"
    rm -rf "$target"
    mkdir -p "$(dirname "$target")"
    GIT_TERMINAL_PROMPT=0 git clone --quiet "https://x-access-token:${OSHI_UI_TOKEN}@$UI_REPO" "$target" 2>&1 |
      sed "s/${OSHI_UI_TOKEN}/***/g" >&2 || status=$?
    if [[ -d $target/.git ]]; then
      git -C "$target" remote set-url origin "https://$UI_REPO"
    fi
  fi
  if $xtrace; then set -x; fi
  return "$status"
}

if [[ $(snapshot_commit) == "$expected_ui" && -d .local/ui/dist ]]; then
  log "UI kit snapshot is at $expected_ui"
else
  ui_dir=
  if [[ -n ${OPENSEKAI_UI_SOURCE:-} ]]; then
    ui_dir=$OPENSEKAI_UI_SOURCE
  elif [[ -f $repo_root/../oshi-connect-ui/package.json ]]; then
    ui_dir=$(cd "$repo_root/../oshi-connect-ui" && pwd)
  elif [[ -f $cache_dir/oshi-connect-ui/package.json ]]; then
    ui_dir=$cache_dir/oshi-connect-ui
  elif clone_ui_with_token "$cache_dir/oshi-connect-ui"; then
    ui_dir=$cache_dir/oshi-connect-ui
  else
    ui_unreachable
  fi
  [[ -f $ui_dir/package.json ]] || die "$ui_dir is not a UI kit checkout"
  log "UI kit source: $ui_dir"

  rebuild=false
  if git -C "$ui_dir" rev-parse --git-dir >/dev/null 2>&1; then
    head=$(git -C "$ui_dir" rev-parse HEAD)
    if [[ $head != "$expected_ui" ]]; then
      if [[ -n $(git -C "$ui_dir" status --porcelain) ]]; then
        warn "UI kit HEAD is $head, expected $expected_ui, and the tree has changes: use it as is"
      else
        if ! git -C "$ui_dir" cat-file -e "$expected_ui^{commit}" 2>/dev/null; then
          git -C "$ui_dir" fetch --quiet origin || warn "cannot fetch the UI kit"
        fi
        git -C "$ui_dir" checkout --quiet --detach "$expected_ui"
        rebuild=true
      fi
    fi
  fi

  if $rebuild || [[ ! -d $ui_dir/dist ]]; then
    log "build the UI kit"
    # The UI kit pins its own pnpm version; corepack selects it from that directory.
    (cd "$ui_dir" && pnpm install --frozen-lockfile && pnpm build)
  fi

  OPENSEKAI_UI_SOURCE=$ui_dir node scripts/bootstrap-ui.ts
  [[ $(snapshot_commit) == "$expected_ui" ]] ||
    warn "UI kit snapshot records $(snapshot_commit), expected $expected_ui"
fi

# e. Workspace and the Playwright browser for headless render checks
pnpm install --frozen-lockfile
# The cloud network can block the browser download. scripts/gpu-probe.ts then uses the
# newest Chromium in PLAYWRIGHT_BROWSERS_PATH.
if $cloud; then
  pnpm exec playwright install-deps chromium >/dev/null
fi
pnpm exec playwright install chromium >/dev/null 2>&1 ||
  warn "Playwright Chromium download failed; use a preinstalled Chromium"

# f. Build. The build reads the tracking models from a cache; fill it first.
pnpm exec tsx scripts/prepare-tracking.ts --download >/dev/null
pnpm build

# g. Test fixtures in fixtures/local. A failed download does not stop setup.
fixtures=$(pnpm exec tsx scripts/prepare-fixtures.ts) || {
  warn "fixture download failed; fixture checks are unavailable"
  fixtures=unavailable
}
gpu=$(pnpm exec tsx scripts/gpu-probe.ts 2>/dev/null) || gpu=unavailable

# h. Summary
printf 'cloud-setup: done: node %s, pnpm %s, %s, UI kit %s\n' \
  "$(node -v)" "$(pnpm -v)" "$(rustc --version 2>/dev/null || echo 'rustc missing')" "$(snapshot_commit)"
printf 'cloud-setup: fixtures: %s\n' "$fixtures"
printf 'cloud-setup: gpu: %s\n' "$gpu"
