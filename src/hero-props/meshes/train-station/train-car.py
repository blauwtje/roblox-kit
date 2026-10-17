"""Station train car: a green period compartment carriage with a lit amber window band, on its own wheels.

Blender units = studs, Z up (glTF/Roblox Y up). The car runs along X and is centered on x and y with the wheel
flanges on z 0, so its bounds are 52 x 8.6 x 12.5 (X, Y, Z) and an `anchor: "bottom"` fit leaves it unscaled.
At 1 stud = 0.3 m that is a 15.6 m carriage whose roof stands about 12.7 studs above the rail head, about twice
a 5 to 6.5 stud avatar. It carries no rails or sleepers: the kit track bed's rails sit 2.5 studs apart (half its
5 stud depth) and this car's wheels 5.7 apart, so model rails could not line up with them. Eight compartments
a side, each a hinged door (droplight, brass lever handle, grab handle, hinges) between two quarter lights,
under gold panel lining on the green body; a footboard; an arched roof with rain strips and one torpedo vent
per compartment; four wheel sets in bogies with axle boxes and leaf springs; sprung buffers and a screw
coupling at each end. Every part is one paint material switched by a "paint" attribute, joined into one mesh,
unwrapped and baked to color (with occlusion grime), roughness, metalness and tangent normal maps by
`lib`. The windows are only amber paint: a SurfaceAppearance has no emission.
"""

import importlib
import math
import os
import sys
from typing import NamedTuple

import bmesh
import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
geometry = importlib.import_module("lib.geometry")
materials = importlib.import_module("lib.materials")
run = importlib.import_module("lib.run")

HALF_LENGTH = 26.0
HALF_DEPTH = 4.2
SIDE_Y = 3.9
WHEEL_Y = 2.85
WHEEL_Z = 1.5
SPRING_LEAF = 0.35 / 3
DECK_Z = 4.0
BODY_TOP = 11.0
BODY_LENGTH = 50.4
PITCH = 6.0
COMPARTMENTS = round((BODY_LENGTH - 2.4) / PITCH)

BODY, CREAM, GLASS, IRON, BRASS, STEEL, WOOD, DOOR, LINING = range(9)
PAINTS = [
    (("#264a37", "#2f5843"), 0.45, 0.0),
    (("#cdc2a8", "#e3dbc6"), 0.6, 0.0),
    (("#e8a73c", "#f6c565"), 0.15, 0.0),
    (("#25221f", "#312c27"), 0.7, 0.5),
    (("#a8803a", "#c49a4c"), 0.35, 0.6),
    (("#7a756d", "#97928a"), 0.4, 0.6),
    (("#4d3c2a", "#6a543a"), 0.9, 0.0),
    (("#20402f", "#29503b"), 0.45, 0.0),
    (("#c09a46", "#d6b462"), 0.4, 0.3),
]


class Block(NamedTuple):
    center: tuple
    size: tuple
    bevel: float = 0.03


class Cylinder(NamedTuple):
    center: tuple
    radius: float
    length: float
    axis: str
    vertices: int = 16
    bevel: float = 0.0


def paint_material():
    material = bpy.data.materials.new("paint")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    attribute = nodes.new("ShaderNodeAttribute")
    attribute.attribute_name = "paint"
    patch = materials.noise(tree, coords, (2.5, 6.0))
    color = roughness = metalness = None
    for value, (stops, rough, metal) in enumerate(PAINTS):
        tone = materials.ramp_node(nodes, [(0.3, stops[0]), (0.7, stops[1])])
        links.new(patch, tone.inputs["Fac"])
        if value == 0:
            color, roughness, metalness = tone.outputs["Color"], rough, metal
            continue
        mask = materials.math_node(tree, "COMPARE", (attribute.outputs["Fac"], float(value), 0.5))
        color = materials.mix_color(tree, "MIX", (mask, color, tone.outputs["Color"]))
        roughness = materials.mix_float(tree, (mask, roughness, rough))
        metalness = materials.mix_float(tree, (mask, metalness, metal))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.6
    grime = materials.ramp_node(nodes, [(0.0, "#6a6258"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime.inputs["Fac"])
    color = materials.mix_color(tree, "MULTIPLY", (1.0, color, grime.outputs["Color"]))
    links.new(color, bsdf.inputs["Base Color"])
    links.new(roughness, bsdf.inputs["Roughness"])
    links.new(metalness, bsdf.inputs["Metallic"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    bump.inputs["Distance"].default_value = 0.02
    links.new(materials.noise(tree, coords, (25.0, 4.0)), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def block(name, shape, paint):
    box = geometry.Box(shape.size, shape.center[2] - shape.size[2] / 2, shape.bevel, shape.center[:2], 1)
    return geometry.box(name, box, materials.Surface(bpy.data.materials["paint"], float(paint)))


def cylinder(name, shape, paint):
    rotation = {"x": (0, math.pi / 2, 0), "y": (math.pi / 2, 0, 0), "z": (0, 0, 0)}[shape.axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=shape.vertices, radius=shape.radius, depth=shape.length, location=shape.center, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    materials.mark_paint(obj, float(paint))
    if shape.bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = shape.bevel
        modifier.segments = 1
    return obj


def roof():
    """An arched roof slab: a flat underside at z 11.0 and a crown at z 12.0, extruded along X."""
    mesh = bmesh.new()
    steps = 14
    arch = [
        (-HALF_DEPTH + 2 * HALF_DEPTH * i / steps, 11.4 + 0.6 * (1 - (-1 + 2 * i / steps) ** 2))
        for i in range(steps + 1)
    ]
    verts = [mesh.verts.new((-HALF_LENGTH, y, z)) for y, z in arch]
    verts += [mesh.verts.new((-HALF_LENGTH, y, BODY_TOP)) for y in (HALF_DEPTH, -HALF_DEPTH)]
    face = mesh.faces.new(verts)
    extruded = bmesh.ops.extrude_face_region(mesh, geom=[face])
    bmesh.ops.translate(mesh, verts=[v for v in extruded["geom"] if isinstance(v, bmesh.types.BMVert)], vec=(2 * HALF_LENGTH, 0, 0))
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces)
    data = bpy.data.meshes.new("roof")
    mesh.to_mesh(data)
    mesh.free()
    obj = materials.link_object("roof", data, bpy.data.materials["paint"])
    materials.mark_paint(obj, float(CREAM))
    return obj


def lining(name, span, side):
    """A gold lining rectangle 0.06 wide, standing 0.04 proud of the body side."""
    x0, x1, z0, z1 = span
    y = side * (SIDE_Y + 0.02)
    for index, z in enumerate((z0, z1)):
        block(f"{name}-h{index}", Block(((x0 + x1) / 2, y, z), (x1 - x0 + 0.06, 0.04, 0.06), 0.0), LINING)
    for index, x in enumerate((x0, x1)):
        block(f"{name}-v{index}", Block((x, y, (z0 + z1) / 2), (0.06, 0.04, z1 - z0), 0.0), LINING)


def compartment_x(index):
    return -PITCH * (COMPARTMENTS - 1) / 2 + PITCH * index


def spring_leaves(x, side):
    for leaf, length in enumerate((2.6, 2.0, 1.4)):
        z = WHEEL_Z + 0.6 + SPRING_LEAF * (leaf + 0.5)
        block(f"spring-{x}-{side}-{leaf}", Block((x, side * 3.35, z), (length, 0.25, SPRING_LEAF), 0.0), STEEL)


def wheel_side(x, side):
    cylinder(f"wheel-{x}-{side}", Cylinder((x, side * WHEEL_Y, WHEEL_Z), 1.4, 0.45, "y", 28, 0.04), IRON)
    cylinder(f"flange-{x}-{side}", Cylinder((x, side * (WHEEL_Y - 0.2), WHEEL_Z), 1.5, 0.12, "y", 28, 0.02), IRON)
    block(f"axlebox-{x}-{side}", Block((x, side * 3.35, WHEEL_Z + 0.1), (0.9, 0.4, 1.0), 0.05), IRON)
    cylinder(f"axlecap-{x}-{side}", Cylinder((x, side * 3.58, WHEEL_Z + 0.1), 0.25, 0.06, "y", 12), BRASS)
    spring_leaves(x, side)


def wheel_set(x):
    cylinder(f"axle-{x}", Cylinder((x, 0, WHEEL_Z), 0.3, 2 * WHEEL_Y + 0.8, "y", 12), IRON)
    for side in (-1, 1):
        wheel_side(x, side)


def bogies():
    for bogie in (-16, 16):
        for side in (-1, 1):
            block(f"sideframe-{bogie}-{side}", Block((bogie, side * 3.35, 2.65), (8.0, 0.25, 0.4), 0.04), IRON)
        block(f"bolster-{bogie}", Block((bogie, 0, 3.225), (1.6, 6.7, 0.75), 0.04), IRON)
        for x in (bogie - 3, bogie + 3):
            wheel_set(x)


def underframe():
    block("deck", Block((0, 0, DECK_Z), (50, 7.6, 0.8), 0.1), IRON)
    for side in (-1, 1):
        block(f"solebar-{side}", Block((0, side * 3.8, DECK_Z), (50.4, 0.2, 0.8), 0.04), IRON)
        block(f"footboard-{side}", Block((0, side * 4.1, DECK_Z), (48, 0.4, 0.1), 0.02), WOOD)
        for index in range(COMPARTMENTS + 1):
            x = -PITCH * COMPARTMENTS / 2 + PITCH * index
            block(f"footboard-bracket-{side}-{index}", Block((x, side * 3.95, DECK_Z - 0.2), (0.1, 0.7, 0.3), 0.0), IRON)
    for end in (-1, 1):
        block(f"headstock-{end}", Block((end * 25.4, 0, DECK_Z), (0.4, 7.6, 0.8), 0.05), IRON)
        for y in (-2.6, 2.6):
            block(f"buffer-plate-{end}-{y}", Block((end * 25.66, y, DECK_Z), (0.12, 1.0, 1.0), 0.03), IRON)
            cylinder(f"buffer-sleeve-{end}-{y}", Cylinder((end * 25.78, y, DECK_Z), 0.4, 0.12, "x", 16, 0.02), IRON)
            cylinder(f"buffer-ram-{end}-{y}", Cylinder((end * 25.89, y, DECK_Z), 0.22, 0.1, "x", 12), STEEL)
            cylinder(f"buffer-head-{end}-{y}", Cylinder((end * 25.95, y, DECK_Z), 0.65, 0.1, "x", 20, 0.02), STEEL)
        block(f"hook-{end}", Block((end * 25.72, 0, DECK_Z - 0.1), (0.4, 0.2, 0.4), 0.03), IRON)
        cylinder(f"coupling-screw-{end}", Cylinder((end * 25.85, 0, DECK_Z - 0.3), 0.1, 0.3, "x", 8), IRON)


def compartment_side(index, side):
    cx = compartment_x(index)
    y = side * SIDE_Y
    block(f"door-{index}-{side}", Block((cx, y + side * 0.04, 7.3), (2.1, 0.08, 5.2), 0.02), DOOR)
    block(f"droplight-{index}-{side}", Block((cx, y + side * 0.09, 8.7), (1.4, 0.05, 1.3), 0.0), GLASS)
    lining(f"door-lining-{index}-{side}", (cx - 0.85, cx + 0.85, 5.0, 7.6), side * 1.02)
    for z in (5.2, 9.4):
        block(f"hinge-{index}-{side}-{z}", Block((cx - 0.98, y + side * 0.09, z), (0.16, 0.08, 0.35), 0.0), IRON)
    cylinder(f"handle-boss-{index}-{side}", Cylinder((cx + 0.8, y + side * 0.12, 7.2), 0.12, 0.12, "y", 10), BRASS)
    cylinder(f"handle-lever-{index}-{side}", Cylinder((cx + 0.58, y + side * 0.17, 7.2), 0.07, 0.5, "x", 8), BRASS)
    cylinder(f"grab-{index}-{side}", Cylinder((cx + 1.2, y + side * 0.17, 7.2), 0.07, 1.8, "z", 8), BRASS)
    for z in (6.4, 8.0):
        block(f"grab-stay-{index}-{side}-{z}", Block((cx + 1.2, y + side * 0.09, z), (0.08, 0.16, 0.08), 0.0), BRASS)
    for offset in (-2.1, 2.1):
        x = cx + offset
        block(f"frame-{index}-{side}-{offset}", Block((x, y + side * 0.03, 8.4), (1.4, 0.06, 2.4), 0.0), DOOR)
        block(f"glass-{index}-{side}-{offset}", Block((x, y + side * 0.05, 8.4), (1.2, 0.06, 2.0), 0.0), GLASS)
        lining(f"upper-{index}-{side}-{offset}", (x - 0.78, x + 0.78, 7.0, 9.8), side)
        lining(f"lower-{index}-{side}-{offset}", (x - 0.78, x + 0.78, 4.8, 6.8), side)


def body():
    block("body", Block((0, 0, (DECK_Z + 0.4 + BODY_TOP) / 2), (BODY_LENGTH, 2 * SIDE_Y, BODY_TOP - DECK_Z - 0.4), 0.1), BODY)
    for side in (-1, 1):
        for index in range(COMPARTMENTS):
            compartment_side(index, side)
        for rail, z in enumerate((4.6, 10.7)):
            block(f"rail-lining-{side}-{rail}", Block((0, side * (SIDE_Y + 0.02), z), (48.6, 0.04, 0.06), 0.0), LINING)
    for end in (-1, 1):
        block(f"end-door-{end}", Block((end * 25.25, 0, 7.3), (0.1, 3.0, 5.2), 0.02), DOOR)
        block(f"end-glass-{end}", Block((end * 25.3, 0, 8.9), (0.1, 2.0, 1.6), 0.02), GLASS)
        for y in (-1.8, 1.8):
            cylinder(f"end-grab-{end}-{y}", Cylinder((end * 25.27, y, 7.3), 0.09, 4.0, "z", 8), BRASS)
        for y in (-3.2, 3.2):
            block(f"end-lamp-{end}-{y}", Block((end * 25.3, y, 10.2), (0.2, 0.4, 0.5), 0.0), IRON)


def roofline():
    roof()
    for side in (-1, 1):
        block(f"rain-strip-{side}", Block((0, side * 4.0, 11.5), (51, 0.12, 0.12), 0.0), IRON)
    for index in range(COMPARTMENTS):
        x = compartment_x(index)
        cylinder(f"vent-stem-{index}", Cylinder((x, 0, 12.025), 0.3, 0.35, "z", 12), IRON)
        cylinder(f"vent-cap-{index}", Cylinder((x, 0, 12.35), 0.55, 0.3, "z", 16, 0.03), IRON)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    run.set_up_cycles()
    paint = paint_material()
    bogies()
    underframe()
    body()
    roofline()
    car = geometry.finish("train-car")
    car.data.materials.clear()
    car.data.materials.append(paint)
    run.finish_mesh("train-car", [car], paint)


if __name__ == "__main__":
    build()
