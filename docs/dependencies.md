# Workspace dependencies

Tool pins: Node 26.10.0, pnpm 12.8.1, Rust 1.93.1. Exact JavaScript pins are in package.json files. Exact Rust pins are in workspace.dependencies. Lockfiles record transitive dependencies.

The integrator approved TypeScript 6.0.3 on 2026-10-03. Published svelte-check 4.7.8 (checked on 2026-11-09) declares TypeScript ^5.0.0 || ^6.0.0. TypeScript 7.0.2 is outside that range. The npm registry lists 6.0.3 as the latest stable 6.x release. Strict engine and peer checks remain enabled.

Metadata sources: https://registry.npmjs.org/<package>/<version> and https://crates.io/api/v1/crates/<crate>/<version>. Checked on 2026-10-03.

| Helper | Exact pin | Required Rust |
| --- | --- | --- |
| tailwindcss / @tailwindcss/vite | 4.3.5 | — |
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

The UI dependency is a generated local dist snapshot. Expected source commit: 348be1eb986ac3f371c425514bb66ef9022f78a8 (kit 0.2.0, with ColorPicker and Button tooltip placements `top`, `bottom`, `bottom-end`, and `right`; branch `feat/button-tooltip`). Run OPENSEKAI_UI_SOURCE=/path/to/oshi-connect-ui node scripts/bootstrap-ui.ts before install in each worktree. `pnpm build` and `pnpm ensure:ui` check that pin and the ColorPicker export; when the snapshot is stale they refresh from `OPENSEKAI_UI_SOURCE` or `../oshi-connect-ui` if that checkout is already on the pin with a built dist. The adapter does not build or modify its source. Snapshot hash and observed source commit are recorded in .local/ui-snapshot.json. The hash does not prove a clean source checkout. The UI kit uses the GNU GPL version 3, the same license as OpenSekai (owner decision, 2026-11-11). The release build clones it from the private `oshi-connect/oshi-connect-ui` repository and bundles the compiled kit. The UI kit repository must contain the GPLv3 license file and the matching `license` field in its `package.json`. A reproducible public package route is still open.

Only esbuild is approved for dependency lifecycle builds. The UI snapshot has no scripts. Generated output lives in apps/desktop/src-tauri/resources/output and is mapped to output in Tauri resources. Native code resolves this from the app resource directory.

Task 2 uses url 2.5.8 as a direct Rust contract dependency. This version was already present in Cargo.lock through native dependencies. Use its WHATWG parser for source URLs and normalized loopback descriptors.

Task 6 uses tauri-plugin-global-shortcut 2.4.0 for native global keystrokes. It is the newest stable 2.x release (crates.io, checked on 2026-10-07). It depends on tauri 2 and works with the pinned tauri 2.12.1. The 3.0.0-alpha releases are pre-release and are not used.

The Blueprint input devices slice (BP-06, 2026-10-18) uses gilrs 0.11.2 (Apache-2.0 or MIT, Rust 1.84) for gamepads and midir 0.11.1 (MIT; coremidi 0.9.2 on macOS, Rust 1.75) for MIDI input. Both are target dependencies for macOS and Windows only, so a Linux build needs no udev or ALSA headers. gilrs uses its default `wgi` feature (Windows.Gaming.Input). Both were the newest stable releases on crates.io on 2026-10-18.

The JavaScript upgrade of 2026-11-09 moves each direct dependency to its latest stable release, except TypeScript (see above). three and @types/three go from 0.180.0 to 0.187.0. @pixiv/three-vrm 3.5.5 is still the latest release, and its MToon node bundle imports `transformedNormalView`, which three r187 removed. `patches/@pixiv__three-vrm@3.5.5.patch` replaces it with `normalView` in `lib/nodes/index.module.js` and `lib/nodes/index.cjs`. In r178 to r186, `transformedNormalView` returned `normalView`, so the shader is the same. The patch is the change of the open upstream pull request pixiv/three-vrm#1890. Remove the patch when a three-vrm release includes that change. @mediapipe/tasks-vision goes from 1.0.1 to 1.2.2. Version 1.2.2 has no `nosimd` WASM files, so `apps/desktop/src/tracking/models.json` lists four WASM files.

The lilToon on WebGPU slice (2026-11-19) uses `@mochiya/three-liltoon` 0.1.9 from the Git fork `github:danirukun/three-liltoon` (branch `webgpu`), pinned to commit 716557bd077748417d7bf9f80d7b9c2a1a14fa23 in `packages/renderer/package.json`. The npm release has only WebGL 2 materials. The fork adds the `webgpu` entry point: a TSL node material (`LilToonNodeMaterial`), the VRM loader hook (`enableLilToonNodeVRM`), and the lighting hooks that `CharacterLilToonMaterial` uses. The fork commits its `dist` build, so the install runs no build script. Its peer dependencies are three `>=0.180.0 <0.190.0` and, optional, @pixiv/three-vrm `>=3.4.0 <4`; this repository resolves them to three 0.187.0 and @pixiv/three-vrm 3.5.5. The package uses the MIT license (copyright 2026 Mochiya). It ports the shading of lilToon (lilxyzw), which also uses the MIT license. Replace the Git pin with an npm release when upstream publishes the WebGPU material.

The multiplayer transport spike (ADR 0001, 2026-11-27) adds `crates/collab-transport` and `apps/relay`. The Rust pins are in workspace.dependencies, except `livekit`, which `crates/collab-transport/Cargo.toml` pins. `livekit` is optional (Cargo feature `livekit`, off by default), so the desktop build does not compile `libwebrtc`. It enables `rustls-tls-webpki-roots`; without a TLS feature, `wss://` signalling fails at run time. On macOS a binary that links it needs the `-ObjC` linker flag. `zip` goes from 9.0.3 to 9.0.4, because the `livekit` dependency tree needs 9.0.4; the desktop build uses the same version. Results: [transport spike](evaluation/transport-spike.md).

| Rust crate | Exact pin | Required Rust | License |
| --- | --- | --- | --- |
| str0m | 0.26.0 | 1.89 | MIT or Apache-2.0 |
| aes-gcm | 0.11.1 | 1.85 | Apache-2.0 or MIT |
| clap | 4.6.10 | 1.85 | MIT or Apache-2.0 |
| thiserror | 2.0.21 | 1.77 | MIT or Apache-2.0 |
| rustls | 0.23.45 | 1.71 | Apache-2.0, ISC, or MIT |
| zip | 9.0.4 | 1.88 | MIT |
| livekit (optional) | 0.12.1 | not declared | Apache-2.0 |

The relay is an Elixir application. `apps/relay/mix.exs` gives the ranges, and `apps/relay/mix.lock` locks these versions: phoenix 1.8.17 (`~> 1.8.0`), bandit 1.15.0 (`~> 1.15.0`), jason 1.4.5 (`~> 1.4`), ex_webrtc 0.18.0 (`~> 0.18.0`), and ex_sctp 0.1.3 (`~> 0.1.3`). `ex_sctp` builds a Rustler NIF, so the relay build needs a Rust toolchain, and the root `Cargo.toml` excludes `apps/relay/deps` from the workspace. The release image uses Elixir 1.18.6 on OTP 27.3.4.20 (`hexpm/elixir`, Debian bookworm).
