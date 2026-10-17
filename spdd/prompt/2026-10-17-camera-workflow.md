# REASONS: Camera workflow

Date: 2026-10-17. Scope: bundle B7 (#49 CAM-01 first subset, #50 CAM-02 first, #53 CAM-05 first evaluation path). Analysis: [camera workflow](../analysis/2026-10-17-camera-workflow.md). Related: [camera frame](2026-10-04-camera-frame.md), [quality controls](2026-10-16-quality-controls.md).

This file is the contract only. The implementation run starts after the owner merges it. The [Warudo Camera](https://docs.warudo.app/docs/assets/camera) page was read on 2026-10-17. It names the control modes, Focus Character, Control Sensitivity, the 8-camera limit, and Tab / Ctrl+Tab. It does not give key bindings, speeds, zoom limits, the orbit height, or the screenshot folder; those come from the UI audit 0.15.1 lines or are OpenSekai choices.

## R — Requirements

### Navigation (CAM-01)

R1. A camera entity has an optional `navigation` field: `{ mode: 'none' }`, `{ mode: 'freeLook', sensitivity }`, or `{ mode: 'orbitCharacter', sensitivity, targetId: Id | null, pivotOffset: Vec3 }`. `sensitivity` is Warudo's Control Sensitivity: a finite number from 0.1 to 10, default 1. A missing field means `none`. TypeScript and Rust accept the field and omit it when it is missing. A show without the field loads without change.
R2. The `SceneViewSchema` reference rule rejects an `orbitCharacter` camera whose `targetId` is not `null` and does not name an avatar entity in the scene. Thus `scenePatch` (including `createEntity`), `sceneReplace`, and show load all reject it. Each `pivotOffset` component is finite and within ±1000 m.
R3. The patch operation `{ kind: 'setCameraNavigation', entityId, navigation }` sets the field. It fails with `INVALID_INPUT` for an entity that is not a camera and with `NOT_FOUND` for an unknown entity. It goes through the normal patch route. MCP reaches it through `scene_patch`. `removeEntity` of an avatar sets `targetId` to `null` on each camera that names it, in the same operation. Duplicate copies `navigation` without change.
R4. **None.** The viewport does not move the camera. Selection and gizmos work as today.
R5. **Free Look.** While the right mouse button is down on the viewport canvas (the canvas holds pointer capture): mouse motion turns the camera (yaw around world up, pitch around the camera right axis, pitch clamped to ±89°, no roll). W and S move along the camera forward axis, A and D along the right axis, E up and Q down along world up. The speed is 2 m/s × `sensitivity`, and Shift multiplies it by 3. The turn rate is 0.2° for each pixel × `sensitivity`. Keys have no effect when the right button is up or the canvas does not have focus. Window blur and loss of pointer capture clear the key state and end the gesture.
R6. **Orbit Character.** The pivot is the target avatar root position plus `pivotOffset`, or `pivotOffset` alone when `targetId` is `null`. A left or right button drag rotates the camera around the pivot at a constant distance (yaw around world up, pitch clamped to ±89°, 0.3° for each pixel × `sensitivity`). The wheel changes the distance by a factor of 1.1 for each wheel step, clamped to 0.2–50 m. A middle button drag pans: it moves the camera and the pivot in the camera view plane, and it changes `pivotOffset` by the same amount. The camera always looks at the pivot.
R7. A left button press that hits a gizmo handle starts a gizmo drag, as today. A press and release with 4 px of motion or less is a click (the current `editor-viewport.ts` threshold), and a left click selects as today. In Orbit Character, a left button drag of more than 4 px orbits. A right button drag of more than 4 px does not open the viewport context menu; a right click still opens it. While a navigation gesture runs, the gizmo is detached from the camera.
R8. A navigation gesture keeps a local draft of the camera transform. During the gesture, the editor sends one `setTransform` patch at most every 100 ms, and only after the reply to the previous one. At the end of the gesture (button release, loss of pointer capture, window blur, or wheel idle for 150 ms), it sends the last `setTransform`. For a pan, each commit is one `scenePatch` with `setTransform` and `setCameraNavigation` together, so the transform and `pivotOffset` change in one revision. Each commit uses the revision that the previous commit returned. When the scene revision differs from that value (another edit came from the Inspector, MCP, or a Blueprint), the other edit wins: the gesture ends without a commit and shows the scene value. A `CONFLICT` or other failure ends the gesture the same way. Each patch uses the normal route ([command path](../../ARCHITECTURE.md#command-path)).
R9. Navigation acts only on the camera that `preview_main` draws, and only in the editor viewport. It is off while a patch is pending from a gizmo drag or another edit.
R10. The Inspector shows a Control Mode select (None, Free Look, Orbit Character) for a camera, and a Control Sensitivity number field for Free Look and Orbit Character. For Orbit Character it shows a Focus Character select (the avatar entities and None). A rejected change shows the scene value again.
R11. A camera that the editor adds gets `{ mode: 'freeLook', sensitivity: 1 }`, because Free Look is the Warudo default. A change to Orbit Character in the Inspector sets `targetId` to the first avatar ID (or `null`) and `pivotOffset` to `[0, 1.3, 0]`.

### Selection (CAM-02)

R12. The selection paths stay as they are: Hierarchy row button, Hierarchy menu item, Output panel Camera select, and MCP `camera_select`. No new call. As in Warudo, Tab selects the next camera and Ctrl+Tab the previous camera (scene entity order, with wrap) through `model.selectCamera`. The keys act only while the viewport canvas has focus, so Tab still moves focus in the panels.
R12a. A scene holds at most 8 cameras, as in Warudo. The `SceneViewSchema` budget rule rejects a ninth camera, and the Add menu disables Camera at 8, as it does for Character at 2.
R13. A session test (`packages/session`, through the same session API that the host relay calls) makes a scene with two cameras and selects each one with `cameraSelect` for `output_main` and `preview_main`. It checks that the next runtime frame names the selected camera for each output, that the tick continues, and that removal of a camera that an output uses fails. A renderer test applies the two frames and checks that each `FrameApplied.cameraId` names the selected camera.

### Screenshots (CAM-05)

R14. A new operator call `cameraScreenshot { cameraId, expectedRevision }` returns `{ fileName, width, height, bytes, sha256, cameraId, revision }`. `fileName` is the file name only, never the full path. It needs the `Edit` capability, because the normal editor and MCP have `Edit` and `Capture` exists only in evaluation mode. MCP exposes it as `camera_screenshot`. It fails with `NOT_FOUND` when the camera does not exist, `CONFLICT` when the revision differs, `UNAVAILABLE` when no `preview_main` renderer is connected, `RATE_LIMITED` when the last screenshot of any client was less than 1 s ago (one host-wide limit), and `STALE_FRAME` when the reply names another session or revision.
R15. The host relays the call to the renderer client registered for `preview_main` (the Scene window; the host already keeps one renderer for each output ID) as a `screenshotRequest` wire message. The renderer waits until it has applied a frame with `expectedRevision`. It renders one frame of the given camera to an offscreen render target at 1920 × 1080 with a transparent clear color. The render uses the given camera's own lens, `renderEnvironment`, and `antiAliasing`, not those of the output camera. It does not draw the diagnostic marker, the editor gizmos, or the camera frame overlay. It reads the pixels once, encodes a PNG, and replies with a `screenshotReply` JSON message that carries `{ sessionId, revision, cameraId, width, height, pngBase64 }`, as `captureReply` does. The relay timeout is 5000 ms (`LIMITS.screenshotTimeoutMs`), not the 2000 ms call timeout. The preview frame loop continues.
R16. The PNG limit for a screenshot is 8 MiB (`LIMITS.screenshotPngBytes`), and the `screenshotReply` message limit is 12 MiB (`LIMITS.screenshotEnvelopeBytes`) for base64 and metadata. A larger image fails with `INVALID_INPUT`. The Rust WebSocket limit for a renderer connection rises to the envelope limit. Each other message kind keeps its own size check. The diagnostic `pngBytes` and `captureEnvelopeBytes` limits do not change. The implementation run measures the PNG size and encode time of the smoke scene and records them; if a typical PNG is above 4 MiB, it stops and asks the owner before it raises the limit.
R17. The host checks the PNG signature, the IHDR size (1920 × 1080), and the byte limit. Then it writes the file to `<app local data>/screenshots/<UTC yyyyMMdd-HHmmss-SSS>-<camera part>.png`. The camera part keeps only `[A-Za-z0-9_-]` from the camera ID, at most 64 characters. The host opens the file with create-new. When the name exists, it adds `-1` to `-9`; after that it fails with `BUSY`. The frontend and MCP never send a path.
R18. The camera Inspector has a Take Screenshot button and an Open Screenshots Folder button. Take Screenshot calls `cameraScreenshot` for the selected camera. Open Screenshots Folder calls an editor-only Tauri command, `open_screenshots_folder`, that takes no arguments, creates the folder if needed, and opens it with the Rust API of `tauri-plugin-opener`. The frontend gets no `opener:` permission.
R19. No screenshot data goes through Tauri IPC. The OBS output path does not change.

### Documents

R20. `docs/warudo-parity.md` records only the verified subset. CAM-01, CAM-02, and CAM-05 stay unchecked until the owner verifies the macOS and OBS parts. `ARCHITECTURE.md` gets the screenshot data path and the new folder.

## E — Entities

- `CameraNavigation = { mode: 'none' } | { mode: 'freeLook'; sensitivity: number } | { mode: 'orbitCharacter'; sensitivity: number; targetId: Id | null; pivotOffset: Vec3 }`. Camera entity: `navigation?: CameraNavigation`.
- Patch operation `setCameraNavigation`. Rust: `PatchOp::SetCameraNavigation`, `SceneEntity::Camera { navigation: Option<CameraNavigation> }`.
- `CameraScreenshotParams = { cameraId: Id; expectedRevision: number }`. `CameraScreenshotResult = { fileName: string; width: 1920; height: 1080; bytes: number; sha256: string; cameraId: Id; revision: number }`.
- Wire messages `screenshotRequest { requestId, params }` and `screenshotReply { requestId, result }` (binary envelope, as `captureReply`).
- `LIMITS.screenshotPngBytes = 8388608`, `LIMITS.screenshotEnvelopeBytes = 12582912`, `LIMITS.screenshotTimeoutMs = 5000`.
- Wire message `screenshotReply` result: `{ sessionId, revision, cameraId, width: 1920, height: 1080, pngBase64 }`.
- Pure navigation state for the math: `{ position: Vec3; yaw: number; pitch: number }` for Free Look and `{ pivot: Vec3; distance: number; yaw: number; pitch: number }` for Orbit Character.

## A — Approach

Add the contracts first in TypeScript and Rust with shared vectors. Then add the session operation and the removal rule. Then write the navigation math as pure functions with unit tests, and connect it to the editor viewport input. Then add the screenshot call: host relay and file write, renderer one-shot render, and the editor and MCP entries. Check the navigation and the screenshot in headless Chromium where WebGL 2 works. Leave the macOS and OBS checks to the owner.

## S — Structure

- `packages/contracts/src/schema.ts` (entity, refine, patch operation, call method list, `ParamSchemas`, `ResultSchemas`, wire messages, limits), `types.ts`, `index.ts`; `packages/contracts/test/camera-navigation.test.ts` (new).
- `crates/contracts/src/lib.rs` (types, call validation, result validation); `crates/contracts/tests/camera.rs` (new); `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/scene-ops.ts`; `packages/session/test/camera-navigation-patch.test.ts` (new).
- `packages/renderer/src/camera-navigation.ts` (new, pure math), `editor-viewport.ts` (input and gesture), `screenshot.ts` (new, one-shot render and PNG), `renderer.ts`; renderer tests.
- `packages/browser-client` (screenshot request handler); `apps/desktop/src/bootstrap.ts` (Scene window handler).
- `apps/desktop/src-tauri/src/service/router.rs` (capability map, relay, `validate_result`), `service/mod.rs` (renderer socket limit, `screenshotReply` handling), `src/screenshots.rs` (new: validation, file name, file write), `src/lib.rs` (`open_screenshots_folder`, opener plugin registration), `Cargo.toml`; `apps/desktop/src-tauri/tests/service_integration.rs`.
- `apps/desktop/src/editor/model.ts`, `editor/authoring.ts`, `components/Inspector.svelte`, `components/CameraNavigationFields.svelte` (new); desktop tests.
- `apps/mcp/src/tools.ts` (`toolMethods` and tool schema); MCP tests.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/camera-workflow.md` (new).

## O — Operations

1. Contracts: `CameraNavigation`, the camera field, the scene rule (R2), `setCameraNavigation`, `cameraScreenshot` params and result, the two wire messages, and the limits. Rust mirror. Vectors: a camera with each mode, a camera without the field, an unknown target (reject), a non-avatar target (reject), the patch operation, and a screenshot result.
2. Session: apply `setCameraNavigation`. Clear `targetId` on avatar removal.
3. Navigation math in `camera-navigation.ts`: `freeLookStep(state, input, dt)`, `orbitDrag(state, dx, dy)`, `orbitZoom(state, steps)`, `orbitPan(state, dx, dy, viewHeight)`, `transformFromFreeLook`, `transformFromOrbit`, and `orbitFromTransform` (to start a gesture from the current transform). Unit tests for each clamp and for a round trip.
4. Editor viewport: pointer, wheel, and key handlers, the click threshold (R7), the gesture draft, and the throttled commits (R8). `EditorOptions` gets `onNavigate(edit)` that returns the patch reply.
5. Editor: `model.setCameraNavigation`, the Inspector fields (R10), the add default (R11), Tab and Ctrl+Tab (R12), the camera limit in the Add menu (R12a), and the screenshot buttons (R18).
6. Screenshot: host relay to the `preview_main` renderer, rate limit, validation, and file write. Renderer one-shot render and PNG encode. MCP `camera_screenshot`.
7. Tests for two-camera selection (R13). An integration test in `service_integration.rs` for `cameraScreenshot` with a fake `preview_main` renderer client at the WebSocket boundary: relay, timeout, stale reply, oversize reply, rate limit, file name, and no overwrite.
8. Documents: `docs/evaluation/camera-workflow.md` with the commit, platform, backend, each check and its raw result, the PNG size and encode time, and the gaps; parity rows for CAM-01, CAM-02, and CAM-05 with the verified subset only; `ARCHITECTURE.md` screenshot path.

## N — Norms

- Unit tests for the navigation math, the schemas, the patch operation, the removal rule, the Rust mirror, and the PNG validation. Shared vectors keep TypeScript and Rust equal.
- Integration tests at the WebSocket boundary for camera selection and for the screenshot relay and file write, because these cross a process and file boundary.
- A headless Chromium check of the editor viewport: each mode moves or does not move the camera as R4–R7 say, and the patches arrive at the expected rate. A headless check of the screenshot PNG: 1920 × 1080, background alpha 0.
- UI copy is the control label only (constitution principle 1). Controls come from `@oshi-connect/ui`.
- Functional TypeScript and plain data. The navigation math has no three.js object state.

## S — Safeguards

- Do not change the show file version or require the new field. A camera without `navigation` keeps today's behavior.
- Do not send a patch for each pointer event. Keep the 100 ms throttle and wait for each reply.
- Do not read images back in the OBS output path. The screenshot is a one-shot render in the Scene window and goes to the host over the WebSocket, not through Tauri IPC.
- Do not take a file path from the frontend or from MCP. The host makes the path.
- Do not claim a macOS, OBS, or GPU result. These stay for the owner: navigation feel in each mode on macOS, OBS following the camera during a gesture at about 10 Hz, a camera cut in OBS with continued motion while the editor is minimized, the screenshot alpha over a checker background, the screenshot frame cost in the Scene window, and Open Screenshots Folder in Finder.
