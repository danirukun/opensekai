# Blueprint link import check (B39)

Date: 2026-11-16. Bundle B39, BP-19 ([GitHub #190](https://github.com/danirukun/opensekai/issues/190)). Contract: [Blueprint import from an opensekai:// link](../../spdd/prompt/2026-11-13-blueprint-import-link.md). Base: `main` at 06dce38. Branch `claude/b39-blueprint-import-link`; the checks ran on the Editor commit 629d407 and on the documents commit. The pull request names the last commit.

Platform: macOS 27.2 (Darwin 27.2.0), arm64. Node 26.13.0, pnpm. Rust through the Nix dev shell (`direnv exec .`). The headless Editor check ran in Playwright Chromium. This file has no OBS result: the link path does not touch the output.

## Checks

| Check | Requirement | Result |
| --- | --- | --- |
| `apps/desktop/src-tauri/src/link/parse.rs` unit tests | R1, R2, R5: the link form, the one `url` pair, one percent decode, the length and byte limits, `+` kept, punycode hosts, the three messages | 6 pass |
| `apps/desktop/src-tauri/src/link/fetch.rs` unit tests | R7: the refused IPv4 and IPv6 ranges (with mapped, NAT64, and compatible forms), the resolver keeps only public addresses, a private IP literal is refused before a request, the messages and error codes | 6 pass |
| `apps/desktop/src-tauri/src/link/inbox.rs` unit tests | R3, R4, R6: one link, a second link dropped while a link is downloading or shown, a late result after a cancel or a reset, a cold-start link kept over the first `bootstrap_session` | 9 pass |
| [`tests/link_import_integration.rs`](../../apps/desktop/src-tauri/tests/link_import_integration.rs) | R7, R8: a real TCP socket, real TLS (an rcgen CA and leaf made at run time), and the real reqwest client: a 200 download with its host and headers and no cookie; 3 redirects pass with no referer and a fourth fails; a redirect to `http:` or to a private IP; 404; a large `Content-Length` and a large chunked body; text that is not UTF-8; a stalled body; an unknown CA; a plain HTTP server | 9 pass |
| `main_capability_has_the_exact_permission_list` in `lib.rs` | R4: the two link commands are in the capability; no `deep-link:` permission | Pass |
| `apps/desktop/test/link-import.test.ts` | R10: the confirm content, the missing names as in a file import, a file with `enabled: true` is added disabled, 8 graphs before a parse, the file import messages, the count line | 5 pass |
| `apps/desktop/test/link-import.integration.test.ts` | R13, R15, R16 with the real session store and runtime: `counter` and `wasd` through `linkSummary` and the Blueprint sync add no keystroke and no held key, `blueprintInspect` lists each graph disabled with the same name and node count, held W for 60 ticks does not move the character or change the scene revision; at 8 graphs the link fails and the revision and graph list do not change | 2 pass |
| [Headless Editor](blueprint-import-link/editor-check.mjs) ([log](blueprint-import-link/editor-check.txt)) | R9–R14: the built Editor window with the session in the page and a stand-in host `invoke` | 32 of 32 pass ([confirm](blueprint-import-link/confirm.png), [missing](blueprint-import-link/missing.png), [failed](blueprint-import-link/failed.png)) |
| Bundle `Info.plist` | R17: the scheme in the built bundle, without a launch | Pass: `CFBundleURLSchemes` is `["opensekai"]` ([Bundle check](#bundle-check)) |

The headless check covers: the first ready takes the link one time and shows `Import blueprint?`, `Counter`, and `7 nodes · blueprints.example` over the start screen, with focus on `Cancel`; a backdrop click does not close it; `Cancel` and Escape call `finish_blueprint_link` one time each, keep the start screen, and do not change the Blueprint revision; `app-link` and then `Import` add one disabled graph, show the Blueprints tab with the graph selected, and end the start screen; `missing-ref.json` shows the same `Missing:` line in the dialog and in the panel; `Link must use HTTPS`, `Blueprint file is too large`, and `Unknown node types: character.wave` show `Blueprint not imported`, the reason, and `Close` with focus on `Close`, and do not change the show; a second `app-link` while the dialog is open does not take again; File › Open Show does nothing while the dialog is open and Save Show runs; 8 graphs show `Show already has 8 blueprints`; a take reply after 1 s shows the Spinner, and `Cancel` closes the dialog and the late reply does not open it again.

The Editor scene of a normal launch has other camera IDs than `counter.json`, so the confirm screenshot also has a `Missing:` line.

## Full checks

| Command | Base 06dce38 | This branch |
| --- | --- | --- |
| `pnpm check` | Pass (svelte-check 5868 files, 0 errors, 0 warnings) | Pass (5870 files, 0 errors, 0 warnings) |
| `pnpm test:unit` | 247 files; 2174 pass, 1 skipped | 248 files; 2179 pass, 1 skipped |
| `pnpm test:integration` | 38 files pass, 2 skipped; 92 pass, 4 skipped | 39 files pass, 2 skipped; 94 pass, 4 skipped |
| `direnv exec . cargo test --workspace --no-fail-fast` | 556 pass, 0 fail, 2 ignored | 586 pass, 0 fail, 2 ignored |
| `direnv exec . cargo clippy --workspace --all-targets` | 0 warnings | 0 warnings |
| `direnv exec . cargo fmt --all -- --check` | 1 file differs (`recent_shows.rs:216`) | The same 1 file |

`pnpm test:integration` needs the tracking models in `artifacts/models` and a `pnpm build` (for `resources/output`) in a new worktree; both were set up before the base run.

## Deep-link plugin

`tauri-plugin-deep-link` `=2.6.3`, the newest 2.x release (it needs `tauri` ^2.12, `tauri-plugin` ^2.7.1, and `tauri-utils` ^2.10, which the lock already has; 3.0.0 is an alpha). The fallback (a hand-written `Info.plist` entry and a `RunEvent::Opened` handler) is not used. On macOS the plugin turns `RunEvent::Opened` into the event `deep-link://new-url` and keeps the current URL; `link/source.rs` uses only the Rust API (`on_open_url` and one `get_current` at start). The app has no plugin JavaScript package and no `deep-link:` permission. The Tauri CLI (tauri-bundler 2.10.4) reads `plugins.deep-link.desktop.schemes` from `tauri.conf.json` and writes `CFBundleURLTypes` into the bundle `Info.plist`; the plugin build script changes a plist only in an iOS build.

## Dependencies

New in `Cargo.lock`:

- Normal dependency: `tauri-plugin-deep-link` 2.6.3. With it, for Linux targets only: `rust-ini` 0.21.3, `ordered-multimap` 0.7.3, `dlv-list` 0.5.2, `hashbrown` 0.14.5, `const-random` 0.1.18, `const-random-macro` 0.1.16, `tiny-keccak` 2.0.2, `crunchy` 0.2.4.
- Dev dependencies: `rcgen` 0.14.10 (feature `aws_lc_rs`) and `yasna` 0.6.0. `tokio-rustls` 0.26.6 was already in the lock.
- Lock entries that no target builds (the weak feature `x509-parser?/verify-aws` of rcgen): `asn1-rs` 0.7.2, `asn1-rs-derive` 0.6.0, `asn1-rs-impl` 0.2.0, `bit-vec` 0.9.1, `der-parser` 10.0.0, `lazy_static` 1.5.1, `minimal-lexical` 0.2.1, `nom` 7.1.3, `num-bigint` 0.4.8, `num-integer` 0.1.47, `oid-registry` 0.8.1, `rusticata-macros` 4.1.0, `synstructure` 0.13.2, `untrusted` 0.7.1, `x509-parser` 0.18.1.

`cargo tree -i tauri` shows one `tauri` (2.12.1).

## Bundle check

`direnv exec . pnpm build:mac` built `OpenSekai.app` (release profile, 47.91 MiB). The bundle was not opened or started.

```text
$ plutil -extract CFBundleURLTypes json -o - "$CARGO_TARGET_DIR/release/bundle/macos/OpenSekai.app/Contents/Info.plist"
[{"CFBundleTypeRole":"Editor","CFBundleURLName":"com.oshi-connect.opensekai opensekai","CFBundleURLSchemes":["opensekai"]}]
```

## Make a link by hand

1. Export a Blueprint file from the Blueprints tab (Export blueprint).
2. Put the file on a public HTTPS host.
3. Percent-encode the file URL and put it in the `url` value: `opensekai://blueprint/import?url=https%3A%2F%2Fexample.com%2Fcounter.json`.
4. Open the link in a browser on a Mac where OpenSekai is installed. [link.html](blueprint-import-link/link.html) has three links for the local check.

## Platforms

| Platform | Result |
| --- | --- |
| macOS host tests (parser, download, inbox, capability) | Pass |
| macOS Editor (headless Chromium, stand-in host) | Pass |
| macOS bundle `Info.plist` | Pass: `CFBundleURLSchemes` is `["opensekai"]` |
| macOS link routing from a browser, the app minimized, cold start, WKWebView dialog look and focus | Not checked (`accept:local`, R18) |
| Linux cloud | Not checked |
| Windows | Not supported: no scheme registration |

OBS: not affected.
