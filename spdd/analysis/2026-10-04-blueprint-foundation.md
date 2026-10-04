# Blueprint foundation analysis

The Warudo parity checklist tracks typed graph execution in BP-01 and visual editing in BP-02. The existing session is the sole authority for scene changes. Its `scenePatch` command validates revisions and references. A graph must use that command path for effects.

Rete.js provides the planned node canvas. Its Svelte 5 renderer runs on the client. The graph file must remain a plain, versioned OpenSekai document so the session, tests, MCP, and future extensions can use it without a DOM or Rete classes.

The first slice handles an explicit trigger, typed number and boolean data, addition, and scene visibility. It validates connections and cycles before execution. It bounds graph size and operation count. The visual canvas, graph persistence, user expressions, delay nodes, and automatic tick triggers belong to later slices.
