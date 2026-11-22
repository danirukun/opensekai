# Environment file lights check

Date: 2026-11-22. Contract: [environment file lights](../../spdd/prompt/2026-11-22-environment-file-lights.md). Issue: #39 (ENV-01 gap B).

## Automated evidence

Platform: local macOS worktree. Node/pnpm as in the workspace; Rust via `direnv exec .`.

| Check | Result |
| --- | --- |
| Contracts accept `allowLightsToAffectCharacters` and `setEnvironmentLighting` | PASS (`packages/contracts/test/environment.test.ts`) |
| Session applies and rejects the op | PASS (`packages/session/test/environment-patch.test.ts`) |
| Shared validation vectors for the op and scenes | PASS (`fixtures/protocol/validation-vectors.json`; `cargo test -p opensekai-contracts`) |
| Packer keeps `KHR_lights_punctual`; rejects more than 8 punctual lights; accepts 8 | PASS (`direnv exec . cargo test -p opensekai-desktop --lib assets::scene_import`) |
| `collectFileLights` / `capFileLightShadows` (max 2) | PASS (`packages/renderer/test/scene-lights.test.ts`) |
| Signature and node rebuild when file lights appear or the flag flips | PASS (same file) |

## Not verified in this run

- macOS / OBS look of an imported environment that carries punctual lights (needs a re-imported sample with `KHR_lights_punctual`).
- WebGL 2 and Windows.
- Cost of file-light shadows on a real GPU.

## Gaps for operators

Library GLBs packed before this slice have no file lights. Re-import the source glTF or zip to keep punctual lights under the 8-light and 2-shadow caps.
