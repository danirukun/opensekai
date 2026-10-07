# Scene show management design

OpenSekai will save a versioned show JSON document that contains the current scene and one Blueprint graph. The scene stores stable entity and asset IDs. The graph stores stable node and connection IDs. Rete objects and evaluated renderer state do not enter the file. This follows the existing architecture: the session owns the scene, the native host owns files, and the editor owns the current graph draft.

The editor offers Show → Save As and Open. Save requests a fresh scene snapshot, reads the current graph, validates the combined document, and passes it to a Tauri file command. The native command uses the system file chooser, writes a temporary file in the destination directory, syncs it, then replaces the destination. Open reads a bounded file, checks the version and complete document, and returns it to the editor. The editor sends a revision-checked scene replacement to the session. It adopts the saved graph only after the session accepts the scene. A canceled chooser changes nothing.

Scene replacement keeps the publisher, output renderer, and editor connections alive. It advances the scene revision, preserves the session clock and frame sequence, and resets tracking state. The editor updates its scene ID and clears selection. Missing asset IDs remain in entities, so a user can repair them later. The renderer can report an unavailable asset without erasing the reference.

The first slice supports one saved graph. It does not run automatically when a show opens. A graph list, grouping, undo, asset packaging, migration, and import between shows remain separate work. The show file does not contain avatar bytes; SCN-06 will address portable prepared packages. A newer schema is rejected without changing the open show.
