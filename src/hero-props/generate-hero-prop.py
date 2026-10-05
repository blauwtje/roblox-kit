"""Builds a hero prop from its recipe and exports it as a GLB.

Run headless: blender -b --factory-startup --python-exit-code 1 -P generate-hero-prop.py -- <input.json> <output.glb>

The input holds `parts` (the preset recipe's parts, in studs) and `roles` (surface role -> sRGB hex color).
One object per role, named after it, joins that role's parts and carries a material of the same name.
A part is built in this order: its shape (box, cylinder, lathe, profile or sweep), its `bevel`, its `cuts`
(boxes subtracted from it) and its `array` (copies at a fixed step). Each role's object is shaded smooth with
weighted normals, so the bevels catch light while the large faces stay flat.
Each role object is UV unwrapped and its material, a procedural one of noise, edge wear and ambient occlusion
over the role's color, is baked with Cycles to a color, a normal and an occlusion-roughness-metalness map
(green roughness, blue metalness, as glTF packs them), then replaced by a material reading those maps, so the
GLB carries the maps and Roblox loads them as a SurfaceAppearance (probe-glb-textures.ts found that it does).
The parts and the bake have no randomness (a fixed sample count), so the recipe alone fixes the mesh. Recipe axes are x across, y up, z along
the depth; Blender is Z up and the glTF exporter turns it into Y up, so recipe (x, y, z) is Blender (x, -z, y).
"""

import json
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

CYLINDER_SEGMENTS = 16
BEVEL_SEGMENTS = 2
MAP_SIZE = 512
BAKE_SAMPLES = 16
# Studs: the noise scale is one blotch per stud, wear reaches this far from an edge, occlusion this far from a corner.
NOISE_SCALE = 1.0
WEAR_RADIUS = 0.15
OCCLUSION_DISTANCE = 0.5

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


def group_operations(operations):
    """Folds the ordered operations into parts: each shape operation takes the cut and array operations after it."""
    parts = []
    for operation in operations:
        if operation["op"] == "cut":
            parts[-1].setdefault("cuts", []).append(operation)
        elif operation["op"] == "array":
            parts[-1]["array"] = operation
        else:
            parts.append(dict(operation, shape=operation["op"]))
    return parts


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


def role_color(hex_color):
    digits = hex_color.lstrip("#")
    channels = [int(digits[index : index + 2], 16) / 255 for index in (0, 2, 4)]
    return [srgb_channel_to_linear(channel) for channel in channels] + [1.0]


class MaterialGraph:
    """Adds nodes to one material's tree, so the procedural material below reads as a list of steps."""

    def __init__(self, material):
        material.use_nodes = True
        self.tree = material.node_tree
        self.tree.nodes.clear()

    def node(self, kind, **values):
        node = self.tree.nodes.new(kind)
        for name, value in values.items():
            setattr(node, name, value)
        return node

    def link(self, source, target, name):
        self.tree.links.new(source, target.inputs[name])

    def math(self, operation, *inputs):
        node = self.node("ShaderNodeMath", operation=operation, use_clamp=True)
        for index, value in enumerate(inputs):
            if isinstance(value, bpy.types.NodeSocket):
                self.tree.links.new(value, node.inputs[index])
            else:
                node.inputs[index].default_value = value
        return node.outputs[0]


def procedural_material(role, hex_color):
    """Noise, edge wear and occlusion over `hex_color`; returns the material and the sockets its bakes read."""
    material = bpy.data.materials.new(role)
    graph = MaterialGraph(material)
    noise = graph.node("ShaderNodeTexNoise", noise_dimensions="3D")
    noise.inputs["Scale"].default_value = NOISE_SCALE
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.6
    fine_noise = graph.node("ShaderNodeTexNoise", noise_dimensions="3D")
    fine_noise.inputs["Scale"].default_value = 12.0 * NOISE_SCALE
    fine_noise.inputs["Detail"].default_value = 3.0

    # Wear: where the bevelled normal departs from the face normal, broken up by the noise.
    bevel = graph.node("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = WEAR_RADIUS
    geometry = graph.node("ShaderNodeNewGeometry")
    facing = graph.node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    graph.tree.links.new(bevel.outputs["Normal"], facing.inputs[0])
    graph.tree.links.new(geometry.outputs["Normal"], facing.inputs[1])
    edge = graph.math("SUBTRACT", 1.0, facing.outputs["Value"])
    edge_mask = graph.node("ShaderNodeMapRange")
    edge_mask.inputs["From Min"].default_value = 0.01
    edge_mask.inputs["From Max"].default_value = 0.2
    graph.tree.links.new(edge, edge_mask.inputs["Value"])
    noise_mask = graph.node("ShaderNodeMapRange")
    noise_mask.inputs["From Min"].default_value = 0.4
    noise_mask.inputs["From Max"].default_value = 0.6
    graph.tree.links.new(fine_noise.outputs["Fac"], noise_mask.inputs["Value"])
    wear = graph.math("MULTIPLY", edge_mask.outputs["Result"], noise_mask.outputs["Result"])

    occlusion = graph.node("ShaderNodeAmbientOcclusion", samples=8)
    occlusion.inputs["Distance"].default_value = OCCLUSION_DISTANCE

    base = graph.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    base.inputs["Factor"].default_value = 1.0
    base.inputs["A"].default_value = role_color(hex_color)
    tone = graph.math("MULTIPLY_ADD", noise.outputs["Fac"], 0.5, 0.75)
    tone_color = graph.node("ShaderNodeCombineColor")
    for channel in ("Red", "Green", "Blue"):
        graph.link(tone, tone_color, channel)
    graph.link(tone_color.outputs["Color"], base, "B")
    worn = graph.node("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
    worn.inputs["B"].default_value = [min(1.0, channel * 1.8 + 0.05) for channel in role_color(hex_color)[:3]] + [1.0]
    graph.link(wear, worn, "Factor")
    graph.link(base.outputs["Result"], worn, "A")
    shaded = graph.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    shaded.inputs["Factor"].default_value = 0.8
    graph.link(worn.outputs["Result"], shaded, "A")
    graph.link(occlusion.outputs["Color"], shaded, "B")

    rough = graph.math("MULTIPLY_ADD", fine_noise.outputs["Fac"], 0.25, 0.6)
    roughness = graph.math("SUBTRACT", rough, graph.math("MULTIPLY", wear, 0.3))
    metalness = graph.math("MULTIPLY", wear, 0.6)

    bump = graph.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.4
    bump.inputs["Distance"].default_value = 0.02
    graph.link(fine_noise.outputs["Fac"], bump, "Height")

    principled = graph.node("ShaderNodeBsdfPrincipled")
    graph.link(shaded.outputs["Result"], principled, "Base Color")
    graph.link(roughness, principled, "Roughness")
    graph.link(metalness, principled, "Metallic")
    graph.link(bump.outputs["Normal"], principled, "Normal")
    emission = graph.node("ShaderNodeEmission")
    graph.link(metalness, emission, "Color")
    output = graph.node("ShaderNodeOutputMaterial")
    graph.tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material, graph, output, principled, emission


def bake_image(name, colorspace):
    image = bpy.data.images.new(name, MAP_SIZE, MAP_SIZE, alpha=False)
    image.colorspace_settings.name = colorspace
    return image


def bake_map(graph, output, shader, image, bake_type, **settings):
    """Bakes the material through `shader` into `image`, the target node being the tree's active one."""
    target = graph.node("ShaderNodeTexImage", image=image)
    graph.tree.nodes.active = target
    graph.tree.links.new(shader.outputs[0], output.inputs["Surface"])
    bpy.ops.object.bake(type=bake_type, margin=4, **settings)
    graph.tree.nodes.remove(target)


def pixels_of(image):
    pixels = np.empty(MAP_SIZE * MAP_SIZE * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(-1, 4)


def unwrap(role_object):
    bpy.ops.object.select_all(action="DESELECT")
    role_object.select_set(True)
    bpy.context.view_layer.objects.active = role_object
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")


def baked_material(role, hex_color, role_object):
    """Unwraps `role_object`, bakes its procedural material to maps and returns a material reading them."""
    unwrap(role_object)
    procedural, graph, output, principled, emission = procedural_material(role, hex_color)
    role_object.data.materials.clear()
    role_object.data.materials.append(procedural)
    color = bake_image(f"{role}-color", "sRGB")
    normal = bake_image(f"{role}-normal", "Non-Color")
    roughness = bake_image(f"{role}-roughness", "Non-Color")
    metalness = bake_image(f"{role}-metalness", "Non-Color")
    bake_map(graph, output, principled, color, "DIFFUSE", pass_filter={"COLOR"})
    bake_map(graph, output, principled, normal, "NORMAL", normal_space="TANGENT")
    bake_map(graph, output, principled, roughness, "ROUGHNESS")
    bake_map(graph, output, emission, metalness, "EMIT")
    packed = pixels_of(color).copy()
    packed[:, 0] = 1.0
    packed[:, 1] = pixels_of(roughness)[:, 0]
    packed[:, 2] = pixels_of(metalness)[:, 0]
    packed[:, 3] = 1.0
    occlusion_roughness_metalness = bake_image(f"{role}-orm", "Non-Color")
    occlusion_roughness_metalness.pixels.foreach_set(packed.reshape(-1))
    bpy.data.materials.remove(procedural)
    for spent in (roughness, metalness):
        bpy.data.images.remove(spent)

    material = bpy.data.materials.new(role)
    final = MaterialGraph(material)
    textured = final.node("ShaderNodeBsdfPrincipled")
    color_node = final.node("ShaderNodeTexImage", image=color)
    final.link(color_node.outputs["Color"], textured, "Base Color")
    normal_node = final.node("ShaderNodeTexImage", image=normal)
    normal_map = final.node("ShaderNodeNormalMap")
    final.link(normal_node.outputs["Color"], normal_map, "Color")
    final.link(normal_map.outputs["Normal"], textured, "Normal")
    packed_node = final.node("ShaderNodeTexImage", image=occlusion_roughness_metalness)
    split = final.node("ShaderNodeSeparateColor")
    final.link(packed_node.outputs["Color"], split, "Color")
    final.link(split.outputs["Green"], textured, "Roughness")
    final.link(split.outputs["Blue"], textured, "Metallic")
    surface = final.node("ShaderNodeOutputMaterial")
    final.tree.links.new(textured.outputs["BSDF"], surface.inputs["Surface"])
    return material


def add_role_object(role, parts, hex_color):
    mesh = join_parts(parts)
    data = bpy.data.meshes.new(role)
    mesh.to_mesh(data)
    mesh.free()
    data.shade_smooth()
    role_object = bpy.data.objects.new(role, data)
    bpy.context.scene.collection.objects.link(role_object)
    role_object.modifiers.new("weighted-normals", "WEIGHTED_NORMAL").keep_sharp = True
    shaded = bpy.data.meshes.new_from_object(role_object.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    role_object.modifiers.clear()
    role_object.data = shaded
    bpy.data.meshes.remove(data)
    shaded.name = role
    return role_object


def bake_role_materials(role_objects, colors):
    """Bakes each role's material once every role object stands in the scene, so occlusion sees the whole prop."""
    for role, role_object in role_objects.items():
        material = baked_material(role, colors[role], role_object)
        role_object.data.materials.clear()
        role_object.data.materials.append(material)


def main():
    input_path, output_path = sys.argv[sys.argv.index("--") + 1 :]
    with open(input_path) as handle:
        recipe = json.load(handle)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts_by_role = {}
    for part in group_operations(recipe["operations"]):
        parts_by_role.setdefault(part["role"], []).append(part)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.seed = 0
    role_objects = {
        role: add_role_object(role, parts_by_role[role], recipe["roles"][role])
        for role in sorted(parts_by_role)
    }
    bake_role_materials(role_objects, recipe["roles"])
    bpy.ops.export_scene.gltf(filepath=output_path, export_format="GLB", export_yup=True)


main()
