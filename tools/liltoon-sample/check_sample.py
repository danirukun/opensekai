"""Step 5 check: read the GLB JSON of the exported VRM and check MOCHIYA_materials_liltoon on each material."""
import json
import struct
import sys

path = sys.argv[1]
out_json = sys.argv[2] if len(sys.argv) > 2 else None
EXT = "MOCHIYA_materials_liltoon"

with open(path, 'rb') as f:
    magic, version, length = struct.unpack('<III', f.read(12))
    assert magic == 0x46546C67, "not a GLB"
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    js = json.loads(f.read(chunk_len))

print("generator:", js['asset'].get('generator'))
print("extensionsUsed:", js.get('extensionsUsed'))
print("extensionsRequired:", js.get('extensionsRequired'))
print("VRMC_vrm specVersion:", js.get('extensions', {}).get('VRMC_vrm', {}).get('specVersion'))
textures = js.get('textures', [])
images = js.get('images', [])
print(f"textures: {len(textures)} images: {len(images)} materials: {len(js['materials'])}")
assert EXT in js.get('extensionsUsed', []), f"{EXT} not in extensionsUsed"

failures = 0
first = None
feature_flags = ["_UseShadow", "_UseBumpMap", "_UseRim", "_UseBacklight", "_UseMatCap", "_UseEmission"]
for i, m in enumerate(js['materials']):
    ext = m.get('extensions', {}).get(EXT)
    if ext is None:
        print(f"[{i}] {m['name']}: NO EXTENSION")
        failures += 1
        continue
    if first is None:
        first = ext
    ok = ext.get('specVersion') == "1.3" and isinstance(ext.get('shaderVariant'), str) and ext['shaderVariant']
    props = ext.get('properties', {})
    texs = ext.get('textures', {})
    bad_tex = []
    for name, ref in texs.items():
        idx = ref['index'] if isinstance(ref, dict) else ref
        if not (isinstance(idx, int) and 0 <= idx < len(textures)):
            bad_tex.append((name, ref))
        else:
            src = textures[idx].get('source')
            if not (isinstance(src, int) and 0 <= src < len(images)):
                bad_tex.append((name, ref, 'image', src))
    if bad_tex:
        ok = False
    flags = [k for k in feature_flags if props.get(k, 0) >= 1]
    if props.get("_Shadow2ndColor", [0, 0, 0, 0])[3] > 0:
        flags.append("shadow2nd")
    if props.get("_Shadow3rdColor", [0, 0, 0, 0])[3] > 0:
        flags.append("shadow3rd")
    if 'Outline' in ext['shaderVariant']:
        flags.append("outline")
    print(f"[{i}] {m['name']}: specVersion={ext.get('specVersion')} lilToonVersion={ext.get('lilToonVersion')} "
          f"shaderVariant={ext['shaderVariant']} queue={ext.get('renderQueue')} alphaMode={m.get('alphaMode')} "
          f"props={len(props)} textures={sorted(texs.keys())} flags={flags} {'OK' if ok else 'FAIL ' + str(bad_tex)}")
    if not ok:
        failures += 1

if out_json and first is not None:
    with open(out_json, 'w') as f:
        json.dump(first, f, indent=2)
    print("wrote first material extension to", out_json)
print("failures:", failures)
sys.exit(1 if failures else 0)
