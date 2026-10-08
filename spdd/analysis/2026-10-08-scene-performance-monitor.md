# Scene performance monitor analysis

The Scene window renders evaluated preview frames through a bounded 15 Hz pump. Operators need a quick measure while they tune scenes for live output. The existing frame acknowledgment reports CPU submission time but does not provide a visible trend. A stats.js overlay can show the preview's completed-frame rate and submission duration without changing the renderer or native protocol.

The monitor belongs to the Scene window. The separate transparent OBS output must stay free of UI. The control should default to off, remember the operator's choice locally, and stop measurement when hidden. A frame begins immediately before preview `applyFrame` and ends when that promise settles. This measures the preview submission path, including occasional asset loading. It does not measure GPU execution or OBS frame rate. The built-in memory panel can be unavailable in WKWebView.

The 15 Hz pump caps the preview by design. Its FPS value cannot be used as the concert or output FPS benchmark. The overlay is a development aid; output performance still needs separate benchmark evidence.
