# roblox-kit

A Claude Code plugin for Roblox Studio. Its MCP server builds a map from a data spec, checks it for overlapping, floating and unreachable geometry, screenshots each zone, and runs solo or multiplayer playtests that return structured reports. The plugin also starts Roblox's built-in Studio MCP tools (such as `execute_luau` and `screen_capture`) and adds seven skills for Luau, map building, playtests, visual review, animation, player data and networking.

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

The server `roblox-kit` has seven tools. Every tool takes an optional `studioId`, which is required only when more than one Studio is connected. All distances are in studs. North is -Z, south is +Z, east is +X and west is -X.

### build_map

Builds a map in the open place. Each room gets an anchored floor, walls with door gaps and an optional `SpawnLocation`. Terrain fills are added on top. With a `style`, the map is also finished: each room gets a non-colliding ceiling (tagged `RobloxKitCeiling`), baseboard, crown, stripe, pillar and arch details, props from the preset's kit, point lights and the preset's `Lighting` recipe. Without a `style` none of these are built. The map is one Model named `mapId` under `Workspace.RobloxKitMaps`, and `mapId` is the handle the other tools take. Building again with the same `mapId` replaces the Model and clears the terrain that the previous build filled.

Building is not one undo step. `execute_luau` cannot record undo, so Studio may offer no single step that reverts a build.

The build runs in six phases: shell, floors and ceilings, openings, surfaces, props and lighting. A phase that fails stops the build with an error that names it, and the Model may be partial. Building again with the same `mapId` replaces it.

| Input                                      | Type                          | Meaning                                                                                                            |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `mapId`                                    | string, required              | Model name and handle of the map.                                                                                  |
| `rooms`                                    | array, at least 1, required   | The rooms (zones) of the map.                                                                                      |
| `terrain`                                  | array, default empty          | Terrain fills.                                                                                                     |
| `floorMaterial`, `wallMaterial`            | string, optional              | Material names for all rooms. Defaults are `Concrete` and `Brick`.                                                 |
| `wallHeight`, `wallThickness`, `doorWidth` | positive number, optional     | Sizes for all rooms. Defaults are 12, 1 and 6.                                                                     |
| `style`                                    | object, optional              | `{ preset, overrides }`. See below.                                                                                |
| `seed`                                     | integer, 0 or more, default 1 | Seeds every random variation of the build, such as prop placement. The same spec and seed build the same map.      |
| `objectives`                               | array, optional               | Named points `{ name, x, y, z }`. `build_map` accepts them and builds nothing from them; pass them to `check_map`. |

`style.preset` names a genre preset: `cozy-town`, `horror-facility`, `sci-fi-station` or `train-station`. `style.overrides` is optional and holds any subset of that preset (palette, surfaces, lighting, light roles, prop kit, size rules); arrays are replaced whole. An unknown preset or a bad override is an error before Studio is asked. The style paints parts in the preset's colors and materials, hangs point lights under each room's floor and applies the lighting recipe to `Lighting`. It stores the previous `Lighting` values on the map Model, and a build without a `style` restores them.

A room has:

| Field                                                                       | Type                                        | Meaning                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                                      | string, required                            | Zone name. Must be unique in the map.                                                                                                                                                                                             |
| `x`, `z`                                                                    | number, required unless `relation` is given | Center of the room. The top face of the floor is at y = 0.                                                                                                                                                                        |
| `relation`                                                                  | object, instead of `x`, `z`                 | `{ to, direction, hallwayLength, hallwayWidth }`. Places the room beside the room named `to`, on its `north`, `south`, `east` or `west` side. Its center snaps to a 5-stud grid, so the hallway is at least `hallwayLength` long. |
| `width`, `depth`                                                            | positive number, required                   | Outer size along X and along Z. Walls stand inside this footprint.                                                                                                                                                                |
| `doors`                                                                     | array, default empty                        | Door gaps. Each has `side` (`north`, `south`, `east` or `west`) and `offset` (default 0), the distance of the door center from the wall center.                                                                                   |
| `spawn`                                                                     | boolean, default false                      | Adds a `SpawnLocation` at the room center.                                                                                                                                                                                        |
| `floorMaterial`, `wallMaterial`, `wallHeight`, `wallThickness`, `doorWidth` | optional                                    | Override the map-wide setting for this room.                                                                                                                                                                                      |

A terrain fill is either `{ shape: "block", center, size, material }` or `{ shape: "ball", center, radius, material }`. `center` and `size` are `{ x, y, z }` objects.

A room placed by `relation` gets a hallway room named `<to>-<room>-hallway`, which is one more zone. The solver adds doors to both rooms and to both ends of the hallway. A room gives either `x` and `z` or a `relation`, never both.

Returns `{ mapId, partCount, phases, bounds, zones, warnings }`. `phases` lists the six phases in the order they ran, each with `name` and `partCount`. `bounds` is `{ min, max }` for the whole map, and each entry of `zones` has `name`, `partCount` and its own `bounds`. `warnings` has one line per set piece skipped because its room has no space for it, per hero prop not built and why, and per hero asset that failed to load.

### check_map

Read-only. Checks a built map for overlapping parts, floating parts (not connected to the ground or terrain) and zones and objective points that a walk from any `SpawnLocation` cannot reach (Studio pathfinding). Rotated parts are checked by their world bounding box. A missing Model is an error.

| Input        | Type             | Meaning                                                                                                                                                             |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mapId`      | string, required | The `mapId` that `build_map` returned.                                                                                                                              |
| `objectives` | array, optional  | Points `{ name, x, y, z }` in studs that every spawn must be able to walk to.                                                                                       |
| `preset`     | string, optional | The preset the map was built with. Its size rules set the pathfinding agent's size.                                                                                 |
| `spec`       | object, optional | The `build_map` spec. With `preset`, doorways, hallways and walls smaller than the preset's size rules are reported. Its `performanceBudget` sets the scene limits. |

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

| Input     | Type                                           | Meaning                                                                                                                                       |
| --------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `mapId`   | string, required                               | The `mapId` that `build_map` returned.                                                                                                        |
| `zones`   | array of strings, optional                     | Zone names to capture. Default is every zone. Each image costs context, so pass a few for large maps.                                         |
| `cutaway` | boolean, default true                          | False in a follow-up call for `remainingZones`, which already has the cutaway from the first call.                                            |
| `views`   | array of `a`, `b`, `eye`, default `["a", "b"]` | The views of each zone. `eye` stands at player eye height inside the zone, looks at its center and is shot with ceilings and all walls shown. |

A call returns at most 8 images (`config.maxImagesPerCall`), the cutaway included. A zone is captured with all its asked views or not at all.

Returns `{ mapId, shots, remainingZones, warnings }`. Each shot has `zone`, `view` (`a`, `b`, `eye` or `top`), `cameraPosition`, `lookAt`, `width` and `height` (pixels). `remainingZones` names the zones that the image cap left out. Pass them as `zones` in a follow-up call. `warnings` has one entry for each image whose long edge is outside 1000 to 1568 pixels. One image content block follows for each shot, in the same order.

### run_playtest

Runs your Luau checks in a Studio playtest. It inserts a server harness `Script` into `ServerScriptService` and, for `play` and `multiplayer`, a client harness `LocalScript` into `StarterPlayerScripts`. It starts `StudioTestService` and removes both scripts afterwards, even on failure. It starts and stops play mode, so it needs an open place in Edit mode.

| Input            | Type                                           | Meaning                                                                          |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `mode`           | `run`, `play` or `multiplayer`, default `play` | `run` is server only, `play` is one player, `multiplayer` is several clients.    |
| `players`        | integer 1 to 8, default 2                      | Clients of a `multiplayer` session. Allowed only with `multiplayer`.             |
| `serverChecks`   | string, optional                               | Body of `runChecks(check, expectedClients)`, run on the server.                  |
| `clientChecks`   | string, optional                               | Body of `runChecks(check, player)`, run on every client. Not allowed with `run`. |
| `timeoutSeconds` | integer 1 to 300, default 60                   | How long the harness waits. A client that has not reported by then is an error.  |

Give at least one of `serverChecks` and `clientChecks`. Inside a body, call `check(name, passed, detail)` for each result. A body that throws becomes a failed check.

The session call to Studio may run 10 seconds past the timeout, for starting the session, sending the report and removing the scripts. StudioMCP itself did not cut an `execute_luau` call that ran 70 seconds.

Returns `{ passed, peers, checks, errors, durationMs }`. `peers` lists the server first, then each client by player name, each with its checks (`name`, `passed`, `detail`). `checks` counts `total`, `passed` and `failed` over all peers. `errors` lists problems outside single checks, such as clients that never reported.

### remove_map

Removes a map that `build_map` built: fills its terrain with Air, destroys its MaterialVariants and its Model under `Workspace.RobloxKitMaps`, and destroys that folder when it is left empty. A `mapId` that is not a Model there fails the call before any change. Lighting goes back to the place's original once the last styled map is removed.

| Input   | Type             | Meaning                                |
| ------- | ---------------- | -------------------------------------- |
| `mapId` | string, required | The `mapId` that `build_map` returned. |

Returns `{ mapId, lighting, warnings }`. `lighting` has `restored` (`original`, `map` for a place built by an older version, or null) and `remainingStyledMaps`, the styled maps that kept the lighting as it is. `warnings` explains either case.

### run_in_playtest

Runs Luau code once in the server of a playtest that is already running and returns the value it returns. Start the playtest first with `start_stop_play`; this tool never starts or stops one. It inserts a `Script` into `ServerScriptService` whose body is the code, so `require` returns the live module instances, unlike `execute_luau` with `datamodel_type` `Server`, which gets its own module copies. The `Script` is removed in every outcome. For repeatable assertions use `run_playtest` `serverChecks`.

| Input            | Type              | Meaning                                                                                           |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `code`           | string, required  | Luau body that ends with `return` of one JSON-encodable value, or returns nothing for null.       |
| `timeoutSeconds` | integer, optional | How long to wait for the code to return. Code that never returns, or does not compile, times out. |

Returns `{ value, durationMs }`. A throw fails the call with its message.

### judge_round

Decides one round of the visual-judge loop from what its agents returned. It drops judge findings without `evidence.visible` (returned as `rejected`), turns place-check mismatches and empty answers into `spec-miss` blocker findings, turns each quality axis median below 7 into a major finding, marks repeats of earlier rounds, sets `stopReason` and appends one line to `.roblox-kit/judge-log.jsonl` in the project folder, which it adds to `.gitignore`. It needs the `PROJECT_DIR` environment variable. Dispatching the agents stays with the caller.

| Input            | Type                         | Meaning                                             |
| ---------------- | ---------------------------- | --------------------------------------------------- |
| `round`          | integer from 1, required     | The round of the loop.                              |
| `spec`           | object, required             | The `build_map` spec, with its `mapId`.             |
| `zones`          | array of strings             | The zones judged this round.                        |
| `findings`       | array                        | The findings the `visual-judge` agent returned.     |
| `placeChecks`    | array of `{ zone, answer }`  | The place-check agent's answer for each typed room. |
| `qualityAnswers` | array of `{ zone, answers }` | The three quality reviewers' answers for each room. |

Returns `{ round, date, mapId, zones, scores, findings, rejected, stopReason, logFile }`. `stopReason` is `pass`, `round-limit`, `repeat` or null while the loop goes on.

## Limits

- `execute_luau` (a built-in Studio tool) returns at most 100,000 characters of output and ends a longer result with `... (truncated)`. `build_map`, `check_map` and `capture_zones` report a cut result as an error.
- `build_map` is not one undo step.
- `run_playtest` waits at most 300 seconds.
- `check_map` reports are kept in memory, at most 50, and are gone when the server restarts.
- Studio's MCP server exists only on macOS and Windows.

## Skills

| Skill          | Use it for                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `luau`         | Writing and reviewing Luau, including code sent through `execute_luau`.                                                                      |
| `map-building` | Building, checking and screenshotting maps with the tools above.                                                                             |
| `playtest`     | Proving server and client behavior with `run_playtest`.                                                                                      |
| `visual-judge` | Judging a built map by its screenshots with the plugin agents `visual-judge`, `place-check` and `quality-reviewer`, fixing it and repeating. |
| `animation`    | Making a character animation from keyframes in Blender and exporting an FBX for R15.                                                         |
| `data`         | Saving player data with ProfileStore and handling developer products and game passes in a Rojo + Wally game.                                 |
| `networking`   | Writing client-server communication with Blink 0.18.9 in a Rojo + Rokit game, rejecting bad data and proving it with a playtest.             |

## Development

Run `npm run check` for the type check, lint, format check, tests and plugin validation. Run `npm run smoke:studio` against a running Studio to build, check, capture and solo-playtest a three-room map; add `-- --multiplayer` to also playtest with 2 players. Run `npm run smoke:data` against a running Studio to insert the `data` skill templates and ProfileStore into the open place, run their checks in a solo playtest and remove them again. Run `npm run smoke:networking` against a running Studio to insert the `networking` skill's generated Blink modules and templates into the open place, run their bad-data checks in a solo playtest and remove them again; rerun it before bumping Blink, because its raw-buffer checks depend on the 0.18.9 wire format. `npm run check:blink` (part of `npm run check`) regenerates the template's Blink output with the `blink` pinned in `rokit.toml` and fails when it differs from the committed files.

The first `npm run typecheck:luau` (part of `npm run check`) or `npm run smoke:data` downloads the pinned ProfileStore from Wally into `.roblox-kit/cache/`, which is git-ignored; it type-checks the `data` templates and `smoke:data` inserts it. ProfileStore is never committed.

Run `npm run eval:studio` against a running Studio to build, check and capture each benchmark in `eval/benchmarks/`. It runs the blind place check on each typed room and scores each room of the current wave (`config.evalWaveRoomTypes`) on the six image axes against the reference set. It appends one line per benchmark to `eval/results.jsonl` with the `check_map` issues, the axis medians and the reviewers' evidence notes, and fails when a place check fails or a scored room's `passed` is false, listing both. The top-level `checkPassed` of a line is the `check_map` result. Run `node scripts/fetch-references.ts` first to download the reference images, and `node scripts/calibrate-review.ts` to check that the reviewer still separates the references from the known-bad anchors in `eval/anchors/bad/`.

Hero props are made and uploaded from a clone of this repository only; the installed plugin only reads the assets recorded in `src/hero-props/hero-assets.json`. Run `npm run hero-props -- <preset> <kind>` to make one hero prop from its recipe in the preset's `heroProps`. Headless Blender (found through `BLENDER_PATH`, else `blender` on PATH, else `/Applications/Blender.app/Contents/MacOS/Blender`) generates `.roblox-kit/hero-props/<preset>-<kind>-<hash>/model.glb` and checks its triangles, roles and size, then renders it from the front, side and three-quarter, and a fresh reviewer scores the renders against the recipe into `review.json`. The command exits 1 when the GLB fails its recipe or the review does not pass. A kind gets at most three rounds (distinct recipe hashes); a fourth is refused.

A passed hero prop is uploaded through Open Cloud with an API key that has Assets Read and Write permission. The key comes from `ROBLOX_OPEN_CLOUD_API_KEY`, else from the gitignored file `.roblox-kit/open-cloud-key` in the clone, trimmed. The asset's creator is the user or group that owns the key: `ROBLOX_CREATOR_GROUP_ID` or `ROBLOX_CREATOR_USER_ID`, set one, else the gitignored file `.roblox-kit/open-cloud-creator.json` holding `{"groupId":"<digits>"}` or `{"userId":"<digits>"}`. Run `npm run hero-props:upload -- <preset>` to upload every reviewed hero prop of the preset that has no recorded asset; it prints `kind -> asset id` per hero prop. The asset id is recorded by recipe hash in `src/hero-props/hero-assets.json`, so an unchanged recipe never uploads again; commit the file to ship the asset.

`build_map` never uploads. It builds each hero prop with a recorded asset as a non-colliding Model in place of the set piece its recipe replaces. Without a recorded asset it keeps the set piece and returns a warning to generate and upload it from a clone of the roblox-kit repo. An asset that `InsertService:LoadAsset` fails to load also builds the set piece, with a warning naming the asset id and the error.

## License

MIT
