# REASONS: Blueprint import from an `opensekai://` link

Date: 2026-11-13. Scope: one feature, bundle B39 ([#190](https://github.com/danirukun/opensekai/issues/190)). Analysis: [Blueprint import from a link](../analysis/2026-11-13-blueprint-import-link.md). This contract adds an OS link input and an HTTPS download to the desktop host, and a confirmation dialog to the Editor window. It does not change the Blueprint file format, the scene schema, the show file, the session, the call API, or MCP.

## R — Requirements

### Link and delivery

R1. The macOS app bundle registers the URL scheme `opensekai`: the `Info.plist` of the bundle has `CFBundleURLTypes` with the scheme `opensekai`. A dev build (`pnpm dev:desktop`) does not register it.

R2. The host accepts one link form: `opensekai://blueprint/import?url=<value>`. A pure function parses it. It refuses each of these with `Link not supported`: more than 4096 bytes or a character that is not printable ASCII; another scheme; a host other than `blueprint`; a path other than `/import`; a user name, a password, a port, or a fragment; no `url`, a repeated `url`, or any other parameter. The percent-decoded `url` value must use `https` (else `Link must use HTTPS`) and must pass the web URL rule `is_web_screen_url` (else `Link address not allowed`).

R3. When the OS gives a link to the running app, the host shows, unminimizes, and focuses the `main` window and emits `app-link` (no payload) to it. When the OS starts the app with a link, the host keeps the link until the window asks for it.

R4. The host keeps at most one link (the inbox). States: `idle`, `pending`, `downloading`, `shown`. A new link replaces a pending link. In the `downloading` or `shown` state, the host drops a new link and shows no message. A webview reload (`bootstrap_session`) sets a `downloading` or `shown` inbox to `idle` and keeps a `pending` link, so a link from a cold start, which arrives before the first `bootstrap_session`, is not lost. The host discards a download that ends after that reset.

R5. Two commands for the `main` window only, with no arguments:
- `take_blueprint_link`: in a state other than `pending` it returns `null`. A pending parse error returns that error (state `shown`). A pending link starts the download (state `downloading`). It then returns `{ text, host }` or the download error (state `shown`), or `null` when the window cancelled during the download (state `idle`).
- `finish_blueprint_link`: `shown` becomes `idle`; `downloading` is marked cancelled; other states do not change.
The window never sends a URL to the host. The host downloads only a URL that came from the OS or from R6.

R6. When the variable `OPENSEKAI_OPEN_LINK` is set at start, the host offers its value to the inbox one time, the same as an OS link during launch. The value takes the same parser, limits, and dialog.

### Download

R7. Only the Rust host downloads. Limits:
- `GET` only, with `https_only`. Each redirect target must pass the URL rule of R2. A redirect to another scheme or to a refused address gives `Link address not allowed`. More than 3 redirects give `Too many redirects`.
- Each address that DNS gives for a name must be public. The resolver removes unspecified, loopback, private, link-local, CGNAT (`100.64.0.0/10`), benchmark (`198.18.0.0/15`), reserved (`0.0.0.0/8`, `240.0.0.0/4`), IETF protocol assignments (`192.0.0.0/24`), broadcast, multicast, documentation, unique-local (`fc00::/7`), and site-local addresses. It also removes the IPv4-compatible (`::/96`), IPv4-mapped (`::ffff:0:0/96`), NAT64 (`64:ff9b::/96`), NAT64 local-use (`64:ff9b:1::/48`), and 6to4 (`2002::/16`) forms of a refused IPv4 address. When no address is left: `Link address not allowed`.
- No system proxy, no cookie store, no `Referer`. Headers: `User-Agent: OpenSekai/<app version>`, `Accept: application/json`.
- Connect timeout 5 s and total timeout 10 s. A timeout gives `Download timed out`.
- Only status 200 is accepted. Another status gives `Download failed (<status>)`. A DNS, connect, TLS, or read error gives `Download failed`.
- The body is at most 1,048,576 bytes. A `Content-Length` above the limit fails before the read. The read stops when the count goes above the limit. The message is `Blueprint file is too large`. A body that is not UTF-8 gives `Not an OpenSekai Blueprint file`.
- The host does not check the content type and does not decompress.

R8. The `host` of the reply is the host name of the final response URL, in lowercase ASCII (punycode for an international name), without a port.

### Editor

R9. The Editor window calls `take_blueprint_link` when it gets `app-link`, and one time when it becomes ready. Ready means: the operator can edit, the session answered, the Blueprint sync loaded, no show Open or Save runs (`showBusy` is false), no guide overlay is open, and no link dialog is open. The start screen does not delay the call; the dialog shows over it. When `app-link` arrives before the window is ready, the call waits until it is ready.

R10. One pure function builds the dialog content from the reply. First, when the show has 8 graphs: `Show already has 8 blueprints`. Then `importBlueprint(text, scene, newId)` with the current scene. Then the graph gets `enabled: false`. The content is built again when the scene or the graph count changes while the dialog is open.

R11. The dialog uses the kit `Modal` with `closeOnBackdrop={false}`. States:
- Loading, only when no reply has come after 300 ms: title `Import blueprint`, the kit `Spinner`, and `Cancel`.
- Adding, after `Import` until the session answers: the Confirm content with `Cancel` and `Import` disabled. Escape does nothing.
- Confirm: title `Import blueprint?`; the graph name; `<n> nodes · <host>` (`1 node` for one); `Missing: <names>`, only when references are missing (the same form as file import); `Cancel` then `Import`. Focus starts on `Cancel`.
- Failed: title `Blueprint not imported`; one line with the reason; `Close`.
The dialog has no other text. Escape does the same as `Cancel` or `Close`, except while Adding. Each close calls `finish_blueprint_link`.

R12. `Import` sends one `createGraph` op as one batch through `BlueprintSync.commit`, built from the current scene. On success, the dialog closes and the Blueprints tab shows. The new graph is selected and disabled. When references are missing, the panel status line shows `Missing: …`. No toast. The start screen ends, because the Blueprint revision changes (start screen R1). After Cancel or a failure it stays. On a synchronous failure or a server rejection, the dialog goes to the Failed state with that message. When the session cannot be reached, the message is `Session unavailable`.

R13. Each failure and each `Cancel` leaves the show unchanged: the Blueprint revision and the graph list are the same as before the link. The Import result comes from its own batch, not from the shared sync state: when the session confirms the batch with a revision, Import succeeds, also when the pull after it fails; when the batch was not confirmed, the Editor removes it from the sync before it shows Failed, so no later poll sends it. `Import` does nothing while the session is unavailable. A result that comes after the dialog closed or after a newer link opened changes nothing.

R14. While the dialog is open or the window waits for `take_blueprint_link`, File › Open Show, a template, and a recent show do nothing. Save Show works. The session clock and the output do not stop.

R15. An imported graph registers no keystroke and no held key, and runs no node, until the user enables it.

### MCP

R16. No new MCP tool. After Import, `blueprint_inspect` and the resource `opensekai://blueprints` list the graph with the same name and node count.

### Evidence

R17. Automatic proof: Rust unit tests (parser, address filter, inbox, messages); a Rust integration test with a local HTTPS server (real TLS, the real reqwest client); TypeScript unit tests of the dialog content; one integration test with a real session (8 graphs; no keystrokes from a disabled import); a headless Editor check in Chromium; a check of the bundle `Info.plist` with `plutil`, without a launch.

R18. Local acceptance (`accept:local`), run by the orchestrator with a bundled build on macOS: a browser click while the app runs; the app minimized; the app closed (cold start); a second link while the dialog is open; the dialog look and the focus in WKWebView.

R19. Documents: `ARCHITECTURE.md` (the Blueprint link path and its trust checks), parity row BP-19 with only the verified behavior, one sentence in `docs/mcp-client-setup.md`, and the evidence page.

## E — Entities

- `AppLink::BlueprintImport { url: Url }` (Rust, host only). The enum has room for later link kinds.
- `LinkError` (Rust): `NotSupported`, `NotHttps`, `AddressNotAllowed`. Each one maps to one message of R2.
- `LinkInbox` (Rust, managed state): `idle | pending(Result<AppLink, LinkError>) | downloading { ticket, cancelled } | shown`. A ticket counter makes a late download result after a reset harmless.
- `LinkFetchConfig` (Rust): limits of R7 with production defaults, plus two hidden test fields: extra trust roots (DER) and name overrides (`resolve`). The defaults have neither.
- `LinkDownload { text, host }` (Rust, serde camelCase): the reply of `take_blueprint_link`. Errors use the existing `AppError` (`INVALID_INPUT` for link, address, size, and format errors; `UNAVAILABLE` for download and timeout errors).
- `LinkImportState` (TypeScript): `idle | loading | confirm { text, host } | failed { message }`.
- `linkSummary(text, host, scene, graphCount, newId)` (TypeScript, pure): `Reply<{ graph, name, host, nodeCount, missing }>`.
- `BlueprintSync.commit(ops)` (TypeScript): applies the ops as one batch at once, sends it, and resolves with the result of that batch: `{ revision }` when the session confirmed it; the rejection; or `UNAVAILABLE` after it removed the unconfirmed batch and rebuilt the view.
- No change to a schema in `packages/contracts` or `crates/contracts`, to the session, to the show file, or to MCP.

## A — Approach

- Tests first in each task. Host first (parser, download, inbox), then the platform adapter, then the Editor.
- The download follows the YouTube client: a redirect policy, a streamed byte limit, and a config that a test can change.
- Reuse `is_web_screen_url` for each URL. Reuse `importBlueprint` for validation and the Blueprint sync for the add (`BlueprintSync.commit`, so the add has its own result). Force `enabled: false` after `importBlueprint`.
- Delivery: one adapter file (`link/source.rs`) connects the OS to the inbox. It uses the deep-link plugin Rust API on macOS. Other targets get a stub. The event `app-link` only wakes the window; the window pulls the link with a command, so a link that arrives before the webview listens is not lost.
- The Editor flow lives in `EditorApp.svelte`, because a link can arrive on any tab. The dialog is one new component.

## S — Structure

- New: `apps/desktop/src-tauri/src/link/{mod.rs,parse.rs,fetch.rs,inbox.rs,source.rs}`; `apps/desktop/src-tauri/tests/link_import_integration.rs`.
- Changed host files: `apps/desktop/src-tauri/Cargo.toml` and `Cargo.lock` (plugin; dev-dependencies `rcgen` and a rustls server crate already in the lock), `build.rs`, `capabilities/main.json`, `src/lib.rs` (module, plugin, managed inbox, two commands, handler list, pinned list test, reset in `bootstrap_session`), `tauri.conf.json` (`plugins.deep-link`). `Info.plist` changes only in the fallback.
- New Editor files: `apps/desktop/src/blueprints/link-import.ts`, `apps/desktop/src/components/BlueprintLinkDialog.svelte`, `apps/desktop/test/link-import.test.ts`, `apps/desktop/test/link-import.integration.test.ts`.
- Changed Editor files: `apps/desktop/src/EditorApp.svelte`, `apps/desktop/src/components/BlueprintPanel.svelte` (optional `arrival` prop), `apps/desktop/src/blueprints/blueprint-sync.ts` (`commit`: one batch with its own result). `apps/desktop/src/app.css` only if the kit classes are not enough.
- Documents: `ARCHITECTURE.md`, `docs/warudo-parity.md` (BP-19), `docs/mcp-client-setup.md`, `docs/evaluation/blueprint-import-link.md`, `docs/evaluation/blueprint-import-link/` (check script, output, screenshots, `link.html`).

## O — Operations

1. Spec commit: this contract and its analysis.
2. Host link parser and download, with unit tests and the HTTPS integration test.
3. Inbox, the two commands, the adapter, the plugin, and the config.
4. Editor: pure module and tests, session integration test, dialog, wiring, headless check.
5. Documents and evidence; full checks; bundle `Info.plist` check.
6. Local acceptance by the orchestrator (R18), after the pull request opens.

## N — Norms

- Unit tests for each pure rule: parser, address filter, inbox states, message mapping, dialog content.
- Integration tests only at real boundaries: TLS and HTTP with the real reqwest client (Rust), and a real session for the add and the limits (TypeScript). State the boundary in a comment.
- A fixed wait only in the timeout test, which measures a timeout (`docs/testing.md`).
- No TLS key or certificate file in the repository. The test makes them at run time.
- Exact versions for each new crate. Report each new package in `Cargo.lock`.
- UI copy only as R11 states. Prose in Simplified Technical English.
- Run each cargo command through `direnv exec .`.

## S — Safeguards

- Do not add a `fetch` in the window, a CSP change, or a `remote` capability.
- Do not add a command that takes a URL.
- Do not add the plugin JavaScript package or a `deep-link:` permission.
- Do not import a graph enabled.
- Do not use a system proxy, do not decompress, do not follow more than 3 redirects.
- Do not change the Blueprint file format, a schema, the session, or MCP.
- Do not register the scheme on Windows or Linux. Do not add the single-instance plugin.
- Do not add an inline payload or "Export as link".
- Do not claim OS link routing, a cold start, or the WKWebView look before the local check passes.
- Do not commit a TLS key or certificate.
