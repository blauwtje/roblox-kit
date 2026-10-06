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
metalness and tangent normal maps by `shared.py`.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import (  # noqa: E402
    bake,
    export_glb,
    linear,
    link_object,
    mark_paint,
    mix_color,
    mix_float,
    noise,
    OUTPUT,
    ramp_node,
    set_up_cycles,
    triangle_count,
)

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


def math_node(nodes, links, operation, a, b, c=None):
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate((a, b, c)):
        if value is None:
            continue
        if isinstance(value, float):
            node.inputs[index].default_value = value
        else:
            links.new(value, node.inputs[index])
    return node.outputs["Value"]


def panel_print():
    """Renders the panel print flat in Workbench, seen from +Z with the header toward +Y, and loads it."""
    scene = bpy.context.scene
    made = []
    materials = {}

    def flat(hex_color):
        if hex_color not in materials:
            material = bpy.data.materials.new(hex_color)
            material.diffuse_color = linear(hex_color)
            materials[hex_color] = material
        return materials[hex_color]

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
    path = f"{OUTPUT}-panel-print.png"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for obj in made + [camera]:
        bpy.data.objects.remove(obj, do_unlink=True)
    scene.camera = None
    scene.render.engine = "CYCLES"
    return bpy.data.images.load(path)


def board_material(print_image):
    material = bpy.data.materials.new("paint")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, separate.inputs["Vector"])
    height = separate.outputs["Z"]
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Normal"], normal_z.inputs["Vector"])
    # Which finish a part has, from the attribute each part carries, since joining loses objects.
    paint_attribute = nodes.new("ShaderNodeAttribute")
    paint_attribute.attribute_name = "paint"
    code = paint_attribute.outputs["Fac"]
    mask = {kind: math_node(nodes, links, "COMPARE", code, float(kind), 0.5) for kind in range(3)}
    patch = noise(nodes, links, coords, 2.5, 6.0)
    bronze = ramp_node(nodes, [(0.2, "#29231d"), (0.8, "#382f25")])
    links.new(patch, bronze.inputs["Fac"])
    # Edge wear where a bevelled normal leaves the true normal, broken up by noise: bare metal under the bronze
    # paint, a rubbed bright edge on the gilt.
    bevel = nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = 0.015
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(bevel.outputs["Normal"], facing.inputs[0])
    links.new(geometry.outputs["Normal"], facing.inputs[1])
    edge_ramp = ramp_node(nodes, [(0.9, "#ffffff"), (0.97, "#000000")])
    links.new(facing.outputs["Value"], edge_ramp.inputs["Fac"])
    edge = edge_ramp.outputs["Color"]
    chip_ramp = ramp_node(nodes, [(0.45, "#000000"), (0.58, "#ffffff")])
    links.new(noise(nodes, links, coords, 14.0, 6.0), chip_ramp.inputs["Fac"])
    wear = math_node(nodes, links, "MULTIPLY", edge, chip_ramp.outputs["Color"])
    paint_wear = math_node(nodes, links, "MULTIPLY", wear, mask[BRONZE])
    worn = mix_color(nodes, links, "MIX", paint_wear, bronze.outputs["Color"], linear("#6e5a3e"))
    gilt = ramp_node(nodes, [(0.3, "#a17c38"), (0.7, "#cfa758")])
    links.new(noise(nodes, links, coords, 7.0, 6.0), gilt.inputs["Fac"])
    polished = mix_color(nodes, links, "MIX", edge, gilt.outputs["Color"], linear("#ead296"))
    gilded = mix_color(nodes, links, "MIX", mask[GILT], worn, polished)
    # The panel print, mapped by object x and z; seen from the back (+Y), the viewer's right is -X.
    back = math_node(nodes, links, "GREATER_THAN", separate.outputs["Y"], 0.0)
    sign = math_node(nodes, links, "SUBTRACT", 1.0, math_node(nodes, links, "MULTIPLY", back, 2.0))
    mirrored = math_node(nodes, links, "MULTIPLY", separate.outputs["X"], sign)
    u = math_node(nodes, links, "ADD", math_node(nodes, links, "MULTIPLY", mirrored, 1 / PRINT_W), 0.5)
    v = math_node(nodes, links, "ADD", math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "SUBTRACT", height, PANEL_Z), 1 / PRINT_H), 0.5)
    combine = nodes.new("ShaderNodeCombineXYZ")
    links.new(u, combine.inputs["X"])
    links.new(v, combine.inputs["Y"])
    printed = nodes.new("ShaderNodeTexImage")
    printed.image = print_image
    printed.extension = "EXTEND"
    links.new(combine.outputs["Vector"], printed.inputs["Vector"])
    fading = ramp_node(nodes, [(0.3, "#ece7de"), (0.75, "#ffffff")])
    links.new(noise(nodes, links, coords, 1.6, 4.0), fading.inputs["Fac"])
    enamel = mix_color(nodes, links, "MULTIPLY", 1.0, printed.outputs["Color"], fading.outputs["Color"])
    paneled = mix_color(nodes, links, "MIX", mask[PANEL], gilded, enamel)
    # Dust settles on surfaces that face up.
    dust_ramp = ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dust = math_node(nodes, links, "MULTIPLY", dust_ramp.outputs["Color"], math_node(nodes, links, "SUBTRACT", 1.0, mask[PANEL]))
    dusty = mix_color(nodes, links, "MIX", dust, paneled, linear("#a39a88"))
    # Faint vertical streaks: noise stretched down the frame.
    streak_mapping = nodes.new("ShaderNodeMapping")
    streak_mapping.inputs["Scale"].default_value = (9.0, 9.0, 0.6)
    links.new(coords, streak_mapping.inputs["Vector"])
    streak_ramp = ramp_node(nodes, [(0.55, "#ffffff"), (0.8, "#e2dbcf")])
    links.new(noise(nodes, links, streak_mapping.outputs["Vector"], 2.0, 4.0), streak_ramp.inputs["Fac"])
    streaked = mix_color(nodes, links, "MULTIPLY", 1.0, dusty, streak_ramp.outputs["Color"])
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.2
    grime_ramp = ramp_node(nodes, [(0.0, "#73695a"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = mix_color(nodes, links, "MULTIPLY", 1.0, streaked, grime_ramp.outputs["Color"])
    links.new(grimy, bsdf.inputs["Base Color"])
    # Paint and enamel are dielectric; gilt is metal, and so are bare worn edges.
    worn_metal = math_node(nodes, links, "MULTIPLY", paint_wear, 0.7)
    gilt_metal = math_node(nodes, links, "MULTIPLY", mask[GILT], 0.55)
    links.new(math_node(nodes, links, "ADD", worn_metal, gilt_metal), bsdf.inputs["Metallic"])
    paint_roughness = nodes.new("ShaderNodeMapRange")
    paint_roughness.inputs["To Min"].default_value = 0.42
    paint_roughness.inputs["To Max"].default_value = 0.6
    links.new(patch, paint_roughness.inputs["Value"])
    rough = mix_float(nodes, links, paint_wear, paint_roughness.outputs["Result"], 0.35)
    rough = mix_float(nodes, links, mask[GILT], rough, mix_float(nodes, links, edge, 0.4, 0.26))
    rough = mix_float(nodes, links, mask[PANEL], rough, 0.28)
    rough = mix_float(nodes, links, dust, rough, 0.85)
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel paint and a cast surface: a fine, weak bump, left off the enamel.
    bump = nodes.new("ShaderNodeBump")
    links.new(math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "SUBTRACT", 1.0, mask[PANEL]), 0.12), bump.inputs["Strength"])
    bump.inputs["Distance"].default_value = 0.004
    links.new(noise(nodes, links, coords, 40.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def finish(name, bm, paint, bevel=0.0, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link_object(name, mesh, MATERIAL)
    mark_paint(obj, paint)
    if bevel:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def box(name, x0, x1, y0, y1, z0, z1, paint, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vert in bm.verts:
        vert.co = Vector(((x0 + x1) / 2 + vert.co.x * (x1 - x0), (y0 + y1) / 2 + vert.co.y * (y1 - y0), (z0 + z1) / 2 + vert.co.z * (z1 - z0)))
    return finish(name, bm, paint, bevel)


def lathe(name, rings, segments, paint, axis="Z", center=(0.0, 0.0), radial=None):
    """A turned part from (radius, h) rings along an axis: Z round (center x, center y), or Y round (center x,
    center z) with h the absolute y. Trace the profile with the solid on its left (out along the bottom, up the
    outside) so faces point out; a ring of radius 0 is a pole."""

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
    return finish(name, bm, paint, recalc=False)


def mirror_y(rings):
    """The same Y-lathe profile on the back face, retraced so its faces still point out."""
    return [(radius, -h) for radius, h in reversed(rings)]


def prism(name, outline, axis, a0, a1, paint):
    """A closed outline extruded along an axis: (x, z) along Y from a0 to a1, or (y, z) along X."""
    bm = bmesh.new()

    def vert(p, a):
        return bm.verts.new((p[0], a, p[1]) if axis == "Y" else (a, p[0], p[1]))

    near = [vert(p, a0) for p in outline]
    far = [vert(p, a1) for p in outline]
    bm.faces.new(near)
    bm.faces.new(list(reversed(far)))
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        bm.faces.new((near[index], near[following], far[following], far[index]))
    return finish(name, bm, paint)


def ring(name, outer, inner, half_y, paint, bevel=0.0):
    """A rectangular frame from an outer and an inner (x0, x1, z0, z1) outline, from -half_y to +half_y in Y."""
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
    return finish(name, bm, paint, bevel)


def torus(name, center_x, center_z, major, minor, paint, segments=16, sides=8):
    """A ring in the XZ plane (its hole faces Y); both counts are multiples of 4, so its top point is exact."""
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
    return finish(name, bm, paint)


ROSETTE = [(0.0, -DEPTH / 2), (0.03, -0.198), (0.05, -0.192), (0.068, -0.181), (0.082, -0.168), (0.09, -0.156), (0.092, -0.135)]
EYE_X = 2.7


def rosette_petals(theta, h):
    return 1 - 0.16 * (1 - abs(math.cos(4 * theta))) ** 1.5


def frame():
    """A dark bronze frame with rounded rails round a recessed navy panel, a gilt slip inside the opening, gilt
    rosettes at the corners on both faces and two cast lifting eyes on the top rail."""
    ring("frame", (LEFT, RIGHT, BOTTOM, FRAME_TOP), (-OPENING_X, OPENING_X, OPENING_Z0, OPENING_Z1), FRAME_Y, BRONZE, 0.045)
    box("panel", -OPENING_X - 0.01, OPENING_X + 0.01, -PANEL_Y, PANEL_Y, OPENING_Z0 - 0.01, OPENING_Z1 + 0.01, PANEL)
    ring("slip", (-OPENING_X - 0.01, OPENING_X + 0.01, OPENING_Z0 - 0.01, OPENING_Z1 + 0.01),
         (-OPENING_X + SLIP, OPENING_X - SLIP, OPENING_Z0 + SLIP, OPENING_Z1 - SLIP), 0.12, GILT, 0.014)
    corner_x, corner_z = (OPENING_X + RIGHT) / 2, ((BOTTOM + OPENING_Z0) / 2, (OPENING_Z1 + FRAME_TOP) / 2)
    for x in (-corner_x, corner_x):
        for z in corner_z:
            lathe(f"rosette-front-{x:+.1f}-{z:+.1f}", ROSETTE, 32, GILT, axis="Y", center=(x, z), radial=rosette_petals)
            lathe(f"rosette-back-{x:+.1f}-{z:+.1f}", mirror_y(ROSETTE), 32, GILT, axis="Y", center=(x, z), radial=rosette_petals)
    eye_major, eye_minor = 0.065, 0.028
    for x in (-EYE_X, EYE_X):
        box(f"lug-{x:+.1f}", x - 0.1, x + 0.1, -0.05, 0.05, FRAME_TOP - 0.03, FRAME_TOP + 0.07, BRONZE, 0.012)
        torus(f"eye-{x:+.1f}", x, TOP - eye_major - eye_minor, eye_major, eye_minor, BRONZE)


def join_board():
    """Converts every part to mesh in world space and joins them into one object, as one MeshPart."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    board = bpy.context.active_object
    board.name = "sign"
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    return board


def unwrap(board):
    """Smart project, then the panel faces' islands grown and the hidden panel edges shrunk before one repack."""
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(board.data)
    bm.normal_update()
    uv = bm.loops.layers.uv.active
    paint = bm.verts.layers.float.get("paint")
    for face in bm.faces:
        if round(face.verts[0][paint]) == PANEL:
            factor = PANEL_UV if abs(face.normal.y) > 0.9 else 0.1
        else:
            continue
        for loop in face.loops:
            loop[uv].uv *= factor
    bm.to_mesh(board.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
PRINT = panel_print()
MATERIAL = board_material(PRINT)
frame()
board = join_board()
corners = [Vector(corner) for corner in board.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("sign triangles", triangle_count(board), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high), "modifiers", len(board.modifiers))
unwrap(board)
bake([board], [MATERIAL], "sign")
export_glb([board], "sign")
