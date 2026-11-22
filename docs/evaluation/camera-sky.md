# Camera sky check

Date: 2026-11-22. Contract: [camera sky](../../spdd/prompt/2026-11-22-camera-sky.md). Issues: #148 (ENV-02 sky subset), #40.

## Automated evidence

Platform: local macOS worktree. Rust via `direnv exec .`.

| Check | Result |
| --- | --- |
| CameraSky schema and `setCameraSky` (TS + Rust + vectors) | PASS (`packages/contracts`, `cargo test -p opensekai-contracts`) |
| Session applies / clears / rejects the op | PASS (`packages/session/test/camera-sky-patch.test.ts`) |
| HDR host parse (`#?RADIANCE` / `#?RGBE`) and stage | PASS (`cargo test -p opensekai-desktop --lib assets::hdr`) |
| `applySky` / `clearSky` / `saveSky` / `restoreSky` / `skyNeedsTexture` | PASS (`packages/renderer/test/sky.test.ts`) |
| Submit path restores background after draw; environment mock gets `clearIbl` | PASS (`packages/renderer/test/environment.test.ts`) |
| Assist `sky_set` intent registered | PASS (`packages/assist/test/intents.test.ts`) |

## Renderer notes

- Background uses three.js `Scene.background` with `backgroundIntensity` / `backgroundBlurriness`.
- HDR loads with `HDRLoader` (not `RGBELoader`).
- IBL uses `PMREMGenerator.fromEquirectangular` or `ColorEnvironment` + `fromScene` on environment/prop material copies only. `scene.environment` stays null.

## Not verified in this run

- macOS Editor + OBS captures for none / color / image / HDR / transparent restore.
- WebGL 2 and Windows.
- Live HDR import dialog UX on macOS.

## Gaps

Ultra HDR and EXR stay out of this slice. Character MToon IBL stays for a later Ambient Lighting Source slice.
