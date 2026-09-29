# roblox-kit

A Claude Code plugin for Roblox Studio. Its MCP server builds a map from a data spec, checks it for overlapping, floating and unreachable geometry, screenshots each zone, and runs solo or multiplayer playtests that return structured reports. The plugin also starts Roblox's built-in Studio MCP tools (such as `execute_luau` and `screen_capture`) and adds five skills for Luau, map building, playtests, visual review and animation.

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

The server `roblox-kit` has four tools. Every tool takes an optional `studioId`, which is required only when more than one Studio is connected. All distances are in studs. North is -Z, south is +Z, east is +X and west is -X.

### build_map

Builds a map in the open place. Each room gets an anchored floor, walls with door gaps and an optional `SpawnLocation`. Terrain fills are added on top. The map is one Model named `mapId` under `Workspace.RobloxKitMaps`, and `mapId` is the handle the other tools take. Building again with the same `mapId` replaces the Model and clears the terrain that the previous build filled.

Building is not one undo step. `execute_luau` cannot record undo, so Studio may offer no single step that reverts a build.

| Input                                      | Type                        | Meaning                                                            |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------ |
| `mapId`                                    | string, required            | Model name and handle of the map.                                  |
| `rooms`                                    | array, at least 1, required | The rooms (zones) of the map.                                      |
| `terrain`                                  | array, default empty        | Terrain fills.                                                     |
| `floorMaterial`, `wallMaterial`            | string, optional            | Material names for all rooms. Defaults are `Concrete` and `Brick`. |
| `wallHeight`, `wallThickness`, `doorWidth` | positive number, optional   | Sizes for all rooms. Defaults are 12, 1 and 6.                     |

A room has:

| Field                                                                       | Type                      | Meaning                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                                      | string, required          | Zone name. Must be unique in the map.                                                                                                           |
| `x`, `z`                                                                    | number, required          | Center of the room. The top face of the floor is at y = 0.                                                                                      |
| `width`, `depth`                                                            | positive number, required | Outer size along X and along Z. Walls stand inside this footprint.                                                                              |
| `doors`                                                                     | array, default empty      | Door gaps. Each has `side` (`north`, `south`, `east` or `west`) and `offset` (default 0), the distance of the door center from the wall center. |
| `spawn`                                                                     | boolean, default false    | Adds a `SpawnLocation` at the room center.                                                                                                      |
| `floorMaterial`, `wallMaterial`, `wallHeight`, `wallThickness`, `doorWidth` | optional                  | Override the map-wide setting for this room.                                                                                                    |

A terrain fill is either `{ shape: "block", center, size, material }` or `{ shape: "ball", center, radius, material }`. `center` and `size` are `{ x, y, z }` objects.

Returns `{ mapId, partCount, bounds, zones }`. `bounds` is `{ min, max }` for the whole map, and each entry of `zones` has `name`, `partCount` and its own `bounds`.

### check_map

Read-only. Checks a built map for overlapping parts, floating parts (not connected to the ground or terrain) and zones that a walk from the first `SpawnLocation` cannot reach (Studio pathfinding). Rotated parts are checked by their world bounding box. A missing Model is an error.

| Input   | Type             | Meaning                                |
| ------- | ---------------- | -------------------------------------- |
| `mapId` | string, required | The `mapId` that `build_map` returned. |

Returns `{ reportId, reportUri, mapId, passed, partCount, zoneCount, reachabilityChecked, counts, issues, issuesOmitted }`.

- `counts` holds the exact number of `overlapping`, `floating` and `unreachable` issues.
- `reachabilityChecked` is false when the map has no `SpawnLocation`, because no path can start.
- `issues` lists the first 20 issues with part paths and stud positions. `issuesOmitted` counts the rest.
- The full report holds up to 100 issues per kind. It is served at `roblox-kit://check-reports/{reportId}` and stays available only while the server process runs.

### capture_zones

Read-only apart from the Studio camera, which moves for each capture. Takes one angled screenshot per zone through the built-in `screen_capture` tool, at a 55 degree pitch, framed for Studio's default 70 degree field of view. It needs an open Studio viewport on the place.

| Input   | Type                       | Meaning                                                                                               |
| ------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `mapId` | string, required           | The `mapId` that `build_map` returned.                                                                |
| `zones` | array of strings, optional | Zone names to capture. Default is every zone. Each image costs context, so pass a few for large maps. |

Returns `{ mapId, shots }`, where each shot has `zone`, `cameraPosition` and `lookAt`. One image content block follows for each shot, in the same order.

### run_playtest

Runs your Luau checks in a Studio playtest. It inserts a server harness `Script` into `ServerScriptService` and, for `play` and `multiplayer`, a client harness `LocalScript` into `StarterPlayerScripts`. It starts `StudioTestService` and removes both scripts afterwards, even on failure. It starts and stops play mode, so it needs an open place in Edit mode.

| Input            | Type                                           | Meaning                                                                          |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `mode`           | `run`, `play` or `multiplayer`, default `play` | `run` is server only, `play` is one player, `multiplayer` is several clients.    |
| `players`        | integer 1 to 8, default 2                      | Clients of a `multiplayer` session. Allowed only with `multiplayer`.             |
| `serverChecks`   | string, optional                               | Body of `runChecks(check, expectedClients)`, run on the server.                  |
| `clientChecks`   | string, optional                               | Body of `runChecks(check, player)`, run on every client. Not allowed with `run`. |
| `timeoutSeconds` | integer 1 to 50, default 50                    | How long the harness waits. A client that has not reported by then is an error.  |

Give at least one of `serverChecks` and `clientChecks`. Inside a body, call `check(name, passed, detail)` for each result. A body that throws becomes a failed check.

The timeout is capped at 50 seconds because every call to Studio is cut off after 60 seconds, and 10 seconds are reserved for starting the session, sending the report and removing the scripts.

Returns `{ passed, peers, checks, errors, durationMs }`. `peers` lists the server first, then each client by player name, each with its checks (`name`, `passed`, `detail`). `checks` counts `total`, `passed` and `failed` over all peers. `errors` lists problems outside single checks, such as clients that never reported.

## Limits

- `execute_luau` (a built-in Studio tool) returns at most 100,000 characters of output and ends a longer result with `... (truncated)`. `build_map`, `check_map` and `capture_zones` report a cut result as an error.
- `build_map` is not one undo step.
- `run_playtest` waits at most 50 seconds.
- `check_map` reports are kept in memory and are gone when the server restarts.
- Studio's MCP server exists only on macOS and Windows.

## Skills

| Skill          | Use it for                                                                             |
| -------------- | -------------------------------------------------------------------------------------- |
| `luau`         | Writing and reviewing Luau, including code sent through `execute_luau`.                |
| `map-building` | Building, checking and screenshotting maps with the tools above.                       |
| `playtest`     | Proving server and client behavior with `run_playtest`.                                |
| `visual-judge` | Judging a built map by its screenshots with a fresh subagent, fixing it and repeating. |
| `animation`    | Making a character animation from keyframes in Blender and exporting an FBX for R15.   |

## Development

Run `npm run check` for the type check, lint, format check, tests and plugin validation. Run `npm run smoke:studio` against a running Studio to build, check, capture and playtest a three-room map.

## License

MIT
