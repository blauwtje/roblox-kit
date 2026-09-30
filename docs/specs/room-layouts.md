# Room layouts by room type

## Goal
A typed room is furnished by its room type's arrangements, whose counts grow with the room's floor area, so the train-station concourse and platform look full, and the blind place check fails a room its reviewer calls empty while accepting the room names its room type lists.

## Decisions
- Each room type in a preset describes arrangements (rows, grids, repeats along a wall or the room length) with counts that grow with floor area. Closed by you.
- A room with a type gets no random props. Closed by the code: `propsOf` (`src/map/build-map-tool.ts:233`) already gives kit props only to untyped rooms; this brief keeps that and makes arrangements the typed room's only fill.
- The blind check also asks whether the room looks furnished or empty, and an `empty` answer fails the check. Closed by you.
- Room-word rule: each room type lists the room names it accepts, and the check passes when the reviewer's room matches the room type or any listed name. Closed by you (option 1).
- Train station first; its concourse and platform must look full. Closed by you.

## Assumptions
- `arrangements` sits beside `setPieces` on a room type: set pieces keep their placement rules and are placed first; arrangements fill the space they leave.
- Four arrangement shapes: `grid` (a piece every `spacing` studs both ways), `rows` (rows of `perRow` pieces side by side, a row every `spacing` studs along the room's long axis, each piece facing along that axis toward the room's first door), `along-walls` (a piece every `spacing` studs along each doorless wall, or every wall, at an `inset`), `along-length` (a line down the long axis at an `inset` from the long wall the track bed is not on, or the center line, a piece every `spacing` studs).
- A count is how many pieces fit at the arrangement's spacing, so doubling a side doubles that count; an optional `max` caps it to keep a large room inside its performance budget.
- A slot is dropped when it would overlap a doorway strip, a lane as wide as the door from each door to the room center, the spawn at a spawn room's center, a set piece or an earlier piece; an arrangement that places no piece at all adds one warning to `build_map`'s `warnings`.
- Arrangement pieces use the room's seed, so the same spec builds the same layout.
- A new `ticket-machine` generator (about 3x6x2 studs, screen on its -Z face) stands in rows along the concourse walls; every other train-station piece already has a generator.
- Train-station starting values, tuned until `npm run eval:studio` reads furnished: concourse `pillar` grid every 20, `bench` rows of 3 every 8, `ticket-machine` along doorless walls every 5 with `max` 6; platform `lamp` and `bench` along the length every 12 and 16, `pillar` along the length every 15; ticket hall `rail` rows as a queue, `bench` along doorless walls every 8.
- Accepted room names, in `roomNames`: concourse "waiting area", "hall", "station hall", "lobby"; platform "track", "station platform"; ticket hall "ticket counter", "ticket office", "booking hall". Matching stays case-blind with spaces and hyphens alike.
- The reviewer's answer gains `furnished`: `furnished` or `empty`; the prompt defines empty as a mostly bare floor with only a few pieces. In the skill an `empty` answer is one `empty-room` `blocker` finding, fixed by adding arrangements to the room type.
- Horror facility, sci-fi station and cozy town get arrangements in a follow-up brief; until then the skill may flag their typed rooms `empty-room`. No eval benchmark types their rooms, so `npm run eval:studio` is unaffected.

## Acceptance
- `node --test src/map/arrangement-placement.test.ts` shows a room of twice the floor area gets more pieces of each arrangement, no piece overlapping a doorway lane, set piece or another piece (Task 15).
- `npm run check` passes, including a preset test rejecting an unknown arrangement shape and a place-check test failing an `empty` answer and passing a listed room name (Tasks 13, 17, 18).
- `npm run eval:studio` passes the blind check on all three train-station rooms: genre right, room matched by type or listed name, and `furnished` on each (Task 19).

## Manual checks
- Look at the train-station benchmark's concourse and platform captures under `eval/`: both read as full stations, not bare floors.
- Run the visual-judge skill on a horror-facility map with a typed `lab` room, which has no arrangements yet: the place check fails with an `empty-room` blocker.

## Plan basis
Repository: /Users/thomash/Documents/Code/personal/tools/roblox-kit
Branch: finished-looking-maps
Worktree setup: ln -s /Users/thomash/Documents/Code/personal/tools/roblox-kit/node_modules node_modules
Land gate: npm run check

## Success criterion
`npm run check && npm run eval:studio` passes.

## Checkpoint
- Blocks first: Task 13 (the preset fields gate placement, the place check and the presets).
- Parallel: Tasks 13 and 14; then Tasks 15 and 17.
- Shared state: `src/eval/blind-place-check.ts`, `scripts/eval-studio.ts` and `skills/visual-judge/SKILL.md` (Tasks 17, 18), `src/map/prop-placement.ts` (Task 14 only), and the one open Studio place `npm run eval:studio` uses.
- Smallest safe split: one task per concern below, serialized on each shared file; numbering starts at 13 because this branch already holds `Plan-task: 1`-`12` commits from `genre-set-pieces.md`.

## Tasks
### Task 13: feat(style): declare arrangements and accepted room names on a room type
Depends on: none | Files: `src/style/preset-schema.ts`, `src/style/preset-schema.test.ts` | Data: an optional array of arrangement objects discriminated by shape and an optional string array of room names on each room type | Proof: node --test src/style/preset-schema.test.ts
### Task 14: feat(map): add a ticket-machine generator
Depends on: none | Files: `src/map/prop-placement.ts`, `src/map/prop-placement.test.ts`, `luau/props/ticket-machine.luau` | Data: one more entry in `propKinds` and the dimensions table | Proof: npm run lint:luau
### Task 15: feat(map): place a room type's arrangements with counts from floor area
Depends on: 13 | Files: `src/map/arrangement-placement.ts`, `src/map/arrangement-placement.test.ts` | Data: an array of `SetPieceRecord` per typed room plus warnings, given the room's set pieces as occupied boxes | Proof: node --test src/map/arrangement-placement.test.ts
### Task 16: feat(map): furnish typed rooms with their arrangements in build_map
Depends on: 15 | Files: `src/map/build-map-tool.ts`, `src/map/build-map-tool.test.ts` | Data: `propsOf` appends each typed room's arrangement pieces after its set pieces and merges both warning arrays | Proof: node --test src/map/build-map-tool.test.ts
### Task 17: feat(eval): accept a room type's listed names in the place check
Depends on: 13 | Files: `src/eval/blind-place-check.ts`, `src/eval/blind-place-check.test.ts`, `scripts/eval-studio.ts`, `skills/visual-judge/SKILL.md` | Data: an array of accepted room names passed beside the room type to `placeMatches` | Proof: node --test src/eval/blind-place-check.test.ts
### Task 18: feat(visual-judge): fail a room the blind reviewer calls empty
Depends on: 17 | Files: `skills/visual-judge/place-check-prompt.md`, `skills/visual-judge/SKILL.md`, `skills/visual-judge/finding.schema.json`, `src/eval/blind-place-check.ts`, `src/eval/blind-place-check.test.ts`, `scripts/eval-studio.ts` | Data: a `furnished` enum field on the place answer and an `empty-room` blocker finding type | Proof: node --test src/eval/blind-place-check.test.ts
### Task 19: feat(presets): arrange the train-station concourse, platform and ticket hall
Depends on: 14, 16, 18 | Files: `presets/train-station.json` | Data: arrangements and room names on the three room types | Proof: npm run eval:studio
