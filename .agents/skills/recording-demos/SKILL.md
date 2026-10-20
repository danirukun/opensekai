---
name: recording-demos
description: Use when the user asks to record a demo, screen capture, or video of OpenSekai or another macOS window, or to turn a recording (.mov, .mp4, .cap) into a social post with the opensekai overlay, a square video, or a short shareable clip. Covers the cap CLI and ffmpeg.
---

# Recording demos

Record a window or screen with the `cap` CLI, then finish the video with ffmpeg for the place it goes. `$SKILL` is this skill's directory, `<repo>/.agents/skills/recording-demos`. Call the scripts with `bash $SKILL/scripts/<name>.sh`. Put scratch files (recordings, check frames) in the session scratchpad.

For a PR acceptance demo inside a QA run, use the `local-qa-e2e` skill. It records both app windows and posts to the PR.

## 1. Record

Skip this step if the user gives an existing video.

1. `cap doctor --json` must report `captureReady: true`. If not, the terminal usually needs Screen Recording permission (System Settings › Privacy & Security). Tell the user and wait.
2. Find the target:
   ```sh
   cap targets --json | jq -r '.windows[] | select(.name|test("OpenSekai")) | "\(.id)\t\(.name)\t\(.bounds.width)x\(.bounds.height)"'
   cap targets --json | jq -r '.screens[] | "\(.id)\t\(.name)\tprimary=\(.primary)"'
   ```
   The dev app's windows are `OpenSekai Editor` and `OpenSekai — Scene`.
3. Raise the window and keep it on top. `--window` records the window's area of the screen, so a window in front of it is recorded instead. The Scene window also stops drawing while another app (for example OBS) is frontmost.
4. Set up the state first (with MCP), so the recording shows only the interesting part. Turn on Do Not Disturb, so notifications do not appear in the video.
5. Record at 60 fps for app motion:
   ```sh
   cap record start --window <id> --fps 60 --detach --json --path <scratch>/demo.cap
   # ... do the demo ...
   cap record stop --path <scratch>/demo.cap --json
   ```
   Use `--duration <s>` instead of `--detach` for a fixed length. `--path` must not exist yet.
6. Export: `cap export <scratch>/demo.cap <scratch>/demo-raw.mp4 --fps 60 --quality maximum --json`. The export is 1920 px wide by default, which is enough for every target below.

## 2. Finish for the target

| Target | Command |
| --- | --- |
| Square social post with the opensekai bar | `bash $SKILL/scripts/overlay-post.sh <in> <out.mp4>` |
| GitHub PR or issue (under 10 MB, sped up) | `bash <repo>/.agents/skills/local-qa-e2e/scripts/compress-demo.sh <in> <out.mp4>` |

`overlay-post.sh` puts the footage under `assets/opensekai-square-post.png` (1080 × 1080, transparent above the bar). The script finds the transparent area from the alpha channel, so a different overlay works as the third argument.

Choose the framing before you encode. Take frames from the source at a few times and look at them. A 16:9 source in the default area (1080 × 922) loses about a sixth of its width on each side. Options (environment variables):
- Default: fill the area and cut the sides off. Use this for a centred subject.
- `FIT=1`: show the whole frame and fill the space above and below it with `BG` (default `0xF5F5F8`). Use this when the edges matter.
- `CROP=crop=w:h:x:y`: crop the input first, for example to the stage area of the window.

The script keeps the input audio and fps. It encodes H.264 at CRF 16 with `+faststart` and prints a JSON summary.

Write the final file to the path the user names. If they do not name one, write it next to the source video (or in `~/Movies` for a new recording) with a suffix (`<name> square.mp4`). Check with `ls` first, and do not overwrite an existing file.

## 3. Check before you hand it over

1. `ffprobe -v error -show_entries stream=codec_type,width,height,r_frame_rate -show_entries format=duration,size -of compact <out>`
2. Take frames near the start and near the end (`ffmpeg -ss 1 -i <out> -frames:v 1 f1.png`) and look at them. Confirm that the frames show the intended window and not another app, that no private content or notifications show, and that the subject is not cut off by the fill crop.
3. Report the path, size, duration, and the framing choice you made. Offer `FIT=1` if the fill crop cut off something.

Do not run `cap upload`, post the video, or attach it to a PR unless the user asks.

## Common mistakes

| Mistake | Result |
| --- | --- |
| Another window covers the target during `--window` recording | That window is in the video |
| OBS or another app frontmost during the demo | The Scene preview freezes |
| Not looking at the frames | A wrong window, a terminal, or a notification gets shared |
| Re-encoding the overlay output for GitHub with `compress-demo.sh` | It scales to 1280 wide and drops the audio. Make each target from the raw export |
