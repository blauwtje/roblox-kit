---
name: map-building
description: Use when building or changing a styled Roblox map (genre preset, rooms, walls, doors, floors, spawns, terrain) in Studio, or when asked to check or screenshot one. Not for Luau scripts (luau skill), playtests or animation.
---

# Map building

Studio's built-in tools can place parts one at a time, but a hand-placed map arrives with overlaps, floating walls and rooms nobody can walk into. The enemy is a map made from loose `execute_luau` part calls, or a bare-box spec, called done unseen. The overcorrection is running every tool on every edit and pulling images nobody reads.

## When to use

- Building a map from a preset, rooms, doors, spawns and terrain fills, or rebuilding one after a change.
- Asked whether a map is walkable or sound, or to show what it looks like.
- Not for scripts (luau skill), playtests or animation: their own skills own those.

## Process

1. **Describe the map as a spec and call `build_map`.** Give `mapId`, `rooms` (`name`, outer `width`/`depth`, `doors`, `spawn`), optional `terrain` fills (`block` or `ball`) and `objectives` (`name`, `x`, `y`, `z`). The floor top is y = 0, north is -Z, east is +X and a door `offset` runs along its wall from the wall center. Room names are unique, and a door that does not fit fails the call before touching Studio.
2. **Pick a genre with `style: { preset }`.** Presets are `train-station`, `horror-facility`, `sci-fi-station` and `cozy-town`. A preset adds palette colors, ceilings, trims, props, lights and a Lighting recipe, so a room stops being a bare box. Change one value with `style.overrides` (any subset of the preset) instead of hand edits. Without a style, `floorMaterial`, `wallMaterial`, `wallHeight`, `wallThickness` and `doorWidth` default to Concrete, Brick, 12, 1 and 6.
3. **Place rooms by relation, not by coordinates.** One anchor room gives `x`/`z`; every other room gives `relation: { to, direction, hallwayLength, hallwayWidth }` instead. The server snaps it to a 5-stud grid and adds a zone `<to>-<room>-hallway` with doors on both rooms, so hand-computed offsets cannot overlap. A cycle, an unknown `to` or a collision fails naming the rooms.
4. **Keep the sizes at the preset's size rules.** A preset sets minimum doorway width, hallway width and wall height that a player needs to walk through; set `doorWidth`, `hallwayWidth` and `wallHeight` at or above them, because `check_map` reports each smaller one as a `sizeRule` issue.
5. **Change a map by calling `build_map` again with the same `mapId`, and keep its `seed`.** The build replaces the old Model and its terrain, so parts added by hand inside it are lost; put them outside `Workspace.RobloxKitMaps`. `seed` (default 1) fixes every random variation, so the same spec and seed give the same map and a changed seed only reshuffles props. A build cannot be undone with Ctrl+Z, so tell the user.
6. **Read `phases` in the result, not a progress bar.** The build runs six phases (shell, floors and ceilings, openings, surfaces, props, lighting) and returns `phases: [{ name, partCount }]`. A failed phase errors by name and leaves a partial Model; fix the spec and rebuild the same `mapId` to replace it.
7. **Run `check_map` after every build with `mapId`, `preset` and `spec`.** Without `preset` and `spec`, `sizeRule` is never checked. It reports `overlapping`, `floating`, `unreachable` and `sizeRule` issues with part paths and stud positions, and `sceneStats` per zone (`drawCalls`, `triangles`). With a `preset` it also reports `untextured` (a flat part over the config's stud limit with no texture or textured material; none for a preset with `flatSurfaces`), `unbevelled` (a hero MeshPart whose recipe shape has no `bevel`) and, with `spec` too, `unlit` (a room with no light) issues: give big surfaces a textured material or variant, a `bevel` on every hero shape and a light in every room. Fix the spec until `passed` is true, because the next rebuild erases a Studio patch. `reachabilityChecked` false means no spawn: set `spawn: true` on one room. For `issuesOmitted` above 0, read the `reportUri` resource.
8. **Capture only when the user needs to see it, then judge with the visual-judge skill.** `capture_zones` moves the Studio camera and returns one top-down cutaway of the whole map (view `top`), then views `a` and `b` of each zone; pass `zones` with the few rooms in question, because every image costs context. Zones beyond the per-call image cap come back in `remainingZones`; capture them with `cutaway: false` to skip the repeated cutaway. It needs an open Studio viewport. Use Studio's own tools (`search_game_tree`, `insert_asset`, `execute_luau`) only outside the map Model, which `build_map` owns.

## Hero props

A preset's `heroProps` recipes (size in studs, palette roles, `triangleBudget`, `replaces`) give a room a generated mesh as its focal point in place of one set piece. Never stand in a store or downloaded model, because the loop exists so every mesh comes from a recipe.

1. **Generate, render and review with `npm run hero-props -- <preset> <kind>`.** Headless Blender writes `.roblox-kit/hero-props/<preset>-<kind>-<hash>/model.glb`, fails on a broken triangle budget, role or size, renders front, side and three-quarter views, and a fresh reviewer writes `review.json`. It passes only when every axis reaches 7.
2. **Stop at three rounds.** Each new recipe hash of a kind counts one round, and the fourth is refused; ask the user instead of loosening the recipe check.
3. **Ask before any upload, and upload only from a clone of the roblox-kit repo.** The installed plugin is read-only for hero props: no MCP tool uploads, and `build_map` only reads recorded assets. In the clone, `npm run hero-props:upload -- <preset>` uploads every hero prop of the preset whose review passed and whose recipe hash has no recorded asset, through Open Cloud with a key (Assets Read and Write) and a creator, a user or a group. It reads `ROBLOX_OPEN_CLOUD_API_KEY` with `ROBLOX_CREATOR_USER_ID` or `ROBLOX_CREATOR_GROUP_ID` from the environment, else `.roblox-kit/open-cloud-key` and `.roblox-kit/open-cloud-creator.json` (`{"userId":"..."}` or `{"groupId":"..."}`). It records the asset id by recipe hash in the committed `src/hero-props/hero-assets.json`, so an unchanged recipe never uploads again.
4. **Read the fallback in `warnings`.** `build_map` loads a recorded asset as a non-colliding Model `<kind>-hero-<n>`; without one it keeps the set piece and its warning says to generate and upload it from a clone of the roblox-kit repo. If `InsertService:LoadAsset` fails, it builds the set piece instead and the warning names the asset id and the error.

## Clean up the shared place

The open place is shared. Before finishing a test or demo build, call `remove_map` with the `mapId`: it fills the map's terrain with Air, destroys its MaterialVariants and its Model, and restores the place's original lighting once the last styled map is gone (`warnings` names the styled maps that remain). A `mapId` that is not a built map fails the call before any change. Never remove a map you did not build.

## Judgment

- A failed `check_map` outranks a good-looking screenshot.
- A spec fix outranks a hand patch.
- Fewer images outrank complete coverage.
