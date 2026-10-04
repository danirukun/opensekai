# Tracking One Euro Filter analysis

VMC, iFacialMocap and MediaPipe produce validated TrackingSample records. One session composer receives all streams. Filter there before avatar routing, so preview and OBS share the result. Do not filter per render tick or in protocol decoders.

Use a portable TypeScript core with no renderer, DOM or native dependency. A future blueprint node can own a filter instance and call filter(value, timeMs), then reset it when the graph restarts. No graph system is required now.

Independent scalar components are sufficient for positions. Rotations need unit quaternions, shortest-path interpolation and angular speed. Component filtering of quaternions risks incorrect paths near sign changes.

Main risks are timing duplication, stale history, sparse channels, source isolation and hidden latency. Use bounded channel state and deterministic tests. Initial settings are provisional, not a performer-specific calibration.
