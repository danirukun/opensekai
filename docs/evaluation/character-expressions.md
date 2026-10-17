# Character expressions: Linux cloud check

Date: 2026-10-17. Contract: [character expressions](../../spdd/prompt/2026-10-10-character-expressions.md). Platform: Linux cloud (Ubuntu x86_64, no GPU), headless Chromium 1194 from `/opt/pw-browsers`. No renderer and no OBS were used.

## What was checked

A temporary Vite page mounted the real `AvatarExpressionFields` component inside the Inspector panel classes (`properties-column`, `inspector`). It used a real session (`createSession`) with the smoke scene and a record with the expression names of the pinned fixture VRM plus one custom expression `Wink`. The page advanced the session every 16 ms. The page was removed after the check.

| Step | Result |
| --- | --- |
| Group rows | `angry`, `happy`, `relaxed`, `sad`, `surprised`, `Wink`. Tracked names (`aa`, `blink`) are absent. |
| Switch `happy` on | Pose weight 0.56 after about 0.2 s, 1 after about 0.6 s (fade 0.4 s). |
| Switch `sad` on (same layer 0) | `happy` switch clears; pose `{"sad":1}` after 0.7 s. |
| `Wink` settings: Fade 1.5, Mouth on | Scene avatar `expressions` = `{"Wink":{"layer":1,"fadeSeconds":1.5,"suppress":{"blink":false,"mouth":true,"brow":false}}}`. |
| Reset | The `expressions` key is removed; Fade shows 0.4 again. |
| Name column width (Inspector panel classes, 300 px column) | 217 px for each row after the row layout change in response to the owner report on #178. |
| Page errors | One 404 for a missing favicon. No script error. |

![Expressions group with the Wink settings open](character-expressions/inspector-group-linux.png)

## Row layout change

The owner reported on #178 that the macOS editor did not show the expression names. The first layout put each row in a grid and set `display: contents` on a `<details>` element. WebKit, which the macOS app uses, does not handle that case reliably. The rows now use a flex line and a disclosure button. The macOS editor then showed the names (see the next section).

## Expression list of a perfect sync model

The owner then reported on #178 that the macOS editor listed only two-letter names. The model (a VRM 0.x perfect sync model with 83 blendshape groups) has the presets, ten OVR visemes (`SIL` to `TH`), and 52 ARKit clips before its modeler clips. The first importer kept the first 64 names, then the editor removed the tracked names. Only the visemes stayed, and the modeler clips were lost. The importer now drops the tracked names (R3, with the OVR visemes) before the 64-name limit, as Warudo imports every VRM expression. The library reads a stored list again when it has a tracked name.

On macOS, the library load rebuilt the stored record of that model to `angry, sad, Smug, Nightmare, Blush, EyeSwirl, EyeHearts, EyeStars, WingFlap, relaxed, happy, ToggleShirt, ToggleHat`. The Inspector of the macOS editor showed these 13 rows. The custom clips got layers 1 to 9 in record order (`ToggleHat` on layer 9), and switching `ToggleHat` on worked.

## Not checked

The fade on a real VRM in the renderer, OBS output, live face tracking, the Blueprint node fields in the Rete editor, and show save and open. These are local acceptance steps in the pull request.
