# usage: python3 -I vrm-inventory.py <file.vrm>... — VRM version, license, and the material shader of each material (VRM 0.x) or the MToon/unlit state (VRM 1.0).
import json, os, struct, sys
from collections import Counter

for path in sys.argv[1:]:
    with open(path, 'rb') as f:
        magic, _, _ = struct.unpack('<III', f.read(12))
        if magic != 0x46546C67:
            print(os.path.basename(path), 'not a GLB'); continue
        n, _ = struct.unpack('<II', f.read(8))
        js = json.loads(f.read(n))
    ext = js.get('extensions', {})
    mats = js.get('materials', [])
    if 'VRM' in ext:
        v0 = ext['VRM']
        shaders = Counter(p.get('shader') for p in v0.get('materialProperties', []))
        lic = v0.get('meta', {}).get('licenseName')
        kind = 'VRM 0.x'
    elif 'VRMC_vrm' in ext:
        shaders = Counter('MToon10' if 'VRMC_materials_mtoon' in m.get('extensions', {}) else
                          'unlit' if 'KHR_materials_unlit' in m.get('extensions', {}) else 'PBR' for m in mats)
        meta = ext['VRMC_vrm'].get('meta', {})
        lic = f"commercial={meta.get('commercialUsage')} modification={meta.get('modification')} redistribution={meta.get('allowRedistribution')}"
        kind = 'VRM 1.0'
    else:
        shaders, lic, kind = Counter(), None, 'glTF'
    tt = sum(1 for m in mats for k in ('baseColorTexture',) if 'KHR_texture_transform' in m.get('pbrMetallicRoughness', {}).get(k, {}).get('extensions', {}))
    print(f"{os.path.basename(path)}: {kind}, {len(mats)} materials, shaders {dict(shaders)}, texture transforms {tt}, license {lic}")
