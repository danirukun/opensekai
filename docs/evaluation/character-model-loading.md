# Character model loading in Safari

Date: 2026-10-09. Commit measured: 26b8b8e (branch opensekai/character-model-preview-rate). Safari 27.0.1 on macOS 27.0.1, WebGPU backend, resolution scale 1.

## Method

A scratch harness (not committed) creates the renderer with an empty scene (one camera). It runs 120 frames, then adds a character with the operator's 75 MB Rem VRM through the session patch API. The harness measures the `requestAnimationFrame` interval of each frame. "Before" is the first 120 frames. "During" is the frames from the add until the load status becomes empty. "After" is the next 120 frames. The load duration is the time from the add to the empty load status.

The harness ran twice in the same Safari session. The pipeline cache state of the first run is unknown: Safari was not restarted, so the cold-cache case was not measured. The second run was warm.

## Results

Frame intervals in ms.

| Run | Phase | Frames | Mean | p50 | p95 | Max |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Before | 120 | 16.60 | 17 | 18 | 19 |
| 1 | During | 38 | 54.39 | 19 | 175 | 601 |
| 1 | After | 120 | 17.37 | 17 | 18 | 121 |
| 2 | Before | 120 | 16.57 | 17 | 18 | 19 |
| 2 | During | 29 | 47.52 | 24 | 179 | 230 |
| 2 | After | 120 | 22.55 | 17 | 18 | 630 |

| Run | Load duration | During: frames over 33 ms | During: frames over 100 ms |
| --- | --- | --- | --- |
| 1 | 2051 ms | 13 | 6 |
| 2 | 1990 ms | 11 | 5 |

The model fetch took 224 ms in run 1.

## Conclusion

The stall is not gone. The load finished in about 2 s in both runs. During the load, 11 to 13 frames took more than 33 ms, and 5 to 6 frames took more than 100 ms. The longest frame during the load was 601 ms in run 1 and 230 ms in run 2.

The "after" phase also shows long frames: 121 ms in run 1 and 630 ms in run 2. The harness puts the frame that installs the model in this phase. The install frame is the probable source. In run 2, the 630 ms frame was longer than any frame during the load.

Compared with the earlier measurement (a blocked first frame of 10.9 s cold and 2.1 s warm), no single frame blocks for the full load time in these runs. The warm worst frame is now 230 ms during the load and 630 ms at install. The cold case is unknown, so this evidence does not show that the 10.9 s cold block is removed.

## Residual risk

Frames over 100 ms remain during the load and at model install. The probable stages are texture upload and pipeline creation on the first draw with the new model. A later change must measure these stages separately. Safari shows the frame intervals only; this test does not give GPU timing, so the GPU time is unknown.
