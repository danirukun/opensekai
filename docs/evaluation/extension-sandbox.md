# Extension sandbox gate evidence

Slice: [extension sandbox gate](../../spdd/prompt/2026-10-16-extension-sandbox-gate.md) (B10, #98, #106). Base commit `1be1a11`. Platform: Linux cloud, Ubuntu 24.04 x86_64, Node 26.10.0 (`/root/.cache/opensekai/node`, from `scripts/cloud-setup.sh`), no GPU. Engine: `quickjs-emscripten-core` 0.32.0 with `@jitl/quickjs-wasmfile-release-sync` 0.32.0. Renderer backend: not applicable. macOS and Windows: not checked.

## Tests

| Requirement | Test |
| --- | --- |
| R1 manifest | `sandbox.test.ts` › rejects an invalid manifest, a duplicate ID, and a source above the size limit |
| R3 globals | `sandbox.test.ts` › gives the guest no host globals and a frozen API |
| R4, R7 nodes and copied data | `sandbox.test.ts` › loads a guest node…; copies vector3 values both ways… |
| R5 asset types | `sandbox.test.ts` › rejects invalid registrations, reserved file extensions, conflicts, and registration quotas |
| R6, R8 denied | `sandbox.test.ts` › disables an extension that calls an API without its capability…; allows registration only while the extension loads |
| R8 limits | `sandbox.test.ts` › stops a hostile loop…; stops memory and stack exhaustion; enforces the log quota…; disables an extension that returns outputs outside its declared ports |
| R10 handles | `sandbox.test.ts` › reloads a failed extension and releases every QuickJS handle on unload and dispose |
| R9 near the limit | `sandbox.test.ts` › disables a guest that ends close to the memory limit and releases its handles |
| R13 | `sandbox.test.ts` › reserves an ID while it loads…; keeps an extension running when a host callback throws |
| R14 WASM memory maximum | `sandbox.test.ts` › stops object, array, and string allocation with a memory fault under the WASM memory maximum (fails without the maximum: arrays took 13.1 s); rejects a WASM memory maximum below the initial heap |
| R12 watchdog | `client.test.ts` (fake thread boundary); `worker.integration.test.ts` (real Node worker thread) |

## Limit measurements with the WASM memory maximum

The owner selected a hard WASM memory maximum for each instance (#106, option 1). Default limits: 16 MiB QuickJS limit, 64 MiB WASM memory maximum, 256 KiB stack, 250 ms load, 5 ms call. Each case loads a new extension into one sandbox in process (no worker). Output:

```
node v26.10.0
-- default limits
plain-loop load 279 ms {"ok":true,"status":{"id":"dev.m.plain-loop","state":"failed","cause":{"code":"timeout","message":"Time limit exceeded"}}}
plain-loop-call call 6 ms {"ok":false,"failure":{"code":"timeout","message":"Time limit exceeded"}}
object-hog load 298 ms {"ok":true,"status":{"id":"dev.m.object-hog","state":"failed","cause":{"code":"memory","message":"Memory limit exceeded"}}}
array-hog load 129 ms {"ok":true,"status":{"id":"dev.m.array-hog","state":"failed","cause":{"code":"memory","message":"Memory limit exceeded"}}}
string-hog load 201 ms {"ok":true,"status":{"id":"dev.m.string-hog","state":"failed","cause":{"code":"memory","message":"Memory limit exceeded"}}}
array-hog-call call 112 ms {"ok":false,"failure":{"code":"memory","message":"Memory limit exceeded"}}
native-spin-call call 28481 ms {"ok":false,"failure":{"code":"timeout","message":"Time limit exceeded"}}
rss MiB 227 discarded 0
-- no deadline (loadMs 60000)
object-hog load 261 ms {"ok":true,"status":{"id":"dev.m.object-hog","state":"failed","cause":{"code":"memory","message":"Memory limit exceeded"}}}
array-hog load 117 ms {"ok":true,"status":{"id":"dev.m.array-hog","state":"failed","cause":{"code":"memory","message":"Memory limit exceeded"}}}
string-hog load 187 ms {"ok":true,"status":{"id":"dev.m.string-hog","state":"failed","cause":{"code":"memory","message":"Memory limit exceeded"}}}
rss MiB 271 discarded 0
-- WASM memory size after each guest stops (raw QuickJS, 4 MiB QuickJS limit, 64 MiB WASM maximum, no deadline)
objects 56 ms error 23 MiB WASM memory
strings 190 ms error 63 MiB WASM memory
arrays 75 ms error 63 MiB WASM memory
buffers 61 ms error 63 MiB WASM memory
```

## Limit measurements before the WASM memory maximum

These runs used the release variant with its default 2 GiB WASM maximum. Default limits: 16 MiB memory, 256 KiB stack, 250 ms load, 5 ms call.

```
node v26.10.0
plain-loop load 278 ms {"ok":true,"status":{"id":"dev.m.plain-loop","state":"failed","cause":{"code":"timeout","message":"Time limit exceeded"}}}
plain-loop-call call 7 ms {"ok":false,"failure":{"code":"timeout","message":"Time limit exceeded"}}
object-hog load 254 ms {"ok":true,"status":{"id":"dev.m.object-hog","state":"failed","cause":{"code":"memory","message":"Memory limit exceeded"}}}
array-hog load 682 ms {"ok":true,"status":{"id":"dev.m.array-hog","state":"failed","cause":{"code":"timeout","message":"Time limit exceeded"}}}
array-hog-call call 523 ms {"ok":false,"failure":{"code":"timeout","message":"Time limit exceeded"}}
string-hog load 684 ms {"ok":true,"status":{"id":"dev.m.string-hog","state":"failed","cause":{"code":"timeout","message":"Time limit exceeded"}}}
native-spin-call call 26713 ms {"ok":false,"failure":{"code":"timeout","message":"Time limit exceeded"}}
rss MiB 325 discarded 0
```

Guests: `for (;;) {}`; `const k = []; for (;;) k.push({ n: k.length })`; `const k = []; for (;;) k.push(new Array(1 << 14).fill(0))`; `const k = []; for (;;) k.push('x'.repeat(1 << 16) + k.length)`; `for (;;) new Array(1 << 20).fill(0)`.

Memory held by the array guest when the deadline interrupted it (raw QuickJS, 16 MiB limit):

```
array-hog load 630 ms 313 MiB
array-hog call 525 ms 313 MiB
```

QuickJS limit without a deadline (raw QuickJS, 4 MiB limit, one WASM instance for each case):

```
objects 57 ms out of memory 14.3 MiB used
strings 10394 ms out of memory 0.3 MiB used
arrays 9832 ms out of memory 1791.6 MiB used
buffers 8986 ms out of memory 2041.8 MiB used
```

The strings case shows 0.3 MiB because the runtime released the strings after the error. It ran for 10.4 s before the error.

## Result

- Near the limit: `computeMemoryUsage` traps (`null function or function signature mismatch`) on a heap that reached the limit, and then the runtime dispose aborts. A guest that catches out-of-memory errors while a host function exists can make `evalCode` trap with `memory access out of bounds`. The sandbox does not call `computeMemoryUsage`, and it reports a trap as an `error` fault in that extension only.
- Pass on Linux: hard memory bound. With a 64 MiB WASM maximum, object, array, string, and buffer guests stop with `memory` in less than 0.3 s, and the WASM memory stays at or below 63 MiB. Before the maximum, arrays reached 1792 MiB and buffers 2042 MiB.
- Pass on Linux: interruption of plain loops, stack limit, quotas, denied capabilities, registration only at load, output validation, no leaked handles, and recovery after the watchdog in a real worker thread (1000 ms watchdog).
- At the limit, `dump` of a QuickJS error can return an empty string, and QuickJS throws `null` when it cannot build the out-of-memory error. The sandbox reads only `name` and `message`, with the QuickJS limit lifted for the read, and it reports `null` as `memory`.
- Soft: the time limit inside the VM. Native-heavy loops overshoot by seconds. The worker watchdog is the hard bound.
- Unknown: macOS (Node and WebKit Web Worker), Windows, and the WASM instance cost in the Scene window. The WASM memory starts at 16 MiB for each extension.
