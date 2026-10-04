# Tracking smoothing controls check

Checked 2026-10-04. Packaged source `171997a`. Normal macOS startup, one private VRM0, preview WKWebView WebGPU and clean OBS WebGPU at 1920×1080/60. This is a functional check, not a tracking-latency or concert performance result.

## Change and use

Actual tracking defaults now use minimum cutoff 5 Hz, beta 0.5 and derivative cutoff 1 Hz. The earlier values were 1 Hz and beta 0.1. Generic One Euro math factory defaults remain unchanged; the tracking composer passes the tracking settings explicitly. In the controlled 0→1 step with two samples 100 ms apart, the new default passes about 81% of the step rather than 47%. This test demonstrates lower smoothing; it is not a measured physical-device latency.

Select a VMC receiver, iFacialMocap receiver or MediaPipe tracker in Assets. Its inspector has a Smoothing section. Enabled bypasses or restores the filter immediately. Min cutoff, Beta and Derivative cutoff use numeric drafts and Apply. Reset restores 5/0.5/1 and enables smoothing. Higher minimum cutoff passes more slow movement. Higher beta follows faster movement with less lag. Derivative cutoff controls velocity smoothing. Parameter tooltips explain these effects.

Each source stores its own settings. A dedicated setTrackingSmoothing scene operation keeps socket and camera configuration separate. Tuning leaves source generation, native receipt time and counters unchanged. The session retains the latest raw sample, so bypass and tuning apply on the next evaluation without waiting for a new sample. Source lifecycle cleanup and stale fade remain in place. Existing sources without explicit settings use the new defaults. Settings remain part of scene state; this slice does not add show save/load UI.

## Actual checks

Actual inspector actions applied iFacial values 12/0.8/2 at revision 6. Its receiver stayed at generation 5, receiving 3802 packets with zero invalid packets. Bypass at revision 7 kept those values, disabled numeric controls and Apply, and retained the same receiver with 5290 packets. Reset at revision 8 restored 5/0.5/1, with 6598 packets and unchanged generation. An empty minimum-cutoff draft produced a local error and did not commit; revision stayed 8.

Actual VMC Apply set 20/1.2/1 at revision 10, with generation 5, 11323 packets and zero invalid packets. Facial settings stayed at defaults. Reset then restored VMC defaults. Actual MediaPipe Apply set 9/0.9/1 at revision 12 while generation 2, enabled=false, state=stopped and zero packets remained unchanged. Its bypass and Reset controls worked without starting a camera. Live detected-person MediaPipe tuning was not rechecked; deterministic session tests cover its sample path.

OBS images show body and facial motion with the new defaults, applied settings and facial bypass. Stopping mocks followed by the stale interval returned to idle. Images do not establish a measured latency comparison. The [evidence index](tracking-smoothing-controls-evidence.json) contains bounded state summaries and image hashes. Source files, user model, phone address, connection tokens and images remain private.

## Validation and final state

367 unit tests, nine integration tests, 105 Rust tests, workspace checks, formatting and strict Clippy passed. One native test is explicitly skipped for the pinned fixture requirement. The macOS release build passed with existing legacy TSL and bundle-size warnings. Independent review found no actionable issues. The numeric parser regression failed before the fix; it now handles Svelte number and empty undefined values safely.

The original six-asset scene and all original connection settings were restored. A validated comparison confirms original transforms, visibility, cameras, output selection and tracking assignments. The new smoothing fields are explicit defaults on all three sources; generation counters differ after restoration. Idle remains enabled. Owned mocks stopped, the owned OBS source was removed and the prior OBS scene restored. The new release app remains running.
