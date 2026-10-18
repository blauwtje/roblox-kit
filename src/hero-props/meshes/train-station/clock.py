"""Station clock: a Victorian double-faced platform clock on a cast-iron column.

Blender units = studs. Width along X (5), depth along Y (1.2), height along Z (10.87): floor at z 0, centred on x
and y, so the bounds match the kit clock's 5 x 10.87 x 1.2 and the recorded-mesh stretch leaves it unscaled.
The front dial faces Blender -Y. The GLB exporter turns that into glTF +Z, and Roblox's import (which put the
ticket machine's Blender +Y face on its local +Z) puts it on the MeshPart's local -Z, the kit clock's front.
Drum centre at z 8.37 (kit 8.365) so the 5-wide bezel tops out at exactly 10.87; no finial or side bosses. Visible
enamel is 4.52 across, at least the kit's 4.5, with print and hands scaled up to read across a concourse.
Dark bronze column and case, gilt rings and hand bosses, cream enamel dials whose print (minute track, Roman
numerals) is drawn in `clock.print.svg` (Liberation Serif Bold), rendered to a png by the generator and sampled by the
dial faces, black spade hands at 10:10 on both
faces. Every part is one material switched by a "paint" attribute, joined into one mesh, unwrapped (dials
enlarged) and baked to color (with occlusion grime), roughness, metalness and tangent normal maps by `shared.py`.
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
geometry = importlib.import_module("lib.geometry")
materials = importlib.import_module("lib.materials")
run = importlib.import_module("lib.run")

CENTER_Z = 8.37  # drum centre; + bezel radius 2.5 = 10.87
DIAL_Y, DIAL_R = 0.46, 2.31
HAND_S, HAND_W = 1.12, 1.3  # hand length and width factors
PRINT_R = 2.3  # half the width the dial print image covers
DIAL_UV = 1.8  # dial islands' texel density relative to the rest
BRONZE, GILT, DIAL, BLACK = range(4)
HOUR_ANGLE, MINUTE_ANGLE = math.radians(305), math.radians(60)  # 10:10, clockwise from 12


def clock_material(print_image):
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
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, separate.inputs["Vector"])
    height = separate.outputs["Z"]
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(surface.outputs["Normal"], normal_z.inputs["Vector"])
    mask = {kind: materials.math_node(tree, "COMPARE", (stack["dark_amount"], float(kind), 0.5)) for kind in range(4)}
    paint_wear = materials.math_node(tree, "MULTIPLY", (wear, mask[BRONZE]))
    printed = materials.printed_face(tree, coords, print_image, CENTER_Z, PRINT_R)
    yellowing = materials.ramp_node(nodes, [(0.3, "#ebe2cc"), (0.75, "#ffffff")])
    links.new(materials.noise(tree, coords, (1.6, 4.0)), yellowing.inputs["Fac"])
    enamel = materials.mix_color(tree, "MULTIPLY", (1.0, printed, yellowing.outputs["Color"]))
    dialled = materials.mix_color(tree, "MIX", (mask[DIAL], worn, enamel))
    black = materials.ramp_node(nodes, [(0.3, "#121110"), (0.7, "#1c1a17")])
    links.new(patch, black.inputs["Fac"])
    blacked = materials.mix_color(tree, "MIX", (mask[BLACK], dialled, black.outputs["Color"]))
    # Rust only on the plinth, where feet and mop buckets chip the paint.
    rust_ramp = materials.ramp_node(nodes, [(0.6, "#000000"), (0.72, "#ffffff")])
    links.new(materials.noise(tree, coords, (4.0, 10.0)), rust_ramp.inputs["Fac"])
    low = nodes.new("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 0.0
    low.inputs["From Max"].default_value = 0.45
    low.inputs["To Min"].default_value = 1.0
    low.inputs["To Max"].default_value = 0.0
    links.new(height, low.inputs["Value"])
    rust = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "MULTIPLY", (rust_ramp.outputs["Color"], low.outputs["Result"])), mask[BRONZE]))
    rusty = materials.mix_color(tree, "MIX", (rust, blacked, materials.linear("#5c3720")))
    # Dust settles on surfaces that face up.
    dust_ramp = materials.ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dust = materials.math_node(tree, "MULTIPLY", (dust_ramp.outputs["Color"], materials.math_node(tree, "SUBTRACT", (1.0, mask[DIAL]))))
    dusty = materials.mix_color(tree, "MIX", (dust, rusty, materials.linear("#a39a88")))
    # Faint vertical streaks: noise stretched along the column.
    streak_mapping = nodes.new("ShaderNodeMapping")
    streak_mapping.inputs["Scale"].default_value = (9.0, 9.0, 0.6)
    links.new(coords, streak_mapping.inputs["Vector"])
    streak_ramp = materials.ramp_node(nodes, [(0.55, "#ffffff"), (0.8, "#e2dbcf")])
    links.new(materials.noise(tree, streak_mapping.outputs["Vector"], (2.0, 4.0)), streak_ramp.inputs["Fac"])
    streaked = materials.mix_color(tree, "MULTIPLY", (1.0, dusty, streak_ramp.outputs["Color"]))
    # Scuffs and floor grime fade out by about knee height.
    floor_ramp = materials.ramp_node(nodes, [(0.0, "#8f8472"), (1.0, "#ffffff")])
    floor_range = nodes.new("ShaderNodeMapRange")
    floor_range.inputs["From Max"].default_value = 1.2
    links.new(height, floor_range.inputs["Value"])
    scuff_noise = materials.math_node(tree, "ADD", (floor_range.outputs["Result"], materials.noise(tree, coords, (6.0, 4.0))))
    links.new(materials.math_node(tree, "MULTIPLY", (scuff_noise, 0.75)), floor_ramp.inputs["Fac"])
    floored = materials.mix_color(tree, "MULTIPLY", (1.0, streaked, floor_ramp.outputs["Color"]))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.2
    grime_ramp = materials.ramp_node(nodes, [(0.0, "#73695a"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = materials.mix_color(tree, "MULTIPLY", (1.0, floored, grime_ramp.outputs["Color"]))
    links.new(grimy, bsdf.inputs["Base Color"])
    # Paint, enamel and hands are dielectric; gilt is metal, and so are bare worn edges, but rust is not.
    unrusted = materials.math_node(tree, "SUBTRACT", (1.0, rust))
    worn_metal = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "MULTIPLY", (paint_wear, 0.7)), unrusted))
    gilt_metal = materials.math_node(tree, "MULTIPLY", (mask[GILT], 0.55))
    links.new(materials.math_node(tree, "ADD", (worn_metal, gilt_metal)), bsdf.inputs["Metallic"])
    paint_roughness = nodes.new("ShaderNodeMapRange")
    paint_roughness.inputs["To Min"].default_value = 0.42
    paint_roughness.inputs["To Max"].default_value = 0.6
    links.new(patch, paint_roughness.inputs["Value"])
    rough = materials.mix_float(tree, (paint_wear, paint_roughness.outputs["Result"], 0.35))
    rough = materials.mix_float(tree, (mask[GILT], rough, materials.mix_float(tree, (wear, 0.4, 0.26))))
    rough = materials.mix_float(tree, (mask[DIAL], rough, 0.22))
    rough = materials.mix_float(tree, (mask[BLACK], rough, 0.45))
    rough = materials.mix_float(tree, (rust, rough, 0.9))
    rough = materials.mix_float(tree, (dust, rough, 0.85))
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel paint and a cast surface: a fine, weak bump, left off the enamel.
    bump = nodes.new("ShaderNodeBump")
    links.new(materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "SUBTRACT", (1.0, mask[DIAL])), 0.12)), bump.inputs["Strength"])
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
    radial: object = None
    caps: tuple = (False, False)


def add_part(name, bm, part):
    if part.recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = materials.link_object(name, mesh, MATERIAL)
    materials.mark_paint(obj, float(part.paint))
    if part.bevel:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = part.bevel
        modifier.segments = 2
    return obj


def block(name, size, part):
    width, depth, z0, z1 = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vert in bm.verts:
        vert.co = Vector((vert.co.x * width, vert.co.y * depth, (z0 + z1) / 2 + vert.co.z * (z1 - z0)))
    return add_part(name, bm, part)


def turn(name, rings, shape):
    """A turned part from (radius, h) rings along an axis (h is the absolute coordinate on that axis; Y and X
    lathes turn round the drum centre's line). Trace the profile with the solid on its left (out along the
    bottom, up the outside) so faces point out; a ring of radius 0 is a pole."""
    segments, axis, radial, caps = shape.segments, shape.axis, shape.radial, shape.caps

    def point(radius, h, theta):
        a, b = radius * math.cos(theta), radius * math.sin(theta)
        if axis == "Z":
            return (a, b, h)
        if axis == "Y":
            return (b, h, CENTER_Z + a)
        return (h, a, CENTER_Z + b)

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
    if caps[0] and len(rows[0]) > 1:
        bm.faces.new(list(reversed(rows[0])))
    if caps[1] and len(rows[-1]) > 1:
        bm.faces.new(rows[-1])
    return add_part(name, bm, Part(shape.paint, recalc=False))


def retrace(rings):
    """The same Y-lathe profile on the back face, retraced so its faces still point out."""
    return [(radius, -h) for radius, h in reversed(rings)]


DROP = 0.135  # astragal and capital lowered to meet the larger drum
SHAFT_BOTTOM, SHAFT_TOP, FLUTES = 2.93, 5.25 - DROP, 12


def column():
    """Stepped bronze plinth, a turned vase base, a plain lower shaft, a collar with a gilt bead, a fluted shaft,
    a gilt astragal and a bell capital cupping the drum."""
    block("plinth", (1.2, 1.2, 0.0, 0.24), Part(BRONZE, 0.03))
    block("plinth-step", (0.98, 0.98, 0.22, 0.38), Part(BRONZE, 0.03))
    base = [
        (0.44, 0.36), (0.465, 0.42), (0.455, 0.48), (0.41, 0.515), (0.375, 0.55), (0.36, 0.62), (0.38, 0.68),
        (0.355, 0.72), (0.31, 0.75), (0.31, 0.82), (0.33, 0.92), (0.315, 1.04), (0.27, 1.13), (0.232, 1.2), (0.212, 1.27),
    ]
    turn("base", base, Turn(24, BRONZE))
    turn("base-ring", [(0.2, 1.26), (0.235, 1.28), (0.25, 1.32), (0.235, 1.36), (0.2, 1.38)], Turn(24, GILT))
    turn("lower-shaft", [(0.206, 1.37), (0.204, 2.0), (0.2, 2.6)], Turn(24, BRONZE))
    turn("collar-low", [(0.198, 2.58), (0.235, 2.6), (0.252, 2.635), (0.252, 2.69), (0.235, 2.715)], Turn(24, BRONZE))
    turn("collar-bead", [(0.232, 2.705), (0.258, 2.725), (0.268, 2.76), (0.258, 2.795), (0.232, 2.815)], Turn(24, GILT))
    turn("collar-high", [(0.235, 2.805), (0.252, 2.83), (0.252, 2.885), (0.235, 2.92), (0.196, 2.94)], Turn(24, BRONZE))

    def shaft_radius(z):
        return 0.197 - 0.019 * (z - SHAFT_BOTTOM) / (SHAFT_TOP - SHAFT_BOTTOM)

    def flutes(theta, z):
        position = (theta * FLUTES / (2 * math.pi)) % 1.0
        groove = math.sin(math.pi * position) ** 0.8
        ends = geometry.smoothstep(SHAFT_BOTTOM + 0.03, SHAFT_BOTTOM + 0.15, z) * geometry.smoothstep(SHAFT_TOP - 0.03, SHAFT_TOP - 0.15, z)
        return 1 - 0.02 * groove * ends / shaft_radius(z)

    heights = [SHAFT_BOTTOM, SHAFT_BOTTOM + 0.07, SHAFT_BOTTOM + 0.15, 4.1, SHAFT_TOP - 0.15, SHAFT_TOP - 0.07, SHAFT_TOP]
    turn("fluted-shaft", [(shaft_radius(z), z) for z in heights], Turn(FLUTES * 4, BRONZE, radial=flutes))
    turn("astragal", [(r, z - DROP) for r, z in [(0.17, 5.23), (0.195, 5.25), (0.206, 5.28), (0.195, 5.31), (0.17, 5.33)]], Turn(24, GILT))
    capital = [
        (0.172, 5.32), (0.182, 5.44), (0.2, 5.54), (0.235, 5.64), (0.285, 5.74), (0.345, 5.83), (0.395, 5.9),
        (0.415, 5.96), (0.4, 6.0), (0.36, 6.02), (0.3, 6.04), (0.24, 6.12),
    ]
    turn("capital", [(r, z - DROP) for r, z in capital], Turn(24, BRONZE))


def drum():
    """Bronze drum, moulded bronze bezels 5 wide with gilt sight rings, a gilt girdle and enamel dials."""
    turn("drum", [(2.44, -0.43), (2.455, -0.32), (2.46, -0.12), (2.46, 0.12), (2.455, 0.32), (2.44, 0.43)], Turn(64, BRONZE, axis="Y"))
    turn("girdle", [(2.455, -0.05), (2.475, -0.04), (2.482, 0.0), (2.475, 0.04), (2.455, 0.05)], Turn(64, GILT, axis="Y"))
    bezel = [(2.31, -0.455), (2.31, -0.525), (2.37, -0.562), (2.45, -0.55), (2.495, -0.5), (2.5, -0.44), (2.43, -0.4)]
    sight = [(2.26, -0.462), (2.272, -0.49), (2.3, -0.5), (2.325, -0.49)]
    dial = [(0.0, -DIAL_Y), (DIAL_R, -DIAL_Y)]
    for side, flip in (("front", lambda rings: rings), ("back", retrace)):
        turn(f"bezel-{side}", flip(bezel), Turn(64, BRONZE, axis="Y"))
        turn(f"sight-{side}", flip(sight), Turn(64, GILT, axis="Y"))
        turn(f"dial-{side}", flip(dial), Turn(64, DIAL, axis="Y"))


# Half outlines (along, across) from the centre: a spade hour hand and a slimmer minute hand with a small spade.
HOUR_HAND = [
    (-0.36, 0.0), (-0.35, 0.05), (-0.31, 0.09), (-0.25, 0.09), (-0.2, 0.065), (0.0, 0.08), (0.55, 0.06), (0.58, 0.12),
    (0.63, 0.18), (0.7, 0.21), (0.78, 0.205), (0.88, 0.165), (0.98, 0.105), (1.08, 0.055), (1.17, 0.02), (1.25, 0.0),
]
MINUTE_HAND = [
    (-0.45, 0.0), (-0.44, 0.06), (-0.38, 0.1), (-0.3, 0.1), (-0.24, 0.065), (-0.2, 0.05), (0.0, 0.06), (1.42, 0.04),
    (1.46, 0.08), (1.52, 0.12), (1.59, 0.13), (1.66, 0.105), (1.74, 0.06), (1.83, 0.022), (1.93, 0.0),
]


def prism_y(name, outline, y0, y1, paint):
    bm = bmesh.new()
    near = [bm.verts.new((x, y0, z)) for x, z in outline]
    far = [bm.verts.new((x, y1, z)) for x, z in outline]
    bm.faces.new(near)
    bm.faces.new(list(reversed(far)))
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        bm.faces.new((near[index], near[following], far[following], far[index]))
    return add_part(name, bm, Part(paint))


def hand(name, half, theta, front, y0, y1):
    """A hand at a clockwise angle from 12 as its face's viewer sees it; the back's viewer has +X on the left."""
    sigma = 1.0 if front else -1.0
    along = (sigma * math.sin(theta), math.cos(theta))
    across = (sigma * math.cos(theta), -math.sin(theta))
    half = [(s * HAND_S, t * HAND_W) for s, t in half]
    points = half + [(s, -t) for s, t in reversed(half[1:-1])]
    outline = [(along[0] * s + across[0] * t, CENTER_Z + along[1] * s + across[1] * t) for s, t in points]
    ys = (-y1, -y0) if front else (y0, y1)
    return prism_y(name, outline, ys[0], ys[1], BLACK)


def hands():
    boss = [(0.0, -0.548), (0.075, -0.545), (0.105, -0.53), (0.115, -0.5), (0.115, -0.455)]
    for front in (True, False):
        side = "front" if front else "back"
        hand(f"hour-{side}", HOUR_HAND, HOUR_ANGLE, front, 0.468, 0.49)
        hand(f"minute-{side}", MINUTE_HAND, MINUTE_ANGLE, front, 0.495, 0.517)
        turn(f"hand-boss-{side}", boss if front else retrace(boss), Turn(16, GILT, axis="Y"))


def join_clock():
    """Converts every part to mesh in world space and joins them into one object, as one MeshPart."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    clock = bpy.context.active_object
    clock.name = "clock"
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    return clock


def unwrap_clock(clock):
    """Smart project, then the dials' islands grown and the plinth's underside shrunk before one repack."""
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(clock.data)
    bm.normal_update()
    uv = bm.loops.layers.uv.active
    paint = bm.verts.layers.float.get("paint")
    for face in bm.faces:
        if round(face.verts[0][paint]) == DIAL:
            factor = DIAL_UV
        elif face.normal.z < -0.9 and face.calc_center_median().z < 0.01:
            factor = 0.1
        else:
            continue
        for loop in face.loops:
            loop[uv].uv *= factor
    bm.to_mesh(clock.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")


bpy.ops.wm.read_factory_settings(use_empty=True)
run.set_up_cycles()
PRINT = materials.print_image(run.arguments[2])
MATERIAL = clock_material(PRINT)
column()
drum()
hands()
clock = join_clock()
corners = [Vector(corner) for corner in clock.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("clock triangles", run.triangle_count(clock), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high), "modifiers", len(clock.modifiers))
unwrap_clock(clock)
run.bake([clock], [MATERIAL], "clock")
run.export_glb([clock], "clock")
