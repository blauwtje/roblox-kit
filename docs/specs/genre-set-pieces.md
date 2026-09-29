# Genre set pieces and the place check

## Goal
A styled map shows set pieces that say which genre and which room it is (a train station platform has a track bed, a platform edge and a sign), and the visual judge fails a capture from which a fresh reviewer cannot name the genre and the room.

## Decisions
- A room names its type from its genre's list of room types; a room without a type keeps today's props. Closed by you (1a).
- The place check runs inside the visual-judge skill: a fresh subagent gets only the image, knows neither genre nor room, and names both; a mismatch fails the capture. No paid model call. Closed by you (2a).
- Cozy town and sci-fi station walls are brought back to their wall color by the lighting recipe's sun Brightness and ExposureCompensation, tuned against settled captures only, after captures wait for lighting to settle. Closed by you (3a).
- The smoke removes only its own maps and blocker, never the whole maps folder (`scripts/smoke-studio.ts:190`). Closed by you.
- Light-role brightness is not the lever for cozy town and sci-fi station: their walls read white with every light role at 0. Closed by the code (measured this session; commit `3ea32af`).

## Assumptions
- Each genre lists its own set pieces per room type. Train station: track bed and platform edge on the platform, a counter in the ticket hall, a sign in every typed room.
- Set pieces are ProceduralModel generators in `luau/props/` built from plain parts, like today's props; no downloaded assets.
- A sign carries its room type's label from preset data as text, in the preset's accent color.
- Room types per genre: train station `concourse`, `platform`, `ticket-hall`; horror facility `lab`, `cell-block`; sci-fi station `bridge`, `cargo-bay`; cozy town `shop`, `home`.
- Genre pieces beyond the train station: `lab-bench` (lab), `cell-bars` (cell-block), `control-console` (bridge), `crate-stack` (cargo-bay), `counter` (shop), `fireplace` (home).
- A settled capture is one taken after a fixed wait from `config`, long enough that two back-to-back captures right after `build_map` read the same wall color.
- A tuned preset's settled wall luminance lies within 15 of its wall color's luminance.

## Acceptance
- `npm run smoke:studio` builds a typed train-station map, finds its track bed, platform edge, counter and signs, and leaves every map it did not build in place (Tasks 1, 9).
- `node scripts/measure-wall-color.ts cozy-town sci-fi-station train-station horror-facility` reports every preset within 15 luminance of its wall color on settled captures (Tasks 2, 3, 4).
- `npm run check` passes, including a preset test that rejects an unknown room type and a map spec test that rejects a room type its style lacks (Tasks 5, 6, 8).

## Manual checks
- Run the visual-judge skill on a train-station platform capture: the fresh subagent names a train station and a platform, and the check passes.
- Run the visual-judge skill on the same map built without a style: the place check fails with an `unidentified-place` blocker.

## Plan basis
Repository: /Users/thomash/Documents/Code/personal/tools/roblox-kit
Branch: finished-looking-maps
Worktree setup: none
Land gate: npm run check

## Success criterion
`npm run check && npm run smoke:studio` passes.

## Checkpoint
- Blocks first: Task 2 (settled captures gate the tuning) and Task 5 (room types gate every set-piece task).
- Parallel: Tasks 1, 2, 5, 7 and 12.
- Shared state: `scripts/smoke-studio.ts` (Tasks 1, 9), `src/map/build-map-tool.ts` (Tasks 6, 8), `src/map/prop-placement.ts` (Tasks 7, 10), `presets/cozy-town.json` and `presets/sci-fi-station.json` (Tasks 4, 11), and the one open Studio place every smoke and measure proof uses.
- Smallest safe split: one task per concern below, serialized on each shared file.

## Tasks
### Task 1: fix(smoke): remove only the smoke's own maps from the place
Depends on: none | Files: `scripts/smoke-studio.ts` | Data: the smoke map Model and blocker Model destroyed by name, the maps folder only when left empty | Proof: npm run smoke:studio
### Task 2: fix(capture): wait for lighting to settle before each capture
Depends on: none | Files: `src/map/capture-zones-tool.ts`, `src/map/capture-zones-tool.test.ts`, `src/config.ts` | Data: one settle duration in `config`, waited after the camera moves and before `screen_capture` | Proof: npm run smoke:studio
### Task 3: feat(eval): measure a preset's settled wall color in a capture
Depends on: 2 | Files: `scripts/measure-wall-color.ts` | Data: one JSON row per preset with its wall color, measured color and luminance gap, the PNG decoded with `node:zlib` | Proof: node scripts/measure-wall-color.ts train-station
### Task 4: fix(presets): tune cozy town and sci-fi station sun and exposure to their wall color
Depends on: 3 | Files: `presets/cozy-town.json`, `presets/sci-fi-station.json` | Data: the lighting recipe's Brightness and ExposureCompensation only | Proof: node scripts/measure-wall-color.ts cozy-town sci-fi-station
### Task 5: feat(style): declare room types with their set pieces and sign text in the preset schema
Depends on: none | Files: `src/style/preset-schema.ts`, `src/style/preset-schema.test.ts` | Data: an optional record keyed by room type, each holding an array of set-piece kinds and one sign label | Proof: node --test src/style/preset-schema.test.ts
### Task 6: feat(map): let a room name its type from its genre
Depends on: 5 | Files: `src/map/map-spec.ts`, `src/map/map-spec.test.ts`, `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts` | Data: an optional string on the room, rejected before Studio is asked when the style has no such room type | Proof: node --test src/map/map-spec.test.ts src/map/build-map-tool.test.ts
### Task 7: feat(map): add track bed, platform edge, counter and sign generators
Depends on: none | Files: `src/map/prop-placement.ts`, `src/map/prop-placement.test.ts`, `luau/props/track-bed.luau`, `luau/props/platform-edge.luau`, `luau/props/counter.luau`, `luau/props/sign.luau` | Data: four more entries in `propKinds` and the dimensions table | Proof: npm run lint:luau
### Task 8: feat(map): place set pieces by room type
Depends on: 6, 7 | Files: `src/map/set-piece-placement.ts`, `src/map/set-piece-placement.test.ts`, `src/map/build-map-tool.ts` | Data: an array of prop records per typed room, track bed and platform edge along the longest doorless wall, a counter facing the entry door, a sign inside above each door | Proof: node --test src/map/set-piece-placement.test.ts
### Task 9: feat(presets): give the train station its room types and set pieces
Depends on: 1, 8 | Files: `presets/train-station.json`, `eval/benchmarks/train-station.json`, `scripts/smoke-studio.ts` | Data: room types `concourse`, `platform`, `ticket-hall` in the preset, typed rooms in the benchmark and the smoke map | Proof: npm run smoke:studio
### Task 10: feat(map): add lab bench, cell bars, control console, crate stack and fireplace generators
Depends on: 7 | Files: `src/map/prop-placement.ts`, `src/map/prop-placement.test.ts`, `luau/props/lab-bench.luau`, `luau/props/cell-bars.luau`, `luau/props/control-console.luau`, `luau/props/crate-stack.luau`, `luau/props/fireplace.luau` | Data: five more entries in `propKinds` and the dimensions table | Proof: npm run lint:luau
### Task 11: feat(presets): give horror facility, sci-fi station and cozy town their room types and set pieces
Depends on: 4, 8, 10 | Files: `presets/horror-facility.json`, `presets/sci-fi-station.json`, `presets/cozy-town.json` | Data: two room types per preset, each with its set pieces and sign label | Proof: npm run eval:studio
### Task 12: feat(visual-judge): fail a capture that does not show which place it is
Depends on: none | Files: `skills/visual-judge/SKILL.md`, `skills/visual-judge/place-check-prompt.md`, `skills/visual-judge/finding.schema.json` | Data: an `unidentified-place` blocker finding when the image-only subagent's named genre or room differs from the map's | Proof: npm run validate:plugin
