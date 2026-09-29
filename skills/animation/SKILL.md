---
name: animation
description: Use when making a Roblox character animation from keyframes with Blender, exporting an FBX for R15, or asked to import or publish an animation. Not for Luau that plays an animation (luau skill) or maps and playtests.
---

# Animation

Roblox has no scripted path from keyframes to a published animation. The enemy is a pipeline claimed end to end when only the Blender half runs headless, or a Blender 5 script that still reads `action.fcurves`. The overcorrection is refusing the export because the last steps are manual.

## When to use

- Turning a keyframe list (a wave, a nod, an idle) into an R15 animation FBX.
- Asked to import the FBX into Studio or publish the animation.
- Not for playing an animation in Luau: the luau skill owns that.
- Not for R6 rigs: no official bone names were found, so treat R6 as unsupported.

## Process

1. **Check Blender exists** with `blender --version`, or `/Applications/Blender.app/Contents/MacOS/Blender` on macOS. The exporter needs 5.x; with none installed, say the animation skill is skipped and stop.
2. **Write the keyframes** as JSON like `scripts/wave-example.json`: `fps`, then per R15 bone a list of `{frame, rotation}` in XYZ Euler degrees, local to the bone. Only rotation is keyed, because Studio needs the root to stay in place; a walk cannot travel.
3. **Use the documented R15 names** (`Root`, `HumanoidRootPart`, `LowerTorso`, `UpperTorso`, `Head`, and `Left`/`Right` `UpperArm`, `LowerArm`, `Hand`, `UpperLeg`, `LowerLeg`, `Foot`), because Studio recognizes an avatar animation by them. The script rejects any other name.
4. **Export headless:** `blender -b --factory-startup -P scripts/keyframes-to-fbx.py -- keys.json out.fbx`. Success prints `EXPORT_RESULT ['FINISHED']` and exits 0; a bad spec prints `KEYFRAMES_ERROR` and exits 1.
5. **Read curves through the channelbag.** In Blender 5.x every action is layered and `action.fcurves` raises `AttributeError`; use `anim_utils.action_get_channelbag_for_slot(action, slot).fcurves`. Edit the script, not around it.
6. **Hand over the manual steps** and do not claim them done: in Studio, insert a rig from Avatar > Character (R15), open the Animation Editor on it, then `...` > Import > From FBX Animation and pick the FBX; publish with Publish to Roblox in the editor. No scripting API for either was found.
7. **Say what is untested:** the exporter's rig is an approximate block rig, and whether Studio accepts its rest pose was not confirmed. If the import fails or the pose is off, export from the official R15 reference rig instead.

## Judgment

- An honest "the export ran, the Studio import is yours" outranks a confident end-to-end claim.
- The official Roblox Blender add-on uploads models, not animations: do not route the FBX through it.
