# Character expressions: Linux cloud check

Date: 2026-10-17. Contract: [character expressions](../../spdd/prompt/2026-10-10-character-expressions.md). Platform: Linux cloud (Ubuntu x86_64, no GPU), headless Chromium 1194 from `/opt/pw-browsers`. No renderer and no OBS were used.

## What was checked

A temporary Vite page mounted the real `AvatarExpressionFields` component. It used a real session (`createSession`) with the smoke scene and a record with the expression names of the pinned fixture VRM plus one custom expression `Wink`. The page advanced the session every 16 ms. The page was removed after the check.

| Step | Result |
| --- | --- |
| Group rows | `angry`, `happy`, `relaxed`, `sad`, `surprised`, `Wink`. Tracked names (`aa`, `blink`) are absent. |
| Switch `happy` on | Pose weight 0.56 after about 0.2 s, 1 after about 0.6 s (fade 0.4 s). |
| Switch `sad` on (same layer 0) | `happy` switch clears; pose `{"sad":1}` after 0.7 s. |
| `Wink` settings: Fade 1.5, Mouth on | Scene avatar `expressions` = `{"Wink":{"layer":1,"fadeSeconds":1.5,"suppress":{"blink":false,"mouth":true,"brow":false}}}`. |
| Reset | The `expressions` key is removed; Fade shows 0.4 again. |
| Page errors | One 404 for a missing favicon. No script error. |

![Expressions group with the Wink settings open](character-expressions/inspector-group-linux.png)

## Not checked

The macOS editor, a real VRM in the renderer, OBS output, live face tracking, the Blueprint node fields in the Rete editor, and show save and open. These are local acceptance steps in the pull request.
