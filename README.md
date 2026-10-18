# roblox-kit

A Claude Code plugin for Roblox Studio. Its MCP server builds a map from a data spec, checks it for overlapping, floating and unreachable geometry, screenshots each zone, and runs solo or multiplayer playtests that return structured reports. The plugin also starts Roblox's built-in Studio MCP tools (such as `execute_luau` and `screen_capture`) and adds nine skills for Luau, map building, playtests, visual review, recreating a screenshot, animation, player data, networking and UI images.

## Quick start

1. `/plugin marketplace add blauwtje/roblox-kit`
2. `/plugin install roblox-kit@roblox-kit`
3. Turn on auto-update once: `/plugin`, then Marketplaces, then Enable auto-update.
4. In Studio, open a place and turn on Assistant > Manage MCP Servers > Enable Studio as MCP server.

## Requirements

- Claude Code.
- Node 22.18 or newer on your PATH.
- Roblox Studio on macOS or Windows.

Studio's quick connect for Claude Code is not needed. The plugin already starts the built-in tools, so quick connect would register them a second time.

## Tool reference

The server `roblox-kit` has eleven tools. Each tool's input and output fields are in its schema, which your client shows from `tools/list`; the sections below describe behavior only. Every tool takes an optional `studioId`, which is required only when more than one Studio is connected. All distances are in studs. North is -Z, south is +Z, east is +X and west is -X.

### build_map

Builds a map in the open place. Each room gets an anchored floor, walls with door gaps and an optional `SpawnLocation`. Terrain fills are added on top. With a `style`, the map is also finished: each room gets a non-colliding ceiling (tagged `RobloxKitCeiling`), baseboard, crown, stripe, pillar and arch details, props from the preset's kit, point lights and the preset's `Lighting` recipe. Without a `style` none of these are built. The map is one Model named `mapId` under `Workspace.RobloxKitMaps`, and `mapId` is the handle the other tools take. Building again with the same `mapId` replaces the Model and clears the terrain that the previous build filled.

Building is not one undo step. `execute_luau` cannot record undo, so Studio may offer no single step that reverts a build.

The build runs in seven phases: shell, floors and ceilings, openings, surfaces, props, lighting and ambient effects. A phase that fails stops the build with an error that names it, and the Model may be partial. Building again with the same `mapId` replaces it.

`style.preset` names a genre preset: `cozy-town`, `horror-facility`, `sci-fi-station` or `train-station`. All four presets have light fixtures, idle animations and ambient effects. `cozy-town` and `train-station` weight their prop kinds (`propWeights`). Only `train-station` has hero props, trim meshes, npc roles, signage and flat or patterned surfaces. `style.overrides` is optional and holds any subset of that preset (palette, surfaces, lighting, light roles, prop kit, size rules); arrays are replaced whole. An unknown preset or a bad override is an error before Studio is asked. A style alone is enough: `build_map` fills the rooms, lists each fill in `fills`, and builds nothing from the opt-in inputs `npcs`, `clutter`, `signage`, `motion` and `useRecordedAssets` unless they are set. `npcs` is `{ density, seed?, maxTotal? }` and adds walking and seated people. The style paints parts in the preset's colors and materials, hangs point lights under each room's floor and applies the lighting recipe to `Lighting`. It stores the previous `Lighting` values on the map Model, and a build without a `style` restores them.

Terrain fills are either `{ shape: "block", center, size, material }` or `{ shape: "ball", center, radius, material }`. `center` and `size` are `{ x, y, z }` objects.

A room placed by `relation` gets a hallway room named `<to>-<room>-hallway`, which is one more zone. The solver adds doors to both rooms and to both ends of the hallway. A room gives either `x` and `z` or a `relation`, never both.

Returns `{ mapId, partCount, phases, bounds, zones, warnings }`. `phases` lists the seven phases in the order they ran, each with `name` and `partCount`. `bounds` is `{ min, max }` for the whole map, and each entry of `zones` has `name`, `partCount` and its own `bounds`. `warnings` has one line per set piece skipped because its room has no space for it, per hero prop not built and why, and per hero asset that failed to load. Recorded assets (hero props, trim meshes, sprites) are used only with `useRecordedAssets`; `build_map` never uploads. The skill `map-building` has the detail.

### check_map

Read-only. Checks a built map for overlapping parts, floating parts (not connected to the ground or terrain) and zones and objective points that a walk from any `SpawnLocation` cannot reach (Studio pathfinding). Rotated parts are checked by their world bounding box. A missing Model is an error.

Returns `{ reportId, reportUri, mapId, passed, partCount, zoneCount, reachabilityChecked, counts, sceneStats, budget, withinBudget, warnings, issues, issuesOmitted }`.

- `counts` holds the exact number of `overlapping`, `floating`, `unreachable` and `sizeRule` issues. `sizeRule` is 0 unless both `preset` and `spec` are given.
- `sceneStats` has one `{ zone, drawCalls, triangles }` sample per zone, read from that zone's camera. Each sample is compared to `budget`: the spec's `performanceBudget`, or 1,000 draw calls and 1,000,000 triangles without a spec. `withinBudget` is false when any zone is over a limit. It does not affect `passed`.
- `warnings` has one line per zone over a budget limit and one per model outside the map that stands on the straight line of a failed walk, such as another map built in the same place.
- `reachabilityChecked` is false when the map has no `SpawnLocation`, because no path can start.
- `issues` lists the first 20 issues with part paths and stud positions. `issuesOmitted` counts the rest.
- The full report holds up to 100 issues per kind. It is served at `roblox-kit://check-reports/{reportId}` and stays available only while the server process runs. The server keeps the latest 50 reports (`config.maxCheckReports`) and drops the oldest; for a dropped report, call `check_map` again.

### capture_zones

Read-only apart from the Studio camera, which moves for each capture. Each call takes, through the built-in `screen_capture` tool, one top-down cutaway of the whole map (view `top`, named by the `mapId`) and then two views of each zone from opposite sides (views `a` and `b`, at a 55 degree pitch), framed for Studio's default 70 degree field of view. It needs an open Studio viewport on the place.

Ceilings (parts tagged `RobloxKitCeiling`) are hidden during the captures and restored afterwards, also when a capture fails. A call that finds ceilings that a crashed call left hidden restores them first.

A call returns at most 8 images (`config.maxImagesPerCall`), the cutaway included. A zone is captured with all its asked views or not at all.

Returns `{ mapId, shots, remainingZones, warnings }`. Each shot has `zone`, `view` (`a`, `b`, `eye` or `top`), `cameraPosition`, `lookAt`, `width` and `height` (pixels). `remainingZones` names the zones that the image cap left out. Pass them as `zones` in a follow-up call. `warnings` has one entry for each image whose long edge is outside 1000 to 1568 pixels. One image content block follows for each shot, in the same order.

### run_playtest

Runs your Luau checks in a Studio playtest. It inserts a server harness `Script` into `ServerScriptService` and, for `play` and `multiplayer`, a client harness `LocalScript` into `StarterPlayerScripts`. It starts `StudioTestService` and removes both scripts afterwards, even on failure. It starts and stops play mode, so it needs an open place in Edit mode.

Give at least one of `serverChecks` and `clientChecks`. Inside a body, call `check(name, passed, detail)` for each result. A body that throws becomes a failed check.

The session call to Studio may run 10 seconds past the timeout, for starting the session, sending the report and removing the scripts. StudioMCP itself did not cut an `execute_luau` call that ran 70 seconds.

Returns `{ passed, peers, checks, errors, durationMs }`. `peers` lists the server first, then each client by player name, each with its checks (`name`, `passed`, `detail`). `checks` counts `total`, `passed` and `failed` over all peers. `errors` lists problems outside single checks, such as clients that never reported.

### remove_map

Removes a map that `build_map` built: fills its terrain with Air, destroys its MaterialVariants and its Model under `Workspace.RobloxKitMaps`, and destroys that folder when it is left empty. A `mapId` that is not a Model there fails the call before any change. Lighting goes back to the place's original once the last styled map is removed.

Returns `{ mapId, lighting, warnings }`. `lighting` has `restored` (`original`, `map` for a place built by an older version, or null) and `remainingStyledMaps`, the styled maps that kept the lighting as it is. `warnings` explains either case.

### run_in_playtest

Runs Luau code once in the server of a playtest that is already running and returns the value it returns. Start the playtest first with `start_stop_play`; this tool never starts or stops one. It inserts a `Script` into `ServerScriptService` whose body is the code, so `require` returns the live module instances, unlike `execute_luau` with `datamodel_type` `Server`, which gets its own module copies. The `Script` is removed in every outcome. For repeatable assertions use `run_playtest` `serverChecks`.

Returns `{ value, durationMs }`. A throw fails the call with its message.

### judge_round

Decides one round of the visual-judge loop from what its agents returned. It drops judge findings without `evidence.visible` (returned as `rejected`), turns place-check mismatches and empty answers into `spec-miss` blocker findings, turns each quality axis median below 7 into a major finding, marks repeats of earlier rounds, sets `stopReason` and appends one line to `.roblox-kit/judge-log.jsonl` in the project folder, which it adds to `.gitignore`. It needs the `PROJECT_DIR` environment variable. Dispatching the agents stays with the caller.

Returns `{ round, date, mapId, zones, scores, findings, rejected, stopReason, logFile }`. `stopReason` is `pass`, `round-limit`, `repeat` or null while the loop goes on.

### analyze_image

Measures one to four PNG or JPEG files in TypeScript, without Studio: palette, value structure, edge grid, numbered regions, horizon row and a heuristic depth grid, written as text tables and a marked-up image under `.roblox-kit/vision/<analysisId>/`.

### measure_capture

Shoots a grid of rays from the `capture_zones` cameras into a built map and writes the distance, material, color and kind of the first part hit per cell to `truth.json`. Read-only; the Studio camera is restored.

### compare_images

Compares a capture with a reference image (a path or an `analysisId`, optionally with a `measure_capture` truth) and returns ranked palette, value, depth and layout deltas and a suggested camera pitch change. No Studio needed.

### insert_images

Renders SVG to PNG, uploads it through Open Cloud and inserts it as a ScreenGui label or button, a SurfaceGui image or a flipbook ParticleEmitter. Use it only when the user asks for images; it fails before rendering without Open Cloud credentials.

## Limits

- `execute_luau` (a built-in Studio tool) returns at most 100,000 characters of output and ends a longer result with `... (truncated)`. `build_map`, `check_map` and `capture_zones` report a cut result as an error.
- `build_map` is not one undo step.
- `run_playtest` waits at most 300 seconds.
- `check_map` reports are kept in memory, at most 50, and are gone when the server restarts.
- Studio's MCP server exists only on macOS and Windows.

## Skills

| Skill                      | Use it for                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `luau`                     | Writing and reviewing Luau, including code sent through `execute_luau`.                                                                    |
| `map-building`             | Building, checking and screenshotting maps with the tools above.                                                                           |
| `playtest`                 | Proving server and client behavior with `run_playtest`.                                                                                    |
| `visual-judge`             | Judging a built map by its screenshots with the plugin agents `zone-judge`, `place-check` and `quality-reviewer`, fixing it and repeating. |
| `recreate-from-screenshot` | Matching a build to a reference screenshot with `analyze_image` and `compare_images`.                                                      |
| `ui-images`                | Drawing buttons, panels, fixed words and effects as SVG for `insert_images`.                                                               |
| `animation`                | Making a character animation from keyframes in Blender and exporting an FBX for R15.                                                       |
| `data`                     | Saving player data with ProfileStore and handling developer products and game passes in a Rojo + Wally game.                               |
| `networking`               | Writing client-server communication with Blink 0.18.9 in a Rojo + Rokit game, rejecting bad data and proving it with a playtest.           |

## Troubleshooting

- **Studio MCP is off.** Tools fail with no Studio found. In Studio, open a place and turn on Assistant > Manage MCP Servers > Enable Studio as MCP server.
- **The Studio list is empty at start.** A fresh connection lists the open place only after a few seconds. The server retries until discovery times out; wait and call the tool again, and make sure a place (not only the start page) is open.
- **Wrong Node version.** The server needs Node 22.18 or newer on your PATH (`node --version`). Older versions cannot run the TypeScript files directly.

## Contributing

Development notes (checks, smoke tests, evals, hero props, Open Cloud, Blink and ProfileStore) are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
