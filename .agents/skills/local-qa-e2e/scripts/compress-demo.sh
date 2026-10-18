#!/usr/bin/env bash
# Speed up and compress a demo video for a GitHub PR comment.
# Usage: compress-demo.sh <input.mp4> <output.mp4> [speed]
#   speed: 1.0–2.0. Default: picked from the input length (2.0 above 60 s, 1.5 above 20 s, else 1.25).
# Env: CROP=<ffmpeg crop filter> (from arrange-windows.js) is applied before scaling.
# Output: H.264 High, yuv420p, at most 1280 px wide, no audio, +faststart.
# It raises CRF until the file is under the budget (MAX_MB, default 9.5, below GitHub's 10 MB video limit).
set -euo pipefail

input=${1:?input video}
output=${2:?output video}
max_mb=${MAX_MB:-9.5}
crop=${CROP:+${CROP},}

duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$input")
speed=${3:-$(awk -v d="$duration" 'BEGIN { print (d > 60) ? 2.0 : (d > 20) ? 1.5 : 1.25 }')}
awk -v s="$speed" 'BEGIN { exit !(s >= 1.0 && s <= 2.0) }' || { echo "speed must be 1.0–2.0" >&2; exit 2; }

budget=$(awk -v m="$max_mb" 'BEGIN { printf "%d", m * 1024 * 1024 }')
for crf in 28 31 34 37 40; do
  ffmpeg -v error -y -i "$input" \
    -vf "${crop}setpts=PTS/${speed},fps=30,scale='min(1280,iw)':-2:flags=lanczos" \
    -an -c:v libx264 -preset slow -crf "$crf" -profile:v high -pix_fmt yuv420p \
    -movflags +faststart "$output"
  size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output")
  if [ "$size" -le "$budget" ]; then
    out_duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$output")
    printf '{"output":"%s","speed":%s,"crf":%s,"bytes":%s,"inputSeconds":%.1f,"outputSeconds":%.1f}\n' \
      "$output" "$speed" "$crf" "$size" "$duration" "$out_duration"
    exit 0
  fi
done
echo "Still above ${max_mb} MB at CRF 40 ($size bytes). Trim the recording or record a smaller window." >&2
exit 1
