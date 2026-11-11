# Analysis: the client updates itself from GitHub releases

Date: 2026-11-11. Status: contract only, not implemented. Scope: the second release slice. Depends on: [macOS release CI](../prompt/2026-11-10-macos-release-ci.md), which publishes the signed updater archive and `latest.json` for each merge to `main`.

## Problem

1. A tester must download each new build from the releases page and replace the app by hand.
2. Each release already has what the Tauri v2 updater reads: `latest.json` at `https://github.com/danirukun/opensekai/releases/latest/download/latest.json`, a `.app.tar.gz` for `darwin-aarch64`, and a minisign signature from the key whose public half is `plugins.updater.pubkey` in `tauri.conf.json` (key ID `4DEF778BB1ECFDFF`).
3. The app does not register `tauri-plugin-updater`, so no client reads the manifest.
4. OpenSekai drives a live OBS output. An update that restarts the app during a show stops the stream image. AGENTS.md requires continued output while the editor is minimized.

## Decision

- **Use `tauri-plugin-updater` and `tauri-plugin-process`** (versions that match `tauri =2.12.1`). The plugin reads the existing `plugins.updater` block, so the endpoint and the public key do not change.
- **Check and download in the background; install only on a user action or at quit.** The app never restarts by itself. One primary action, "Restart to update", shows when a downloaded update is ready. A quit with a ready update installs it before the process exits. Alternative: install at once. Rejected: it stops the OBS output during a show.
- **The restart goes through the normal quit path** (`request_quit`), so the unsaved-show prompt still applies.
- **Only the `main` capability gets the updater permissions.** MCP, the OBS page, and extensions get no updater call.
- **A pure state reducer** (`idle`, `checking`, `downloading`, `ready`, `installing`, `error`) drives the UI and has unit tests. The plugin calls stay in one small adapter.

## Candidates (selection gate: the first macOS acceptance run)

- Check interval: at start, then each 60 minutes (candidate), or only at start.
- Place of the action: the editor toolbar next to the output controls (candidate), or the window title area.
- A failed check: retry at the next interval with no UI (candidate), or one quiet status line.

## Risks

- The ad-hoc code signature changes with each build. macOS can ask for the camera permission again after each update, because the privacy database keys on the code signature. Developer ID signing (a later slice) removes this. The first acceptance run must record the result.
- macOS runs a quarantined app from Downloads at a random read-only path (App Translocation). The updater cannot replace that app. The tester must move the app to `/Applications` first. The app can detect a translocated path and say so once.
- Builds from before this slice have no updater. Each tester installs one build of this slice by hand.
- If the updater private key is lost, no client can accept a new release.
