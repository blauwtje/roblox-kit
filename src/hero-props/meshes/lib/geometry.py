"""Mesh parts in Blender units (studs): boxes, turned parts, prisms and rings, and the join that finishes them."""

import math
from typing import NamedTuple

import bmesh
import bpy

from .materials import Surface, link_object, mark_paint


class Box(NamedTuple):
    size: tuple
    z_bottom: float
    bevel_width: float
    center: tuple = (0.0, 0.0)
    bevel_segments: int = 2


class Lathe(NamedTuple):
    rings: list
    segments: int
    radial: object = None
    caps: tuple = (True, True)
    flip: bool = False


class Prism(NamedTuple):
    outline: list
    z_bottom: float
    height: float


class Ring(NamedTuple):
    radius: float
    tube: float
    z: float
    segments: int = 48
    tube_segments: int = 8
    squash: float = 1.0


def smoothstep(edge0, edge1, value):
    t = min(1.0, max(0.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def mesh_object(name, bm, surface):
    """Turns a bmesh into a linked object of one paint value, and frees the bmesh."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link_object(name, mesh, surface.material)
    mark_paint(obj, surface.paint)
    return obj


def box(name, shape, surface):
    """A block over `center` (x, y), its edges bevelled unless the width is 0."""
    size = shape.size
    bpy.ops.mesh.primitive_cube_add(size=1, location=(*shape.center, shape.z_bottom + size[2] / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(surface.material)
    mark_paint(obj, surface.paint)
    if shape.bevel_width > 0:
        bevel = obj.modifiers.new("bevel", "BEVEL")
        bevel.width = shape.bevel_width
        bevel.segments = shape.bevel_segments
    return obj


def lathe(name, shape, surface):
    """A turned part: (radius, z) rings from bottom to top, capped where `caps` says; radial(theta, z) scales a radius.

    `flip` turns the faces toward the axis, since Roblox culls back faces.
    """
    rings, segments, radial, caps, flip = shape
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
    if caps[0]:
        bm.faces.new(list(reversed(grid[0])))
    if caps[1]:
        bm.faces.new(grid[-1])
    obj = mesh_object(name, bm, surface)
    if flip:
        reverse_faces(obj.data)
    return obj


def prism(name, shape, surface):
    """A straight extrusion of an (x, y) outline, counter-clockwise from above, capped at both ends."""
    outline, z_bottom, height = shape
    bm = bmesh.new()
    lower = [bm.verts.new((x, y, z_bottom)) for x, y in outline]
    upper = [bm.verts.new((x, y, z_bottom + height)) for x, y in outline]
    for step in range(len(outline)):
        following = (step + 1) % len(outline)
        bm.faces.new((lower[step], lower[following], upper[following], upper[step]))
    bm.faces.new(list(reversed(lower)))
    bm.faces.new(upper)
    return mesh_object(name, bm, surface)


def ring(name, shape, surface):
    """A torus around the vertical axis: the tube's center circle has `radius` at height `z`."""
    radius, tube, z, segments, tube_segments, squash = shape
    bm = bmesh.new()
    grid = []
    for step in range(segments):
        theta = step / segments * 2 * math.pi
        row = []
        for side in range(tube_segments):
            phi = side / tube_segments * 2 * math.pi
            reach = radius + tube * math.cos(phi)
            row.append(bm.verts.new((reach * math.cos(theta), reach * math.sin(theta), z + tube * squash * math.sin(phi))))
        grid.append(row)
    for step in range(segments):
        following = (step + 1) % segments
        for side in range(tube_segments):
            around = (side + 1) % tube_segments
            bm.faces.new((grid[step][side], grid[following][side], grid[following][around], grid[step][around]))
    return mesh_object(name, bm, surface)


def reverse_faces(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()


def mirror_y(obj):
    """A copy of the object mirrored across the XZ plane (y becomes -y), with its faces turned back outward."""
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = f"{obj.name}-mirror"
    bpy.context.collection.objects.link(copy)
    for vertex in copy.data.vertices:
        vertex.co.y = -vertex.co.y
    reverse_faces(copy.data)
    return copy


def finish(name, smooth_angle=40):
    """Converts every part to mesh in world space and joins them into one object named `name`, smooth below the angle."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = name
    bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth_angle))
    return joined
