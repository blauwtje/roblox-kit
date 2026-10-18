---
name: luau
description: Modern, non-deprecated Luau for Roblox, including code sent to Studio through execute_luau. Use for "write a script", "fix my code", "lua error", "make this faster", or when about to type wait(), spawn(), Remove() or a Body mover. Not for building maps, playtests or screenshots.
---

# Luau

Roblox's docs mark many old APIs deprecated, and the model still writes them from habit. The enemy is a deprecated call or an unchecked Studio assumption that runs fine today and rots later. The overcorrection is rewriting working code the user did not ask you to touch.

## Rough requests

Keep every ask, name and limit the user stated. Fill only what the work needs from preset or code defaults, and add nothing unasked. Ask only when two readings give materially different results: the fewest questions, each short and plain. Do not wait for plan approval; act at once. Match the surrounding code's style; ask only if the target script is unclear.

## When to use

- Writing or changing a `.luau` file, a script's source, or code for `execute_luau`.
- Reviewing Luau that calls `wait`, `spawn`, `delay`, `Remove`, `FindPartOnRay` or a `Body*` object.
- Not for map building, playtests or screenshots: their own skills own those.

## Process

1. **Start a file with `--!strict`** and annotate parameters and returns, so the type checker rejects a wrong call before Studio does. In a project that has `selene.toml` or `stylua.toml`, run `selene` and `stylua --check` before calling the code done.
2. **Replace deprecated APIs with the current one,** but only in code you write or are asked to change:

   | Deprecated                                                                                                       | Use                                                                                                  |
   | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
   | `wait`, `spawn`, `delay`                                                                                         | `task.wait`, `task.spawn`, `task.delay`                                                              |
   | `Instance:Remove()`                                                                                              | `Instance:Destroy()`                                                                                 |
   | `BodyVelocity`, `BodyPosition`, `BodyGyro`, `BodyForce`, `BodyAngularVelocity`, `BodyThrust`, `RocketPropulsion` | `LinearVelocity`, `AlignPosition`, `AlignOrientation`, `VectorForce`, `AngularVelocity`, `LineForce` |
   | `FindPartOnRay` and its variants                                                                                 | `WorldRoot:Raycast` with `RaycastParams`                                                             |
   | `FindPartsInRegion3*`, `IsRegion3Empty*`                                                                         | `WorldRoot:GetPartBoundsInBox` with `OverlapParams`                                                  |
   | `GetTouchingParts` (discouraged)                                                                                 | `WorldRoot:GetPartsInPart`                                                                           |
   | `SetPrimaryPartCFrame`, `GetPrimaryPartCFrame`                                                                   | `PivotTo`, `GetPivot`                                                                                |
   | `Humanoid:LoadAnimation`                                                                                         | `Animator:LoadAnimation`                                                                             |
   | `Velocity`, `RotVelocity`                                                                                        | `AssemblyLinearVelocity`, `AssemblyAngularVelocity`                                                  |
   | Terrain `SetCell`, `GetCell`, `SetWaterCell`, `ConvertToSmooth`                                                  | `FillBlock`, `FillBall`, `FillCylinder`, `FillWedge`, `FillRegion`, `WriteVoxels`                    |

3. **Use the `task` library for anything that waits,** and remember that `StudioTestService` `ExecutePlayModeAsync`, `ExecuteRunModeAsync` and `ExecuteMultiplayerTestAsync` yield, so the caller must be able to wait.
4. **Choose the DataModel on purpose.** `execute_luau` needs `datamodel_type` `Edit`, `Client` or `Server`; `StudioTestService:EndTest` works only from the server of a running test. `execute_luau` with `datamodel_type` `Server` gets its own module copies, so a `require` there does not show the live state of the running game; use `run_in_playtest` (start the playtest first with `start_stop_play`) to read it.
5. **Treat Studio behavior the docs do not state as unknown,** but rely on what is confirmed: `execute_luau` can set `Script.Source` and call `Terrain:FillBlock` from Edit mode, as `luau/build/shell.luau` and `luau/run-playtest.luau` do. Whether it reaches other Plugin-security APIs is unconfirmed: run a one-line probe and read the error before building on one.
6. **Pass resolution 4** wherever a Terrain voxel method takes a resolution; the docs say it must be 4.

## Judgment

- A documented replacement outranks the shorter old call.
- The user's request outranks a deprecation sweep: report old calls you leave alone in code you did not write.
