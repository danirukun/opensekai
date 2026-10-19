# Workspace dependencies

Tool pins: Node 26.10.0, pnpm 12.8.1, Rust 1.93.1. Exact JavaScript pins are in package.json files. Exact Rust pins are in workspace.dependencies. Lockfiles record transitive dependencies.

The integrator approved TypeScript 6.0.3 on 2026-10-03. Published svelte-check 4.7.6 declares TypeScript ^5.0.0 || ^6.0.0. TypeScript 7.0.2 is outside that range. The npm registry lists 6.0.3 as the latest stable 6.x release. Strict engine and peer checks remain enabled.

Metadata sources: https://registry.npmjs.org/<package>/<version> and https://crates.io/api/v1/crates/<crate>/<version>. Checked on 2026-10-03.

| Helper | Exact pin | Required Rust |
| --- | --- | --- |
| tailwindcss / @tailwindcss/vite | 4.3.3 | — |
| pngjs / @types/pngjs | 7.0.0 / 6.0.5 | — |
| tauri | 2.12.1 | 1.90 |
| tauri-build | 2.7.1 | 1.90 |
| axum | 0.8.9 | 1.80 |
| tokio | 1.53.1 | 1.71 |
| serde | 1.0.229 | 1.56 |
| serde_json | 1.0.151 | 1.71 |
| uuid | 1.27.0 | 1.89 |
| rand | 0.10.3 | 1.85 |
| reqwest | 0.13.5 | 1.85 |
| tokio-tungstenite | 0.30.0 | 1.85 |
| png | 0.18.1 | 1.73 |
| sha2 | 0.11.0 | 1.85 |
| base64 | 0.23.1 | 1.71 |
| futures-util | 0.3.34 | 1.71 |
| tempfile | 3.27.0 | 1.63 |

The UI dependency is a generated local dist snapshot. Expected source commit: 25d5144d2ffaeed84d596c482a0e5424c1d9ea9e. Run OPENSEKAI_UI_SOURCE=/path/to/oshi-connect-ui node scripts/bootstrap-ui.ts before install in each worktree. The adapter does not build or modify its source. Snapshot hash and observed source commit are recorded in .local/ui-snapshot.json. The hash does not prove a clean source checkout. The UI kit has no observed license field or license file. Public distribution requires a licensing decision and a reproducible public package route.

Only esbuild is approved for dependency lifecycle builds. The UI snapshot has no scripts. Generated output lives in apps/desktop/src-tauri/resources/output and is mapped to output in Tauri resources. Native code resolves this from the app resource directory.

Task 2 uses url 2.5.8 as a direct Rust contract dependency. This version was already present in Cargo.lock through native dependencies. Use its WHATWG parser for source URLs and normalized loopback descriptors.

Task 6 uses tauri-plugin-global-shortcut 2.4.0 for native global keystrokes. It is the newest stable 2.x release (crates.io, checked on 2026-10-07). It depends on tauri 2 and works with the pinned tauri 2.12.1. The 3.0.0-alpha releases are pre-release and are not used.

The Blueprint input devices slice (BP-06, 2026-10-18) uses gilrs 0.11.2 (Apache-2.0 or MIT, Rust 1.84) for gamepads and midir 0.11.1 (MIT; coremidi 0.9.2 on macOS, Rust 1.75) for MIDI input. Both are target dependencies for macOS and Windows only, so a Linux build needs no udev or ALSA headers. gilrs uses its default `wgi` feature (Windows.Gaming.Input). Both were the newest stable releases on crates.io on 2026-10-18.
