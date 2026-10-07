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

HALF_LENGTH = 26.0
HALF_DEPTH = 4.2  # the roof's half width; the footboards reach 4.3
SIDE_Y = 3.9  # the body's side faces
WHEEL_Y = 2.85  # the gauge, 5.7 apart
WHEEL_Z = 1.5  # flange radius 1.5, so the flanges touch z 0
SPRING_LEAF = 0.35 / 3  # three leaves fill the 0.35 between the axlebox top (2.1) and the sideframe underside (2.45)
DECK_Z = 4.0  # the underframe's centre; the body stands on its top face at 4.4
BODY_TOP = 11.0
BODY_LENGTH = 50.4
PITCH = 6.0
COMPARTMENTS = round((BODY_LENGTH - 2.4) / PITCH)

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
    return finish(link_object("roof", data, bpy.data.materials["paint"]), CREAM, 0.0)


def strip_box(name, center, size, paint):
    """A small unbevelled part: lining, glass, handles and hinges stay cheap in triangles."""
    return box(name, center, size, paint, 0.0)


def lining(name, x0, x1, z0, z1, side):
    """A gold lining rectangle 0.06 wide, standing 0.04 proud of the body side."""
    y = side * (SIDE_Y + 0.02)
    for index, z in enumerate((z0, z1)):
        strip_box(f"{name}-h{index}", ((x0 + x1) / 2, y, z), (x1 - x0 + 0.06, 0.04, 0.06), LINING)
    for index, x in enumerate((x0, x1)):
        strip_box(f"{name}-v{index}", (x, y, (z0 + z1) / 2), (0.06, 0.04, z1 - z0), LINING)


def compartment_x(index):
    return -PITCH * (COMPARTMENTS - 1) / 2 + PITCH * index


def bogies():
    for bogie in (-16, 16):
        for side in (-1, 1):
            box(f"sideframe-{bogie}-{side}", (bogie, side * 3.35, 2.65), (8.0, 0.25, 0.4), IRON, 0.04)
        box(f"bolster-{bogie}", (bogie, 0, 3.225), (1.6, 6.7, 0.75), IRON, 0.04)
        for x in (bogie - 3, bogie + 3):
            cylinder(f"axle-{x}", (x, 0, WHEEL_Z), 0.3, 2 * WHEEL_Y + 0.8, "y", IRON, 12)
            for side in (-1, 1):
                cylinder(f"wheel-{x}-{side}", (x, side * WHEEL_Y, WHEEL_Z), 1.4, 0.45, "y", IRON, 28, 0.04)
                cylinder(f"flange-{x}-{side}", (x, side * (WHEEL_Y - 0.2), WHEEL_Z), 1.5, 0.12, "y", IRON, 28, 0.02)
                box(f"axlebox-{x}-{side}", (x, side * 3.35, WHEEL_Z + 0.1), (0.9, 0.4, 1.0), IRON, 0.05)
                cylinder(f"axlecap-{x}-{side}", (x, side * 3.58, WHEEL_Z + 0.1), 0.25, 0.06, "y", BRASS, 12)
                for leaf, length in enumerate((2.6, 2.0, 1.4)):
                    z = WHEEL_Z + 0.6 + SPRING_LEAF * (leaf + 0.5)
                    strip_box(f"spring-{x}-{side}-{leaf}", (x, side * 3.35, z), (length, 0.25, SPRING_LEAF), STEEL)


def underframe():
    box("deck", (0, 0, DECK_Z), (50, 7.6, 0.8), IRON, 0.1)
    for side in (-1, 1):
        box(f"solebar-{side}", (0, side * 3.8, DECK_Z), (50.4, 0.2, 0.8), IRON, 0.04)
        box(f"footboard-{side}", (0, side * 4.1, DECK_Z), (48, 0.4, 0.1), WOOD, 0.02)
        for index in range(COMPARTMENTS + 1):
            x = -PITCH * COMPARTMENTS / 2 + PITCH * index
            strip_box(f"footboard-bracket-{side}-{index}", (x, side * 3.95, DECK_Z - 0.2), (0.1, 0.7, 0.3), IRON)
    for end in (-1, 1):
        box(f"headstock-{end}", (end * 25.4, 0, DECK_Z), (0.4, 7.6, 0.8), IRON, 0.05)
        for y in (-2.6, 2.6):
            box(f"buffer-plate-{end}-{y}", (end * 25.66, y, DECK_Z), (0.12, 1.0, 1.0), IRON, 0.03)
            cylinder(f"buffer-sleeve-{end}-{y}", (end * 25.78, y, DECK_Z), 0.4, 0.12, "x", IRON, 16, 0.02)
            cylinder(f"buffer-ram-{end}-{y}", (end * 25.89, y, DECK_Z), 0.22, 0.1, "x", STEEL, 12)
            cylinder(f"buffer-head-{end}-{y}", (end * 25.95, y, DECK_Z), 0.65, 0.1, "x", STEEL, 20, 0.02)
        box(f"hook-{end}", (end * 25.72, 0, DECK_Z - 0.1), (0.4, 0.2, 0.4), IRON, 0.03)
        cylinder(f"coupling-screw-{end}", (end * 25.85, 0, DECK_Z - 0.3), 0.1, 0.3, "x", IRON, 8)


def compartment_side(index, side):
    cx = compartment_x(index)
    y = side * SIDE_Y
    # The hinged door: a slightly proud leaf with a droplight, a lined lower panel, hinges and two handles.
    box(f"door-{index}-{side}", (cx, y + side * 0.04, 7.3), (2.1, 0.08, 5.2), DOOR, 0.02)
    strip_box(f"droplight-{index}-{side}", (cx, y + side * 0.09, 8.7), (1.4, 0.05, 1.3), GLASS)
    lining(f"door-lining-{index}-{side}", cx - 0.85, cx + 0.85, 5.0, 7.6, side * 1.02)
    for z in (5.2, 9.4):
        strip_box(f"hinge-{index}-{side}-{z}", (cx - 0.98, y + side * 0.09, z), (0.16, 0.08, 0.35), IRON)
    cylinder(f"handle-boss-{index}-{side}", (cx + 0.8, y + side * 0.12, 7.2), 0.12, 0.12, "y", BRASS, 10)
    cylinder(f"handle-lever-{index}-{side}", (cx + 0.58, y + side * 0.17, 7.2), 0.07, 0.5, "x", BRASS, 8)
    cylinder(f"grab-{index}-{side}", (cx + 1.2, y + side * 0.17, 7.2), 0.07, 1.8, "z", BRASS, 8)
    for z in (6.4, 8.0):
        strip_box(f"grab-stay-{index}-{side}-{z}", (cx + 1.2, y + side * 0.09, z), (0.08, 0.16, 0.08), BRASS)
    # A quarter light either side of the door, each panel lined above and below the waist.
    for offset in (-2.1, 2.1):
        x = cx + offset
        strip_box(f"frame-{index}-{side}-{offset}", (x, y + side * 0.03, 8.4), (1.4, 0.06, 2.4), DOOR)
        strip_box(f"glass-{index}-{side}-{offset}", (x, y + side * 0.05, 8.4), (1.2, 0.06, 2.0), GLASS)
        lining(f"upper-{index}-{side}-{offset}", x - 0.78, x + 0.78, 7.0, 9.8, side)
        lining(f"lower-{index}-{side}-{offset}", x - 0.78, x + 0.78, 4.8, 6.8, side)


def body():
    box("body", (0, 0, (DECK_Z + 0.4 + BODY_TOP) / 2), (BODY_LENGTH, 2 * SIDE_Y, BODY_TOP - DECK_Z - 0.4), BODY, 0.1)
    for side in (-1, 1):
        for index in range(COMPARTMENTS):
            compartment_side(index, side)
        for rail, z in enumerate((4.6, 10.7)):
            strip_box(f"rail-lining-{side}-{rail}", (0, side * (SIDE_Y + 0.02), z), (48.6, 0.04, 0.06), LINING)
    for end in (-1, 1):
        box(f"end-door-{end}", (end * 25.25, 0, 7.3), (0.1, 3.0, 5.2), DOOR, 0.02)
        box(f"end-glass-{end}", (end * 25.3, 0, 8.9), (0.1, 2.0, 1.6), GLASS, 0.02)
        for y in (-1.8, 1.8):
            cylinder(f"end-grab-{end}-{y}", (end * 25.27, y, 7.3), 0.09, 4.0, "z", BRASS, 8)
        for y in (-3.2, 3.2):
            strip_box(f"end-lamp-{end}-{y}", (end * 25.3, y, 10.2), (0.2, 0.4, 0.5), IRON)


def roofline():
    roof()
    for side in (-1, 1):
        strip_box(f"rain-strip-{side}", (0, side * 4.0, 11.5), (51, 0.12, 0.12), IRON)
    for index in range(COMPARTMENTS):
        x = compartment_x(index)
        cylinder(f"vent-stem-{index}", (x, 0, 12.025), 0.3, 0.35, "z", IRON, 12)
        cylinder(f"vent-cap-{index}", (x, 0, 12.35), 0.55, 0.3, "z", IRON, 16, 0.03)


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
