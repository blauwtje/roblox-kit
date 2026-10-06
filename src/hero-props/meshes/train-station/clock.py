"""Station clock: a Victorian double-faced platform clock on a cast-iron column.

Blender units = studs. Width along X (5), depth along Y (1.2), height along Z (10.87): floor at z 0, centred on x
and y, so the bounds match the kit clock's 5 x 10.87 x 1.2 and the recorded-mesh stretch leaves it unscaled.
The front dial faces Blender -Y. The GLB exporter turns that into glTF +Z, and Roblox's import (which put the
ticket machine's Blender +Y face on its local +Z) puts it on the MeshPart's local -Z, the kit clock's front.
Drum centre at z 8.37 (kit 8.365) so the 5-wide bezel tops out at exactly 10.87; no finial or side bosses. Visible
enamel is 4.52 across, at least the kit's 4.5, with print and hands scaled up to read across a concourse.
Dark bronze column and case, gilt rings and hand bosses, cream enamel dials whose print (minute track, Roman
numerals) is rendered flat in Workbench first and sampled by the dial faces, black spade hands at 10:10 on both
faces. Every part is one material switched by a "paint" attribute, joined into one mesh, unwrapped (dials
enlarged) and baked to color (with occlusion grime), roughness, metalness and tangent normal maps by `shared.py`.
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
    mix_color,
    mix_float,
    noise,
    OUTPUT,
    ramp_node,
    set_up_cycles,
    triangle_count,
)

CENTER_Z = 8.37  # drum centre; + bezel radius 2.5 = 10.87
DIAL_Y, DIAL_R = 0.46, 2.31
PRINT_S = 1.12  # print radii relative to the first design's 2.02 sight ring
HAND_S, HAND_W = 1.12, 1.3  # hand length and width factors
PRINT_R = 2.3  # half the width the dial print image covers
DIAL_UV = 1.8  # dial islands' texel density relative to the rest
PRINT_SIZE = 2048
FONT = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"
ENAMEL, INK = "#f3ecd8", "#141210"
BRONZE, GILT, DIAL, BLACK = range(4)
HOUR_ANGLE, MINUTE_ANGLE = math.radians(305), math.radians(60)  # 10:10, clockwise from 12


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


def dial_print():
    """Renders the enamel print flat in Workbench, seen from +Z with 12 o'clock toward +Y, and loads it."""
    scene = bpy.context.scene
    made = []

    def flat(name, hex_color):
        material = bpy.data.materials.new(name)
        material.diffuse_color = linear(hex_color)
        return material

    enamel, ink = flat("enamel", ENAMEL), flat("ink", INK)

    def add(name, bm, material, z):
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(name, mesh)
        obj.location.z = z
        obj.data.materials.append(material)
        scene.collection.objects.link(obj)
        made.append(obj)

    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=3.2)
    add("enamel", bm, enamel, -0.01)
    bm = bmesh.new()

    def annulus(inner, outer, segments=256):
        rows = [
            [bm.verts.new((r * math.sin(2 * math.pi * i / segments), r * math.cos(2 * math.pi * i / segments), 0.0)) for i in range(segments)]
            for r in (inner, outer)
        ]
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((rows[0][i], rows[0][j], rows[1][j], rows[1][i]))

    def bar(theta, r0, r1, width):
        d = Vector((math.sin(theta), math.cos(theta), 0.0))
        p = Vector((math.cos(theta), -math.sin(theta), 0.0)) * (width / 2)
        bm.faces.new([bm.verts.new(v) for v in (d * r0 - p, d * r0 + p, d * r1 + p, d * r1 - p)])

    k = PRINT_S
    annulus(1.972 * k, 1.995 * k)
    annulus(1.835 * k, 1.85 * k)
    annulus(1.255 * k, 1.268 * k)
    for minute in range(60):
        bold = minute % 5 == 0
        bar(minute * math.pi / 30, (1.845 if bold else 1.848) * k, 1.975 * k, 0.07 if bold else 0.026)
    add("print", bm, ink, 0.0)

    def text(body, height, location, theta, condense, spacing=1.0):
        curve = bpy.data.curves.new("numeral", "FONT")
        curve.body = body
        curve.font = bpy.data.fonts.load(FONT, check_existing=True)
        curve.size = 1.0
        curve.space_character = spacing
        curve.resolution_u = 4
        obj = bpy.data.objects.new("numeral", curve)
        scene.collection.objects.link(obj)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")
        obj = bpy.context.active_object
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        cx, cy, scale = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, height / (max(ys) - min(ys))
        for vertex in obj.data.vertices:
            vertex.co = Vector(((vertex.co.x - cx) * scale * condense, (vertex.co.y - cy) * scale, 0.0))
        obj.location = location
        obj.rotation_euler.z = -theta
        obj.data.materials.append(ink)
        made.append(obj)

    numerals = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
    for hour, body in enumerate(numerals):
        theta = hour * math.pi / 6
        text(body, 0.5, (1.55 * k * math.sin(theta), 1.55 * k * math.cos(theta), 0.0), theta, 0.6)
    text("LONDON", 0.13, (0.0, -0.85, 0.0), 0.0, 1.0, 1.25)

    camera_data = bpy.data.cameras.new("print-camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2 * PRINT_R
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
    scene.render.resolution_x = scene.render.resolution_y = PRINT_SIZE
    scene.render.resolution_percentage = 100
    path = f"{OUTPUT}-dial-print.png"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for obj in made + [camera]:
        bpy.data.objects.remove(obj, do_unlink=True)
    scene.camera = None
    scene.render.engine = "CYCLES"
    return bpy.data.images.load(path)


def clock_material(print_image):
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
    mask = {kind: math_node(nodes, links, "COMPARE", code, float(kind), 0.5) for kind in range(4)}
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
    # The dial print, mapped by object x and z; seen from the back (+Y), the viewer's right is -X.
    back = math_node(nodes, links, "GREATER_THAN", separate.outputs["Y"], 0.0)
    sign = math_node(nodes, links, "SUBTRACT", 1.0, math_node(nodes, links, "MULTIPLY", back, 2.0))
    mirrored = math_node(nodes, links, "MULTIPLY", separate.outputs["X"], sign)
    u = math_node(nodes, links, "ADD", math_node(nodes, links, "MULTIPLY", mirrored, 1 / (2 * PRINT_R)), 0.5)
    v = math_node(nodes, links, "ADD", math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "SUBTRACT", height, CENTER_Z), 1 / (2 * PRINT_R)), 0.5)
    combine = nodes.new("ShaderNodeCombineXYZ")
    links.new(u, combine.inputs["X"])
    links.new(v, combine.inputs["Y"])
    printed = nodes.new("ShaderNodeTexImage")
    printed.image = print_image
    printed.extension = "EXTEND"
    links.new(combine.outputs["Vector"], printed.inputs["Vector"])
    yellowing = ramp_node(nodes, [(0.3, "#ebe2cc"), (0.75, "#ffffff")])
    links.new(noise(nodes, links, coords, 1.6, 4.0), yellowing.inputs["Fac"])
    enamel = mix_color(nodes, links, "MULTIPLY", 1.0, printed.outputs["Color"], yellowing.outputs["Color"])
    dialled = mix_color(nodes, links, "MIX", mask[DIAL], gilded, enamel)
    black = ramp_node(nodes, [(0.3, "#121110"), (0.7, "#1c1a17")])
    links.new(patch, black.inputs["Fac"])
    blacked = mix_color(nodes, links, "MIX", mask[BLACK], dialled, black.outputs["Color"])
    # Rust only on the plinth, where feet and mop buckets chip the paint.
    rust_ramp = ramp_node(nodes, [(0.6, "#000000"), (0.72, "#ffffff")])
    links.new(noise(nodes, links, coords, 4.0, 10.0), rust_ramp.inputs["Fac"])
    low = nodes.new("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 0.0
    low.inputs["From Max"].default_value = 0.45
    low.inputs["To Min"].default_value = 1.0
    low.inputs["To Max"].default_value = 0.0
    links.new(height, low.inputs["Value"])
    rust = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "MULTIPLY", rust_ramp.outputs["Color"], low.outputs["Result"]), mask[BRONZE])
    rusty = mix_color(nodes, links, "MIX", rust, blacked, linear("#5c3720"))
    # Dust settles on surfaces that face up.
    dust_ramp = ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dust = math_node(nodes, links, "MULTIPLY", dust_ramp.outputs["Color"], math_node(nodes, links, "SUBTRACT", 1.0, mask[DIAL]))
    dusty = mix_color(nodes, links, "MIX", dust, rusty, linear("#a39a88"))
    # Faint vertical streaks: noise stretched along the column.
    streak_mapping = nodes.new("ShaderNodeMapping")
    streak_mapping.inputs["Scale"].default_value = (9.0, 9.0, 0.6)
    links.new(coords, streak_mapping.inputs["Vector"])
    streak_ramp = ramp_node(nodes, [(0.55, "#ffffff"), (0.8, "#e2dbcf")])
    links.new(noise(nodes, links, streak_mapping.outputs["Vector"], 2.0, 4.0), streak_ramp.inputs["Fac"])
    streaked = mix_color(nodes, links, "MULTIPLY", 1.0, dusty, streak_ramp.outputs["Color"])
    # Scuffs and floor grime fade out by about knee height.
    floor_ramp = ramp_node(nodes, [(0.0, "#8f8472"), (1.0, "#ffffff")])
    floor_range = nodes.new("ShaderNodeMapRange")
    floor_range.inputs["From Max"].default_value = 1.2
    links.new(height, floor_range.inputs["Value"])
    scuff_noise = math_node(nodes, links, "ADD", floor_range.outputs["Result"], noise(nodes, links, coords, 6.0, 4.0))
    links.new(math_node(nodes, links, "MULTIPLY", scuff_noise, 0.75), floor_ramp.inputs["Fac"])
    floored = mix_color(nodes, links, "MULTIPLY", 1.0, streaked, floor_ramp.outputs["Color"])
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.2
    grime_ramp = ramp_node(nodes, [(0.0, "#73695a"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = mix_color(nodes, links, "MULTIPLY", 1.0, floored, grime_ramp.outputs["Color"])
    links.new(grimy, bsdf.inputs["Base Color"])
    # Paint, enamel and hands are dielectric; gilt is metal, and so are bare worn edges, but rust is not.
    unrusted = math_node(nodes, links, "SUBTRACT", 1.0, rust)
    worn_metal = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "MULTIPLY", paint_wear, 0.7), unrusted)
    gilt_metal = math_node(nodes, links, "MULTIPLY", mask[GILT], 0.55)
    links.new(math_node(nodes, links, "ADD", worn_metal, gilt_metal), bsdf.inputs["Metallic"])
    paint_roughness = nodes.new("ShaderNodeMapRange")
    paint_roughness.inputs["To Min"].default_value = 0.42
    paint_roughness.inputs["To Max"].default_value = 0.6
    links.new(patch, paint_roughness.inputs["Value"])
    rough = mix_float(nodes, links, paint_wear, paint_roughness.outputs["Result"], 0.35)
    rough = mix_float(nodes, links, mask[GILT], rough, mix_float(nodes, links, edge, 0.4, 0.26))
    rough = mix_float(nodes, links, mask[DIAL], rough, 0.22)
    rough = mix_float(nodes, links, mask[BLACK], rough, 0.45)
    rough = mix_float(nodes, links, rust, rough, 0.9)
    rough = mix_float(nodes, links, dust, rough, 0.85)
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel paint and a cast surface: a fine, weak bump, left off the enamel.
    bump = nodes.new("ShaderNodeBump")
    links.new(math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "SUBTRACT", 1.0, mask[DIAL]), 0.12), bump.inputs["Strength"])
    bump.inputs["Distance"].default_value = 0.004
    links.new(noise(nodes, links, coords, 40.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def mark_paint(obj, value):
    paint = obj.data.attributes.new("paint", "FLOAT", "POINT")
    paint.data.foreach_set("value", [float(value)] * len(obj.data.vertices))


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


def box(name, width, depth, z0, z1, paint, bevel):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vert in bm.verts:
        vert.co = Vector((vert.co.x * width, vert.co.y * depth, (z0 + z1) / 2 + vert.co.z * (z1 - z0)))
    return finish(name, bm, paint, bevel)


def lathe(name, rings, segments, paint, axis="Z", radial=None, caps=(False, False)):
    """A turned part from (radius, h) rings along an axis (h is the absolute coordinate on that axis; Y and X
    lathes turn round the drum centre's line). Trace the profile with the solid on its left (out along the
    bottom, up the outside) so faces point out; a ring of radius 0 is a pole."""

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
    return finish(name, bm, paint, recalc=False)


def mirror_y(rings):
    """The same Y-lathe profile on the back face, retraced so its faces still point out."""
    return [(radius, -h) for radius, h in reversed(rings)]


def smoothstep(edge0, edge1, value):
    t = min(1.0, max(0.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


DROP = 0.135  # astragal and capital lowered to meet the larger drum
SHAFT_BOTTOM, SHAFT_TOP, FLUTES = 2.93, 5.25 - DROP, 12


def column():
    """Stepped bronze plinth, a turned vase base, a plain lower shaft, a collar with a gilt bead, a fluted shaft,
    a gilt astragal and a bell capital cupping the drum."""
    box("plinth", 1.2, 1.2, 0.0, 0.24, BRONZE, 0.03)
    box("plinth-step", 0.98, 0.98, 0.22, 0.38, BRONZE, 0.03)
    base = [
        (0.44, 0.36), (0.465, 0.42), (0.455, 0.48), (0.41, 0.515), (0.375, 0.55), (0.36, 0.62), (0.38, 0.68),
        (0.355, 0.72), (0.31, 0.75), (0.31, 0.82), (0.33, 0.92), (0.315, 1.04), (0.27, 1.13), (0.232, 1.2), (0.212, 1.27),
    ]
    lathe("base", base, 24, BRONZE)
    lathe("base-ring", [(0.2, 1.26), (0.235, 1.28), (0.25, 1.32), (0.235, 1.36), (0.2, 1.38)], 24, GILT)
    lathe("lower-shaft", [(0.206, 1.37), (0.204, 2.0), (0.2, 2.6)], 24, BRONZE)
    lathe("collar-low", [(0.198, 2.58), (0.235, 2.6), (0.252, 2.635), (0.252, 2.69), (0.235, 2.715)], 24, BRONZE)
    lathe("collar-bead", [(0.232, 2.705), (0.258, 2.725), (0.268, 2.76), (0.258, 2.795), (0.232, 2.815)], 24, GILT)
    lathe("collar-high", [(0.235, 2.805), (0.252, 2.83), (0.252, 2.885), (0.235, 2.92), (0.196, 2.94)], 24, BRONZE)

    def shaft_radius(z):
        return 0.197 - 0.019 * (z - SHAFT_BOTTOM) / (SHAFT_TOP - SHAFT_BOTTOM)

    def flutes(theta, z):
        position = (theta * FLUTES / (2 * math.pi)) % 1.0
        groove = math.sin(math.pi * position) ** 0.8
        ends = smoothstep(SHAFT_BOTTOM + 0.03, SHAFT_BOTTOM + 0.15, z) * smoothstep(SHAFT_TOP - 0.03, SHAFT_TOP - 0.15, z)
        return 1 - 0.02 * groove * ends / shaft_radius(z)

    heights = [SHAFT_BOTTOM, SHAFT_BOTTOM + 0.07, SHAFT_BOTTOM + 0.15, 4.1, SHAFT_TOP - 0.15, SHAFT_TOP - 0.07, SHAFT_TOP]
    lathe("fluted-shaft", [(shaft_radius(z), z) for z in heights], FLUTES * 4, BRONZE, radial=flutes)
    lathe("astragal", [(r, z - DROP) for r, z in [(0.17, 5.23), (0.195, 5.25), (0.206, 5.28), (0.195, 5.31), (0.17, 5.33)]], 24, GILT)
    capital = [
        (0.172, 5.32), (0.182, 5.44), (0.2, 5.54), (0.235, 5.64), (0.285, 5.74), (0.345, 5.83), (0.395, 5.9),
        (0.415, 5.96), (0.4, 6.0), (0.36, 6.02), (0.3, 6.04), (0.24, 6.12),
    ]
    lathe("capital", [(r, z - DROP) for r, z in capital], 24, BRONZE)


def drum():
    """Bronze drum, moulded bronze bezels 5 wide with gilt sight rings, a gilt girdle and enamel dials."""
    lathe("drum", [(2.44, -0.43), (2.455, -0.32), (2.46, -0.12), (2.46, 0.12), (2.455, 0.32), (2.44, 0.43)], 64, BRONZE, axis="Y")
    lathe("girdle", [(2.455, -0.05), (2.475, -0.04), (2.482, 0.0), (2.475, 0.04), (2.455, 0.05)], 64, GILT, axis="Y")
    bezel = [(2.31, -0.455), (2.31, -0.525), (2.37, -0.562), (2.45, -0.55), (2.495, -0.5), (2.5, -0.44), (2.43, -0.4)]
    sight = [(2.26, -0.462), (2.272, -0.49), (2.3, -0.5), (2.325, -0.49)]
    dial = [(0.0, -DIAL_Y), (DIAL_R, -DIAL_Y)]
    for side, flip in (("front", lambda rings: rings), ("back", mirror_y)):
        lathe(f"bezel-{side}", flip(bezel), 64, BRONZE, axis="Y")
        lathe(f"sight-{side}", flip(sight), 64, GILT, axis="Y")
        lathe(f"dial-{side}", flip(dial), 64, DIAL, axis="Y")


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
    return finish(name, bm, paint)


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
        lathe(f"hand-boss-{side}", boss if front else mirror_y(boss), 16, GILT, axis="Y")


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


def unwrap(clock):
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
set_up_cycles()
PRINT = dial_print()
MATERIAL = clock_material(PRINT)
column()
drum()
hands()
clock = join_clock()
corners = [Vector(corner) for corner in clock.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("clock triangles", triangle_count(clock), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high), "modifiers", len(clock.modifiers))
unwrap(clock)
bake([clock], [MATERIAL], "clock")
export_glb([clock], "clock")
