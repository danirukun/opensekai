"""Build the OpenSekai test stage (fixture_test_stage) in Blender 5.2+ and export it as one GLB.

Headless: Blender --background --factory-startup --python build_test_stage.py -- --out stage.glb --maps <dir>
`pnpm build:test-stage` downloads the PolyHaven maps and runs this. In a live Blender, exec the file and call
build(out=None, maps=<dir>) to build the stage in its own scene without an export.

Layout values are in glTF coordinates (metres, Y up, the avatar at the origin faces +Z).
The contract is spdd/prompt/2026-10-18-test-stage.md.
"""

import json
import math
import os
import struct
import sys
import tempfile

import bmesh
import bpy
import numpy as np

SCENE = "OpenSekai Test Stage"
CREDITS = {"title": "OpenSekai Test Stage", "author": "Oshi Connect", "license": "CC0-1.0"}
EPS = 0.005  # gap between a panel and the surface behind it

STAGE = 10.0
WALL_H = 4.0
WALL_T = 0.1
FOCUS_Y = 0.85
COVE = {"z0": -4.5, "z1": 0.5, "top": 3.5, "radius": 0.75, "reach": -2.0}

PBR_MAPS = {"base": "concrete_floor_02_diff_1k.jpg", "normal": "concrete_floor_02_nor_gl_1k.jpg",
            "rough": "concrete_floor_02_rough_1k.jpg"}

# ColorChecker Classic, sRGB D65 (BabelColor averages), row by row from dark skin.
CHECKER = [
    ((115, 82, 68), "dark skin"), ((194, 150, 130), "light skin"), ((98, 122, 157), "blue sky"),
    ((87, 108, 67), "foliage"), ((133, 128, 177), "blue flower"), ((103, 189, 170), "bluish green"),
    ((214, 126, 44), "orange"), ((80, 91, 166), "purplish blue"), ((193, 90, 99), "moderate red"),
    ((94, 60, 108), "purple"), ((157, 188, 64), "yellow green"), ((224, 163, 46), "orange yellow"),
    ((56, 61, 150), "blue"), ((70, 148, 73), "green"), ((175, 54, 60), "red"),
    ((231, 199, 31), "yellow"), ((187, 86, 149), "magenta"), ((8, 133, 161), "cyan"),
    ((243, 243, 242), "white 9.5"), ((200, 200, 200), "neutral 8"), ((160, 160, 160), "neutral 6.5"),
    ((122, 122, 121), "neutral 5"), ((85, 85, 85), "neutral 3.5"), ((52, 52, 52), "black 2"),
]


TAG = "opensekai_test_stage"


def tagged(block):
    """Mark a data block as ours, so a rebuild in a live Blender removes it and keeps the user's data."""
    block[TAG] = True
    return block


def to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(r, g, b):
    return (to_linear(r), to_linear(g), to_linear(b), 1.0)


def linear_to_srgb8(v):
    v = max(0.0, min(1.0, v))
    s = v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    return round(s * 255)


GREY18 = (0.18, 0.18, 0.18, 1.0)
WHITE = srgb(255, 255, 255)
BLACK = srgb(0, 0, 0)
CHROMA_GREEN = srgb(0, 177, 64)


def bl(p):
    """glTF (x, y, z) to Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


# ---------------------------------------------------------------- chart images

class Chart:
    """A flat 2D drawing in metres, centred on the origin, rendered by an orthographic Workbench camera."""

    def __init__(self, name, width_m, height_m, background):
        self.name, self.w, self.h = name, width_m, height_m
        self.scene = bpy.data.scenes.new(f"chart {name}")
        self.collection = self.scene.collection
        self.layer = 0
        self.rect(-width_m / 2, -height_m / 2, width_m / 2, height_m / 2, background)

    def _add(self, name, data, color):
        obj = bpy.data.objects.new(name, data)
        obj.color = color
        obj.location.z = self.layer * 1e-4
        self.layer += 1
        self.collection.objects.link(obj)
        return obj

    def poly(self, points, color):
        mesh = bpy.data.meshes.new("poly")
        mesh.from_pydata([(x, y, 0.0) for x, y in points], [], [list(range(len(points)))])
        return self._add("poly", mesh, color)

    def polys(self, polygons, color):
        verts, faces = [], []
        for points in polygons:
            faces.append(list(range(len(verts), len(verts) + len(points))))
            verts += [(x, y, 0.0) for x, y in points]
        mesh = bpy.data.meshes.new("polys")
        mesh.from_pydata(verts, [], faces)
        return self._add("polys", mesh, color)

    def rect(self, x0, y0, x1, y1, color):
        return self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], color)

    def frame(self, x0, y0, x1, y1, width, color):
        h = width / 2
        self.polys([
            [(x0 - h, y0 - h), (x1 + h, y0 - h), (x1 + h, y0 + h), (x0 - h, y0 + h)],
            [(x0 - h, y1 - h), (x1 + h, y1 - h), (x1 + h, y1 + h), (x0 - h, y1 + h)],
            [(x0 - h, y0 + h), (x0 + h, y0 + h), (x0 + h, y1 - h), (x0 - h, y1 - h)],
            [(x1 - h, y0 + h), (x1 + h, y0 + h), (x1 + h, y1 - h), (x1 - h, y1 - h)],
        ], color)

    def line(self, a, b, width, color):
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy)
        ox, oy = -dy / n * width / 2, dx / n * width / 2
        return self.poly([(a[0] + ox, a[1] + oy), (b[0] + ox, b[1] + oy), (b[0] - ox, b[1] - oy), (a[0] - ox, a[1] - oy)], color)

    def disc(self, cx, cy, r, color, segments=96):
        return self.poly([(cx + r * math.cos(2 * math.pi * i / segments), cy + r * math.sin(2 * math.pi * i / segments))
                          for i in range(segments)], color)

    def star(self, cx, cy, r, spokes, color):
        """Siemens star: `spokes` dark wedges over the background."""
        step = 2 * math.pi / (2 * spokes)
        wedges = []
        for i in range(spokes):
            a0, a1 = 2 * i * step, (2 * i + 1) * step
            arc = [(cx + r * math.cos(a0 + (a1 - a0) * k / 8), cy + r * math.sin(a0 + (a1 - a0) * k / 8)) for k in range(9)]
            wedges.append([(cx, cy)] + arc)
        return self.polys(wedges, color)

    def text(self, body, x, y, size, color, align="CENTER", valign="CENTER", rotation=0.0):
        curve = bpy.data.curves.new("text", "FONT")
        curve.body = body
        curve.size = size
        curve.align_x = align
        curve.align_y = valign
        obj = self._add("text", curve, color)
        obj.location.x, obj.location.y = x, y
        obj.rotation_euler.z = rotation
        return obj

    def render(self, width_px, height_px, directory):
        scene = self.scene
        camera = bpy.data.cameras.new("chart camera")
        camera.type = "ORTHO"
        camera.ortho_scale = max(self.w, self.h)
        cam = bpy.data.objects.new("chart camera", camera)
        cam.location = (0.0, 0.0, 10.0)
        self.collection.objects.link(cam)
        scene.camera = cam
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.render.resolution_x, scene.render.resolution_y = width_px, height_px
        scene.render.resolution_percentage = 100
        scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
        scene.render.film_transparent = False
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "8"
        scene.render.filepath = os.path.join(directory, f"{self.name}.png")
        scene.display.render_aa = "32"
        scene.display_settings.display_device = "sRGB"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0.0
        scene.view_settings.gamma = 1.0
        shading = scene.display.shading
        shading.light = "FLAT"
        shading.color_type = "OBJECT"
        shading.show_shadows = False
        shading.show_cavity = False
        shading.show_object_outline = False
        shading.show_specular_highlight = False
        bpy.ops.render.render(write_still=True, scene=scene.name)
        path = scene.render.filepath
        for obj in list(self.collection.objects):
            data = obj.data
            bpy.data.objects.remove(obj)
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve):
                bpy.data.curves.remove(data)
            elif isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)
        bpy.data.scenes.remove(scene)
        return load_image(path, self.name)


def load_image(path, name, colorspace="sRGB"):
    image = tagged(bpy.data.images.load(path, check_existing=False))
    image.name = name
    image.colorspace_settings.name = colorspace
    image.pack()
    return image


def floor_chart(directory):
    c = Chart("floor grid", STAGE, STAGE, GREY18)
    light, mid = srgb(225, 225, 225), srgb(165, 165, 165)
    half = STAGE / 2
    for i in range(-10, 11):
        v = i * 0.5
        major = i % 2 == 0
        width, color = (0.025, light) if major else (0.01, mid)
        c.line((v, -half), (v, half), width, color)
        c.line((-half, v), (half, v), width, color)
    # Axes: chart x = glTF +X, chart y = glTF -Z.
    c.line((-half, 0), (half, 0), 0.04, srgb(200, 40, 40))
    c.line((0, -half), (0, half), 0.04, srgb(40, 90, 210))
    c.poly([(half - 0.05, 0), (half - 0.35, 0.12), (half - 0.35, -0.12)], srgb(200, 40, 40))
    c.poly([(0, -half + 0.05), (0.12, -half + 0.35), (-0.12, -half + 0.35)], srgb(40, 90, 210))
    c.text("+X", half - 0.5, 0.25, 0.22, srgb(200, 40, 40))
    c.text("+Z", 0.3, -half + 0.5, 0.22, srgb(40, 90, 210))
    c.disc(0, 0, 0.1, WHITE)
    c.line((-0.3, 0), (0.3, 0), 0.02, BLACK)
    c.line((0, -0.3), (0, 0.3), 0.02, BLACK)
    for m in range(-4, 5):
        if m:
            c.text(str(m), m + 0.12, 0.14, 0.14, light, align="LEFT")
            c.text(str(-m), 0.12, m + 0.14, 0.14, light, align="LEFT")
    # Camera marks on +Z (chart -y).
    yellow = srgb(240, 200, 30)
    for d in (1, 2, 3, 4):
        y = -d
        c.line((-0.25, y), (0.25, y), 0.04, yellow)
        c.line((0, y), (0, y - 0.2), 0.04, yellow)
        c.text(f"CAM {d} m", -0.35, y, 0.16, yellow, align="RIGHT")
    return c.render(2048, 2048, directory)


def wedge(c, x0, x1, y_mid, freqs, picture_height, lines, horizontal=True):
    """Hyperbolic line wedge from freqs[0] to freqs[1] lines per picture height along x0..x1."""
    segments = 48
    rows = []
    for k in range(segments + 1):
        t = k / segments
        f = freqs[0] + (freqs[1] - freqs[0]) * t
        rows.append((x0 + (x1 - x0) * t, picture_height / f))
    polygons = []
    total = 2 * lines - 1
    for j in range(lines):
        lower, upper = [], []
        for x, w in rows:
            a = (2 * j - total / 2) * w
            lower.append((x, y_mid + a))
            upper.append((x, y_mid + a + w))
        polygons.append(lower + upper[::-1])
    if not horizontal:
        polygons = [[(y, x) for x, y in p] for p in polygons]
    c.polys(polygons, BLACK)


def resolution_chart(directory):
    w, h = 2.0, 1.125
    c = Chart("resolution chart", w, h, WHITE)
    c.frame(-w / 2 + 0.004, -h / 2 + 0.004, w / 2 - 0.004, h / 2 - 0.004, 0.008, BLACK)
    grey = srgb(150, 150, 150)
    for pct in (0.93, 0.9):
        c.frame(-w * pct / 2, -h * pct / 2, w * pct / 2, h * pct / 2, 0.003, grey)
    c.line((-0.08, 0), (0.08, 0), 0.004, BLACK)
    c.line((0, -0.08), (0, 0.08), 0.004, BLACK)
    # Wedges from 200 to 1000 LW/PH. The top wedge has horizontal lines (vertical detail), the left one vertical lines.
    wedge(c, -0.55, 0.55, 0.36, (200, 1000), h, 5, horizontal=True)
    wedge(c, 0.3, -0.3, -0.62, (200, 1000), h, 5, horizontal=False)
    for f in range(200, 1001, 200):
        t = (f - 200) / 800
        c.text(str(f // 100), -0.55 + 1.1 * t, 0.44, 0.035, BLACK)
        c.text(str(f // 100), -0.7, 0.3 - 0.6 * t, 0.035, BLACK, align="RIGHT")
    # Bar groups: 5 bars each, 300 to 1100 LW/PH.
    x = -0.5
    for f in (300, 400, 500, 600, 700, 800, 900, 1000, 1100):
        bar = h / f
        c.polys([[(x + 2 * k * bar, -0.38), (x + (2 * k + 1) * bar, -0.38),
                  (x + (2 * k + 1) * bar, -0.26), (x + 2 * k * bar, -0.26)] for k in range(5)], BLACK)
        c.text(str(f), x + 4.5 * bar, -0.42, 0.025, BLACK)
        x += 10 * bar + 0.07
    # Slanted edges, 5 degrees off vertical and horizontal, for edge-spread checks.
    for cx, angle in ((0.3, 5), (0.62, -5)):
        a = math.radians(angle)
        s = 0.12
        pts = [(-s, -s), (s, -s), (s, s), (-s, s)]
        c.poly([(cx + px * math.cos(a) - py * math.sin(a), 0.03 + px * math.sin(a) + py * math.cos(a)) for px, py in pts], BLACK)
    for cx, cy in ((-0.84, 0.43), (0.84, 0.43), (-0.84, -0.43), (0.84, -0.43)):
        c.star(cx, cy, 0.075, 24, BLACK)
    c.star(-0.3, 0.03, 0.16, 36, BLACK)
    c.text("OpenSekai resolution chart  ·  LW/PH ×100 when the chart fills the frame height  ·  unlit", 0, -0.47, 0.022, BLACK)
    return c.render(2048, 1152, directory)


def siemens_chart(directory):
    c = Chart("siemens star", 1.0, 1.0, WHITE)
    c.star(0, 0, 0.44, 36, BLACK)
    c.frame(-0.49, -0.49, 0.49, 0.49, 0.006, BLACK)
    c.disc(0, 0, 0.012, srgb(220, 40, 40))
    c.text("Siemens star · 36 cycles", 0, -0.47, 0.025, BLACK)
    return c.render(2048, 2048, directory)


def colour_chart(directory):
    w, h = 1.2, 0.9
    c = Chart("colour checker", w, h, srgb(30, 30, 30))
    size, gap = 0.15, 0.02
    x0 = -(6 * size + 5 * gap) / 2
    y0 = 0.42
    for i, ((r, g, b), name) in enumerate(CHECKER):
        row, col = divmod(i, 6)
        x, y = x0 + col * (size + gap), y0 - row * (size + gap)
        c.rect(x, y - size, x + size, y, srgb(r, g, b))
        c.text(name, x + size / 2, y - size - 0.007, 0.014, srgb(200, 200, 200))
    steps = 11
    sw = (w - 0.1) / steps
    for i in range(steps):
        v = linear_to_srgb8(i / (steps - 1))
        x = -w / 2 + 0.05 + i * sw
        c.rect(x, -0.4, x + sw, -0.3, srgb(v, v, v))
        c.text(f"{i * 10}%", x + sw / 2, -0.42, 0.016, srgb(200, 200, 200))
    return c.render(2048, 1536, directory)


def ruler_chart(directory):
    w, h = 0.375, 3.0
    c = Chart("height ruler", w, h, WHITE)
    for i in range(31):
        y = -h / 2 + i * 0.1
        y = min(max(y, -h / 2 + 0.004), h / 2 - 0.004)
        long = i % 5 == 0
        c.line((-w / 2, y), (-w / 2 + (0.2 if long else 0.1), y), 0.008 if long else 0.004, BLACK)
        if long and 0 < i < 30:
            c.text(f"{i / 10:.1f}", -w / 2 + 0.22, y, 0.06, BLACK, align="LEFT")
    c.line((-w / 2 + 0.003, -h / 2), (-w / 2 + 0.003, h / 2), 0.006, BLACK)
    return c.render(256, 2048, directory)


def zone_plate(directory):
    n = 2048
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    r2 = (x - n / 2 + 0.5) ** 2 + (y - n / 2 + 0.5) ** 2
    k = math.pi * 0.5 / (n / 2)  # local frequency reaches 0.5 cycle per pixel at the edge
    v = 0.5 + 0.5 * np.cos(k * r2)
    rgba = np.ones((n, n, 4), dtype=np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = v
    image = bpy.data.images.new("zone plate", n, n, alpha=False)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = os.path.join(directory, "zone plate.png")
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    return load_image(os.path.join(directory, "zone plate.png"), "zone plate")


# ---------------------------------------------------------------- materials

def principled(name, color=None, image=None, roughness=0.9, metallic=0.0, specular=0.5):
    mat = tagged(bpy.data.materials.new(name))
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Specular IOR Level"].default_value = specular
    if image:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Linear"
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    elif color:
        bsdf.inputs["Base Color"].default_value = color
    return mat


def unlit(name, image):
    """Background shader into the output: the glTF exporter writes KHR_materials_unlit."""
    mat = tagged(bpy.data.materials.new(name))
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.remove(nodes["Principled BSDF"])
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    bg = nodes.new("ShaderNodeBackground")
    links.new(tex.outputs["Color"], bg.inputs["Color"])
    links.new(bg.outputs["Background"], nodes["Material Output"].inputs["Surface"])
    return mat


def pbr(name, maps):
    mat = principled(name, roughness=1.0)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    base = nodes.new("ShaderNodeTexImage")
    base.image = load_image(os.path.join(maps, PBR_MAPS["base"]), "pbr base")
    links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = load_image(os.path.join(maps, PBR_MAPS["rough"]), "pbr roughness", "Non-Color")
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    normal = nodes.new("ShaderNodeTexImage")
    normal.image = load_image(os.path.join(maps, PBR_MAPS["normal"]), "pbr normal", "Non-Color")
    nmap = nodes.new("ShaderNodeNormalMap")
    links.new(normal.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


# ---------------------------------------------------------------- geometry

def mesh_object(collection, name, verts, faces, mat, uvs=None, smooth=False):
    mesh = tagged(bpy.data.meshes.new(name))
    mesh.from_pydata([bl(v) for v in verts], [], faces)
    if uvs:
        layer = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                layer.data[li].uv = uvs[vi]
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def quad(collection, name, centre, right, up, w, h, mat):
    """A textured rectangle. `right` and `up` are unit glTF vectors; UV (0,0) is bottom left."""
    cx, cy, cz = centre
    corners = []
    for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        corners.append(tuple(c + su * w / 2 * r + sv * h / 2 * u for c, r, u in zip((cx, cy, cz), right, up)))
    return mesh_object(collection, name, corners, [[0, 1, 2, 3]], mat, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])


def box(collection, name, lo, hi, mat):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    # Outward faces in glTF coordinates; bl() is a proper rotation, so winding is kept.
    f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
    return mesh_object(collection, name, v, f, mat)


def cylinder(collection, name, base, radius, height, mat, segments=24):
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
    return mesh_object(collection, name, v, f, mat, smooth=False)


def sphere(collection, name, centre, radius, mat):
    mesh = tagged(bpy.data.meshes.new(name))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = bl(centre)
    collection.objects.link(obj)
    return obj


def cove(collection, mat):
    x_wall = -STAGE / 2 + EPS
    r = COVE["radius"]
    profile = [(x_wall, COVE["top"])]
    for i in range(17):
        a = math.pi + (math.pi / 2) * i / 16  # 180..270 degrees around the arc centre
        profile.append((x_wall + r + r * math.cos(a), r + r * math.sin(a) + EPS * (i / 16)))
    profile.append((COVE["reach"], EPS))
    verts, faces = [], []
    for x, y in profile:
        verts.append((x, y, COVE["z1"]))
        verts.append((x, y, COVE["z0"]))
    for i in range(len(profile) - 1):
        a, b = 2 * i, 2 * (i + 1)
        faces.append([a, b, b + 1, a + 1])
    return mesh_object(collection, "green cove", verts, faces, mat, smooth=True)


def stage(maps, directory):
    scene = bpy.data.scenes.get(SCENE)
    if scene:
        for obj in list(scene.collection.all_objects):
            bpy.data.objects.remove(obj)
        bpy.data.scenes.remove(scene)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in [item for item in coll if item.get(TAG)]:
            coll.remove(item)

    images = {
        "floor": floor_chart(directory),
        "resolution": resolution_chart(directory),
        "siemens": siemens_chart(directory),
        "zone": zone_plate(directory),
        "colour": colour_chart(directory),
        "ruler": ruler_chart(directory),
    }

    scene = bpy.data.scenes.new(SCENE)
    scene.unit_settings.system = "METRIC"
    root = scene.collection

    grey = principled("wall grey", GREY18, roughness=0.9)
    prop = principled("prop grey", (0.5, 0.5, 0.5, 1.0), roughness=0.6)
    green = principled("chroma green", CHROMA_GREEN, roughness=1.0, specular=0.0)
    chrome = principled("chrome", (0.95, 0.95, 0.95, 1.0), roughness=0.05, metallic=1.0)
    matte = principled("grey 18", GREY18, roughness=1.0, specular=0.0)
    lit = {k: principled(images[k].name, image=images[k], roughness=0.9) for k in ("floor", "siemens", "zone", "colour", "ruler")}

    half = STAGE / 2
    X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    NX, NZ = (-1, 0, 0), (0, 0, -1)

    quad(root, "floor", (0, 0, 0), X, NZ, STAGE, STAGE, lit["floor"])
    box(root, "back wall", (-half - WALL_T, 0, -half - WALL_T), (half, WALL_H, -half), grey)
    box(root, "left wall", (-half - WALL_T, 0, -half), (-half, WALL_H, half), grey)
    cove(root, green)

    back = -half + EPS
    quad(root, "resolution chart", (0, 1.6, back), X, Y, 2.0, 1.125, unlit("resolution chart", images["resolution"]))
    quad(root, "siemens star", (-1.9, 1.6, back), X, Y, 1.0, 1.0, lit["siemens"])
    quad(root, "zone plate", (1.9, 1.6, back), X, Y, 1.0, 1.0, lit["zone"])
    quad(root, "colour checker", (3.85, 1.6, back), X, Y, 1.2, 0.9, lit["colour"])
    quad(root, "height ruler", (-half + EPS, 1.5, 1.2), NZ, Y, 0.375, 3.0, lit["ruler"])

    for i, (x, z) in enumerate(((1.2, -1.0), (2.0, -2.5), (2.8, -4.0))):
        # Low enough that a camera at (0, 1.6, 6) sees the wall charts above them.
        quad(root, f"focus target {i + 1}", (x, FOCUS_Y, z), X, Y, 0.6, 0.6, lit["siemens"])
        quad(root, f"focus target {i + 1} back", (x, FOCUS_Y, z - 0.002), (-1, 0, 0), Y, 0.6, 0.6, prop)
        cylinder(root, f"focus post {i + 1}", (x, 0, z - 0.02), 0.015, FOCUS_Y - 0.3, prop)

    box(root, "shadow cube", (-1.65, 0, -4.25), (-1.15, 0.5, -3.75), prop)
    sphere(root, "shadow sphere", (-0.6, 0.25, -4.1), 0.25, prop)
    cylinder(root, "shadow pole", (-2.3, 0, -4.6), 0.025, 2.0, prop)
    for i in range(3):
        box(root, f"step {i + 1}", (-1.3, 0, -3.3 + i * 0.25), (-0.7, 0.15 * (3 - i), -3.05 + i * 0.25), prop)
    box(root, "thin plate", (3.2, 0.02, 0.2), (3.8, 0.03, 0.8), prop)

    for name, x, mat in (("chrome ball", -1.6, chrome), ("grey ball", -1.1, matte)):
        sphere(root, name, (x, 1.2, -1.0), 0.15, mat)
        cylinder(root, f"{name} post", (x, 0, -1.0), 0.012, 1.05, prop)

    if maps:
        quad(root, "pbr swatch", (3.0, 0.002, 3.0), X, NZ, 2.0, 2.0, pbr("concrete floor 02", maps))
    return scene


# ---------------------------------------------------------------- export

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
            export_cameras=False, export_lights=False, export_image_format="AUTO", export_texcoords=True,
            export_normals=True, export_tangents=True, export_materials="EXPORT", export_draco_mesh_compression_enable=False,
            export_extras=False, export_animations=False)
    set_asset_extras(out)


def report(scene):
    objects = [o for o in scene.collection.all_objects]
    images = sorted({n.image.name: tuple(n.image.size) for o in objects for s in o.material_slots if s.material
                     for n in s.material.node_tree.nodes if n.type == "TEX_IMAGE"}.items())
    bounds = {}
    for o in objects:
        pts = [o.matrix_world @ v.co for v in o.data.vertices]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        # Back to glTF axes.
        bounds[o.name] = {"min": [round(lo[0], 3), round(lo[2], 3), round(-hi[1], 3)],
                          "max": [round(hi[0], 3), round(hi[2], 3), round(-lo[1], 3)]}
    return {
        "objects": len(objects),
        "types": sorted({o.type for o in objects}),
        "materials": sorted({s.material.name for o in objects for s in o.material_slots if s.material}),
        "images": images,
        "bounds": bounds,
    }


def build(out=None, maps=None, directory=None):
    directory = directory or tempfile.mkdtemp(prefix="opensekai-test-stage-")
    scene = stage(maps, directory)
    if bpy.context.window:
        bpy.context.window.scene = scene
    if out:
        export(scene, out)
    return report(scene)


def main(argv):
    args = dict(zip(argv[::2], argv[1::2]))
    result = build(out=os.path.abspath(args["--out"]), maps=args.get("--maps"), directory=args.get("--work"))
    print("TEST_STAGE_REPORT " + json.dumps(result))


if __name__ == "__main__" and "--" in sys.argv:
    main(sys.argv[sys.argv.index("--") + 1:])
