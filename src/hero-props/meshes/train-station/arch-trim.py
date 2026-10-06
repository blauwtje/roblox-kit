"""Station arch frame and trim profiles: a cast-iron portal and two mouldings replacing the kit's plain Metal Parts.

Blender units = studs, Z up. One GLB with three mesh objects, each with its origin at its bounding-box centre,
sharing one material and one UV atlas, so one set of maps covers all three:
- arch: 11.6 (X) x 16 (Z) x 0.6 (Y), the kit arch's bounds, placed unscaled. Fluted pilaster jambs on an iron
  plinth with a brass-ringed capital and an iron abacus, carrying a small entablature (two-fascia architrave, a
  brass bead, a riveted frieze, an iron cornice) with a cream keystone. The 9.6 x 14.5 opening stays clear.
  The arch is symmetric in Y, so both faces carry the same detail.
- crown: 4 (X) x 0.5 (Z) x 0.3 (Y), a cove, fillet and ovolo cornice with a brass bottom bead.
- baseboard: 4 x 0.5 x 0.3, skirting on an iron toe plinth with a brass bead and an ogee cap.
The trim profiles face Blender -Y and their backs sit flat at +Y. As with the clock, the exporter turns -Y into
glTF +Z and Roblox's import puts that on the MeshPart's local -Z. Studio stretches the trims along X to 12-58
studs, so their shading ignores X: noise reads Object coordinates with X zeroed (a "trim" attribute), there is no
bump, and they are baked stretched 15x along X so occlusion does not fade near their ends.
Palette as the pendant: dark green enamel, brass, cream, cast iron, switched by a "paint" attribute
(0 green, 1 brass, 2 cream, 3 iron). Every part is joined per object, unwrapped together (smart project, then one
pack) and baked to color (with occlusion grime), roughness, metalness and tangent normal maps by `shared.py`.
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
    ramp_node,
    set_up_cycles,
    triangle_count,
    unwrap,
)

GREEN, BRASS, CREAM, IRON = 0.0, 1.0, 2.0, 3.0
# Jamb: centred 5.3 off the axis; shaft 0.84 x 0.44, mouldings project up to 0.08 more (to the 1.0 x 0.6 envelope).
JAMB_X, SHAFT_HX, SHAFT_HY, MAX_E = 5.3, 0.42, 0.22, 0.08
OPENING_TOP, HEIGHT, HALF_WIDTH = 14.5, 16.0, 5.8
SHAFT_BOTTOM, SHAFT_TOP = 0.94, 13.2


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


def paint_material():
    material = bpy.data.materials.new("paint")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes["Principled BSDF"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Normal"], normal_z.inputs["Vector"])
    # Trims are stretched along X in Studio: their noise must not vary along X, so X is zeroed for them.
    trim = nodes.new("ShaderNodeAttribute")
    trim.attribute_name = "trim"
    keep_x = math_node(nodes, links, "SUBTRACT", 1.0, trim.outputs["Fac"])
    x_scale = nodes.new("ShaderNodeCombineXYZ")
    links.new(keep_x, x_scale.inputs["X"])
    x_scale.inputs["Y"].default_value = 1.0
    x_scale.inputs["Z"].default_value = 1.0
    scaled = nodes.new("ShaderNodeVectorMath")
    scaled.operation = "MULTIPLY"
    links.new(nodes.new("ShaderNodeTexCoord").outputs["Object"], scaled.inputs[0])
    links.new(x_scale.outputs["Vector"], scaled.inputs[1])
    coords = scaled.outputs["Vector"]
    paint = nodes.new("ShaderNodeAttribute")
    paint.attribute_name = "paint"
    masks = [math_node(nodes, links, "COMPARE", paint.outputs["Fac"], float(k), 0.5) for k in range(4)]
    patch = noise(nodes, links, coords, 3.0, 6.0)

    def tone(stops):
        ramp = ramp_node(nodes, stops)
        links.new(patch, ramp.inputs["Fac"])
        return ramp.outputs["Color"]

    color = tone([(0.3, "#264a37"), (0.7, "#2f5843")])
    color = mix_color(nodes, links, "MIX", masks[1], color, tone([(0.3, "#9a7533"), (0.7, "#b48d45")]))
    color = mix_color(nodes, links, "MIX", masks[2], color, tone([(0.3, "#b3a482"), (0.7, "#c0b18d")]))
    color = mix_color(nodes, links, "MIX", masks[3], color, tone([(0.3, "#221f1c"), (0.7, "#2e2a25")]))
    # Edge wear: enamel and iron chip to dark metal, brass polishes brighter.
    bevel = nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = 0.012
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(bevel.outputs["Normal"], facing.inputs[0])
    links.new(geometry.outputs["Normal"], facing.inputs[1])
    edge_ramp = ramp_node(nodes, [(0.9, "#ffffff"), (0.97, "#000000")])
    links.new(facing.outputs["Value"], edge_ramp.inputs["Fac"])
    chip_ramp = ramp_node(nodes, [(0.45, "#000000"), (0.6, "#ffffff")])
    links.new(noise(nodes, links, coords, 14.0, 6.0), chip_ramp.inputs["Fac"])
    wear = math_node(nodes, links, "MULTIPLY", edge_ramp.outputs["Color"], chip_ramp.outputs["Color"])
    bare = mix_color(nodes, links, "MIX", masks[1], linear("#3d3a36"), linear("#d8b56a"))
    color = mix_color(nodes, links, "MIX", wear, color, bare)
    dust_ramp = ramp_node(nodes, [(0.6, "#000000"), (0.95, "#4d4d4d")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    color = mix_color(nodes, links, "MIX", dust_ramp.outputs["Color"], color, linear("#8a8172"))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.2
    grime_ramp = ramp_node(nodes, [(0.0, "#6b6152"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    color = mix_color(nodes, links, "MULTIPLY", 1.0, color, grime_ramp.outputs["Color"])
    links.new(color, bsdf.inputs["Base Color"])
    metal = math_node(nodes, links, "MULTIPLY", masks[1], 0.9)
    metal = math_node(nodes, links, "MULTIPLY_ADD", masks[3], 0.25, metal)
    metal = math_node(nodes, links, "MAXIMUM", metal, math_node(nodes, links, "MULTIPLY", wear, 0.8))
    links.new(metal, bsdf.inputs["Metallic"])
    rough_noise = nodes.new("ShaderNodeMapRange")
    rough_noise.inputs["To Min"].default_value = -0.06
    rough_noise.inputs["To Max"].default_value = 0.06
    links.new(patch, rough_noise.inputs["Value"])
    rough = math_node(nodes, links, "ADD", 0.34, rough_noise.outputs["Result"])
    rough = mix_float(nodes, links, masks[1], rough, 0.38)
    rough = mix_float(nodes, links, masks[2], rough, 0.5)
    rough = mix_float(nodes, links, masks[3], rough, 0.62)
    rough = mix_float(nodes, links, dust_ramp.outputs["Color"], rough, 0.8)
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel enamel on the arch only; a bump on a trim would streak once stretched.
    bump = nodes.new("ShaderNodeBump")
    links.new(math_node(nodes, links, "MULTIPLY", keep_x, 0.1), bump.inputs["Strength"])
    bump.inputs["Distance"].default_value = 0.004
    links.new(noise(nodes, links, coords, 40.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def mark(obj, name, value):
    attribute = obj.data.attributes.new(name, "FLOAT", "POINT")
    attribute.data.foreach_set("value", [value] * len(obj.data.vertices))


def add_bevel(obj, width):
    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = width
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(50)
    bevel.harden_normals = False


def loft(name, sections, to_world, material, paint, bevel=0.0):
    """A closed solid through equal-length 2D polygons, each placed by to_world(u, v, t); capped at both ends."""
    bm = bmesh.new()
    rings = [[bm.verts.new(to_world(u, v, t)) for u, v in polygon] for polygon, t in sections]
    for lower, upper in zip(rings, rings[1:]):
        count = len(lower)
        for i in range(count):
            j = (i + 1) % count
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link_object(name, mesh, material)
    mark(obj, "paint", paint)
    if bevel:
        add_bevel(obj, bevel)
    return obj


def rectangle(hx, hy):
    return [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]


def square_lathe(name, profile, cx, material, paint):
    """A moulding wrapped round the jamb: (e, z) pairs, e the projection beyond the shaft's 0.84 x 0.44."""
    sections = [(rectangle(SHAFT_HX + e, SHAFT_HY + e), z) for e, z in profile]
    return loft(name, sections, lambda u, v, t: (cx + u, v, t), material, paint, 0.01)


def extrusion(name, polygon, x0, x1, material, paint, bevel=0.01):
    """A (y, z) profile run along X from x0 to x1."""
    return loft(name, [(polygon, x0), (polygon, x1)], lambda u, v, t: (t, u, v), material, paint, bevel)


def smoothstep(edge0, edge1, value):
    t = min(1.0, max(0.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def arc(cu, cv, ru, rv, a0, a1, steps):
    """Points on an elliptical arc from angle a0 to a1 (degrees), endpoints included."""
    return [
        (cu + ru * math.cos(math.radians(a0 + (a1 - a0) * k / steps)), cv + rv * math.sin(math.radians(a0 + (a1 - a0) * k / steps)))
        for k in range(steps + 1)
    ]


# --- arch ---------------------------------------------------------------------------------------------------


def fluted_face(depth, sign):
    """One shaft face from x -SHAFT_HX to +SHAFT_HX at y = sign * SHAFT_HY, three flutes cut depth deep."""
    points = [(-SHAFT_HX, 0.0)]
    for centre in (-0.25, 0.0, 0.25):
        for k in range(9):
            t = k / 8
            points.append((centre - 0.08 + 0.16 * t, depth * math.sin(math.pi * t) ** 0.8))
    points.append((SHAFT_HX, 0.0))
    return [(x, sign * (SHAFT_HY - d)) for x, d in points]


def shaft_section(depth):
    front = fluted_face(depth, -1.0)
    back = list(reversed(fluted_face(depth, 1.0)))
    return front + back


def jamb(cx, material):
    loft(f"core-{cx}", [(rectangle(0.5, 0.14), 0.0), (rectangle(0.5, 0.14), OPENING_TOP)], lambda u, v, t: (cx + u, v, t), material, GREEN, 0.01)
    square_lathe(f"plinth-{cx}", [(0.08, 0.0), (0.08, 0.6), (0.07, 0.64), (0.055, 0.66)], cx, material, IRON)
    torus = [(0.055, 0.64)] + [(0.045 + 0.025 * math.sin(math.pi * k / 6), 0.66 + 0.1 * k / 6) for k in range(7)]
    torus += [(0.035, 0.77), (0.035, 0.79), (0.02, 0.81), (0.015, 0.84), (0.02, 0.87), (0.03, 0.88)]
    square_lathe(f"base-torus-{cx}", torus, cx, material, GREEN)
    bead = [(0.0, 0.875)] + [(0.035 * math.sin(math.pi * k / 4) + 0.01, 0.88 + 0.06 * k / 4) for k in range(5)] + [(0.0, 0.945)]
    square_lathe(f"base-bead-{cx}", bead, cx, material, BRASS)
    heights = [SHAFT_BOTTOM, SHAFT_BOTTOM + 0.12, SHAFT_BOTTOM + 0.22, SHAFT_BOTTOM + 0.3, SHAFT_BOTTOM + 0.38]
    heights += [SHAFT_TOP - 0.38, SHAFT_TOP - 0.3, SHAFT_TOP - 0.22, SHAFT_TOP - 0.12, SHAFT_TOP]
    sections = []
    for z in heights:
        stop = smoothstep(SHAFT_BOTTOM + 0.1, SHAFT_BOTTOM + 0.38, z) * smoothstep(SHAFT_TOP - 0.1, SHAFT_TOP - 0.38, z)
        sections.append((shaft_section(0.035 * stop), z))
    loft(f"shaft-{cx}", sections, lambda u, v, t: (cx + u, v, t), material, GREEN, 0.008)
    astragal = [(0.0, 13.18)] + [(0.01 + 0.025 * math.sin(math.pi * k / 4), 13.2 + 0.09 * k / 4) for k in range(5)] + [(0.0, 13.31)]
    square_lathe(f"astragal-{cx}", astragal, cx, material, BRASS)
    square_lathe(f"necking-{cx}", [(0.0, 13.3), (0.0, 13.62), (0.012, 13.64)], cx, material, GREEN)
    bell = [(0.012, 13.62)] + [(0.012 + 0.058 * math.sin(math.pi / 2 * k / 6), 13.64 + 0.4 * (1 - math.cos(math.pi / 2 * k / 6))) for k in range(1, 7)]
    bell += [(0.07, 14.06), (0.06, 14.08)]
    square_lathe(f"bell-{cx}", bell, cx, material, GREEN)
    square_lathe(f"abacus-{cx}", [(0.06, 14.06), (0.08, 14.1), (0.08, OPENING_TOP)], cx, material, IRON)
    # A brass rosette on the necking, front and back.
    for sign in (-1.0, 1.0):
        rings = [(0.0, 0.0), (0.085, 0.0), (0.09, 0.012), (0.075, 0.03), (0.04, 0.04), (0.0, 0.045)]
        bm_rings = [(r, sign * (SHAFT_HY + h)) for r, h in rings]
        polygon_sections = []
        for r, y in bm_rings:
            polygon_sections.append(([(max(r, 0.001) * math.cos(2 * math.pi * k / 16), max(r, 0.001) * math.sin(2 * math.pi * k / 16)) for k in range(16)], y))
        loft(f"rosette-{cx}-{sign}", polygon_sections, lambda u, v, t: (cx + u, t, 13.46 + v), material, BRASS)


def mirrored(profile):
    """A (half depth, z) profile from bottom to top, mirrored into a closed (y, z) polygon: front up, back down."""
    return [(-h, z) for h, z in profile] + [(h, z) for h, z in reversed(profile)]


def entablature(material):
    architrave = [(0.17, OPENING_TOP), (0.17, 14.72), (0.19, 14.74), (0.19, 14.97)]
    extrusion("architrave", mirrored(architrave), -HALF_WIDTH, HALF_WIDTH, material, GREEN)
    bead = [(0.17, 14.96)] + [(0.19 + 0.025 * math.sin(math.pi * k / 4), 14.965 + 0.05 * k / 4) for k in range(5)] + [(0.17, 15.02)]
    extrusion("lintel-bead", mirrored(bead), -HALF_WIDTH, HALF_WIDTH, material, BRASS)
    extrusion("frieze", mirrored([(0.18, 15.0), (0.18, 15.48)]), -HALF_WIDTH, HALF_WIDTH, material, GREEN)
    cornice = [(0.17, 15.46), (0.2, 15.47)] + arc(0.2, 15.56, 0.05, 0.09, -90, 0, 4)[1:]
    cornice += [(0.26, 15.6), (0.29, 15.62), (0.29, 15.82)] + arc(0.29, 15.9, 0.01, 0.08, -90, 0, 2)[1:]
    cornice += [(0.3, 15.93), (0.28, 15.97), (0.26, HEIGHT)]
    extrusion("cornice", mirrored(cornice), -HALF_WIDTH, HALF_WIDTH, material, IRON)
    # Keystone: a cream wedge from the opening top up into the cornice.
    keystone = [(-0.3, OPENING_TOP), (0.3, OPENING_TOP), (0.4, 15.7), (-0.4, 15.7)]
    loft("keystone", [(keystone, -0.24), (keystone, 0.24)], lambda u, v, t: (u, t, v), material, CREAM, 0.012)
    for sign in (-1.0, 1.0):
        for side in (-1.0, 1.0):
            for k in range(10):
                bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(side * (0.85 + 0.5 * k), sign * 0.18, 15.24), segments=8, ring_count=4)
                rivet = bpy.context.active_object
                rivet.scale = (0.04, 0.025, 0.04)
                rivet.data.materials.append(material)
                mark(rivet, "paint", BRASS)


def build_arch(material):
    for cx in (-JAMB_X, JAMB_X):
        jamb(cx, material)
    entablature(material)


# --- trims --------------------------------------------------------------------------------------------------


def wall_profile(points):
    """(projection from wall, height from bottom) to Blender (y, z): front toward -Y, back at +0.15, centred."""
    return [(0.15 - p, h - 0.25) for p, h in points]


def build_crown(material):
    bead = [(0.0, 0.0), (0.025, 0.0), (0.04, 0.012), (0.046, 0.03), (0.042, 0.048), (0.032, 0.058), (0.0, 0.058)]
    extrusion("crown-bead", wall_profile(bead), -2.0, 2.0, material, BRASS, 0.0)
    body = [(0.0, 0.055), (0.036, 0.056)] + arc(0.2, 0.06, 0.16, 0.2, 180, 90, 8)
    body += [(0.215, 0.265), (0.22, 0.29)] + [(0.22 + 0.08 * math.sin(math.pi / 2 * k / 6), 0.39 - 0.1 * math.cos(math.pi / 2 * k / 6)) for k in range(1, 7)]
    body += [(0.3, 0.45), (0.29, 0.46), (0.27, 0.46), (0.27, 0.5), (0.0, 0.5)]
    extrusion("crown-body", list(reversed(wall_profile(body))), -2.0, 2.0, material, GREEN, 0.004)


def build_baseboard(material):
    toe = [(0.0, 0.0), (0.3, 0.0), (0.3, 0.05), (0.285, 0.075), (0.26, 0.085), (0.26, 0.1), (0.0, 0.1)]
    extrusion("baseboard-toe", wall_profile(toe), -2.0, 2.0, material, IRON, 0.004)
    extrusion("baseboard-body", wall_profile([(0.0, 0.095), (0.24, 0.095), (0.24, 0.35), (0.0, 0.35)]), -2.0, 2.0, material, GREEN, 0.004)
    bead = [(0.0, 0.34), (0.24, 0.34)] + [(0.24 + 0.045 * math.sin(math.pi * k / 6), 0.385 - 0.045 * math.cos(math.pi * k / 6)) for k in range(1, 6)]
    bead += [(0.24, 0.43), (0.0, 0.43)]
    extrusion("baseboard-bead", wall_profile(bead), -2.0, 2.0, material, BRASS, 0.0)
    cap = [(0.0, 0.425), (0.21, 0.425), (0.21, 0.435), (0.2, 0.452), (0.18, 0.464), (0.15, 0.471), (0.12, 0.478), (0.1, 0.488), (0.085, 0.5), (0.0, 0.5)]
    extrusion("baseboard-cap", wall_profile(cap), -2.0, 2.0, material, GREEN, 0.004)


# --- assembly, unwrap, bake ---------------------------------------------------------------------------------


def join_new(name, trim):
    """Joins every object not yet named arch, crown or baseboard into one, origin at its bounding-box centre."""
    finished = {"arch", "crown", "baseboard"}
    parts = [obj for obj in bpy.context.scene.objects if obj.name not in finished]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    mark(obj, "trim", trim)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    obj.location = (0.0, 0.0, 0.0)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    return obj


# --- preview scene ------------------------------------------------------------------------------------------


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
paint = paint_material()
build_arch(paint)
arch = join_new("arch", 0.0)
build_crown(paint)
crown = join_new("crown", 1.0)
build_baseboard(paint)
baseboard = join_new("baseboard", 1.0)
objects = [arch, crown, baseboard]
for obj in objects:
    corners = [Vector(corner) for corner in obj.bound_box]
    lo = [min(c[i] for c in corners) for i in range(3)]
    hi = [max(c[i] for c in corners) for i in range(3)]
    print("object", obj.name, "triangles", triangle_count(obj), "size", [round(h - l, 4) for l, h in zip(lo, hi)], "centre", [round((h + l) / 2, 4) for l, h in zip(lo, hi)])
unwrap(objects, 0.003)
# Apart so nothing occludes another; trims stretched so occlusion does not fade at their ends.
crown.location, crown.scale = (0.0, 4.0, 0.0), (15.0, 1.0, 1.0)
baseboard.location, baseboard.scale = (0.0, 8.0, 0.0), (15.0, 1.0, 1.0)
bake(objects, [paint], "arch-trim")
for obj in objects:
    obj.location, obj.scale = (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)
export_glb(objects, "arch-trim")
