# roblox-kit

## Goal

`build_map` turns one data spec (a genre preset, rooms placed by relation, optional ceilings, trims and props) into a styled, lit Roblox map that `check_map`, `capture_zones`, the visual-judge skill and `npm run eval:studio` can prove finished-looking, while every existing spec, tool name and result field keeps working.

## Decisions

Every API fact below cites a row of `docs/research.md`, section "Upgrade research: finished-looking maps (2026-09-29)": U rows are re-verified docs, P rows live probes. A fact marked UNVERIFIED is not built on.

### Shipped (Tasks 1 to 20, landed on `main`)

- Layer on the built-in StudioMCP: `.mcp.json` (project scope) and `.claude-plugin/plugin.json` (plugin scope, exact `${CLAUDE_PLUGIN_ROOT}`, which the plugin loader substitutes only without a `:-` default) declare `studio` (per-OS launcher) and `roblox-kit` (this server); no built-in tool is re-exposed.
- Four tools, `build_map`, `check_map`, `capture_zones`, `run_playtest`; geometry computed in TypeScript, Luau only instantiates; handle `mapId`, a Model under `Workspace.RobloxKitMaps`, replaced on rebuild.
- Check reports: at most `config.maxInlineIssues` inline issues plus a `roblox-kit://check-reports/{reportId}` resource link.
- Node native TypeScript, erasable syntax, `.ts` imports, `node:test`; every call to StudioMCP under `config.upstreamTimeoutMs`; optional `studioId` per tool.
- Repo is its own marketplace `roblox-kit`, plugin source `./`, no `version` field.

### Finished-looking maps (Tasks 21 to 57)

- **Process** (closed by you): research is exo check-docs plus live probes, this spec is exo spec, tasks run through exo build, skill edits through exo edit-skills, push through exo ship.
- **Studio list fix first** (closed by P7): `list_roblox_studios` returns `"name": null` right after connect, which the client schema rejects, so every tool and `smoke:studio` fail; the list accepts a null name and messages fall back to the id (Task 21).
- **Presets** (closed by you): one JSON per genre in `presets/` (`train-station`, `horror-facility`, `sci-fi-station`, `cozy-town`), validated by one Zod schema in `src/style/preset-schema.ts`; the map spec's `style: { preset, overrides }` validates overrides with the deep-partial of that same schema. The loader reads `presets/` relative to its module (`import.meta.url`); preset names are the file names. A preset holds a palette (3 to 4 colors plus 1 accent), surface roles (floor, wall, trim, ceiling, accent) mapped to a built-in Material and a palette color, a lighting recipe, light roles (zoneMarker, focal, hero; only hero casts shadows), a prop kit list and size rules. No genre name appears in TypeScript or Luau.
- **Surfaces** (closed by P3b, U10, U15, U16): large slabs use built-in Materials, which already tile their texture (P3b). A role may name a MaterialVariant `{ baseMaterial, studsPerTile }`, which renders flat color only (P3b) and is offered as a flat stylized finish. Texture-map variants: UNVERIFIED, not built. The four starter presets use built-in materials only.
- **Lighting recipe** (closed by U1 to U9, P2): fields LightingStyle (Realistic or Soft, U3), PrioritizeLightingQuality (U2), Ambient, OutdoorAmbient, Brightness, ExposureCompensation (schema enforces -5 to 5 because the setter does not clamp, U8), EnvironmentDiffuseScale (U5), EnvironmentSpecularScale (U6), ShadowSoftness (no logic tied to LightingStyle: U4 is UNVERIFIED), Atmosphere (Density 0 to 1 per U9, Offset, Color, Decay, Glare, Haze), Bloom (Intensity, Size, Threshold). `Lighting.Technology` is never read or written (deprecated, U1). The first existing Atmosphere and BloomEffect under Lighting are reused; one is created only when absent (P2). Light `Range` schema max 120 (U7).
- **Lighting snapshot** (closed by you): before writing, the previous Lighting values and the list of created effects are stored as a JSON attribute on the map Model; a rebuild carries the existing snapshot over (never snapshots its own values) and restores it before applying the recipe.
- **Layout by relations** (closed by U27, U31): a room gives `x`/`z` or `relation: { to, direction: north|south|east|west, hallwayLength, hallwayWidth }`. `src/map/relation-solver.ts` resolves rooms in dependency order, snaps to `config.gridStuds` = 5 (U27), and adds the hallway as a zone with matching doors on both rooms; a cycle, an unknown target or a footprint collision is an error naming the rooms. Specs with `x`/`z` build unchanged.
- **Geometry detail** (closed by U13, U17 to U20, P1, P1b): optional ceilings (part kind `ceiling`, CollectionService tag `config.ceilingTag`), trims, stripes, pillars and arches from the preset; decorative parts set CanCollide, CanTouch and CanQuery false (U13). Repeated props (bench, lamp, pillar, stairs, rail) are ProceduralModels sharing one generator ModuleScript per kind (P1); generator output is pivot-relative, per-instance attributes work and `WaitForGenerationAsync` runs before checks (P1b, U19). Generator sources are generic prop kinds in `luau/props/<kind>.luau`. Runtime generation (U21) is UNVERIFIED and not used: props generate at edit time only.
- **Seed** (closed by you): spec `seed`, default `config.defaultSeed`; TypeScript variation uses one seeded PRNG in `src/shared/seeded-random.ts`; generators use `Random.new(seed)` from an attribute.
- **Build phases** (closed by U36, P8): `build_map` runs 6 `execute_luau` calls in order: shell, floors and ceilings, openings, surfaces, props, lighting; the shell phase replaces the Model. After each phase the server sends `notifications/progress` when the request carried a progressToken (ToolContext gains a progress reporter passed from `src/server/main.ts`); whether Claude Code sends a token is UNVERIFIED (P8), so the result always carries `phases: [{ name, partCount }]`. A failing phase errors naming the phase; the partial Model stays and a rerun replaces it. Result fields are additive.
- **Undo** (closed by you): `ChangeHistoryService:SetWaypoint` gives a real undo step live (P5) but is deprecated (U37), so it is not used; rebuild-replaces stays the recovery path and `TryBeginRecording` stays as shipped.
- **check_map** (closed by U22 to U27, U14, P4): overlap uses a broad `GetPartBoundsInBox` pass then a narrow `GetPartsInPart` pass with `OverlapParams.RespectCanCollide = true` (U22, U23); floating uses downward raycasts from the center and 4 footprint corners; reachability runs `pcall(ComputeAsync)` with the agent size from the preset's size rules (config defaults otherwise), passes on `Enum.PathStatus.Success` with non-empty waypoints (U24), from every spawn to every room and every objective point (new optional spec field), and reports pairs beyond 3,000 studs straight-line as such (U25). Size-rule violations (doorways and hallways under 10 studs, walls under 10 studs tall, U27) are reported only when a preset is set, so style-less specs (door default 6) keep passing. Performance: `Stats.SceneDrawcallCount` and `SceneTriangleCount` sampled per zone camera after `task.wait(config.statsSettleSeconds)` = 1 (U26, P4: shorter waits read stale numbers), budget 1,000 draw calls and 1,000,000 triangles in config (U14), overridable per spec. Counts gain keys; existing keys keep their meaning.
- **capture_zones** (closed by P6, U32, U33): per zone 2 views from opposite sides, plus 1 top-down cutaway of the whole map with the camera straight above the center (P6). `screen_capture` takes no up vector and sets the camera itself, so framing stays position plus look-at from bounds and `CFrame.lookAt` is not called for the top-down view (U38 parallel-up behavior is UNVERIFIED). Ceilings are hidden by tag: Luau stores each part's original Transparency in an attribute and sets 1; restore runs in a TypeScript `finally` and again at the start of every call.
- **Image size** (closed by you): Studio's capture has no size parameter and returns the viewport size (1456x1030 in P6), so images keep the viewport size, each image's width and height are reported, and a warning is added when the long edge falls outside `config.imageLongEdgeMin` 1,000 to `config.imageLongEdgeMax` 1,568. No image library dependency.
- **Image budget** (closed by U32, U33): 1,924 tokens per 1456x1030 image under MAX_MCP_OUTPUT_TOKENS 25,000, so `config.maxImagesPerCall` = 11; zones beyond it return in `remainingZones` for a follow-up call.
- **Judge** (closed by U34, U35): the visual-judge skill only, no tool. Code checks run first; a fresh subagent gets only the intent lines, the preset rubric, the check JSON and the images, and returns one finding per issue `{ type, severity, evidence: { imageId, visible }, specField, verdict }` with its reasoning before the verdict (U35); types overlap, floating, unreachable, scale, size-rule, palette, lighting, spec-miss, visual; severities blocker, major, minor. The finding shape lives in one JSON Schema file in the skill folder. Only blocker and major findings go back to the builder; the loop stops on pass, after round 3, or when the same finding repeats twice; "no findings" is a valid answer (U34). Each round appends one JSONL line to `.roblox-kit/judge-log.jsonl` in the user's project, whose `.gitignore` gains `.roblox-kit/`.
- **Eval** (closed by you): `npm run eval:studio` runs `scripts/eval-studio.ts`, which builds the 3 fixed benchmark specs in `eval/benchmarks/` (train station, horror facility wing, sci-fi kitchen), checks and captures each (images to gitignored `eval/captures/`), and appends one line per benchmark to the committed `eval/results.jsonl`: commit, date, benchmark, phase part counts, issue counts per kind, performance samples, image count, build ms and a code-based score. Judge scores are not part of the script.
- **Docs** (closed by you): no absolute local path in committed docs; the README changes only where behavior changed; skills change in the last phase through exo edit-skills.

## Assumptions

- Units are studs. Style-less specs keep the shipped defaults: floor Concrete, wall Brick, wall height 12, thickness 1, door width 6, no ceilings.
- `config.defaultSeed` is 1; the PRNG is a 32-bit mulberry-style generator, not cryptographic.
- A MaterialVariant a map creates is named after the map and role and lives in MaterialService; a rebuild reuses it by name.
- Hallway rooms are named `<from>-<to>-hallway` and count as zones for checks and captures.
- The objective points field is `objectives: [{ name, x, y, z }]` on the map spec.
- Image width and height are read from the PNG header of each `screen_capture` image block; a non-PNG block reports its size as unknown.
- Reachability keeps the shipped agent defaults (radius 2, height 5) when no preset is set; avatar height (U28) is UNVERIFIED and not used to derive them.
- Presets and benchmarks use only built-in Materials, so no preset depends on MaterialVariant.
- Work runs on the branch `finished-looking-maps` cut from `main`.

## Acceptance

- `npm run check` passes after every task (Success criterion).
- A connected Studio that reports `"name": null` no longer fails `smoke:studio` (Task 21).
- Presets load by file name, reject bad ranges (ExposureCompensation outside -5 to 5, Range over 120) and merge overrides (Tasks 22 to 26).
- A styled smoke map shows palette colors and flat MaterialVariants on the right roles (Task 28).
- A rebuild keeps the first lighting snapshot and restores it before applying the recipe (Tasks 29, 31).
- Relation specs resolve deterministically; cycles, unknown targets and collisions error naming the rooms (Tasks 32 to 34).
- Decorative parts have collisions off; props generate before checks run (Tasks 36 to 40).
- `build_map` reports `phases` and sends progress when a token is present; a failed phase names itself (Tasks 41 to 43).
- `check_map` reports two-pass overlap, 5-ray floating, spawn-to-room and spawn-to-objective reachability, size rules for preset maps and draw-call and triangle samples per zone (Tasks 44 to 48).
- `capture_zones` returns 2 views per zone plus a top-down cutaway, hides and restores ceilings, reports image sizes and caps images at `config.maxImagesPerCall` (Tasks 49 to 51).
- `npm run eval:studio` appends one line per benchmark to `eval/results.jsonl` (Task 54).
- The visual-judge skill's findings validate against its JSON Schema (Task 55).
- After Task 57, exo verify runs the branch review before any push (Manual checks).

## Manual checks

- With Studio open, "build a train station with three rooms and check it" returns a styled map with zero blocker findings from the visual-judge loop.
- Look at one `eval/captures/` top-down image per benchmark and confirm ceilings are hidden and the palette matches the preset.
- After Task 57, run exo verify (branch review) before exo ship.

## Plan basis

Repository: .
Branch: finished-looking-maps
Worktree setup: none
Land gate: npm run check

## Success criterion

`npm run check` passes.

## Checkpoint

- Blocks first: Task 21 (Studio list fix) gates every `smoke:studio` proof; Task 22 (preset schema) gates Tasks 23 to 57.
- Parallel: none; one task at a time.
- Shared state: `src/config.ts`, `src/map/map-spec.ts`, `src/map/map-layout.ts`, `src/map/build-map-tool.ts`, `luau/build-map.luau`, `luau/check-map.luau`, `src/map/check-map-tool.ts`, `src/map/capture-zones-tool.ts`, `scripts/smoke-studio.ts`.
- Smallest safe split: one module with its colocated test per task; the last task of each phase wires it into the tool and extends `smoke:studio`. Phases: 0 Studio fix (21), 1 presets (22 to 26), 2 surfaces (27, 28), 3 lighting (29 to 31), 4 relations (32 to 34), 5 geometry and props (35 to 40), 6 build phases (41 to 43), 7 check_map (44 to 48), 8 capture and eval (49 to 54), then skills and README (55 to 57).

## Tasks

### Task 21: fix(studio): accept a null Studio name from list_roblox_studios
Depends on: none | Files: `src/studio/studio-mcp-client.ts`, `src/studio/studio-mcp-client.test.ts` | Data: a `{ id, name }` entry with `name` nullable, messages naming the id when the name is null | Proof: npm run smoke:studio
### Task 22: feat(style): define the preset schema and its deep-partial override schema
Depends on: 21 | Files: `src/style/preset-schema.ts`, `src/style/preset-schema.test.ts` | Data: one Zod object schema plus its deep-partial, ranges from U7, U8, U9 | Proof: npm run check
### Task 23: feat(style): load presets by file name from the presets folder
Depends on: 22 | Files: `src/style/load-preset.ts`, `src/style/load-preset.test.ts` | Data: a `Map` from preset name to parsed preset, read relative to `import.meta.url` | Proof: npm run check
### Task 24: feat(presets): add the train station, horror facility, sci-fi station and cozy town presets
Depends on: 23 | Files: `presets/train-station.json`, `presets/horror-facility.json`, `presets/sci-fi-station.json`, `presets/cozy-town.json`, `src/style/presets.test.ts` | Data: one preset JSON object per genre, built-in Materials only | Proof: npm run check
### Task 25: feat(style): resolve a map style from a preset plus overrides
Depends on: 24 | Files: `src/style/resolve-style.ts`, `src/style/resolve-style.test.ts` | Data: one resolved preset object from a deep merge, validated by the full schema | Proof: npm run check
### Task 26: feat(map): accept style and seed in the map spec and resolve them in build_map
Depends on: 25 | Files: `src/map/map-spec.ts`, `src/map/map-spec.test.ts`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `src/config.ts`, `scripts/smoke-studio.ts` | Data: optional `style: { preset, overrides }` and `seed` on the spec object, `config.defaultSeed` | Proof: npm run smoke:studio
### Task 27: feat(map): give each part record a surface role and palette color
Depends on: 26 | Files: `src/map/map-layout.ts`, `src/map/map-layout.test.ts` | Data: a `role` and a `color` on each part record, shipped defaults when no style | Proof: npm run check
### Task 28: feat(map): apply palette colors and flat MaterialVariants when building
Depends on: 27 | Files: `luau/build-map.luau`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `scripts/smoke-studio.ts` | Data: one MaterialVariant per `{ baseMaterial, studsPerTile }` role in MaterialService, reused by name | Proof: npm run smoke:studio
### Task 29: feat(lighting): apply a lighting recipe with a restorable snapshot
Depends on: 28 | Files: `luau/apply-lighting.luau`, `src/lighting/apply-lighting.ts`, `src/lighting/apply-lighting.test.ts` | Data: a JSON attribute `{ lighting, atmosphere, bloom, created }` on the map Model, carried over on rebuild | Proof: npm run check
### Task 30: feat(lighting): place hero, focal and zone-marker lights from light roles
Depends on: 29 | Files: `src/lighting/light-placement.ts`, `src/lighting/light-placement.test.ts`, `src/config.ts` | Data: one `{ role, position, range, shadows }` record per light, shadows only for hero | Proof: npm run check
### Task 31: feat(map): light the map from build_map
Depends on: 30 | Files: `luau/build-map.luau`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `src/map/map-layout.ts`, `src/map/map-layout.test.ts`, `scripts/smoke-studio.ts` | Data: light records instantiated under their zone's parts, recipe applied after geometry | Proof: npm run smoke:studio
### Task 32: feat(map): accept relation-placed rooms in the map spec
Depends on: 31 | Files: `src/map/map-spec.ts`, `src/map/map-spec.test.ts` | Data: a room with either `x`/`z` or `relation: { to, direction, hallwayLength, hallwayWidth }` | Proof: npm run check
### Task 33: feat(map): resolve relations to grid-snapped rooms and hallways
Depends on: 32 | Files: `src/map/relation-solver.ts`, `src/map/relation-solver.test.ts`, `src/config.ts` | Data: a rooms array in dependency order with hallway rooms and matching doors appended, `config.gridStuds` = 5 | Proof: npm run check
### Task 34: feat(map): build relation-placed maps
Depends on: 33 | Files: `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `scripts/smoke-studio.ts` | Data: the solver's rooms array fed to the existing layout | Proof: npm run smoke:studio
### Task 35: feat(shared): add a seeded pseudo-random number generator
Depends on: 34 | Files: `src/shared/seeded-random.ts`, `src/shared/seeded-random.test.ts` | Data: a closure over a 32-bit state returning floats in [0, 1) | Proof: npm run check
### Task 36: feat(map): add optional ceilings tagged for hiding
Depends on: 35 | Files: `src/map/map-layout.ts`, `src/map/map-layout.test.ts`, `src/config.ts` | Data: part records of kind `ceiling`, tag name `config.ceilingTag` | Proof: npm run check
### Task 37: feat(map): add trims, stripes, pillars and arches from the preset
Depends on: 36 | Files: `src/map/room-details.ts`, `src/map/room-details.test.ts` | Data: an array of decorative part records with CanCollide, CanTouch and CanQuery false | Proof: npm run check
### Task 38: feat(props): add generic bench, lamp, pillar, stairs and rail generators
Depends on: 37 | Files: `luau/props/bench.luau`, `luau/props/lamp.luau`, `luau/props/pillar.luau`, `luau/props/stairs.luau`, `luau/props/rail.luau` | Data: one ModuleScript source per kind with `OnGenerate(params, targetContainer)` and a `Random.new(seed)` from an attribute | Proof: npm run check
### Task 39: feat(map): place props from the preset prop kit
Depends on: 38 | Files: `src/map/prop-placement.ts`, `src/map/prop-placement.test.ts`, `presets/cozy-town.json`, `presets/horror-facility.json`, `presets/sci-fi-station.json`, `presets/train-station.json` | Data: one `{ kind, pivot, size, seed }` record per prop | Proof: npm run check
### Task 40: feat(map): build ceilings, details and ProceduralModel props
Depends on: 39 | Files: `luau/build-map.luau`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `scripts/smoke-studio.ts`, `luau/check-map.luau` | Data: one generator ModuleScript per kind under the map Model, `WaitForGenerationAsync` before return | Proof: npm run smoke:studio
### Task 41: feat(server): pass a progress reporter to tool handlers
Depends on: 40 | Files: `src/server/tool-definition.ts`, `src/server/main.ts`, `src/server/main.test.ts` | Data: a `reportProgress(progress, total, message)` function on ToolContext, a no-op without a progressToken | Proof: npm run check
### Task 42: feat(map): group a layout into six ordered build phases
Depends on: 41 | Files: `src/map/build-phases.ts`, `src/map/build-phases.test.ts` | Data: an ordered array of `{ name, parts }` for shell, floors and ceilings, openings, surfaces, props, lighting | Proof: npm run check
### Task 43: feat(map): run build_map as six execute_luau phases with progress
Depends on: 42 | Files: `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `luau/build-map.luau`, `scripts/smoke-studio.ts`, `luau/apply-lighting.luau`, `src/lighting/apply-lighting.ts`, `src/lighting/apply-lighting.test.ts` | Data: one `build-map.luau` call per phase with the phase name as argument, result gains `phases: [{ name, partCount }]` | Proof: npm run smoke:studio
### Task 44: feat(map): add objectives and a performance budget to the map spec
Depends on: 43 | Files: `src/map/map-spec.ts`, `src/map/map-spec.test.ts`, `src/config.ts` | Data: optional `objectives` array and `performanceBudget` object, defaults `config.maxDrawCalls` 1,000 and `config.maxTriangles` 1,000,000 | Proof: npm run check
### Task 45: feat(map): check overlap in two passes and floating with five rays
Depends on: 44 | Files: `luau/check-map.luau`, `src/map/check-map-tool.test.ts` | Data: the existing issue array, broad `GetPartBoundsInBox` then narrow `GetPartsInPart` with `RespectCanCollide` | Proof: npm run check
### Task 46: feat(map): check reachability from every spawn to every room and objective
Depends on: 45 | Files: `luau/check-map.luau`, `src/map/check-map-tool.ts`, `src/map/check-map-tool.test.ts` | Data: one issue per failed `{ spawn, target }` pair, pairs over 3,000 studs as `tooFar` | Proof: npm run check
### Task 47: feat(map): report size-rule violations for preset maps
Depends on: 46 | Files: `src/map/size-rules.ts`, `src/map/size-rules.test.ts`, `src/map/check-map-tool.ts`, `src/map/check-map-tool.test.ts`, `src/map/check-report-store.ts` | Data: issue records of kind `sizeRule` computed from the layout, empty when no preset | Proof: npm run check
### Task 48: feat(map): sample draw calls and triangles per zone camera
Depends on: 47 | Files: `luau/sample-scene-stats.luau`, `src/map/check-map-tool.ts`, `src/config.ts`, `scripts/smoke-studio.ts`, `src/map/check-map-tool.test.ts` | Data: one `{ zone, drawCalls, triangles }` sample per zone camera after `config.statsSettleSeconds` | Proof: npm run smoke:studio
### Task 49: feat(map): frame two opposite views per zone and one top-down cutaway
Depends on: 48 | Files: `src/map/zone-cameras.ts`, `src/map/zone-cameras.test.ts` | Data: a shots array of `{ zone, view, cameraPosition, lookAt }`, view `a`, `b` or `top` | Proof: npm run check
### Task 50: feat(map): hide tagged ceilings during capture and restore them
Depends on: 49 | Files: `luau/set-ceilings-hidden.luau`, `src/map/capture-zones-tool.ts`, `src/map/capture-zones-tool.test.ts`, `src/config.ts` | Data: each ceiling's original Transparency in a part attribute, restored in `finally` and at call start | Proof: npm run check
### Task 51: feat(map): report image sizes and cap images per call
Depends on: 50 | Files: `src/map/capture-zones-tool.ts`, `src/map/capture-zones-tool.test.ts`, `src/config.ts`, `scripts/smoke-studio.ts` | Data: shots gain `width` and `height`, result gains `remainingZones` and `warnings` arrays | Proof: npm run smoke:studio
### Task 52: feat(eval): add the three benchmark map specs
Depends on: 51 | Files: `eval/benchmarks/train-station.json`, `eval/benchmarks/horror-facility-wing.json`, `eval/benchmarks/sci-fi-kitchen.json`, `src/eval/benchmarks.test.ts` | Data: one map spec JSON per benchmark, parsed by `mapSpecSchema` | Proof: npm run check
### Task 53: feat(eval): compute a code-based benchmark score
Depends on: 52 | Files: `src/eval/code-score.ts`, `src/eval/code-score.test.ts` | Data: one number from 0 to 100 computed from issue counts and the performance budget | Proof: npm run check
### Task 54: feat(eval): add eval:studio appending one result line per benchmark
Depends on: 53 | Files: `scripts/eval-studio.ts`, `package.json`, `.gitignore`, `eval/results.jsonl` | Data: one JSON line per benchmark appended to `eval/results.jsonl`, images to gitignored `eval/captures/` | Proof: npm run eval:studio
### Task 55: feat(skills): add the judge finding schema and loop to visual-judge
Depends on: 54 | Files: `skills/visual-judge/SKILL.md`, `skills/visual-judge/finding.schema.json` | Data: one JSON Schema for a finding, one JSONL line per round in `.roblox-kit/judge-log.jsonl` | Proof: npm run check
### Task 56: feat(skills): teach map-building presets, relations, seeds and phases
Depends on: 55 | Files: `skills/map-building/SKILL.md` | Data: one SKILL.md with frontmatter | Proof: npm run check
### Task 57: docs(readme): update the quick start and tool reference for changed behavior
Depends on: 58 | Files: `README.md` | Data: changed lines only where a tool's input or result changed | Proof: npm run check
### Task 58: feat(map): capture two views per zone and the top-down cutaway in capture_zones
Depends on: 56 | Files: `src/map/capture-zones-tool.ts`, `src/map/capture-zones-tool.test.ts`, `scripts/smoke-studio.ts`, `scripts/eval-studio.ts` | Data: `zoneShots` from Task 49 drives the captures; each shot gains `view` (`a`, `b` or `top`); the one top-down cutaway comes first, then whole zones' view pairs up to `config.maxImagesPerCall` images, the rest in `remainingZones` | Proof: npm run smoke:studio
