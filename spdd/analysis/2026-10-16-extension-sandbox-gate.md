# Extension sandbox gate analysis

Date: 2026-10-16. Scope: bundle B10 (#98 EXT-05, #106 EXT-13). Foundation requirements R8 and O7 in [the foundation contract](../prompt/2026-10-02-opensekai-foundation.md). Direction: "JS/TS extension boundary" in [the architecture design](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md).

## Problem

1. The architecture selects JavaScript and TypeScript for extensions, and it names QuickJS in a worker as the isolation candidate. It says: "Validate interruption, memory limits, hostile loops, and leaked handles before claiming sandbox support." No code tests this gate yet.
2. EXT-05 asks for the boundary of JS/TS custom nodes and asset types now, and guest delivery later. No manifest, no host API, and no registration path exist.
3. EXT-13 asks for resource limits and failure recovery before guest plugins ship.

## Warudo behavior

Warudo plugins are C# mods. They define nodes and asset types through the Mod SDK, and they run with full engine access. Warudo has no sandbox and no resource limit for a mod. OpenSekai uses a different API (parity status "Different API" for most EXT items). The OpenSekai goal is stricter: guest code has no host access except approved capabilities.

## Decisions

- Add the package `packages/extensions`. It holds the manifest schema, the sandbox host, the worker protocol, and the main-thread client. It does not depend on Svelte, the renderer, or the session.
- Use `quickjs-emscripten-core` 0.32.0 with the `@jitl/quickjs-wasmfile-release-sync` variant. Give each extension its own WASM instance. A fatal VM error then cannot reach another extension.
- The manifest is version 1: `id` (reverse DNS), `name`, `version`, `apiVersion: 1`, and `capabilities` from `log`, `nodes`, `assetTypes`.
- The guest gets one frozen global `opensekai` with `log`, `registerNode`, and `registerAssetType`. A trusted prelude hides the host bridge. Evaluator functions stay inside the guest VM. Only JSON strings cross the boundary, and the host validates each one with zod.
- Guest nodes are data nodes with `number`, `boolean`, and `vector3` ports. They have no flow ports. The host prefixes each type with the extension ID.
- Guest asset types are declarations only: a kind, a label, and file extensions. A guest cannot claim an extension that a built-in importer or the show file owns, or an extension that another guest owns.
- Registration is allowed only while the extension loads.
- A fault disables the extension: a denied capability, an invalid registration or output, a quota, a time limit, a memory limit, a stack overflow, or an uncaught error. The host releases its registrations and its VM, and it reports the cause. A fault in the bridge stays a fault when the guest catches the error.
- Binary buffer types (`ArrayBuffer`, typed arrays, `DataView`, `Atomics`) are hidden from the guest. Their storage is outside the QuickJS memory limit (see Findings).
- The host does not read the runtime memory total. `computeMemoryUsage` can trap on a heap that reached the limit (see Findings).
- A WASM trap or an error without a value from QuickJS is an `error` fault. The extension's WASM instance is dropped.
- The worker runs requests one at a time. The client has a watchdog. When the worker sends no message for `watchdogMs` (default 2000 ms) while a request waits, the client terminates the worker, disables the extension of the oldest waiting request (`unresponsive`), starts a new worker, loads the other extensions again, and sends the waiting requests again.

## Findings

The table and findings 1 to 5 are from the release variant with its default 2 GiB WASM maximum, before the selected memory bound. See Memory bound for the results with it.

Measured on Linux cloud (Node 26.10.0, x86_64), `quickjs-emscripten-core` 0.32.0 release-sync, default limits (16 MiB memory, 250 ms load, 5 ms call). Raw output is in [the evidence page](../../docs/evaluation/extension-sandbox.md).

| Guest | Stops after | Cause |
| --- | --- | --- |
| `for (;;) {}` at load | 278 ms | timeout |
| `for (;;) {}` in a node | 7 ms | timeout |
| Object allocation loop | 254 ms | memory |
| Array allocation loop at load (`new Array(1 << 14).fill(0)`) | 682 ms, 313 MiB held | timeout |
| Array allocation loop in a node | 523 ms | timeout |
| Native-heavy loop in a node (`new Array(1 << 20).fill(0)`) | 26 713 ms in process; 1000 ms with the worker watchdog | timeout; unresponsive |

1. **The QuickJS memory limit is not a hard limit.** With a 4 MiB limit, a guest held 2042 MiB in `Uint8Array` objects and 1792 MiB in arrays. The limit counts objects but not array storage and binary buffer storage. Only the WASM heap maximum (about 2 GiB for each instance) stops it.
2. **The QuickJS time limit is soft.** QuickJS calls the interrupt handler only after many bytecode branches. One branch can contain a long native call. A 5 ms call limit stopped a native-heavy loop after 27 s in process.
3. **The worker watchdog is the hard time bound.** A real Node worker thread that ran the native-heavy loop was terminated after the 1000 ms watchdog. The other extension was loaded again in a new worker and answered the waiting request.
4. **No handle leaks in the tested paths.** QuickJS aborts on dispose when a handle leaks. Repeated loads, evaluations, each fault type, a guest that ends close to the memory limit, unloads, and dispose gave zero aborts.
5. **QuickJS is fragile close to its memory limit.** `computeMemoryUsage` traps on a heap that reached the limit, and the dispose that follows aborts. A guest that catches out-of-memory errors while a host function exists can make `evalCode` trap with `memory access out of bounds`. The first version of this slice read the memory total after each entry; the review found the abort, and the check was removed. One WASM instance for each extension keeps such a trap inside one extension.

## Effects

- The extension boundary (EXT-05) exists as a tested package: manifest, capabilities, node and asset type registration, and node evaluation with copied data.
- Interruption, hostile loops, leaked handles, denied access, and failure recovery have tests.
- The WASM memory maximum of each instance is the hard memory bound (see Memory bound). EXT-13 stays open until macOS and the WebKit worker are checked.
- No wire API, show file, Blueprint file, or UI changes. No app process loads the package yet.

## Risks

- The watchdog replaces a whole worker. All extensions in it reload, and a reload can fail again.
- Time limits inside the VM are soft, so a node call can block its worker up to `watchdogMs`. Blueprint evaluation must not wait for a guest node in the simulation tick.

## Memory bound (selected)

The owner selected option 1, a low maximum memory for each WASM instance (2026-10-16). The release variant accepts a `WebAssembly.Memory` from the caller (`newVariant(base, { wasmMemory })`), and its default maximum is 32768 pages (2 GiB). The sandbox gives each instance its own memory with a maximum of `heapBytes` (default 64 MiB). This is the same hard bound from WASM as a custom build, without an Emscripten build step. A custom build stays possible if a later need (for example a smaller module) comes up.

With a 64 MiB maximum, the object, array, buffer, and string guests stop with `memory` in less than 0.3 s, the WASM memory stays at or below 63 MiB, and the runtime disposes without an abort. The guest that catches out-of-memory errors near the limit no longer makes `evalCode` trap.

At the limit, `dump` of the QuickJS error can return an empty string, and QuickJS throws `null` when it cannot build the out-of-memory error. The sandbox reads only the error `name` and `message`, with the QuickJS limit lifted for the read, and it reports `null` as `memory`. A guest that throws `null` itself is also reported as `memory`.

Binary buffer types stay hidden. Guests do not need them yet, and hiding them is reversible.

The candidates were:

1. A custom QuickJS WASM build with a low `MAXIMUM_MEMORY` (for example 64 MiB) for each instance. This gives a hard bound from WASM. It needs an Emscripten build step. Selected (implemented through `wasmMemory`, above).
2. Patch the QuickJS allocator so that array and buffer storage counts against the limit. It needs a fork of the C source and the same build step.
3. Accept the WASM heap maximum (about 2 GiB for each extension) and the watchdog as the bound. It needs no build step, but one extension can use about 2 GiB.

Gate: a hostile guest that allocates arrays, strings, and buffers stops below the limit plus a stated margin, in a worker, on macOS and Linux. Linux passes with this change. macOS Node is an owner check on this PR. The WebKit Web Worker check needs the Scene window worker entry (later slice).

## Out of scope

Blueprint editor and runtime use of guest nodes, guest asset adapters that read bytes, TypeScript transpile, the extension package format, extension install UI, the Scene window worker entry, and the scripting API audit (EXT-14).
