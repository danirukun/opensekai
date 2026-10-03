# Minimum live VTubing check

Checked on 2026-10-03. Final packaged source: `6d44c4a23a42f8db31459c1b50b1c03e8be18cd7`. Platform: macOS 27.0.1, WKWebView preview and OBS WebGPU at 1920×1080, 60 fps. This is a one-avatar check. It does not certify minimum hardware or a concert scene.

## Actual flow

| Deliverable | Result | Verified scope |
| --- | --- | --- |
| Import VRM | Passed | Normal startup outside the checkout, without fixture mode. Native chooser imported the supplied 91,619,676-byte VRM0. The macOS all-files chooser enabled Open; native validation still checks the content. |
| VMC receiver | Passed with mock | Actual UI Add passed at `f507cfc`. UI Start and real loopback UDP packets drove raw body bones. The final build received packets with zero invalid packets. |
| iFacialMocap receiver | Passed | Mock UDP drove head, jaw and blink. The user then confirmed physical iPhone control worked. Native status corroborates accepted traffic from the configured phone. |
| Mixed control | Passed with mock | VMC Body plus iFacial Face changed the avatar in OBS. PoseA raised arms and opened the mouth. Settled PoseB changed arm angle and head rotation, and closed the eyes. |
| Camera | Passed subset | Actual final-build Add created Camera 2. FOV 50 and Output selection reached preview and OBS. Near 200/Far 100 was rejected; the valid lens remained in the scene. |
| OBS | Passed clean source | The actual copied production URL rendered the avatar with transparent background and no marker. Camera changes and mixed mock poses reached this source. |
| MediaPipe | Passed local camera subset | UI Start loaded bundled face, pose and hand tasks in the release worker. Camera samples reached receiving with zero invalid packets. UI Body/Face assignments changed the avatar pose in OBS. Stop returned it to rest. Inference duration was measured separately. |

Paused UDP sources became stale and returned the avatar to rest. MediaPipe Stop released its controller. Raw-rest rig analysis and independent PNG checks confirmed intact lower-body geometry. A suspected missing lower body was a display interpretation error; no renderer change was required.

## Resolved acceptance defects

The macOS native chooser initially disabled Open for the VRM extension. The all-files chooser and persistent import-error fixes passed an actual import check at `72ace50`.

The copied production OBS URL initially enabled a diagnostic barcode. A regression failed before the fix and passed after it. At `f507cfc`, the actual clipboard URL had no diagnostics parameter and its settled OBS image had no barcode. An immediate blank screenshot before renderer loading is retained as a failed initial capture.

Changing iFacialMocap to the VMC port showed the receiver bind error. Restoring port 49983 returned it to waiting. Source generations changed and the scene remained intact.

An editor-only MediaPipe restart initially stayed waiting for 20 seconds with no inference metric. Activating Scene resumed tracking. The fix presents the fixed Scene owner before editor Start or an enabled configuration change. Packaged checks at `20898ff` and `6d44c4a` reached receiving without a manual window switch. Tests cover activation order and failure without enabling tracking. Switching back to Editor can make the camera owner stale; continuous background webcam capture is not certified.

The Output selector initially retained Wide/Close smoke IDs. It now derives choices from current scene camera IDs and names. A regression covers authored and renamed cameras. Actual Camera 2 selection passed at `6d44c4a`; preview and OBS acknowledged its stable ID and showed the full avatar.

## Timing and continuity

A 90-second local probe sampled 354 output acknowledgements. Render CPU p95 was 3.0 ms; maximum was 5.9 ms. Output sequence advanced 87693→93039 and tick 88677→94076. No renderer warnings were reported. OBS rendered 5416 frames with zero skipped render frames. Recording and streaming were idle, so this does not establish encoding performance.

Computer Use issued minimize for Editor and the remaining front OpenSekai window. The interval before restore was about 53 seconds. Native visibility was not independently measured. Six OBS images retained changing pose evidence. This is narrower than the earlier formal smoke checks.

Separate CPU inference measurements sampled 40 last-completed values over 20 seconds per configuration:

| Configuration | Source | Minimum | Median | p95 / maximum |
| --- | --- | --- | --- | --- |
| Face, pose and hands | `f507cfc` | 34 ms | 64 ms | 82 ms |
| Default face and pose | `20898ff` | 16 ms | 17 ms | 35 ms |

These are sampled values on this host, not every inference. Stop cleared the metric. The failed restart probe with zero measured samples is retained and is not a timing result. GPU duration, minimum hardware and concert performance remain unknown.

## Final capture and verification

At `6d44c4a`, clean OBS output acknowledged Camera 2 at revision 8. Mixed receiver PoseA and settled PoseB captures at revision 13 show distinct arm, head, mouth and blink states. Both receivers reported receiving with zero invalid packets. A later stopped-mock capture shows the avatar at rest.

MediaPipe Start automatically presented Scene. Both avatar assignments used the tracker at revision 10. MCP observed 1353 received samples, zero invalid packets and a 25 ms last-completed inference duration. The final still is near rest. It proves capture/status plumbing, not controlled motion. The earlier camera pose check remains separate. Actual UI Stop cleared the metric.

MCP listed nine tools, read the scene/status, registered a fresh Camera 2 capture and read its evidence resource. The 256,985-byte PNG matched SHA-256 `8db1c575e28b9d6e6183325c7cf4b00523703b28e17f2f7300a984f62acc2f95`. Its manifest records source `6d44c4a`. The preset name `diagnostic_v1` and legacy fixture metadata do not make this authored scene a frozen smoke benchmark. No benchmark was run with the user avatar. Independent review confirmed the capture hashes, custom camera selection, intact lower body and absent barcode.

Final verification at `6d44c4a`: 297 unit tests in 41 files, nine integration tests in four files, and workspace type/Svelte checks with zero errors and warnings. The latest Rust change at `20898ff` passed 100 tests with one explicit fixture-dependent skip. No Rust source changed after that run. Earlier checks at `3da91bb` passed 284 unit tests, nine integration tests, workspace checks, 98 Rust tests with one skip, and strict workspace Clippy.

## Physical iPhone check

The user reported: “live iphone check worked.” A subsequent local status read found a configured phone address, receiver generation 14, 21,066 accepted packets and zero invalid packets. The mock check used generation 13, and its sender had already stopped. The live receiver was stale when inspected after the test. This corroborates phone packet receipt. End-to-end avatar control is user verified; no automated motion comparison or handshake packet capture was made. The phone address remains private.

This completes the requested minimum acceptance sequence within the stated scope. VMC app compatibility beyond the tested protocol packets, calibrated webcam/finger quality, continuous background webcam capture, scene save/load, Windows and concert performance remain separate work.

The test OBS source was removed and the prior scene restored. The mock sender is stopped and MediaPipe is off. The running app and the user's current scene changes remain available.

The [evidence index](minimum-live-evidence.json) records six verified image hashes and source metadata. Private screenshots and state remain in ignored `artifacts/evaluation/minimum-live/`. The user model, camera frames, connection descriptors and images are not committed. No stream was started.
