"""Station ticket counter: a heritage ticket office for the ticket hall, two windows under a canopy and pediment.

Blender units = studs. Width along X (14), depth along Y (3), height along Z (7.87): floor at z 0, back at y -1.5,
customer face toward +Y. The GLB exporter turns Blender +Y into glTF -Z and Roblox imports glTF axes as they are,
so the face lands on the mesh's local -Z, the customer side of the kit counter (luau/props/ticket-counter.luau),
and the bounds match the kit counter's 14 x 7.87 x 3, so the recorded-mesh stretch leaves it unscaled.
A dark-green body holding three brick panels under a pale top, two dark-glass ticket windows on amber sills
between green posts, and a pale canopy with amber label bars under a raised green pediment. Each look is a
small procedural material; the objects are joined into one mesh, unwrapped and baked to color, roughness,
metalness and tangent normal maps by `shared.py`.
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import (  # noqa: E402
    bake,
    export_glb,
    flat_material,
    linear,
    link_object,
    noise,
    ramp_node,
    set_up_cycles,
    triangle_count,
    unwrap,
)

HALF_WIDTH, HALF_DEPTH, HEIGHT = 7.0, 1.5, 7.87
TOP_Z = 3.5  # the counter top's upper face
HEAD_Z = 6.0  # the canopy's underside
WINDOWS = ((-3.3, 5.6), (3.3, 5.6))  # window center x, width


def painted_material(name, dark, light, roughness, metallic=0.0, scale=5.0):
    """A paint that varies between two tones in soft patches, with a fine bump."""
    material = bpy.data.materials.new(name)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    ramp = ramp_node(nodes, [(0.0, dark), (1.0, light)])
    links.new(noise(nodes, links, coords, scale, 8.0), ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    bump.inputs["Distance"].default_value = 0.01
    links.new(noise(nodes, links, coords, 40.0, 4.0), bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def brick_material():
    material = bpy.data.materials.new("brick")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords, split.inputs["Vector"])
    face = nodes.new("ShaderNodeCombineXYZ")
    links.new(split.outputs["X"], face.inputs["X"])
    links.new(split.outputs["Z"], face.inputs["Y"])
    bricks = nodes.new("ShaderNodeTexBrick")
    bricks.inputs["Scale"].default_value = 3.2
    bricks.inputs["Mortar Size"].default_value = 0.025
    bricks.inputs["Mortar Smooth"].default_value = 0.0
    bricks.inputs["Bias"].default_value = 0.0
    bricks.inputs["Brick Width"].default_value = 0.5
    bricks.inputs["Row Height"].default_value = 0.25
    bricks.inputs["Color1"].default_value = linear("#8a3f2d")
    bricks.inputs["Color2"].default_value = linear("#a8553a")
    bricks.inputs["Mortar"].default_value = linear("#a79f8c")
    links.new(face.outputs["Vector"], bricks.inputs["Vector"])
    links.new(bricks.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.02
    links.new(bricks.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


MATERIALS = {}


def make_materials():
    MATERIALS["green"] = painted_material("green", "#1f3a2b", "#2f5640", 0.45)
    MATERIALS["brick"] = brick_material()
    MATERIALS["cream"] = painted_material("cream", "#cfc4a6", "#ece4cc", 0.55, scale=3.0)
    MATERIALS["amber"] = painted_material("amber", "#c4872a", "#e6ab45", 0.4)
    MATERIALS["bronze"] = painted_material("bronze", "#3d2e1c", "#6b5232", 0.4, metallic=0.85)
    MATERIALS["glass"] = flat_material("glass", "#16222a", 0.08)
    MATERIALS["black"] = flat_material("black", "#0c0b0a", 0.7)


def box(name, x0, x1, y0, y1, z0, z1, role, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = min(bevel, (x1 - x0) / 3, (y1 - y0) / 3, (z1 - z0) / 3)
        modifier.segments = 2
    obj.data.materials.append(MATERIALS[role])
    return obj


def prism(name, outline, y0, y1, role):
    """A polygon given as (x, z) points, extruded from y0 to y1."""
    mesh = bpy.data.meshes.new(name)
    shape = bmesh.new()
    vertices = [shape.verts.new((x, y0, z)) for x, z in outline]
    face = shape.faces.new(vertices)
    if face.normal.y > 0:
        face.normal_flip()
    result = bmesh.ops.extrude_face_region(shape, geom=[face])
    moved = [item for item in result["geom"] if isinstance(item, bmesh.types.BMVert)]
    bmesh.ops.translate(shape, verts=moved, vec=(0, y1 - y0, 0))
    bmesh.ops.recalc_face_normals(shape, faces=shape.faces)
    shape.to_mesh(mesh)
    shape.free()
    return link_object(name, mesh, MATERIALS[role])


def body():
    box("plinth", -HALF_WIDTH, HALF_WIDTH, -HALF_DEPTH, HALF_DEPTH, 0.0, 0.35, "bronze", 0.04)
    box("body", -6.8, 6.8, -1.4, 1.15, 0.35, TOP_Z - 0.3, "green", 0.05)
    box("top", -HALF_WIDTH, HALF_WIDTH, -HALF_DEPTH, HALF_DEPTH, TOP_Z - 0.3, TOP_Z, "cream", 0.06)
    for index, x in enumerate((-4.4, 0.0, 4.4)):
        box(f"panel-{index}", x - 1.8, x + 1.8, 1.1, 1.22, 0.65, TOP_Z - 0.6, "brick", 0.0)
        for name, z0, z1 in (("bottom", 0.55, 0.65), ("top", TOP_Z - 0.6, TOP_Z - 0.5)):
            box(f"panel-{index}-{name}-bead", x - 1.9, x + 1.9, 1.1, 1.26, z0, z1, "bronze", 0.02)
        for side, edge in (("left", x - 1.9), ("right", x + 1.8)):
            box(f"panel-{index}-{side}-bead", edge, edge + 0.1, 1.1, 1.26, 0.65, TOP_Z - 0.6, "bronze", 0.02)


def windows():
    posts = (-6.6, 0.0, 6.6)
    for index, x in enumerate(posts):
        box(f"post-{index}", x - 0.3, x + 0.3, -0.7, 1.0, TOP_Z, HEAD_Z, "green", 0.04)
    box("back-wall", -HALF_WIDTH + 0.3, HALF_WIDTH - 0.3, -1.4, -1.2, TOP_Z, HEAD_Z, "green", 0.03)
    for index, (x, width) in enumerate(WINDOWS):
        left, right = x - width / 2, x + width / 2
        box(f"sill-{index}", left - 0.1, right + 0.1, -0.7, 1.35, TOP_Z, TOP_Z + 0.2, "amber", 0.04)
        box(f"glass-{index}", left, right, 0.25, 0.3, TOP_Z + 0.55, HEAD_Z - 0.15, "glass", 0.0)
        box(f"dark-{index}", left, right, -1.2, -1.0, TOP_Z + 0.2, HEAD_Z, "black", 0.0)
        # Bronze frame round the glass, a mullion, and the ticket slot under it.
        box(f"frame-top-{index}", left, right, 0.15, 0.4, HEAD_Z - 0.2, HEAD_Z - 0.1, "bronze", 0.02)
        box(f"frame-low-{index}", left, right, 0.15, 0.4, TOP_Z + 0.5, TOP_Z + 0.6, "bronze", 0.02)
        box(f"mullion-{index}", x - 0.04, x + 0.04, 0.15, 0.4, TOP_Z + 0.5, HEAD_Z - 0.1, "bronze", 0.01)
        box(f"slot-plate-{index}", x - 0.9, x + 0.9, 0.15, 0.45, TOP_Z + 0.2, TOP_Z + 0.5, "bronze", 0.03)
        box(f"slot-{index}", x - 0.6, x + 0.6, 0.4, 0.5, TOP_Z + 0.3, TOP_Z + 0.4, "black", 0.0)
        for step in range(3):
            box(f"voice-{index}-{step}", x + 1.5 + step * 0.1, x + 1.55 + step * 0.1, 0.15, 0.35, TOP_Z + 1.0, TOP_Z + 1.6, "black", 0.0)


def canopy():
    box("canopy", -HALF_WIDTH, HALF_WIDTH, -1.2, HALF_DEPTH, HEAD_Z, HEAD_Z + 0.5, "cream", 0.05)
    box("canopy-bead", -HALF_WIDTH, HALF_WIDTH, 1.2, 1.5, HEAD_Z + 0.4, HEAD_Z + 0.5, "bronze", 0.02)
    for index, (x, _) in enumerate(WINDOWS):
        box(f"label-{index}", x - 1.3, x + 1.3, 1.4, 1.5, HEAD_Z + 0.08, HEAD_Z + 0.36, "amber", 0.02)
        for edge in (-1.35, 1.25):
            box(f"label-{index}-edge-{edge}", x + edge, x + edge + 0.1, 1.4, 1.5, HEAD_Z + 0.05, HEAD_Z + 0.4, "bronze", 0.01)
    # The raised pediment: a green gable with a cream inset and a bronze cornice line.
    base = HEAD_Z + 0.5
    prism("pediment", [(-3.8, base), (3.8, base), (3.8, base + 0.5), (1.2, HEIGHT), (-1.2, HEIGHT), (-3.8, base + 0.5)], -0.7, 0.9, "green")
    prism("pediment-inset", [(-3.2, base + 0.12), (3.2, base + 0.12), (3.2, base + 0.4), (1.0, HEIGHT - 0.25), (-1.0, HEIGHT - 0.25), (-3.2, base + 0.4)], 0.9, 0.96, "cream")
    box("pediment-cornice", -3.9, 3.9, -0.8, 1.0, base, base + 0.12, "bronze", 0.03)
    box("pediment-crest", -1.3, 1.3, -0.8, 1.0, HEIGHT - 0.1, HEIGHT, "bronze", 0.02)


def build_counter():
    body()
    windows()
    canopy()


def join_counter():
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    counter = bpy.context.active_object
    counter.name = "ticket-counter"
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return counter


bpy.ops.wm.read_factory_settings(use_empty=True)
set_up_cycles()
make_materials()
build_counter()
counter = join_counter()
corners = [Vector(corner) for corner in counter.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
print("ticket-counter triangles", triangle_count(counter), "size", tuple(round(v, 4) for v in high - low), "min", tuple(round(v, 4) for v in low), "max", tuple(round(v, 4) for v in high))
unwrap([counter])
bake([counter], list(MATERIALS.values()), "ticket-counter")
export_glb([counter], "ticket-counter")
