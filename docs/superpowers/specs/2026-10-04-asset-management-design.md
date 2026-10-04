# Asset management design

Continue SCN-01 through the existing asset sidebar. The right-click menu provides Rename, Duplicate and Remove. Names edit inline, with Enter to commit and Escape or blur to cancel. The session validates names and edits atomically.

Copies keep persistent settings with new IDs and unique Copy names. Tracking copies are stopped. Avatar copies have tracking unassigned. Removing a source clears its avatar references. A camera used by any output cannot be removed until that output selects another camera. Entity removal keeps prepared files.

The common scenePatch API serves editor and MCP. Existing scene budgets still apply. Actual UI actions and OBS output must pass before the slice is checked. The detailed contract is spdd/prompt/2026-10-04-asset-management.md. Save/load and undo remain separate.

Live evaluation expanded the resource requirement. Repeated VRM loads now share decoded images with reference-counted lifetime. Preview textures are capped at 1024 pixels; output textures at 2048 pixels. Two concurrent decodes bound peak work. Original files and independent avatar state remain intact. These limits correct the measured WebKit memory termination for the supplied model. The editor also accepts an authoritative lower revision after owner reload without accepting ordinary stale replies. See the evaluation record for evidence and limits.
