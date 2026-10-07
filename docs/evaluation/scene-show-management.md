# Scene show management check

Checked 2026-10-07 on macOS in the Tauri debug app. The editor can save a version-1 `.osekai` JSON file with the current scene and one Blueprint. Open validates the file and replaces the live scene through a revision-checked operator command. The renderer and editor connections remain active. The file stores asset IDs, not asset bytes.

## Live check

In the native editor, I added Camera 2 and visited the Blueprint panel. Save As wrote `SCN-05 Test.osekai` under `/private/tmp`. The file passed `ShowDocumentSchema` validation and contained two entities, one graph, and three graph nodes. I added an unsaved Camera 3, then opened the saved file. The sidebar returned to two assets. The Blueprint panel showed the restored Manual Trigger, Boolean, and Set Visibility nodes. Run reported **Ran**.

I opened a separate valid show whose avatar referenced `missing-prepared-avatar`, which was absent from the local library. The editor retained the entity as **Unavailable Avatar** in the Characters group. The show name, other assets, and output camera stayed available. The preview reported Session connected. This check did not use OBS or measure renderer backend performance.

The first macOS Save As attempt exposed disabled Save and New Folder buttons. The dialog had no parent window. Attaching the native dialog to the editor window enabled both controls in the rebuilt app. The final Save/Open flow used that parented dialog.

## Automated checks

The new contract tests reject unsupported show versions, extra graphs, invalid output references, and stale scene replacement. Session tests confirm that replacement keeps sequence and clock progress, changes the scene ID atomically, and preserves a missing asset ID. Native file tests confirm bounded read/write, valid round trip, rejected malformed files, and unchanged target content after an invalid write. The MCP server exposes `scene_replace` under edit capability.

At this checkpoint, 412 unit tests, nine integration tests, and the Rust workspace suite passed. Sequential package checks, script TypeScript, strict Clippy, formatting, and the desktop build passed. A debug macOS app bundle passed the live check. The release bundle failed while loading generated Rust proc-macro artifacts (`phf_macros`, `serde_derive`, and `zerofrom_derive`), including after clearing release artifacts and retrying with one build job. The contracts release crate compiled alone. Release packaging remains open.

## Remaining scope

SCN-05 remains partial. Show naming has Save As and Open, but no recent-show list, default show path, autosave, recovery UI, or show management list. BP-01/BP-02 gain one saved graph; graph lists, grouping, automatic triggers, undo, and more nodes remain open. Portable asset packages and migration diagnostics remain SCN-06. Windows, release-bundle acceptance, OBS continuity during Open, and a concert-scale scene remain unverified.
