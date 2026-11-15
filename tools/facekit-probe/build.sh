#!/usr/bin/env bash
# Builds the FaceKit probe and signs it ad hoc with the camera entitlement.
# --hardened adds the hardened runtime to the ad hoc signature.
set -euo pipefail

here="$(dirname "$0")"
out="$here/facekit_probe"

clang -fobjc-arc -O2 -Wall \
  -framework Foundation -framework AVFoundation -framework CoreMedia -framework CoreVideo \
  -framework CoreGraphics -framework ImageIO -framework Vision \
  -sectcreate __TEXT __info_plist "$here/Info.plist" \
  -o "$out" "$here/facekit_probe.m"

if [[ "${1:-}" == "--hardened" ]]; then
  codesign --force --sign - --options runtime --entitlements "$here/camera.entitlements" "$out"
else
  codesign --force --sign - --entitlements "$here/camera.entitlements" "$out"
fi

echo "built $out"
