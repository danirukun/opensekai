# Asset management check

Checked 2026-10-04 on macOS release source `dca1d16`. The current asset UI supports Rename, Duplicate and Remove through the sidebar context menu. Rename is inline. Enter commits; Escape and blur cancel. Empty names do not commit. Camera, avatar and tracking copies have new IDs and independent settings. Tracking copies are stopped; avatar copies have no source assignments.

A referenced output camera cannot be removed. Removing a tracking source clears matching body and face assignments in the same transaction. Entity removal retains prepared files. Removed ECS storage is released during reconciliation. Duplication and deletion update the selection shared by Scene and Editor. Scene budgets and expected revisions still apply.

## Live evidence

Actual camera duplication kept output selection unchanged. Enter committed a trimmed name and updated the inspector; Escape retained revision 6. These checks ran on source `954739d`; later UI changes only add owner-reset recovery and Unicode-safe copy preparation. Actual camera removal cleared selection. The active camera Remove action was disabled with a replacement-camera title.

Final-release avatar duplication created an independent instance with no assigned body or face source. Its position changed to X=-0.35 through the inspector. OBS showed both copies. Removing the copy at revision 14 retained the original avatar and its textures in OBS.

Final-release VMC duplication retained settings and created a stopped source at generation 15. The test setup assigned both avatar routes to that owned copy through the common API. An empty rename draft produced INVALID_INPUT and retained revision 16. Clicking the original source cancelled the draft. Actual removal of the copy at revision 17 cleared both avatar source references. Deterministic tests cover both performers, late samples, camera protection, scene budgets and atomic failures. MediaPipe and iFacial copy behavior uses the same pure preparation path; no new physical tracking test is claimed.

## Memory failure and correction

The first live copy test exposed a WebKit termination. The supplied private VRM0 used about 3.4 GB in the Scene WebContent process. Two independently loaded copies reached 6689 MB. WebKit could not reduce the footprint below its 4096 MB inactive limit and killed the process. The native app remained running; a new Scene worker started empty. The editor initially kept stale state.

Decoded image sharing alone reduced the two-copy footprint to 5954 MB and still failed. The accepted fix shares decoded images, caps preview textures at 1024 pixels and output textures at 2048 pixels, preserves aspect ratio and permits two image decodes at a time. Source VRM files remain intact. Resizing occurs before GPU upload. The GLTF boundary tests verify shared decode, independent materials and safe disposal. Resize failure rejects the asset rather than accepting a blank texture.

The accepted native run reported 635 MB with one avatar and repeated 1031 MB samples with two copies. Later samples in the same process were 1074–1079 MB. A 45-second watcher retained the authored scene with advancing preview frames; the app also stayed alive during OBS and removal checks. These numbers are WebKit process footprint samples, not whole-app or GPU totals. Full memory reclamation after removal, different heavy avatars, WebGL fallback, a concert scene and minimum hardware remain unverified. The cap can reduce texture detail; user quality overrides remain a later slice. The reviewed OBS images retain the expected facial and clothing appearance at this framing.

Editor polling now accepts a fresh inspection when authoritative status reports a lower revision after an owner reload. Inspection epochs block earlier replies. Normal stale responses remain rejected. The second observed reset confirmed that the editor cleared the stale scene. Persistent save/load and owner recovery remain open.

## Validation and cleanup

391 unit tests, nine integration tests, 108 native tests, workspace checks, formatting and strict Clippy passed. One native fixture test is explicitly ignored. The macOS release build passed. Independent code review found no actionable issues.

The original six-asset scene, names, transforms, visibility, output camera, assignments, smoothing and receiver settings were restored and compared exactly except for source generations. Final revision is 23. Owned copies were removed. The owned OBS source was removed and the prior OBS scene restored. The new app remains running. The [evidence index](asset-management-evidence.json) records bounded capture hashes and state summaries. Models, full scene snapshots, phone settings, tokens and images remain private.
