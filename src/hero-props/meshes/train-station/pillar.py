"""Station pillar: a Victorian cast-iron column for the concourse colonnade.

Blender units = studs. Column centered on the origin, floor at z 0, top at z 16, inside a 2 by 2 footprint,
so its bounds match the kit pillar (2 x 16 x 2) and the recorded-mesh stretch leaves it unscaled.
Cream paint (the wall role's color family) with the plinth, the collar and the abacus picked out in dark
bronze (the trim role's color family). Every part is one paint material switched by a "paint" attribute,
joined into one mesh, unwrapped and baked to color (with occlusion grime), roughness, metalness and tangent
normal maps by `shared.py`.
"""

import math
import os
import random
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import (  # noqa: E402
    export_glb,
    link_object,
    math_node,
    mark_paint,
    mix_color,
    mix_float,
    noise,
    linear,
    ramp_node,
    set_up_cycles,
    triangle_count,
    unwrap,
    bake,
)

HEIGHT = 16.0
FLUTES = 16
random.seed(11)


def paint_material():
    material = bpy.data.materials.new("paint")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, separate.inputs["Vector"])
    height = separate.outputs["Z"]
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Normal"], normal_z.inputs["Vector"])
    # 0 = cream body, 1 = dark bronze trim, from the attribute each part carries, since joining loses objects.
    paint_attribute = nodes.new("ShaderNodeAttribute")
    paint_attribute.attribute_name = "paint"
    dark_amount = paint_attribute.outputs["Fac"]
    patch = noise(nodes, links, coords, 2.5, 6.0)
    cream = ramp_node(nodes, [(0.3, "#cdc2a8"), (0.7, "#e3dbc6")])
    links.new(patch, cream.inputs["Fac"])
    dark = ramp_node(nodes, [(0.2, "#25221f"), (0.8, "#312c27")])
    links.new(patch, dark.inputs["Fac"])
    painted = mix_color(nodes, links, "MIX", dark_amount, cream.outputs["Color"], dark.outputs["Color"])
    # Edge wear where a bevelled normal leaves the true normal (not Pointiness, which is per vertex), broken up
    # by noise; under cream it shows dark iron, under bronze a lighter bare metal.
    bevel = nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = 0.02
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(bevel.outputs["Normal"], facing.inputs[0])
    links.new(geometry.outputs["Normal"], facing.inputs[1])
    edge_ramp = ramp_node(nodes, [(0.9, "#ffffff"), (0.97, "#000000")])
    links.new(facing.outputs["Value"], edge_ramp.inputs["Fac"])
    chip_ramp = ramp_node(nodes, [(0.45, "#000000"), (0.58, "#ffffff")])
    links.new(noise(nodes, links, coords, 12.0, 6.0), chip_ramp.inputs["Fac"])
    wear = math_node(nodes, links, "MULTIPLY", edge_ramp.outputs["Color"], chip_ramp.outputs["Color"])
    bare = mix_color(nodes, links, "MIX", dark_amount, linear("#4f4a43"), linear("#57534c"))
    worn = mix_color(nodes, links, "MIX", wear, painted, bare)
    # Rust only low down, where feet and mop buckets chip the plinth.
    rust_ramp = ramp_node(nodes, [(0.6, "#000000"), (0.72, "#ffffff")])
    links.new(noise(nodes, links, coords, 4.0, 10.0), rust_ramp.inputs["Fac"])
    low = nodes.new("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 0.0
    low.inputs["From Max"].default_value = 1.2
    low.inputs["To Min"].default_value = 1.0
    low.inputs["To Max"].default_value = 0.0
    links.new(height, low.inputs["Value"])
    rust = math_node(nodes, links, "MULTIPLY", rust_ramp.outputs["Color"], low.outputs["Result"])
    rusty = mix_color(nodes, links, "MIX", rust, worn, linear("#5c3720"))
    # Dust settles on surfaces that face up.
    dust_ramp = ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dusty = mix_color(nodes, links, "MIX", dust_ramp.outputs["Color"], rusty, linear("#a39a88"))
    # Faint vertical streaks: noise stretched along the column.
    streak_mapping = nodes.new("ShaderNodeMapping")
    streak_mapping.inputs["Scale"].default_value = (9.0, 9.0, 0.45)
    links.new(coords, streak_mapping.inputs["Vector"])
    streak_ramp = ramp_node(nodes, [(0.55, "#ffffff"), (0.8, "#e2dbcf")])
    links.new(noise(nodes, links, streak_mapping.outputs["Vector"], 2.0, 4.0), streak_ramp.inputs["Fac"])
    streaked = mix_color(nodes, links, "MULTIPLY", 1.0, dusty, streak_ramp.outputs["Color"])
    # Scuffs and floor grime fade out by about knee height.
    floor_ramp = ramp_node(nodes, [(0.0, "#8f8472"), (1.0, "#ffffff")])
    floor_range = nodes.new("ShaderNodeMapRange")
    floor_range.inputs["From Max"].default_value = 1.8
    links.new(height, floor_range.inputs["Value"])
    scuff = math_node(nodes, links, "MULTIPLY", floor_range.outputs["Result"], 1.0)
    scuff_noise = math_node(nodes, links, "ADD", scuff, noise(nodes, links, coords, 6.0, 4.0))
    links.new(math_node(nodes, links, "MULTIPLY", scuff_noise, 0.75), floor_ramp.inputs["Fac"])
    floored = mix_color(nodes, links, "MULTIPLY", 1.0, streaked, floor_ramp.outputs["Color"])
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.25
    grime_ramp = ramp_node(nodes, [(0.0, "#73695a"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = mix_color(nodes, links, "MULTIPLY", 1.0, floored, grime_ramp.outputs["Color"])
    links.new(grimy, bsdf.inputs["Base Color"])
    # Paint is dielectric; only bare worn edges are metal, and rust is not.
    unrusted = math_node(nodes, links, "SUBTRACT", 1.0, rust)
    metal = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "MULTIPLY", wear, 0.7), unrusted)
    links.new(metal, bsdf.inputs["Metallic"])
    paint_roughness = nodes.new("ShaderNodeMapRange")
    paint_roughness.inputs["To Min"].default_value = 0.42
    paint_roughness.inputs["To Max"].default_value = 0.62
    links.new(patch, paint_roughness.inputs["Value"])
    rough = mix_float(nodes, links, wear, paint_roughness.outputs["Result"], 0.35)
    rough = mix_float(nodes, links, rust, rough, 0.9)
    rough = mix_float(nodes, links, dust_ramp.outputs["Color"], rough, 0.85)
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel paint and a cast surface: a fine, weak bump.
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.004
    links.new(noise(nodes, links, coords, 40.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material

def lathe(name, rings, segments, material, paint=0.0, radial=None):
    """A turned part: (radius, z) rings from bottom to top, capped at both ends; radial(theta, z) scales a radius."""
    bm = bmesh.new()
    grid = []
    for radius, z in rings:
        row = []
        for step in range(segments):
            theta = step / segments * 2 * math.pi
            scaled = radius * (radial(theta, z) if radial else 1.0)
            row.append(bm.verts.new((scaled * math.cos(theta), scaled * math.sin(theta), z)))
        grid.append(row)
    for lower, upper in zip(grid, grid[1:]):
        for step in range(segments):
            following = (step + 1) % segments
            bm.faces.new((lower[step], lower[following], upper[following], upper[step]))
    bm.faces.new(list(reversed(grid[0])))
    bm.faces.new(grid[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link_object(name, mesh, material)
    mark_paint(obj, paint)
    return obj


def block(name, size, z_bottom, bevel_width, material, paint):
    """A square block centered on the axis, its edges bevelled."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z_bottom + size[2] / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(material)
    mark_paint(obj, paint)
    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = bevel_width
    bevel.segments = 2
    return obj


def smoothstep(edge0, edge1, value):
    t = min(1.0, max(0.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def base(material):
    """Square plinth and step in bronze, then turned mouldings flaring into the shaft."""
    block("plinth", (2.0, 2.0, 0.5), 0.0, 0.035, material, 1.0)
    block("plinth-step", (1.9, 1.9, 0.2), 0.48, 0.05, material, 1.0)
    profile = [
        (0.89, 0.66), (0.91, 0.72), (0.92, 0.79), (0.91, 0.86), (0.87, 0.91), (0.83, 0.93), (0.82, 0.97),
        (0.77, 1.0), (0.73, 1.05), (0.72, 1.1), (0.74, 1.14), (0.77, 1.18), (0.77, 1.23), (0.74, 1.27),
        (0.7, 1.29), (0.69, 1.33), (0.665, 1.38), (0.65, 1.44), (0.64, 1.52),
    ]
    lathe("base-mouldings", profile, 48, material)


def lower_shaft(material):
    lathe("lower-shaft", [(0.64, 1.5), (0.637, 2.6), (0.633, 3.6), (0.63, 4.46)], 48, material)


def collar(material):
    """A bronze band between the plain and the fluted shaft, beaded round its middle."""
    profile = [
        (0.62, 4.4), (0.66, 4.42), (0.71, 4.47), (0.72, 4.52), (0.7, 4.57), (0.68, 4.58), (0.68, 4.76),
        (0.7, 4.77), (0.72, 4.82), (0.71, 4.87), (0.66, 4.92), (0.61, 4.94),
    ]
    lathe("collar", profile, 48, material, 1.0)
    for index in range(16):
        angle = index / 16 * 2 * math.pi
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.045, location=(0.68 * math.cos(angle), 0.68 * math.sin(angle), 4.67), segments=8, ring_count=4
        )
        bead = bpy.context.active_object
        bead.data.materials.append(material)
        mark_paint(bead, 1.0)


SHAFT_BOTTOM, SHAFT_TOP = 4.9, 13.32


def shaft_radius(z):
    """Tapers from 0.62 to 0.55 with a slight entasis: slower near the bottom."""
    progress = (z - SHAFT_BOTTOM) / (SHAFT_TOP - SHAFT_BOTTOM)
    return 0.62 - 0.07 * progress**1.3


def fluted_shaft(material):
    depth = 0.045

    def flutes(theta, z):
        position = (theta * FLUTES / (2 * math.pi)) % 1.0
        groove = math.sin(math.pi * position) ** 0.8
        ends = smoothstep(SHAFT_BOTTOM + 0.05, SHAFT_BOTTOM + 0.32, z) * smoothstep(SHAFT_TOP - 0.05, SHAFT_TOP - 0.32, z)
        return 1 - depth * groove * ends / shaft_radius(z)

    heights = [SHAFT_BOTTOM, SHAFT_BOTTOM + 0.1, SHAFT_BOTTOM + 0.19, SHAFT_BOTTOM + 0.27, SHAFT_BOTTOM + 0.34]
    heights += [7.7, 10.5]
    heights += [SHAFT_TOP - 0.34, SHAFT_TOP - 0.27, SHAFT_TOP - 0.19, SHAFT_TOP - 0.1, SHAFT_TOP]
    lathe("fluted-shaft", [(shaft_radius(z), z) for z in heights], FLUTES * 8, material, radial=flutes)


def capital(material):
    """Astragal ring, a plain necking, a band of eggs, a convex echinus, then a bronze abacus and top plate."""
    astragal = [(0.54, 13.26), (0.58, 13.29), (0.605, 13.34), (0.61, 13.4), (0.6, 13.46), (0.57, 13.5), (0.54, 13.52)]
    lathe("astragal", astragal, 48, material)
    necking = [(0.55, 13.5), (0.555, 13.8), (0.6, 13.82), (0.62, 13.86), (0.62, 13.92), (0.65, 13.95), (0.65, 14.02)]
    lathe("necking", necking, 48, material)
    lathe("egg-band", [(0.64, 14.0), (0.64, 14.36)], 48, material)
    for index in range(16):
        angle = (index + 0.5) / 16 * 2 * math.pi
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=1.0, location=(0.645 * math.cos(angle), 0.645 * math.sin(angle), 14.18), segments=10, ring_count=6
        )
        egg = bpy.context.active_object
        egg.scale = (0.065, 0.085, 0.13)
        egg.rotation_euler.z = angle
        egg.data.materials.append(material)
        mark_paint(egg, 0.0)
    echinus = [(0.64, 14.34), (0.66, 14.36), (0.66, 14.4)]
    echinus += [(0.66 + 0.25 * math.sin(math.pi / 2 * step / 8), 14.4 + 0.72 * step / 8) for step in range(1, 9)]
    echinus += [(0.92, 15.14), (0.92, 15.22), (0.88, 15.24)]
    lathe("echinus", echinus, 48, material)
    block("abacus", (1.96, 1.96, 0.24), 15.2, 0.05, material, 1.0)
    block("top-plate", (1.84, 1.84, 0.58), 15.42, 0.03, material, 1.0)


def build_pillar(material):
    base(material)
    lower_shaft(material)
    collar(material)
    fluted_shaft(material)
    capital(material)


def join_pillar():
    """Converts every part to mesh in world space and joins them into one object, as one MeshPart."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    pillar = bpy.context.active_object
    pillar.name = "pillar"
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return pillar


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
paint = paint_material()
build_pillar(paint)
pillar = join_pillar()
print("pillar triangles", triangle_count(pillar), "bounds", [tuple(round(c, 3) for c in corner) for corner in (pillar.bound_box[0], pillar.bound_box[6])])
unwrap([pillar])
bake([pillar], [paint], "pillar")
export_glb([pillar], "pillar")
