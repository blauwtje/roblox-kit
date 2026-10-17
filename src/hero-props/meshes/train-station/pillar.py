"""Station pillar: a Victorian cast-iron column for the concourse colonnade.

Blender units = studs. Column centered on the origin, floor at z 0, top at z 16, inside a 2 by 2 footprint,
so its bounds match the kit pillar (2 x 16 x 2) and the recorded-mesh stretch leaves it unscaled.
Cream paint (the wall role's color family) with the plinth, the collar and the abacus picked out in dark
bronze (the trim role's color family). Every part is one paint material switched by a "paint" attribute,
joined into one mesh, unwrapped and baked to color (with occlusion grime), roughness, metalness and tangent
normal maps by `lib`.
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

HEIGHT = 16.0
FLUTES = 16


def paint_material():
    material, stack = materials.paint_stack(
        [
            ([(0.3, "#cdc2a8"), (0.7, "#e3dbc6")], "#4f4a43"),
            ([(0.2, "#25221f"), (0.8, "#312c27")], "#57534c"),
        ],
        0.02,
    )
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf, coords, geometry = stack["bsdf"], stack["coords"], stack["geometry"]
    wear, worn, patch = stack["wear"], stack["worn"], stack["patch"]
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, separate.inputs["Vector"])
    height = separate.outputs["Z"]
    normal_z = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Normal"], normal_z.inputs["Vector"])
    # Rust only low down, where feet and mop buckets chip the plinth.
    rust_ramp = materials.ramp_node(nodes, [(0.6, "#000000"), (0.72, "#ffffff")])
    links.new(materials.noise(tree, coords, (4.0, 10.0)), rust_ramp.inputs["Fac"])
    low = nodes.new("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 0.0
    low.inputs["From Max"].default_value = 1.2
    low.inputs["To Min"].default_value = 1.0
    low.inputs["To Max"].default_value = 0.0
    links.new(height, low.inputs["Value"])
    rust = materials.math_node(tree, "MULTIPLY", (rust_ramp.outputs["Color"], low.outputs["Result"]))
    rusty = materials.mix_color(tree, "MIX", (rust, worn, materials.linear("#5c3720")))
    # Dust settles on surfaces that face up.
    dust_ramp = materials.ramp_node(nodes, [(0.55, "#000000"), (0.9, "#595959")])
    links.new(normal_z.outputs["Z"], dust_ramp.inputs["Fac"])
    dusty = materials.mix_color(tree, "MIX", (dust_ramp.outputs["Color"], rusty, materials.linear("#a39a88")))
    # Faint vertical streaks: noise stretched along the column.
    streak_mapping = nodes.new("ShaderNodeMapping")
    streak_mapping.inputs["Scale"].default_value = (9.0, 9.0, 0.45)
    links.new(coords, streak_mapping.inputs["Vector"])
    streak_ramp = materials.ramp_node(nodes, [(0.55, "#ffffff"), (0.8, "#e2dbcf")])
    links.new(materials.noise(tree, streak_mapping.outputs["Vector"], (2.0, 4.0)), streak_ramp.inputs["Fac"])
    streaked = materials.mix_color(tree, "MULTIPLY", (1.0, dusty, streak_ramp.outputs["Color"]))
    # Scuffs and floor grime fade out by about knee height.
    floor_ramp = materials.ramp_node(nodes, [(0.0, "#8f8472"), (1.0, "#ffffff")])
    floor_range = nodes.new("ShaderNodeMapRange")
    floor_range.inputs["From Max"].default_value = 1.8
    links.new(height, floor_range.inputs["Value"])
    scuff = materials.math_node(tree, "MULTIPLY", (floor_range.outputs["Result"], 1.0))
    scuff_noise = materials.math_node(tree, "ADD", (scuff, materials.noise(tree, coords, (6.0, 4.0))))
    links.new(materials.math_node(tree, "MULTIPLY", (scuff_noise, 0.75)), floor_ramp.inputs["Fac"])
    floored = materials.mix_color(tree, "MULTIPLY", (1.0, streaked, floor_ramp.outputs["Color"]))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.25
    grime_ramp = materials.ramp_node(nodes, [(0.0, "#73695a"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = materials.mix_color(tree, "MULTIPLY", (1.0, floored, grime_ramp.outputs["Color"]))
    links.new(grimy, bsdf.inputs["Base Color"])
    # Paint is dielectric; only bare worn edges are metal, and rust is not.
    unrusted = materials.math_node(tree, "SUBTRACT", (1.0, rust))
    metal = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "MULTIPLY", (wear, 0.7)), unrusted))
    links.new(metal, bsdf.inputs["Metallic"])
    paint_roughness = nodes.new("ShaderNodeMapRange")
    paint_roughness.inputs["To Min"].default_value = 0.42
    paint_roughness.inputs["To Max"].default_value = 0.62
    links.new(patch, paint_roughness.inputs["Value"])
    rough = materials.mix_float(tree, (wear, paint_roughness.outputs["Result"], 0.35))
    rough = materials.mix_float(tree, (rust, rough, 0.9))
    rough = materials.mix_float(tree, (dust_ramp.outputs["Color"], rough, 0.85))
    links.new(rough, bsdf.inputs["Roughness"])
    # Orange-peel paint and a cast surface: a fine, weak bump.
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.004
    links.new(materials.noise(tree, coords, (40.0, 4.0)), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material

def base(material):
    """Square plinth and step in bronze, then turned mouldings flaring into the shaft."""
    geometry.box("plinth", geometry.Box((2.0, 2.0, 0.5), 0.0, 0.035), materials.Surface(material, 1.0))
    geometry.box("plinth-step", geometry.Box((1.9, 1.9, 0.2), 0.48, 0.05), materials.Surface(material, 1.0))
    profile = [
        (0.89, 0.66), (0.91, 0.72), (0.92, 0.79), (0.91, 0.86), (0.87, 0.91), (0.83, 0.93), (0.82, 0.97),
        (0.77, 1.0), (0.73, 1.05), (0.72, 1.1), (0.74, 1.14), (0.77, 1.18), (0.77, 1.23), (0.74, 1.27),
        (0.7, 1.29), (0.69, 1.33), (0.665, 1.38), (0.65, 1.44), (0.64, 1.52),
    ]
    geometry.lathe("base-mouldings", geometry.Lathe(profile, 48), materials.Surface(material))


def lower_shaft(material):
    rings = [(0.64, 1.5), (0.637, 2.6), (0.633, 3.6), (0.63, 4.46)]
    geometry.lathe("lower-shaft", geometry.Lathe(rings, 48), materials.Surface(material))


def collar(material):
    """A bronze band between the plain and the fluted shaft, beaded round its middle."""
    profile = [
        (0.62, 4.4), (0.66, 4.42), (0.71, 4.47), (0.72, 4.52), (0.7, 4.57), (0.68, 4.58), (0.68, 4.76),
        (0.7, 4.77), (0.72, 4.82), (0.71, 4.87), (0.66, 4.92), (0.61, 4.94),
    ]
    geometry.lathe("collar", geometry.Lathe(profile, 48), materials.Surface(material, 1.0))
    for index in range(16):
        angle = index / 16 * 2 * math.pi
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.045, location=(0.68 * math.cos(angle), 0.68 * math.sin(angle), 4.67), segments=8, ring_count=4
        )
        bead = bpy.context.active_object
        bead.data.materials.append(material)
        materials.mark_paint(bead, 1.0)


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
        ends = geometry.smoothstep(SHAFT_BOTTOM + 0.05, SHAFT_BOTTOM + 0.32, z) * geometry.smoothstep(SHAFT_TOP - 0.05, SHAFT_TOP - 0.32, z)
        return 1 - depth * groove * ends / shaft_radius(z)

    heights = [SHAFT_BOTTOM, SHAFT_BOTTOM + 0.1, SHAFT_BOTTOM + 0.19, SHAFT_BOTTOM + 0.27, SHAFT_BOTTOM + 0.34]
    heights += [7.7, 10.5]
    heights += [SHAFT_TOP - 0.34, SHAFT_TOP - 0.27, SHAFT_TOP - 0.19, SHAFT_TOP - 0.1, SHAFT_TOP]
    rings = [(shaft_radius(z), z) for z in heights]
    geometry.lathe("fluted-shaft", geometry.Lathe(rings, FLUTES * 8, flutes), materials.Surface(material))


def capital(material):
    """Astragal ring, a plain necking, a band of eggs, a convex echinus, then a bronze abacus and top plate."""
    astragal = [(0.54, 13.26), (0.58, 13.29), (0.605, 13.34), (0.61, 13.4), (0.6, 13.46), (0.57, 13.5), (0.54, 13.52)]
    geometry.lathe("astragal", geometry.Lathe(astragal, 48), materials.Surface(material))
    necking = [(0.55, 13.5), (0.555, 13.8), (0.6, 13.82), (0.62, 13.86), (0.62, 13.92), (0.65, 13.95), (0.65, 14.02)]
    geometry.lathe("necking", geometry.Lathe(necking, 48), materials.Surface(material))
    geometry.lathe("egg-band", geometry.Lathe([(0.64, 14.0), (0.64, 14.36)], 48), materials.Surface(material))
    for index in range(16):
        angle = (index + 0.5) / 16 * 2 * math.pi
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=1.0, location=(0.645 * math.cos(angle), 0.645 * math.sin(angle), 14.18), segments=10, ring_count=6
        )
        egg = bpy.context.active_object
        egg.scale = (0.065, 0.085, 0.13)
        egg.rotation_euler.z = angle
        egg.data.materials.append(material)
        materials.mark_paint(egg, 0.0)
    echinus = [(0.64, 14.34), (0.66, 14.36), (0.66, 14.4)]
    echinus += [(0.66 + 0.25 * math.sin(math.pi / 2 * step / 8), 14.4 + 0.72 * step / 8) for step in range(1, 9)]
    echinus += [(0.92, 15.14), (0.92, 15.22), (0.88, 15.24)]
    geometry.lathe("echinus", geometry.Lathe(echinus, 48), materials.Surface(material))
    geometry.box("abacus", geometry.Box((1.96, 1.96, 0.24), 15.2, 0.05), materials.Surface(material, 1.0))
    geometry.box("top-plate", geometry.Box((1.84, 1.84, 0.58), 15.42, 0.03), materials.Surface(material, 1.0))


def build_pillar(material):
    base(material)
    lower_shaft(material)
    collar(material)
    fluted_shaft(material)
    capital(material)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    run.set_up_cycles()
    paint = paint_material()
    build_pillar(paint)
    pillar = geometry.finish("pillar")
    run.finish_mesh("pillar", [pillar], paint)


if __name__ == "__main__":
    build()
