# REASONS: Diagnostics test wait

## R — Requirements

Make `diagnostics_integration.rs` independent of scheduler timing (#160). Each wait for an effect in another task polls with a deadline that is less than the 2 s publisher clock credit, and fails with a message that names the expected state and the last state. The tests still fail when the host never stores the diagnostics. Do not change product behavior.

## E — Entities

- Snapshot state: the HTTP status and the JSON body of `GET /diagnostics/output_main` with the operator token.
- Expectation: a predicate on the snapshot state and a short name for the failure message.
- Socket barrier: a wire `ping` with a request ID, and the `pong` with the same ID from the host.

## A — Approach

Add `wait_snapshot(service, what, predicate)`. It reads the snapshot every 5 ms until the predicate is true, or until 1 s passes. At the deadline it panics with `what`, the last status, and the last body. Use it after each stored message, after the renderer close, and after the invalid message. Add `barrier(socket)`. It sends a `ping` and reads messages until the matching `pong`. Use it after the rate-limited message, then read the snapshot once. Keep the 1000 ms sleep that measures the rate-limit interval.

## S — Structure

- `apps/desktop/src-tauri/tests/diagnostics_integration.rs`: the two helpers and the replaced sleeps.
- `docs/testing.md`: one line about a socket barrier for an effect that must not occur.

## O — Operations

1. Write the analysis and this contract.
2. Replace the seven 20 ms sleeps.
3. Prove the old flaw: add a temporary 50 ms delay to the host diagnostics handler. The old test fails; the new test passes. Remove the delay.
4. Prove the safeguard: make the host skip the diagnostics insert. The new tests fail with the expectation message. Restore the code.
5. Run the file 20 times, `cargo test --workspace`, `cargo clippy`, and `cargo fmt --check` for the changed file.
6. Ask a reviewer on a different model for defects against the acceptance criteria.

## N — Norms

Write prose in ASD-STE100 Simplified Technical English. Match the helper style of `evaluation_integration.rs`. Add a comment only where the reason for the deadline or the barrier is not clear.

## S — Safeguards

- The deadline is 1 s, which is less than the 2 s publisher clock credit.
- Each poll predicate is true only when the host accepted or removed the snapshot as expected.
- The barrier proves the order on one socket. Do not use it for a close, because the host removes the snapshot after its read loop ends.
- Do not check a parity box. The change is test-only.
