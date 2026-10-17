# Scripting API audit (EXT-14, first part)

Date: 2026-10-17. Base commit: `7783f94`. Platform: Linux cloud (Ubuntu, x86_64). Scope: [#107](https://github.com/danirukun/opensekai/issues/107) first part. This audit compares documented Warudo scripting behavior with the OpenSekai extension API in `packages/extensions` (API version 1).

## Sources

- **Warudo.** The cloud container cannot open `docs.warudo.app` (the proxy refuses the host). The Warudo column comes from web search summaries of these pages: [scripting overview](https://docs.warudo.app/docs/scripting/overview), [API overview](https://docs.warudo.app/docs/scripting/api/overview), [entities](https://docs.warudo.app/docs/scripting/api/entities), [ports and triggers](https://docs.warudo.app/docs/scripting/api/ports-and-triggers), [assets](https://docs.warudo.app/docs/scripting/api/assets), [plugins](https://docs.warudo.app/docs/scripting/api/plugins), [resource providers and resolvers](https://docs.warudo.app/docs/scripting/api/resource-providers-and-resolvers), [Playground](https://docs.warudo.app/docs/scripting/playground), [plugin mod](https://docs.warudo.app/docs/scripting/plugin-mod), and [Mod SDK](https://docs.warudo.app/docs/modding/mod-sdk). Nobody opened the pages for this audit. The pages were last changed in mid 2024, as the search results report.
- **OpenSekai.** `packages/extensions/src/manifest.ts` and `sandbox.ts`, the [extension sandbox contract](../../spdd/prompt/2026-10-16-extension-sandbox-gate.md), and the [sandbox evidence](extension-sandbox.md).

## Status words

Same: the behavior matches. Partial: a subset exists. Different: OpenSekai does it another way on purpose. Missing: no OpenSekai equivalent yet. Unknown: the Warudo behavior is not recorded.

## Behaviors

| # | Warudo behavior | OpenSekai now | Status | Item |
| --- | --- | --- | --- | --- |
| 1 | Custom code adds node, asset, and plugin types. Structured data types are a fourth entity type. | A guest registers data nodes and asset type declarations. No plugin entity and no structured data. | Partial | EXT-05 |
| 2 | Built-in features use the same `Warudo.Core` API as mods. | Built-in nodes use the TypeScript node definitions. Guest nodes use the separate `opensekai` global. | Different | EXT-05 |
| 3 | A node has data inputs and outputs and flow inputs and outputs. A node can fire a flow output later (`InvokeFlow`). | Guest nodes have `number`, `boolean`, and `vector3` data ports, 0–16 inputs and 1–16 outputs. No flow ports. | Partial | EXT-05, EXT-06 |
| 4 | A data input is a public field with `[DataInput]`. Reset restores the default value. Attributes change the editor control (for example `[MultilineInput]`). | Guest ports have a type only. No default, no reset, and no editor attribute. | Missing | EXT-07 |
| 5 | Assets and plugins can have triggers (editor buttons). Assets have no outputs and no flow ports. | No guest triggers. Guest asset types have no ports. | Missing | EXT-06 |
| 6 | A node port can carry a non-serializable value, such as `GameObject` or `Texture2D`. | Guest values are copied JSON data. No engine object crosses the boundary. | Different | AGENTS.md product rule |
| 7 | Entities have a lifecycle: `OnCreate`, `OnDestroy`, and update phases each frame. Update order is plugins, then assets, then nodes. | A guest node is evaluated on request with copied inputs. No lifecycle hooks and no per-frame call. | Missing | EXT-06 |
| 8 | Entities serialize and deserialize with the scene. A separate page covers saving and loading data. | No guest state is saved. | Missing (the saving page is Unknown) | EXT-08 |
| 9 | `[AssetType]` sets an ID, a title, a category, and an optional singleton flag. | A guest asset type has a kind, a label, and 1–8 file extensions. Built-in and show file extensions are reserved. No category and no singleton. | Partial | EXT-05 |
| 10 | One plugin instance for each plugin type. A plugin does scene-independent work, such as resource registration or external sign-in. | No plugin entity. | Missing | EXT-09 |
| 11 | A resource is a URI with a scheme. Providers list URIs for a dropdown. Resolvers load a URI. A plugin registers both. | The host asset registry owns all assets. Guests cannot list or load resources. | Missing | EXT-09 |
| 12 | Playground: C# files in a folder compile and hot-reload when they change. | No development folder and no hot reload. The client reloads an extension in a new worker only after the watchdog ends the old one. | Missing | EXT-10 |
| 13 | A plugin mod registers its types in `[PluginType]`. It cannot use third-party DLLs, NuGet, `System.Reflection`, or `System.IO`. Mods are Unity builds through the Mod SDK (uMod 2.0). | The manifest lists capabilities (`log`, `nodes`, `assetTypes`). Registration is allowed only while the extension loads. The guest has no file, network, or host access. | Different (stricter) | EXT-05, EXT-02 |
| 14 | No documented time or memory limit for a mod. | Soft QuickJS time limit, worker watchdog, 64 MiB WASM memory maximum, stack limit, and quotas. A fault disables only that extension. | Different (OpenSekai goal) | EXT-13 |
| 15 | Scene queries, data watchers, events, graph generation, localization, plugin interoperability, debugging tools, and the DMX API. | Not available to guests. | Unknown | EXT-06, EXT-08, EXT-09, EXT-10, EXT-12 |

## Findings

1. No row is Same. 3 rows are Partial, 4 are Different, 7 are Missing (row 8 included), and 1 is Unknown.
2. The largest gaps for plugin authors are flow ports (row 3), editor inputs (row 4), the lifecycle (row 7), and plugins with resource providers (rows 10 and 11).
3. Row 13 conflicts with the [Workshop study](../superpowers/specs/2026-10-17-warudo-workshop-research.md): a strings scan found reflection in 4 of 5 sampled plugins, but the plugin mod page forbids `System.Reflection`. A string can come from a dependency or from metadata. Record this as an open question, not as a fact.
4. Rows 6 and 14 are Different on purpose. The product rules forbid native commands and mutable engine objects in guest code.

## What remains for EXT-14

- Open each Warudo page above and confirm or correct each Warudo cell. Record the date.
- Audit the pages that the search did not reach: saving and loading data, scene queries, watchers, events, graph generation, localization, interoperability, debugging, and the DMX API.
- Run a behavior check of each Same or Partial row when the guest API has a running host in the app.

EXT-14 stays unchecked.
