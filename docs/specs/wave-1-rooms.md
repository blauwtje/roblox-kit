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

## Decisions
- The work is ordered by weakest axis first (lighting, focal hierarchy, negative space, readability, atmosphere, palette), after the one `check_map` finding kind (placement), which blocks the zero-issue goal. Closed by you.
- The quality gate turns on here: `npm run eval:studio` fails when a wave-1 room's axis median is below `config.visualPassScore` (7), as well as when a place check fails. Closed by the visual-quality brief ("the quality gate turns on in the follow-up brief, once the rooms are fixed").
- The calibration bounds (`calibrationReferenceMeanFloor`, `calibrationBadAnchorMeanCeiling`, `calibrationAxisGap`) and `visualPassScore` stay unchanged. Closed by you.
- Genre-specific numbers (light brightness, ranges, colors, materials, arrangement spacing) go in `presets/train-station.json`; code gains only genre-independent behavior. Closed by you.
- Rooms are fixed in what they build, not in how the eye view frames them: `eyeShot` in `src/map/zone-cameras.ts` stays as it is, so the scores still show what a player standing at the entry sees. Closed by exo.

## Assumptions
- The concourse's dark slab is its spawn pad: `spawnPart` in `src/map/map-layout.ts` builds a door-wide pad at the room center in the floor's material and color, and the benchmark concourse is the spawn room.
- The white props are benches, lamps, pillars and rails: their generators in `luau/props/` set no `Color` or `Material`, so their parts keep Roblox's default plastic. The ticket machine, counter and board generators set their own colors.
- A prop colored from a surface role reads the role's color and material from the preset's `surfaces`, passed as `SurfaceColor` and `SurfaceMaterial` generator attributes; `addProps` in `luau/build-map.luau` already turns an attribute ending in `Color` into a `Color3`. A prop rule without a surface role keeps today's look, so other presets do not change.
- The doorway signs float because a sign in a north or south doorway hangs `archDepthStuds + size.z / 2` in from the wall under the arch lintel (`signAtDoor` in `src/map/set-piece-placement.ts`) and touches no part named with `config.wallNameInfix`. Hanging it with its back face on the wall above the doorway satisfies `restsOnWall` in `luau/check-map.luau` without an exemption.
- Every `PointLight` hangs from an invisible `Attachment` on its zone's floor part (`addLight` in `luau/build-map.luau`), so a ceiling light has no visible fixture. A fixture is one decorative `Neon` part per light within `config.lightCeilingDropStuds` of the ceiling, colored by its light, not collidable or queryable, and tagged `config.ceilingTag` so cutaways hide it with the ceiling.
- The ticket hall's lamp posts come from its `grid` arrangement of `lamp` at spacing 7; lamps along the doorless walls keep the light and clear the floor.
- The platform gains a `clock` set piece as its focal piece; `standingPiece` places it on the room's east-west center line, facing north and south.
- The concourse floor becomes `Marble` in a lighter warm grey that sits between the wall and floor colors of the palette; the palette's `colors` list takes the new floor color in place of `#3b3f45`.
- A preset-level test of `placeArrangements` on `eval/benchmarks/train-station.json` can prove that the concourse's and ticket hall's arranged pieces fall on both sides of each room's center lines, without Studio.
- Each `npm run eval:studio` run takes about 20 minutes and runs 9 headless reviewers; the eval-based proofs below are the only way to read the axis scores.

## Acceptance
- `npm run eval:studio` exits 0 with the train-station line showing zero `check_map` issues and every wave-1 axis median at 7 or more (Tasks 1-10).
- `npm run smoke:studio` shows a visible fixture per ceiling light in the smoke map, hidden with the ceilings in cutaways (Task 2).
- `node scripts/measure-wall-color.ts` shows the train-station walls lit close to their preset color, not darker (Task 3).
- `node scripts/calibrate-review.ts` still passes with its bounds unchanged (Success criterion).
- `npm run check` passes (Tasks 1-10, Success criterion).

## Manual checks
- Look at the three wave-1 eye views next to their new scores; each room should read as a finished station room from the entry.

## Plan basis
Repository: /Users/thomash/Documents/Code/personal/tools/roblox-kit
Branch: wave-1-rooms
Worktree setup: none
Land gate: npm run check

## Success criterion
`npm run check && node scripts/calibrate-review.ts && npm run eval:studio` passes.

## Checkpoint
- Blocks first: Task 1 (the only `check_map` finding) and Task 2 (fixtures the lighting tune relies on).
- Parallel: Tasks 1, 2 and 7 share no file.
- Shared state: `presets/train-station.json` (Tasks 3, 4, 5, 6, 8, 9), `luau/build-map.luau` (Task 2), and the one open Studio place every smoke and eval proof uses.
- Smallest safe split: one task per finding, serialized 3 -> 4 -> 5 -> 6 -> 8 -> 9 on the preset file, with the gate last.

## Tasks
### Task 1: fix(set-pieces): hang doorway signs against the wall above the door
Depends on: none | Files: `src/map/set-piece-placement.ts`, `src/map/set-piece-placement.test.ts` | Data: the in-doorway sign record's inset, so its back face lies on the room-side face of the wall above its doorway | Proof: npm run eval:studio
### Task 2: feat(build-map): show a fixture for each ceiling light
Depends on: none | Files: `luau/build-map.luau`, `src/config.ts`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts`, `scripts/smoke-studio.ts` | Data: one decorative Neon part per light record within `config.lightCeilingDropStuds` of the ceiling, sized by one config constant and tagged `config.ceilingTag` | Proof: npm run smoke:studio
### Task 3: feat(presets): light the train station bright and even with crisp shadows
Depends on: 2 | Files: `presets/train-station.json` | Data: the preset's `lighting` object (lower `ShadowSoftness`, no bloom glare) and `lightRoles` brightness and range | Proof: node scripts/measure-wall-color.ts
### Task 4: feat(presets): stand the ticket-hall lamps along its walls instead of a floor grid
Depends on: 3 | Files: `presets/train-station.json` | Data: the ticket-hall `arrangements` array, its `lamp` entry changed from `grid` to `along-walls` on doorless walls | Proof: npm run eval:studio
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
Depends on: 1, 2, 3, 4, 5, 6, 7, 8, 9 | Files: `scripts/eval-studio.ts`, `README.md` | Data: the list of wave-1 rooms whose `QualityResult.passed` is false, reported with the place-check failures | Proof: npm run eval:studio
