"""Station train car: a green passenger carriage with a lit amber window band, standing on two rails.

Blender units = studs, Z up (glTF/Roblox Y up). The car runs along X and is centered on x and y with the sleepers
on z 0, so its bounds are the kit train car's 40 x 7 x 7.8 (X, Y, Z) and the recorded-mesh stretch leaves it
unscaled. Green body with a cream waist stripe and arched roof, an amber window band with mullions, a recessed
door at the middle of each side, four flanged wheel sets on dark iron axles with brass hub caps, buffers and
roof vents, on two steel rails and nine sleepers. Every part is one paint material switched by a "paint"
attribute, joined into one mesh, unwrapped and baked to color (with occlusion grime), roughness, metalness and
tangent normal maps by `shared.py`. The windows are only amber paint: a SurfaceAppearance has no emission.
"""

import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import (  # noqa: E402
    bake,
    export_glb,
    link_object,
    mark_paint,
    mix_color,
    mix_float,
    noise,
    ramp_node,
    set_up_cycles,
    triangle_count,
    unwrap,
)

HALF_LENGTH = 20.0
HALF_DEPTH = 3.5
TOP = 7.8
RAIL_Y = 2.85

BODY, CREAM, GLASS, IRON, BRASS, STEEL, WOOD, DOOR = range(8)
# (two tone-ramp stops, roughness, metalness) per paint value.
PAINTS = [
    (("#264a37", "#2f5843"), 0.45, 0.0),
    (("#cdc2a8", "#e3dbc6"), 0.6, 0.0),
    (("#e8a73c", "#f6c565"), 0.15, 0.0),
    (("#25221f", "#312c27"), 0.7, 0.5),
    (("#9a7533", "#b48d45"), 0.35, 0.9),
    (("#6b665f", "#8a857d"), 0.4, 0.9),
    (("#4d3c2a", "#6a543a"), 0.9, 0.0),
    (("#1c3326", "#244033"), 0.5, 0.0),
]


def paint_material():
    material = bpy.data.materials.new("paint")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    attribute = nodes.new("ShaderNodeAttribute")
    attribute.attribute_name = "paint"
    patch = noise(nodes, links, coords, 2.5, 6.0)
    color = roughness = metalness = None
    for value, (stops, rough, metal) in enumerate(PAINTS):
        tone = ramp_node(nodes, [(0.3, stops[0]), (0.7, stops[1])])
        links.new(patch, tone.inputs["Fac"])
        if value == 0:
            color, roughness, metalness = tone.outputs["Color"], rough, metal
            continue
        mask = nodes.new("ShaderNodeMath")
        mask.operation = "COMPARE"
        links.new(attribute.outputs["Fac"], mask.inputs[0])
        mask.inputs[1].default_value = float(value)
        mask.inputs[2].default_value = 0.5
        color = mix_color(nodes, links, "MIX", mask.outputs["Value"], color, tone.outputs["Color"])
        roughness = mix_float(nodes, links, mask.outputs["Value"], roughness, rough)
        metalness = mix_float(nodes, links, mask.outputs["Value"], metalness, metal)
    # Occlusion grime darkens the creases, then a fine bump roughens every face.
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.6
    grime = ramp_node(nodes, [(0.0, "#6a6258"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime.inputs["Fac"])
    color = mix_color(nodes, links, "MULTIPLY", 1.0, color, grime.outputs["Color"])
    links.new(color, bsdf.inputs["Base Color"])
    links.new(roughness, bsdf.inputs["Roughness"])
    links.new(metalness, bsdf.inputs["Metallic"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    bump.inputs["Distance"].default_value = 0.02
    links.new(noise(nodes, links, coords, 25.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def finish(obj, paint, bevel):
    """Marks the object's paint value and gives it a bevel that is applied when the parts are joined."""
    mark_paint(obj, float(paint))
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
    return obj


def box(name, center, size, paint, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(obj, paint, bevel)


def cylinder(name, center, radius, length, axis, paint, vertices=16, bevel=0.0):
    rotation = {"x": (0, math.pi / 2, 0), "y": (math.pi / 2, 0, 0), "z": (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=length, location=center, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    return finish(obj, paint, bevel)


def roof():
    """An arched roof slab: a flat underside at z 6.95 and a crown at z 7.55, extruded along X."""
    mesh = bmesh.new()
    steps = 14
    arch = [
        (-HALF_DEPTH + 2 * HALF_DEPTH * i / steps, 7.2 + 0.35 * (1 - (-1 + 2 * i / steps) ** 2))
        for i in range(steps + 1)
    ]
    verts = [mesh.verts.new((-HALF_LENGTH, y, z)) for y, z in arch]
    verts += [mesh.verts.new((-HALF_LENGTH, y, 6.95)) for y in (HALF_DEPTH, -HALF_DEPTH)]
    face = mesh.faces.new(verts)
    extruded = bmesh.ops.extrude_face_region(mesh, geom=[face])
    bmesh.ops.translate(mesh, verts=[v for v in extruded["geom"] if isinstance(v, bmesh.types.BMVert)], vec=(2 * HALF_LENGTH, 0, 0))
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces)
    data = bpy.data.meshes.new("roof")
    mesh.to_mesh(data)
    mesh.free()
    return finish(link_object("roof", data, bpy.data.materials["paint"]), CREAM, 0.0)


def cut_doors(target):
    """Recesses a 1.4 wide door opening, 0.3 deep, into both sides of the object at x 0."""
    for side in (-1, 1):
        cutter = box("cutter", (0, side * 3.1, 4.7), (1.4, 0.4, 3.2), BODY, 0.0)
        modifier = target.modifiers.new("door", "BOOLEAN")
        modifier.operation = "DIFFERENCE"
        modifier.object = cutter
        modifier.solver = "EXACT"
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier="door")
        bpy.data.objects.remove(cutter)


def track():
    for index in range(9):
        box(f"sleeper-{index}", (-18 + 4.5 * index, 0, 0.1), (0.8, 6.4, 0.2), WOOD, 0.02)
    for side in (-1, 1):
        box(f"rail-foot-{side}", (0, side * RAIL_Y, 0.25), (2 * HALF_LENGTH, 0.5, 0.1), STEEL, 0.015)
        box(f"rail-{side}", (0, side * RAIL_Y, 0.4), (2 * HALF_LENGTH, 0.3, 0.4), STEEL, 0.03)


def bogies():
    for x in (-14, -10, 10, 14):
        cylinder(f"axle-{x}", (x, 0, 1.6), 0.2, 2 * RAIL_Y + 0.2, "y", IRON, 12)
        for side in (-1, 1):
            cylinder(f"wheel-{x}-{side}", (x, side * RAIL_Y, 1.6), 0.9, 0.37, "y", IRON, 28, 0.03)
            cylinder(f"flange-{x}-{side}", (x, side * (RAIL_Y - 0.2), 1.6), 1.0, 0.1, "y", IRON, 28, 0.02)
            cylinder(f"hub-{x}-{side}", (x, side * (RAIL_Y + 0.3), 1.6), 0.35, 0.3, "y", BRASS, 16, 0.03)
    for x in (-12, 12):
        for side in (-1, 1):
            box(f"sideframe-{x}-{side}", (x, side * 2.2, 2.15), (6.2, 0.3, 0.5), IRON, 0.04)
        box(f"bolster-{x}", (x, 0, 2.15), (1.2, 4.6, 0.5), IRON, 0.04)


def underframe():
    box("deck", (0, 0, 2.7), (38, 5.2, 0.6), IRON, 0.1)
    for side in (-1, 1):
        box(f"beam-{side}", (0, side * 1.8, 2.05), (30, 0.4, 0.5), IRON, 0.04)
    for side in (-1, 1):
        box(f"beam-end-{side}", (side * 19.4, 0, 2.8), (0.4, 5.4, 0.6), IRON, 0.05)
        for y in (-1.9, 1.9):
            cylinder(f"buffer-stem-{side}-{y}", (side * 19.7, y, 2.8), 0.15, 0.6, "x", IRON, 10)
            cylinder(f"buffer-head-{side}-{y}", (side * 19.95, y, 2.8), 0.36, 0.1, "x", BRASS, 16, 0.02)
        cylinder(f"coupling-{side}", (side * 19.65, 0, 2.5), 0.12, 0.7, "x", IRON, 8)


def body():
    shell = box("body", (0, 0, 5.0), (38.4, 6.4, 4.0), BODY, 0.1)
    stripe = box("stripe", (0, 0, 3.3), (38.5, 6.5, 0.3), CREAM, 0.03)
    cut_doors(shell)
    cut_doors(stripe)
    for index in range(6):
        x = -15 + 6 * index
        for side in (-1, 1):
            box(f"window-frame-{index}-{side}", (x, side * 3.2, 5.5), (4.4, 0.1, 1.7), BODY, 0.02)
            box(f"glass-{index}-{side}", (x, side * 3.23, 5.5), (4.0, 0.08, 1.3), GLASS, 0.02)
            box(f"mullion-{index}-{side}", (x, side * 3.26, 5.5), (0.12, 0.06, 1.3), BODY, 0.01)
    for side in (-1, 1):
        for leaf in (-1, 1):
            box(f"door-{side}-{leaf}", (leaf * 0.31, side * 2.98, 4.7), (0.6, 0.12, 3.0), DOOR, 0.02)
            box(f"door-glass-{side}-{leaf}", (leaf * 0.31, side * 3.05, 5.4), (0.4, 0.08, 1.0), GLASS, 0.01)
        box(f"door-step-{side}", (0, side * 3.05, 3.15), (1.4, 0.3, 0.1), BRASS, 0.02)
    for end in (-1, 1):
        box(f"end-door-{end}", (end * 19.25, 0, 4.5), (0.1, 2.2, 3.0), DOOR, 0.02)
        box(f"end-glass-{end}", (end * 19.3, 0, 5.2), (0.1, 1.4, 1.0), GLASS, 0.02)
        for y in (-1.3, 1.3):
            cylinder(f"grab-{end}-{y}", (end * 19.27, y, 4.5), 0.07, 2.4, "z", BRASS, 8)


def roofline():
    roof()
    box("walkway", (0, 0, 7.6), (34, 0.8, 0.1), IRON, 0.02)
    for x in (-9, 0, 9):
        cylinder(f"vent-{x}", (x, 0, 7.625), 0.4, 0.35, "z", IRON, 16, 0.03)


def join_car():
    """Converts every part to mesh in world space and joins them into one object, as one MeshPart."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    car = bpy.context.active_object
    car.name = "train-car"
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return car


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
paint = paint_material()
track()
bogies()
underframe()
body()
roofline()
car = join_car()
car.data.materials.clear()
car.data.materials.append(paint)
size = [max(v.co[i] for v in car.data.vertices) - min(v.co[i] for v in car.data.vertices) for i in range(3)]
print("train-car triangles", triangle_count(car), "size", [round(s, 3) for s in size])
unwrap([car])
bake([car], [paint], "train-car")
export_glb([car], "train-car")
