# Default avatar idle check

Checked 2026-10-04. Final packaged source: `43b1d84e80849cb20553cee12b9569966e32da13`. Normal macOS startup outside the checkout, no fixture mode. Preview uses WKWebView WebGPU; clean OBS uses WebGPU at 1920×1080/60fps. This is one private VRM0, not a concert benchmark.

## Verified behavior

The actual native chooser imported the supplied VRM at source `3dfbc9c`. Idle was enabled automatically with Body and Face set to None. The import factory is unchanged in the final build. The final inspector checkbox toggled the authoritative idle setting. OBS showed lowered arms when enabled and the rest T-pose when disabled. The loop adds small chest breathing and sway, with no default expression, root or leg animation.

The first visual check showed raised arms. Actual rig data and the [ThreeVRM animation adapter](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-animation/src/createVRMAnimationClip.ts) identified the VRM0 axis conversion. A generated-rig regression failed before the baseline adapter and passed afterward. Final actual OBS images show relaxed arms. VRM1 arm direction is covered by generated-rig tests; an actual VRM1 import was not checked in this slice.

Real loopback VMC and iFacialMocap mocks each delivered 1500 packets with zero invalid packets. They took control of body, head and facial expression over the enabled idle. After Stop and the stale interval, OBS returned to the enabled idle. The first immediate post-stop image still contained the held pose; only the settled image counts as returned idle. Raw tracking fades from the evaluated idle baseline instead of the T-pose. Normalized takeover/fade, sparse channels, chestless spine mapping and two-instance isolation pass rig tests.

Actual MediaPipe Start loaded local camera inference, with a sampled 16 ms inference duration. No face or body was detected, so native status remained waiting with zero samples. OBS kept idle while waiting, and actual Stop returned the tracker to stopped. Live MediaPipe takeover over idle remains pending a detected person. The earlier live MediaPipe check remains recorded in minimum-live-vtubing.md.

## Continuity and evidence

Minimize was issued for Editor and Scene. No OpenSekai UI read occurred during the next 12-second probe. Native window visibility was not independently instrumented. 45 status samples show output sequence 18396→19063 at scene revision 7. OBS rendered 727 frames with zero skipped render frames. Six images show changing idle; the first two differ at 72791 pixels. Sampled render CPU p95 was 3 ms, maximum 3.5 ms. These are sampled host measurements, not a hardware recommendation. GPU duration and concert performance are unknown.

The clean idle image has 1901893 transparent pixels and 171707 visible pixels. MCP exposed nine tools and returned a registered current-revision capture. Read-back resource bytes matched the recorded SHA256 and build commit. The [evidence index](default-avatar-idle-evidence.json) contains hashes and bounded summaries. Images, avatar files, phone details and local tokens stay private.

A failed GUI quit left two test instances and caused receiver bind errors. Both owned instances were closed. The final accepted check used one app instance with receiver status waiting/receiving rather than bind errors. Failed initial loading and wrong-arm images remain private; they are not successful checks.

## Validation and final state

339 unit tests, nine integration tests, workspace checks, 102 Rust tests, strict Clippy and formatting passed. One native test remains explicitly skipped because it needs the pinned smoke fixture. The macOS release build passed with the existing ThreeVRM legacy TSL and bundle-size warnings.

The original six-asset scene was restored. A validated comparison confirms original transforms, visibility, cameras, output selections, tracking assignments and receiver configuration. Only source generation counters and requested idle enablement differ. All owned OBS sources were removed and the prior OBS scene restored. The release app remains running with idle enabled on the original avatar. Mixamo/VRMA clip import, override clips and full animation controls remain on the roadmap.
