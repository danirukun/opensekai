#!/bin/bash
# usage: convert.sh <repo> <Avatar> [catboy|none]
# Copies the editor scripts of <repo>/tools/liltoon-sample into the Unity project, then runs convert, export,
# capture, and capture original for Assets/<Avatar>. Outputs go to <project>/Export/<Avatar>/.
# The preset defaults to catboy for Catboy and to none for each other avatar, as in the editor scripts.
# LILTOON_PROJECT overrides the project path (default ~/opensekai-liltoon-sample).
set -u
REPO="$1"; AVATAR="$2"
DEFAULT_PRESET=none
[ "$AVATAR" = Catboy ] && DEFAULT_PRESET=catboy
PRESET="${3:-$DEFAULT_PRESET}"
P="${LILTOON_PROJECT:-$HOME/opensekai-liltoon-sample}"
L="$P-logs"
UNITY=/Applications/Unity/Hub/Editor/6000.0.71f1/Unity.app/Contents/MacOS/Unity
[ -x "$UNITY" ] || { echo "Unity 6000.0.71f1 is not installed at $UNITY"; exit 1; }
[ -d "$P/Assets/$AVATAR" ] || { echo "No $P/Assets/$AVATAR; copy the source .vrm there first"; exit 1; }
if pgrep -fi "Unity.app/Contents/MacOS/Unity.*projectpath.*$(basename "$P")" > /dev/null; then
  echo "A Unity Editor is running; close the project before a batch run"; exit 1
fi
mkdir -p "$L" "$P/Assets/Editor"
cp "$REPO"/tools/liltoon-sample/Editor/*.cs "$REPO"/tools/liltoon-sample/Editor/*.asmdef "$P/Assets/Editor/"
for step in LilToonSampleConvert.Run LilToonSampleExport.Run LilToonSampleExport.Capture LilToonSampleExport.CaptureOriginal; do
  log="$L/$AVATAR-$step.log"
  "$UNITY" -batchmode -quit -projectPath "$P" -executeMethod "$step" -avatar "$AVATAR" -preset "$PRESET" -logFile "$log"
  rc=$?
  echo "$step rc=$rc log=$log"
  if [ $rc -ne 0 ]; then
    grep -n -A12 "error CS\|failed:\|Exception" "$log" | head -40
    exit $rc
  fi
done
echo "Export: $P/Export/$AVATAR"
ls -l "$P/Export/$AVATAR"
