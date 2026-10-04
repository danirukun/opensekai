# Tracking smoothing and ARKit check

Checked 2026-10-04. Packaged source: `9686ac3`. Normal macOS release startup, one private VRM0, preview WKWebView WebGPU and clean OBS WebGPU at 1920×1080/60. This is a functional check, not a concert performance or minimum-hardware result.

## Implemented behavior

The session filters every accepted VMC, iFacialMocap and MediaPipe sample before body/face routing. Positions and expressions use scalar One Euro filters. Rotations use filtered angular speed and shortest-path quaternion interpolation. Renderer clients consume the same evaluated result. Repeated evaluation does not advance filter history. Source restart, stop, error, removal and stale gaps clear history; omitted channels and coordinate-space changes cannot retain old values.

The reusable API is exported from `@opensekai/session`:

```ts
import {createOneEuroFilter} from '@opensekai/session';
const filter = createOneEuroFilter({minCutoff:1,beta:0.1});
const output = filter.filter(input, sampleTimeMs);
// Reset when the future blueprint node restarts.
filter.reset();
```

`createOneEuroVec3Filter`, `createOneEuroQuaternionFilter` and `createTrackingSampleFilter` are also exported. Instances own their state. Default settings are minCutoff 1 Hz, beta 0.1, derivativeCutoff 1 Hz and resetAfterMs 500. These are starting settings, not calibrated presets. Tuning controls and a visual blueprint node are future work.

The scalar equation follows the [authors' reference](https://gery.casiez.net/1euro/). Tests verify the reference low-pass result, lower stationary jitter, faster adaptive response, sign-equivalent rotations and shortest paths across 180 degrees. Numeric overflow and unusable intervals reject without corrupting scalar, vector or quaternion history.

## Facial mapping

The avatar contains all 52 named ARKit morphs. Previously the renderer used VRM expression names and a small preset alias table; most ARKit input had no target. Now registered exact/canonical expressions take priority, followed by matching mesh morphs, followed by existing preset aliases. iFacial `_L`/`_R` names are accepted. All matching meshes are driven. Direct weights apply after the VRM expression manager, with prior direct slots cleared before it. This avoids double jawOpen/aa deformation and preserves standard expression writes.

Generated mesh tests drive all 52 channels and verify alias conversion, sparse reset, multiple meshes, unrelated-slot preservation and real VRM bind ordering. Actual native loopback packets contain all 52 channels. Selected settled OBS images verify neutral, jaw opening, blink, pucker, brow movement and tongue. The jaw uses the mesh's jawOpen shape, not only its vowel preset. VMC body motion and iFacial facial motion continue together with zero invalid packets. Stop followed by the stale interval returns to idle.

## Continuity and validation

Minimize was issued for Editor and Scene; no app UI read occurred during the 12-second probe. Window visibility was not independently instrumented. Forty-four status samples show output sequence 20366→21066 at revision 5. OBS rendered 733 frames with zero skipped render frames. Sampled render CPU p95 was 2.9 ms and maximum 3.1 ms. GPU time is unknown. These measurements do not isolate filter CPU cost or certify latency.

356 unit tests, nine integration tests and workspace checks passed. The macOS release build passed with existing legacy TSL and bundle-size warnings. Review found a numeric edge case; a failing regression preceded its fix. Physical phone gestures and detected-person MediaPipe smoothing were not rechecked in this slice. All three source integrations are covered by deterministic session tests.

The [evidence index](one-euro-filter-evidence.json) records hashes, frame metadata and bounded status summaries. Private images, model files, receiver addresses and connection tokens are excluded. An operator-role frame subscription yielded no frames and is not counted as proof of runtime channel counts.

The original six-asset scene was restored with an exact comparison except source generation counters. Original transforms, cameras, visibility, assignments and receiver settings are retained; idle remains enabled. Owned mocks stopped and the owned OBS source was removed. The updated release app remains running.
