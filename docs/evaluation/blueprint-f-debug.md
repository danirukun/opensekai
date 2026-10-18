# Blueprint debug check

Slice F of bundle B13 ([contract](../../spdd/prompt/2026-10-18-blueprint-f-debug.md), #199). Checked 2026-10-18 on macOS 27.0.1 (arm64), Node 26.12.0, pnpm 12.8.1, on branch `opensekai/bp-f-debug`, last merged with the integration branch at `097d37a` (after slices I, C, and A). The review fixes (epoch, full value set, commit-gated recording, separate Debug Value samples, ring buffer, toast plan per poll) are included. Only automated checks ran. The desktop app, the editor window, the renderer, and OBS did not run, so no editor, macOS, or OBS result is claimed.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm check` | Passed: all packages and `tsconfig.scripts.json`; svelte-check 0 errors, 0 warnings |
| `pnpm test:unit` | 1138 passed in 152 files, 0 failed |
| `pnpm test:integration` | 43 passed, 2 skipped in 20 files (19 passed, 1 skipped), with the ignored `artifacts/models/` files copied from the main checkout |
| `cargo test -p opensekai-contracts` | 73 passed, 0 failed |
| `cargo test -p opensekai-desktop` | 232 passed, 1 ignored, 0 failed (needs the ignored `src-tauri/resources/output/` bundle, copied from the main checkout) |

New tests:

- `packages/contracts/test/blueprint-debug.test.ts` (5): the value text of each data type (number, integer, boolean, string, Vector3, and each list type); the 256-character cut at a code point boundary; the control character rule (markup stays text); the typed ports of Debug Value and Emit Debug Event and the settings limits; the call and reply schemas.
- `packages/contracts/test/blueprint-debug-fixture.test.ts` (1) and `crates/contracts/tests/blueprint_debug.rs` (2): the same shared reply (`fixtures/protocol/blueprint-debug.json`) and the same 15 mutations in TypeScript and Rust; the Rust call check.
- `packages/session/test/debug-log.test.ts` (5): the rate window and the drop count; the 1000-entry ring and the read paging (`since`, `next`, `latest`); 10 entries a second for each node and 5 toasts a second for each graph, with the drop count on the next kept entry; the text rules and the event payload text; the value change rule, the 64-value limit, and the value prune.
- `packages/session/test/debug-nodes.test.ts` (5): the four effects with inline strings and a typed payload; 128 Log effects in one run with a 64-effect budget; the pass-through capture, the watch of an unread node on a copy of the state (the Random seed does not move), and a watch that fails without a run failure; through `createSession`, an On Update Log graph keeps 10 entries in its first second and reports 50 drops; a failed run adds no entry; a value moves only on change and goes away with its node.
- `apps/desktop/test/debug-feed.test.ts` (5): the first read adds no toast; later reads add only new entries; an unchanged read keeps the state object; a lower session sequence resets the feed; the 1000-entry feed bound; the toast plan (fit, `+N more`, session drops, no place); the time text.
- `apps/desktop/test/debug-feed.integration.test.ts` (1): session → editor boundary. A real session behind `sessionApi`, each reply parsed with `ResultSchemas.blueprintDebug`, into the editor feed: an On Update Show Toast graph and a Debug Value node, pages through the toast window, and a toast with `dropped: 56` after the window.
- `apps/mcp/test/blueprint-debug.integration.test.ts` (1): MCP stdio with a real session. A manual run with Log, Emit Debug Event (integer payload), and Debug Value, read with `blueprint_debug_log`, then with `since`; a negative `since` is an error.
- `apps/desktop/src-tauri/tests/service_integration.rs` (1 new): the host relays `blueprintDebug` from an operator to the publisher, passes the shared reply, and rejects a reply with an unknown level.

## What the macOS run must check

Use the integrated QA build, with OBS connected. Record the backend, the quality profile, and the commit.

1. Make a graph: Manual Trigger → Log (Level Warning, Message "hello") → Show Toast (Type Success, Header "Chat", Caption "<b>hi</b>", Duration 3) → Emit Debug Event (Name "ping", Payload Integer 7). Run it.
2. A green toast "Chat: <b>hi</b>" shows in the Editor window for about 3 s. The markup shows as text.
3. Open the Debug output (terminal button in the Blueprint tool rail). It lists the warning line, the toast, and `ping 7` with the time and the graph name. The graph and level selects filter the rows. Clear empties the list; a new run adds rows again.
4. During the toast, take an OBS capture and a Scene window screenshot. Neither shows the toast or the debug output.
5. Change the Show Toast Type to each of Info, Warning, and Error and run again. Each toast has its variant.
6. Make an On Update graph with Show Toast. At most 3 debug toasts show at a time, and a `+N more` toast counts the rest. The Debug output shows `+n` drop counts. The editor stays responsive.
7. Put a Debug Value (Type Number) on a wire from Get Asset Property (camera Field of View) to Set Asset Property, and add a second Debug Value (Type Vector3) with no output wire, fed from Get Asset Property (Position). Move the camera. Both nodes show the new text and the time it changed.
8. Minimize and restore the editor. Toasts from the minimized time do not all show at once (at most 3 and `+N more`).
9. Through MCP, call `blueprint_debug_log` without `since`, then with `since` set to `next`. The entries and values match the Debug output.
10. Save the show and open it again. No debug entry or value is in the file.

## Gaps

- No editor, macOS, or OBS evidence.
- Log lines do not go to the app log (host `tracing`). The host sees entries only when a client reads them.
- Entries of a failed run are not kept; the run error shows instead.
- The Warudo node names are candidates.
