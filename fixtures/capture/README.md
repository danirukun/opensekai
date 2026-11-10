# Capture test stream

B31 Operation 1. `scripts/make-capture-fixture.sh` makes these files with ffmpeg and libx264. The tests read them and do not run ffmpeg.

- `h264-main.bin`: 60 AVCC chunks (each NAL unit has a 4-byte big-endian length), one chunk for each frame.
- `h264-main.json`: the WebCodecs config (`codec`, `description` as base64 `avcC`, `codedWidth`, `codedHeight`) and one index entry for each chunk (`offset`, `length`, `key`, `timestampUs`).

The stream is 2 s, 320 × 180, 30 frames a second, H.264 Main profile, no B-frames, a key frame each 30 frames. The color is solid red, green, blue, then white, 15 frames each.

The ffmpeg command:

```sh
ffmpeg -f lavfi -i color=c=0xff0000:s=320x180:r=30:d=0.5 (and the same for 0x00ff00, 0x0000ff, 0xffffff) \
  -filter_complex "concat=n=4:v=1:a=0,format=yuv420p" \
  -c:v libx264 -profile:v main -tune zerolatency -bf 0 -g 30 -keyint_min 30 -sc_threshold 0 \
  -x264-params bitexact=1:threads=1 -f h264 stream.h264
```

The script then splits the Annex B stream at the start codes, moves SPS and PPS into `description`, and writes each frame as one AVCC chunk.
