# Character model loading in Safari

Date: 2026-10-09. Commit measured: 26b8b8e (branch opensekai/character-model-preview-rate). Safari 27.0.1 on macOS 27.0.1. The harness uses `mode: 'auto'` and its default resolution scale of 1. The earlier [avatar performance](avatar-performance.md) runs used the WebGPU backend in Safari 27; this harness does not log the backend for the `path=add` runs, so the backend of these runs is not recorded.

## Method

A scratch harness (not committed) creates the renderer with an empty scene (one camera). It runs 120 frames, then adds a character with the operator's Rem VRM (75 MB, see [avatar performance](avatar-performance.md)) through the session patch API. The harness measures the `requestAnimationFrame` interval of each frame. "Before" is the first 120 frames. "During" is the frames from the add until the load status list becomes empty. "After" is the next 120 frames. The load duration is the time from the add until the load status list becomes empty.

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

The harness logged the model fetch time: 224 ms in run 1 and 99 ms in run 2.

## Conclusion

The stall is not gone. The load finished in about 2 s in both runs. Until the load status list becomes empty, 11 to 13 frames took more than 33 ms, and 5 to 6 frames took more than 100 ms. The worst single frame in run 1 was 601 ms, during the load. The worst single frame in run 2 was 630 ms, in the "after" phase.

The "after" phase also shows long frames: 121 ms in run 1 and 630 ms in run 2. The harness puts the frame that installs the model in this phase. The install frame is the probable source. In run 2, the 630 ms frame was longer than any frame during the load.

The preview still stutters visibly during a load in Safari.

The earlier [avatar performance](avatar-performance.md) record shows a blocked first frame of 10.9 s on a cold pipeline cache and 2.1 s on a warm cache, in Safari 27. That figure is the time that the first frame was blocked. The figures in this record are the intervals of each frame while a load runs. The backend of these runs is not recorded. Thus the two sets of numbers show different things, and you must not compare them directly. These runs show that frames continue during a load, with the stutter that this record states. In these runs, no single frame blocked for the full load time. The cold case is unknown, so this evidence does not show that the 10.9 s cold block is removed.

## Residual risk

Frames over 100 ms remain during the load and at model install. The probable stages are texture upload and pipeline creation on the first draw with the new model. A later change must measure these stages separately. This test measures frame intervals only. GPU time is unknown.

## Raw data

```
run 1: fetch ms 224
run 1: RESULT {"path":"add","loadMs":2051,"loaded":true,"before":{"n":120,"mean":16.6,"p50":17,"p95":18,"max":19},"during":{"n":38,"mean":54.39,"p50":19,"p95":175,"max":601,"over33":13,"over100":6},"after":{"n":120,"mean":17.37,"p50":17,"p95":18,"max":121}}
run 2: fetch ms 99
run 2: RESULT {"path":"add","loadMs":1990,"loaded":true,"before":{"n":120,"mean":16.57,"p50":17,"p95":18,"max":19},"during":{"n":29,"mean":47.52,"p50":24,"p95":179,"max":230,"over33":11,"over100":5},"after":{"n":120,"mean":22.55,"p50":17,"p95":18,"max":630}}
```
