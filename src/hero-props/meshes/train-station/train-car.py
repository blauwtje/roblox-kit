"""Station train car: a green period compartment carriage with a lit amber window band, on its own wheels.

Blender units = studs, Z up (glTF/Roblox Y up). The car runs along X and is centered on x and y with the wheel
flanges on z 0, so its bounds are the kit train car's 40 x 7 x 7.8 (X, Y, Z) and an `anchor: "bottom"` fit
leaves it unscaled. It carries no rails or sleepers: the kit track bed's rails sit 2.5 studs apart (half its
5 stud depth) and this car's wheels 5.7 apart, so model rails could not line up with them. Eight compartments
a side, each a hinged door (droplight, brass lever handle, grab handle, hinges) between two quarter lights,
under gold panel lining on the green body; a footboard; an arched roof with rain strips and one torpedo vent
per compartment; four wheel sets in bogies with axle boxes and leaf springs; sprung buffers and a screw
coupling at each end. Every part is one paint material switched by a "paint" attribute, joined into one mesh,
unwrapped and baked to color (with occlusion grime), roughness, metalness and tangent normal maps by
`shared.py`. The windows are only amber paint: a SurfaceAppearance has no emission.
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
SIDE_Y = 3.2  # the body's side faces
WHEEL_Y = 2.85
WHEEL_Z = 1.0  # flange radius 1.0, so the flanges touch z 0
COMPARTMENTS = 8
PITCH = 4.6

BODY, CREAM, GLASS, IRON, BRASS, STEEL, WOOD, DOOR, LINING = range(9)
# (two tone-ramp stops, roughness, metalness) per paint value.
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


def strip_box(name, center, size, paint):
    """A small unbevelled part: lining, glass, handles and hinges stay cheap in triangles."""
    return box(name, center, size, paint, 0.0)


def lining(name, x0, x1, z0, z1, side):
    """A gold lining rectangle 0.05 wide, standing 0.03 proud of the body side."""
    y = side * (SIDE_Y + 0.015)
    for index, z in enumerate((z0, z1)):
        strip_box(f"{name}-h{index}", ((x0 + x1) / 2, y, z), (x1 - x0 + 0.05, 0.03, 0.05), LINING)
    for index, x in enumerate((x0, x1)):
        strip_box(f"{name}-v{index}", (x, y, (z0 + z1) / 2), (0.05, 0.03, z1 - z0), LINING)


def bogies():
    for bogie in (-12, 12):
        for side in (-1, 1):
            box(f"sideframe-{bogie}-{side}", (bogie, side * 3.25, 1.85), (6.2, 0.2, 0.3), IRON, 0.04)
        box(f"bolster-{bogie}", (bogie, 0, 2.15), (1.2, 6.3, 0.5), IRON, 0.04)
        for x in (bogie - 2, bogie + 2):
            cylinder(f"axle-{x}", (x, 0, WHEEL_Z), 0.2, 2 * WHEEL_Y + 0.6, "y", IRON, 12)
            for side in (-1, 1):
                cylinder(f"wheel-{x}-{side}", (x, side * WHEEL_Y, WHEEL_Z), 0.9, 0.37, "y", IRON, 28, 0.03)
                cylinder(f"flange-{x}-{side}", (x, side * (WHEEL_Y - 0.2), WHEEL_Z), 1.0, 0.1, "y", IRON, 28, 0.02)
                box(f"axlebox-{x}-{side}", (x, side * 3.25, WHEEL_Z + 0.1), (0.6, 0.3, 0.7), IRON, 0.05)
                cylinder(f"axlecap-{x}-{side}", (x, side * 3.42, WHEEL_Z + 0.1), 0.18, 0.04, "y", BRASS, 12)
                for leaf, length in enumerate((1.8, 1.4, 1.0)):
                    z = WHEEL_Z + 0.5 + 0.08 * leaf
                    strip_box(f"spring-{x}-{side}-{leaf}", (x, side * 3.25, z), (length, 0.18, 0.08), STEEL)


def underframe():
    box("deck", (0, 0, 2.7), (38, 5.2, 0.6), IRON, 0.1)
    for side in (-1, 1):
        box(f"solebar-{side}", (0, side * 2.9, 2.7), (38.4, 0.2, 0.6), IRON, 0.04)
        box(f"footboard-{side}", (0, side * 3.3, 2.72), (36.8, 0.3, 0.08), WOOD, 0.02)
        for index in range(COMPARTMENTS + 1):
            x = -PITCH * COMPARTMENTS / 2 + PITCH * index
            strip_box(f"footboard-bracket-{side}-{index}", (x, side * 3.15, 2.6), (0.08, 0.5, 0.2), IRON)
    for end in (-1, 1):
        box(f"headstock-{end}", (end * 19.4, 0, 2.7), (0.4, 6.2, 0.6), IRON, 0.05)
        for y in (-1.9, 1.9):
            box(f"buffer-plate-{end}-{y}", (end * 19.66, y, 2.7), (0.12, 0.7, 0.7), IRON, 0.03)
            cylinder(f"buffer-sleeve-{end}-{y}", (end * 19.78, y, 2.7), 0.28, 0.12, "x", IRON, 16, 0.02)
            cylinder(f"buffer-ram-{end}-{y}", (end * 19.89, y, 2.7), 0.16, 0.1, "x", STEEL, 12)
            cylinder(f"buffer-head-{end}-{y}", (end * 19.95, y, 2.7), 0.45, 0.1, "x", STEEL, 20, 0.02)
        box(f"hook-{end}", (end * 19.72, 0, 2.6), (0.4, 0.15, 0.3), IRON, 0.03)
        cylinder(f"coupling-screw-{end}", (end * 19.85, 0, 2.5), 0.07, 0.3, "x", IRON, 8)


def compartment_side(index, side):
    cx = -PITCH * (COMPARTMENTS - 1) / 2 + PITCH * index
    y = side * SIDE_Y
    # The hinged door: a slightly proud leaf with a droplight, a lined lower panel, hinges and two handles.
    box(f"door-{index}-{side}", (cx, y + side * 0.03, 4.85), (1.3, 0.06, 3.4), DOOR, 0.02)
    strip_box(f"droplight-{index}-{side}", (cx, y + side * 0.07, 5.85), (0.8, 0.04, 0.95), GLASS)
    lining(f"door-lining-{index}-{side}", cx - 0.5, cx + 0.5, 3.4, 4.9, side * 1.02)
    for z in (3.6, 6.0):
        strip_box(f"hinge-{index}-{side}-{z}", (cx - 0.62, y + side * 0.07, z), (0.12, 0.06, 0.25), IRON)
    cylinder(f"handle-boss-{index}-{side}", (cx + 0.5, y + side * 0.09, 4.95), 0.08, 0.1, "y", BRASS, 10)
    cylinder(f"handle-lever-{index}-{side}", (cx + 0.38, y + side * 0.13, 4.95), 0.045, 0.3, "x", BRASS, 8)
    cylinder(f"grab-{index}-{side}", (cx + 0.735, y + side * 0.13, 4.6), 0.05, 1.0, "z", BRASS, 8)
    for z in (4.15, 5.05):
        strip_box(f"grab-stay-{index}-{side}-{z}", (cx + 0.735, y + side * 0.07, z), (0.06, 0.12, 0.06), BRASS)
    # A quarter light either side of the door, each panel lined above and below the waist.
    for offset in (-1.5, 1.5):
        x = cx + offset
        strip_box(f"frame-{index}-{side}-{offset}", (x, y + side * 0.02, 5.75), (1.28, 0.05, 1.45), DOOR)
        strip_box(f"glass-{index}-{side}-{offset}", (x, y + side * 0.04, 5.75), (1.1, 0.05, 1.25), GLASS)
        lining(f"upper-{index}-{side}-{offset}", x - 0.68, x + 0.68, 4.95, 6.65, side)
        lining(f"lower-{index}-{side}-{offset}", x - 0.68, x + 0.68, 3.3, 4.75, side)


def body():
    box("body", (0, 0, 5.0), (38.4, 6.4, 4.0), BODY, 0.1)
    for side in (-1, 1):
        for index in range(COMPARTMENTS):
            compartment_side(index, side)
        for rail, z in enumerate((3.12, 6.82)):
            strip_box(f"rail-lining-{side}-{rail}", (0, side * (SIDE_Y + 0.015), z), (37.2, 0.03, 0.05), LINING)
    for end in (-1, 1):
        box(f"end-door-{end}", (end * 19.25, 0, 4.5), (0.1, 2.2, 3.0), DOOR, 0.02)
        box(f"end-glass-{end}", (end * 19.3, 0, 5.2), (0.1, 1.4, 1.0), GLASS, 0.02)
        for y in (-1.3, 1.3):
            cylinder(f"end-grab-{end}-{y}", (end * 19.27, y, 4.5), 0.07, 2.4, "z", BRASS, 8)
        for y in (-2.4, 2.4):
            strip_box(f"end-lamp-{end}-{y}", (end * 19.3, y, 6.5), (0.2, 0.3, 0.35), IRON)


def roofline():
    roof()
    for side in (-1, 1):
        strip_box(f"rain-strip-{side}", (0, side * 3.3, 7.26), (39, 0.08, 0.08), IRON)
    for index in range(COMPARTMENTS):
        x = -PITCH * (COMPARTMENTS - 1) / 2 + PITCH * index
        cylinder(f"vent-stem-{index}", (x, 0, 7.6), 0.2, 0.2, "z", IRON, 12)
        cylinder(f"vent-cap-{index}", (x, 0, 7.75), 0.36, 0.1, "z", IRON, 16, 0.03)


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
