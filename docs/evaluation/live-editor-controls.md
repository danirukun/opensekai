# Live editor controls check

Checked 2026-10-03 and 2026-10-04 on macOS WKWebView and clean OBS WebGPU. Final source: `7084f4a`. Earlier numeric and scrub captures identify source `b8bfefb` in the evidence index. The private one-avatar scene is not a concert benchmark.

Actual UI actions verified type groups, collapse, search expansion and hidden camera search results. Clearing search restored collapse. Eye buttons changed visibility without changing selected avatar. VMC hide/show kept its receiver enabled and generation unchanged. Camera sidebar actions updated both outputs and kept avatar selection. The saved hidden Camera 2 remained valid as active output. Camera at the origin produced an expected blank view; its user transform was preserved.

Typed position, rotation and scale reached the authoritative scene while input remained focused, without Apply or Enter. The earlier check used position X 0.4, yaw 30 degrees and scale Z 0.8. A 40-pixel label drag changed X to 0.8. Three reset controls restored the identity transform. Invalid scale zero stayed local and did not change scene revision or the valid scale. Final source repeated position X 0.2 followed by sidebar hide/show without a conflict. Unit tests also cover partial input, coalescing, pending acknowledgements, selection changes and external revision changes.

Two defects were fixed: quaternion transport rounding caused a false conflict, and the revision guard remained armed after focus left the fields. Regression tests failed before each fix and passed after it. Independent review approved the focus lifecycle.

Settled clean OBS captures show the visible avatar and the fully transparent hidden result. Output acknowledgements record the current camera and revision. Initial blank loading captures remain private and do not count as successful output checks. One final OBS attempt used an empty clipboard result under sandbox access; the helper was stopped, then actual URL copy was repeated with permitted clipboard access. The corrected source rendered the avatar.

Final verification: 310 unit tests passed; workspace checks reported zero errors and warnings. Nine integration tests passed before the final UI-only fixes. The macOS release build passed with the existing ThreeVRM legacy TSL and bundle-size warnings. No production image IPC was added. Numeric timing and concert/minimum-hardware performance are unknown.

The saved scene was restored exactly except source generation counters. Owned OBS resources were removed and the prior OBS scene restored. Private images, scene snapshots, phone address, model path and local tokens remain outside Git. [Capture hashes](live-editor-controls-evidence.json) identify the retained local evidence.
