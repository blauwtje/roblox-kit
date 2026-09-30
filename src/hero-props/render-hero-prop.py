"""Renders a hero-prop GLB from three angles with Blender's Workbench engine in material colors.

Run headless: blender -b --factory-startup --python-exit-code 1 -P render-hero-prop.py -- <model.glb> <output folder>

Writes front.png, side.png and three-quarter.png into the output folder. Views are orthographic and
framed on the model's bounding box. Blender is Z up after the import, with the recipe's depth axis on
Blender's Y: the front looks along that axis, the side along the width axis, and the three-quarter
looks down from a corner.
"""

import os
import sys

import bpy
from mathutils import Vector

RESOLUTION = 768
FRAME_MARGIN = 1.15
BACKGROUND_COLOR = (0.62, 0.65, 0.68)

# Camera direction from the model center (Blender axes: X across, Y depth, Z up).
VIEWS = {
    "front": Vector((0.0, -1.0, 0.0)),
    "side": Vector((1.0, 0.0, 0.0)),
    "three-quarter": Vector((0.8, -0.8, 0.55)),
}


def import_model(glb_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def bounding_corners(meshes):
    return [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]


def set_up_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.world = bpy.data.worlds.new("background")
    scene.world.color = BACKGROUND_COLOR
    return scene


def add_camera(scene):
    camera_data = bpy.data.cameras.new("camera")
    camera_data.type = "ORTHO"
    camera_data.clip_end = 10000
    camera = bpy.data.objects.new("camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def frame_camera(camera, corners, direction):
    """Aims the camera along -direction at the box center and fits the corners' projected extent."""
    center = sum(corners, Vector()) / len(corners)
    radius = max((corner - center).length for corner in corners)
    camera.location = center + direction.normalized() * radius * 4
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    to_camera_space = camera.matrix_world.inverted()
    projected = [to_camera_space @ corner for corner in corners]
    extent = max(
        max(point.x for point in projected) - min(point.x for point in projected),
        max(point.y for point in projected) - min(point.y for point in projected),
    )
    camera.data.ortho_scale = extent * FRAME_MARGIN
    # Recenters on the projected extent, which is off the box center under a tilted view.
    shift_x = (max(point.x for point in projected) + min(point.x for point in projected)) / 2
    shift_y = (max(point.y for point in projected) + min(point.y for point in projected)) / 2
    camera.location = camera.matrix_world @ Vector((shift_x, shift_y, 0.0))


def main():
    model_path, output_folder = sys.argv[sys.argv.index("--") + 1 :]
    meshes = import_model(model_path)
    corners = bounding_corners(meshes)
    scene = set_up_scene()
    camera = add_camera(scene)
    for name, direction in VIEWS.items():
        frame_camera(camera, corners, direction)
        scene.render.filepath = os.path.join(output_folder, name + ".png")
        bpy.ops.render.render(write_still=True)


main()
