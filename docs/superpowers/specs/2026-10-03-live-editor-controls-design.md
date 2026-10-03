# Live editor controls design

The user's four requested controls extend the accepted Warudo-style editor. The implementation contract is [the REASONS spec](../../../spdd/prompt/2026-10-03-live-editor-controls.md).

Use collapsible asset-type sections rather than a flat list. Keep a primary selection button and separate eye/output-camera buttons on each applicable row. Hidden rows remain available, with a muted icon/name. Camera activation uses the existing camera command for both outputs. Search keeps matching groups open. Groups preserve scene order and omit empty categories.

Apply valid numeric transform edits as they change. Position, Euler rotation and scale share a coordinator that allows one active command and one latest pending value. Scrub gestures use the same path. Invalid partial text remains local. The coordinator advances revisions for its own successful edits and cancels on external conflict or selection change. OBS consumes authoritative frames; no draft-only result counts as acceptance.

Verify the actual packaged editor and clean OBS source. Preserve and restore the user's current scene through the validated API during rebuild. Follow the already authorized implementation and checkpoint workflow without an extra confirmation round.
