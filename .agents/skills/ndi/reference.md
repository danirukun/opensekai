# NDI evidence and application checks

## Source map

Paths below are relative to the VCheki checkout. In the ecosystem workspace,
use `projects/vcheki/`. From OpenSekai, use the sibling `../vcheki/`. Read the
current source before applying a pattern.
The reviewed revision was `39c99fed8ea3b67a1a22e6d017ee0128c71ec620`.

| Source | What to inspect |
| --- | --- |
| `crates/vcheki-engine/src/ndi_sender.rs` | `NdiSender::send`, `frame_desc`, `Drop`: synchronous BGRX output, frame shape, sender destruction. |
| `crates/vcheki-engine/src/sink.rs` | `NdiStage`, `SinkRack`, `should_skip_ndi`: worker-owned sender, one-slot queue, nonblocking submission, join on stop. |
| `crates/vcheki-engine/src/ndi_lib.rs` | `library`, `load`, `VideoFrame`: process-wide dynamic load, optional runtime, ABI declarations and tests. |
| `src-tauri/src/ndi.rs` | `NdiSession::send_jpeg_frame`: reusable owned RGBA frame and the Windows async-token flush warning. |
| `src-tauri/src/ndi_input.rs` | `run_capture_loop`, `stop_session`: finite capture polling, latest-frame slot, reused allocation, binary IPC. |
| `src-tauri/vendor/grafton-ndi/src/capture.rs` | `RecvGuard`, `CaptureKind`, `capture_video_raw`: guard before fallible processing; matching video/audio/metadata frees. |
| `src-tauri/vendor/grafton-ndi/src/receiver.rs` | `capture_video_ref`, `capture_video_timeout`: borrowed guard and owned-copy paths. |
| `src-tauri/vendor/grafton-ndi/src/frames.rs` | `validate_video_layout`, `VideoFrameRef`, `VideoFrame::from_raw`, `VideoFrame::to_raw`: layout checks, copy semantics, borrowed metadata pointer. |
| `src-tauri/vendor/grafton-ndi/src/sender.rs` | `AsyncVideoToken::drop`, `flush_null_frame`, `flush_async`, `Inner::drop`: actual completion and shutdown behavior. |
| `src/lib/services/ndi-input.ts` | `fetchFrame`, `closeCurrentBitmap`: binary frame parsing and bitmap release. |
| `src/lib/workers/ndi-jpeg-encoder.worker.ts` | Legacy off-main-thread JPEG encoding and transferred buffers. |
| `crates/vcheki-engine/tests/ndi_output.rs` | Real receiver test: discovery, dimensions, color bars with tolerance, removal after stop. |
| `src-tauri/Cargo.toml`, `src-tauri/vendor/grafton-ndi/build.rs` | Local dependency patch and target-OS build selection. |
| `scripts/vcheki-ndi-env.sh`, `third_party/ndi/README.md` | SDK path selection, case-sensitive layouts, and LFS checks. |

History supplies the reason for the sender choice:

- `ed4d08f2` replaces the rotating async buffer ring with an owned frame and
  synchronous send. Its code records the Windows token-drop flush hang.
- `c1800b20` records the background-window performance fix: worker encoding,
  bounded in-flight sends, one lifecycle owner, and synchronous Rust sending.

These are specific observations. Do not infer that every NDI async API leaks,
or that every product needs the legacy JPEG transport.

## SDK contracts

Read the headers for the runtime being used. VCheki keeps them under
`third_party/ndi/macos/include/` and `third_party/ndi/windows/Include/`.

- `Processing.NDI.Send.h`: exact send symbols and synchronization contracts.
  [NDI-SEND](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-send)
  explains async buffer retention and synchronization. Use the symbol spelling
  from the installed headers.
- `Processing.NDI.Recv.h`: capture and matching free operations.
  [NDI-RECV](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-recv).
- `Processing.NDI.FrameSync.h`: FrameSync output uses its own release API.
- `Processing.NDI.structs.h`: FourCC, layout, stride/size union, and aspect fields.
  [Frame Types](https://docs.ndi.video/all/developing-with-ndi/sdk/frame-types).
- [Advanced asynchronous completions](https://docs.ndi.video/all/developing-with-ndi/advanced-sdk/ndi-sdk-review/sending/asynchronous-sending-completions):
  callback thread and completion ordering rules. Do not assume the standard
  runtime exposes these features.

## Known limitations: do not copy these as guarantees

- `flush_null_frame` passes a non-null descriptor with null pixel data. This is
  not the same argument as a null descriptor pointer. Validate flush semantics
  against the SDK. `Inner::drop` uses this helper even for synchronous-only use.
- The standard wrapper's `flush_async` ignores the supplied timeout and performs
  a blocking flush. An apparent timeout does not establish bounded shutdown.
- `NdiStage` isolates a blocked sender from rendering, but `stop` still joins
  the worker. Queue bounds do not establish a shutdown deadline.
- The legacy receiver rejects padded rows and compressed data. That is its
  supported subset, not a general NDI restriction.
- The native `frame_desc` uses unchecked casts and products. The skill requires
  checked validation at boundaries; this helper is not a general input validator.
- The vendored wrapper validates several receive layouts, but public owned-frame
  fields can change after construction. Validate before passing them to FFI.
  Check planar layouts and audio channel stride separately.
- The legacy frontend closes the previous bitmap, but an in-flight fetch can
  finish after stop. Add a generation check when changing that lifecycle. The
  skill's stale-result rule is recommended hardening, not a claim it exists there.
- The native loader deliberately retains one library for process lifetime. Do
  not copy its failure paths into a retrying loader without defining cleanup.
- The real-receiver test is macOS-only and can skip when NDI is unavailable.
  It proves neither Windows behavior nor sustained memory stability.

## Ownership example

Adapt this sequence to the wrapper in use; these are pseudocode operations,
not a proposed public API:

```text
raw = capture(receiver)
if raw.kind is video:
    guard = own_sdk_video(receiver, raw.video)  # before anything fallible
    layout = validate(guard.frame)?            # error still releases SDK frame
    owned = copy_pixels_and_metadata(guard, layout)?
    drop(guard)                               # SDK allocation released once
    publish_to_latest_slot(owned)             # replaces/releases old owned data
```

Copying and freeing are separate operations. `VideoFrame::from_raw` copies
pixels and metadata; it does not release the source SDK frame. In the wrapper,
`VideoFrameRef` keeps a `RecvGuard` alive during this copy. A later invalid scan
type can return an error after the copies were allocated. Rust drops those
copies, while the guard releases the original frame.

## Regression scenarios

| Change or symptom | Required application check |
| --- | --- |
| Replace sync send with async for speed | Trace pixels and metadata through completion; inspect token Drop and sender Drop; test Windows stop/restart and stalled receivers. |
| Add fallible conversion after capture | Force validation failure and failure after copying; count one matching SDK release in both paths. |
| Memory grows with slow UI | Account for all queues and in-flight jobs; bound them; verify replaced resources are released. |
| Add a new pixel format | Test actual channel order, alpha policy, padded rows, planes, short data, overflow, and the stride/size union. |
| Change orientation or source while busy | Prevent old results from entering the new session; check dimensions and aspect at the receiver. |
| Minimize or obscure the window | Measure production output separately from preview refresh and webview scheduling. |
| Change dynamic loading or SDK packaging | Exercise missing runtime, missing symbol, wrong architecture, stale paths, and LFS pointers; preserve unrelated sinks. |

For a memory soak, record resolution, rate, runtime version, duration, frame
counts, queue bounds, and retained allocations after warm-up. Repeat connect,
disconnect, and stop/start. Check whether retained memory grows with each cycle.
Allocator caching can keep RSS above the starting value; combine RSS with
ownership counters or a native allocation profiler.
