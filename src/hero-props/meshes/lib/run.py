"""Running a mesh script: Blender's arguments, the Cycles bake, the GLB export and the finishing sequence.

Run through `src/hero-props/generate-scripted-mesh.ts` as
`blender -b --factory-startup --python-exit-code 1 -P <script> -- <out prefix> <maps folder>`; the GLB lands in
`<maps folder>/<name>.glb`. The baked maps are 1024 px, the most a Roblox SurfaceAppearance takes.
"""

import os
import sys

import bmesh
import bpy

from .uv import unwrap

arguments = sys.argv[sys.argv.index("--") + 1 :]
OUTPUT, MAPS = arguments[0], arguments[1]
MAP_SIZE = 1024


def route_metalness_to_emission(materials):
    """Metalness has no bake pass, so each material's metallic input feeds an emission for one EMIT bake."""
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
    route_metalness_to_emission(materials)
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


GPU_BACKENDS = ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI")


def pick_backend(preferences):
    """The backend named by ROBLOX_KIT_BLENDER_DEVICE, else the first GPU backend with a device, else CPU."""
    named = os.environ.get("ROBLOX_KIT_BLENDER_DEVICE")
    if named:
        return named.upper()
    for backend in GPU_BACKENDS:
        try:
            preferences.compute_device_type = backend
            preferences.get_devices()
        except TypeError:
            continue
        if any(device.type == backend for device in preferences.devices):
            return backend
    return "CPU"


def set_up_cycles():
    """Cycles on the environment's chosen bake device, else the first available GPU backend, else the CPU."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    backend = pick_backend(preferences)
    if backend != "CPU":
        preferences.compute_device_type = backend
        preferences.get_devices()
        for device in preferences.devices:
            device.use = True
    scene.cycles.device = "CPU" if backend == "CPU" else "GPU"
    scene.cycles.samples = 64


def triangle_count(obj):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    count = sum(len(face.verts) - 2 for face in mesh.faces)
    mesh.free()
    return count


def finish_mesh(name, objects, material):
    """Prints the triangle count and bounds, unwraps, bakes the one material and exports `<maps folder>/<name>.glb`."""
    first = objects[0]
    corners = [tuple(round(c, 3) for c in first.bound_box[index]) for index in (0, 6)]
    print(name, "triangles", sum(triangle_count(obj) for obj in objects), "bounds", corners)
    unwrap(objects)
    bake(objects, [material], name)
    export_glb(objects, name)
