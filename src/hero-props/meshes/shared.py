"""What every Blender-scripted mesh repeats: shader-node helpers, an unwrap, the four baked maps and the GLB export.

A mesh script puts this folder on `sys.path`, imports `shared`, builds its objects with one paint material in
Blender units (studs), and finishes with `unwrap`, `bake` and `export_glb`. Run through
`src/hero-props/generate-scripted-mesh.ts` as
`blender -b --factory-startup --python-exit-code 1 -P <script> -- <out prefix> <maps folder>`; the GLB lands in
`<maps folder>/<name>.glb`. The baked maps are 1024 px, the most a Roblox SurfaceAppearance takes.
"""

import math
import os
import sys

import bmesh
import bpy

arguments = sys.argv[sys.argv.index("--") + 1 :]
OUTPUT, MAPS = arguments[0], arguments[1]
MAP_SIZE = 1024


def linear(hex_color):
    def channel(value):
        value /= 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    return tuple(channel(int(hex_color[i : i + 2], 16)) for i in (1, 3, 5)) + (1.0,)


def ramp_node(nodes, stops):
    """A color ramp from (position, hex) stops."""
    ramp = nodes.new("ShaderNodeValToRGB")
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, hex_color) in zip(elements, stops):
        element.position = position
        element.color = linear(hex_color)
    return ramp


def mix_color(nodes, links, blend, factor, a, b):
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = blend
    if isinstance(factor, float):
        mix.inputs["Factor"].default_value = factor
    else:
        links.new(factor, mix.inputs["Factor"])
    for socket, value in (("A", a), ("B", b)):
        if isinstance(value, tuple):
            mix.inputs[socket].default_value = value
        else:
            links.new(value, mix.inputs[socket])
    return mix.outputs["Result"]


def mix_float(nodes, links, factor, a, b):
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "FLOAT"
    for socket, value in (("Factor", factor), ("A", a), ("B", b)):
        if isinstance(value, float):
            mix.inputs[socket].default_value = value
        else:
            links.new(value, mix.inputs[socket])
    return mix.outputs["Result"]


def math_node(nodes, links, operation, a, b):
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate((a, b)):
        if isinstance(value, float):
            node.inputs[index].default_value = value
        else:
            links.new(value, node.inputs[index])
    return node.outputs["Value"]


def noise(nodes, links, vector, scale, detail):
    texture = nodes.new("ShaderNodeTexNoise")
    texture.inputs["Scale"].default_value = scale
    texture.inputs["Detail"].default_value = detail
    links.new(vector, texture.inputs["Vector"])
    return texture.outputs["Fac"]

def flat_material(name, hex_color, roughness):
    material = bpy.data.materials.new(name)
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = linear(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    return material


def link_object(name, data, material):
    obj = bpy.data.objects.new(name, data)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


def mark_paint(obj, value):
    paint = obj.data.attributes.new("paint", "FLOAT", "POINT")
    paint.data.foreach_set("value", [value] * len(obj.data.vertices))


def unwrap(objects, margin=0.004):
    """Smart-projects the objects into one UV layout and repacks the islands."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(objects, materials, name):
    """Bakes color, roughness, metalness and normal into MAP_SIZE images, then swaps in one baked material."""
    scene = bpy.context.scene
    scene.render.bake.margin = 6
    images = {}
    for kind, colorspace in (("color", "sRGB"), ("roughness", "Non-Color"), ("metalness", "Non-Color"), ("normal", "Non-Color")):
        image = bpy.data.images.new(f"{name}-{kind}", MAP_SIZE, MAP_SIZE)
        image.colorspace_settings.name = colorspace
        images[kind] = image

    def target(image):
        for material in materials:
            node = material.node_tree.nodes.get("bake-target") or material.node_tree.nodes.new("ShaderNodeTexImage")
            node.name = "bake-target"
            node.image = image
            material.node_tree.nodes.active = node

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    target(images["color"])
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
    target(images["roughness"])
    bpy.ops.object.bake(type="ROUGHNESS")
    target(images["normal"])
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
    # Metalness has no bake pass: route each material's metallic input through an emission for one EMIT bake.
    for material in materials:
        nodes = material.node_tree.nodes
        output = nodes["Material Output"]
        emission = nodes.new("ShaderNodeEmission")
        metallic = nodes["Principled BSDF"].inputs["Metallic"]
        if metallic.links:
            material.node_tree.links.new(metallic.links[0].from_socket, emission.inputs["Color"])
        else:
            value = metallic.default_value
            emission.inputs["Color"].default_value = (value, value, value, 1.0)
        material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    target(images["metalness"])
    bpy.ops.object.bake(type="EMIT")
    os.makedirs(MAPS, exist_ok=True)
    for kind, image in images.items():
        image.filepath_raw = os.path.join(MAPS, f"{name}-{kind}.png")
        image.file_format = "PNG"
        image.save()
    baked = bpy.data.materials.new(name)
    nodes, links = baked.node_tree.nodes, baked.node_tree.links
    bsdf = nodes["Principled BSDF"]
    for kind, socket in (("color", "Base Color"), ("roughness", "Roughness"), ("metalness", "Metallic")):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = images[kind]
        links.new(texture.outputs["Color"], bsdf.inputs[socket])
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = images["normal"]
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(baked)


def export_glb(objects, name):
    """Exports the objects, and only them, to `<maps folder>/<name>.glb`."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(MAPS, f"{name}.glb"), use_selection=True)


def set_up_cycles():
    """Cycles on the GPU where Metal is available, which the bakes need."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = 64


def triangle_count(obj):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    count = sum(len(face.verts) - 2 for face in mesh.faces)
    mesh.free()
    return count
