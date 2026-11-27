# REASONS: Snow session cover

Analysis: [Snow session cover analysis](../analysis/2026-11-27-snow-cover.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md). This contract is slice 2 of the design.

## R — Requirements

- R1. The session keeps one `cover` value (0 to 1) for the snow entity of the evaluated scene (after overrides and tweens).
- R2. On each advance of `seconds`: while `rate` is above 0, `cover` rises by `rate / buildUpSeconds × seconds`. While `rate` is 0, `cover` falls by `seconds / meltSeconds`. The value stays in 0 to 1.
- R3. `cover` is 0 while `visible` is off. A snow entity with a new id starts at 0, and its first frame does not step it. A show open (`replaceScene`) and a new session start at 0. The value is never saved and does not change the revision.
- R4. Each frame carries `snow: { entityId, cover }` while the evaluated scene has a snow entity, also when `visible` is off. A frame without a snow entity has no `snow` field.
- R5. `RuntimeFrameSchema` and the Rust `RuntimeFrame` accept `snow` as an optional strict object: `entityId` is an id and `cover` is a finite number in 0 to 1. `fixtures/protocol/snow-cover.json` holds the shared valid and invalid vectors, and both sides test them.
- R6. The renderer gives the facade the `cover` of the frame. It uses 0 when the frame has no `snow` field or when the `entityId` is not the id of the drawn snow entity.
- R7. Warm start: the first step of a build-up sets the amount of each vertex to `cover × up × sky`, and sets the previous position. This applies to a new renderer, a reloaded output page, an avatar that loads or reloads while snow settles, and the first step after a clear (`visible` or Settle On Characters on again).
- R8. A spring reset (a teleport) does not warm start. It keeps the amounts and sets the previous position, as before.
- R9. The facade draws the sky pass on a frame where a build-up takes its warm step with `cover` above 0, also at `rate` 0. At `rate` 0 with no warm step, the facade still skips the sky pass.

## E — Entities

- `SnowCover` (contracts): `{ entityId: Id; cover: number }`. The `snow` field of `RuntimeFrame`.
- The session state: `SnowCover | null`.
- `SnowUniforms` (renderer) gets `cover`.

## A — Approach

A pure step in `packages/session/src/snow-cover.ts`, after `spring-resets.ts`: one function takes the state, the evaluated scene, and the seconds, and gives the next state. `advance` calls it and puts the state on the frame. `replaceScene` sets it to null.

In the renderer, `snow-math.ts` gets the pure `warmAmount(cover, up, sky)`. The compute node of `snow-build-up.ts` gets a `warm` uniform: on a warm step it writes the warm amount in place of the step. `clear()` arms the next warm step. The build-up tells the facade when its next step is a warm step, so the facade can draw the sky pass.

## S — Structure

- `packages/contracts/src/schema.ts`, `types.ts`: `SnowCoverSchema`, `SnowCover`, the `snow` field.
- `crates/contracts/src/lib.rs`: `SnowCover`, the `snow` field, its validation.
- `fixtures/protocol/snow-cover.json`: the shared vectors.
- `packages/session/src/snow-cover.ts`: the step. `session.ts`: the wiring.
- `packages/renderer/src/snow-math.ts`: `warmAmount`. `snow-build-up.ts`: the warm step. `snow.ts`: the cover and the sky pass rule. `renderer.ts`: the frame value.
- `ARCHITECTURE.md`: the snow paragraph.

## O — Operations

1. Record the decisions of the analysis in the design.
2. Write failing tests: the shared vectors on the two sides; the session cover (rise, melt, clamp, 0 when hidden, new id, show open, field presence, evaluated rate); `warmAmount`; the facade (the cover reaches the uniform, a warm step after a clear, the sky pass at `rate` 0 for a warm step only).
3. Write the code.
4. Check in the running app and OBS (acceptance evidence 5): the preview and OBS show the same cover after an OBS source reload, with snow that grows and with snow that melts. MCP reads `frame.snow.cover`.
5. Update the design status, the evidence page, the parity checklist, and `ARCHITECTURE.md`.

## N — Norms

Functional TypeScript and plain data. A unit test for each new function behavior. The vectors are the one source for the wire shape. Rust and TypeScript change in one commit.

## S — Safeguards

- No new MCP tool, no new patch operation, and no saved field.
- No change to the build-up rule, the flakes, or the constants of slice 1.
- A frame without a snow entity is the same as before, byte for byte.
- The gate of slice 1 stays open. This slice makes no claim about the cost.
