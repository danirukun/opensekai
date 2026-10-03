# Minimum live VTubing check

Checked on 2026-10-03. Packaged source:72ace509d6c9af941dfe90a89d3fd81f62a8112a. Platform: macOS27.0.1, WKWebView preview and OBS WebGPU at1920×1080,60fps. This is a one-avatar check. It does not certify minimum hardware or a concert scene.

## Actual flow

| Deliverable | Result | Scope and remaining check |
| --- | --- | --- |
| Import VRM | Passed | Normal startup outside the checkout, without fixture mode. Native chooser imported the supplied91,619,676-byte VRM0. The macOS all-files chooser fix enabled Open. The native validator still checks the content. |
| VMC receiver | Passed with mock | Receiver asset inspected and started through UI. Real loopback UDP packets drove raw body bones. Assets were created through the common validated API; the Add submenu needs another UI check. |
| iFacialMocap receiver | Passed with mock | Receiver asset inspected and started through UI. Real UDP packets drove head, jaw and blink. Physical iPhone handshake and app control are the last step, as requested. |
| Mixed control | Passed with mock | VMC Body plus iFacial Face changed the avatar in OBS. Both sources reported receiving with zero invalid packets. PoseA raised arms/opened the mouth; settled PoseB changed arm angle/head and closed eyes. |
| Camera | Passed subset | Add Camera was exercised at7a286ad. Current lens FOV40→50 was changed through UI and reached OBS. Near200/Far100 was rejected with an error. Valid lens remained in the scene. |
| OBS | Passed diagnostic source | Imported avatar rendered with transparent background. The evaluation source deliberately showed the marker. Review found the same marker enabled in the copied production URL; that URL is now fixed and needs a rebuilt UI/OBS check. |
| MediaPipe | Passed local camera subset | Explicit UI Start loaded the bundled face, pose and hand tasks in the release worker. Actual camera samples reported receiving with zero invalid packets. UI selectors assigned Body and Face to MediaPipe; the avatar pose changed in OBS. Stop returned the avatar to rest. Finger accuracy, controlled motion/calibration and separate inference duration remain open. |

Paused UDP sources became stale. The rendered avatar returned to rest. MediaPipe Stop became stopped and released its controller. Raw-rest rig analysis and independent PNG pixel checks confirmed intact lower-body geometry. A suspected missing lower body was a display interpretation error; no renderer change was required.

## Focused continuity check

The90-second local probe sampled354 output acknowledgements. Sampled render CPU p95 was3.0ms; maximum5.9ms. Output sequence advanced87693→93039 and tick88677→94076. No renderer warnings were reported. OBS rendered5416 frames with0 skipped render frames. Recording/stream output was idle; zero output frames is not an output-encoding performance result.

Computer Use issued minimize for Editor and the remaining front OpenSekai window. The recorded interval was about53seconds before restore. Native window visibility was not independently instrumented. Six OBS images retained moving pose/marker evidence. This check is narrower than the previous formal smoke timing and recording checks. GPU duration, MediaPipe inference duration and concert performance are unknown.

## Verification

At3da91bb:284 unit tests in40files;9 integration tests in4files; workspace checks with0Svelte errors and0warnings; Rust workspace98passed and1explicit fixture-dependent skip; strict workspace Clippy passed. The copied-URL regression then failed with diagnostics enabled and passed after the fix:5focused tests.

Private screenshots, state, capture hashes and continuity samples stay in ignored artifacts/evaluation/minimum-live/. The user VRM and webcam frames are not committed. Owned OBS sources are cleaned before rebuild; the adapter restores the prior scene. No stream was started.


## Rebuilt output and inference timing

Packaged source f507cfc8934430266d75acdd84c8c279dce63ad4 passed actual UI Add for VMC, iFacialMocap and MediaPipe. The supplied model was imported again. Copy OBS URL placed the actual URL on the clipboard; the private check confirmed a loopback renderer URL with diagnostics absent. An isolated source using that exact URL rendered the avatar with no barcode. The first immediate screenshot was blank before renderer loading; the settled capture is the evidence.

The three-task CPU tracker published measured inference duration through existing status reads. Forty last-completed inference samples over20seconds measured34ms minimum,64ms median,82ms p95 and maximum. These are sampled values, not every inference. Stop cleared the metric. The explicit device menu includes FaceTime HD Camera; subsequent camera checks use that physical device.

The controlled editor restart then stayed waiting without any inference metric for20seconds. Activating Scene resumed camera tracking. WebKit can defer camera access until its document is visible. The fix presents Scene before editor MediaPipe Start or an enabled camera configuration change, with no private browser setting. Tests cover activation ordering and failure without enabling tracking. Packaged verification of this fix is pending. The default two-task timing probe from the failed restart is retained with zero measured samples; it is not a performance result.

Changing iFacialMocap to the VMC port produced the visible Cannot bind receiver endpoint error. Restoring49983 removed the bind failure and returned to waiting. Source generations changed; the scene remained intact.
