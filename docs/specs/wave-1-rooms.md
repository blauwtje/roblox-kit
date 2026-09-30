# Wave-1 train-station rooms that pass the quality review

## Goal
`npm run eval:studio` scores every axis median of the train-station `platform`, `concourse` and `ticket-hall` at 7 or more with zero `check_map` issues, and fails when a wave-1 room scores lower.

## Evidence
The first recorded run after `0954a5a` (the last `train-station` line of `eval/results.jsonl`, run on 2026-09-30), 40/40 captures non-blank, every place check passed:

| Room | palette | focalHierarchy | negativeSpace | readability | atmosphere | lighting |
|---|---|---|---|---|---|---|
| concourse | 7 | 7 | 5 | 7 | 6 | 4 |
| platform | 5 | 3 | 5 | 4 | 5 | 3 |
| ticket-hall | 6 | 4 | 5 | 5 | 5 | 4 |
| mean | 6.0 | 4.7 | 5.0 | 5.3 | 5.3 | 3.7 |

`check_map` findings: 2, both `placement`: `sign-1` and `sign-3` of `benchmark-train-station` at y 13, "no floor under its center or footprint corners ... and it touches no wall". No other kind was found.

Recurring evidence notes, most frequent first, counted by keyword over the 54 notes (3 reviewers x 3 rooms x 6 axes):
- Flat, untextured pure-white props (benches, pillars, railings, lamp bases) that look like placeholders: 17 notes naming "white", across the platform and ticket-hall palette and atmosphere notes.
- No visible overhead light source, and no crisp shadows at eye height: 10 notes, including all 9 lighting notes. Concourse and platform read dim and murky; the ticket hall reads flat and near blown-out.
- A large bare foreground floor, with furniture bunched into one half or scattered without a walkway: 9 notes, all 9 negative-space notes.
- Free-standing lamp posts in the middle of the ticket hall, blocking the view and reading as outdoor street lamps: 9 notes.
- A plain dark slab in the concourse center that pulls the eye and breaks the walkway: 8 notes.
- A rough, rock-like dark concourse floor that ties weakly to the walls: 6 notes.
- The eye view shows no focal piece: the platform shows only bench backs against brick, with its sign, track and exit out of view, and a lamp post splits the ticket-hall view: all 6 platform and ticket-hall focal-hierarchy notes.

The run after Task 3 (`d1a9511`, ran 2026-09-30T10:27) moved no weak axis up: lighting mean 3.7 -> 3.7, focalHierarchy 4.7 -> 4.7, negativeSpace 5.0 -> 4.7 (platform 5 -> 4). `sign-1` (z 418.8) and `sign-3` (z 436.2) still float at y 13. The concourse place check failed: the reviewer named it "waiting concourse", and `placeMatches` in `src/eval/blind-place-check.ts` accepts only an exact normalized name. Reviewers still note no visible light source: each room has 1-2 point lights, and Task 2's one fixture sits at the ceiling center, above the eye view.

The run after Task 10 (`3e40298`, 2026-09-30) failed the gate: codeScore 100 and every place check passed for all three benchmark places, but no train-station room reached 7 on any axis except the platform's palette:

| Room | palette | focalHierarchy | negativeSpace | readability | atmosphere | lighting |
|---|---|---|---|---|---|---|
| concourse | 6 | 5 | 5 | 6 | 6 | 5 |
| platform | 7 | 3 | 5 | 4 | 6 | 5 |
| ticket-hall | 6 | 5 | 5 | 6 | 5 | 5 |

## Decisions
- The work is ordered by weakest axis first (lighting, focal hierarchy, negative space, readability, atmosphere, palette), after the one `check_map` finding kind (placement), which blocks the zero-issue goal. Closed by you.
- The quality gate turns on here: `npm run eval:studio` fails when a wave-1 room's axis median is below `config.visualPassScore` (7), as well as when a place check fails. Closed by the visual-quality brief ("the quality gate turns on in the follow-up brief, once the rooms are fixed").
- The calibration bounds (`calibrationReferenceMeanFloor`, `calibrationBadAnchorMeanCeiling`, `calibrationAxisGap`) and `visualPassScore` stay unchanged. Closed by you.
- Genre-specific numbers (light brightness, ranges, colors, materials, arrangement spacing) go in `presets/train-station.json`; code gains only genre-independent behavior. Closed by you.
- Rooms are fixed in what they build, not in how the eye view frames them: `eyeShot` in `src/map/zone-cameras.ts` stays as it is, so the scores still show what a player standing at the entry sees. Closed by exo, confirmed by you.
- Lights the player sees: each room gets visible fixtures in a repeating pattern from preset data (fixture kind and spacing per preset, no number in code), placed in the forward view instead of only at the ceiling. Hero lights cast shadows through `Light.Shadows`; the fixture lights cast none. Closed by you.
- The doorway-sign fix starts with a failing test that reproduces `sign-1` and `sign-3` from the benchmark's real layout, and ends with each sign flat against a wall or on a floor. Closed by you.
- The place check accepts a named room that contains the room type or an accepted name as whole words, so "waiting concourse" passes for `concourse`. Closed by you.
- Hero props (after the Task 10 eval): where primitive parts give a room no clear focal point, it gets 1-2 new meshes generated by our own Blender Python code. No existing asset packs, store models, downloaded models or blender-mcp integrations. Closed by you.
- Each hero prop is a recipe in `presets/`: dimensions in studs, palette roles from the preset, a triangle budget and a stylized low-poly style. Code holds nothing genre-specific. Closed by you.
- Generators are headless Blender Python scripts in the repository, deterministic from the recipe, exporting the format the evidence favors; a structural check (triangles, dimensions, materials) tests every export. Closed by you.
- Each export is rendered from 3 angles and scored against its recipe by a fresh reviewer before upload, at most 3 rounds per prop. Closed by you.
- Uploads go through Open Cloud with an API key from the plugin's `userConfig` (`sensitive: true`); asset ids are cached by recipe hash, so an unchanged recipe never uploads again. Without a key the build keeps primitive parts and says so. Closed by you.
- `build_map` places the hero props as each room's focal point from the preset, with decorative colliders off, and `check_map` still passes. Order: platform first (focalHierarchy 3, readability 4), then concourse and ticket hall. Closed by you.
- Anything that needs your Roblox account (the API key, the first upload) and every eval run are asked first. Closed by you.

## Assumptions
- The concourse's dark slab is its spawn pad: `spawnPart` in `src/map/map-layout.ts` builds a door-wide pad at the room center in the floor's material and color, and the benchmark concourse is the spawn room.
- The white props are benches, lamps, pillars and rails: their generators in `luau/props/` set no `Color` or `Material`, so their parts keep Roblox's default plastic. The ticket machine, counter and board generators set their own colors.
- A prop colored from a surface role reads the role's color and material from the preset's `surfaces`, passed as `SurfaceColor` and `SurfaceMaterial` generator attributes; `addProps` in `luau/build-map.luau` already turns an attribute ending in `Color` into a `Color3`. A prop rule without a surface role keeps today's look, so other presets do not change.
- The doorway signs float because a doorway is a full-height gap in its wall (`wallParts` and `wallStretches` in `src/map/map-layout.ts` build no wall part above a door), so a sign 8 wide centered in a 10-wide doorway touches no part named with `config.wallNameInfix`, whatever its inset. Task 1 moved its inset onto a wall face that is not there. A sign hung flat on the wall stretch beside its doorway touches a wall part and satisfies `restsOnWall` in `luau/check-map.luau` without an exemption; a door with no clear stretch beside it gets no sign and a placement warning, never a floating sign.
- The fixture kinds are `sconce` (flat on a wall's inner face, on stretches clear of doorways, at a set height above the floor) and `pendant` (hanging a set drop below the ceiling in a grid). The train station uses sconces, which the eye view (5 studs up, tilted 10 degrees down) shows on the far and side walls where a ceiling fixture stays out of frame.
- With `lightFixtures` in a preset, each room's ceiling-center light takes the `hero` role and casts shadows, and its fixtures take the `zoneMarker` role and cast none; a preset without `lightFixtures` keeps today's one hero in the largest room, so the other genres do not change.
- The train station starts at sconces 10 studs apart with their centers 8 studs above the floor; the eval after Task 6 tunes them.
- Every `PointLight` hangs from an invisible `Attachment` on its zone's floor part (`addLight` in `luau/build-map.luau`), so a ceiling light has no visible fixture. A fixture is one decorative `Neon` part per light within `config.lightCeilingDropStuds` of the ceiling, colored by its light, not collidable or queryable, and tagged `config.ceilingTag` so cutaways hide it with the ceiling.
- The ticket hall's lamp posts come from its `grid` arrangement of `lamp` at spacing 7; lamps along the doorless walls keep the light and clear the floor.
- The platform gains a `clock` set piece as its focal piece; `standingPiece` places it on the room's east-west center line, facing north and south.
- The concourse floor becomes `Marble` in a lighter warm grey that sits between the wall and floor colors of the palette; the palette's `colors` list takes the new floor color in place of `#3b3f45`.
- A preset-level test of `placeArrangements` on `eval/benchmarks/train-station.json` can prove that the concourse's and ticket hall's arranged pieces fall on both sides of each room's center lines, without Studio.
- Each `npm run eval:studio` run takes about 20 minutes and runs 9 headless reviewers; the eval-based proofs below are the only way to read the axis scores.
- Blender runs headless as the animation skill runs it (`blender -b --factory-startup -P <script> -- <args>`, Blender 5.1.2 at `/opt/homebrew/bin/blender`), so blender-mcp, its integrations and its telemetry never load.
- The export format is GLB (`model/gltf-binary`, one of the Model formats the Open Cloud Assets guide lists): its JSON chunk lets a plain TypeScript test read triangle counts, bounds and mesh and material names with no Blender or FBX parser, and Blender 5.1's `export_scene.gltf` exports Y-up by default. The first upload confirms Studio imports it; if it does not, FBX replaces it in a plan repair.
- A recipe's parts are `box`, `cylinder` and extruded `profile` shapes, each with a surface role (`floor`, `wall`, `trim`, `ceiling`, `accent`). The generator joins each role's parts into one object named after the role, so each role becomes one MeshPart that `build_map` colors from the preset's surface, as Task 6 colors primitive props. The generator uses no randomness, so the recipe alone fixes the mesh.
- A hero prop replaces one set piece and takes its slot (pivot and yaw), standing on the floor; when the hero has no uploaded asset, that set piece builds as today, which is the primitive fallback. The platform's `train-car` replaces the `track-bed`, which runs along the platform's far (south, 60-stud, doorless) wall; the concourse's hero replaces its `departure-board` and the ticket hall's its `ticket-counter`, the piece in its facing-entry slot (not a ticket machine, which has no slot there).
- The recipe hash is a SHA-256 of the resolved recipe plus the generator's source, so a generator change also uploads anew. Build output goes to the gitignored `.roblox-kit/hero-props/`; recorded asset ids live in the committed `src/hero-props/hero-assets.json`, because `loadPresets` reads every `.json` file in `presets/` as a preset.
- The upload runs inside `build_map` (the MCP server gets the key through `mcpServers.roblox-kit.env`), not from an npm script, because `userConfig` values reach only the plugin's MCP servers and hooks. `npm run eval:studio` reads the recorded ids and uploads nothing.
- Uploads go to your personal account (`creationContext.creator.userId`); the key needs the Assets API with Read and Write on the place's experience. Both are asked before the first upload.
- `InsertService:LoadAsset` loads the creator's own Model in Studio edit mode (capability `LoadOwnedAsset`); plugin-level edit-mode use and whether moderation must finish first are unconfirmed until the first upload.
- The render review scores silhouette, proportions, style and role separation 1-10, passing at `config.visualPassScore` on every axis, through the same `claude -p` spawn as the eval's reviewers, which moves into one shared function at its third copy.
- CI has no Blender: the GLB reader and review rules are unit-tested in CI, and the generator and renderer run only in the local `npm run hero-props` proofs.

## Acceptance
- `npm run eval:studio` exits 0 with the train-station line showing zero `check_map` issues and every wave-1 axis median at 7 or more (Tasks 1-14).
- `npm run smoke:studio` shows a visible fixture per ceiling light in the smoke map, hidden with the ceilings in cutaways (Task 2).
- `node --test src/eval/blind-place-check.test.ts` accepts "waiting concourse" for `concourse` and still rejects another room type (Task 11).
- `node --test src/map/set-piece-placement.test.ts` fails on `sign-1` and `sign-3` of the benchmark layout before the fix and passes after it; the eval after Task 6 shows 0 `placement` issues (Task 12).
- `npm run smoke:studio` shows a sconce part holding a light on the smoke map's walls, with only the hero lights casting shadows (Tasks 13, 14).
- `node scripts/measure-wall-color.ts` shows the train-station walls lit close to their preset color, not darker (Task 3).
- `node scripts/calibrate-review.ts` still passes with its bounds unchanged (Success criterion).
- `npm run check` passes (Tasks 1-26, Success criterion).
- `npm run hero-props -- train-station <kind>` exports a GLB within its triangle budget and size, renders 3 angles, and exits 0 only when the fresh review passes, refusing a fourth round (Tasks 18-21, 24, 25).
- `build_map` without a key builds the replaced set pieces and names the missing key; with a key it uploads each reviewed GLB once and reuses the recorded id afterwards (Tasks 22, 23).

## Manual checks
- Look at the three wave-1 eye views next to their new scores; each room should read as a finished station room from the entry.
- Create an Open Cloud API key with the Assets API (Read and Write) on the place's experience, and enter it with your user id in the plugin's settings.

## Plan basis
Repository: /Users/thomash/Documents/Code/personal/tools/roblox-kit
Branch: wave-1-rooms
Worktree setup: none
Land gate: npm run check

## Success criterion
`npm run check && node scripts/calibrate-review.ts && npm run eval:studio` passes.

## Checkpoint
- Blocks first: Tasks 11, 12, 13 and 14 (the revision after the Task 3 eval), before Task 4; after the Task 10 eval, Task 15 (the recipe schema) before every hero-prop task.
- Parallel: Tasks 11, 12 and 7 share no file with each other or with Tasks 13 and 14; Task 17 shares no file with Tasks 15 and 16, both after Task 10.
- Shared state: `presets/train-station.json` (Tasks 3, 13, 4, 5, 6, 8, 9, 16, 21, 24, 25), `src/map/build-map-tool.ts` (Tasks 13, 14, 6, 23), `luau/build-map.luau` (Tasks 2, 14, 23), `scripts/hero-props.ts` (Tasks 18, 19, 20), `src/config.ts` (Tasks 18, 20, 22, 23), and the one open Studio place every smoke and eval proof uses.
- Smallest safe split: one task per finding, serialized 3 -> 13 -> 14 -> 4 -> 5 -> 6 -> 8 -> 9 on the preset and build files, with the gate last; the hero props serialize 15 -> 16 -> 18 -> 19 -> 20 -> 21 -> 24 -> 25 on the preset and script, and 20 -> 22 -> 23 on the upload and build.

## Tasks
### Task 1: fix(set-pieces): hang doorway signs against the wall above the door
Depends on: none | Files: `src/map/set-piece-placement.ts`, `src/map/set-piece-placement.test.ts` | Data: the in-doorway sign record's inset, so its back face lies on the room-side face of the wall above its doorway | Proof: npm run eval:studio
### Task 2: feat(build-map): show a fixture for each ceiling light
Depends on: none | Files: `luau/build-map.luau`, `src/config.ts`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `scripts/smoke-studio.ts` | Data: one decorative Neon part per light record within `config.lightCeilingDropStuds` of the ceiling, sized by one config constant and tagged `config.ceilingTag` | Proof: npm run smoke:studio
### Task 3: feat(presets): light the train station bright and even with crisp shadows
Depends on: 2 | Files: `presets/train-station.json` | Data: the preset's `lighting` object (lower `ShadowSoftness`, no bloom glare) and `lightRoles` brightness and range | Proof: node scripts/measure-wall-color.ts
### Task 11: fix(eval): accept a place-check room name that contains the expected room term
Depends on: none | Files: `src/eval/blind-place-check.ts`, `src/eval/blind-place-check.test.ts`, `skills/visual-judge/SKILL.md` | Data: the answer's normalized room name as a list of hyphen-separated words, passing when the room type's or an accepted name's words appear in it as one consecutive run | Proof: node --test src/eval/blind-place-check.test.ts
### Task 12: fix(set-pieces): hang each doorway sign flat on the wall beside its doorway
Depends on: 1 | Files: `src/map/set-piece-placement.ts`, `src/map/set-piece-placement.test.ts` | Data: the north or south door's sign record placed on the wall stretch beside the doorway, back face on the inner wall face, proven first by a failing test over `layoutMap` of the resolved `eval/benchmarks/train-station.json` that every sign's box touches a wall-named part record | Proof: npm run eval:studio
### Task 13: feat(lighting): place light fixtures in a repeating pattern per room from preset data
Depends on: 3 | Files: `src/style/preset-schema.ts`, `src/style/preset-schema.test.ts`, `src/lighting/light-placement.ts`, `src/lighting/light-placement.test.ts`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `presets/train-station.json` | Data: an optional preset `lightFixtures` object (kind, spacing, height or drop, fixture size), and each `LightPlacement` carrying its zone and its fixture's box | Proof: node --test src/lighting/light-placement.test.ts
### Task 14: feat(build-map): build each placed fixture as a visible part that holds its light
Depends on: 13 | Files: `luau/build-map.luau`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `scripts/smoke-studio.ts` | Data: the `LightRecord`'s optional fixture box, built as one decorative Neon part in the light's color holding the light, tagged `config.ceilingTag` only for a pendant | Proof: npm run smoke:studio
### Task 4: feat(presets): stand the ticket-hall lamps along its walls instead of a floor grid
Depends on: 14 | Files: `presets/train-station.json` | Data: the ticket-hall `arrangements` array, its `lamp` entry changed from `grid` to `along-walls` on doorless walls | Proof: npm run eval:studio
### Task 5: feat(presets): give the platform a clock as its focal piece
Depends on: 4 | Files: `presets/train-station.json` | Data: the platform room type's `setPieces` array gains `clock` | Proof: npm run eval:studio
### Task 6: feat(props): color benches, lamps, pillars and rails from a preset surface role
Depends on: 5 | Files: `src/style/preset-schema.ts`, `src/style/preset-schema.test.ts`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `luau/props/bench.luau`, `luau/props/lamp.luau`, `luau/props/pillar.luau`, `luau/props/rail.luau`, `presets/train-station.json` | Data: an optional `surface` role on each prop rule, resolved into `SurfaceColor` and `SurfaceMaterial` attributes on each arranged record | Proof: npm run smoke:studio
### Task 7: feat(map-layout): mark the spawn pad with the accent surface
Depends on: none | Files: `src/map/map-layout.ts`, `src/map/map-layout.test.ts` | Data: the spawn `PartRecord`'s color and material taken from the room style's accent surface instead of its floor | Proof: npm run eval:studio
### Task 8: feat(presets): pave the train-station floor in lighter marble
Depends on: 6 | Files: `presets/train-station.json` | Data: `surfaces.floor` material and color, and the matching entry of `palette.colors` | Proof: npm run eval:studio
### Task 9: feat(presets): spread the concourse and ticket-hall furniture over the whole floor
Depends on: 8 | Files: `presets/train-station.json`, `src/style/presets.test.ts` | Data: the concourse and ticket-hall `arrangements` spacing and counts, proven by pieces on both sides of each room's center lines | Proof: npm run eval:studio
### Task 10: feat(eval): fail eval:studio when a wave-1 room scores below the pass score
Depends on: 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14 | Files: `scripts/eval-studio.ts`, `README.md` | Data: the list of wave-1 rooms whose `QualityResult.passed` is false, reported with the place-check failures | Proof: npm run eval:studio
### Task 15: feat(presets): describe hero-prop recipes in the preset schema
Depends on: 10 | Files: `src/style/preset-schema.ts`, `src/style/preset-schema.test.ts` | Data: an optional preset `heroProps` object keyed by hero kind, each recipe a strict object of `description`, `replaces` (a set-piece kind), `size` in studs, `triangleBudget` (at most 20000) and a `parts` array of `box`, `cylinder` or `profile` shapes each with a surface role, plus an optional `heroProps` array of 1-2 declared kinds on each room type | Proof: node --test src/style/preset-schema.test.ts
### Task 16: feat(presets): give the platform a train car hero prop in place of its track bed
Depends on: 15 | Files: `presets/train-station.json`, `src/style/presets.test.ts` | Data: `heroProps["train-car"]`, a low-poly car on rails whose length fits the platform's track-bed span, with `replaces: "track-bed"`, and the platform room type's `heroProps: ["train-car"]` | Proof: node --test src/style/presets.test.ts
### Task 17: feat(hero-props): read the triangle count, size and role meshes of a GLB
Depends on: 10 | Files: `src/hero-props/glb-structure.ts`, `src/hero-props/glb-structure.test.ts` | Data: a `{ triangles, size, meshNames, materialNames }` object read from the GLB's JSON chunk and its position accessors' min and max, tested on a GLB the test assembles in memory | Proof: node --test src/hero-props/glb-structure.test.ts
### Task 18: feat(hero-props): generate a hero-prop GLB from its recipe with headless Blender
Depends on: 16, 17 | Files: `src/hero-props/generate-hero-prop.py`, `src/hero-props/generate-hero-prop.ts`, `src/hero-props/recipe-hash.ts`, `src/hero-props/recipe-hash.test.ts`, `scripts/hero-props.ts`, `package.json`, `.gitignore`, `src/config.ts` | Data: one Blender object per surface role, named after it, with a material of that name and the role's preset color, exported as `.roblox-kit/hero-props/<preset>-<kind>-<hash>/model.glb`; the run fails when the GLB's structure exceeds `triangleBudget`, lacks a role or is off the recipe size by more than `config.heroPropSizeToleranceStuds` | Proof: npm run hero-props -- train-station train-car
### Task 19: feat(hero-props): render each hero-prop GLB from three angles
Depends on: 18 | Files: `src/hero-props/render-hero-prop.py`, `src/hero-props/render-hero-prop.ts`, `scripts/hero-props.ts` | Data: `front.png`, `side.png` and `three-quarter.png` beside `model.glb`, rendered by the Workbench engine in material colors | Proof: npm run hero-props -- train-station train-car
### Task 20: feat(hero-props): review hero-prop renders with a fresh reviewer, at most three rounds per kind
Depends on: 19 | Files: `src/shared/ask-headless-reviewer.ts`, `src/eval/quality-review.ts`, `src/eval/blind-place-check.ts`, `src/hero-props/review-hero-prop.ts`, `src/hero-props/review-hero-prop.test.ts`, `skills/visual-judge/hero-prop-prompt.md`, `scripts/hero-props.ts`, `src/config.ts` | Data: `review.json` beside the renders (a score and note per axis, passing when every axis reaches `config.visualPassScore`) and a per-kind `rounds.json` that refuses a fourth distinct hash, with the `claude -p` spawn of the three reviewers in one shared function; `npm run hero-props` exits 0 only on a passed review | Proof: node --test src/hero-props/review-hero-prop.test.ts
### Task 27: feat(set-pieces): read a set piece's depth from the preset's prop rule
Depends on: 16 | Files: `src/style/preset-schema.ts`, `src/map/set-piece-placement.ts`, `src/map/set-piece-placement.test.ts`, `src/map/build-map-tool.ts`, `presets/train-station.json` | Data: an optional `depth` (studs away from the wall) on a `propRules` entry, which the track bed and platform edge use in place of `propDimensions` when present; train-station's `track-bed` gets `depth: 10` (two 5-stud grid cells), so a 7-stud-wide car fits inside it with collision on; the benchmark platform keeps zero `check_map` issues, a reachable platform and unchanged doorway widths | Proof: node --test src/map/set-piece-placement.test.ts
### Task 21: feat(presets): shape the train car until its render review passes
Depends on: 20, 27 | Files: `presets/train-station.json`, `src/style/presets.test.ts` | Data: the `train-car` recipe's parts and sizes, revised from the review notes, about 7 studs deep inside the 10-stud track bed, its body in the `trim` role (green) as the platform's one dominant focal element, not the `wall` role; three fresh review rounds after the user reset the first three (8/6/7/6) | Proof: npm run hero-props -- train-station train-car
### Task 22: feat(hero-props): upload a reviewed hero-prop GLB through Open Cloud and record its asset id
Depends on: 20 | Files: `src/hero-props/open-cloud-upload.ts`, `src/hero-props/open-cloud-upload.test.ts`, `src/hero-props/hero-asset-store.ts`, `src/hero-props/hero-asset-store.test.ts`, `src/hero-props/hero-assets.json`, `.claude-plugin/plugin.json`, `.mcp.json`, `src/config.ts` | Data: a multipart `POST https://apis.roblox.com/assets/v1/assets` (`request` JSON with `assetType` Model and `creationContext.creator.userId`, `fileContent` as `model/gltf-binary`), polled at `assets/v1/operations/{id}` until done, recorded in `hero-assets.json` as recipe hash to `{ kind, assetId }`; the key and user id come from `ROBLOX_OPEN_CLOUD_API_KEY` and `ROBLOX_CREATOR_USER_ID`, filled from plugin.json `userConfig` (the key `sensitive: true`) through `mcpServers.roblox-kit.env` | Proof: node --test src/hero-props/open-cloud-upload.test.ts
### Task 23: feat(build-map): build each room's hero props from their assets in place of the set piece they replace
Depends on: 22 | Files: `src/map/hero-prop-placement.ts`, `src/map/hero-prop-placement.test.ts`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `luau/build-map.luau`, `luau/check-map.luau`, `src/config.ts` | Data: a `HeroPropRecord` (`kind`, `assetId`, `pivot`, `yaw`, `size`, surface per role) in the replaced set piece's slot, loaded by `InsertService:LoadAsset`, scaled to `size` with `Model:ScaleTo`, each MeshPart colored from the surface its name names with collide, touch and query off, and covered by check_map's placement check; with no key, no passed review or a failed upload the set piece stays and the tool result says why | Proof: node --test src/map/build-map-tool.test.ts
### Task 24: feat(presets): give the concourse a departure-board hero prop
Depends on: 21 | Files: `presets/train-station.json`, `src/style/presets.test.ts` | Data: `heroProps["departure-board"]` with `replaces: "departure-board"` and the concourse room type's `heroProps`, reviewed to a pass in at most three rounds | Proof: npm run hero-props -- train-station departure-board
### Task 25: feat(presets): give the ticket hall a ticket-counter hero prop
Depends on: 24 | Files: `presets/train-station.json`, `src/style/presets.test.ts` | Data: `heroProps["ticket-counter"]` with `replaces: "ticket-counter"` and the ticket-hall room type's `heroProps`, reviewed to a pass in at most three rounds | Proof: npm run hero-props -- train-station ticket-counter
### Task 26: docs(skills): add the hero-prop loop to the map-building skill and the README
Depends on: 23, 25 | Files: `skills/map-building/SKILL.md`, `README.md` | Data: the generate, render, review, upload and fallback steps, the three-round limit and the key's Assets Read and Write permissions | Proof: npm run validate:plugin
