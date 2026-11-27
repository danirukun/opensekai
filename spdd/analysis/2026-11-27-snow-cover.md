# Analysis: Snow session cover

Date: 2026-11-27. Scope: slice 2 of the snow design. Contract: [Snow session cover](../prompt/2026-11-27-snow-cover.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md).

## Request

The owner selected slice 2 before the gate of slice 1 closes. The gate is open: it did not fail and it did not pass. Slice 2 changes the session and the frame contract only, and the renderer reads one more uniform. A later change of the renderer approach does not change this slice.

The open finding of the review (2026-11-27): each client keeps its own build-up, so the preview, the OBS output, and a reloaded source can show different cover. The design gives the fix: one session `cover` value on each frame, and a warm start of each new build-up from that value.

## Current state

Each fact was read in the code on 2026-11-27.

- The build-up step reads `rate` from the entity (`packages/renderer/src/snow-build-up.ts`, the `update` compute). Each state buffer starts at amount 0. A reloaded output page starts with no snow.
- `createSnowBuildUp` resets the step on its first call (`started` is false): the speed term is 0 and the previous position is set. The amount does not change in that step, except by the grow term.
- `clear()` sets each amount to 0 at the next step. The facade calls it when `visible` or `settleOnCharacters` goes off. `started` stays true, so the next step after a clear is a reset only because the facade sets `previous` to null.
- The facade skips the sky pass at `rate` 0 (`packages/renderer/src/snow.ts`, `render`). A height target that never drew has height 0, and `skyExposureNode` then gives exposure 1 for each point in the box: no shelter.
- The session frame is built in `advance` (`packages/session/src/session.ts:598`). `screenPlayback` reads the saved scene (`persistent`). `springResets` reads the evaluated scene (`scene`, after overrides and tweens). Both fields are left out when they are empty.
- `replaceScene` (show open) sets each runtime state to its empty value.
- `RuntimeFrameSchema` is a strict object (`packages/contracts/src/schema.ts:577`). The Rust `RuntimeFrame` has `deny_unknown_fields` (`crates/contracts/src/lib.rs:1914`). A host without the new field refuses each frame that has it, so the two sides change in one commit.
- `fixtures/protocol/spring-resets.json` is the model for shared frame vectors. `packages/contracts/test/spring-resets.test.ts` and `crates/contracts/tests/spring_resets.rs` read it.
- `renderer.ts` calls `snow.update(entity, seconds, avatars, casters)` on each applied frame and has the frame.

## Decisions

1. **Evaluated scene.** The cover step reads the snow entity of the evaluated scene. The `snowRate` Blueprint key of slice 5 changes `rate` through a tween, and a fade must move the cover.
2. **Field presence.** The frame has the `snow` field while the evaluated scene has a snow entity, also when `visible` is off (then `cover` is 0). This is different from `screenPlayback`, which is left out when it is empty. Without a snow entity the frame has no `snow` field.
3. **New entity.** A snow entity with a new id starts at 0. The first frame that has it does not step it.
4. **Warm start after a clear.** A build-up that starts again after `clear()` takes the warm start, as a new build-up does. One rule then covers each case: a character that starts to settle shows the session cover. After `visible` goes on again the cover is 0, so nothing changes there. After Settle On Characters goes on again the snow comes back at the cover. The other choice (start from 0) gives a client that reloads later a different cover from the other clients.
5. **Sky pass for a warm start.** The facade draws the sky pass on a frame where a build-up takes its warm step and the cover is above 0, also at `rate` 0. Without the pass the warm step has no shelter.
6. **Renderer fallback.** The renderer uses cover 0 when the frame has no `snow` field or when its `entityId` is not the id of the drawn snow entity. The frame schema does not compare the id with the scene, as the other frame fields do not.
7. **Teleport.** A spring reset (a teleport) does not warm start. It keeps the amounts, as before.

## Risks

- The warm start puts snow on a surface that shed it on another client. The two clients agree again only where the rule grows or melts the snow. The design lists this limit.
- At the cover of a slope the warm amount is `cover × up`, and the grow rule gives the same value on a slope that had no shed. So a warm start agrees with the other clients on each surface that did not shed.
- A pop of snow when Settle On Characters goes on again. This is an edit-time action.
- The cover is a float64 in the session and a float32 uniform in the renderer. The step error is below 1e-7 of the full cover.
