# FPS counter analysis

Issue: [#175](https://github.com/danirukun/opensekai/issues/175) (SHOW-06). Queue bundle B19. Mode: contract-first.

## Problem

An operator wants to see the render frame rate on the stream output while a show runs. Warudo 0.15.1 (UI audit, 2026-10-17, Windows 11) has an FPS Counter asset in the Add Asset catalog. The operator adds it to the scene like any other asset, and the counter shows the frame rate as text on the output image.

OpenSekai has a stats.js monitor (UI-11) in the Scene window toolbar. That monitor is an editor diagnostic. It is per user, it is never in the OBS output, and a show file does not hold it. It does not do the job of SHOW-06.

## Existing material

- `packages/contracts/src/schema.ts` defines `SceneEntitySchema` as a discriminated union on `kind` (`mesh`, `avatar`, `tracking`, `environment`, `light`, `haze`, `camera`), the scene budget in `LIMITS` and the `SceneViewSchema` refine, and one patch operation for each settings group (`setHaze`, `setLight`).
- `crates/contracts/src/lib.rs` mirrors each kind and each patch operation. `fixtures/protocol/validation-vectors.json` keeps both sides equal.
- `packages/session/src/scene-ops.ts` applies the patch operations. `packages/contracts/src/property-registry.ts` gives the Blueprint property targets; `visible` applies to the `lit` kinds.
- The haze entity (B9 and the stage lights slice) is the nearest example of a new entity kind with a limit of 1. It touches the editor files `authoring.ts`, `model.ts`, `property-defaults.ts`, `inspector-sections.ts`, `Hierarchy.svelte`, `Inspector.svelte`, and one fields component, and the MCP `scene_patch` description.
- `apps/output/src/main.ts` (OBS page) calls `renderer.applyFrame` for each frame from the host and sends the acknowledgment. There is no `requestAnimationFrame` loop there.
- `apps/desktop/src/bootstrap.ts` (Scene window) runs the preview pump at display rate and renders the newest frame only.
- The Scene preview guides (`GuideOverlay.svelte`) are a DOM overlay over the canvas. OBS captures the Browser Source page, so a DOM element on the OBS page is in the OBS image with alpha.
- `renderer.screenshot` and `renderer.capture` read the canvas. A DOM element is not in their result.

## Handbook recheck

The [Warudo handbook asset list](https://docs.warudo.app/docs/assets/overview) and its sitemap were read on 2026-10-21. The handbook has no FPS Counter page. The UI audit stays the only source. The audit did not record the inspector fields of the asset. Each field below is an OpenSekai choice and is listed as a decision.

## Findings

1. Each renderer client has its own frame rate. The OBS page renders once for each host frame. The Scene preview renders at display rate, newest frame only. One number for the whole app is not true. Each client must measure its own completed frames.
2. The measurement is renderer-local. It is not scene state and must not go to the session, the host, or the show. Only the counter settings (visible, corner, size, color) are scene data.
3. A drawn text in the three.js scene needs a font atlas or a canvas texture on each renderer. It also puts the counter into screenshots and benchmark captures. A DOM element over the canvas costs one text update for each update period and stays out of canvas reads.
4. A rate needs a time window. Before one full window passes, the value is unknown. An unknown value is never shown as zero (AGENTS.md). After a stall, zero frames in a full window is a true value.
5. The output image is 1920 × 1080 and the Scene preview is smaller. A size in CSS pixels looks different in each. A size relative to the output height looks the same in both.
6. A new entity kind changes the show format: an older build rejects a show that holds the new kind. `schemaVersion` stays 1, as for `haze`, because each older show stays valid.

## Questions resolved without the owner (reversible)

- **Scene entity, not a preference.** The counter is an entity of kind `fpsCounter`, saved in the show, as the issue says ("An FPS Counter asset"). Alternative: a per-user toggle like UI-11. Rejected because the issue asks for an asset and the OBS output must show it.
- **Where it draws.** A DOM text element over the canvas on the OBS page and in the Scene window preview. It is not in camera screenshots, `captureFrame`, or benchmark captures. Alternative: a text mesh in the renderer, which would put it in captures and needs a font path.
- **What it measures.** The completed `applyFrame` calls of that renderer client in the last 1000 ms, as a whole number. The text updates each 500 ms. Alternative: the session tick rate. Rejected because the issue asks for the render frame rate.
- **Fields.** Corner (Top Left, Top Right, Bottom Left, Bottom Right; default Top Right), Size (8 to 128, in pixels of a 1080-pixel output; default 32), and Color (default `#ffffff`). Visible and the name come from the entity base. Alternative: a free position in pixels. A corner is enough for a status display and needs no layout check.
- **Transform.** The entity base needs a transform. The counter stores the identity transform and ignores it. The Inspector has no Transform section for it, and the property registry gives it only the `visible` target.
- **Limit.** At most 1 FPS counter in a scene.
- **Text.** "60 FPS" for a value, "-- FPS" while the value is unknown.

## Risks

- A DOM overlay changes the OBS image. The text must keep the alpha of the rest of the page. The cloud cannot prove this. It needs an owner check in OBS (`accept:local`).
- The update timer must not run when no counter is visible, and it must stop when the page closes.
- A text update can cause a layout on each update. One fixed-size element with `tabular-nums` and `position: absolute` keeps the cost to the element.
- An older build cannot open a show with a counter. This is the same as for each new kind. The parity line names it.
