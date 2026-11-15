# FaceKit probe

This tool checks the private macOS FaceKit face tracker (AppleCVA) on one Mac. It opens a camera, sends each frame to FaceKit, and records what FaceKit returns. The [feasibility record](../../docs/evaluation/facekit-feasibility.md) comes from this tool. It is not product code. OpenSekai does not use it at run time.

The tool is written from the interface facts in the [design](../../docs/superpowers/specs/2026-11-11-facekit-macos-tracking-design.md) (Appendix A). It contains no third-party code.

## Build

macOS only. Xcode command-line tools are necessary.

```sh
bash tools/facekit-probe/build.sh             # ad hoc signature with the camera entitlement
bash tools/facekit-probe/build.sh --hardened  # the same, with the hardened runtime
```

The binary is `tools/facekit-probe/facekit_probe`. Git ignores it.

## Start

macOS shows the camera prompt only to a process that a person starts. Start the tool from Terminal.app. Then Terminal.app is the responsible process for the camera permission. A process that an agent session or an IDE starts does not get the prompt.

To start a run with no typing in Terminal.app, write a `.command` file, make it executable, and open it. Finder and `open` start it in Terminal.app.

```zsh
#!/bin/zsh
cd /path/to/opensekai/tools/facekit-probe
./facekit_probe --script --phase-seconds 4 --device FaceTime --out guided.jsonl 2>&1 | tee guided.log
```

```sh
chmod +x guided.command
open guided.command
```

With `--script`, a voice tells the performer each movement (`neutral`, `head_left`, `head_right`, `head_up`, `head_down`, `tilt_left`, `tilt_right`, `closer`, `jaw_open`, `blink_left`, `blink_right`, `smile`, `tongue`, `eyes_left`, `eyes_up`, `covered`, `neutral_end`). In the 2026-11-11 run the performer moved 2.5 to 3.5 s after each prompt.

Options:

| Option | Effect |
| --- | --- |
| `--list` | Print the camera names and stop. |
| `--device <text>` | Use the first camera whose name contains the text. The default is the system default camera. |
| `--out <file>` | Write one JSON object for each callback to the file. |
| `--seconds <n>` | Run time without `--script`. Default 8. |
| `--script`, `--phase-seconds <n>` | Guided run, `n` seconds for each movement. Default 4. |
| `--fx <n>` | Synthetic focal length at 640 pixels width. Default 400. |
| `--width <n>` | Ask for a camera format with this width. |
| `--detector` | FaceKit finds the face itself. Vision is not used. |
| `--fitting <0\|1>` | Set `fittingEnabled`. |
| `--force-cpu` | Set `force_cpu`. |
| `--cb create` | Give the callback in the create options, not with each frame. |

The tool always sets `use_recognition` to false. It does not set `add_debug`.

Exit codes: 0 done, 2 camera permission denied, 3 FaceKit unavailable, 4 camera failure.

## Output

The terminal shows the API version, the create options, the 51 blend shape names, the structure of the first result (the keys and the class name of each value, no values), a line every 0.5 s, and a summary (frame rate, callback latency, `Process` duration, CPU, callback thread).

Each line of the `--out` file has these fields:

| Field | Value |
| --- | --- |
| `t` | Seconds from the camera start. |
| `phase` | The guided movement, or empty. |
| `lat_ms` | Time from `Process` to the callback, in ms. |
| `face` | 1 when `tracked_faces` has an entry, else 0. |
| `data_failure` | The `data_failure` text of the result, when present. |
| `conf`, `failure_type` | From the face entry. |
| `bs`, `rot`, `trans`, `tongue`, `gaze` | `smooth_data`: 51 blend shapes, rotation (3 rows of 3), translation, `tongue_out`, gaze. |
| `eyes` | `smooth_data` eye pitch and yaw: left pitch, left yaw, right pitch, right yaw. |
| `raw_bs`, `raw_rot`, `raw_tongue` | `raw_data`: 51 blend shapes, rotation, `tongue_out`. |
| `has_identity` | True when the face entry has the `identity_coefficients` key. |

The tool never reads or prints the values of `identity_coefficients`, `face_id`, or `debug`. The structure print shows "(not read)" for these keys, and it prints no value of another key. The tool stores no camera frame.

## Recordings

Recordings (`*.jsonl`) and logs (`*.log`) stay on the machine that made them. Git ignores them in this directory. Do not commit them. A short numeric excerpt of the 2026-11-11 guided run is in `fixtures/tracking/facekit-frames.json`.
