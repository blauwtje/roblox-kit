"""Station departure board: a Victorian double-faced platform board on two fluted cast-iron posts.

Blender units = studs. Width along X (12), depth along Y (1.0), height along Z (9.87): floor at z 0, centred on x
and y, so the bounds match the kit board's 12 x 9.87 x 1.0 and the recorded-mesh stretch leaves it unscaled.
The front face looks toward Blender -Y, which Roblox's import puts on the MeshPart's local -Z, like the clock.
Posts at x = +-5.4 up to z 4.93 (the kit posts' top), a bronze frame round a navy enamel panel from there, and a
moulded cornice whose gilt beads set the 1.0 depth and whose ends set the 12 width, topping out at 9.87.
The panel print (gilt "DEPARTURES" header and rules, cream timetable rows) is rendered flat in Workbench first and
sampled by both panel faces, mirrored on the back so it reads correctly from each side. Every part is one material
switched by a "paint" attribute, joined into one mesh, unwrapped (panels enlarged) and baked to color (with
occlusion grime), roughness, metalness and tangent normal maps by `lib`.
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
uv = importlib.import_module("lib.uv")

WIDTH, DEPTH, HEIGHT = 12.0, 1.0, 9.87
POST_X, POST_TOP = 5.4, 4.93
RAIL_TOP, CORNICE_BOTTOM = 9.56, 9.56
OPENING_X, OPENING_Z0, OPENING_Z1 = 5.62, 5.22, 9.27  # the frame's inner edge
SLIP = 0.05  # gilt slip inside the opening
PANEL_Y = 0.22  # panel faces, recessed behind the frame's 0.3
PANEL_Z = (OPENING_Z0 + OPENING_Z1) / 2
PRINT_W, PRINT_H = 11.26, 4.07  # the panel area the print image covers
PANEL_UV = 2.6  # panel islands' texel density relative to the rest
PRINT_SIZE = 2048
FONT = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"
CAP_RATIO = 0.662  # Times New Roman cap height per unit font size
NAVY, CREAM, GOLD, FAINT = "#27436f", "#f1e6c8", "#d9b463", "#3a5788"
ROWS = [("09:03", "CENTRAL", "3"), ("09:40", "HARBOUR", "1"), ("10:03", "NORTH PARK", "4"), ("10:15", "AIRPORT", "1")]
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

    rect(-PRINT_W, PRINT_W, -PRINT_H, PRINT_H, NAVY, -0.01)
    # A fine gilt lining just inside the slip.
    half_x, half_y, line = OPENING_X - SLIP - 0.12, (OPENING_Z1 - OPENING_Z0) / 2 - SLIP - 0.12, 0.028
    rect(-half_x, half_x, half_y - line, half_y, GOLD)
    rect(-half_x, half_x, -half_y, -half_y + line, GOLD)
    rect(-half_x, -half_x + line, -half_y, half_y, GOLD)
    rect(half_x - line, half_x, -half_y, half_y, GOLD)
    header_y, header_cap = 1.43, 0.52
    header_width = text("DEPARTURES", header_cap, 0.0, header_y, "CENTER", GOLD, spacing=1.18)
    # Double rules flanking the header, ending in small lozenges, and a rule under it.
    inner, outer = header_width / 2 + 0.3, 5.05
    for sign in (-1.0, 1.0):
        x0, x1 = sorted((sign * inner, sign * outer))
        rect(x0, x1, header_y + 0.05, header_y + 0.075, GOLD)
        rect(x0, x1, header_y - 0.075, header_y - 0.05, GOLD)
        bm = bmesh.new()
        tip = sign * (inner - 0.12)
        bmesh.ops.create_circle(bm, cap_ends=True, segments=4, radius=0.09)
        mesh = bpy.data.meshes.new("lozenge")
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("lozenge", mesh)
        obj.location = (tip, header_y, 0.0)
        obj.data.materials.append(flat(GOLD))
        scene.collection.objects.link(obj)
        made.append(obj)
    rect(-5.2, 5.2, 1.0, 1.035, GOLD)
    row_cap, row_ys = 0.5, [0.52, -0.16, -0.84, -1.52]
    for (time, place, platform), y in zip(ROWS, row_ys):
        text(time, row_cap, -5.0, y, "LEFT", CREAM, spacing=1.05)
        text(place, row_cap, -2.3, y, "LEFT", CREAM, spacing=1.06)
        text(platform, row_cap, 4.55, y, "CENTER", CREAM)
    for above, below in zip(row_ys, row_ys[1:]):
        middle = (above + below) / 2
        rect(-5.2, 5.2, middle - 0.008, middle + 0.008, FAINT)

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
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, separate.inputs["Vector"])
    height = separate.outputs["Z"]
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(surface.outputs["Normal"], normal_z.inputs["Vector"])
    mask = {kind: materials.math_node(tree, "COMPARE", (stack["dark_amount"], float(kind), 0.5)) for kind in range(3)}
    paint_wear = materials.math_node(tree, "MULTIPLY", (wear, mask[BRONZE]))
    printed = materials.printed_face(tree, coords, print_image, PANEL_Z, PRINT_W / 2, PRINT_H / 2)
    fading = materials.ramp_node(nodes, [(0.3, "#e4ded3"), (0.75, "#ffffff")])
    links.new(materials.noise(tree, coords, (1.6, 4.0)), fading.inputs["Fac"])
    enamel = materials.mix_color(tree, "MULTIPLY", (1.0, printed, fading.outputs["Color"]))
    paneled = materials.mix_color(tree, "MIX", (mask[PANEL], worn, enamel))
    # Rust only on the plinths, where feet and mop buckets chip the paint.
    rust_ramp = materials.ramp_node(nodes, [(0.6, "#000000"), (0.72, "#ffffff")])
    links.new(materials.noise(tree, coords, (4.0, 10.0)), rust_ramp.inputs["Fac"])
    low = nodes.new("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 0.0
    low.inputs["From Max"].default_value = 0.35
    low.inputs["To Min"].default_value = 1.0
    low.inputs["To Max"].default_value = 0.0
    links.new(height, low.inputs["Value"])
    rust = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "MULTIPLY", (rust_ramp.outputs["Color"], low.outputs["Result"])), mask[BRONZE]))
    rusty = materials.mix_color(tree, "MIX", (rust, paneled, materials.linear("#5c3720")))
    # Dust settles on surfaces that face up.
    dust_ramp = materials.ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dust = materials.math_node(tree, "MULTIPLY", (dust_ramp.outputs["Color"], materials.math_node(tree, "SUBTRACT", (1.0, mask[PANEL]))))
    dusty = materials.mix_color(tree, "MIX", (dust, rusty, materials.linear("#a39a88")))
    # Faint vertical streaks: noise stretched along the posts and frame.
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
    # Paint and enamel are dielectric; gilt is metal, and so are bare worn edges, but rust is not.
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
    rough = materials.mix_float(tree, (mask[PANEL], rough, 0.4))
    rough = materials.mix_float(tree, (rust, rough, 0.9))
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
    materials.mark_paint(obj, float(part.paint))
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


def extrude(name, outline, shape):
    """A closed outline extruded along an axis: (x, z) along Y over the span, or (y, z) along X."""
    axis, span, paint = shape
    bm = bmesh.new()

    def vert(p, a):
        return bm.verts.new((p[0], a, p[1]) if axis == "Y" else (a, p[0], p[1]))

    near = [vert(p, span[0]) for p in outline]
    far = [vert(p, span[1]) for p in outline]
    bm.faces.new(near)
    bm.faces.new(list(reversed(far)))
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        bm.faces.new((near[index], near[following], far[following], far[index]))
    return add_part(name, bm, Part(paint))


SHAFT_BOTTOM, SHAFT_TOP, FLUTES = 0.78, 3.95, 12


def post(x):
    """Stepped plinth, turned base, gilt ring, fluted shaft, gilt astragal, bell capital, abacus and a neck block
    meeting the frame's bottom rail at the kit posts' top."""
    tag = "east" if x > 0 else "west"
    block(f"plinth-{tag}", ((x - 0.36, x + 0.36), (-0.36, 0.36), (0.0, 0.16)), Part(BRONZE, 0.025))
    block(f"plinth-step-{tag}", ((x - 0.29, x + 0.29), (-0.29, 0.29), (0.14, 0.26)), Part(BRONZE, 0.02))
    base = [
        (0.255, 0.25), (0.272, 0.29), (0.268, 0.34), (0.235, 0.37), (0.212, 0.41), (0.205, 0.47), (0.222, 0.52),
        (0.205, 0.555), (0.18, 0.58), (0.176, 0.7),
    ]
    turn(f"base-{tag}", base, Turn(24, BRONZE, center=(x, 0.0)))
    turn(f"base-ring-{tag}", [(0.17, 0.69), (0.193, 0.71), (0.203, 0.735), (0.193, 0.76), (0.17, 0.79)], Turn(24, GILT, center=(x, 0.0)))

    def shaft_radius(z):
        return 0.172 - 0.016 * (z - SHAFT_BOTTOM) / (SHAFT_TOP - SHAFT_BOTTOM)

    def flutes(theta, z):
        position = (theta * FLUTES / (2 * math.pi)) % 1.0
        groove = math.sin(math.pi * position) ** 0.8
        ends = geometry.smoothstep(SHAFT_BOTTOM + 0.03, SHAFT_BOTTOM + 0.15, z) * geometry.smoothstep(SHAFT_TOP - 0.03, SHAFT_TOP - 0.15, z)
        return 1 - 0.018 * groove * ends / shaft_radius(z)

    heights = [SHAFT_BOTTOM, SHAFT_BOTTOM + 0.07, SHAFT_BOTTOM + 0.15, 2.4, SHAFT_TOP - 0.15, SHAFT_TOP - 0.07, SHAFT_TOP]
    turn(f"fluted-shaft-{tag}", [(shaft_radius(z), z) for z in heights], Turn(FLUTES * 4, BRONZE, center=(x, 0.0), radial=flutes))
    turn(f"astragal-{tag}", [(0.14, 3.93), (0.166, 3.95), (0.177, 3.98), (0.166, 4.01), (0.14, 4.03)], Turn(24, GILT, center=(x, 0.0)))
    capital = [(0.15, 4.02), (0.158, 4.14), (0.175, 4.26), (0.21, 4.38), (0.255, 4.48), (0.295, 4.56), (0.31, 4.62), (0.3, 4.66), (0.26, 4.68)]
    turn(f"capital-{tag}", capital, Turn(24, BRONZE, center=(x, 0.0)))
    block(f"abacus-{tag}", ((x - 0.33, x + 0.33), (-0.33, 0.33), (4.66, 4.79)), Part(BRONZE, 0.02))
    block(f"neck-{tag}", ((x - 0.25, x + 0.25), (-0.25, 0.25), (4.77, POST_TOP + 0.02)), Part(BRONZE, 0.015))
    # A spandrel bracket on the inner side: a plate whose lower edge is a concave quarter ellipse.
    inner = -1.0 if x > 0 else 1.0
    reach, drop = 0.95, 0.85
    root = x + inner * 0.22
    far = root + inner * reach
    # From the rail's underside at the far end down to the post, bowing toward the corner between them.
    curve = [(far + (root - far) * math.sin(t), POST_TOP - drop + drop * math.cos(t)) for t in [i / 12 * math.pi / 2 for i in range(13)]]
    outline = [(root, POST_TOP + 0.01), (far, POST_TOP + 0.01)] + curve[1:]
    extrude(f"bracket-{tag}", outline, ("Y", (-0.045, 0.045), BRONZE))
    turn(f"bracket-boss-front-{tag}", [(0.0, -0.1), (0.05, -0.095), (0.075, -0.075), (0.08, -0.04)], Turn(16, GILT, axis="Y", center=(root + inner * 0.25, POST_TOP - 0.17)))
    turn(f"bracket-boss-back-{tag}", retrace([(0.0, -0.1), (0.05, -0.095), (0.075, -0.075), (0.08, -0.04)]), Turn(16, GILT, axis="Y", center=(root + inner * 0.25, POST_TOP - 0.17)))


def frame():
    """Bronze rails and stiles round a recessed navy panel, a gilt slip inside the opening, gilt corner bosses
    on both faces and a moulded cornice with gilt beads."""
    outer = 5.95
    block("bottom-rail", ((-outer, outer), (-0.3, 0.3), (POST_TOP, OPENING_Z0)), Part(BRONZE, 0.025))
    block("top-rail", ((-outer, outer), (-0.3, 0.3), (OPENING_Z1, RAIL_TOP)), Part(BRONZE, 0.025))
    for sign in (-1.0, 1.0):
        x0, x1 = sorted((sign * OPENING_X, sign * outer))
        block(f"stile-{sign:+.0f}", ((x0, x1), (-0.3, 0.3), (OPENING_Z0 - 0.02, OPENING_Z1 + 0.02)), Part(BRONZE, 0.025))
    block("panel", ((-OPENING_X - 0.01, OPENING_X + 0.01), (-PANEL_Y, PANEL_Y), (OPENING_Z0 - 0.01, OPENING_Z1 + 0.01)), Part(PANEL))
    slip_y = 0.27
    block("slip-bottom", ((-OPENING_X, OPENING_X), (-slip_y, slip_y), (OPENING_Z0, OPENING_Z0 + SLIP)), Part(GILT, 0.012))
    block("slip-top", ((-OPENING_X, OPENING_X), (-slip_y, slip_y), (OPENING_Z1 - SLIP, OPENING_Z1)), Part(GILT, 0.012))
    for sign in (-1.0, 1.0):
        x0, x1 = sorted((sign * OPENING_X, sign * (OPENING_X - SLIP)))
        block(f"slip-side-{sign:+.0f}", ((x0, x1), (-slip_y, slip_y), (OPENING_Z0 + SLIP, OPENING_Z1 - SLIP)), Part(GILT, 0.012))
    boss = [(0.0, -0.37), (0.055, -0.365), (0.09, -0.345), (0.105, -0.32), (0.11, -0.29)]
    stile_x = (OPENING_X + outer) / 2
    for x in (-stile_x, stile_x):
        for z in ((POST_TOP + OPENING_Z0) / 2, (OPENING_Z1 + RAIL_TOP) / 2):
            turn(f"boss-front-{x:+.1f}-{z:.1f}", boss, Turn(16, GILT, axis="Y", center=(x, z)))
            turn(f"boss-back-{x:+.1f}-{z:.1f}", retrace(boss), Turn(16, GILT, axis="Y", center=(x, z)))
    front = [(-0.3, 9.54), (-0.31, 9.6), (-0.34, 9.625), (-0.38, 9.645), (-0.42, 9.665), (-0.44, 9.69), (-0.48, 9.71), (-0.48, 9.82), (-0.455, 9.85), (-0.41, HEIGHT)]
    profile = front + [(-y, z) for y, z in reversed(front)]
    extrude("cornice", profile, ("X", (-WIDTH / 2, WIDTH / 2), BRONZE))
    bead = [(0.46, 9.735), (0.485, 9.742), (0.498, 9.76), (DEPTH / 2, 9.765), (0.498, 9.77), (0.485, 9.788), (0.46, 9.795)]
    extrude("bead-back", bead, ("X", (-WIDTH / 2 + 0.005, WIDTH / 2 - 0.005), GILT))
    extrude("bead-front", [(-y, z) for y, z in bead], ("X", (-WIDTH / 2 + 0.005, WIDTH / 2 - 0.005), GILT))


def density(paint, face):
    """Panel faces' islands grown (hidden ones shrunk), and the plinths' undersides shrunk, before one repack."""
    if paint == PANEL:
        return PANEL_UV if abs(face.normal.y) > 0.9 else 0.1
    if face.normal.z < -0.9 and face.calc_center_median().z < 0.01:
        return 0.1
    return None


bpy.ops.wm.read_factory_settings(use_empty=True)
run.set_up_cycles()
PRINT = panel_print()
MATERIAL = board_material(PRINT)
post(-POST_X)
post(POST_X)
frame()
board = geometry.finish("departure-board")
corners = [Vector(corner) for corner in board.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("board triangles", run.triangle_count(board), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high), "modifiers", len(board.modifiers))
uv.unwrap([board], face_scale=density)
run.bake([board], [MATERIAL], "departure-board")
run.export_glb([board], "departure-board")
