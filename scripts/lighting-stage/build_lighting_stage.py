"""Build the OpenSekai lighting stage (fixture_lighting_stage) in Blender 5.2+ and export it as one GLB.

Headless: Blender --background --factory-startup --python build_lighting_stage.py -- --out lighting-stage.glb
`pnpm build:lighting-stage` runs this and validates the file. No download, no texture: every surface is a flat material.

Layout values are in glTF coordinates (metres, Y up, the avatar at the origin faces +Z).
A dark glossy floor, a back wall with five emissive strips, a low round platform at the origin, and two props that catch shadows.
"""

import json
import math
import os
import struct
import sys

import bpy

SCENE = "OpenSekai Lighting Stage"
TAG = "opensekai_lighting_stage"
CREDITS = {"title": "OpenSekai Lighting Stage", "author": "Oshi Connect", "license": "CC0-1.0"}
EPS = 0.005  # gap between a strip and the wall behind it

FLOOR = 12.0
WALL_H = 4.5
WALL_T = 0.1
PLATFORM = {"radius": 1.5, "height": 0.2}
EMISSION = 4.0
STRIPS = [  # x position, sRGB colour: 2 cool, 2 warm, 1 magenta
    (-3.0, (90, 180, 255)), (-1.5, (255, 170, 80)), (0.0, (255, 90, 210)), (1.5, (255, 170, 80)), (3.0, (90, 180, 255)),
]


def tagged(block):
    """Mark a data block as ours, so a rebuild in a live Blender removes it and keeps the user's data."""
    block[TAG] = True
    return block


def to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(r, g, b):
    return (to_linear(r), to_linear(g), to_linear(b), 1.0)


def bl(p):
    """glTF (x, y, z) to Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


def principled(name, color, roughness, emission=None):
    mat = tagged(bpy.data.materials.new(name))
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = EMISSION
    return mat


def mesh_object(collection, name, verts, faces, mat, smooth=False):
    mesh = tagged(bpy.data.meshes.new(name))
    mesh.from_pydata([bl(v) for v in verts], [], faces)
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def box(collection, name, lo, hi, mat):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    # Outward faces in glTF coordinates; bl() is a proper rotation, so winding is kept.
    f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
    return mesh_object(collection, name, v, f, mat)


def quad(collection, name, lo, hi, mat):
    """The top face of a box footprint, facing +Y: the floor."""
    (x0, y0, z0), (x1, _, z1) = lo, hi
    return mesh_object(collection, name, [(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)], [[0, 1, 2, 3]], mat)


def cylinder(collection, name, base, radius, height, mat, segments=64):
    bx, by, bz = base
    v, f = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        v.append((bx + radius * math.cos(a), by, bz - radius * math.sin(a)))
        v.append((bx + radius * math.cos(a), by + height, bz - radius * math.sin(a)))
    for i in range(segments):
        j = (i + 1) % segments
        f.append([2 * i, 2 * j, 2 * j + 1, 2 * i + 1])
    f.append([2 * i for i in range(segments)][::-1])
    f.append([2 * i + 1 for i in range(segments)])
    return mesh_object(collection, name, v, f, mat)


def stage():
    scene = bpy.data.scenes.get(SCENE)
    if scene:
        for obj in list(scene.collection.all_objects):
            bpy.data.objects.remove(obj)
        bpy.data.scenes.remove(scene)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for item in [item for item in coll if item.get(TAG)]:
            coll.remove(item)

    scene = bpy.data.scenes.new(SCENE)
    scene.unit_settings.system = "METRIC"
    root = scene.collection

    floor = principled("dark floor", srgb(22, 22, 28), roughness=0.35)
    wall = principled("dark wall", srgb(30, 30, 36), roughness=0.9)
    prop = principled("prop grey", srgb(110, 110, 116), roughness=0.7)
    platform = principled("platform", srgb(60, 60, 68), roughness=0.5)

    half = FLOOR / 2
    quad(root, "floor", (-half, 0, -half), (half, 0, half), floor)
    box(root, "back wall", (-half, 0, -half - WALL_T), (half, WALL_H, -half), wall)
    for i, (x, color) in enumerate(STRIPS):
        glow = srgb(*color)
        strip = principled(f"strip {i + 1}", (0.0, 0.0, 0.0, 1.0), roughness=1.0, emission=glow)
        box(root, f"strip {i + 1}", (x - 0.15, 0.3, -half), (x + 0.15, 3.9, -half + EPS), strip)
    cylinder(root, "platform", (0, 0, 0), PLATFORM["radius"], PLATFORM["height"], platform)
    for name, x in (("shadow box left", -2.5), ("shadow box right", 2.5)):
        box(root, name, (x - 0.3, 0, -0.8), (x + 0.3, 1.2, -0.2), prop)
    return scene


def set_asset_extras(path):
    """The importer reads credits from asset.extras (environment import R14). The exporter cannot write them."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2
    json_len, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(data[20:20 + json_len])
    gltf["asset"]["extras"] = dict(CREDITS)
    rest = data[20 + json_len:]
    body = json.dumps(gltf, separators=(",", ":")).encode()
    body += b" " * (-len(body) % 4)
    out = struct.pack("<III", magic, version, 12 + 8 + len(body) + len(rest)) + struct.pack("<II", len(body), json_type) + body + rest
    with open(path, "wb") as f:
        f.write(out)


def export(scene, out):
    window = bpy.context.window
    if window:
        window.scene = scene
    with bpy.context.temp_override(scene=scene):
        bpy.ops.export_scene.gltf(
            filepath=out, export_format="GLB", use_active_scene=True, export_yup=True, export_apply=True,
            export_cameras=False, export_lights=False, export_image_format="AUTO", export_texcoords=False,
            export_normals=True, export_tangents=False, export_materials="EXPORT", export_draco_mesh_compression_enable=False,
            export_extras=False, export_animations=False)
    set_asset_extras(out)


def report(scene):
    objects = list(scene.collection.all_objects)
    bounds = {}
    for o in objects:
        pts = [o.matrix_world @ v.co for v in o.data.vertices]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        bounds[o.name] = {"min": [round(lo[0], 3), round(lo[2], 3), round(-hi[1], 3)],
                          "max": [round(hi[0], 3), round(hi[2], 3), round(-lo[1], 3)]}
    return {
        "objects": len(objects),
        "types": sorted({o.type for o in objects}),
        "materials": sorted({s.material.name for o in objects for s in o.material_slots if s.material}),
        "bounds": bounds,
    }


def build(out=None):
    scene = stage()
    if bpy.context.window:
        bpy.context.window.scene = scene
    if out:
        export(scene, out)
    return report(scene)


def main(argv):
    args = dict(zip(argv[::2], argv[1::2]))
    print("LIGHTING_STAGE_REPORT " + json.dumps(build(out=os.path.abspath(args["--out"]))))


if __name__ == "__main__" and "--" in sys.argv:
    main(sys.argv[sys.argv.index("--") + 1:])
