# REASONS: the client updates itself from GitHub releases

Date: 2026-11-11. Status: contract only, not implemented. Analysis: [client updater](../analysis/2026-11-11-client-updater.md). Depends on: [macOS release CI](2026-11-10-macos-release-ci.md). Out of scope: Developer ID signing and notarization, Windows, a release channel choice, and delta updates.

## R — Requirements

R1. The desktop app registers `tauri-plugin-updater` and `tauri-plugin-process`. The updater uses `plugins.updater` in `tauri.conf.json` without a change.
R2. The `main` capability adds only the updater permissions that the adapter calls (check and download, install) and `process:allow-restart`. The Rust test of the exact permission list includes them. No other capability, the OBS page, MCP, or an extension can call the updater.
R3. The app checks for an update after start and then at the chosen interval (candidate: 60 minutes). It downloads an available update in the background. A check or a download never installs, restarts, or blocks the editor or the output.
R4. When a downloaded update is ready, the editor shows one primary action, "Restart to update", with the new version. It shows nothing while there is no ready update.
R5. The action runs the normal quit path (`request_quit`), with the unsaved-show prompt. After the quit is confirmed, the app installs the update and restarts. A cancelled quit keeps the update ready.
R6. A quit with a ready update installs it before the process exits. The next start runs the new version.
R7. The app never installs or restarts while no user action asked for it. The OBS output continues during a check and a download, also with the editor minimized.
R8. A failed check or download keeps the current version and tries again at the next check. The plugin rejects an archive with a wrong signature, and the app does not install it.
R9. An app that runs from a translocated path cannot update itself. The app does not offer the action there and tells the user once to move the app to `/Applications`.

## E — Entities

- `UpdaterState`: `{ phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error', version?: string, error?: string }`.

## A — Approach

Write the reducer and its tests first. Then the adapter, the plugin registration, the capability, and the action. Accept on macOS with two real releases: install release N in `/Applications`, merge a change, and see release N+1 install through the action and through a quit.

## S — Structure

- `apps/desktop/src-tauri/Cargo.toml`, `src/lib.rs` (plugins, permission test), `capabilities/main.json`.
- `apps/desktop/package.json` (`@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`).
- `apps/desktop/src/editor/updater.ts` (reducer), `apps/desktop/src/updater-adapter.ts` (plugin calls), one component for the action with `@oshi-connect/ui`.
- `apps/desktop/test/updater.test.ts`.
- `ARCHITECTURE.md` (release path), `docs/development-workflow.md`.

## O — Operations

1. Reducer and unit tests: each phase change, the ready version, an error keeps the current version, no phase installs without the action.
2. Adapter: check, download, install, restart; one check at a time.
3. Plugins, capability, and the permission test.
4. The action component and the quit path.
5. macOS acceptance (see Approach), with the camera permission result after an update.

## N — Norms

- Unit tests for the reducer. No mock replaces the reducer under test.
- The UI shows only the action and the version (constitution principle 1).
- Record the macOS version, the two release versions, and the commit in the evidence.

## S — Safeguards

- Do not restart or install without a user action or a quit.
- Do not change the release format, the endpoint, or the public key.
- Do not give the updater to MCP, the OBS page, or extensions.
- Do not claim an update result without the two-release macOS run.
