"""Station ticket counter: a period railway booking-office front for the ticket hall, three glazed windows over a ledge.

Blender units = studs. Width along X (14), depth along Y (3), height along Z (9.87): floor at z 0, back at y -1.5,
customer face toward +Y. The GLB exporter turns Blender +Y into glTF -Z and Roblox imports glTF axes as they are,
so the face lands on the mesh's local -Z, the customer side of the kit counter (luau/props/ticket-counter.luau),
and the bounds match the kit counter's 14 x 9.87 x 3, so the recorded-mesh stretch leaves it unscaled.
A green matchboarded counter carries a cream marble ledge with a brass nosing on carved brackets. Above it a green
glazed screen of three round-headed windows (the kit's window count for 14 studs) stands between capped pilasters;
each window has a brass arch bead, a brass ticket grille over its lower glass and an arched brass pass-through with
a brass change plate on the ledge. A navy enamel fascia in a bronze frame carries "TICKETS" in gilt Times bold with
gilt lining and lozenges, the preset's sign style (the accepted CONCOURSE sign), under a flat stepped cornice. The
fascia print is rendered flat in Workbench first and sampled by the fascia face. Each look is a small procedural
material; the objects are joined into one mesh, unwrapped (fascia face enlarged) and baked to color, roughness,
metalness and tangent normal maps by `shared.py`, which swaps in one baked material.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import (  # noqa: E402
    OUTPUT,
    bake,
    export_glb,
    flat_material,
    linear,
    link_object,
    math_node,
    mix_color,
    noise,
    ramp_node,
    set_up_cycles,
    triangle_count,
)

HALF_WIDTH, HALF_DEPTH, HEIGHT = 7.0, 1.5, 9.87
LEDGE_Z0, LEDGE_Z1 = 3.2, 3.5  # the counter ledge
SCREEN_TOP = 8.4  # the glazed screen's top, under the head rail
HEAD_Z1 = 8.55  # the head rail's top, where the fascia starts
FASCIA_Z1 = 9.55  # the fascia's top, under the cornice
POST_HALF = 0.2
POST_PITCH = (2 * HALF_WIDTH - 2 * POST_HALF) / 3
POSTS = [-HALF_WIDTH + POST_HALF + index * POST_PITCH for index in range(4)]
WINDOWS = [(POSTS[index] + POSTS[index + 1]) / 2 for index in range(3)]
OPENING_HALF = POST_PITCH / 2 - POST_HALF
SPRING_Z, RISE = 7.75, 0.55  # the window arch's springing line and rise
SCREEN_Y0, SCREEN_Y1 = 0.15, 0.45  # the screen's frame members
GLASS_Y0, GLASS_Y1 = 0.28, 0.32
PRINT_X, PRINT_Z0, PRINT_Z1 = 6.88, 8.67, 9.43  # the fascia print area
PRINT_SIZE = 4096
FONT = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"
CAP_RATIO = 0.662  # Times New Roman cap height per unit font size
NAVY, GOLD = "#1c2a44", "#c9a253"
LABEL = "TICKETS"
FASCIA_UV = 4.0  # how much the fascia face's UV island is grown, so the lettering keeps its texels
HIDDEN_UV = 0.2  # downward faces nobody sees


def painted_material(name, dark, light, roughness, metallic=0.0, scale=5.0):
    """A paint that varies between two tones in soft patches, with a fine bump."""
    material = bpy.data.materials.new(name)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    ramp = ramp_node(nodes, [(0.0, dark), (1.0, light)])
    links.new(noise(nodes, links, coords, scale, 8.0), ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    bump.inputs["Distance"].default_value = 0.01
    links.new(noise(nodes, links, coords, 40.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def boarding_material():
    """Green-painted matchboard: vertical boards 0.32 wide with a dark V-groove between them."""
    material = bpy.data.materials.new("boarding")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, split.inputs["Vector"])
    board = math_node(nodes, links, "FRACT", math_node(nodes, links, "DIVIDE", split.outputs["X"], 0.32), 0.0)
    # Distance from the nearest groove centre, in board widths: 0 on the groove, 0.5 mid-board.
    centred = math_node(nodes, links, "ABSOLUTE", math_node(nodes, links, "SUBTRACT", board, 0.5), 0.0)
    edge = math_node(nodes, links, "SUBTRACT", 0.5, centred)
    groove = math_node(nodes, links, "LESS_THAN", edge, 0.035)
    paint = ramp_node(nodes, [(0.0, "#1d3628"), (1.0, "#2c5039")])
    links.new(noise(nodes, links, coords, 4.0, 8.0), paint.inputs["Fac"])
    color = mix_color(nodes, links, "MIX", groove, paint.outputs["Color"], linear("#0d1a12"))
    links.new(color, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.42
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.7
    bump.inputs["Distance"].default_value = 0.02
    height = math_node(nodes, links, "MINIMUM", math_node(nodes, links, "MULTIPLY", edge, 12.0), 1.0)
    links.new(height, bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def marble_material():
    """Cream marble for the ledge: soft clouding with thin grey veins."""
    material = bpy.data.materials.new("marble")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    cloud = ramp_node(nodes, [(0.3, "#d9cfb6"), (0.7, "#efe8d6")])
    links.new(noise(nodes, links, coords, 2.0, 6.0), cloud.inputs["Fac"])
    wave = nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 0.6
    wave.inputs["Distortion"].default_value = 9.0
    wave.inputs["Detail"].default_value = 6.0
    links.new(coords, wave.inputs["Vector"])
    vein = ramp_node(nodes, [(0.0, "#ffffff"), (0.06, "#000000")])
    links.new(wave.outputs["Fac"], vein.inputs["Fac"])
    color = mix_color(nodes, links, "MIX", math_node(nodes, links, "MULTIPLY", vein.outputs["Color"], 0.5), cloud.outputs["Color"], linear("#8f887a"))
    links.new(color, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.22
    return material


def glass_material():
    """Dark glazing with a pale diagonal sheen, since the baked glass is opaque in Studio."""
    material = bpy.data.materials.new("glass")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, split.inputs["Vector"])
    diagonal = math_node(nodes, links, "ADD", split.outputs["X"], math_node(nodes, links, "MULTIPLY", split.outputs["Z"], 0.8))
    streak = math_node(nodes, links, "SINE", math_node(nodes, links, "MULTIPLY", diagonal, 1.6), 0.0)
    sheen = ramp_node(nodes, [(0.55, "#000000"), (1.0, "#ffffff")])
    links.new(streak, sheen.inputs["Fac"])
    height = ramp_node(nodes, [(0.0, "#1b2a31"), (1.0, "#30454e")])
    links.new(math_node(nodes, links, "SUBTRACT", split.outputs["Z"], 3.5), height.inputs["Fac"])
    color = mix_color(nodes, links, "MIX", math_node(nodes, links, "MULTIPLY", sheen.outputs["Color"], 0.45), height.outputs["Color"], linear("#7d97a0"))
    links.new(color, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.06
    return material


def fascia_print():
    """Renders the fascia print (navy enamel, gilt lining with notched corners, TICKETS and lozenges) flat in
    Workbench and returns it as an image covering x -PRINT_X..PRINT_X, z PRINT_Z0..PRINT_Z1."""
    scene = bpy.context.scene
    made = []
    flats = {}
    half_w, half_h = PRINT_X, (PRINT_Z1 - PRINT_Z0) / 2

    def flat(hex_color):
        if hex_color not in flats:
            material = bpy.data.materials.new(f"print-{hex_color}")
            material.diffuse_color = linear(hex_color)
            flats[hex_color] = material
        return flats[hex_color]

    def polygon(points, hex_color, z=0.0):
        mesh = bpy.data.meshes.new("print-shape")
        mesh.from_pydata([(x, y, z) for x, y in points], [], [tuple(range(len(points)))])
        obj = bpy.data.objects.new("print-shape", mesh)
        obj.data.materials.append(flat(hex_color))
        scene.collection.objects.link(obj)
        made.append(obj)

    def rect(x0, x1, y0, y1, hex_color, z=0.0):
        polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], hex_color, z)

    def arc(cx, cy, radius, thickness, a0, a1, hex_color):
        bm = bmesh.new()
        inner, outer = [], []
        for i in range(11):
            angle = a0 + (a1 - a0) * i / 10
            for ring, r in ((inner, radius - thickness / 2), (outer, radius + thickness / 2)):
                ring.append(bm.verts.new((cx + r * math.cos(angle), cy + r * math.sin(angle), 0.0)))
        for i in range(10):
            bm.faces.new((inner[i], inner[i + 1], outer[i + 1], outer[i]))
        mesh = bpy.data.meshes.new("print-arc")
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("print-arc", mesh)
        obj.data.materials.append(flat(hex_color))
        scene.collection.objects.link(obj)
        made.append(obj)

    def lozenge(x, radius, hex_color):
        polygon([(x - radius * 1.35, 0.0), (x, radius), (x + radius * 1.35, 0.0), (x, -radius)], hex_color)

    rect(-half_w - 0.1, half_w + 0.1, -half_h - 0.1, half_h + 0.1, NAVY, -0.01)
    # A gilt double lining: the outer line with notched (re-entrant quarter-circle) corners, a fine line inside it.
    lx, ly, line, notch = half_w - 0.07, half_h - 0.07, 0.03, 0.14
    rect(-lx + notch, lx - notch, ly - line, ly, GOLD)
    rect(-lx + notch, lx - notch, -ly, -ly + line, GOLD)
    rect(-lx, -lx + line, -ly + notch, ly - notch, GOLD)
    rect(lx - line, lx, -ly + notch, ly - notch, GOLD)
    for sx in (-1, 1):
        for sy in (-1, 1):
            base = {(1, 1): math.pi, (-1, 1): 1.5 * math.pi, (-1, -1): 0.0, (1, -1): 0.5 * math.pi}[(sx, sy)]
            arc(sx * (lx - line / 2), sy * (ly - line / 2), notch - line / 2, line, base, base + math.pi / 2, GOLD)
    ix, iy, fine = lx - 0.08, ly - 0.08, 0.012
    rect(-ix, ix, iy - fine, iy, GOLD)
    rect(-ix, ix, -iy, -iy + fine, GOLD)
    rect(-ix, -ix + fine, -iy, iy, GOLD)
    rect(ix - fine, ix, -iy, iy, GOLD)

    cap = 0.42
    curve = bpy.data.curves.new("print-text", "FONT")
    curve.body = LABEL
    curve.font = bpy.data.fonts.load(FONT, check_existing=True)
    curve.size = cap / CAP_RATIO
    curve.space_character = 1.15
    curve.align_x = "CENTER"
    curve.align_y = "BOTTOM_BASELINE"
    curve.resolution_u = 5
    text = bpy.data.objects.new("print-text", curve)
    text.location = (0.0, -cap / 2, 0.0)
    text.data.materials.append(flat(GOLD))
    scene.collection.objects.link(text)
    made.append(text)
    bpy.context.view_layer.update()
    xs = [(text.matrix_world @ Vector(corner)).x for corner in text.bound_box]
    width = max(xs) - min(xs)
    # Lozenges either side of the word, then a gilt rule running out to a lozenge near each end.
    for sign in (-1.0, 1.0):
        lozenge(sign * (width / 2 + 0.3), 0.11, GOLD)
        lozenge(sign * (width / 2 + 0.52), 0.05, GOLD)
        near, far = width / 2 + 0.7, ix - 0.55
        rect(min(sign * near, sign * far), max(sign * near, sign * far), -0.012, 0.012, GOLD)
        lozenge(sign * (ix - 0.4), 0.08, GOLD)
    camera_data = bpy.data.cameras.new("print-camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2 * half_w
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
    scene.render.resolution_y = round(PRINT_SIZE * half_h / half_w)
    scene.render.resolution_percentage = 100
    path = f"{OUTPUT}-fascia-print.png"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for obj in made + [camera]:
        bpy.data.objects.remove(obj, do_unlink=True)
    scene.camera = None
    scene.render.engine = "CYCLES"
    return bpy.data.images.load(path)


def fascia_material(print_image):
    """The navy enamel fascia: the print mapped by object x and z, glossy, with a faint ripple in the enamel."""
    material = bpy.data.materials.new("fascia")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, split.inputs["Vector"])
    # Seen from the customer side (+Y), the viewer's right is -X, so u runs from +X to -X.
    u = math_node(nodes, links, "DIVIDE", math_node(nodes, links, "SUBTRACT", PRINT_X, split.outputs["X"]), 2 * PRINT_X)
    v = math_node(nodes, links, "DIVIDE", math_node(nodes, links, "SUBTRACT", split.outputs["Z"], PRINT_Z0), PRINT_Z1 - PRINT_Z0)
    combine = nodes.new("ShaderNodeCombineXYZ")
    links.new(u, combine.inputs["X"])
    links.new(v, combine.inputs["Y"])
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = print_image
    texture.extension = "EXTEND"
    links.new(combine.outputs["Vector"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    # Gilt reads metallic, enamel does not: the print's red channel separates them.
    gilt = ramp_node(nodes, [(0.12, "#000000"), (0.35, "#ffffff")])
    links.new(texture.outputs["Color"], gilt.inputs["Fac"])
    links.new(math_node(nodes, links, "MULTIPLY", gilt.outputs["Color"], 0.85), bsdf.inputs["Metallic"])
    bsdf.inputs["Roughness"].default_value = 0.25
    return material


MATERIALS = {}


def make_materials():
    MATERIALS["green"] = painted_material("green", "#1d3628", "#2c5039", 0.4)
    MATERIALS["boarding"] = boarding_material()
    MATERIALS["marble"] = marble_material()
    MATERIALS["brass"] = painted_material("brass", "#8f6c2e", "#caa255", 0.28, metallic=0.95, scale=7.0)
    MATERIALS["bronze"] = painted_material("bronze", "#2e2419", "#4a3b2a", 0.4, metallic=0.85)
    MATERIALS["glass"] = glass_material()
    MATERIALS["black"] = flat_material("black", "#0b0a09", 0.7)
    MATERIALS["fascia"] = fascia_material(fascia_print())


def finish(obj, role, bevel):
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
    obj.data.materials.append(MATERIALS[role])
    return obj


def box(name, x0, x1, y0, y1, z0, z1, role, bevel=0.03):
    x0, x1 = max(x0, -HALF_WIDTH), min(x1, HALF_WIDTH)  # end pilasters' caps and bases stop at the bounds
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True)
    return finish(obj, role, min(bevel, (x1 - x0) / 3, (y1 - y0) / 3, (z1 - z0) / 3))


def prism(name, outline, axis, a0, a1, role, bevel=0.0):
    """A polygon extruded between a0 and a1 along `axis`: (x, z) points along Y, or (y, z) points along X."""

    def vert(point, a):
        return (point[0], a, point[1]) if axis == "Y" else (a, point[0], point[1])

    shape = bmesh.new()
    face = shape.faces.new([shape.verts.new(vert(point, a0)) for point in outline])
    result = bmesh.ops.extrude_face_region(shape, geom=[face])
    moved = [item for item in result["geom"] if isinstance(item, bmesh.types.BMVert)]
    offset = (0, a1 - a0, 0) if axis == "Y" else (a1 - a0, 0, 0)
    bmesh.ops.translate(shape, verts=moved, vec=offset)
    bmesh.ops.recalc_face_normals(shape, faces=shape.faces)
    mesh = bpy.data.meshes.new(name)
    shape.to_mesh(mesh)
    shape.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, role, bevel)


def arc_points(cx, cz, radius, a0, a1, steps):
    return [(cx + radius * math.cos(a0 + (a1 - a0) * i / steps), cz + radius * math.sin(a0 + (a1 - a0) * i / steps)) for i in range(steps + 1)]


def segment_arc(x, half, spring, rise, offset=0.0, steps=16):
    """The window's segmental arch from its right springing point over to the left, grown outward by `offset`."""
    radius = (half * half + rise * rise) / (2 * rise)
    centre = spring + rise - radius
    sweep = math.asin(half / radius)
    return arc_points(x, centre, radius + offset, math.pi / 2 - sweep, math.pi / 2 + sweep, steps)


def counter():
    """The matchboarded counter, its ledge and the brackets under the ledge's overhang."""
    box("plinth", -HALF_WIDTH, HALF_WIDTH, -HALF_DEPTH, 1.12, 0.0, 0.35, "bronze", 0.03)
    box("boarding", -HALF_WIDTH + 0.05, HALF_WIDTH - 0.05, -1.45, 1.0, 0.35, LEDGE_Z0, "boarding", 0.0)
    box("skirting", -HALF_WIDTH + 0.05, HALF_WIDTH - 0.05, 0.95, 1.08, 0.35, 0.62, "green", 0.02)
    box("frieze-rail", -HALF_WIDTH + 0.05, HALF_WIDTH - 0.05, 0.95, 1.1, 2.86, LEDGE_Z0, "green", 0.03)
    box("frieze-bead", -HALF_WIDTH + 0.05, HALF_WIDTH - 0.05, 1.05, 1.13, 2.8, 2.86, "brass", 0.015)
    for index, x in enumerate([-6.75] + POSTS[1:3] + [6.75]):
        profile = [(1.0, LEDGE_Z0), (1.38, LEDGE_Z0), (1.38, 3.06), (1.2, 2.86), (1.1, 2.5), (1.0, 2.4)]
        prism(f"bracket-{index}", profile, "X", x - 0.14, x + 0.14, "green", 0.02)
    box("ledge", -HALF_WIDTH, HALF_WIDTH, -HALF_DEPTH, 1.42, LEDGE_Z0, LEDGE_Z1, "marble", 0.03)
    box("nosing", -HALF_WIDTH, HALF_WIDTH, 1.4, HALF_DEPTH, LEDGE_Z0 + 0.03, LEDGE_Z1 - 0.03, "brass", 0.03)


def screen():
    """The glazed screen: pilasters, the office's back and end walls, and per window the arched head, glass,
    arch bead, ticket grille, pass-through and change plate."""
    for index, x in enumerate(POSTS):
        box(f"pilaster-{index}", x - POST_HALF, x + POST_HALF, 0.05, 0.6, LEDGE_Z1, SCREEN_TOP, "green", 0.03)
        box(f"pilaster-{index}-base", x - POST_HALF - 0.04, x + POST_HALF + 0.04, 0.02, 0.64, LEDGE_Z1, LEDGE_Z1 + 0.16, "brass", 0.02)
        box(f"pilaster-{index}-cap", x - POST_HALF - 0.05, x + POST_HALF + 0.05, 0.01, 0.65, SCREEN_TOP - 0.24, SCREEN_TOP - 0.12, "brass", 0.02)
    box("back-wall", -HALF_WIDTH + 0.05, HALF_WIDTH - 0.05, -1.42, -1.25, LEDGE_Z1, SCREEN_TOP, "green", 0.02)
    for side in (-1.0, 1.0):
        x0, x1 = sorted((side * (HALF_WIDTH - 0.2), side * HALF_WIDTH))
        box(f"end-wall-{side}", x0, x1, -1.42, 0.06, LEDGE_Z1, SCREEN_TOP, "green", 0.02)
    box("head-rail", -HALF_WIDTH, HALF_WIDTH, -1.42, 0.68, SCREEN_TOP, HEAD_Z1, "green", 0.03)
    for index, x in enumerate(WINDOWS):
        left, right = x - OPENING_HALF, x + OPENING_HALF
        arch = segment_arc(x, OPENING_HALF, SPRING_Z, RISE)
        prism(f"spandrel-{index}", [(right, SCREEN_TOP), (left, SCREEN_TOP)] + list(reversed(arch)), "Y", SCREEN_Y0, SCREEN_Y1, "green")
        bead = segment_arc(x, OPENING_HALF, SPRING_Z, RISE, 0.0) + list(reversed(segment_arc(x, OPENING_HALF, SPRING_Z, RISE, -0.07)))
        prism(f"arch-bead-{index}", bead, "Y", SCREEN_Y1 - 0.02, SCREEN_Y1 + 0.05, "brass")
        prism(f"glass-{index}", [(left, LEDGE_Z1 + 0.12), (right, LEDGE_Z1 + 0.12)] + arch, "Y", GLASS_Y0, GLASS_Y1, "glass")
        box(f"sill-rail-{index}", left, right, SCREEN_Y0, SCREEN_Y1, LEDGE_Z1, LEDGE_Z1 + 0.12, "green", 0.02)
        box(f"transom-{index}", left, right, SCREEN_Y0, SCREEN_Y1 + 0.03, 5.22, 5.32, "green", 0.02)
        box(f"upper-transom-{index}", left, right, SCREEN_Y0, SCREEN_Y1 + 0.03, 6.5, 6.6, "green", 0.02)
        # The ticket grille: brass bars between two rails, spear tips above the top rail.
        grille_z0, grille_z1 = 4.22, 5.22
        box(f"grille-low-{index}", left, right, 0.42, 0.52, grille_z0, grille_z0 + 0.07, "brass", 0.015)
        box(f"grille-high-{index}", left, right, 0.42, 0.52, grille_z1 - 0.07, grille_z1, "brass", 0.015)
        bars = int((2 * OPENING_HALF - 0.3) / 0.2)
        for bar in range(bars + 1):
            bx = left + 0.15 + bar * (2 * OPENING_HALF - 0.3) / bars
            box(f"grille-bar-{index}-{bar}", bx - 0.018, bx + 0.018, 0.44, 0.5, grille_z0, grille_z1, "brass", 0.0)
        # A brass ring with a small cross at the grille's centre, the clerk's speaking hole.
        ring = arc_points(x, 4.72, 0.3, 0.0, 2 * math.pi, 20)[:-1]
        inner = arc_points(x, 4.72, 0.24, 0.0, 2 * math.pi, 20)[:-1]
        for step in range(20):
            nxt = (step + 1) % 20
            prism(f"speak-ring-{index}-{step}", [ring[step], ring[nxt], inner[nxt], inner[step]], "Y", 0.5, 0.55, "brass")
        # The pass-through: a brass half ring on the ledge round a dark arched hole, a change plate before it.
        outer = arc_points(x, LEDGE_Z1, 0.55, 0.0, math.pi, 12)
        hole = arc_points(x, LEDGE_Z1, 0.44, 0.0, math.pi, 12)
        prism(f"pass-ring-{index}", outer + list(reversed(hole)), "Y", 0.18, 0.56, "brass")
        prism(f"pass-hole-{index}", hole, "Y", GLASS_Y1, GLASS_Y1 + 0.04, "black")
        box(f"change-plate-{index}", x - 0.6, x + 0.6, 0.56, 1.12, LEDGE_Z1, LEDGE_Z1 + 0.04, "brass", 0.015)


def fascia():
    """The navy TICKETS fascia in a bronze frame, and the flat stepped cornice on top."""
    box("fascia", -PRINT_X, PRINT_X, -0.15, 0.7, HEAD_Z1, FASCIA_Z1, "fascia", 0.0)
    box("fascia-frame-low", -HALF_WIDTH, HALF_WIDTH, 0.6, 0.8, HEAD_Z1, PRINT_Z0, "bronze", 0.02)
    box("fascia-frame-high", -HALF_WIDTH, HALF_WIDTH, 0.6, 0.8, PRINT_Z1, FASCIA_Z1, "bronze", 0.02)
    for side in (-1.0, 1.0):
        x0, x1 = sorted((side * PRINT_X, side * HALF_WIDTH))
        box(f"fascia-frame-end-{side}", x0, x1, -0.15, 0.8, HEAD_Z1, FASCIA_Z1, "bronze", 0.02)
    box("cornice-low", -HALF_WIDTH, HALF_WIDTH, -0.25, 0.9, FASCIA_Z1, FASCIA_Z1 + 0.12, "green", 0.03)
    box("cornice-bead", -HALF_WIDTH, HALF_WIDTH, -0.27, 0.95, FASCIA_Z1 + 0.12, FASCIA_Z1 + 0.17, "brass", 0.015)
    box("cornice-top", -HALF_WIDTH, HALF_WIDTH, -0.35, 1.02, FASCIA_Z1 + 0.17, HEIGHT, "green", 0.03)


def join_counter():
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = "ticket-counter"
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return joined


def unwrap(obj):
    """Smart project, then the fascia face's islands grown and downward faces shrunk before one repack."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    fascia_index = list(obj.data.materials).index(MATERIALS["fascia"])
    shape = bmesh.new()
    shape.from_mesh(obj.data)
    shape.normal_update()
    uv = shape.loops.layers.uv.active
    for face in shape.faces:
        if face.material_index == fascia_index and face.normal.y > 0.9:
            factor = FASCIA_UV
        elif face.normal.z < -0.9:
            factor = HIDDEN_UV
        else:
            continue
        for loop in face.loops:
            loop[uv].uv *= factor
    shape.to_mesh(obj.data)
    shape.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
make_materials()
counter()
screen()
fascia()
ticket_counter = join_counter()
corners = [Vector(corner) for corner in ticket_counter.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("ticket-counter triangles", triangle_count(ticket_counter), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high))
unwrap(ticket_counter)
bake([ticket_counter], list(MATERIALS.values()), "ticket-counter")
export_glb([ticket_counter], "ticket-counter")
