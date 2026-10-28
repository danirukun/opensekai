# Preview off check

Checked 2026-10-28 on macOS 27.0.1, branch `spike/bonnie-warudo-scene`. Contract: [preview off](../../spdd/prompt/2026-10-28-preview-off.md).

## Why

In the Bonnie scene, the Scene preview used 19 to 27 ms of CPU time for each frame (`preview_main` `cpuMs` in MCP `app_status`). `output_main` used 2 to 7 ms. While the preview rendered, both outputs ran at 44 to 54 FPS. These numbers come from about 10 samples in each run. They are not a benchmark.

## Results

| Check | Result |
| --- | --- |
| `pnpm exec vitest run --project unit apps/desktop/test/preview-pump.test.ts` | PASS. 8 tests: 3 old, 5 new (disabled pump, re-enable, wake hold, double release, no overlap in any order, stop) |
| `pnpm --filter @opensekai/desktop check` | PASS. 0 errors, 0 warnings |
| Toggle in the running app (`pnpm dev:desktop`, evaluation mode, WKWebView) | PASS. The maintainer turned the preview off and on with the Bonnie show open and reported that it works |

## Not checked

- Frame rate and CPU time with the preview off. They are unknown.
- MCP `camera_screenshot` while the preview is off.
- The OBS output while the preview is off.
- The accessible name. The `@oshi-connect/ui` `Button` does not accept `aria-pressed`, so the title and the screen-reader text name the action (**Turn off preview** or **Turn on preview**).
