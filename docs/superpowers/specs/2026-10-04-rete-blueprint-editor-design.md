# Rete Blueprint editor design

The editor gains a Blueprints rail view. A narrow palette adds Manual Trigger, Number, Boolean, Add, Greater Than, and Set Visibility nodes. The center is a Rete canvas with draggable nodes and typed connections. A small inspector edits the selected node's value or scene target. A Run action sends the draft graph to the common command bridge.

The Rete canvas is an adapter over the OpenSekai graph document. The authoritative session checks the graph again and applies its effects through one scene patch. Users can experiment with a working in-memory graph. The panel makes its draft status clear. A later slice will save graphs in shows and add a graph list, search, grouping, undo, and a wider node palette.

The `blueprintRun` command uses edit permission and reaches the session worker from the editor or MCP. A malformed graph cannot be executed. The source of truth for effects stays in the session. Rete objects and Svelte components do not enter the runtime frame or output renderer.
