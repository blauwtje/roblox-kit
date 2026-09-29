# roblox-kit

## Goal

A Claude Code plugin, installed with two commands, whose MCP server builds a map from a data spec in Roblox Studio, checks it for overlapping, floating and unreachable geometry, screenshots each zone and runs solo or multiplayer playtests with structured reports, next to Roblox's built-in Studio MCP tools and a Roblox skill kit.

## Decisions

- **Architecture: A, layer on the built-in StudioMCP** (you asked for evidence; closed by local probes, `docs/research.md`). Two StudioMCP processes ran at once and both saw the same Studio; StudioMCP speaks spec 2026-07-28 (`server/discover`) and the older handshake; `screen_capture` takes `camera_position` and `look_at_position`. The one unproven need, `execute_luau` reaching Plugin-security APIs (StudioTestService, `Script.Source`), is Task 6. If Task 6 fails, the build stops and reports, since choosing B is yours.
- **Built-in tools stay direct.** The plugin's `.mcp.json` declares two servers: `studio`, a Node launcher that picks the per-OS StudioMCP command and hands it Claude Code's stdio, and `roblox-kit`, this server with four tools. No built-in tool is re-exposed.
- **Four tools:** `build_map`, `check_map`, `capture_zones`, `run_playtest`. Base terrain is a section of the map spec, not a fifth tool.
- **Map geometry is computed in TypeScript**, deterministic and unit-tested; Luau only instantiates parts and terrain fills. Handle: `mapId`, the name of a Model under `Workspace.RobloxKitMaps`; it lives as long as that Model exists in the place. Re-running `build_map` with the same `mapId` replaces the Model and refills its terrain region. Not one undo step: `TryBeginRecording` returns nil under `execute_luau` (live, research.md), so the tool description and README say so.
- **Check reports:** `structuredContent` with at most `config.maxInlineIssues` issues plus a `resource_link` to the full report `roblox-kit://check-reports/{reportId}`, kept in memory for the server process's lifetime.
- **Playtests:** `run_playtest` inserts temporary server and client harness scripts, runs `StudioTestService` play or multiplayer mode (1 to 8 players), returns the harness report passed to `EndTest` as JSON, and removes the harness scripts even on failure.
- **No build step:** Node's native TypeScript (default and warning-free since v22.18.0, stable in v24.12.0); `engines.node >=22.18.0`; erasable syntax only, `.ts` import specifiers. Type check with TypeScript 6.0.3, because typescript-eslint 8.71 supports `<6.1.0`.
- **Upstream connection:** each `roblox-kit` process spawns its own StudioMCP through the SDK v2 client, pinned to 2026-07-28, connected lazily on the first call, respawned once on exit, every call under `config.upstreamTimeoutMs`.
- **Studio selection:** every tool takes an optional `studioId`; with none given and exactly one Studio connected, that one is used, else the tool errors with the list.
- **Distribution:** repo is its own marketplace `roblox-kit` with plugin source `./`; no `version` anywhere; `package.json` and `package-lock.json` at the root for Claude Code's `npm ci`.

## Why this is different

- Nothing public turns a data spec into a re-runnable map with a stable handle; the field-reported failure (floating and overlapping parts nobody saw) gets a check that names each part path and position.
- No public tool combines overlap, floating (connected to ground or not) and reachability (pathfinding from spawn to each zone) into one structured report.
- The built-in `screen_capture` takes a camera but no notion of zones; `capture_zones` computes framing cameras per zone from the map handle.
- The built-in play control is solo only; `run_playtest` runs up to 8 players and returns pass or fail per check per peer.
- Each differentiator ships only if its capability passes Task 6; a failed capability is cut and listed in the report.

## Assumptions

- Units are studs; rooms sit on a grid of `config.gridStuds`; rooms have floors and walls, no ceilings, so top views see inside.
- Default floor Concrete, wall Brick, wall height 12, wall thickness 1, door width 6; all overridable per map and per room.
- A part is grounded when it touches terrain, the Baseplate, or the lowest floor level; floating means a connected group of parts with no grounded member.
- Overlap ignores face contact: penetration under `config.overlapToleranceStuds` (0.05) is not reported.
- Reachability uses the default pathfinding agent (radius 2, height 5, jumping allowed) from the first spawn to each room center.
- Zone shots: one angled shot per zone at 55 degrees pitch, framed for Studio's default 70-degree field of view.
- Playtest default timeout 60 s, hard cap 300 s.
- Node 22.18 or newer on PATH is a stated requirement in the README.
- Tests use `node:test`; no test framework dependency.
- Luau tools pinned in `rokit.toml` (selene 0.31.0, StyLua 2.5.2); CI installs them with `CompeyDev/setup-rokit`.

## Acceptance

- `npm run check` passes: typecheck, ESLint, selene, Prettier check, StyLua check, `node --test`, `claude plugin validate .` (Success criterion, Task 1).- Unit tests drive each tool against a fake Studio connection: schema rejection, layout determinism (same spec, same parts), overlap and floating fixtures, camera framing, harness source, error results with `isError: true` (Tasks 3 to 13).
- `npm run smoke:studio` with Studio open builds a 3-room map, checks it (zero issues), captures 3 zone images and runs a 2-player playtest that passes (Task 14).

## Manual checks

- `/plugin marketplace add blauwtje/roblox-kit` then `/plugin install roblox-kit@roblox-kit` installs, and `/mcp` shows `studio` and `roblox-kit` connected.
- With Studio open and a place loaded, "build a 3-room test map and check it" returns the map, check results and screenshots.
- Import an exported FBX through Studio's Animation Editor (Import, From FBX Animation) and publish it; Roblox documents no scripted path for either.
- Run `npm run smoke:studio` once on Windows, or accept the Windows launch path as tested by unit tests only.

## Plan basis

Repository: /Users/thomash/Documents/Code/personal/tools/roblox-kit
Branch: main
Worktree setup: none
Land gate: npm run check

## Success criterion

`npm run check` passes.

## Checkpoint

- Blocks first: Task 6 (live capability probe) gates Tasks 9 to 14.
- Parallel: none; one task at a time.
- Shared state: `src/config.ts`, `src/server/main.ts` (tool list), `scripts/smoke-studio.ts`.
- Smallest safe split: one module per tool, each with its Luau file and test.

## Tasks

### Task 1: chore(repo): scaffold strict TypeScript package, plugin manifests and check script
Depends on: none | Files: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `rokit.toml`, `selene.toml`, `stylua.toml`, `LICENSE`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `src/config.ts` | Data: one frozen object of named constants in `src/config.ts` | Proof: npm run check
### Task 2: feat(studio): launch the built-in StudioMCP on macOS and Windows
Depends on: 1 | Files: `src/studio/studio-mcp-command.ts`, `src/studio/studio-mcp-command.test.ts`, `src/studio/launch-studio-mcp.ts`, `.mcp.json` | Data: a `{ command, args }` object chosen by platform | Proof: npm run check
### Task 3: feat(studio): connect to StudioMCP as an MCP client with Studio selection
Depends on: 2 | Files: `src/studio/studio-connection.ts`, `src/studio/studio-mcp-client.ts`, `src/studio/studio-mcp-client.test.ts`, `src/studio/fake-studio-connection.ts` | Data: a `StudioConnection` interface over one lazily spawned SDK client | Proof: npm run check
### Task 4: feat(luau): run bundled Luau files with JSON arguments and typed JSON results
Depends on: 3 | Files: `src/luau/run-luau-file.ts`, `src/luau/run-luau-file.test.ts`, `luau/ping.luau` | Data: a source string of file body plus a long-bracket JSON argument literal, result parsed by a Zod schema | Proof: npm run check
### Task 5: feat(server): add tool registry, result and error helpers and stdio entry
Depends on: 4 | Files: `src/server/main.ts`, `src/server/tool-definition.ts`, `src/server/tool-result.ts`, `src/server/tool-error.ts`, `src/server/tool-result.test.ts`, `src/server/main.test.ts`, `src/config.ts`, `.mcp.json` | Data: an ordered array of tool definitions registered in array order | Proof: npm run check
### Task 6: test(studio): probe execute_luau capabilities live through smoke:studio
Depends on: 5 | Files: `scripts/smoke-studio.ts`, `luau/probe-capabilities.luau`, `package.json`, `src/studio/studio-mcp-client.ts`, `src/studio/studio-mcp-client.test.ts`, `src/config.ts` | Data: a `{ capability, ok, detail }` array printed as JSON | Proof: npm run smoke:studio
### Task 7: ci: run npm run check on push and pull request
Depends on: 1 | Files: `.github/workflows/check.yml` | Data: one job on ubuntu-latest | Proof: npm run check
### Task 8: feat(map): define the map spec and lay it out deterministically
Depends on: 5 | Files: `src/map/map-spec.ts`, `src/map/map-layout.ts`, `src/map/map-layout.test.ts` | Data: an array of part records plus an array of terrain fill operations | Proof: npm run check
### Task 9: feat(map): add build_map returning a replaceable map handle
Depends on: 6, 8 | Files: `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `luau/build-map.luau`, `src/server/main.ts` | Data: a `{ mapId, partCount, bounds, zones }` result object | Proof: npm run check
### Task 10: feat(map): add check_map for overlapping, floating and unreachable geometry
Depends on: 9 | Files: `src/map/check-map-tool.ts`, `src/map/check-map-tool.test.ts`, `src/map/check-report-store.ts`, `luau/check-map.luau`, `src/server/main.ts` | Data: an issue array per report, reports in a `Map` keyed by report id | Proof: npm run check
### Task 11: feat(map): add capture_zones with computed zone cameras
Depends on: 10 | Files: `src/map/zone-cameras.ts`, `src/map/zone-cameras.test.ts`, `src/map/capture-zones-tool.ts`, `src/map/capture-zones-tool.test.ts`, `luau/read-map-zones.luau`, `src/server/main.ts` | Data: one `{ zone, cameraPosition, lookAt }` object per shot | Proof: npm run check
### Task 12: feat(playtest): generate server and client harness scripts
Depends on: 6 | Files: `luau/playtest-server-harness.luau`, `luau/playtest-client-harness.luau`, `src/playtest/harness-source.ts`, `src/playtest/harness-source.test.ts` | Data: two script source strings with check bodies spliced in | Proof: npm run check
### Task 13: feat(playtest): add run_playtest with a structured pass or fail report
Depends on: 11, 12 | Files: `src/playtest/run-playtest-tool.ts`, `src/playtest/run-playtest-tool.test.ts`, `luau/run-playtest.luau`, `src/server/main.ts` | Data: a `{ passed, peers, checks, errors, durationMs }` report object | Proof: npm run check
### Task 14: test(smoke): build, check, capture and playtest a 3-room map in smoke:studio
Depends on: 10, 11, 13 | Files: `scripts/smoke-studio.ts` | Data: a fixed 3-room map spec constant | Proof: npm run smoke:studio
### Task 15: feat(skills): add the luau skill
Depends on: 1 | Files: `skills/luau/SKILL.md` | Data: one SKILL.md with frontmatter | Proof: npm run check
### Task 16: feat(skills): add the map-building skill
Depends on: 14 | Files: `skills/map-building/SKILL.md` | Data: one SKILL.md with frontmatter | Proof: npm run check
### Task 17: feat(skills): add the playtest skill
Depends on: 14 | Files: `skills/playtest/SKILL.md` | Data: one SKILL.md with frontmatter | Proof: npm run check
### Task 18: feat(skills): add the visual-judge skill
Depends on: 14 | Files: `skills/visual-judge/SKILL.md` | Data: one SKILL.md with frontmatter | Proof: npm run check
### Task 19: docs(readme): write the quick start and tool reference
Depends on: 18 | Files: `README.md` | Data: a quick start of at most five lines | Proof: npm run check
### Task 20: feat(skills): add the animation skill with a headless Blender keyframe exporter
Depends on: 15 | Files: `skills/animation/SKILL.md`, `skills/animation/scripts/keyframes-to-fbx.py`, `skills/animation/scripts/wave-example.json` | Data: a JSON keyframe list per bone, baked by Blender 5.x layered-action channelbags into an FBX | Proof: npm run check
