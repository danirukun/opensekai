# Scene show management analysis

Date: 2026-10-07. Scope: SCN-05 first vertical slice; BP-01/BP-02 persistence subset.

The app now starts an empty scene on each launch. Scene edits live only in the session worker. The Blueprint editor holds one graph draft in the editor WebView. A saved show must capture both at one explicit Save action, and Open must replace the authoritative scene without restarting renderer clients or the native service.

`SceneView` and `BlueprintGraph` are already versioned and validated in TypeScript. Rust validates the scene at the service boundary and owns local file access. The asset library stores imported VRMs by stable IDs. The renderer reports an unavailable asset without deleting its scene entity. The first show format can therefore store scene entities and graph references without embedding asset bytes. Portable prepared packages remain SCN-06 work.

Use a versioned JSON show document with a name, scene snapshot, and zero or one graph in this slice. Keep the graph as plain data; Rete state is disposable. Open validates the complete document and graph before it changes the worker. A scene-replace edit command checks the current revision, increments it, keeps the session clock and output connections, and resets tracking state. A native file adapter bounds reads and writes atomically. The editor exposes Show → Open and Save As. Save reads a fresh scene snapshot and the current graph, then writes a file. Open applies the scene first and makes the graph current only after the replace command succeeds.

The first integration test must save a scene and graph, reopen them, run the graph against the restored entity, and confirm that a missing asset ID remains in the scene. Failure tests must cover malformed or newer files, a failed write, stale revision, and a missing output camera. The native macOS check must exercise Save As and Open through the editor. This subset does not claim graph lists, automatic graph triggers, embedded assets, migration, or full SCN-05 parity.
