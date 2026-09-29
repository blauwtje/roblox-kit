Task 22 b6aa569: colors are #rrggbb strings; surface role color is a hex, not checked against the palette (an override cannot keep a refine).
Task 22 b6aa569: size rules are agentRadius, agentHeight, minDoorwayWidth, minHallwayWidth, minWallHeight; light roles are { range, brightness, color } with no shadows field (only hero casts, decided at placement).
Task 22 b6aa569: only U7, U8, U9 ranges are bounded; other lighting numbers are nonnegative only, since the spec sets no other ranges.
Task 23 c619fd3: loadPresets takes an optional folder URL (default the bundled presets folder) so tests use a temp folder without touching the real presets.
Task 23 c619fd3: one invalid file fails the whole load, rather than skipping it.
Task 23 c619fd3: only files ending in .json are read; other files in the folder are ignored.
Task 24 96af366: palette and Material picks per genre (train station Slate/Brick/Metal, horror DiamondPlate/Concrete/Neon accent, sci-fi SmoothPlastic/Metal/Neon accent, cozy WoodPlanks/Plaster/Wood/Fabric) are mine, the spec sets no values.
Task 24 96af366: minWallHeight is 16 for train station and 12 elsewhere; doorways and hallways are 10 to 12, all at or above the 10-stud check_map limit.
Task 24 96af366: prop kit names are lowercase kebab-case strings, since Task 39 (props) has not defined a prop list yet.
Task 25 e17c2dc: resolveStyle is pure and takes the loaded presets map, so callers load once with loadPresets and resolution stays synchronous.
Task 25 e17c2dc: overrides are parsed with presetOverridesSchema first (rejects unknown keys and out-of-range values with the override error), then the merged result is validated by the full presetSchema.
Task 25 e17c2dc: presetOverridesSchema keeps every leaf constraint, so the final full-schema pass cannot currently fail after a valid override; it stays as the guard the task names, and has no test of its own.
Task 26 76c8d12: the resolved style and the seed do not reach layout or Luau yet; build_map only validates the style (task 27 layout consumes it) and `seed ?? config.defaultSeed` is applied where used, not in the schema, so MapSpec output types of existing callers stay unchanged.
Task 26 76c8d12: presets load at module import (top-level await), so a broken bundled preset fails server start.
Task 26 76c8d12: seed is z.int().nonnegative(); preset is any non-empty string, checked against the loaded presets in build_map, not the schema.
Task 27 e3c82e9: the spawn pad takes role "floor" (it already shares the floor material), not "accent".
Task 27 e3c82e9: defaults live in map-layout.ts as a constant, because config.ts is outside Files.
Task 27 e3c82e9: build_map does not yet pass a resolved style to layoutMap (build-map-tool.ts is outside Files); a later task wires it.
Task 28 884472c: a variant is applied to a part only when the part's material equals the variant's baseMaterial (Roblox ignores it otherwise).
Task 28 884472c: variant name is `<mapId>-<role>` per the spec assumption; smoke cleanup removes those named `roblox-kit-smoke-*`.
Task 28 884472c: only roles with parts today (floor, wall; spawn takes floor) get variants.
Task 29 e0d73d0: created is a list of class names ("Atmosphere", "BloomEffect"); atmosphere and bloom in the snapshot hold the previous values of a reused effect and are absent when the apply created it.
Task 29 e0d73d0: colors and the LightingStyle are stored in the snapshot as hex strings and the enum name, so the attribute stays plain JSON.
Task 29 e0d73d0: applyLighting is not wired into build_map yet (Task 31 names the wiring); a missing map Model fails the apply with a message naming it.
Task 30 f1dd7c2: one light per room at its center; the focal light is added to a spawn room in addition to its hero or zone marker, not instead of it.
Task 30 f1dd7c2: config.lightCeilingDropStuds = 1 and config.focalLightHeightStuds = 6 (studs above the floor top at y = 0).
Task 31 db45d0b: preset surface material precedence is room > spec > preset > config default.
Task 31 db45d0b: a light is tied to the first room whose center equals its x/z (placements carry no room name).
Task 31 db45d0b: lights hang from an Attachment on the zone's floor part, so partCount and check_map are unchanged.
Task 32 07d8450: kept `mapSpecSchema` placed-only and added `relationMapSpecSchema`, because widening it makes room.x/z optional and breaks typecheck in map-layout.ts, light-placement.ts, build-map-tool.ts (outside Files).
Task 32 07d8450: hallwayLength and hallwayWidth are required (no defaults); the spec sets none.
Task 32 07d8450: relation.to is not checked against room names in the schema; Task 33's solver errors on unknown targets and cycles.
Task 33 fc670ad: a related room's center snaps away from its target (ceil east/south, floor west/north) so the hallway is never shorter than hallwayLength; the hallway fills the real gap, so it may be up to one grid step longer.
Task 33 fc670ad: the perpendicular center snaps to nearest grid; the hallway keeps the target's center line and the new room's door gets the offset that meets it.
Task 33 fc670ad: hallway doorWidth = min(target door width, room door width, hallwayWidth - 2 * wall thickness); errors if that is <= 0.
Task 33 fc670ad: collisions are checked only for pairs with a solver-placed room or hallway, so overlapping all-placed specs still build as before (check_map reports them).
Task 33 fc670ad: a hallway name equal to an existing room name errors.
Task 34 a30e7db: wired resolution in build-map-tool.ts rather than map-layout.ts, since layoutMap takes placed-only MapSpec.
Task 34 a30e7db: relation spec only in the smoke build call; expectations use the resolved spec.
Task 35 7d30487: export name createSeededRandom, algorithm mulberry32.
Task 36 d6fbfd5: ceilings are opt-in through a `LayoutOptions.ceilings` argument, default off, because map-spec.ts is outside Files and build_map (which passes preset surfaces with a ceiling role) must not change output before Tasks 40 and 50 build and hide them.
Task 36 d6fbfd5: a ceiling is a slab of wall thickness over the room footprint, bottom face on the wall tops (y = wallHeight + thickness/2); color falls back to #d6d6d6 and material to config.defaultCeilingMaterial (Concrete) when surfaces name none.
Task 36 d6fbfd5: config.ceilingTag = "RobloxKitCeiling"; the tag is applied in Luau by Task 40, not on the record.
Task 37 e123bc7: details take the wall parts from layoutMap and read each wall's side from its name (config.wallNameInfix), rather than recomputing door gaps.
Task 37 e123bc7: an arch is two jambs plus a lintel on the inner wall face, since parts are axis-aligned boxes.
Task 37 e123bc7: corner pillars are skipped where a doorway arch would cover them, and in rooms whose inner span is under 4 pillar widths.
Task 38 a8cf9c0: addPart is duplicated per file, because each source is standalone (a ProceduralModel script cannot require a shared module).
Task 38 a8cf9c0: generator kinds are named bench, lamp, pillar, stairs, rail, after the file names.
Task 39 cbb53b4: presets' kits are cozy-town bench/lamp/rail; horror-facility pillar/lamp/stairs; sci-fi-station pillar/lamp/stairs/rail; train-station all five.
Task 39 cbb53b4: props stand against walls, clear of doorways, the corner pillars of room-details and each other; a prop with no free spot in 12 tries is dropped.
Task 39 cbb53b4: an unknown kit name (e.g. a user override) throws instead of being skipped; the preset schema is unchanged.
Task 39 cbb53b4: record holds only kind, pivot, size, seed (no name or room); Task 40 derives names.
Task 39 cbb53b4: sizes and spacing live in propDimensions in prop-placement.ts, not config (config.ts is outside Files).
Task 41 e5df361: reportProgress is optional on ToolContext so existing direct handler calls in tests keep compiling; the doc comment says to make it required later.
Task 41 e5df361: reporter awaits `callContext.mcpReq.notify` so notification send failures surface to the handler.
Task 42 1e61564: phase names are the plan's words verbatim: "shell", "floors and ceilings", "openings", "surfaces", "props", "lighting".
Task 42 1e61564: walls are shell; floor, spawn and ceiling parts are floors and ceilings; arch details are openings; trim, stripe and pillar details are surfaces.
Task 42 1e61564: lights are a generic type parameter, since LightRecord is private to build-map-tool.ts and Task 42 edits no other file.
Task 42 1e61564: an empty phase stays in the array with no parts, so there are always six phases.
Task 43 cd8f4c9: apply-lighting.luau takes an absent recipe (restore-only), per the task message.
Task 43 cd8f4c9: unstyled builds also call applyLighting (restore only), so 7 execute_luau calls.
Task 43 cd8f4c9: the shell phase carries the material names of parts, details, fills and variants for the up-front check.
Task 43 cd8f4c9: fixed the failing relation test's fake Studio, not its assertions.
Task 44 383a958: performanceBudget always present after parse (defaults filled from config); objectives stays absent when unset.
Task 44 383a958: objective names are not required unique (the brief names no rule).
Task 45 44659dd: decorative parts (CanCollide false, CanQuery false) are neither checked for floating nor hit by rays; they hang on walls, and the plan line is silent.
Task 45 44659dd: a part resting only on another floating part counts as supported (limit noted in a code comment; lift by grounding hits recursively).
Task 45 44659dd: kept restsOnTerrain rather than relying on ray hits on Terrain, because it was proven in Studio (implementer-14).
Task 46 67b5bd7: check_map has no spec, so objectives and preset arrive as optional check_map inputs (build_map does not store them on the Model; its files are outside Files).
Task 46 67b5bd7: tooFar is an "unreachable" issue whose detail starts "tooFar:" (no new kind or count key), because the kind enum lives in check-report-store.ts, outside Files.
Task 46 67b5bd7: the 3,000-stud limit is a constant in check-map-tool.ts, not config.ts (outside Files).
Task 46 67b5bd7: size-rule violations (doorway/hallway/wall under 10) not built here; the task title and Files cover reachability only.
Task 47 2cc140a: check_map gets the layout from a new optional `spec` input (as with objectives and preset in task 46); size rules run only when both preset and spec are given, else counts.sizeRule is 0.
Task 47 2cc140a: counts gain a `sizeRule` key and CheckIssue kind gains "sizeRule"; the stored report caps sizeRule issues at config.maxIssuesPerKind, the count stays exact.
Task 47 2cc140a: one issue per doorway gap (from gaps between wall parts, all rooms including hallways), one per room for wall height, one per hallway for width; hallways are the rooms relations added.
Task 48 419b21e: samples are reported only, not compared with the maxDrawCalls/maxTriangles budget (task Data names samples only); budget judging is left to a later task.
Task 48 419b21e: sceneStats is a new top-level key of the check_map output; passed and counts unchanged.
Task 49 9c1f785: the top view pitches to 89 degrees, not 90, because a camera looking exactly along the world up axis has no defined roll in Studio; a true 90 needs an explicit up vector in the capture call.
Task 49 9c1f785: zoneShot stays exported with its old output so existing callers keep working; zoneShots is added beside it and no caller is switched to it in this task.
Task 49 9c1f785: view b is the mirror of view a across the zone center on the Z axis (same distance and pitch, camera on the -Z side).
Task 50 8d8ae53: readOnlyHint stays true (net effect on the place is none, existing test asserts it); the description now states that ceilings are hidden during the call and restored.
Task 50 8d8ae53: the call-start restore runs before read-map-zones, so a missing map fails there with the same "Call build_map" message.
Task 50 8d8ae53: only ceilings inside the named map Model are touched, found by config.ceilingTag; hiding sets Transparency 1 and stores the first-seen original, so a repeated hide never overwrites it.
Task 51 4dadd49: real Studio screen_capture returns image/jpeg (found by the first smoke run), so size is read from PNG or JPEG headers in the tool with no image library; any other format throws after ceilings are restored.
Task 51 4dadd49: the cap slices zones in map order after zone selection; capped zones go to remainingZones and are never captured.
Task 51 4dadd49: one warning string per out-of-range image (long edge outside imageLongEdgeMin..imageLongEdgeMax); images are still returned.
Task 52 fb1eaee: specs use relations, so the test parses them with relationMapSpecSchema (build_map's input) and then parses resolveRelations output with mapSpecSchema; a relation spec cannot parse with mapSpecSchema directly.
Task 52 fb1eaee: ceilings, trims and props come from the style preset (no spec fields), so each benchmark sets style.preset and no other decor field.
Task 52 fb1eaee: wallHeight 16 / doorWidth 10 (train station) and 14 / 10 (horror, sci-fi) and hallwayWidth 12 so findSizeRuleIssues returns none; train-station hallwayLength is 15 because a hallway shorter than 12 counts as narrower than the preset's minHallwayWidth.
Task 52 fb1eaee: seeds 101, 202, 303 and mapIds prefixed benchmark- so a benchmark never replaces a user's map.
Task 52 fb1eaee: no Studio run; the tests cover parse, relation resolve, layout, props, size rules and objectives inside rooms.
Task 53 9d4578a: the weights (10 per issue, 80 issue cap, 20 performance cap) are named constants in code-score.ts, not config.ts, because config.ts is outside the Files line; moving them to config is a later option.
Task 53 9d4578a: counts is Record<string, number> summed over all kinds, so a new check_map issue kind is scored without a change here.
Task 53 9d4578a: no samples means no performance penalty; the budget comes from the caller (the spec's performanceBudget), so the module does not read config.
Task 54 7a3bb80: results.jsonl is append-only; the first, second and third run all stay in it (9 lines), none deleted.
Task 54 7a3bb80: the built benchmark-* maps and the last preset's Lighting stay in the open place after the run (no restore; replaced on the next run) so the maps can be looked at; the smoke's cleanup Luau is not shared and smoke-studio.ts is outside Files.
Task 54 7a3bb80: benchmarks are every eval/benchmarks/*.json in name order; the score budget is the spec's performanceBudget.
Task 55 2ae7e1d: the schema requires type, severity, evidence, reasoning and verdict; specField is optional because the plan says a spec field is given when the judge can tell.
Task 55 2ae7e1d: evidence.imageId is the zone name of the capture_zones shot, because the tool returns no other image id.
Task 55 2ae7e1d: verdict is a one-sentence string, not an enum; the earlier ok/defect per-zone verdict is replaced by per-issue findings.
Task 55 2ae7e1d: a repeated finding means the same type, specField and imageId in two rounds.
Task 55 2ae7e1d: the JSONL line is { round, date, mapId, zones, findings }, stated in SKILL.md only (the plan asks for a schema for a finding, not for the log line).
Task 55 2ae7e1d: the judge brief stays inline in SKILL.md (no judge-prompt.md), since Files lists two paths.
Task 55 2ae7e1d: "preset rubric" is the preset's palette, surfaces and lighting fields.
Task 56 c0fd14e: the skill describes only what the shipped tools do today; capture_zones is described as images per zone with `remainingZones` and the per-call cap, not two views plus a top-down shot, because Tasks 49 to 51 have not wired the tool that way (the tool description still says one angled shot per zone).
Task 56 c0fd14e: `check_map` is told to receive `preset` and `spec` because size rules only run with both (check-map-tool input schema).
Task 56 c0fd14e: the Clean up section is unchanged; how Lighting is restored when a map Model is destroyed is unverified, so no claim was added.
Task 56 c0fd14e: sizes are stated as "at or above the preset's size rules" without numbers, since they differ per preset (train-station: doorway 10, hallway 12, wall 16).
Task 58 7b137ee: the cutaway zone is the mapId, framed on the union of all zones, even when a subset of zones is requested.
Task 58 7b137ee: images per call = 1 cutaway + 2 per zone, so maxImagesPerCall 11 gives 5 zones.
Task 58 7b137ee: capture_id is roblox-kit-<mapId>-<zone>-<view>; eval captures are saved as eval/captures/<benchmark>/<zone>-<view>.<ext>.
Task 58 7b137ee: the description, errors and warnings name the view.
Task 58 7b137ee: existing assertions in capture-zones-tool.test.ts were updated to the new counts, none loosened.
Task 58 7b137ee: eval:studio was not run; eval/results.jsonl is untouched.
Task 57 bb09e98: build_map `objectives` is described as accepted and unused by the build, because only check_map's own `objectives` input reaches pathfinding.
Task 57 bb09e98: the image cap is written as 11 and the long-edge range as 1000 to 1568 (config values), the same numbers the tool description derives from config.
