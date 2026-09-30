"""Builds a hero prop from its recipe and exports it as a GLB.

Run headless: blender -b --factory-startup --python-exit-code 1 -P generate-hero-prop.py -- <input.json> <output.glb>

The input holds `parts` (the preset recipe's parts, in studs) and `roles` (surface role -> sRGB hex color).
One object per role, named after it, joins that role's parts and carries a material of the same name.
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


ADD_SHAPE = {"box": add_box, "cylinder": add_cylinder, "profile": add_profile}


def join_parts(parts):
    mesh = bmesh.new()
    for part in parts:
        verts, transform = ADD_SHAPE[part["shape"]](mesh, part)
        center = part["center"]
        placement = Matrix.Translation(blender_point(center["x"], center["y"], center["z"])) @ transform
        bmesh.ops.transform(mesh, matrix=placement, verts=verts)
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
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(role, data))


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
