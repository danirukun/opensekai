# Diagnostics test wait analysis

Issue: [#160](https://github.com/danirukun/opensekai/issues/160). Queue bundle B15.

## Problem

`apps/desktop/src-tauri/tests/diagnostics_integration.rs` sends a renderer `diagnostics` message and then sleeps a fixed 20 ms before it reads `GET /diagnostics/output_main`. The host reads the renderer socket in its connection task. The test reads the snapshot on a different HTTP connection. On a busy Linux container the host can handle the HTTP request before it handles the socket message. The snapshot is then absent (404 with an empty body), and `response.json()` fails with "EOF while parsing a value". This is the same class of defect as #158. `docs/testing.md` "Do not wait with a fixed sleep" forbids it.

The file has seven 20 ms sleeps. They wait for four different kinds of effect:

1. A diagnostics message that the host stores (first test; second test after sequence 1, sequence 3, and epoch 2).
2. A diagnostics message that the host must ignore because of the 1 s rate limit (second test, sequence 2).
3. A renderer socket close that removes the snapshot (second test).
4. An invalid diagnostics message that makes the host close the renderer and remove the snapshot (second test, sequence 4).

The 1000 ms sleep in the second test measures the rate-limit interval. It is a correct fixed sleep (the test measures elapsed time).

## Existing material

- The #158 fix (`wait_unavailable` in `evaluation_integration.rs`) polls every 5 ms with a 1 s deadline and panics with the last value.
- The host handles each renderer text message in order in one read loop. A wire `ping` gets a `pong` from the same loop (`service/mod.rs`, `WireMessage::Ping`). When the test receives the `pong`, the host has handled each earlier message on that socket.
- The test publisher does not answer clock pulses, so the host drops it 2 s after the clock credit starts.

## Decisions for this slice

- Change the test only. Do not change the service.
- For a stored message, a socket close, and an invalid message, poll the snapshot every 5 ms with a 1 s deadline. Panic with the expectation and the last HTTP status and body. 1 s is less than the 2 s publisher clock credit.
- For the rate-limited message, a poll cannot prove that a value does not change. Send a wire `ping` after the message and wait for the `pong`. Then read the snapshot once and expect sequence 1.

## Risks

- A poll that hides a product bug. A stored snapshot appears only when the host accepts the message, so a poll for `geometries == 5` or `rendererEpoch == "epoch_2"` cannot pass by accident. Prove that the test fails when the host never stores diagnostics.
- A total test time near the 2 s clock credit. The polls return as soon as the state is correct, so the total time stays near the 1 s rate-limit sleep, as before.
