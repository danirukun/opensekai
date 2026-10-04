# Blueprint foundation evidence

Date: 2026-10-04. Scope: BP-01 partial. Platform: macOS development host. Renderer backend: not applicable; this checkpoint changes session logic only.

The saved graph has a versioned JSON schema. The compiler validates node settings, wire references, port types, required inputs, duplicate input wires, IDs, and immediate cycles. The executor supports Manual Trigger, Number, Boolean, Add, Greater Than, and Set Visibility. It limits graph size and each run. The session applies effects through one revision-checked scene patch.

Verification: `pnpm test:unit` passed with 403 tests in 58 files. `pnpm check` passed with zero Svelte errors or warnings. Tests include a successful visibility change, number evaluation, invalid wires, a data cycle, non-finite arithmetic, flow limits, and a missing target entity that leaves the scene unchanged.

The graph has no editor or saved show path yet. It cannot be triggered through the public command API. Continuous scheduling, delay nodes, event queues across ticks, extension nodes, and the full Warudo node set remain open. BP-01 remains unchecked.
