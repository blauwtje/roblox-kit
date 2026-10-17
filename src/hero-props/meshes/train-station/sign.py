"""Station sign: a period enamel station sign, "CONCOURSE" in gilt serif on both faces.

Blender units = studs. Width along X (8), depth along Y (0.4), height along Z (2.5), centred on the origin so the
pivot is the bounding-box centre and the bounds match the kit sign's 8 x 2.5 x 0.4 (Roblox X x Y x Z).
The front face looks toward Blender -Y, which Roblox's import puts on the MeshPart's local -Z, like the clock and
departure board. A dark bronze frame with rounded rails runs round a recessed navy enamel panel, with a gilt slip
inside the opening, gilt rosettes at the corners on both faces (their tips set the 0.4 depth) and two cast lifting
eyes on the top rail whose rings top out at the bounds. The panel print (gilt double lining with notched corners,
"CONCOURSE" in Times bold, flanking lozenges) is rendered flat in Workbench first and sampled by both panel faces,
mirrored on the back so it reads correctly from each side. Every part is one material switched by a "paint"
attribute, joined into one mesh, unwrapped (panels enlarged) and baked to color (with occlusion grime), roughness,
metalness and tangent normal maps by `lib`.
"""

import importlib
import math
import os
import sys
from typing import NamedTuple

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
materials = importlib.import_module("lib.materials")
geometry = importlib.import_module("lib.geometry")
run = importlib.import_module("lib.run")
uv = importlib.import_module("lib.uv")

WIDTH, DEPTH, HEIGHT = 8.0, 0.4, 2.5
LEFT, RIGHT, BOTTOM, TOP = -WIDTH / 2, WIDTH / 2, -HEIGHT / 2, HEIGHT / 2
FRAME_TOP = 1.1  # the top rail's top; the lifting eyes rise from it to TOP
RAIL = 0.24  # frame member width
FRAME_Y = 0.15  # frame faces
OPENING_X, OPENING_Z0, OPENING_Z1 = RIGHT - RAIL, BOTTOM + RAIL, FRAME_TOP - RAIL  # the frame's inner edge
SLIP = 0.05  # gilt slip inside the opening
PANEL_Y = 0.08  # panel faces, recessed behind the frame
PANEL_Z = (OPENING_Z0 + OPENING_Z1) / 2
PRINT_W, PRINT_H = 2 * OPENING_X + 0.04, OPENING_Z1 - OPENING_Z0 + 0.04  # the panel area the print image covers
PANEL_UV = 2.6  # panel islands' texel density relative to the rest
PRINT_SIZE = 2048
FONT = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"
CAP_RATIO = 0.662  # Times New Roman cap height per unit font size
NAVY, CREAM, GOLD, FAINT = "#1b345c", "#f1e6c8", "#e2b04a", "#3a5788"
LABEL = "CONCOURSE"
BRONZE, GILT, PANEL = range(3)


def panel_print():
    """Renders the panel print flat in Workbench, seen from +Z with the header toward +Y, and loads it."""
    scene = bpy.context.scene
    made = []
    cache = {}

    def flat(hex_color):
        if hex_color not in cache:
            material = bpy.data.materials.new(hex_color)
            material.diffuse_color = materials.linear(hex_color)
            cache[hex_color] = material
        return cache[hex_color]

    def rect(x0, x1, y0, y1, hex_color, z=0.0):
        mesh = bpy.data.meshes.new("rect")
        mesh.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 1, 2, 3)])
        obj = bpy.data.objects.new("rect", mesh)
        obj.data.materials.append(flat(hex_color))
        scene.collection.objects.link(obj)
        made.append(obj)

    def text(body, cap, x, y, align, hex_color, spacing=1.0, condense=1.0):
        """Text with its cap height centred on y; align is LEFT, CENTER or RIGHT about x. Returns its width."""
        curve = bpy.data.curves.new("text", "FONT")
        curve.body = body
        curve.font = bpy.data.fonts.load(FONT, check_existing=True)
        curve.size = cap / CAP_RATIO
        curve.space_character = spacing
        curve.align_x = align
        curve.align_y = "BOTTOM_BASELINE"
        curve.resolution_u = 5
        obj = bpy.data.objects.new("text", curve)
        obj.location = (x, y - cap / 2, 0.0)
        obj.scale.x = condense
        obj.data.materials.append(flat(hex_color))
        scene.collection.objects.link(obj)
        made.append(obj)
        bpy.context.view_layer.update()
        xs = [(obj.matrix_world @ Vector(corner)).x for corner in obj.bound_box]
        return max(xs) - min(xs)

    def arc(cx, cy, radius, thickness, a0, a1, hex_color):
        bm = bmesh.new()
        steps = 10
        inner, outer = [], []
        for i in range(steps + 1):
            angle = a0 + (a1 - a0) * i / steps
            for ring, r in ((inner, radius - thickness / 2), (outer, radius + thickness / 2)):
                ring.append(bm.verts.new((cx + r * math.cos(angle), cy + r * math.sin(angle), 0.0)))
        for i in range(steps):
            bm.faces.new((inner[i], inner[i + 1], outer[i + 1], outer[i]))
        mesh = bpy.data.meshes.new("arc")
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("arc", mesh)
        obj.data.materials.append(flat(hex_color))
        scene.collection.objects.link(obj)
        made.append(obj)

    def lozenge(x, y, radius, hex_color):
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=True, segments=4, radius=radius)
        mesh = bpy.data.meshes.new("lozenge")
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("lozenge", mesh)
        obj.location = (x, y, 0.0)
        obj.scale.x = 1.35
        obj.data.materials.append(flat(hex_color))
        scene.collection.objects.link(obj)
        made.append(obj)

    rect(-PRINT_W, PRINT_W, -PRINT_H, PRINT_H, NAVY, -0.01)
    # A gilt double lining just inside the slip: the outer line with notched (re-entrant quarter-circle) corners,
    # a fine plain line inside it.
    half_x, half_y = OPENING_X - SLIP - 0.1, (OPENING_Z1 - OPENING_Z0) / 2 - SLIP - 0.1
    line, notch = 0.032, 0.17
    rect(-half_x + notch, half_x - notch, half_y - line, half_y, GOLD)
    rect(-half_x + notch, half_x - notch, -half_y, -half_y + line, GOLD)
    rect(-half_x, -half_x + line, -half_y + notch, half_y - notch, GOLD)
    rect(half_x - line, half_x, -half_y + notch, half_y - notch, GOLD)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            # The arc round the corner point, from the horizontal line's end to the vertical line's end.
            base = {(1, 1): math.pi, (-1, 1): 1.5 * math.pi, (-1, -1): 0.0, (1, -1): 0.5 * math.pi}[(int(sx), int(sy))]
            arc(sx * (half_x - line / 2), sy * (half_y - line / 2), notch - line / 2, line, base, base + math.pi / 2, GOLD)
    inset, fine = 0.09, 0.013
    ix, iy = half_x - inset, half_y - inset
    rect(-ix, ix, iy - fine, iy, GOLD)
    rect(-ix, ix, -iy, -iy + fine, GOLD)
    rect(-ix, -ix + fine, -iy, iy, GOLD)
    rect(ix - fine, ix, -iy, iy, GOLD)
    cap, room = 0.88, 5.75
    width = text(LABEL, cap, 0.0, 0.0, "CENTER", GOLD, spacing=1.12)
    if width > room:
        for obj in made:
            if obj.type == "FONT":
                obj.scale.x = room / width
        width = room
    for sign in (-1.0, 1.0):
        lozenge(sign * (width / 2 + 0.36), 0.0, 0.13, GOLD)
        lozenge(sign * (width / 2 + 0.62), 0.0, 0.06, GOLD)

    camera_data = bpy.data.cameras.new("print-camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = PRINT_W
    camera = bpy.data.objects.new("print-camera", camera_data)
    camera.location = (0.0, 0.0, 5.0)
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_object_outline = False
    scene.display.render_aa = "16"
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = PRINT_SIZE
    scene.render.resolution_y = round(PRINT_SIZE * PRINT_H / PRINT_W)
    scene.render.resolution_percentage = 100
    path = f"{run.OUTPUT}-panel-print.png"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for obj in made + [camera]:
        bpy.data.objects.remove(obj, do_unlink=True)
    scene.camera = None
    scene.render.engine = "CYCLES"
    return bpy.data.images.load(path)


def board_material(print_image):
    material, stack = materials.paint_stack(
        [
            ([(0.2, "#29231d"), (0.8, "#382f25")], "#6e5a3e"),
            ([(0.3, "#a17c38"), (0.7, "#cfa758")], "#ead296"),
        ],
        0.015,
    )
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf, coords, surface = stack["bsdf"], stack["coords"], stack["geometry"]
    patch, wear, worn = stack["patch"], stack["wear"], stack["worn"]
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(surface.outputs["Normal"], normal_z.inputs["Vector"])
    mask = {kind: materials.math_node(tree, "COMPARE", (stack["dark_amount"], float(kind), 0.5)) for kind in range(3)}
    paint_wear = materials.math_node(tree, "MULTIPLY", (wear, mask[BRONZE]))
    printed = materials.printed_face(tree, coords, print_image, PANEL_Z, PRINT_W / 2, PRINT_H / 2)
    fading = materials.ramp_node(nodes, [(0.3, "#ece7de"), (0.75, "#ffffff")])
    links.new(materials.noise(tree, coords, (1.6, 4.0)), fading.inputs["Fac"])
    enamel = materials.mix_color(tree, "MULTIPLY", (1.0, printed, fading.outputs["Color"]))
    paneled = materials.mix_color(tree, "MIX", (mask[PANEL], worn, enamel))
    # Dust settles on surfaces that face up.
    dust_ramp = materials.ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dust = materials.math_node(tree, "MULTIPLY", (dust_ramp.outputs["Color"], materials.math_node(tree, "SUBTRACT", (1.0, mask[PANEL]))))
    dusty = materials.mix_color(tree, "MIX", (dust, paneled, materials.linear("#a39a88")))
    # Faint vertical streaks: noise stretched down the frame.
    streak_mapping = nodes.new("ShaderNodeMapping")
    streak_mapping.inputs["Scale"].default_value = (9.0, 9.0, 0.6)
    links.new(coords, streak_mapping.inputs["Vector"])
    streak_ramp = materials.ramp_node(nodes, [(0.55, "#ffffff"), (0.8, "#e2dbcf")])
    links.new(materials.noise(tree, streak_mapping.outputs["Vector"], (2.0, 4.0)), streak_ramp.inputs["Fac"])
    streaked = materials.mix_color(tree, "MULTIPLY", (1.0, dusty, streak_ramp.outputs["Color"]))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.2
    grime_ramp = materials.ramp_node(nodes, [(0.0, "#73695a"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = materials.mix_color(tree, "MULTIPLY", (1.0, streaked, grime_ramp.outputs["Color"]))
    links.new(grimy, bsdf.inputs["Base Color"])
    # Paint and enamel are dielectric; gilt is metal, and so are bare worn edges.
    worn_metal = materials.math_node(tree, "MULTIPLY", (paint_wear, 0.7))
    gilt_metal = materials.math_node(tree, "MULTIPLY", (mask[GILT], 0.55))
    links.new(materials.math_node(tree, "ADD", (worn_metal, gilt_metal)), bsdf.inputs["Metallic"])
    paint_roughness = nodes.new("ShaderNodeMapRange")
    paint_roughness.inputs["To Min"].default_value = 0.42
    paint_roughness.inputs["To Max"].default_value = 0.6
    links.new(patch, paint_roughness.inputs["Value"])
    rough = materials.mix_float(tree, (paint_wear, paint_roughness.outputs["Result"], 0.35))
    rough = materials.mix_float(tree, (mask[GILT], rough, materials.mix_float(tree, (wear, 0.4, 0.26))))
    rough = materials.mix_float(tree, (mask[PANEL], rough, 0.28))
    rough = materials.mix_float(tree, (dust, rough, 0.85))
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel paint and a cast surface: a fine, weak bump, left off the enamel.
    bump = nodes.new("ShaderNodeBump")
    links.new(materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "SUBTRACT", (1.0, mask[PANEL])), 0.12)), bump.inputs["Strength"])
    bump.inputs["Distance"].default_value = 0.004
    links.new(materials.noise(tree, coords, (40.0, 4.0)), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


class Part(NamedTuple):
    paint: int
    bevel: float = 0.0
    recalc: bool = True


class Turn(NamedTuple):
    segments: int
    paint: int
    axis: str = "Z"
    center: tuple = (0.0, 0.0)
    radial: object = None


def add_part(name, bm, part):
    if part.recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = materials.link_object(name, mesh, MATERIAL)
    materials.mark_paint(obj, part.paint)
    if part.bevel:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = part.bevel
        modifier.segments = 2
    return obj


def block(name, ranges, part):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vert in bm.verts:
        vert.co = Vector([(lo + hi) / 2 + c * (hi - lo) for c, (lo, hi) in zip(vert.co, ranges)])
    return add_part(name, bm, part)


def turn(name, rings, shape):
    """A turned part from (radius, h) rings along an axis: Z round (center x, center y), or Y round (center x,
    center z) with h the absolute y. Trace the profile with the solid on its left (out along the bottom, up the
    outside) so faces point out; a ring of radius 0 is a pole."""
    segments, axis, center, radial = shape.segments, shape.axis, shape.center, shape.radial

    def point(radius, h, theta):
        a, b = radius * math.cos(theta), radius * math.sin(theta)
        if axis == "Z":
            return (center[0] + a, center[1] + b, h)
        return (center[0] + b, h, center[1] + a)

    bm = bmesh.new()
    rows = []
    for radius, h in rings:
        if radius < 1e-6:
            rows.append([bm.verts.new(point(0.0, h, 0.0))])
            continue
        row = []
        for step in range(segments):
            theta = step / segments * 2 * math.pi
            scaled = radius * (radial(theta, h) if radial else 1.0)
            row.append(bm.verts.new(point(scaled, h, theta)))
        rows.append(row)
    for lower, upper in zip(rows, rows[1:]):
        for step in range(segments):
            following = (step + 1) % segments
            if len(lower) == 1:
                bm.faces.new((lower[0], upper[following], upper[step]))
            elif len(upper) == 1:
                bm.faces.new((lower[step], lower[following], upper[0]))
            else:
                bm.faces.new((lower[step], lower[following], upper[following], upper[step]))
    return add_part(name, bm, Part(shape.paint, recalc=False))


def retrace(rings):
    """The same Y-lathe profile on the back face, retraced so its faces still point out."""
    return [(radius, -h) for radius, h in reversed(rings)]


def rail(name, outlines, part):
    """A rectangular frame from an outer and an inner (x0, x1, z0, z1) outline, from -half_y to +half_y in Y."""
    outer, inner, half_y = outlines
    bm = bmesh.new()

    def corners(rect, y):
        x0, x1, z0, z1 = rect
        return [bm.verts.new(co) for co in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))]

    out_front, in_front = corners(outer, -half_y), corners(inner, -half_y)
    out_back, in_back = corners(outer, half_y), corners(inner, half_y)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((out_front[i], out_front[j], in_front[j], in_front[i]))
        bm.faces.new((out_back[j], out_back[i], in_back[i], in_back[j]))
        bm.faces.new((out_front[j], out_front[i], out_back[i], out_back[j]))
        bm.faces.new((in_front[i], in_front[j], in_back[j], in_back[i]))
    return add_part(name, bm, part)


def torus(name, eye, paint):
    """A ring in the XZ plane (its hole faces Y); both counts are multiples of 4, so its top point is exact."""
    center_x, center_z, major, minor = eye
    segments, sides = 16, 8
    bm = bmesh.new()
    rows = []
    for i in range(segments):
        theta = i / segments * 2 * math.pi
        row = []
        for k in range(sides):
            phi = k / sides * 2 * math.pi
            reach = major + minor * math.cos(phi)
            row.append(bm.verts.new((center_x + reach * math.cos(theta), minor * math.sin(phi), center_z + reach * math.sin(theta))))
        rows.append(row)
    for i in range(segments):
        for k in range(sides):
            a, b = rows[i], rows[(i + 1) % segments]
            bm.faces.new((a[k], b[k], b[(k + 1) % sides], a[(k + 1) % sides]))
    return add_part(name, bm, Part(paint))


ROSETTE = [(0.0, -DEPTH / 2), (0.03, -0.198), (0.05, -0.192), (0.068, -0.181), (0.082, -0.168), (0.09, -0.156), (0.092, -0.135)]
EYE_X = 2.7


def rosette_petals(theta, h):
    return 1 - 0.16 * (1 - abs(math.cos(4 * theta))) ** 1.5


def frame():
    """A dark bronze frame with rounded rails round a recessed navy panel, a gilt slip inside the opening, gilt
    rosettes at the corners on both faces and two cast lifting eyes on the top rail."""
    rail("frame", ((LEFT, RIGHT, BOTTOM, FRAME_TOP), (-OPENING_X, OPENING_X, OPENING_Z0, OPENING_Z1), FRAME_Y), Part(BRONZE, 0.045))
    block("panel", ((-OPENING_X - 0.01, OPENING_X + 0.01), (-PANEL_Y, PANEL_Y), (OPENING_Z0 - 0.01, OPENING_Z1 + 0.01)), Part(PANEL))
    slip_outer = (-OPENING_X - 0.01, OPENING_X + 0.01, OPENING_Z0 - 0.01, OPENING_Z1 + 0.01)
    slip_inner = (-OPENING_X + SLIP, OPENING_X - SLIP, OPENING_Z0 + SLIP, OPENING_Z1 - SLIP)
    rail("slip", (slip_outer, slip_inner, 0.12), Part(GILT, 0.014))
    corner_x, corner_z = (OPENING_X + RIGHT) / 2, ((BOTTOM + OPENING_Z0) / 2, (OPENING_Z1 + FRAME_TOP) / 2)
    for x in (-corner_x, corner_x):
        for z in corner_z:
            petals = Turn(32, GILT, axis="Y", center=(x, z), radial=rosette_petals)
            turn(f"rosette-front-{x:+.1f}-{z:+.1f}", ROSETTE, petals)
            turn(f"rosette-back-{x:+.1f}-{z:+.1f}", retrace(ROSETTE), petals)
    eye_major, eye_minor = 0.065, 0.028
    for x in (-EYE_X, EYE_X):
        block(f"lug-{x:+.1f}", ((x - 0.1, x + 0.1), (-0.05, 0.05), (FRAME_TOP - 0.03, FRAME_TOP + 0.07)), Part(BRONZE, 0.012))
        torus(f"eye-{x:+.1f}", (x, TOP - eye_major - eye_minor, eye_major, eye_minor), BRONZE)


def density(paint, face):
    """Panel faces' islands grown, the hidden panel edges shrunk, before one repack."""
    if paint == PANEL:
        return PANEL_UV if abs(face.normal.y) > 0.9 else 0.1
    return None


bpy.ops.wm.read_factory_settings(use_empty=True)
run.set_up_cycles()
PRINT = panel_print()
MATERIAL = board_material(PRINT)
frame()
board = geometry.finish("sign")
corners = [Vector(corner) for corner in board.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("sign triangles", run.triangle_count(board), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high), "modifiers", len(board.modifiers))
uv.unwrap([board], face_scale=density)
run.bake([board], [MATERIAL], "sign")
run.export_glb([board], "sign")
