# Warudo editor interaction check

Date: 2026-10-03. Release source: ce6bccb4ab5bff2a2075ffe04a96b8a9727b2a96. This check covers the first Warudo-style editor slice on macOS.

## Structure and controls

The app has separate Scene and Editor windows. The Scene owns the worker and preview renderer. The Editor has a narrow navigation rail, a searchable Assets list and a property panel. It uses a light theme and shared Oshi Button/Input controls. Assets, Output and Resources have working panels. Graph editing, asset creation/import and complete Warudo property coverage remain future work.

Objects support preview selection and Move/Rotate/Scale tools with W/E/R shortcuts. Properties support numeric input, horizontal label scrubbing, reset and visibility. Panel borders support dragging and keyboard adjustment. Context menus support tools, reset, visibility and camera selection, with keyboard navigation and focus return. The editor close button hides its window; the Scene Editor button reopens it. Resources retains unsupported renderer warnings and licenses.

One gesture commits with its starting revision. Changed revisions reject stale edits. Only preview_main can display helpers; output_main cannot enable them. The secondary editor receives no publisher connection or shutdown authority. UI events contain small validated selection/tool/draft messages, with drafts limited to 20 sends per second.

## Source checks

At the final source, 231 JavaScript unit tests in 32 files passed. Workspace TypeScript/Svelte checks passed with zero Svelte errors or warnings. The native window lane passed 17 library tests and strict desktop all-target Clippy. Independent source review approved the integrated changes. A separate model review approved the scoped visual packet with the freshness and cancellation limits below; no provider model ID was observable. The release was rebuilt with current source metadata and launched outside the checkout.

The bundle build still reports the existing three-vrm TSL import and chunk-size warnings. Spring-bone and node-constraint simulation remain unsupported. The final Resources panel shows these warnings.

## Actual UI and OBS checks

The normal two-window release at 68b9293 mounted all nine transform inputs. A typed Position X value of 1.25 survived background refresh before Apply. Apply changed revision 0 to 1. A 50-pixel X scrub committed X=1.75 at revision 2. Position reset committed at revision 3. Rotation and scale scrubs produced 30 degrees and Scale X=1.4. Invalid Scale X=0 was rejected without changing revision 6. Rotation and scale resets returned to the authoritative values.

Right-click asset menus opened. Arrow keys and Enter selected Rotate. Dragging the asset/property border changed its width from 224 to 274 pixels; keyboard adjustment changed it to 264. Editor hide/reopen retained selection and panel width. The actual Copy OBS URL control returned Copied; a private clipboard comparison matched the renderer descriptor. The comparison passed again at the final ce6bccb release. No URL or bearer token is stored in this report.

Computer Use could not reliably target a pointer gesture in the Scene while both windows existed. A temporary scene-only evaluation configuration therefore tested the same 68b9293 interaction source. Actual raycast selection and released gizmo gestures committed one revision each: Move X=1.0748323735731562 at revision 1; Rotate quaternion [0,0,0.6517547140073209,0.7584298205959701] at revision 2; Scale X=1.5154497868467012 at revision 3. Shipping window configuration was preserved and restored for the final build.

A separate temporary 620-by-560 editor configuration showed all nine fields and Apply without clipping. A camera context menu selected camera_close for both outputs. Escape dismissed the menu and returned focus. The exact temporary configurations are indexed with the images.

UI capture pairs have matching session/camera/revision and nearby ticks. OBS images precede native images by 3–6 ticks and 4–5 sequences. These pairs support visual comparisons, not the strict native-before-OBS timing gate. Saved Scene images show the gizmo; sampled production output images have no helper overlay. The formal rendering probe uses its separate registered capture and strict marker checks.

Active Escape cancellation while a pointer stayed down was not established live. The automation serialized the key after release; a concurrent attempt closed the Computer Use pipe. Those attempt states are retained and are not passing cancellation evidence. Functional tests cover active versus idle Escape and cancellation without a commit.

## Final rendering regression

The final normal two-window ce6bccb release passed the targeted WebGPU smoke timing gates on the M3 Pro host: 30 seconds warmup and 120 seconds measurement. Run 93220149-628e-4bc7-bc90-5f8081192698 collected 7197 samples without truncation. CPU p95 was 2.90 ms, maximum ACK interval was 89 ms, and stale output periods were zero. OBS reported 0/7225 render skips across 120409 ms. Minimize was issued/completed at 60002/61314 ms; restore was issued/completed at 105001/105804 ms. The Scene stayed minimized for about 44 seconds; the Editor was hidden. Registered manifests identify the exact source and match all resource bytes/hashes. Strict formal marker checks passed. Owned OBS scene/input cleanup completed and restored the prior program scene.

Two earlier final-source runs are retained. Run 345937f9 had no valid minimized phase and a 24 ms maximum interval. Run 0f2d3e66 also had no valid minimized phase and failed the 100 ms stall gate with a 206 ms maximum interval. Computer Use reconnection and missed scheduling occurred during those attempts; the evidence does not establish the cause of that stall. The final synchronized run passed, but one passing repeat does not prove the absence of occasional scheduler stalls.

This is a targeted UI regression check, not a new full two-backend qualification, minimized recording or soak. GPU timing remains unknown. The 14394 warning observations repeat the two known unsupported simulation warnings. Existing earlier recording/soak evidence retains its source attribution.

## Evidence and remaining scope

[warudo-editor-evidence.json](warudo-editor-evidence.json) indexes local files by path, bytes and SHA-256. Large images and state files remain in ignored artifacts/evaluation. The 68b9293 normal, scene-only and compact evidence is separate from the final ce6bccb rendering evidence. The final source adds renderer warning merging to the previously verified interaction code.

This slice does not establish full Warudo UI or feature parity. Groups, entity CRUD, complete property types, blueprints, undo/redo and saved layouts remain open. Windows, mobile, M1 minimum hardware and the concert hall target remain unverified. The older two-backend timing, recording and soak retain their original source attribution in [macOS results](macOS-feasibility/results.md).
