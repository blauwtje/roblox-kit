"""Station bench: a cast-iron park bench with a slatted wooden seat and back, for the concourse.

Blender units = studs. Bench centered on the origin, floor at z 0, length along X, seat facing -Y.
Light wood slats on shaped, green-painted (non-metal) cast-iron side frames, with a shorter seat overhang past
the frames. Built with procedural materials, joined into one mesh, unwrapped and baked to color (with occlusion
grime), roughness, metalness and tangent normal maps by `shared.py`.
"""

import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import (  # noqa: E402
    bake,
    export_glb,
    linear,
    link_object,
    mix_color,
    noise,
    ramp_node,
    set_up_cycles,
    triangle_count,
    unwrap,
)

LENGTH = 6.0
# Slat ends stand about 0.15 studs past the side frames' outer faces.
FRAME_X = 2.78
SEAT_Z = 1.5
random.seed(7)


def wood_material():
    material = bpy.data.materials.new("wood")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.35, 6.0, 6.0)
    links.new(coords, mapping.inputs["Vector"])
    grain = nodes.new("ShaderNodeTexWave")
    grain.wave_type = "RINGS"
    grain.inputs["Scale"].default_value = 0.7
    grain.inputs["Distortion"].default_value = 14.0
    grain.inputs["Detail"].default_value = 4.0
    links.new(mapping.outputs["Vector"], grain.inputs["Vector"])
    streaks = noise(nodes, links, mapping.outputs["Vector"], 3.0, 10.0)
    grain_mix = nodes.new("ShaderNodeMix")
    grain_mix.data_type = "FLOAT"
    grain_mix.inputs["Factor"].default_value = 0.45
    links.new(grain.outputs["Fac"], grain_mix.inputs["A"])
    links.new(streaks, grain_mix.inputs["B"])
    base = ramp_node(nodes, [(0.0, "#4d3c2a"), (0.5, "#8f7656"), (1.0, "#b8a07e")])
    links.new(grain_mix.outputs["Result"], base.inputs["Fac"])
    # Per-slat tone from the "tone" attribute each slat carries, since joining loses object identity.
    tone_attribute = nodes.new("ShaderNodeAttribute")
    tone_attribute.attribute_name = "tone"
    tone_range = nodes.new("ShaderNodeMapRange")
    tone_range.inputs["To Min"].default_value = 0.85
    tone_range.inputs["To Max"].default_value = 1.15
    links.new(tone_attribute.outputs["Fac"], tone_range.inputs["Value"])
    tone = nodes.new("ShaderNodeHueSaturation")
    links.new(tone_range.outputs["Result"], tone.inputs["Value"])
    links.new(base.outputs["Color"], tone.inputs["Color"])
    # Grey sun-bleached patches, dark stains, then occlusion grime.
    bleach_ramp = ramp_node(nodes, [(0.38, "#000000"), (0.62, "#ffffff")])
    links.new(noise(nodes, links, coords, 1.5, 6.0), bleach_ramp.inputs["Fac"])
    bleached = mix_color(nodes, links, "MIX", bleach_ramp.outputs["Color"], tone.outputs["Color"], linear("#aaa192"))
    # Stains stay dark so the lighter wood keeps its contrast.
    stain_ramp = ramp_node(nodes, [(0.6, "#ffffff"), (0.72, "#3a2a1c")])
    links.new(noise(nodes, links, coords, 4.0, 8.0), stain_ramp.inputs["Fac"])
    stained = mix_color(nodes, links, "MULTIPLY", 1.0, bleached, stain_ramp.outputs["Color"])
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.35
    grime_ramp = ramp_node(nodes, [(0.0, "#857a6c"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = mix_color(nodes, links, "MULTIPLY", 1.0, stained, grime_ramp.outputs["Color"])
    links.new(grimy, bsdf.inputs["Base Color"])
    roughness = nodes.new("ShaderNodeMapRange")
    roughness.inputs["To Min"].default_value = 0.6
    roughness.inputs["To Max"].default_value = 0.9
    links.new(streaks, roughness.inputs["Value"])
    links.new(roughness.outputs["Result"], bsdf.inputs["Roughness"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.01
    links.new(grain_mix.outputs["Result"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def iron_material():
    material = bpy.data.materials.new("iron")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    patch = noise(nodes, links, coords, 6.0, 8.0)
    paint = ramp_node(nodes, [(0.0, "#2a4030"), (1.0, "#3f5c44")])
    links.new(patch, paint.inputs["Fac"])
    # Edge wear: where a bevelled normal leaves the true normal. Pointiness cannot serve here, since it is
    # per vertex and the converted curves carry vertices only along their edges.
    bevel = nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = 0.03
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(bevel.outputs["Normal"], facing.inputs[0])
    links.new(nodes.new("ShaderNodeNewGeometry").outputs["Normal"], facing.inputs[1])
    edge_ramp = ramp_node(nodes, [(0.9, "#ffffff"), (0.97, "#000000")])
    links.new(facing.outputs["Value"], edge_ramp.inputs["Fac"])
    chip_ramp = ramp_node(nodes, [(0.42, "#000000"), (0.55, "#ffffff")])
    links.new(noise(nodes, links, coords, 14.0, 6.0), chip_ramp.inputs["Fac"])
    wear = nodes.new("ShaderNodeMath")
    wear.operation = "MULTIPLY"
    links.new(edge_ramp.outputs["Color"], wear.inputs[0])
    links.new(chip_ramp.outputs["Color"], wear.inputs[1])
    worn = mix_color(nodes, links, "MIX", wear.outputs["Value"], paint.outputs["Color"], linear("#8a877c"))
    rust_ramp = ramp_node(nodes, [(0.62, "#000000"), (0.75, "#ffffff")])
    links.new(noise(nodes, links, coords, 3.0, 10.0), rust_ramp.inputs["Fac"])
    rusty = mix_color(nodes, links, "MIX", rust_ramp.outputs["Color"], worn, linear("#5c3720"))
    # Paint and rust are dielectric; only bare worn edges are metal. A metal paint darkens to near black
    # under Roblox's dim indoor reflections.
    edge_metal = nodes.new("ShaderNodeMath")
    edge_metal.operation = "MULTIPLY"
    edge_metal.inputs[1].default_value = 0.7
    links.new(wear.outputs["Value"], edge_metal.inputs[0])
    unrusted = nodes.new("ShaderNodeMath")
    unrusted.operation = "SUBTRACT"
    unrusted.inputs[0].default_value = 1.0
    links.new(rust_ramp.outputs["Color"], unrusted.inputs[1])
    metal = nodes.new("ShaderNodeMath")
    metal.operation = "MULTIPLY"
    links.new(edge_metal.outputs["Value"], metal.inputs[0])
    links.new(unrusted.outputs["Value"], metal.inputs[1])
    links.new(metal.outputs["Value"], bsdf.inputs["Metallic"])
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.3
    grime_ramp = ramp_node(nodes, [(0.0, "#6a6258"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = mix_color(nodes, links, "MULTIPLY", 1.0, rusty, grime_ramp.outputs["Color"])
    links.new(grimy, bsdf.inputs["Base Color"])
    roughness = nodes.new("ShaderNodeMapRange")
    roughness.inputs["To Min"].default_value = 0.4
    roughness.inputs["To Max"].default_value = 0.8
    links.new(patch, roughness.inputs["Value"])
    links.new(roughness.outputs["Result"], bsdf.inputs["Roughness"])
    return material


def tube(name, points, x, radius, material, resolution=6):
    """A cast-iron member: a bezier tube through (y, z, thickness) points, flattened across the bench."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.resolution_u = resolution
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, (y, z, thickness) in zip(spline.bezier_points, points):
        point.co = (0.0, y, z)
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
        point.radius = thickness
    obj = link_object(name, curve, material)
    obj.location.x = x
    obj.scale.x = 0.36
    return obj


def plate(name, outline, holes, x, thickness, material):
    """A flat cast web in the bench's side plane: a filled outline of (y, z) points with round holes."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.extrude = thickness / 2
    curve.bevel_depth = 0.012
    curve.bevel_resolution = 1
    curve.resolution_u = 4
    for points in [outline] + [circle(*hole) for hole in holes]:
        spline = curve.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for point, (y, z) in zip(spline.points, points):
            point.co = (y, z, 0.0, 1.0)
        spline.use_cyclic_u = True
    obj = link_object(name, curve, material)
    obj.location.x = x
    # Local X and Y become world Y and Z; the extrusion runs along world X.
    obj.rotation_euler = (math.pi / 2, 0.0, math.pi / 2)
    return obj


def circle(center_y, center_z, radius, steps=12):
    return [
        (center_y + radius * math.cos(step / steps * 2 * math.pi), center_z + radius * math.sin(step / steps * 2 * math.pi))
        for step in range(steps)
    ]


def chaikin(points, rounds=2):
    """Rounds the corners of a closed (y, z) outline by Chaikin corner cutting; straight edges stay put."""
    for _ in range(rounds):
        cut = []
        for (ay, az), (by, bz) in zip(points, points[1:] + points[:1]):
            cut.append((0.75 * ay + 0.25 * by, 0.75 * az + 0.25 * bz))
            cut.append((0.25 * ay + 0.75 * by, 0.25 * az + 0.75 * bz))
        points = cut
    return points


def foot_outline(heel_y, direction):
    """A cast foot under a leg, flat on the floor, its toe pointing along direction (-1 front, +1 back)."""
    shape = [
        (-0.16, 0.0), (0.26, 0.0), (0.3, 0.05), (0.27, 0.11), (0.19, 0.14), (0.1, 0.15),
        (0.06, 0.24), (0.06, 0.33), (-0.07, 0.33), (-0.09, 0.21), (-0.14, 0.12), (-0.17, 0.05),
    ]
    return chaikin([(heel_y + direction * u, z) for u, z in shape])


def scroll(center_y, center_z, start_radius, turns, start_angle, direction):
    """Points of a flat spiral curling inward, as (y, z, thickness)."""
    steps = int(turns * 8)
    points = []
    for step in range(steps + 1):
        progress = step / steps
        angle = start_angle + direction * progress * turns * 2 * math.pi
        radius = start_radius * (1 - 0.75 * progress)
        points.append((center_y + radius * math.cos(angle), center_z + radius * math.sin(angle), 1 - 0.55 * progress))
    return points


def side_frame(x, iron):
    tube(f"rear-{x}", [(1.0, 0.24, 1.2), (0.8, 0.6, 1.0), (0.72, 1.45, 1.2), (0.84, 2.3, 0.95), (0.98, 2.85, 0.85)], x, 0.15, iron)
    tube(f"rear-curl-{x}", scroll(0.88, 2.97, 0.13, 0.9, 0.0, 1), x, 0.1, iron, 2)
    tube(f"front-{x}", [(-0.76, 1.45, 1.1), (-0.8, 0.9, 0.85), (-0.92, 0.4, 1.0), (-1.04, 0.24, 1.2)], x, 0.16, iron)
    plate(f"front-foot-{x}", foot_outline(-1.04, -1), [], x, 0.2, iron)
    plate(f"rear-foot-{x}", foot_outline(1.0, 1), [], x, 0.2, iron)
    tube(f"rail-{x}", [(-0.95, 1.4, 1.0), (0.0, 1.37, 0.9), (0.75, 1.42, 1.0)], x, 0.12, iron)
    tube(f"brace-{x}", [(-0.84, 0.55, 0.8), (-0.1, 0.8, 0.6), (0.78, 0.55, 0.8)], x, 0.1, iron)
    tube(f"arm-{x}", [(0.86, 2.3, 0.9), (0.2, 2.25, 1.0), (-0.6, 2.15, 1.15), (-0.95, 2.04, 1.1)], x, 0.14, iron)
    tube(f"arm-curl-{x}", scroll(-0.97, 1.9, 0.17, 1.2, math.pi / 2, -1), x, 0.11, iron, 2)
    tube(f"post-{x}", [(-0.76, 1.45, 1.1), (-0.7, 1.7, 0.8), (-0.82, 1.95, 0.9)], x, 0.12, iron)
    # Cast web between the legs under the seat, pierced by three round holes.
    plate(
        f"web-{x}",
        [(-0.78, 1.36), (0.72, 1.36), (0.76, 1.1), (0.74, 0.62), (0.3, 0.78), (-0.1, 0.82), (-0.5, 0.76), (-0.84, 0.62), (-0.8, 1.1)],
        [(-0.42, 1.1, 0.13), (0.0, 1.12, 0.14), (0.4, 1.1, 0.13)],
        x,
        0.06,
        iron,
    )


def slat(name, location, size, tilt, wood):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    obj.rotation_euler.x = tilt + random.uniform(-0.012, 0.012)
    obj.rotation_euler.z = random.uniform(-0.004, 0.004)
    bpy.ops.object.transform_apply(scale=True)
    tone = obj.data.attributes.new("tone", "FLOAT", "POINT")
    tone.data.foreach_set("value", [random.random()] * len(obj.data.vertices))
    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    obj.data.materials.append(wood)
    return obj


def bolt(location, iron):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.04, location=location, segments=8, ring_count=4)
    obj = bpy.context.active_object
    obj.scale.z = 0.5
    obj.data.materials.append(iron)


def build_bench(wood, iron):
    for x in (-FRAME_X, FRAME_X):
        side_frame(x, iron)
    for index in range(6):
        y = -0.88 + index * 0.3
        slat(f"seat-{index}", (0, y, SEAT_Z + 0.05), (LENGTH, 0.25, 0.09), 0.0, wood)
        for x in (-FRAME_X, FRAME_X):
            bolt((x, y, SEAT_Z + 0.1), iron)
    lean = math.atan2(0.12, 0.85)
    for index in range(5):
        height = 1.78 + index * 0.24
        y = 0.72 + (height - 1.45) * 0.17 + 0.07
        slat(f"back-{index}", (0, y - 0.1, height), (LENGTH, 0.07, 0.18), -lean, wood)


def join_bench():
    """Converts every part to mesh in world space and joins them into one object, as one MeshPart."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    bench = bpy.context.active_object
    bench.name = "bench"
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return bench


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
wood, iron = wood_material(), iron_material()
build_bench(wood, iron)
bench = join_bench()
print("bench triangles", triangle_count(bench))
unwrap([bench])
bake([bench], [wood, iron], "bench")
export_glb([bench], "bench")
