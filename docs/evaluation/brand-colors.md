# Brand color tokens

The shots below are a headless Chrome render of the editor chrome. The page uses the classes and the rules in `apps/desktop/src/app.css`. It is not the Tauri window. The UI kit was not available in this run, so the kit button chrome is not in the shot. The Linux cloud host has no macOS app and no OBS.

Window size: 1440 × 900. Browser: Google Chrome headless.

| View | Before | After |
| --- | --- | --- |
| Rail, scene tree, toolbar, properties pane, footer | [before](brand-colors/before-editor.png) | [after](brand-colors/after-editor.png) |

Before, a selected row and an active tool use a purple fill. After, they use cyan at 40% opacity with navy text. The footer text "Session connected" sits on lime. The rail background is the rail neutral.

Body text contrast is in `apps/desktop/test/brand-tokens.test.ts`. Primary text on the neutral surfaces and on lime is above 4.5:1. Navy on cyan at 40% opacity, over the app, rail, toolbar, and white surfaces, is above 4.5:1.
