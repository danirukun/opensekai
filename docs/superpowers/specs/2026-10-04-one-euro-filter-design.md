# One Euro tracking filter design

Use a shared session filter rather than separate decoder filters or renderer smoothing. Decoder filters duplicate the implementation across native and camera paths. Renderer smoothing gives each output different history. The session provides one result for every client.

The core exports createOneEuroFilter, createOneEuroVec3Filter and createOneEuroQuaternionFilter. Each accepts OneEuroOptions and returns filter(value, timeMs) and reset(). The sample adapter isolates every source, bone rotation, bone position, root and expression. All three source kinds use this adapter before body/face routing.

Start at minCutoff=1 Hz, beta=0.1, derivativeCutoff=1 Hz, resetAfterMs=500. These are provisional settings. Imported data retains its units. No user tuning control or saved setting is added. Blueprint nodes can reuse the factories and own their state without native or renderer access.

The scalar implementation follows the [authors' algorithm](https://gery.casiez.net/1euro/). The quaternion adapter measures shortest angular distance between raw samples, low-passes angular speed, then applies the adaptive cutoff through slerp. Sign-equivalent quaternions represent no movement.

The [slice contract](../../../spdd/prompt/2026-10-04-one-euro-filter.md) defines validation, timing, reset and isolation behavior. Tests verify reference scalar values, jitter reduction, adaptive response, quaternion sign/wrap behavior, malformed inputs and all three tracking sources. Native OBS mock checks cover the resulting rendered path. Physical phone and detected-person checks remain separate evidence.
