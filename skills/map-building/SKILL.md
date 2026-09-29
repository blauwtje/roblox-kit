---
name: map-building
description: Use when building or changing a Roblox map with rooms, walls, doors, floors, spawns or terrain in Studio, or when asked to check or screenshot one. Not for Luau scripts (luau skill), playtests or animation.
---

# Map building

Studio's built-in tools can place parts one at a time, but a hand-placed map arrives with overlaps, floating walls and rooms nobody can walk into. The enemy is a map made from loose `execute_luau` part calls and called done unseen. The overcorrection is running every tool on every edit and pulling images nobody reads.

## When to use

- Building a map from rooms, doors, spawns and terrain fills, or rebuilding one after a change.
- Asked whether a map is walkable or sound, or to show what it looks like.
- Not for scripts (luau skill), playtests or animation: their own skills own those.

## Process

1. **Describe the map as a spec and call `build_map`.** Give `mapId` plus `rooms` (`name`, center `x`/`z`, outer `width`/`depth`, `doors`, `spawn`) and optional `terrain` fills (`block` or `ball`). A spec is data, so the same spec always builds the same parts.
2. **Read the coordinates before writing them.** The floor top is y = 0, north is -Z, east is +X, and a door's `offset` runs along its wall from the wall center. Room names are unique, and each door must fit its wall and clear the other doors, or the call fails before touching Studio.
3. **Set styles once at the top.** `floorMaterial`, `wallMaterial`, `wallHeight`, `wallThickness` and `doorWidth` apply to all rooms and a room overrides them; unset ones default to Concrete, Brick, 12, 1 and 6 studs. Materials are `Enum.Material` names, and an unknown one fails the build.
4. **Change a map by calling `build_map` again with the same `mapId`.** It destroys the old Model and clears the terrain that build filled, so parts added by hand inside the Model are lost. Put hand additions outside `Workspace.RobloxKitMaps`. There is no undo step: undo recording is unavailable to `execute_luau`, so tell the user a build cannot be undone with Ctrl+Z.
5. **Run `check_map` with the `mapId` after every build.** It reports `overlapping`, `floating` and `unreachable` issues with part paths and stud positions. Fix the spec and rebuild until `passed` is true; do not patch parts in Studio, because the next rebuild erases the patch.
6. **Read `reachabilityChecked` before trusting `passed`.** It is false when the map has no spawn, so nothing was tested for reachability; set `spawn: true` on one room. The room holding the spawn is skipped. Only 20 issues come back inline: for `issuesOmitted` above 0, read the `reportUri` resource, which lasts until the server restarts.
7. **Capture only when the user needs to see it.** `capture_zones` returns one angled image per room and moves the Studio camera for each shot. Pass `zones` with the few rooms in question; every image costs context. It needs a Studio viewport open on the place.
8. **Use Studio's own tools for what a spec cannot say.** `search_game_tree` and `inspect_instance` read what exists, `insert_asset` and `generate_mesh` add props, and `execute_luau` handles one-off tweaks outside the map Model. Keep them out of the map's geometry, which `build_map` owns.

## Clean up the shared place

The open place is shared and no tool deletes a map. Before finishing a test or demo build, destroy `Workspace.RobloxKitMaps.<mapId>` with `execute_luau`. Fill its terrain with Air first, using the fills stored in the Model's `RobloxKitTerrainFills` attribute as JSON, because destroying the Model leaves that terrain behind. Never touch a map you did not build.

## Judgment

- A failed `check_map` outranks a good-looking screenshot.
- A spec fix outranks a hand patch.
- Fewer images outrank complete coverage.
