#!/usr/bin/env bash
# Put a recording under a branded overlay PNG and encode a social post video.
# Usage: overlay-post.sh <input video> <output.mp4> [overlay.png]
#   overlay: default is ../assets/opensekai-square-post.png (1080x1080, transparent above the bar).
# The output size is the overlay size. The footage goes into the overlay's transparent area,
# which is found from the alpha channel, so a new overlay layout needs no code change.
# Env:
#   FIT=1    scale the whole frame into the area and fill the rest with BG (default: fill and crop the sides)
#   BG       pad colour (default 0xF5F5F8)
#   CROP     ffmpeg crop filter applied to the input first (for example crop=1320:740:740:470)
# Output: H.264 High, yuv420p, CRF 16, the input audio as AAC if it has audio, +faststart.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
input=${1:?input video}
output=${2:?output mp4}
overlay=${3:-$here/../assets/opensekai-square-post.png}
bg=${BG:-0xF5F5F8}
pre=${CROP:+${CROP},}

[ -f "$overlay" ] || { echo "overlay not found: $overlay" >&2; exit 2; }

# Size of the overlay, and the bounding box of its transparent pixels (alpha < 128).
size=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "$overlay")
IFS=, read -r ow oh <<<"$size"
box=$(ffmpeg -hide_banner -i "$overlay" -vf "alphaextract,negate,bbox=min_val=128" -f null - 2>&1 | grep -o 'x1:[0-9]* x2:[0-9]* y1:[0-9]* y2:[0-9]*' | tail -1)
[ -n "$box" ] || { echo "overlay has no transparent area: $overlay" >&2; exit 2; }
# yuv420p needs even sizes. Round the area up; the extra pixel goes under the opaque overlay edge.
area=$(awk -v ow="$ow" -v oh="$oh" '{
  split($1,a,":"); split($2,b,":"); split($3,c,":"); split($4,d,":")
  x=a[2]; y=c[2]; w=b[2]-x+1; h=d[2]-y+1; w+=w%2; h+=h%2
  if (x+w > ow) x=ow-w; if (y+h > oh) y=oh-h
  print x, y, w, h }' <<<"$box")
read -r x y w h <<<"$area"

if [ "${FIT:-0}" = 1 ]; then
  fit="scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bg}"
else
  fit="scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}"
fi
graph="[0:v]${pre}${fit},setsar=1,pad=${ow}:${oh}:${x}:${y}:color=${bg}[bg];[bg][1:v]overlay=0:0:shortest=1,format=yuv420p[v]"

audio=(-an)
if [ -n "$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$input")" ]; then
  audio=(-map 0:a:0 -c:a aac -b:a 192k)
fi

ffmpeg -v error -y -i "$input" -loop 1 -i "$overlay" -filter_complex "$graph" -map "[v]" "${audio[@]}" \
  -c:v libx264 -preset slow -crf 16 -profile:v high -movflags +faststart "$output"

size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output")
seconds=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$output")
printf '{"output":"%s","width":%s,"height":%s,"footageArea":"%sx%s+%s+%s","fit":%s,"bytes":%s,"seconds":%.2f}\n' \
  "$output" "$ow" "$oh" "$w" "$h" "$x" "$y" "${FIT:-0}" "$size" "$seconds"
