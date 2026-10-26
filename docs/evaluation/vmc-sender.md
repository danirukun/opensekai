# VMC sender check

Date: 2026-10-25. Scope: MED-09, bundle B21 ([#67](https://github.com/danirukun/opensekai/issues/67)). Contract: [VMC sender](../../spdd/prompt/2026-10-21-vmc-sender.md). Base commit: 86686e0 plus the B21 implementation branch changes.

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no OBS, no other VMC application). Node 26.10.0, pnpm 12.8.1, rustc 1.93.1, Playwright Chromium (headless) from `/opt/pw-browsers`. Fixtures: `fixture_vrm_1` (VRM 1 Constraint Twist Sample) and `fixture_vrm0_arkit` (VRM 0 ARKit avatar) from `fixtures/local`.

This check proves the OpenSekai to OpenSekai round trip, the byte format, the host sockets on loopback, and the editor flow. It does not prove a real receiver (VSeeFace, VirtualMotionCapture, or a second OpenSekai on another computer), the axis convention that a real receiver expects for a VRM 1 rig, the send cost, or a send that continues while the Scene window is minimized on macOS.

## Host encoder and sockets (Rust, verified)

| Check | Test | Result |
| --- | --- | --- |
| The encoder is the inverse of the decoder: position `(x, y, -z)`, rotation `(-x, -y, z, w)` (R12) | `tracking::osc_out` `inverse_conversion_matches_the_decoder` | Pass |
| Thumb names reverse the decoder mapping (R12) | `thumb_names_reverse_the_decoder_mapping` | Pass |
| A pose with 55 bones and 64 blends splits into bundles of at most 1,200 bytes and 32 messages, each inside the decoder limits, and decodes to the same raw bones, root, and blends within `1e-6 × max(1, |value|)` (R15) | `full_pose_splits_and_round_trips` | Pass |
| `OK` and `T` first, then root, bones, blends, `Blend/Apply` last (R12) | `order_is_ok_time_root_bones_blends_apply`, `split_keeps_the_message_limit` | Pass |
| A blend name with NUL or more than 128 bytes is left out (R7) | `invalid_blend_names_are_left_out` | Pass |
| Loop guard: loopback, `127/8`, `::1`, a computer address, an IPv4-mapped computer address, and the receiver bind address conflict on the receiver port; another port or host does not (R11) | `vmc_sender` `loop_guard_*` (2 tests) | Pass |
| The VRM reader gives the version, the rest translations, the VRM 0 thumb keys, a chestless rig, `identityRest` false for a rotated bone or a rotated or scaled hips parent, and a matrix node (R6) | `assets::vrm` `rig_*` (2 tests) | Pass |
| Import fills `rig`; the library fills it for an older record and writes the record again; an unreadable file leaves no `rig` (R6) | `import_and_library_load_fill_the_rig` | Pass |
| Fixture records get `rig` from the same reader (R6) | `prepared_local_fixtures_load_and_read` | Pass: `fixture_vrm0_arkit` VRM 0, 54 rest positions, `identityRest` true; `fixture_vrm_1` VRM 1, 54 rest positions, `identityRest` false |

Integration tests over real loopback UDP ([raw output](vmc-sender/host-integration.txt)). These cross a real UDP socket, so they are integration tests. The manager tests use a mock clock with real sockets.

| Check | Test | Result |
| --- | --- | --- |
| The OpenSekai VMC receiver (`TrackingManager`) on another port decodes the sent root, bones, and blends | `opensekai_receiver_decodes_the_sent_pose` | Pass |
| A burst of 10 poses in 10 ms sends one datagram; 14 ms later nothing; 15 ms later one more; no pose for 1 s gives `waiting` (R13, R14) | `rate_cap_holds_under_a_burst` | Pass |
| A disabled sender and an unknown sender ID send nothing; a sender on the port of an enabled receiver of the same scene gets "Endpoint used by VMC Receiver"; an older revision changes nothing (R9-R11) | `disabled_unknown_and_loop_targets_send_nothing` | Pass |
| A record without `rig` gives "Character rest pose unknown"; `identityRest` false gives "Character rig not supported" (R14) | `character_errors_come_from_the_record` | Pass |
| The service sends a publisher `vmcPoses` to the target socket, never relays it to a renderer, `appStatus` returns `vmcSenders` with `sending` and 1 datagram, and a renderer cannot send poses (R9, R14) | `service_sends_publisher_poses_and_reports_status` | Pass |

## Session pose and the renderer (verified)

`vmcSendPose` unit tests (`packages/session/test/vmc-send.test.ts`): rest pose without a pose, base bones then weighted normalized tracking, raw values from rest and from the base value, the VRM 0 sign on base bones and offsets and not on tracking, offsets on the left of normalized and raw values, the hips position for each space and the root, a chestless rig, the preset name map, and no envelope without an enabled sender or a supported rig. Patch tests (`vmc-sender-patch.test.ts`): replace, wrong kind, `setTransform` rejected, bad ports and addresses, the fifth sender, avatar removal, and the start scene and show Open stop each sender.

Parity with the production renderer ([raw output](vmc-sender/parity-check.txt)). `packages/renderer/test/vmc-send-parity.integration.test.ts` loads each fixture VRM with the production `GLTFLoader` and `VRMLoaderPlugin`, runs `VRMUtils.rotateVRM0` as the asset loader does, applies six poses with the production `createAvatarBinding`, and compares the local rotation and position of each raw bone of the rig with `vmcSendPose`. The cases: base only, base with normalized tracking, partial weights, raw tracking without and with base bones, and offsets on normalized and raw bones.

- `fixture_vrm0_arkit` (VRM 0, so the sign cases apply): 6 cases × 54 bones, each rotation within 1e-4 rad and each position within 1e-6 m. Pass.
- `fixture_vrm_1`: the rig has rest rotations (`identityRest` false), so the sender refuses it. The test checks only that rule and compares no pose, so the VRM 1 path (no sign) is compared with the renderer by unit tests only. The contract expects this case (R17).
- The test builds the rig from the loaded three-vrm nodes, not from the Rust reader. The Rust fixture test checks the reader output for the same files separately.
- A chestless rig: no fixture has one. Unit tests cover it; the renderer comparison does not.

This check runs in Node, not in a browser on the software adapter: the pose composition is scene-graph math and uses no GPU. It uses the same loader and binding code as the renderer.

## Editor window (headless Chromium, verified)

Method. The check script runs the Editor window build in Chromium with a stand-in for the Tauri host that routes the operator WebSocket to a real `@opensekai/session`, as the B18 and B19 checks do. The stand-in host has no UDP sender: its `appStatus` reports an enabled sender as `waiting`, or as `sending` while the script sets a flag. So the `sending` text proves only that the Inspector shows the host state.

Script: [editor-check.mjs](vmc-sender/editor-check.mjs). Raw output: [editor-check.txt](vmc-sender/editor-check.txt). Result: 19 pass, 0 fail. Screenshots: [added](vmc-sender/editor-added.png), [sending](vmc-sender/editor-sending.png).

Checks: Add › VMC Sender with the add defaults; the VMC Senders group; the Sender section with no Transform section and no Visible box; IP Address and Port apply; a multicast address shows the alert and changes nothing; Character › None; Start shows `waiting`; the host state `sending`; Stop; Reset Port; Duplicate of a running sender makes a stopped copy; at four senders Duplicate and Add are disabled with "Scene asset limit reached"; a show Open with a running sender shows it stopped; no page error.

## MCP (verified)

`apps/mcp/test/vmc-sender.integration.test.ts` runs the real MCP stdio process with a real session: the `scene_patch` description, four senders and a fifth that fails, `setVmcSender`, the wrong kind, a multicast address, `app_status` with `vmcSenders` (from the fixture host), and avatar removal. Pass.

## Not verified (owner check on macOS)

- A real VMC receiver on the LAN (VSeeFace, VirtualMotionCapture, Warudo, or a second OpenSekai) shows the character move; the VRM 1 axis convention at that receiver.
- The send continues while the Scene window is minimized.
- The send cost at 60 poses each second for 4 senders: unknown.
- Windows: not checked.
