"""Bake a JSON keyframe list per bone into an R15 avatar-animation FBX.

Run headless with Blender 5.x:
    blender -b --factory-startup -P keyframes-to-fbx.py -- <keyframes.json> <out.fbx>

Input: {"fps": 30, "bones": {"<R15 bone>": [{"frame": 1, "rotation": [x, y, z]}]}}
Rotation is XYZ Euler degrees in the bone's local axes. Only rotation is keyed,
so the Root and HumanoidRootPart never translate, which Studio requires.
"""

import json
import math
import sys

import bpy
from bpy_extras import anim_utils
from mathutils import Euler

# name: (parent, head, tail). Names and the chain Root > HumanoidRootPart >
# LowerTorso > UpperTorso > Head are Roblox's documented R15 joint names; the
# limb parents and the positions are an approximate block rig (arms hang down).
# Lift the limit by exporting from the official R15 reference rig instead.
R15_BONES = {
    "Root": (None, (0, 0, 0), (0, 0, 1)),
    "HumanoidRootPart": ("Root", (0, 0, 1), (0, 0, 2)),
    "LowerTorso": ("HumanoidRootPart", (0, 0, 2), (0, 0, 2.4)),
    "UpperTorso": ("LowerTorso", (0, 0, 2.4), (0, 0, 3.4)),
    "Head": ("UpperTorso", (0, 0, 3.4), (0, 0, 4.4)),
}
for side, sign in (("Left", 1), ("Right", -1)):
    arm_x = sign * 1.0
    leg_x = sign * 0.5
    R15_BONES.update(
        {
            f"{side}UpperArm": ("UpperTorso", (arm_x, 0, 3.2), (arm_x, 0, 2.4)),
            f"{side}LowerArm": (f"{side}UpperArm", (arm_x, 0, 2.4), (arm_x, 0, 1.7)),
            f"{side}Hand": (f"{side}LowerArm", (arm_x, 0, 1.7), (arm_x, 0, 1.3)),
            f"{side}UpperLeg": ("LowerTorso", (leg_x, 0, 2.0), (leg_x, 0, 1.2)),
            f"{side}LowerLeg": (f"{side}UpperLeg", (leg_x, 0, 1.2), (leg_x, 0, 0.5)),
            f"{side}Foot": (f"{side}LowerLeg", (leg_x, 0, 0.5), (leg_x, 0, 0.1)),
        }
    )


def fail(message):
    print(f"KEYFRAMES_ERROR {message}", file=sys.stderr)
    sys.exit(1)


def read_spec(path):
    with open(path, encoding="utf-8") as spec_file:
        spec = json.load(spec_file)
    fps = spec.get("fps")
    if not isinstance(fps, int) or fps <= 0:
        fail("fps must be a positive integer")
    bones = spec.get("bones")
    if not isinstance(bones, dict) or not bones:
        fail("bones must be an object with at least one bone")
    for bone_name, keys in bones.items():
        if bone_name not in R15_BONES:
            fail(f"unknown bone {bone_name!r}; R15 names are {sorted(R15_BONES)}")
        if not isinstance(keys, list) or not keys:
            fail(f"{bone_name} needs at least one key")
        frames = [key.get("frame") for key in keys]
        if not all(isinstance(frame, int) for frame in frames):
            fail(f"{bone_name} has a key whose frame is not an integer")
        if len(set(frames)) != len(frames):
            fail(f"{bone_name} has two keys on the same frame")
        for key in keys:
            rotation = key.get("rotation")
            if not isinstance(rotation, list) or len(rotation) != 3:
                fail(f"{bone_name} frame {key['frame']} needs rotation [x, y, z]")
    return spec


def build_rig():
    armature = bpy.data.armatures.new("R15")
    rig = bpy.data.objects.new("R15", armature)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bone_name, (parent, head, tail) in R15_BONES.items():
        edit_bone = armature.edit_bones.new(bone_name)
        edit_bone.head = head
        edit_bone.tail = tail
        if parent:
            edit_bone.parent = armature.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def key_rotations(rig, bones):
    for bone_name, keys in bones.items():
        pose_bone = rig.pose.bones[bone_name]
        pose_bone.rotation_mode = "XYZ"
        for key in keys:
            degrees = key["rotation"]
            pose_bone.rotation_euler = Euler([math.radians(angle) for angle in degrees])
            pose_bone.keyframe_insert("rotation_euler", frame=key["frame"])


def check_keyed(rig, bones):
    """Blender 5.x actions are layered: F-curves live in the slot's channelbag."""
    channelbag = anim_utils.action_get_channelbag_for_slot(
        rig.animation_data.action, rig.animation_data.action_slot
    )
    for bone_name, keys in bones.items():
        path = f'pose.bones["{bone_name}"].rotation_euler'
        curves = [curve for curve in channelbag.fcurves if curve.data_path == path]
        if len(curves) != 3:
            fail(f"{bone_name} has {len(curves)} rotation curves, expected 3")
        for curve in curves:
            if len(curve.keyframe_points) != len(keys):
                fail(f"{bone_name} baked {len(curve.keyframe_points)} keys, expected {len(keys)}")


def export_fbx(rig, out_path):
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    return bpy.ops.export_scene.fbx(
        filepath=out_path,
        use_selection=True,
        object_types={"ARMATURE"},
        bake_anim=True,
        bake_anim_simplify_factor=0.0,
        add_leaf_bones=False,
    )


def main():
    if "--" not in sys.argv or len(sys.argv) - sys.argv.index("--") != 3:
        fail("usage: blender -b --factory-startup -P keyframes-to-fbx.py -- <keyframes.json> <out.fbx>")
    in_path, out_path = sys.argv[sys.argv.index("--") + 1 :]
    spec = read_spec(in_path)
    all_frames = [key["frame"] for keys in spec["bones"].values() for key in keys]
    scene = bpy.context.scene
    scene.render.fps = spec["fps"]
    scene.frame_start = min(all_frames)
    scene.frame_end = max(all_frames)
    rig = build_rig()
    key_rotations(rig, spec["bones"])
    check_keyed(rig, spec["bones"])
    result = export_fbx(rig, out_path)
    print(f"EXPORT_RESULT {sorted(result)} {out_path}")
    if result != {"FINISHED"}:
        sys.exit(1)


main()
