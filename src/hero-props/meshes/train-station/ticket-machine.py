"""Station ticket machine: a heritage ticket-issuing cabinet for the concourse's row of machines.

Blender units = studs. Width along X (3), depth along Y (2), height along Z (5.87): floor at z 0, back at y -1,
customer face toward +Y. The GLB exporter turns Blender +Y into glTF -Z and Roblox imports glTF axes as they are,
so the face lands on the mesh's local -Z, the customer side of the kit machine (luau/props/ticket-machine.luau),
and the bounds match the kit machine's 3 x 5.87 x 2, so the recorded-mesh stretch leaves it unscaled.
Cream painted cabinet (the wall role's color family) framed in dark bronze pilasters, plinth, sign band and
cornice (the trim role's family), with brass fittings, gilt "TICKETS" letters and an arched screen window.
Every part is one material switched by a "paint" attribute, joined into one mesh, unwrapped and baked to
color (with occlusion grime), roughness, metalness and tangent normal maps by `lib`.
"""

import importlib
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
materials = importlib.import_module("lib.materials")
geometry = importlib.import_module("lib.geometry")
run = importlib.import_module("lib.run")
uv = importlib.import_module("lib.uv")

WIDTH, HEIGHT, BACK, FRONT = 3.0, 5.87, -1.0, 1.0
FACE = 0.7  # the cabinet's front face
FONT = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
CREAM, BRONZE, BRASS, SCREEN, BLACK, GLASS = range(6)
# The screen: a rectangle under a fanlight arch, its image mapped by object x and z.
SCREEN_X, SCREEN_BOTTOM, SPRING = 0.8, 2.92, 3.9
CREAM_PAINT = ([(0.3, "#cdc2a8"), (0.7, "#e3dbc6")], "#4f4a43")
BRONZE_PAINT = ([(0.2, "#25221f"), (0.8, "#312c27")], "#6e5a3e")


def screen_image():
    """A ticket-sale screen: a cream title bar, two columns of destination buttons, one picked out in amber."""
    width, height = 384, 240
    pixels = [0.0] * (width * height * 4)

    def rect(x0, y0, x1, y1, hex_color):
        color = tuple(int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)) + (1.0,)
        for y in range(int(y0 * height), int(y1 * height)):
            row = y * width
            for x in range(int(x0 * width), int(x1 * width)):
                pixels[(row + x) * 4 : (row + x) * 4 + 4] = color

    top, bottom = (0x2f, 0x5c, 0x82), (0x1d, 0x3a, 0x58)
    for y in range(height):
        t = y / (height - 1)
        color = tuple((bottom[i] + (top[i] - bottom[i]) * t) / 255 for i in range(3)) + (1.0,)
        for x in range(width):
            pixels[(y * width + x) * 4 : (y * width + x) * 4 + 4] = color
    rect(0.0, 0.8, 1.0, 1.0, "#e9e0c6")
    for x0, x1 in ((0.05, 0.3), (0.33, 0.46), (0.49, 0.58)):
        rect(x0, 0.86, x1, 0.93, "#2b2620")
    rect(0.8, 0.86, 0.95, 0.93, "#7a2e22")
    for x0, x1 in ((0.05, 0.36), (0.39, 0.5)):
        rect(x0, 0.68, x1, 0.73, "#e9e0c6")
    buttons = [(0.04, 0.48), (0.52, 0.96)]
    rows = [(0.45, 0.62), (0.25, 0.42), (0.05, 0.22)]
    for row_index, (y0, y1) in enumerate(rows):
        for column_index, (x0, x1) in enumerate(buttons):
            lit = row_index == 0 and column_index == 1
            rect(x0, y0, x1, y1, "#e2a93b" if lit else "#e6ddc3")
            ink = "#2b2620"
            middle = (y0 + y1) / 2
            rect(x0 + 0.03, middle - 0.025, x0 + 0.24, middle + 0.025, ink)
            rect(x1 - 0.12, middle - 0.025, x1 - 0.03, middle + 0.025, "#7a2e22" if not lit else ink)
    image = bpy.data.images.new("screen-ui", width, height)
    image.pixels = pixels
    return image


def machine_material():
    material, paint = materials.paint_stack([CREAM_PAINT, BRONZE_PAINT], wear=0.015)
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf, coords, patch, edge = paint["bsdf"], paint["coords"], paint["patch"], paint["edge"]
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, separate.inputs["Vector"])
    height = separate.outputs["Z"]
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(paint["geometry"].outputs["Normal"], normal_z.inputs["Vector"])
    mask = {kind: materials.math_node(tree, "COMPARE", (paint["dark_amount"], float(kind), 0.5)) for kind in range(6)}
    painted_mask = materials.math_node(tree, "ADD", (mask[CREAM], mask[BRONZE]))
    paint_wear = materials.math_node(tree, "MULTIPLY", (paint["wear"], painted_mask))
    worn = paint["worn"]
    # Brass: patchy tarnish, rubbed bright on its edges.
    brass = materials.ramp_node(nodes, [(0.3, "#a07d3e"), (0.7, "#cba45c")])
    links.new(materials.noise(tree, coords, (7.0, 6.0)), brass.inputs["Fac"])
    polished = materials.mix_color(tree, "MIX", (edge, brass.outputs["Color"], materials.linear("#e6cd92")))
    metal = materials.mix_color(tree, "MIX", (mask[BRASS], worn, polished))
    # The screen image, mapped across the screen rectangle by object x and z.
    u = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "ADD", (separate.outputs["X"], SCREEN_X)), 1 / (2 * SCREEN_X)))
    v = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "SUBTRACT", (height, SCREEN_BOTTOM)), 1 / (SPRING - SCREEN_BOTTOM)))
    combine = nodes.new("ShaderNodeCombineXYZ")
    links.new(u, combine.inputs["X"])
    links.new(v, combine.inputs["Y"])
    screen = nodes.new("ShaderNodeTexImage")
    screen.image = screen_image()
    screen.extension = "EXTEND"
    links.new(combine.outputs["Vector"], screen.inputs["Vector"])
    screened = materials.mix_color(tree, "MIX", (mask[SCREEN], metal, screen.outputs["Color"]))
    black = materials.ramp_node(nodes, [(0.3, "#0d0c0b"), (0.7, "#1b1916")])
    links.new(patch, black.inputs["Fac"])
    blacked = materials.mix_color(tree, "MIX", (mask[BLACK], screened, black.outputs["Color"]))
    glassed = materials.mix_color(tree, "MIX", (mask[GLASS], blacked, materials.linear("#1a2224")))
    # Rust only on the plinth, where feet and mop buckets chip the paint.
    rust_ramp = materials.ramp_node(nodes, [(0.62, "#000000"), (0.72, "#ffffff")])
    links.new(materials.noise(tree, coords, (4.0, 10.0)), rust_ramp.inputs["Fac"])
    low = nodes.new("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 0.0
    low.inputs["From Max"].default_value = 0.45
    low.inputs["To Min"].default_value = 1.0
    low.inputs["To Max"].default_value = 0.0
    links.new(height, low.inputs["Value"])
    rust = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "MULTIPLY", (rust_ramp.outputs["Color"], low.outputs["Result"])), painted_mask))
    rusty = materials.mix_color(tree, "MIX", (rust, glassed, materials.linear("#5c3720")))
    # Dust settles on surfaces that face up, but not on the screen, which gets wiped.
    dust_ramp = materials.ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dust = materials.math_node(tree, "MULTIPLY", (dust_ramp.outputs["Color"], materials.math_node(tree, "SUBTRACT", (1.0, mask[SCREEN]))))
    dusty = materials.mix_color(tree, "MIX", (dust, rusty, materials.linear("#a39a88")))
    # Faint vertical streaks: noise stretched along the cabinet.
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
    # Paint, screen and glass are dielectric; brass is metal, and so are bare worn edges, but rust is not.
    unrusted = materials.math_node(tree, "SUBTRACT", (1.0, rust))
    worn_metal = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "MULTIPLY", (paint_wear, 0.7)), unrusted))
    brass_metal = materials.math_node(tree, "MULTIPLY", (mask[BRASS], 0.6))
    links.new(materials.math_node(tree, "ADD", (worn_metal, brass_metal)), bsdf.inputs["Metallic"])
    paint_roughness = nodes.new("ShaderNodeMapRange")
    paint_roughness.inputs["To Min"].default_value = 0.42
    paint_roughness.inputs["To Max"].default_value = 0.62
    links.new(patch, paint_roughness.inputs["Value"])
    rough = materials.mix_float(tree, (paint_wear, paint_roughness.outputs["Result"], 0.35))
    rough = materials.mix_float(tree, (mask[BRASS], rough, materials.mix_float(tree, (edge, 0.45, 0.28))))
    for finish_mask, value in ((SCREEN, 0.14), (BLACK, 0.75), (GLASS, 0.08)):
        rough = materials.mix_float(tree, (mask[finish_mask], rough, value))
    rough = materials.mix_float(tree, (rust, rough, 0.9))
    rough = materials.mix_float(tree, (dust, rough, 0.85))
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel paint: a fine, weak bump, left off the screen and glass.
    bump = nodes.new("ShaderNodeBump")
    smooth = materials.math_node(tree, "ADD", (mask[SCREEN], mask[GLASS]))
    links.new(materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "SUBTRACT", (1.0, smooth)), 0.12)), bump.inputs["Strength"])
    bump.inputs["Distance"].default_value = 0.004
    links.new(materials.noise(tree, coords, (40.0, 4.0)), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def make_part(name, bm, look):
    """Turns a bmesh into a linked object with the shared material, its (paint code, bevel width) look."""
    paint, bevel = look
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = materials.link_object(name, mesh, MATERIAL)
    materials.mark_paint(obj, paint)
    if bevel:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def block(name, bounds, look):
    """An axis-aligned block between (x0, x1, y0, y1, z0, z1), its edges bevelled; `look` is (paint, bevel)."""
    x0, x1, y0, y1, z0, z1 = bounds
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    center = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    size = Vector((x1 - x0, y1 - y0, z1 - z0))
    for vert in bm.verts:
        vert.co = center + vert.co * size
    return make_part(name, bm, look)


def turned_box(name, size, location, rotation, paint, bevel=0.01):
    """A block of a given size, turned by an euler rotation and placed at its center."""
    obj = block(name, (-size[0] / 2, size[0] / 2, -size[1] / 2, size[1] / 2, -size[2] / 2, size[2] / 2), (paint, bevel))
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def prism_x(name, profile, x0, x1, paint, bevel=0.0):
    """A (y, z) profile extruded along X from x0 to x1, capped at both ends."""
    bm = bmesh.new()
    left = [bm.verts.new((x0, y, z)) for y, z in profile]
    right = [bm.verts.new((x1, y, z)) for y, z in profile]
    bm.faces.new(left)
    bm.faces.new(list(reversed(right)))
    for index in range(len(profile)):
        following = (index + 1) % len(profile)
        bm.faces.new((left[index], left[following], right[following], right[index]))
    return make_part(name, bm, (paint, bevel))


def prism_y(name, outline, y0, y1, paint, bevel=0.0):
    """An (x, z) outline extruded along Y from y0 to y1, capped at both ends."""
    bm = bmesh.new()
    back = [bm.verts.new((x, y0, z)) for x, z in outline]
    front = [bm.verts.new((x, y1, z)) for x, z in outline]
    bm.faces.new(back)
    bm.faces.new(list(reversed(front)))
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        bm.faces.new((back[index], back[following], front[following], front[index]))
    return make_part(name, bm, (paint, bevel))


def plane_y(name, outline, y, paint):
    """A single face facing +Y from an (x, z) outline."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, y, z)) for x, z in outline])
    bm.normal_update()
    if face.normal.y < 0:
        face.normal_flip()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = materials.link_object(name, mesh, MATERIAL)
    materials.mark_paint(obj, paint)
    return obj


def frame(name, loops, depth):
    """A frame between an outer and an inner (x, z) loop of the same length, `depth` being (y0 back, y1 front, paint)."""
    outer, inner = loops
    y0, y1, paint = depth
    bm = bmesh.new()
    front_outer = [bm.verts.new((x, y1, z)) for x, z in outer]
    front_inner = [bm.verts.new((x, y1, z)) for x, z in inner]
    back_outer = [bm.verts.new((x, y0, z)) for x, z in outer]
    back_inner = [bm.verts.new((x, y0, z)) for x, z in inner]
    count = len(outer)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((front_outer[i], front_outer[j], front_inner[j], front_inner[i]))
        bm.faces.new((back_outer[i], back_inner[i], back_inner[j], back_outer[j]))
        bm.faces.new((front_outer[i], back_outer[i], back_outer[j], front_outer[j]))
        bm.faces.new((front_inner[i], front_inner[j], back_inner[j], back_inner[i]))
    return make_part(name, bm, (paint, 0.0))


def rectangle(x0, x1, z0, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def rect_ring(name, x0, x1, z0, z1, border, y0, y1, paint):
    return frame(name, (rectangle(x0, x1, z0, z1), rectangle(x0 + border, x1 - border, z0 + border, z1 - border)), (y0, y1, paint))


def arch(half_width, bottom, spring, steps=18):
    """An arch-topped opening: a rectangle from bottom to spring under a semicircle of the same width."""
    points = [(-half_width, bottom), (half_width, bottom)]
    points += [(half_width * math.cos(math.pi * i / steps), spring + half_width * math.sin(math.pi * i / steps)) for i in range(steps + 1)]
    return points


def cylinder_y(name, radius, x, z, y0, y1, paint, vertices=16):
    outline = [(x + radius * math.cos(2 * math.pi * i / vertices), z + radius * math.sin(2 * math.pi * i / vertices)) for i in range(vertices)]
    return prism_y(name, outline, y0, y1, paint)


def letters(text, size, z, y, paint):
    """Extruded serif letters on the +Y face, centered on x 0 and z, converted to a mesh."""
    curve = bpy.data.curves.new("letters", "FONT")
    curve.body = text
    curve.font = bpy.data.fonts.load(FONT)
    curve.size = size
    curve.extrude = 0.008
    curve.resolution_u = 3
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.space_character = 1.08
    obj = bpy.data.objects.new("letters", curve)
    bpy.context.collection.objects.link(obj)
    obj.location = (0.0, y + 0.008, z)
    obj.rotation_euler = (math.radians(90), 0.0, math.radians(180))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.active_object
    obj.data.materials.append(MATERIAL)
    materials.mark_paint(obj, paint)
    return obj


def plinth_and_cornice():
    plinth = [(BACK, 0.0), (0.85, 0.0), (0.85, 0.22), (0.83, 0.25), (0.8, 0.27)]
    plinth += [(0.8 - 0.07 * math.sin(math.pi / 2 * i / 4), 0.27 + 0.09 * (1 - math.cos(math.pi / 2 * i / 4))) for i in range(1, 5)]
    plinth += [(0.7, 0.38), (BACK, 0.38)]
    prism_x("plinth", plinth, -WIDTH / 2, WIDTH / 2, BRONZE)
    cornice = [(BACK, 5.45), (0.86, 5.45), (0.86, 5.5)]
    cornice += [(0.96 - 0.1 * math.cos(math.pi / 2 * i / 5), 5.5 + 0.1 * math.sin(math.pi / 2 * i / 5)) for i in range(1, 6)]
    cornice += [(0.98, 5.6), (0.98, 5.66), (0.95, 5.69), (0.95, 5.8), (0.98, 5.82), (0.98, HEIGHT), (BACK, HEIGHT)]
    prism_x("cornice", cornice, -WIDTH / 2, WIDTH / 2, BRONZE)


def cabinet():
    block("cabinet", (-1.46, 1.46, BACK, FACE, 0.38, 5.45), (CREAM, 0.02))
    for side in (-1, 1):
        inner, outer = sorted((side * 1.29, side * 1.5))
        block(f"pilaster-{side}", (inner + (0.02 if side > 0 else 0.0), outer - (0.02 if side < 0 else 0.0), 0.6, 0.8, 0.5, 4.8), (BRONZE, 0.02))
        block(f"pilaster-base-{side}", (inner, outer, 0.58, 0.84, 0.38, 0.56), (BRONZE, 0.02))
        block(f"pilaster-cap-{side}", (inner, outer, 0.58, 0.84, 4.78, 4.95), (BRONZE, 0.02))
        # A sunk brass line down each pilaster's face.
        middle = side * 1.395
        block(f"pilaster-line-{side}", (middle - 0.02, middle + 0.02, 0.8, 0.81, 0.75, 4.6), (BRASS, 0.005))
        cylinder_y(f"pilaster-boss-{side}", 0.045, middle, 4.865, 0.84, 0.87, BRASS, 12)
    block("sign", (-WIDTH / 2, WIDTH / 2, 0.58, 0.84, 4.95, 5.45), (BRONZE, 0.015))
    rect_ring("sign-frame", -1.4, 1.4, 5.0, 5.4, 0.035, 0.84, 0.86, BRASS)
    letters("TICKETS", 0.36, 5.2, 0.84, BRASS)


def window():
    """The arched screen window: bronze bezel, brass bead, screen, transom and a fanlight of radial bars."""
    frame("bezel", (arch(0.98, 2.74, SPRING), arch(0.84, 2.88, SPRING)), (FACE, 0.78, BRONZE))
    frame("bead", (arch(0.84, 2.88, SPRING), arch(SCREEN_X, SCREEN_BOTTOM, SPRING)), (FACE, 0.8, BRASS))
    plane_y("screen", rectangle(-SCREEN_X, SCREEN_X, SCREEN_BOTTOM, SPRING), 0.725, SCREEN)
    fan = [(0.81 * math.cos(math.pi * i / 18), SPRING + 0.81 * math.sin(math.pi * i / 18)) for i in range(19)]
    plane_y("fanlight", fan, 0.72, GLASS)
    block("transom", (-SCREEN_X, SCREEN_X, 0.71, 0.77, SPRING - 0.02, SPRING + 0.03), (BRASS, 0.01))
    hub = [(0.15 * math.cos(math.pi * i / 10), SPRING + 0.15 * math.sin(math.pi * i / 10)) for i in range(11)]
    prism_y("fan-hub", hub, 0.71, 0.765, BRASS)
    for index, degrees in enumerate((30, 60, 90, 120, 150)):
        angle = math.radians(degrees)
        middle = 0.47
        location = (middle * math.cos(angle), 0.74, SPRING + middle * math.sin(angle))
        turned_box(f"fan-bar-{index}", (0.66, 0.035, 0.03), location, (0.0, -angle, 0.0), BRASS, 0.006)


DESK_FRONT, DESK_TOP_FRONT, DESK_TOP_BACK = 0.97, 2.57, 2.74
DESK_SLOPE = math.atan2(DESK_TOP_BACK - DESK_TOP_FRONT, DESK_FRONT - FACE)


def on_desk(name, x0, x1, s0, s1, thickness, paint, lift=0.0, bevel=0.008):
    """A block on the sloping desk top, from s0 to s1 up the slope and lifted by `lift` off it."""
    s = (s0 + s1) / 2
    normal = Vector((0.0, math.sin(DESK_SLOPE), math.cos(DESK_SLOPE)))
    surface = Vector(((x0 + x1) / 2, DESK_FRONT - s * math.cos(DESK_SLOPE), DESK_TOP_FRONT + s * math.sin(DESK_SLOPE)))
    location = surface + normal * (lift + thickness / 2)
    return turned_box(name, (x1 - x0, s1 - s0, thickness), location, (-DESK_SLOPE, 0.0, 0.0), paint, bevel)


def desk():
    """A sloping bronze desk with a brass nosing, a keypad on the left and a card reader on the right."""
    profile = [(FACE - 0.02, 2.3), (0.9, 2.4), (DESK_FRONT, 2.45), (DESK_FRONT, DESK_TOP_FRONT), (FACE - 0.02, DESK_TOP_BACK)]
    prism_x("desk", profile, -1.15, 1.15, BRONZE)
    block("desk-nosing", (-1.17, 1.17, 0.96, FRONT, 2.44, 2.58), (BRASS, 0.015))
    on_desk("keypad", -1.02, -0.44, 0.04, 0.29, 0.012, BLACK)
    for row in range(4):
        for column in range(3):
            x0 = -0.98 + column * 0.17
            s0 = 0.06 + row * 0.055
            on_desk(f"key-{row}-{column}", x0, x0 + 0.13, s0, s0 + 0.04, 0.025, BRASS, lift=0.012, bevel=0.006)
    on_desk("reader-plate", 0.42, 1.02, 0.03, 0.3, 0.02, BRASS)
    on_desk("reader", 0.48, 0.96, 0.06, 0.27, 0.05, BLACK, lift=0.02)
    on_desk("instructions", -0.3, 0.3, 0.06, 0.26, 0.01, BRASS)
    for line in range(3):
        on_desk(f"instruction-{line}", -0.24, 0.24 - 0.1 * line, 0.1 + line * 0.05, 0.12 + line * 0.05, 0.004, BLACK, lift=0.01, bevel=0.0)


def payment():
    """Under the desk: a bronze-beaded panel with a coin slot, a note slot and a coin-return button."""
    rect_ring("payment-frame", -0.95, 0.95, 1.42, 2.2, 0.035, FACE, 0.73, BRONZE)
    block("coin-plate", (-0.66, -0.38, FACE, 0.735, 1.6, 2.02), (BRASS, 0.012))
    block("coin-slot", (-0.53, -0.51, FACE, 0.74, 1.72, 1.92), (BLACK, 0.0))
    block("note-plate", (-0.2, 0.74, FACE, 0.75, 1.86, 2.03), (BRASS, 0.012))
    block("note-slot", (-0.12, 0.66, FACE, 0.755, 1.93, 1.96), (BLACK, 0.0))
    cylinder_y("return-button-rim", 0.07, 0.5, 1.62, FACE, 0.73, BRASS)
    cylinder_y("return-button", 0.045, 0.5, 1.62, FACE, 0.76, BLACK, 12)


def hopper():
    """The ticket cup: a brass frame round a dark opening under a bronze hood, with a brass tray lip."""
    rect_ring("hopper-frame", -0.52, 0.52, 0.78, 1.28, 0.07, FACE, 0.8, BRASS)
    plane_y("hopper-opening", rectangle(-0.45, 0.45, 0.85, 1.21), FACE + 0.005, BLACK)
    block("hopper-hood", (-0.56, 0.56, FACE, 0.92, 1.27, 1.34), (BRONZE, 0.015))
    block("hopper-lip", (-0.45, 0.45, FACE, 0.88, 0.8, 0.86), (BRASS, 0.012))
    rect_ring("kick-frame", -1.1, 1.1, 0.46, 0.7, 0.03, FACE, 0.725, BRONZE)


def build_machine():
    plinth_and_cornice()
    cabinet()
    window()
    desk()
    payment()
    hopper()



def density(paint, face):
    """The screen's island grown, the back wall's and the underside's shrunk since nobody sees them."""
    if paint == SCREEN:
        return 2.0
    if face.normal.y < -0.9 and face.calc_center_median().y < BACK + 0.01:
        return 0.3
    if face.normal.z < -0.9 and face.calc_center_median().z < 0.01:
        return 0.1
    return None


bpy.ops.wm.read_factory_settings(use_empty=True)
run.set_up_cycles()
MATERIAL = machine_material()
build_machine()
machine = geometry.finish("ticket-machine", 50)
corners = [Vector(corner) for corner in machine.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("ticket-machine triangles", run.triangle_count(machine), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high), "modifiers", len(machine.modifiers))
uv.unwrap([machine], face_scale=density)
run.bake([machine], [MATERIAL], "ticket-machine")
run.export_glb([machine], "ticket-machine")
