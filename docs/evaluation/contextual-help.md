# Contextual help check

Checked 2026-11-17 on macOS 27.2 (Apple silicon) with the Editor window build in headless Chromium (Playwright). The source is the commit that adds this page, on base `435dc3f`. Contract: [contextual help](../../spdd/prompt/2026-11-16-b40a-help.md).

Method. [`editor-check.mjs`](contextual-help/editor-check.mjs) serves `apps/desktop/dist` and a stand-in for the Tauri host on port 4186. The stand-in `invoke` records each `open_help` call and its arguments. The check clicks each Help button and reads the topic that the button sent. It does not open a browser. Raw output: [editor-check.txt](contextual-help/editor-check.txt).

```
pnpm --filter @opensekai/desktop build
pnpm exec tsx docs/evaluation/contextual-help/editor-check.mjs docs/evaluation/contextual-help/out
```

## Results

| Panel | Requirement | Topic sent | Result |
| --- | --- | --- | --- |
| Start screen | R4 | `gettingStarted` | PASS |
| Properties, no selection | R3 | `scene` | PASS |
| Hierarchy | R1 | `scene` | PASS |
| Scene toolbar | R1 | `scene` | PASS |
| Properties, light selected | R3 | `light` | PASS |
| Properties, character selected | R3 | `character` | PASS |
| Tracking guide | R1 | `motionCapture` | PASS |
| Output | R1 | `output` | PASS |
| Blueprints | R1 | `blueprints` | PASS |
| Resources | R1 | `resources` | PASS |
| Settings | R1 | `settings` | PASS |
| Settings, rejected open | R6 | `settings` | PASS. The toast "Could not open help" showed. |

Each call had only the `topic` argument (R5). 27 of 27 checks passed.

Screenshots: [start screen](contextual-help/out/start-screen.png), [Properties with a light](contextual-help/out/editor-properties-light.png), [tracking guide](contextual-help/out/editor-tracking-guide.png), [Settings](contextual-help/out/editor-settings.png).

The Rust tests in `apps/desktop/src-tauri/src/help.rs` check the host side: each fixture topic parses, an unknown name gives `INVALID_INPUT` "Unknown help topic", each URL starts with the handbook prefix, and each page and anchor heading exists in `docs/handbook/`. `main_capability_has_the_exact_permission_list` lists `allow-open-help` and asserts that the window has no `opener:` permission. `apps/desktop/test/help.test.ts` checks the TypeScript topic list against the same fixture and the topic of each entity kind.

## Not verified

- The browser open in the Tauri app on macOS (`open_help` through the opener plugin). This needs the owner's local check: click Help on the start screen and on 3 panels, and confirm that the default browser opens the matching handbook page.
- The `UNAVAILABLE` "Help unavailable" path in the real host.
- Windows and Linux.
- In 2 of 5 runs, headless Chromium reported the page error "Instance dropped in popErrorScope" from the WebGPU renderer, and the "no page error" check failed. The Help checks passed in each run. The error does not come from the Help code.
