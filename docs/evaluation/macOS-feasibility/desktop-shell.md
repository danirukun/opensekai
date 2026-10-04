# macOS desktop shell check

Observed: 2026-10-03. Source checkpoints: 58b7955 and b0cd4fb. Task review approved the correction.

The debug OpenSekai.app bundle launched on the development Mac. Computer-use inspected the actual WKWebView at tauri://localhost. The native app_version command returned 0.1.0. The shared Input accepted Smoke scene. The Check version button returned 0.1.0 without a visible error. The native minimize control and window Raise action were exercised. The restored window kept its input value. This is a window smoke check; it does not prove background simulation or output timing.

The initial screenshot showed an unreadable input label. Task review traced this to the shared kit's default light theme. The correction enables the dark theme and semantic color tokens. The rebuilt bundled app has a readable label and input.

The worker reported three passing file-boundary tests, strict TypeScript/Svelte checks, a frozen install, frontend builds, Rust compilation tests, formatting, and debug app packaging. Empty unit and Rust shells do not count as feature tests. See the committed dependency record for compiler compatibility and the ignored task report for command output.

No renderer, session, OBS output, MCP, tracking, or performance gate was tested by this checkpoint. OBS remained idle and its settings were not changed. All related parity boxes remain unchecked.
