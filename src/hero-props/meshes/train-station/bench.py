"""Station bench: a cast-iron park bench with a slatted wooden seat and back, for the concourse.

Blender units = studs. Bench centered on the origin, floor at z 0, length along X, seat facing -Y.
Light wood slats on shaped, green-painted (non-metal) cast-iron side frames, with a shorter seat overhang past
the frames. Every part is one paint material switched by a "paint" attribute (0 wood, 1 iron), joined into one
mesh, unwrapped and baked to color (with occlusion grime), roughness, metalness and tangent normal maps by `lib`.
"""

import importlib
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
geometry = importlib.import_module("lib.geometry")
materials = importlib.import_module("lib.materials")
run = importlib.import_module("lib.run")

LENGTH = 6.0
FRAME_X = 2.78
SEAT_Z = 1.5
WOOD, IRON = 0.0, 1.0
random.seed(7)


def paint_material():
    material, stack = materials.paint_stack(
        [
            ([(0.0, "#4d3c2a"), (0.5, "#8f7656"), (1.0, "#b8a07e")], "#aaa192"),
            ([(0.0, "#2a4030"), (1.0, "#3f5c44")], "#8a877c"),
        ],
        0.03,
    )
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf, coords, wear, worn, patch = (stack[key] for key in ("bsdf", "coords", "wear", "worn", "patch"))
    iron = stack["dark_amount"]
    tone_attribute = nodes.new("ShaderNodeAttribute")
    tone_attribute.attribute_name = "tone"
    tone = nodes.new("ShaderNodeMapRange")
    tone.inputs["To Min"].default_value = 0.85
    tone.inputs["To Max"].default_value = 1.15
    links.new(tone_attribute.outputs["Fac"], tone.inputs["Value"])
    wood_amount = materials.math_node(tree, "SUBTRACT", (1.0, iron))
    tone_factor = materials.math_node(tree, "MULTIPLY", (tone.outputs["Result"], wood_amount))
    toned = materials.mix_color(tree, "MULTIPLY", (wood_amount, worn, tone_factor))
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.35, 6.0, 6.0)
    links.new(coords, mapping.inputs["Vector"])
    grain = nodes.new("ShaderNodeTexWave")
    grain.wave_type = "RINGS"
    grain.inputs["Scale"].default_value = 0.7
    grain.inputs["Distortion"].default_value = 14.0
    grain.inputs["Detail"].default_value = 4.0
    links.new(mapping.outputs["Vector"], grain.inputs["Vector"])
    streaks = materials.noise(tree, mapping.outputs["Vector"], (3.0, 10.0))
    grain_mix = materials.mix_float(tree, (0.45, grain.outputs["Fac"], streaks))
    grain_tint = materials.ramp_node(nodes, [(0.0, "#a99a84"), (1.0, "#ffffff")])
    links.new(grain_mix, grain_tint.inputs["Fac"])
    grained = materials.mix_color(tree, "MULTIPLY", (wood_amount, toned, grain_tint.outputs["Color"]))
    stain_ramp = materials.ramp_node(nodes, [(0.6, "#ffffff"), (0.72, "#3a2a1c")])
    links.new(materials.noise(tree, coords, (4.0, 8.0)), stain_ramp.inputs["Fac"])
    stained = materials.mix_color(tree, "MULTIPLY", (wood_amount, grained, stain_ramp.outputs["Color"]))
    rust_ramp = materials.ramp_node(nodes, [(0.62, "#000000"), (0.75, "#ffffff")])
    links.new(materials.noise(tree, coords, (3.0, 10.0)), rust_ramp.inputs["Fac"])
    rust = materials.math_node(tree, "MULTIPLY", (rust_ramp.outputs["Color"], iron))
    rusty = materials.mix_color(tree, "MIX", (rust, stained, materials.linear("#5c3720")))
    occlusion = nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.inputs["Distance"].default_value = 0.3
    grime_ramp = materials.ramp_node(nodes, [(0.0, "#6a6258"), (1.0, "#ffffff")])
    links.new(occlusion.outputs["AO"], grime_ramp.inputs["Fac"])
    grimy = materials.mix_color(tree, "MULTIPLY", (1.0, rusty, grime_ramp.outputs["Color"]))
    links.new(grimy, bsdf.inputs["Base Color"])
    unrusted = materials.math_node(tree, "SUBTRACT", (1.0, rust))
    edge_metal = materials.math_node(tree, "MULTIPLY", (materials.math_node(tree, "MULTIPLY", (wear, 0.7)), iron))
    links.new(materials.math_node(tree, "MULTIPLY", (edge_metal, unrusted)), bsdf.inputs["Metallic"])
    iron_roughness = nodes.new("ShaderNodeMapRange")
    iron_roughness.inputs["To Min"].default_value = 0.4
    iron_roughness.inputs["To Max"].default_value = 0.8
    links.new(patch, iron_roughness.inputs["Value"])
    wood_roughness = nodes.new("ShaderNodeMapRange")
    wood_roughness.inputs["To Min"].default_value = 0.6
    wood_roughness.inputs["To Max"].default_value = 0.9
    links.new(streaks, wood_roughness.inputs["Value"])
    rough = materials.mix_float(tree, (iron, wood_roughness.outputs["Result"], iron_roughness.outputs["Result"]))
    links.new(rough, bsdf.inputs["Roughness"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.01
    links.new(materials.math_node(tree, "MULTIPLY", (grain_mix, wood_amount)), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
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
    obj = materials.link_object(name, curve, material)
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
    obj = materials.link_object(name, curve, material)
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


def side_frame(x, paint):
    tube(f"rear-{x}", [(1.0, 0.24, 1.2), (0.8, 0.6, 1.0), (0.72, 1.45, 1.2), (0.84, 2.3, 0.95), (0.98, 2.85, 0.85)], x, 0.15, paint)
    tube(f"rear-curl-{x}", scroll(0.88, 2.97, 0.13, 0.9, 0.0, 1), x, 0.1, paint, 2)
    tube(f"front-{x}", [(-0.76, 1.45, 1.1), (-0.8, 0.9, 0.85), (-0.92, 0.4, 1.0), (-1.04, 0.24, 1.2)], x, 0.16, paint)
    plate(f"front-foot-{x}", foot_outline(-1.04, -1), [], x, 0.2, paint)
    plate(f"rear-foot-{x}", foot_outline(1.0, 1), [], x, 0.2, paint)
    tube(f"rail-{x}", [(-0.95, 1.4, 1.0), (0.0, 1.37, 0.9), (0.75, 1.42, 1.0)], x, 0.12, paint)
    tube(f"brace-{x}", [(-0.84, 0.55, 0.8), (-0.1, 0.8, 0.6), (0.78, 0.55, 0.8)], x, 0.1, paint)
    tube(f"arm-{x}", [(0.86, 2.3, 0.9), (0.2, 2.25, 1.0), (-0.6, 2.15, 1.15), (-0.95, 2.04, 1.1)], x, 0.14, paint)
    tube(f"arm-curl-{x}", scroll(-0.97, 1.9, 0.17, 1.2, math.pi / 2, -1), x, 0.11, paint, 2)
    tube(f"post-{x}", [(-0.76, 1.45, 1.1), (-0.7, 1.7, 0.8), (-0.82, 1.95, 0.9)], x, 0.12, paint)
    # Cast web between the legs under the seat, pierced by three round holes.
    plate(
        f"web-{x}",
        [(-0.78, 1.36), (0.72, 1.36), (0.76, 1.1), (0.74, 0.62), (0.3, 0.78), (-0.1, 0.82), (-0.5, 0.76), (-0.84, 0.62), (-0.8, 1.1)],
        [(-0.42, 1.1, 0.13), (0.0, 1.12, 0.14), (0.4, 1.1, 0.13)],
        x,
        0.06,
        paint,
    )


def slat(name, box, paint):
    """box holds the slat's location, size and tilt."""
    location, size, tilt = box["location"], box["size"], box["tilt"]
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
    materials.mark_paint(obj, WOOD)
    obj.data.materials.append(paint)
    return obj


def bolt(location, paint):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.04, location=location, segments=8, ring_count=4)
    obj = bpy.context.active_object
    obj.scale.z = 0.5
    obj.data.materials.append(paint)


def build_bench(paint):
    for x in (-FRAME_X, FRAME_X):
        side_frame(x, paint)
    for index in range(6):
        y = -0.88 + index * 0.3
        slat(f"seat-{index}", {"location": (0, y, SEAT_Z + 0.05), "size": (LENGTH, 0.25, 0.09), "tilt": 0.0}, paint)
        for x in (-FRAME_X, FRAME_X):
            bolt((x, y, SEAT_Z + 0.1), paint)
    lean = math.atan2(0.12, 0.85)
    for index in range(5):
        height = 1.78 + index * 0.24
        y = 0.72 + (height - 1.45) * 0.17 + 0.07
        slat(f"back-{index}", {"location": (0, y - 0.1, height), "size": (LENGTH, 0.07, 0.18), "tilt": -lean}, paint)


def mark_parts():
    """Converts every curve to mesh and gives each part its paint value: curves are iron unless named otherwise."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    for obj in bpy.context.scene.objects:
        if "paint" not in obj.data.attributes:
            materials.mark_paint(obj, IRON)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    run.set_up_cycles()
    paint = paint_material()
    build_bench(paint)
    mark_parts()
    bench = geometry.finish("bench")
    run.finish_mesh("bench", [bench], paint)


if __name__ == "__main__":
    build()
