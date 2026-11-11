#!/usr/bin/env bash
# B31 Operation 1: make the capture test stream. A 2 s, 320 x 180, 30 frames a second H.264 Main stream
# (no B-frames, a key frame each 30 frames) with a solid color that changes each 0.5 s: red, green, blue, white.
# It writes the AVCC chunks to fixtures/capture/h264-main.bin and the config and chunk index to h264-main.json.
# The tests read these files; they do not run ffmpeg.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/fixtures/capture"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "color=c=0xff0000:s=320x180:r=30:d=0.5" \
  -f lavfi -i "color=c=0x00ff00:s=320x180:r=30:d=0.5" \
  -f lavfi -i "color=c=0x0000ff:s=320x180:r=30:d=0.5" \
  -f lavfi -i "color=c=0xffffff:s=320x180:r=30:d=0.5" \
  -filter_complex "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,format=yuv420p[v]" -map "[v]" \
  -c:v libx264 -profile:v main -tune zerolatency -bf 0 -g 30 -keyint_min 30 -sc_threshold 0 \
  -x264-params "bitexact=1:threads=1" -f h264 "$work/stream.h264"
python3 -I - "$work/stream.h264" "$out" <<'PY'
import base64, json, sys
data = open(sys.argv[1], 'rb').read()
# Split the Annex B stream at each 3- or 4-byte start code.
starts = []
i = 0
while i < len(data) - 3:
    if data[i:i+3] == b'\0\0\1':
        starts.append(i + 3); i += 3
    else:
        i += 1
nals = []
for n, s in enumerate(starts):
    end = starts[n + 1] - 3 if n + 1 < len(starts) else len(data)
    while end > s and data[end - 1] == 0:
        end -= 1
    nals.append(data[s:end])
sps = next(n for n in nals if n[0] & 0x1f == 7)
pps = next(n for n in nals if n[0] & 0x1f == 8)
avcc = bytes([1, sps[1], sps[2], sps[3], 0xff, 0xe1]) + len(sps).to_bytes(2, 'big') + sps + bytes([1]) + len(pps).to_bytes(2, 'big') + pps
# One access unit for each VCL NAL unit (one slice for each frame). SPS and PPS go in the description.
frames, pending = [], []
for nal in nals:
    kind = nal[0] & 0x1f
    if kind in (7, 8, 9):
        continue
    pending.append(nal)
    if kind in (1, 5):
        frames.append((kind == 5, b''.join(len(n).to_bytes(4, 'big') + n for n in pending)))
        pending = []
blob, chunks = b'', []
for index, (key, chunk) in enumerate(frames):
    chunks.append({'offset': len(blob), 'length': len(chunk), 'key': key, 'timestampUs': round(index * 1_000_000 / 30)})
    blob += chunk
open(f'{sys.argv[2]}/h264-main.bin', 'wb').write(blob)
codec = 'avc1.%02x%02x%02x' % (sps[1], sps[2], sps[3])
index = {'codec': codec, 'description': base64.b64encode(avcc).decode(), 'codedWidth': 320, 'codedHeight': 180, 'frameRate': 30,
         'colors': ['red', 'green', 'blue', 'white'], 'framesPerColor': 15, 'chunks': chunks}
open(f'{sys.argv[2]}/h264-main.json', 'w').write(json.dumps(index, indent=1) + '\n')
print(f'{codec}: {len(chunks)} chunks, {sum(c["key"] for c in chunks)} key, {len(blob)} bytes')
PY
