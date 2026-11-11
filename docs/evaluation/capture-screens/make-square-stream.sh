#!/usr/bin/env bash
# The second stream of the headless check (B31 Operation 4.3, the size change): 1 s, 240 x 240, 30 frames a second,
# H.264 Main, solid magenta, a key frame each 30 frames. Same layout as fixtures/capture (see its README).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=0xff00ff:s=240x240:r=30:d=1,format=yuv420p" \
  -c:v libx264 -profile:v main -tune zerolatency -bf 0 -g 30 -keyint_min 30 -sc_threshold 0 -x264-params "bitexact=1:threads=1" -f h264 "$work/s.h264"
python3 -I - "$work/s.h264" "$here" <<'PY'
import base64, json, sys
data = open(sys.argv[1], 'rb').read()
starts, i = [], 0
while i < len(data) - 3:
    if data[i:i+3] == b'\0\0\1': starts.append(i + 3); i += 3
    else: i += 1
nals = []
for n, s in enumerate(starts):
    end = starts[n + 1] - 3 if n + 1 < len(starts) else len(data)
    while end > s and data[end - 1] == 0: end -= 1
    nals.append(data[s:end])
sps = next(n for n in nals if n[0] & 0x1f == 7); pps = next(n for n in nals if n[0] & 0x1f == 8)
avcc = bytes([1, sps[1], sps[2], sps[3], 0xff, 0xe1]) + len(sps).to_bytes(2, 'big') + sps + bytes([1]) + len(pps).to_bytes(2, 'big') + pps
frames, pending = [], []
for nal in nals:
    kind = nal[0] & 0x1f
    if kind in (7, 8, 9): continue
    pending.append(nal)
    if kind in (1, 5): frames.append((kind == 5, b''.join(len(n).to_bytes(4, 'big') + n for n in pending))); pending = []
blob, chunks = b'', []
for index, (key, chunk) in enumerate(frames):
    chunks.append({'offset': len(blob), 'length': len(chunk), 'key': key, 'timestampUs': round(index * 1_000_000 / 30)}); blob += chunk
open(f'{sys.argv[2]}/square.bin', 'wb').write(blob)
json.dump({'codec': 'avc1.%02x%02x%02x' % (sps[1], sps[2], sps[3]), 'description': base64.b64encode(avcc).decode(), 'codedWidth': 240, 'codedHeight': 240, 'frameRate': 30, 'chunks': chunks}, open(f'{sys.argv[2]}/square.json', 'w'), indent=1)
print(len(chunks), len(blob))
PY
