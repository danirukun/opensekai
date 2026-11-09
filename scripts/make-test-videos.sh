#!/usr/bin/env bash
# Makes the B29 video screen test files in fixtures/video/.
# The tests read the committed files. They do not run this script.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/fixtures/video"
mkdir -p "$out"

# Solid colors that change each 0.5 s: red, green, blue, white (2 s in total).
colors='color=c=0xff0000:s=64x36:r=30:d=0.5[a];color=c=0x00ff00:s=64x36:r=30:d=0.5[b];color=c=0x0000ff:s=64x36:r=30:d=0.5[c];color=c=0xffffff:s=64x36:r=30:d=0.5[d];[a][b][c][d]concat=n=4:v=1:a=0'
tags=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
sine=(-f lavfi -t 2 -i "sine=frequency=440:sample_rate=48000")
common=(-hide_banner -loglevel error -y)

log="$out/README.md"
run() {
  printf -- '- `ffmpeg %s`\n' "$*" >> "$log.tmp"
  ffmpeg "${common[@]}" "$@"
}

: > "$log.tmp"

run -filter_complex "$colors,format=yuv420p" "${sine[@]}" -c:v libx264 -profile:v baseline -g 15 "${tags[@]}" -c:a aac -b:a 32k -shortest -movflags +faststart "$out/h264-aac.mp4"
run -filter_complex "$colors,format=yuv420p" -c:v libx264 -profile:v baseline -g 15 "${tags[@]}" -an "$out/h264-late-moov.mp4"
run -display_rotation 90 -i "$out/h264-late-moov.mp4" -c copy -movflags +faststart "$out/h264-turned.mp4"
run -filter_complex "$colors,format=yuv420p" -c:v libx265 -tag:v hvc1 -x265-params log-level=error "${tags[@]}" -an "$out/hevc.mp4"
run -filter_complex "$colors,format=yuv420p" -c:v libaom-av1 -usage realtime -cpu-used 8 -g 15 "${tags[@]}" -an "$out/av1.mp4"
run -filter_complex "$colors,format=yuv420p" -c:v libvpx -b:v 200k -g 15 "${tags[@]}" -an "$out/vp8.webm"
run -filter_complex "$colors,format=yuv420p" "${sine[@]}" -c:v libvpx-vp9 -b:v 200k -g 15 "${tags[@]}" -c:a libopus -b:a 32k -shortest "$out/vp9-opus.webm"
run -filter_complex "$colors,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,W/2),0,255)'" -c:v libvpx-vp9 -b:v 200k -g 15 -auto-alt-ref 0 "${tags[@]}" -an "$out/vp9-alpha.webm"
run -filter_complex "$colors,format=yuv420p" -c:v libaom-av1 -usage realtime -cpu-used 8 -g 15 "${tags[@]}" -an "$out/av1.webm"

{
  echo '# Video screen test files'
  echo
  echo 'Made by `scripts/make-test-videos.sh` for the B29 video screen tests. Each file is 2 s long, 64 × 36, and shows red, green, blue, and white for 0.5 s each. `vp9-alpha.webm` has alpha 0 in the left half and alpha 255 in the right half. `h264-turned.mp4` has a 90-degree display matrix. `h264-late-moov.mp4` has its `moov` box after `mdat`.'
  echo
  echo '`expected.json` holds the values that the host parser (`parse_video`) and the renderer reader (`readVideoInfo`) must give for each file. The tests do not run ffmpeg.'
  echo
  echo "ffmpeg: $(ffmpeg -version | head -1)"
  echo
  echo 'Commands:'
  echo
  sed "s#$out/##g" "$log.tmp"
} > "$log"
rm "$log.tmp"

ls -l "$out"
