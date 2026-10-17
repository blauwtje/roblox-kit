"""Station pendant: an enamelled railway dome lamp replacing the kit's 3 x 2 x 3 Neon box.

Blender units = studs, Z up (glTF/Roblox Y up). Bounds are exactly 3 x 3 across (X, Y) and 2 tall (Z), centred on
the origin, so the recorded-mesh stretch leaves it unscaled. Dark green enamel dome with a cream inside, brass
collar, rim bead and gallery ring, a cast-iron canopy stub on top and an opal diffuser bowl below that glows.
Every part is one paint material switched by a "paint" attribute (0 green, 1 brass, 2 cream, 3 iron, 4 diffuser),
joined into one mesh, unwrapped and baked to color, roughness, metalness and tangent normal maps by `lib`,
and to an emissive mask here. The baked material feeds Emission Color with mask x warm color at strength 1, so glTF exports an
emissiveTexture.
"""

import importlib
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
geometry = importlib.import_module("lib.geometry")
materials = importlib.import_module("lib.materials")
run = importlib.import_module("lib.run")
uv = importlib.import_module("lib.uv")

SEGMENTS = 36
WARM = "#f2d9a0"


def paint_material():
    material = bpy.data.materials.new("paint")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, separate.inputs["Vector"])
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Normal"], normal_z.inputs["Vector"])
    paint = nodes.new("ShaderNodeAttribute")
    paint.attribute_name = "paint"
    masks = [materials.math_node(tree, "COMPARE", (paint.outputs["Fac"], float(k), 0.5)) for k in range(5)]
    masks[4].node.name = "glow-mask"
    patch = materials.noise(tree, coords, (3.0, 6.0))

    def tone(stops):
        ramp = materials.ramp_node(nodes, stops)
        links.new(patch, ramp.inputs["Fac"])
        return ramp.outputs["Color"]

    color = tone([(0.3, "#264a37"), (0.7, "#2f5843")])
    color = materials.mix_color(tree, "MIX", (masks[1], color, tone([(0.3, "#9a7533"), (0.7, "#b48d45")])))
    color = materials.mix_color(tree, "MIX", (masks[2], color, tone([(0.3, "#b3a482"), (0.7, "#c0b18d")])))
    color = materials.mix_color(tree, "MIX", (masks[3], color, tone([(0.3, "#221f1c"), (0.7, "#2e2a25")])))
    glow_ramp = materials.ramp_node(nodes, [(0.0, "#f8dc9c"), (0.6, "#f0d092"), (1.0, "#e6c07e")])
    glow_range = nodes.new("ShaderNodeMapRange")
    glow_range.inputs["From Min"].default_value = -1.0
    glow_range.inputs["From Max"].default_value = -0.55
    links.new(separate.outputs["Z"], glow_range.inputs["Value"])
    links.new(glow_range.outputs["Result"], glow_ramp.inputs["Fac"])
    color = materials.mix_color(tree, "MIX", (masks[4], color, glow_ramp.outputs["Color"]))
    bevel = nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = 0.015
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(bevel.outputs["Normal"], facing.inputs[0])
    links.new(geometry.outputs["Normal"], facing.inputs[1])
    edge_ramp = materials.ramp_node(nodes, [(0.9, "#ffffff"), (0.97, "#000000")])
    links.new(facing.outputs["Value"], edge_ramp.inputs["Fac"])
    chip_ramp = materials.ramp_node(nodes, [(0.45, "#000000"), (0.6, "#ffffff")])
    links.new(materials.noise(tree, coords, (14.0, 6.0)), chip_ramp.inputs["Fac"])
    wear = materials.math_node(tree, "MULTIPLY", (edge_ramp.outputs["Color"], chip_ramp.outputs["Color"]))
    wear = materials.math_node(tree, "MULTIPLY", (wear, materials.math_node(tree, "SUBTRACT", (1.0, masks[4]))))
    bare = materials.mix_color(tree, "MIX", (masks[1], materials.linear("#3d3a36"), materials.linear("#d8b56a")))
    color = materials.mix_color(tree, "MIX", (wear, color, bare))
    dust_ramp = materials.ramp_node(nodes, [(0.6, "#000000"), (0.95, "#4d4d4d")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    color = materials.mix_color(tree, "MIX", (dust_ramp.outputs["Color"], color, materials.linear("#8a8172")))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.2
    grime_ramp = materials.ramp_node(nodes, [(0.0, "#6b6152"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grime = materials.mix_color(tree, "MIX", (masks[4], grime_ramp.outputs["Color"], (1.0, 1.0, 1.0, 1.0)))
    color = materials.mix_color(tree, "MULTIPLY", (1.0, color, grime))
    links.new(color, bsdf.inputs["Base Color"])
    metal = materials.math_node(tree, "MULTIPLY", (masks[1], 0.9))
    metal = materials.math_node(tree, "MULTIPLY_ADD", (masks[3], 0.25, metal))
    metal = materials.math_node(tree, "MAXIMUM", (metal, materials.math_node(tree, "MULTIPLY", (wear, 0.8))))
    links.new(metal, bsdf.inputs["Metallic"])
    rough_noise = nodes.new("ShaderNodeMapRange")
    rough_noise.inputs["To Min"].default_value = -0.06
    rough_noise.inputs["To Max"].default_value = 0.06
    links.new(patch, rough_noise.inputs["Value"])
    rough = materials.math_node(tree, "ADD", (0.32, rough_noise.outputs["Result"]))
    rough = materials.mix_float(tree, (masks[1], rough, 0.38))
    rough = materials.mix_float(tree, (masks[2], rough, 0.45))
    rough = materials.mix_float(tree, (masks[3], rough, 0.62))
    rough = materials.mix_float(tree, (masks[4], rough, 0.3))
    rough = materials.mix_float(tree, (dust_ramp.outputs["Color"], rough, 0.8))
    links.new(rough, bsdf.inputs["Roughness"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.1
    bump.inputs["Distance"].default_value = 0.004
    links.new(materials.noise(tree, coords, (40.0, 4.0)), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def dome_profile(offset):
    """Outer dome surface (offset 0) or inner (offset > 0): a flattened quarter ellipse flaring at the rim."""
    a, b, zc = 1.42 - offset, 0.98 - offset, -0.6
    rings = []
    phi0 = math.asin(0.3 / a)
    for i in range(11):
        phi = phi0 + (math.pi / 2 - phi0) * i / 10
        rings.append((a * math.sin(phi), zc + b * math.cos(phi)))
    rings.append((1.45 - offset, -0.66 + offset * 0.3))
    return rings


def bead(name, shape, surface):
    radius, z, tube, tube_segments, squash = shape
    geometry.ring(name, geometry.Ring(radius, tube, z, SEGMENTS, tube_segments, squash), surface)


def turned(name, rings, style):
    surface, caps, flip = style if len(style) == 3 else (style, (True, True), False)
    geometry.lathe(name, geometry.Lathe(rings, SEGMENTS, None, caps, flip), surface)


def build_pendant(material):
    iron, brass = materials.Surface(material, 3.0), materials.Surface(material, 1.0)
    turned("canopy", [(0.34, 0.92), (0.34, 1.0), (0.3, 1.0), (0.2, 0.96), (0.13, 0.9), (0.11, 0.84), (0.11, 0.72)], (iron, (False, True), False))
    bead("canopy-bead", (0.34, 0.92, 0.04, 6, 1.0), iron)
    turned("collar", [(0.13, 0.76), (0.2, 0.74), (0.2, 0.66), (0.17, 0.62), (0.22, 0.56), (0.24, 0.48), (0.33, 0.4), (0.33, 0.34)], brass)
    bead("collar-bead", (0.2, 0.7, 0.035, 6, 1.0), brass)
    turned("shade-outer", dome_profile(0.0), (materials.Surface(material, 0.0), (False, False), False))
    turned("shade-inner", dome_profile(0.035), (materials.Surface(material, 2.0), (False, False), True))
    bead("rim", (1.46, -0.665, 0.04, 8, 1.0), brass)
    bowl = [((0.8 - 0.025 * (i % 2)) * math.cos(t), -0.55 - 0.45 * math.sin(t)) for i, t in ((i, i / 6 * (math.pi / 3)) for i in range(7))]
    turned("diffuser", bowl, (materials.Surface(material, 4.0), (True, False), False))
    bead("diffuser-lip", (0.4, -0.965, 0.035, 8, 1.0), brass)
    bead("gallery", (0.82, -0.55, 0.045, 6, 1.3), brass)


def bake_glow(pendant, material):
    """Bakes the diffuser's glow mask into an emissive map, before `run.bake` swaps the material."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    image = bpy.data.images.new("pendant-emissive", run.MAP_SIZE, run.MAP_SIZE)
    image.colorspace_settings.name = "sRGB"
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    nodes.active = target
    emission = nodes.new("ShaderNodeEmission")
    links.new(nodes["glow-mask"].outputs["Value"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], nodes["Material Output"].inputs["Surface"])
    bpy.ops.object.select_all(action="DESELECT")
    pendant.select_set(True)
    bpy.context.view_layer.objects.active = pendant
    bpy.context.scene.render.bake.margin = 6
    bpy.ops.object.bake(type="EMIT")
    image.filepath_raw = os.path.join(run.MAPS, "pendant-emissive.png")
    image.file_format = "PNG"
    image.save()
    links.new(nodes["Principled BSDF"].outputs["BSDF"], nodes["Material Output"].inputs["Surface"])
    nodes.remove(emission)
    nodes.remove(target)
    return image


def add_glow(pendant, image):
    """Feeds the baked material's Emission Color with the mask times the warm color, so glTF exports an emissiveTexture."""
    tree = pendant.data.materials[0].node_tree
    nodes, links = tree.nodes, tree.links
    mask_texture = nodes.new("ShaderNodeTexImage")
    mask_texture.image = image
    glow = materials.mix_color(tree, "MULTIPLY", (1.0, mask_texture.outputs["Color"], materials.linear(WARM)))
    links.new(glow, nodes["Principled BSDF"].inputs["Emission Color"])
    nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.0


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    run.set_up_cycles()
    paint = paint_material()
    build_pendant(paint)
    pendant = geometry.finish("pendant")
    run.report("pendant", [pendant])
    uv.unwrap([pendant])
    emissive = bake_glow(pendant, paint)
    run.bake([pendant], [paint], "pendant")
    add_glow(pendant, emissive)
    run.export_glb([pendant], "pendant")


if __name__ == "__main__":
    build()
