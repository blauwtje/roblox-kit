"""Station pendant: an enamelled railway dome lamp replacing the kit's 3 x 2 x 3 Neon box.

Blender units = studs, Z up (glTF/Roblox Y up). Bounds are exactly 3 x 3 across (X, Y) and 2 tall (Z), centred on
the origin, so the recorded-mesh stretch leaves it unscaled. Dark green enamel dome with a cream inside, brass
collar, rim bead and gallery ring, a cast-iron canopy stub on top and an opal diffuser bowl below that glows.
Every part is one paint material switched by a "paint" attribute (0 green, 1 brass, 2 cream, 3 iron, 4 diffuser),
joined into one mesh, unwrapped and baked to color, roughness, metalness and tangent normal maps by `shared.py`,
and to an emissive mask here. The baked material feeds Emission Color with mask x warm color at strength 1, so glTF exports an
emissiveTexture.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import (  # noqa: E402
    bake,
    export_glb,
    linear,
    link_object,
    MAP_SIZE,
    MAPS,
    mark_paint,
    mix_color,
    mix_float,
    noise,
    ramp_node,
    set_up_cycles,
    triangle_count,
    unwrap,
)

SEGMENTS = 36
WARM = "#f2d9a0"
random.seed(11)


def math_node(nodes, links, operation, a, b, c=None):
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate((a, b, c)):
        if value is None:
            continue
        if isinstance(value, float):
            node.inputs[index].default_value = value
        else:
            links.new(value, node.inputs[index])
    return node.outputs["Value"]


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
    masks = [math_node(nodes, links, "COMPARE", paint.outputs["Fac"], float(k), 0.5) for k in range(5)]
    masks[4].node.name = "glow-mask"
    patch = noise(nodes, links, coords, 3.0, 6.0)

    def tone(stops):
        ramp = ramp_node(nodes, stops)
        links.new(patch, ramp.inputs["Fac"])
        return ramp.outputs["Color"]

    color = tone([(0.3, "#264a37"), (0.7, "#2f5843")])
    color = mix_color(nodes, links, "MIX", masks[1], color, tone([(0.3, "#9a7533"), (0.7, "#b48d45")]))
    color = mix_color(nodes, links, "MIX", masks[2], color, tone([(0.3, "#b3a482"), (0.7, "#c0b18d")]))
    color = mix_color(nodes, links, "MIX", masks[3], color, tone([(0.3, "#221f1c"), (0.7, "#2e2a25")]))
    # Opal diffuser: warm, brightest at its lowest point, where the bulb sits closest.
    glow_ramp = ramp_node(nodes, [(0.0, "#f8dc9c"), (0.6, "#f0d092"), (1.0, "#e6c07e")])
    glow_range = nodes.new("ShaderNodeMapRange")
    glow_range.inputs["From Min"].default_value = -1.0
    glow_range.inputs["From Max"].default_value = -0.55
    links.new(separate.outputs["Z"], glow_range.inputs["Value"])
    links.new(glow_range.outputs["Result"], glow_ramp.inputs["Fac"])
    color = mix_color(nodes, links, "MIX", masks[4], color, glow_ramp.outputs["Color"])
    # Edge wear on enamel and iron shows dark metal, on brass a brighter polish.
    bevel = nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = 0.015
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(bevel.outputs["Normal"], facing.inputs[0])
    links.new(geometry.outputs["Normal"], facing.inputs[1])
    edge_ramp = ramp_node(nodes, [(0.9, "#ffffff"), (0.97, "#000000")])
    links.new(facing.outputs["Value"], edge_ramp.inputs["Fac"])
    chip_ramp = ramp_node(nodes, [(0.45, "#000000"), (0.6, "#ffffff")])
    links.new(noise(nodes, links, coords, 14.0, 6.0), chip_ramp.inputs["Fac"])
    wear = math_node(nodes, links, "MULTIPLY", edge_ramp.outputs["Color"], chip_ramp.outputs["Color"])
    wear = math_node(nodes, links, "MULTIPLY", wear, math_node(nodes, links, "SUBTRACT", 1.0, masks[4]))
    bare = mix_color(nodes, links, "MIX", masks[1], linear("#3d3a36"), linear("#d8b56a"))
    color = mix_color(nodes, links, "MIX", wear, color, bare)
    # Dust on up-facing enamel; occlusion grime everywhere but the diffuser.
    dust_ramp = ramp_node(nodes, [(0.6, "#000000"), (0.95, "#4d4d4d")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    color = mix_color(nodes, links, "MIX", dust_ramp.outputs["Color"], color, linear("#8a8172"))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.2
    grime_ramp = ramp_node(nodes, [(0.0, "#6b6152"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grime = mix_color(nodes, links, "MIX", masks[4], grime_ramp.outputs["Color"], (1.0, 1.0, 1.0, 1.0))
    color = mix_color(nodes, links, "MULTIPLY", 1.0, color, grime)
    links.new(color, bsdf.inputs["Base Color"])
    metal = math_node(nodes, links, "MULTIPLY", masks[1], 0.9)
    metal = math_node(nodes, links, "MULTIPLY_ADD", masks[3], 0.25, metal)
    metal = math_node(nodes, links, "MAXIMUM", metal, math_node(nodes, links, "MULTIPLY", wear, 0.8))
    links.new(metal, bsdf.inputs["Metallic"])
    rough_noise = nodes.new("ShaderNodeMapRange")
    rough_noise.inputs["To Min"].default_value = -0.06
    rough_noise.inputs["To Max"].default_value = 0.06
    links.new(patch, rough_noise.inputs["Value"])
    rough = math_node(nodes, links, "ADD", 0.32, rough_noise.outputs["Result"])
    rough = mix_float(nodes, links, masks[1], rough, 0.38)
    rough = mix_float(nodes, links, masks[2], rough, 0.45)
    rough = mix_float(nodes, links, masks[3], rough, 0.62)
    rough = mix_float(nodes, links, masks[4], rough, 0.3)
    rough = mix_float(nodes, links, dust_ramp.outputs["Color"], rough, 0.8)
    links.new(rough, bsdf.inputs["Roughness"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.1
    bump.inputs["Distance"].default_value = 0.004
    links.new(noise(nodes, links, coords, 40.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def lathe(name, rings, material, paint, closed=False, caps=(True, True), segments=SEGMENTS, flip=False):
    """A turned part from (radius, z) rings; closed joins the last ring to the first (a torus), caps close the ends.
    flip turns an open surface's faces toward the axis, since Roblox culls back faces."""
    bm = bmesh.new()
    grid = []
    for radius, z in rings:
        row = []
        for step in range(segments):
            theta = step / segments * 2 * math.pi
            row.append(bm.verts.new((radius * math.cos(theta), radius * math.sin(theta), z)))
        grid.append(row)
    pairs = list(zip(grid, grid[1:])) + ([(grid[-1], grid[0])] if closed else [])
    for lower, upper in pairs:
        for step in range(segments):
            following = (step + 1) % segments
            bm.faces.new((lower[step], lower[following], upper[following], upper[step]))
    if not closed:
        if caps[0]:
            bm.faces.new(list(reversed(grid[0])))
        if caps[1]:
            bm.faces.new(grid[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link_object(name, mesh, material)
    mark_paint(obj, paint)
    return obj


def ring(name, radius, z, minor, material, paint, steps=10, squash=1.0):
    """A bead: a torus of minor radius around the axis, with a vertex on its outermost point."""
    rings = [(radius + minor * math.cos(a), z + minor * squash * math.sin(a)) for a in (i / steps * 2 * math.pi for i in range(steps))]
    return lathe(name, rings, material, paint, closed=True)


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


def build_pendant(material):
    # Cast-iron canopy stub, flush with the top of the bounds, stepping down to the brass collar.
    lathe("canopy", [(0.34, 0.92), (0.34, 1.0), (0.3, 1.0), (0.2, 0.96), (0.13, 0.9), (0.11, 0.84), (0.11, 0.72)], material, 3.0, caps=(False, True))
    ring("canopy-bead", 0.34, 0.92, 0.04, material, 3.0, steps=6)
    # Brass collar: a turned socket holder with a bead and a flared skirt onto the dome.
    lathe("collar", [(0.13, 0.76), (0.2, 0.74), (0.2, 0.66), (0.17, 0.62), (0.22, 0.56), (0.24, 0.48), (0.33, 0.4), (0.33, 0.34)], material, 1.0)
    ring("collar-bead", 0.2, 0.7, 0.035, material, 1.0, steps=6)
    # Enamel dome: green outside, cream inside, rim hidden under a brass bead whose outer point sits at 1.5.
    lathe("shade-outer", dome_profile(0.0), material, 0.0, caps=(False, False))
    lathe("shade-inner", dome_profile(0.035), material, 2.0, caps=(False, False), flip=True)
    ring("rim", 1.46, -0.665, 0.04, material, 1.0, steps=8)
    # Opal diffuser bowl under the dome, held by a brass gallery ring and open at the bottom: a brass lip
    # ring of radius 0.4, its bottom at -1, frames the opening, through which the glowing bulb inside shows.
    bowl = [((0.8 - 0.025 * (i % 2)) * math.cos(t), -0.55 - 0.45 * math.sin(t)) for i, t in ((i, i / 6 * (math.pi / 3)) for i in range(7))]
    lathe("diffuser", bowl, material, 4.0, caps=(True, False))
    ring("diffuser-lip", 0.4, -0.965, 0.035, material, 1.0, steps=8)
    ring("gallery", 0.82, -0.55, 0.045, material, 1.0, steps=6, squash=1.3)


def join_pendant():
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    pendant = bpy.context.active_object
    pendant.name = "pendant"
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return pendant


def bake_glow(pendant, material):
    """Bakes the diffuser's glow mask into an emissive map, before `shared.bake` swaps the material."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    image = bpy.data.images.new("pendant-emissive", MAP_SIZE, MAP_SIZE)
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
    image.filepath_raw = os.path.join(MAPS, "pendant-emissive.png")
    image.file_format = "PNG"
    image.save()
    links.new(nodes["Principled BSDF"].outputs["BSDF"], nodes["Material Output"].inputs["Surface"])
    nodes.remove(emission)
    nodes.remove(target)
    return image


def add_glow(pendant, image):
    """Feeds the baked material's Emission Color with the mask times the warm color, so glTF exports an emissiveTexture."""
    nodes, links = pendant.data.materials[0].node_tree.nodes, pendant.data.materials[0].node_tree.links
    mask_texture = nodes.new("ShaderNodeTexImage")
    mask_texture.image = image
    glow = mix_color(nodes, links, "MULTIPLY", 1.0, mask_texture.outputs["Color"], linear(WARM))
    links.new(glow, nodes["Principled BSDF"].inputs["Emission Color"])
    nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.0


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
paint = paint_material()
build_pendant(paint)
pendant = join_pendant()
print("pendant triangles", triangle_count(pendant), "bounds", [tuple(round(c, 3) for c in corner) for corner in (pendant.bound_box[0], pendant.bound_box[6])])
unwrap([pendant])
emissive = bake_glow(pendant, paint)
bake([pendant], [paint], "pendant")
add_glow(pendant, emissive)
export_glb([pendant], "pendant")
