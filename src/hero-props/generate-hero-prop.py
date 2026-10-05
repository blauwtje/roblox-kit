"""Builds a hero prop from its recipe and exports it as a GLB.

Run headless: blender -b --factory-startup --python-exit-code 1 -P generate-hero-prop.py -- <input.json> <output.glb>

The input holds `parts` (the preset recipe's parts, in studs) and `roles` (surface role -> sRGB hex color).
One object per role, named after it, joins that role's parts and carries a material of the same name.
A part is built in this order: its shape (box, cylinder, lathe, profile or sweep), its `bevel`, its `cuts`
(boxes subtracted from it) and its `array` (copies at a fixed step). Each role's object is shaded smooth with
weighted normals, so the bevels catch light while the large faces stay flat.
The parts have no randomness, so the recipe alone fixes the mesh. Recipe axes are x across, y up, z along
the depth; Blender is Z up and the glTF exporter turns it into Y up, so recipe (x, y, z) is Blender (x, -z, y).
"""

import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

CYLINDER_SEGMENTS = 16
BEVEL_SEGMENTS = 2

# Turns a cylinder's default Blender Z axis (the recipe's y axis) onto the recipe axis.
CYLINDER_AXIS_ROTATIONS = {
    "x": Matrix.Rotation(math.radians(90), 4, "Y"),
    "y": Matrix.Identity(4),
    "z": Matrix.Rotation(math.radians(90), 4, "X"),
}


def blender_point(x, y, z):
    return Vector((x, -z, y))


def add_box(mesh, part):
    """A box of the part's width, height and depth, centered on the origin."""
    size = part["size"]
    verts = bmesh.ops.create_cube(mesh, size=1.0)["verts"]
    return verts, Matrix.Diagonal((size["width"], size["depth"], size["height"], 1.0))


def add_cylinder(mesh, part):
    """A capped cylinder along the part's axis, centered on the origin."""
    verts = bmesh.ops.create_cone(
        mesh,
        cap_ends=True,
        segments=CYLINDER_SEGMENTS,
        radius1=part["radius"],
        radius2=part["radius"],
        depth=part["length"],
    )["verts"]
    return verts, CYLINDER_AXIS_ROTATIONS[part["axis"]]


def add_profile(mesh, part):
    """The polygon of `points` (offsets from the center) extruded `depth` along z, centered on the origin."""
    half_depth = part["depth"] / 2
    points = [(point["x"], point["y"]) for point in part["points"]]
    front = [mesh.verts.new(blender_point(x, y, -half_depth)) for x, y in points]
    back = [mesh.verts.new(blender_point(x, y, half_depth)) for x, y in points]
    mesh.faces.new(front)
    mesh.faces.new(back)
    for index in range(len(points)):
        following = (index + 1) % len(points)
        mesh.faces.new((front[index], front[following], back[following], back[index]))
    return front + back, Matrix.Identity(4)


def add_lathe(mesh, part):
    """The ring `points` (radius, offset along the axis) revolved once around the part's axis, centered on the origin."""
    ring = [mesh.verts.new((point["radius"], 0, point["offset"])) for point in part["points"]]
    edges = [mesh.edges.new((ring[index], ring[(index + 1) % len(ring)])) for index in range(len(ring))]
    bmesh.ops.spin(
        mesh,
        geom=ring + edges,
        cent=(0, 0, 0),
        axis=(0, 0, 1),
        dvec=(0, 0, 0),
        angle=math.radians(360),
        steps=part.get("segments", CYLINDER_SEGMENTS),
        use_merge=True,
        use_duplicate=False,
    )
    return list(mesh.verts), CYLINDER_AXIS_ROTATIONS[part["axis"]]


def add_sweep(mesh, part):
    """The closed polygon `section` (x across, y up) swept along `path` (offsets from the center).

    Each ring faces the average of its neighbours' directions, so a sharp corner narrows the sweep there;
    soften the path with more points to keep the width.
    """
    path = [Vector((point["x"], point["y"], point["z"])) for point in part["path"]]
    section = part["section"]
    rings = []
    for index, point in enumerate(path):
        tangent = (path[min(index + 1, len(path) - 1)] - path[max(index - 1, 0)]).normalized()
        turn = Vector((0, 0, 1)).rotation_difference(tangent)
        ring = []
        for corner in section:
            offset = point + turn @ Vector((corner["x"], corner["y"], 0))
            ring.append(mesh.verts.new(blender_point(offset.x, offset.y, offset.z)))
        rings.append(ring)
    mesh.faces.new(rings[0])
    mesh.faces.new(rings[-1])
    for ring, following in zip(rings, rings[1:]):
        for index in range(len(section)):
            after = (index + 1) % len(section)
            mesh.faces.new((ring[index], ring[after], following[after], following[index]))
    return [vert for ring in rings for vert in ring], Matrix.Identity(4)


ADD_SHAPE = {
    "box": add_box,
    "cylinder": add_cylinder,
    "lathe": add_lathe,
    "profile": add_profile,
    "sweep": add_sweep,
}


def bevel_piece(piece, width):
    bmesh.ops.bevel(
        piece,
        geom=list(piece.edges),
        offset=width,
        offset_type="OFFSET",
        segments=BEVEL_SEGMENTS,
        affect="EDGES",
    )


def cut_piece(data, part):
    """Subtracts the part's `cuts` boxes from the mesh `data` with an exact boolean and returns the result."""
    center = part["center"]
    carrier = bpy.data.objects.new("cut-carrier", data)
    bpy.context.scene.collection.objects.link(carrier)
    cutters = []
    for cut in part["cuts"]:
        offset = cut["center"]
        size = cut["size"]
        cutter_mesh = bmesh.new()
        verts = bmesh.ops.create_cube(cutter_mesh, size=1.0)["verts"]
        bmesh.ops.transform(
            cutter_mesh,
            matrix=Matrix.Translation(
                blender_point(center["x"] + offset["x"], center["y"] + offset["y"], center["z"] + offset["z"])
            )
            @ Matrix.Diagonal((size["width"], size["depth"], size["height"], 1.0)),
            verts=verts,
        )
        cutter_data = bpy.data.meshes.new("cutter")
        cutter_mesh.to_mesh(cutter_data)
        cutter_mesh.free()
        cutter = bpy.data.objects.new("cutter", cutter_data)
        bpy.context.scene.collection.objects.link(cutter)
        modifier = carrier.modifiers.new("cut", "BOOLEAN")
        modifier.operation = "DIFFERENCE"
        modifier.solver = "EXACT"
        modifier.object = cutter
        cutters.append(cutter)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    result = bpy.data.meshes.new_from_object(carrier.evaluated_get(depsgraph))
    for cutter in cutters:
        bpy.data.objects.remove(cutter)
    bpy.data.objects.remove(carrier)
    return result


def add_part(mesh, part):
    """Builds one part into `mesh`: shape, bevel, cuts, then the array copies."""
    piece = bmesh.new()
    verts, transform = ADD_SHAPE[part["shape"]](piece, part)
    center = part["center"]
    placement = Matrix.Translation(blender_point(center["x"], center["y"], center["z"])) @ transform
    bmesh.ops.transform(piece, matrix=placement, verts=verts)
    if "bevel" in part:
        bevel_piece(piece, part["bevel"])
    data = bpy.data.meshes.new("piece")
    piece.to_mesh(data)
    piece.free()
    if "cuts" in part:
        data = cut_piece(data, part)
    array = part.get("array", {"count": 1, "step": {"x": 0, "y": 0, "z": 0}})
    step = array["step"]
    for copy in range(array["count"]):
        first = len(mesh.verts)
        mesh.from_mesh(data)
        mesh.verts.ensure_lookup_table()
        shift = Matrix.Translation(blender_point(step["x"] * copy, step["y"] * copy, step["z"] * copy))
        bmesh.ops.transform(mesh, matrix=shift, verts=list(mesh.verts)[first:])
    bpy.data.meshes.remove(data)


def join_parts(parts):
    mesh = bmesh.new()
    for part in parts:
        add_part(mesh, part)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return mesh


def srgb_channel_to_linear(value):
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def role_material(role, hex_color):
    material = bpy.data.materials.new(role)
    material.use_nodes = True
    digits = hex_color.lstrip("#")
    channels = [int(digits[index : index + 2], 16) / 255 for index in (0, 2, 4)]
    linear = [srgb_channel_to_linear(channel) for channel in channels] + [1.0]
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = linear
    return material


def add_role_object(role, parts, hex_color):
    mesh = join_parts(parts)
    data = bpy.data.meshes.new(role)
    mesh.to_mesh(data)
    mesh.free()
    data.materials.append(role_material(role, hex_color))
    data.shade_smooth()
    role_object = bpy.data.objects.new(role, data)
    bpy.context.scene.collection.objects.link(role_object)
    role_object.modifiers.new("weighted-normals", "WEIGHTED_NORMAL").keep_sharp = True
    shaded = bpy.data.meshes.new_from_object(role_object.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    role_object.modifiers.clear()
    role_object.data = shaded
    bpy.data.meshes.remove(data)
    shaded.name = role


def main():
    input_path, output_path = sys.argv[sys.argv.index("--") + 1 :]
    with open(input_path) as handle:
        recipe = json.load(handle)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts_by_role = {}
    for part in recipe["parts"]:
        parts_by_role.setdefault(part["role"], []).append(part)
    for role in sorted(parts_by_role):
        add_role_object(role, parts_by_role[role], recipe["roles"][role])
    bpy.ops.export_scene.gltf(filepath=output_path, export_format="GLB", export_yup=True)


main()
