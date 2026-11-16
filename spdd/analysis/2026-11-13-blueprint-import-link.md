# Analysis: Blueprint import from an `opensekai://` link

Date: 2026-11-13. Scope: one feature, bundle B39. Issue: [#190](https://github.com/danirukun/opensekai/issues/190). Related: [Blueprint files](../prompt/2026-10-13-blueprint-files.md) (BP-04), [YouTube chat events](../prompt/2026-10-27-youtube-chat-events.md) (the host HTTP client), [web screens](../prompt/2026-11-08-web-screens.md) (the web URL rule). Contract: [Blueprint import from a link](../prompt/2026-11-13-blueprint-import-link.md).

The facts below come from the code at commit `2488223`. **[V]** marks a fact read in the code or in a local source file. **[I]** marks an inference, or a fact known only from documentation that is not in the local tree.

## Problem

A user finds a Blueprint graph on a web page and wants it in the open show. Today the user must download the file, open the Blueprints tab, click Import, and pick the file. The issue asks for one click on an `opensekai://` link in a browser. The link opens the app. The app downloads the file over HTTPS, shows what it got, and adds the graph only after the user confirms.

A link is input from any web page. The design must stop four things: a change to the show without consent, a graph that acts at once (hotkeys, camera, visibility), a download that reaches the local network, and a download that is too large or too slow.

## Current behavior

### Tauri host

- **[V]** Tauri `=2.12.1` (`Cargo.toml:11`). Plugins: dialog, global-shortcut, opener (`apps/desktop/src-tauri/Cargo.toml:45-47`, registered at `src/lib.rs:516-527`). No deep-link plugin and no single-instance plugin. `Cargo.lock` has neither.
- **[V]** `apps/desktop/src-tauri/Info.plist` has one key, `NSCameraUsageDescription`. It has no `CFBundleURLTypes`. `tauri.conf.json` sets `bundle.macOS.infoPlist: "Info.plist"`, the product name `OpenSekai`, and the identifier `com.oshi-connect.opensekai`.
- **[V]** One window, `main`. Each command checks `require_window_label(window.label(), "main")` (`lib.rs:50-60`). The command list is in four places that must agree: `build.rs:36-56`, `capabilities/main.json`, `generate_handler!` (`lib.rs:581-601`), and a test that pins the permission list (`lib.rs:641-681`).
- **[V]** `send_show_command` shows, unminimizes, and focuses `main`, then emits `show-command` (`lib.rs:358-367`). The Editor listens at `EditorApp.svelte:185`. A link arrival can use the same steps.
- **[V]** `tauri::RunEvent::Opened { urls }` exists for macOS in Tauri 2.12.1 (`tauri-2.12.1/src/app.rs:257-266`). So macOS can give a URL to the Rust host without a plugin.
- **[V]** At startup the host reads test variables from the environment: `OPENSEKAI_FIXTURE_MANIFEST` and `OPENSEKAI_EVALUATION` (`lib.rs:545-557`).
- **[V]** Platform code is behind an adapter, with one file for each platform and a stub (`src/capture/{adapter.rs,macos.rs,stub.rs}`, `src/input/devices/`).
- **[V]** The release has an ad-hoc signature (`signingIdentity: "-"`, `.github/workflows/release.yml:118`). No Apple Team ID is in use.

### HTTP in the host

- **[V]** `reqwest =0.13.5` with rustls and the default `system-proxy` feature. `gzip` is off, so the client does not decompress a body (`Cargo.toml:19`, `reqwest-0.13.5/Cargo.toml:113-119`). `Cargo.lock` has `rustls 0.23.45` with `aws-lc-rs`, `tokio-rustls 0.26.6`, and `hyper-util 0.1.21`.
- **[V]** The YouTube client is the model of a bounded fetch: a redirect policy with a host rule and a hop limit (`src/youtube/client.rs:433-444`), a 15 s timeout, a streamed read that stops at a byte limit (`client.rs:454-470`), and a config with a `base_url` that the integration test changes (`client.rs:41-58`). `ARCHITECTURE.md:85`: "Only the host has the HTTP client".
- **[V]** reqwest 0.13.5 has `https_only`, `tls_certs_only`, `resolve`, `dns_resolver`, `connect_timeout`, `no_proxy`, and `redirect` (`reqwest-0.13.5/src/async_impl/client.rs`).
- **[V]** The web URL rule exists on both sides: `is_web_screen_url` (`crates/contracts/src/lib.rs:386-432`) and `isWebScreenUrl` (`packages/contracts/src/web-url.ts`). It accepts only `https:`, at most 2048 printable ASCII characters, no user name or password, no `localhost`, `.localhost`, or `.local` name, and no private, loopback, link-local, or CGNAT IP literal.
- **[V]** The Editor window CSP `connect-src` has no public HTTPS origin (`tauri.conf.json:29`). Today the CSP blocks a `fetch` from the window to a public host.

### Blueprint side

- **[V]** The file format is `{ format: 'opensekai.blueprint', formatVersion: 1, graph, references[] }`, at most 1 MiB (`packages/contracts/src/blueprint-file.ts:7-18`). The host has `MAX_BLUEPRINT_FILE_BYTES = 1_048_576` (`src/blueprint_file.rs:5`).
- **[V]** `importBlueprint(input, scene, newId)` (`blueprint-file.ts:68-83`) is the one validator for the Editor, the templates, and MCP. It checks the size, the JSON and `format`, the version, unknown node types, the schema, and the 192 KiB graph limit. It gives the graph a new ID.
- **[V]** References: `resolveReferences` (`blueprint-file.ts:85-116`) keeps a reference whose ID is in the open scene. Else it changes the reference to the one entity with the same kind and name. Else it lists the reference as missing. A graph with a missing reference imports with `enabled: false`. The Editor shows `Missing: <names>` in the panel status line (`BlueprintPanel.svelte:84, 258`).
- **[V]** A dangling reference cannot cause harm. The store does not check references. A run that uses one fails at run time with `Entity not found` (`packages/session/src/overrides.ts:54`), and the graph shows a runtime error.
- **[V]** The add command is the op `{ kind: 'createGraph', graph }` in a `blueprintEdit` batch (`packages/contracts/src/blueprint-ops.ts:12, 66-69`). A ninth graph fails with `Blueprint set exceeds its limits` (`BlueprintSetSchema.max(8)`, `blueprint.ts:43`; `blueprint-ops.ts:158-165`). The store then refuses `Blueprint set is too large`, `Too many active keystrokes`, and `Too many held keys` (`packages/session/src/blueprint-store.ts:42-61`).
- **[V]** A disabled graph registers no keystroke and no held key. `activeAccelerators` and `activeHeldKeys` take only enabled graphs (`packages/session/src/blueprint-runtime.ts:32-36`). `listenedGraphs` adds a disabled graph only when an enabled graph targets it by ID with an Enable or Toggle Blueprint node (`blueprint-runtime.ts:39-51`). An imported graph has a new ID, so no existing graph targets it.
- **[V]** File import today: the command `import_blueprint_file` returns the file text (`lib.rs:391-419`). `BlueprintPanel.importFile` runs `importBlueprint` and sends one `createGraph` through `BlueprintSync.edit` (`BlueprintPanel.svelte:245-259`). File import keeps the `enabled` flag of the file.
- **[V]** `BlueprintSync.edit` applies the ops locally first, so the 8-graph failure is synchronous. A server rejection comes later through `sync.issue()`, and the view reloads (`apps/desktop/src/blueprints/blueprint-sync.ts:76-83, 108-119`).
- **[V]** MCP has `blueprint_import { sceneId, file }` and `blueprint_inspect`. MCP does not fetch URLs (`docs/mcp-client-setup.md:19`).

### Editor UI

- **[V]** `BlueprintPanel` is mounted only on the Blueprints tab (`EditorApp.svelte:231`). `sync` is in `EditorApp.svelte`. A link can arrive on any tab, so `EditorApp` must own the link flow.
- **[V]** `EditorApp.svelte` has `showBusy` (a show Open, template, recent, or Save runs, line 65) and `guideFor` (a guide overlay, line 83).
- **[V]** (`06dce38`) On an untouched launch a start screen covers the Scene pane on the Assets tab (`StartScreen.svelte`, `editor/start-screen.ts`). It ends when the show mark (scene or Blueprint revision) changes, so a link Import ends it and Cancel keeps it.
- **[V]** The kit has `Modal`: a native `<dialog>` with `showModal()`, the props `open`, `title`, `description`, `closeOnBackdrop` (default true), `children`, `footer`, `onclose`. Escape closes it. The desktop app does not use it yet.
- **[V]** The native File menu sends `show-command` at any time (`lib.rs:530-538`). A web modal does not block it.

### Names

- **[V]** `opensekai://` already names MCP resources: `opensekai://status`, `opensekai://blueprints`, `opensekai://scene/<id>` (`apps/mcp/src/resources.ts:9-25`). These URIs never go to the OS, so no technical collision exists.
- **[V]** No parity row names #190. The last Blueprint row is BP-18 (`docs/warudo-parity.md:240`).

## Reference behavior

- **Warudo** ([Blueprint overview](https://docs.warudo.app/docs/blueprints/overview), read 2026-11-13): the toolbar imports a blueprint from the clipboard or a JSON file and exports to the clipboard or a JSON file. Users share blueprints in the community Discord. The page names no URL scheme.
- **Conclusion:** link import is an additional OpenSekai goal. It is not a Warudo feature.
- **[I]** It is not known whether Warudo 0.15.1 registers an OS URL scheme. The handbook does not name one.

## Decision

Owner decisions (2026-11-13):

1. **Link shape:** `opensekai://blueprint/import?url=<percent-encoded https URL>`. Strict parsing: the host refuses any other host name, path, or parameter. Alternative: `opensekai://import/blueprint`. Rejected: the issue already shows the first shape.
2. **Inline payload and "Export as link":** deferred to one follow-up issue. Measured on `fixtures/blueprints/`: a graph of about 10 nodes needs about 800 characters with deflate and base64url. Without deflate it does not fit in 2000 characters. An inline link has no source host to show. "Export as link" needs the inline payload or an upload backend. With strict parsing, a `data=` link fails now with `Link not supported`.
3. **An imported graph is always disabled,** also when no reference is missing. Reason: a link can arrive during a live show, and an enabled graph registers hotkeys and runs at once. The user enables the graph in the Blueprint list. Alternative: keep the file flag, as file import does. Rejected for links.
4. **Download, then one dialog.** The host downloads before the dialog, so the dialog can show the name and the node count. Limits: 1 MiB, 10 s, at most 3 redirects, HTTPS on each hop, private and local addresses refused. Alternative: a first "Download from host?" step. Rejected: two prompts for one action. Result: a web page can make the app send one bounded GET to a public HTTPS host before consent.
5. **Dialog:** title `Import blueprint?`; the graph name; `7 nodes · <host>`; an optional `Missing: …` line; `Cancel` (focused) and `Import`. Failure: title `Blueprint not imported`, one reason line, `Close`. The host is the final host after redirects.
6. **Local check:** the orchestrator runs the bundled build on macOS: a click in a browser, a cold start, and a warm start. The pull request has `accept:local`.

Planner choices (the owner did not decide these; the contract records each one):

7. **The download runs in the Rust host.** Reasons: no CSP change, no `remote` capability, no CORS failure, a check on each redirect hop, and a check on the resolved address. The window gets only the downloaded text and the host name. The two commands take no arguments, and the window never sends a URL. So a defect in the window cannot use the host as a general HTTP client.
8. **Plugin:** `tauri-plugin-deep-link` at an exact version, with the Rust API only and `plugins.deep-link.desktop.schemes: ["opensekai"]`. The issue names it, and it registers the scheme on Windows later. Fallback, if no plugin version accepts Tauri 2.12.1: `CFBundleURLTypes` in `Info.plist` and `RunEvent::Opened`. Both ways stay in one adapter file.
9. **No system proxy for the link download** (`.no_proxy()`). With a proxy, the proxy resolves the name and the address filter cannot run, so owner decision 4 ("private addresses refused") is not true. A user behind a proxy gets `Download failed`.
10. **New messages:** `Link not supported`, `Link must use HTTPS`, `Link address not allowed`, `Too many redirects`, `Download failed`, `Download failed (<status>)`, `Download timed out`, `Show already has 8 blueprints`. The existing op message `Blueprint set exceeds its limits` does not tell the user what to do.
11. **A loading state** with the kit `Spinner` and `Cancel`. It shows only when the download takes more than 300 ms. Its title is `Import blueprint`.
12. **No new MCP tool.** The imported graph shows in `blueprint_inspect` and in the `opensekai://blueprints` resource.
13. **A startup variable `OPENSEKAI_OPEN_LINK`** offers one link at start, through the same parser, limits, and dialog. Dev builds and tests use it for the cold start path. `tauri dev` cannot receive an OS link, because it runs a bare binary without a bundle.

## Risks

- **[I]** The exact plugin version for Tauri 2.12.1, its config key, and its cold start behavior on macOS come from its documentation. The local registry has no copy. The fallback uses only verified Tauri code.
- **[I]** `tls_certs_only` and `resolve` with a custom resolver: read in the reqwest source, not run. The integration test is the proof.
- **[I]** All OpenSekai bundles on one Mac have the same identifier. Launch Services can open an installed release or the bundle of another worktree. The local check must record the path of the process that opened.
- **[I]** Most chat sites do not make a custom scheme clickable. A page author can write an HTML link. A web forwarder page is out of scope.
- The download starts before consent (owner decision 4). The address rules stop requests to the local network. The request shows the user's IP to the public host, as a normal link click does.
- `EditorApp.svelte` is a shared file (B33, B40). Keep the change there small.
- The kit `Modal` focuses the first focusable element. `Cancel` must come first, or take focus on open.
