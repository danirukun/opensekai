# Scene performance monitor check

Date: 2026-10-08. Platform: macOS. Scope: UI-11.

The Scene toolbar contains a local performance-monitor toggle. The overlay uses stats.js and receives begin/end calls around each completed preview submission. The toggle defaults to hidden and stores its state in local storage. The monitor DOM is outside the canvas and is not part of the output window.

Source checks passed: `pnpm check` (zero Svelte diagnostics), 412 unit tests, and 9 integration tests. `pnpm build:mac` produced the release app after stale release-mode Rust contract artifacts were cleared. The build reported the existing three-vrm `tslFn` and Sass warnings.

Live macOS interaction is pending. An older OpenSekai instance was running, and automatic review rejected quitting it because it may contain unsaved scene edits. The rebuilt app was not substituted into that session. The toggle, stats.js panel switching, persistence after restart, and clean OBS output therefore remain unverified. Preview FPS was capped by the 15 Hz preview pump. On 2026-10-09 the pump changed to display frames; see [avatar performance](avatar-performance.md). It is not an OBS or concert benchmark, and stats.js does not establish GPU timing in WKWebView.
