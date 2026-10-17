"""UV unwrapping: one shared layout for the objects of a mesh, with optional texel-density rules."""

import math

import bpy

MARGIN = 0.004


def scale_uvs(obj, factor):
    """Scales the object's UVs about their center."""
    uvs = obj.data.uv_layers.active.data
    points = [uv.uv for uv in uvs]
    center_u = sum(point[0] for point in points) / len(points)
    center_v = sum(point[1] for point in points) / len(points)
    for uv in uvs:
        uv.uv = (center_u + (uv.uv[0] - center_u) * factor, center_v + (uv.uv[1] - center_v) * factor)


def matching_factors(obj, scale_rules):
    return [factor for prefix, factor in scale_rules.items() if obj.name.startswith(prefix)]


def apply_scale_rules(objects, scale_rules):
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in objects:
        for factor in matching_factors(obj, scale_rules):
            scale_uvs(obj, factor)
    bpy.ops.object.mode_set(mode="EDIT")


def unwrap(objects, scale_rules=None):
    """Smart-projects the objects into one UV layout and repacks the islands.

    `scale_rules` maps an object-name prefix to a UV scale factor applied to the matching objects before packing,
    which lowers or raises their texel density (a rule on a name that matches no object does nothing).
    """
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=MARGIN)
    if scale_rules:
        apply_scale_rules(objects, scale_rules)
    bpy.ops.uv.pack_islands(rotate=True, margin=MARGIN)
    bpy.ops.object.mode_set(mode="OBJECT")
