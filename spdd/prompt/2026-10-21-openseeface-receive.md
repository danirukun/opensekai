# REASONS: OpenSeeFace receive

Analysis: [OpenSeeFace receive](../analysis/2026-10-21-openseeface-receive.md). Issue: [#25](https://github.com/danirukun/opensekai/issues/25) (TRK-08 first subset). Queue bundle B20.

## R — Requirements

1. A tracking source can have the kind `openseeface`. Config: `{kind:'openseeface', enabled:boolean, bindAddress:ip, port:1..65535, senderAddress:ip|null}`. `defaultTrackingConfig('openseeface')` gives `127.0.0.1`, `11573`, `null`, disabled.
2. An `openseeface` source can be only the face source of an avatar. A `scenePatch` or show that sets it as a body or finger source is rejected, with the same rule as `ifacialmocap`.
3. The host binds one UDP endpoint for each enabled `openseeface` source. Endpoint planning, sharing by sender address, "Endpoint used by <name>", `unmatchedPackets`, the status states, the generation, and the clock path are the same as for VMC. Two `openseeface` sources share an endpoint only when each has a different sender address.
4. A datagram is valid only when its length is 1785, 3570, 5355, or 7140 bytes (1 to 4 face records). Each other length is invalid and increments `invalidPackets`. The decoder reads little-endian values with the layout in the analysis.
5. The datagram is invalid when a record has a non-finite eye value, quaternion value, or feature value, or when a usable record has a quaternion with a length outside 0.5..2. A record is usable when its 3D fit success byte is not 0. A failed fit sends a zero quaternion, so the length check does not apply to a record that is not usable (2026-10-25, implementation finding). The decoder normalizes the quaternion of the chosen record. A datagram with no usable record is valid; it increments `packets` and does not change the sample.
6. From the usable records of one datagram, the decoder uses the record with the lowest face ID. The sample has:
   - `head`: rotation from the record quaternion, converted from the tracker camera frame to the OpenSekai normalized head frame, `space:'normalized'`. Facing the camera with no rotation in the tracker gives identity. A performer who turns the head to their left turns the avatar head to its left; the same holds for up and for a tilt to the left.
   - No `leftEye` or `rightEye` bone, no head position, no `root`.
   - `expressions`: the ARKit map in the analysis, each value clamped to 0..1, with ARKit names from `ARKIT_NAMES`.
7. Smoothing, calibration (**Calibrate**, in the editor and MCP), face mapping, and overrides work for an `openseeface` source as for an `ifacialmocap` source. No code path in the session checks for `ifacialmocap` by name where the face-only rule must also hold for `openseeface`.
8. Editor: **Add Asset** has "OpenSeeFace Receiver". The asset list has the group "OpenSeeFace Receivers". The Inspector shows Bind address, Port, Sender address, Start/Stop, state, error, and the diagnostics, with the same controls as a VMC source. No new helper text.
9. MCP: `scene_patch` accepts the new kind through the shared contract schema. No new MCP tool.
10. Not in this slice: starting or bundling the tracker, a face ID setting, head translation, eye bones and gaze, the Warudo sensitivity settings, Body Movement Intensity.

## E — Entities

- `TrackingConfig` (TS union and Rust enum): add `{kind:'openseeface', enabled, bindAddress, port, senderAddress}`.
- `SourceKind` (`endpoints.rs`): add `OpenSeeFace`.
- `OsfRecord` (Rust, decoder internal): `{id:i32, success:bool, eyeOpen:[f32;2] (right, left), quaternion:[f32;4], features:[f32;14]}`. The decoder does not keep landmarks, 3D points, Euler angles, or translation.
- Constants: `OSF_RECORD_BYTES = 1785`, `OSF_MAX_RECORDS = 4`, `OSF_DEFAULT_PORT = 11573`.

## A — Approach

- `parser.rs`: a pure `Decoder::openseeface(bytes) -> Result<bool, AppError>`. It checks the length, reads each record at its offset with `f32::from_le_bytes` (and `i32`, `u8`), picks the record, converts the quaternion, and maps the features. It returns `Ok(false)` for a valid datagram with no usable record, so the sample does not change. Helper functions `osf_head(quaternion) -> Quat` and `osf_expressions(record) -> BTreeMap<String, f64>` are pure and tested alone.
- The axis conversion: read the head conversion in VSeeFace's OpenSeeFace driver (`OpenSeeVRMDriver.cs` or the matching OpenSeeFace Unity example) before code. Record the exact conversion and its source in the analysis. Recorded 2026-10-25: `head = √½ · (w + z, w − z, x + y, x − y)` from the packet quaternion (x, y, z, w). The source and the solvePnP check are in the analysis, "Implementation findings". Then add unit tests with records for identity, a yaw of 30° to the performer's left, a pitch of 20° up, and a roll of 15° to the left, and check the sign of each axis of the result.
- `mod.rs`: the receive loop chooses the decoder by `SourceKind` (today a `bool ifacial`). No handshake for the new kind.
- `endpoints.rs`: the new kind uses the VMC sharing rule by sender address.
- Contracts (TS and Rust) add the kind in one commit with the face-only rule in `schema.ts`. The Rust and TS round-trip test covers the new kind.
- Editor and MCP reuse the VMC field set with the new defaults and labels.

## S — Structure

- Changed: `packages/contracts/src/tracking.ts`, `packages/contracts/src/schema.ts`, `crates/contracts/src/tracking.rs`, and their tests.
- Changed: `apps/desktop/src-tauri/src/tracking/parser.rs`, `endpoints.rs`, `mod.rs`; a new UDP integration test next to the existing tracking ones in `apps/desktop/src-tauri/tests/`.
- Changed: `apps/desktop/src/editor/authoring.ts`, `asset-groups.ts`, `live-fields.ts`, `apps/desktop/src/components/TrackingSourceFields.svelte`, and their existing tests.
- Changed: `ARCHITECTURE.md` (Processes diagram and Tracking path: OpenSeeFace senders, the third decoder).
- Changed: `docs/warudo-parity.md` TRK-08 with only the verified subset and the gaps in requirement 10.
- New: `docs/evaluation/openseeface-receive.md` (evidence).
- New fixture: `fixtures/protocol/openseeface-*.bin`, small hand-built records (no camera data), made by a test helper that is checked in.
- No change: the show file version, the renderer, the output app.

## O — Operations

1. Recheck the Warudo OpenSeeFace page and the OpenSeeFace sources. Record the source commit and the axis conversion in the analysis.
2. Add the kind to the TS and Rust contracts and the face-only rule. Add schema tests: defaults, a valid source, a body assignment rejected.
3. Add the decoder with unit tests: each valid length, each invalid length (0, 1784, 1786, 8925), success byte 0, a NaN value, a bad quaternion, lowest face ID chosen, each ARKit map entry and its clamp, and the four axis records.
4. Generalize the receive loop and the endpoint plan by kind. Add a unit test for two `openseeface` sources with two sender addresses on one endpoint.
5. Add an integration test at the real UDP boundary: send a 1785-byte record to the bound endpoint and read the sample from the credited clock; send a 1000-byte datagram and read `invalidPackets: 1`. Reason: the socket, routing, and clock are a real process boundary.
6. Add the editor kind, labels, and fields. Run the Editor flow headless: add "OpenSeeFace Receiver", check the defaults, start it, and see the state "Waiting". Then send a fixture record and see "Receiving".
7. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace`.
8. Ask a reviewer on a different model for defects against these requirements.
9. Update the parity line, `ARCHITECTURE.md`, and the evidence file.

## N — Norms

Rust: pure decoder functions, no panics on input, no `unwrap` on input bytes, the existing `invalid(...)` errors. TypeScript: functional, plain data, the compact style of the nearby tracking files. Controls come from `@oshi-connect/ui`. UI copy is the asset name, the group name, and the existing field labels (constitution principle 1). Prose follows ASD-STE100.

## S — Safeguards

- Do not start, bundle, or download OpenSeeFace or a model in this slice.
- Do not send UDP data to the tracker.
- Do not accept a datagram larger than 4 records or a length that is not a multiple of 1785.
- Do not let an `openseeface` source drive body or finger bones.
- Do not change the VMC or iFacialMocap decoders or their tests, other than the move from `bool ifacial` to a kind.
- Do not claim TRK-08 on macOS or Windows from the cloud run. The axis signs and the left and right sides need one owner check with OpenSeeFace and a real webcam (`accept:local`).
