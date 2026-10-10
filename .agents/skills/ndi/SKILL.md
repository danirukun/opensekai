---
name: ndi
description: >-
  Guides safe NDI integration and frame handling. Use for ANY work touching NDI
  (Network Device Interface): senders, receivers, discovery, Rust FFI, grafton-ndi,
  SDK/runtime setup, video/audio/metadata frames, memory leaks, frame queues,
  performance, shutdown, tests, or reviews. Applies across languages and products.
---

# NDI

Load this skill before any NDI work. Apply it to code that supplies or consumes
NDI frames, as well as direct SDK calls.

**Every native resource needs an owner, a release operation, and a known release
point. Every frame path needs a memory bound.** Rust ownership alone does not
establish either property across FFI.

## Start with the actual path

1. Read the product guide and find the SDK version, runtime, wrapper, local
   patches, and enabled features. Read the wrapper implementation, not only its API.
2. Trace capture/render → conversion → queue → send/display → release. Record
   the owner, thread, maximum retained frames, and release point at each step.
3. Identify the clock and stop/restart owner. Locate all error and early-return
   paths, including failed initialization and changes of source or resolution.
4. Read [reference.md](reference.md) for VCheki evidence, SDK links, known
   limitations, and regression scenarios. Treat product constants as examples.

## Ownership and release

| Resource | Required lifetime and release |
| --- | --- |
| Received video, audio, or metadata | Install a guard immediately after successful capture. Call the matching `NDIlib_recv_free_*` exactly once, with the receiver that captured it. |
| FrameSync output | Use the matching `NDIlib_framesync_free_*` function and FrameSync instance. Do not use receiver free functions. |
| Borrowed receive view | Keep its capture guard and receiver alive until the last read finishes. |
| Owned receive copy | Copy pixels and required metadata while the guard is alive. Release the original SDK frame separately. |
| Synchronous send | Keep pixels and metadata valid through the call. Reuse them after it returns. |
| Asynchronous send | Keep all referenced memory valid and unchanged until documented synchronization or completion. |
| Sender, receiver, finder, FrameSync | Destroy each successful instance once, after its dependents and users finish. |
| Runtime / loaded library | Keep it alive while instances, function pointers, SDK workers, or callbacks can use it. |

- Bind receive guards to the receiver lifetime in the safe API. `PhantomData`
  alone does not prove that an unsafe constructor received the right lifetime.
- Guard **before** validation, conversion, `?`, `continue`, or callbacks. Errors
  such as an unknown scan type can occur after an owned pixel copy was made.
- Never adopt SDK memory with `Vec::from_raw_parts`, `Box::from_raw`, or
  `CString::from_raw`. Use the SDK's release function. Copy into Rust ownership
  when data must outlive the capture guard.
- `to_raw` should borrow an owned `Vec`/`CString`. Do not allocate and abandon a
  new raw pointer per frame. Audit metadata as well as the large pixel buffer.
- Release SDK frames promptly. Do not hold them in UI queues or across unrelated
  I/O. RAII covers normal returns and unwinding, not process aborts.

## Sending: preserve the Windows fix

Default to synchronous `NDIlib_send_send_video_v2` on a dedicated worker with a
bounded queue. VCheki changed from an async ring to synchronous sends because
`AsyncVideoToken::drop` could hang in `flush_null_frame` on Windows.

- Reuse owned storage after the synchronous call returns. This establishes
  buffer lifetime; it does not mean the call is nonblocking.
- Keep NDI work off the render/UI thread. The native VCheki path uses a one-slot
  channel and `try_send`; a full queue drops the submitted frame.
- If a measured need requires async, write the buffer-state and shutdown contract
  first. A ring size alone is not completion proof. Do not mutate, resize, free,
  or recycle pixels or metadata while the SDK holds them.
- Standard async reuse depends on completion of a synchronizing call. Advanced
  completion callbacks require the correct SDK feature; they can arrive on SDK
  threads and out of order. Keep callback state alive and synchronization short.
- Dropping a token can block. Do not use `mem::forget` to hide the flush problem.
  Do not trust a timeout argument without inspecting the implementation.
- Audit sender destruction even after synchronous-only use. The vendored
  wrapper still calls its flush helper in `Inner::drop`.
- A null **frame pointer** and a non-null zeroed frame with null `p_data` are
  different calls. Verify the installed SDK contract before implementing a flush.

## Validate frames before unsafe access

Validate raw input before casts, allocation, slice creation, or pointer reads:

- Positive dimensions; supported FourCC and scan type; valid rate denominator.
- Checked conversions and checked multiplication/addition for stride, planes,
  and total bytes. Enforce a product memory limit and Rust slice size limits.
- Non-null, valid, suitably aligned pointers for the type read. Arithmetic checks
  cannot prove that an arbitrary pointer names a sufficiently large allocation.
- Validate metadata with the SDK's length and termination contract. Pixel bounds
  do not make `CStr::from_ptr` safe. Check lengths before slice creation and cap
  owned metadata copies; do not scan arbitrary memory for a terminator.
- Read the stride/size union according to FourCC. Compressed byte length is not
  row stride. Planar video and padded audio need their own layout calculations.
- For packed four-channel rows, require stride ≥ width × 4. Either copy each
  row's active bytes or explicitly reject padding. Never silently flatten it.
- Validate an owned buffer against the descriptor sent to FFI. Public mutable
  fields can invalidate assumptions that were true when the frame was built.

Keep byte order and alpha explicit. BGRA bytes may be sent as BGRX for an opaque
output; do not label them RGBA. RGBX/BGRX has no meaningful alpha. Set alpha to
255 when converting it for an alpha-aware consumer. Preserve RGBA/BGRA alpha
when required. Preserve actual dimensions and aspect ratio through orientation
changes; do not inherit a helper's fixed 16:9 default.

## Bound work and keep frames current

- For live preview/input, prefer one replaceable latest-frame slot. For output,
  use a bounded queue with an explicit full-queue policy. Count queued, in-flight,
  copied, encoded, and displayed frames when calculating the memory bound.
- Reuse allocations where ownership allows it. Release replaced frames and
  `ImageBitmap` objects. Bound encoder jobs and IPC calls as well as Rust queues.
- Protect stop/restart against late results with a session generation or equivalent
  check. Discard and release results from an old source or output configuration.
- Run blocking capture on a worker with a finite poll interval. Back off on
  repeated errors and limit repeated logs. Keep locks out of blocking SDK calls.
- Use one pacing authority. The native engine is the clock and disables NDI
  clocking. The legacy Tauri sender enables it. Preserve the contract of the path
  being changed; do not apply either setting everywhere.
- Keep the production image independent of UI refresh. Browser animation and
  canvas work can slow when a window is hidden. Test background operation.
- Protect higher-priority sinks. VCheki skips NDI work under GPU-share pressure.
  Prefer native frames over a new GPU → webview → JPEG → Rust round trip.

## Stop, restart, and runtime setup

Stop accepting work → signal the worker → finish or release in-flight buffers
under the SDK contract → join the worker → destroy instances → release remaining
application storage. Serialize lifecycle changes. Avoid joining while holding
a lock the worker needs. A capture timeout does not bound a blocked send or join.
Destroy a FrameSync instance before its underlying receiver.

Use one explicit runtime lifetime policy. The native VCheki loader retains one
process-wide load through `OnceLock`. This bounded lifetime is distinct from
leaking frames or loading a new library on every reconnect. A managed teardown
must wait until all SDK users and callbacks finish.

For SDK/build work, match headers, ABI, target architecture, and runtime. Check
`repr(C)`, field offsets, size, alignment, and exact function signatures. Select
cross-build paths from the **target** OS. Check case-sensitive SDK directories
and Git LFS payloads. If NDI is optional, missing runtime support must not prevent
unrelated features from starting.

## Verify the changed contract

1. Unit-test changed logic: malformed layouts, ownership on error, queue overflow,
   buffer reuse, stale results, and lifecycle transitions. Fake release callbacks
   or an injectable FFI table can prove exactly-once cleanup without the SDK.
2. Use a real receiver for the SDK/network boundary. Check dimensions, channel
   order, aspect, and stop/restart. Allow for codec color differences.
3. Stress slow consumers, disconnect/reconnect, source changes, resolution changes,
   repeated start/stop, and background operation. Check queue depth, outstanding
   frame counts, memory after warm-up, thread counts, and shutdown time.
4. Run on each affected target, especially Windows for async/flush changes. A
   cross-build proves compilation only. A skipped runtime test is not a pass.

Report the ownership or layout change, the tests run, and any runtime/platform
checks that remain unverified. Do not claim leak freedom from a short RSS sample
or a successful build alone.
