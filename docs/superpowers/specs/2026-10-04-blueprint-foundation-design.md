# Blueprint foundation design

OpenSekai needs a graph format and a safe execution path before it can offer a Warudo-style Blueprint canvas. The first graph can take an explicit Manual Trigger, read Number and Boolean values, add numbers, compare them, and set an entity's visibility. This is a functional slice of flow and data ports; it does not claim full Warudo node parity.

The graph file is a versioned JSON document owned by OpenSekai. Nodes use stable type and port names. The compiler checks every wire and rejects immediate cycles. The executor has fixed work limits. It produces scene operations, and the session applies them through the same revision-checked patch command used by the editor and MCP. This keeps one scene authority.

Rete.js is the selected canvas for the next slice. Its Svelte 5 renderer supports the current editor stack. A canvas adapter will translate between Rete node objects and the OpenSekai document. The document will remain useful without the canvas, including for tests, MCP, and headless sessions. See the [Rete overview](https://github.com/retejs/rete), [Svelte renderer guide](https://retejs.org/docs/guides/renderers/svelte/), and [import/export guide](https://retejs.org/docs/guides/import-export/).

This slice has no automatic tick trigger or saved graph management. Those need separate contracts so graph work cannot stall the 60 Hz show loop or write arbitrary guest code. BP-01 stays partial until the runtime has the wider typed node set and scheduler. BP-02 and BP-04 stay planned until the Rete canvas and graph storage exist.
