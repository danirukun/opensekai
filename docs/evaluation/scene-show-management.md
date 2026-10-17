# Scene show management check

Checked 2026-10-07 on macOS in the Tauri debug app from source commit `60c9628`. The editor can save a version-1 `.osekai` JSON file with the current scene and one Blueprint. Open validates the file and replaces the live scene through a revision-checked operator command. The renderer and editor connections remain active. The file stores asset IDs, not asset bytes.

## Live check

In the native editor, I added Camera 2 and visited the Blueprint panel. Save As wrote `SCN-05 Test.osekai` under `/private/tmp`. The file passed `ShowDocumentSchema` validation and contained two entities, one graph, and three graph nodes. I added an unsaved Camera 3, then opened the saved file. The sidebar returned to two assets. The Blueprint panel showed the restored Manual Trigger, Boolean, and Set Visibility nodes. Run reported **Ran**.

I opened a separate valid show whose avatar referenced `missing-prepared-avatar`, which was absent from the local library. The editor retained the entity as **Unavailable Avatar** in the Characters group. The show name, other assets, and output camera stayed available. The preview reported Session connected. This check did not use OBS or measure renderer backend performance.

The first macOS Save As attempt exposed disabled Save and New Folder buttons. The dialog had no parent window. Attaching the native dialog to the editor window enabled both controls in the rebuilt app. The final Save/Open flow used that parented dialog.

## Save in place and unsaved changes (2026-10-17)

In the macOS dev app, I renamed the show and closed the editor. The **Unsaved changes** sheet offered Save, Don't Save, and Cancel. Save opened the Save As chooser because no file was open. The file was written and the editor hid. I opened the editor again, renamed the show, and pressed Command+S. The same file changed to the new name and no chooser opened. Closing the editor with no changes hid it with no prompt. With an unsaved rename, Command+Q showed **Quit without saving the show?**. Cancel kept the app running. Quit ended it. The stock macOS Quit item (`terminate:`) skips Tauri `ExitRequested` in tao 0.37, so the app menu uses a custom Quit item that goes through the same check. This check did not use OBS. Shift+Save and Shift+Command+S (always Save As) were not checked in the running app.

Later the same day, the File menu gained Open Show, Save Show, and Save Show As. I pressed each item through macOS Accessibility. Save Show As opened the chooser and wrote the file, and a "Saved Untitled Show.osekai" toast appeared. With the editor hidden, Save Show brought the editor forward and changed the file modification time with no chooser, and the same toast appeared. Open Show opened the chooser, and Cancel left the scene unchanged. The menu accelerators were not pressed as keys.

## Automated checks

The new contract tests reject unsupported show versions, extra graphs, invalid output references, and stale scene replacement. Session tests confirm that replacement keeps sequence and clock progress, changes the scene ID atomically, and preserves a missing asset ID. Native file tests confirm bounded read/write, valid round trip, rejected malformed files, and unchanged target content after an invalid write. The MCP server exposes `scene_replace` under edit capability.

At this checkpoint, 412 unit tests, nine integration tests, and the Rust workspace suite passed. Sequential package checks, script TypeScript, strict Clippy, formatting, and the desktop build passed. A debug macOS app bundle passed the full live round trip. `pnpm build:mac` produced a 37.33 MiB release bundle. The release app reached Session connected and opened an enabled Save As dialog; that dialog was canceled without changing the scene. The build script sets `CARGO_PROFILE_RELEASE_STRIP=none` because stripping generated Rust proc-macro dylibs made the linker report a malformed Mach-O LINKEDIT section on this host.

## Remaining scope

SCN-05 remains partial. Show naming has Save, Save As, Open, and unsaved-change prompts, but no recent-show list, default show path, autosave, recovery UI, or show management list. BP-01/BP-02 gain one saved graph; graph lists, grouping, automatic triggers, undo, and more nodes remain open. Portable asset packages and migration diagnostics remain SCN-06. Windows, full Save/Open acceptance in the release app, OBS continuity during Open, and a concert-scale scene remain unverified.
