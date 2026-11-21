# Search field check

Linux cloud container, headless Chromium, software GPU (SwiftShader / llvmpipe). The script is `capture.mjs`. It serves a desktop build and `fixture_vrm_1`.

Before is the build of `main` at `0d9661a`. After is this change. Escape on the asset field clears the text, then blurs the field.

Each field after the change is 34 px tall, with a 4 px radius, a 1 px border, 12 px text, the search icon, and the same focus ring.

| Field | Before | After |
| --- | --- | --- |
| Assets | height 34, radius 5 px, icon | height 34, radius 4 px, icon |
| Node palette | height 34, radius 4 px, no icon, no label | height 34, radius 4 px, icon, label |
| Canvas node menu | height 34, radius 4 px, no icon, no label | height 34, radius 4 px, icon, label |
| Debug properties | height 40, radius 9.75 px, 2 px border, 13 px text, no icon | height 34, radius 4 px, icon |

Shots: `before-assets.png`, `after-assets.png`, `before-nodes.png`, `after-nodes.png`, `before-menu-focus.png`, `after-menu-focus.png`, `before-properties-focus.png`, `after-properties-focus.png`. Focus shots: `before-assets-focus.png`, `after-assets-focus.png`, `before-nodes-focus.png`, `after-nodes-focus.png`.

macOS, OBS, and a real GPU are not checked.
