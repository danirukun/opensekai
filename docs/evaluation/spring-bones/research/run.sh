#!/bin/sh
# Reruns the spring bone research. Needs a node_modules with three@0.187.0 and @pixiv/three-vrm@3.5.5
# next to these files (a symlink to the repository packages is enough), and esbuild 0.28.2 on PATH.
# Usage: ./run.sh <library dir with avatar_*.vrm> <nina.vrm> <xiulang.vrm> <nemimi.vrm>
set -eu
LIB=$1; shift
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
python3 -I springcount.py "$LIB"/avatar_*.vrm
node bench-threevrm.mjs "$LIB"/avatar_*.vrm
node skeleton-json.mjs "$@"
EXACT=1 node bench-flat.mjs "$@"
node bench-flat.mjs "$@"
# One solver per fresh process: three-vrm and flat, twice each, in JavaScriptCore and in V8.
esbuild jsc-main.mjs --bundle --format=iife --outfile=jsc-bundle.js --log-level=warning
for mode in three three flat flat; do
  "$JSC" -e "globalThis.BENCH_DIR='json'; globalThis.MODE='$mode'" jsc-bundle.js
  MODE=$mode node node-main.mjs
done
node chaos.mjs "$@"
node converge.mjs json/a0.json json/a1.json json/a2.json
node fixedstep.mjs json/a0.json json/a1.json json/a2.json
node fixedstep2.mjs json/a0.json json/a1.json json/a2.json
