# MCP client setup

Use local Node 26.10.0 and the pinned pnpm workspace. Install dependencies from the repository root. Run the CLI from that root:

```sh
OPENSEKAI_CONNECTION_FILE=/absolute/path/to/operator.json node --import tsx apps/mcp/src/cli.ts
```

For a client launch configuration, set `command` to the Node executable, `args` to `--import`, `tsx`, and the absolute CLI path, and the working directory to the OpenSekai repository. Set `OPENSEKAI_CONNECTION_FILE` in the child environment. The application creates the descriptor with owner-only permissions. Never copy its token into client arguments, URLs, or logs.

The descriptor must use schema version 1, an operator role, a null output ID, and matching loopback HTTP and WebSocket origins. The authenticated app grants remain unchanged. Read-only sessions cannot edit, capture, or run benchmarks. Local evaluation mode must explicitly grant those capabilities.

The CLI authenticates the app connection before it starts MCP stdio. Startup failures produce one generic stderr message and exit with status 1. Stdout contains only MCP protocol messages. EOF, SIGINT, and SIGTERM close both connections. Calls during app disconnection return UNAVAILABLE; they do not return cached state. The shared app client reconnects with bounded delays.

Tools are `app_status`, `scene_inspect`, `scene_patch`, `scene_replace`, `camera_select`, `blueprint_edit`, `blueprint_inspect`, `blueprint_run`, `capture_frame`, `benchmark_start`, `benchmark_status`, `benchmark_cancel`, and `evidence_read`. Inputs use the shared strict command schemas. Domain failures include the structured error code and mark the tool result as an error.

Read `opensekai://status` for current status. Read `opensekai://blueprints` for the current Blueprint documents. The resource `opensekai://blueprint-nodes` lists each node type with its ports and the JSON Schema of its settings.

`blueprint_edit` applies one batch of ordered operations to the session Blueprints. Each batch needs a new `batchId`. Resending the identical batch is safe. `blueprint_inspect` reads the documents, or the batches after a revision. Its reply also lists the active accelerators. `blueprint_run` fires a Manual Trigger in an enabled graph. These tools use the same validated commands as the editor. Scene inspection registers `opensekai://scene/<scene-id>`. Capture and evidence results register opaque `opensekai://evidence/<id>/<filename>` resources. Only app-returned evidence IDs can be read. Bytes use the authenticated shared client and are checked against the declared length and SHA-256 hash. Evidence registrations are bounded to eight and removed when a read fails. The CLI does not fetch arbitrary URLs or file paths.

The early server tests use a typed app fixture and a real official SDK stdio client. Live app resource reads need the central public-URI mapping in the shared client. Live app and OBS acceptance follows Task 6 and Task 10 integration.
