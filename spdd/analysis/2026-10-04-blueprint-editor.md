# Blueprint editor analysis

The BP-01 runtime can execute an in-memory graph but users and MCP clients cannot reach it. The current command bridge sends editor and MCP methods to the authoritative session worker through the Rust loopback service. A `blueprintRun` command can use that bridge and its edit capability.

Warudo shows a blueprint list, node palette, and editable canvas. BP-02 needs a separate visual slice. Rete.js has a Svelte 5 renderer and connection plugin. A first canvas can edit a session-local draft graph and run its Manual Trigger. This proves the graph format can round-trip through Rete without giving the canvas scene authority. Save/load, graph lists, groups, undo, and Warudo navigation details remain later work.
