# Warudo editor interactions design

The user requests Warudo's UI structure and direct manipulation. Use a separate scene window and editor window. The editor has a narrow navigation rail, asset list and broad property panel. Use a light neutral workspace, compact rows and restrained violet selection. Preserve OpenSekai branding and shared controls.

The scene offers move, rotate and scale tools with W/E/R shortcuts. Dragging is local while active; release submits one revision-checked transform. Escape and lost capture cancel. Properties show the draft. Transform fields have drag labels and reset actions. Asset and scene context menus use the same commands. Panel dividers resize directly with keyboard alternatives.

The scene owns the existing worker and renderer. The editor connects to the same native session through an operator-only bootstrap projection. Tauri events carry small UI selection/draft messages. OBS consumes the existing state stream; it receives neither editor geometry nor an image stream.

User authorization covers implementation, OBS evaluation and copying the output URL. A question about separate versus docked preview was offered. In the absence of an answer, the selected layout follows Warudo's separate windows. The layout can be changed without replacing the command/interaction core.

[Contract](../../../spdd/prompt/2026-10-03-warudo-editor-interactions.md). Sources: [asset editor](https://docs.warudo.app/docs/assets/overview), [scene controls](https://docs.warudo.app/docs/tutorials/getting-started). The official asset-editor screenshot was inspected in Chrome.
