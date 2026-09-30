# Visual quality scored against real Roblox rooms

## Goal
`check_map` names each prop that is out of scale, off the 90-degree grid, not resting on a floor, inside a wall or blocking a doorway, by part path; a calibrated image rubric scores each room 1-10 on palette coherence, focal hierarchy, negative space, spatial readability, atmospheric consistency and lighting against its preset's intent; and `npm run eval:studio` records both for the wave-1 train-station rooms while still passing.

## Decisions
- Scale, rotation and placement leave the image rubric and become code checks inside `check_map`, each issue naming its part paths. Scale: doorway and hallway widths under 10 studs (the existing size rules), and props out of proportion to a 5-6.5-stud avatar, with ratio bounds per prop type. Rotation: a yaw that is not a multiple of 90 degrees, unless the prop type allows free rotation. Placement: a prop not resting on a floor (raycast down from its center and 4 corners), a prop inside a wall (overlap), a prop blocking a doorway (clearance box). Closed by you.
- Preset-specific numbers live in `presets/`, not in code: each preset declares its lighting intent, a ratio bound per prop type and which prop types rotate freely. Closed by you.
- The image rubric scores only what code cannot measure: palette coherence, focal hierarchy, negative space, spatial readability, atmospheric consistency, and lighting scored as "matches the preset's lighting intent" (horror-facility: moody, high contrast; cozy-town: bright, even; train-station: its own). The reviewer answers, per axis, a score of 1-10 and a visible evidence note of at most two sentences naming what it sees in which image; the scores feed calibration and eval, and the notes are logged in the judge JSONL line. Closed by you.
- Each room is scored by three fresh reviewers; each axis takes the median of the three, and a room reaches the pass score when every axis median is 7 or more, with no averaging. Closed by exo.
- Calibration uses fixed anchors only and proves the reviewer separates good rooms from bad ones. Every reference in the reference set is tagged with a preset (DOORS: horror-facility; Animal Hospital: cozy-town) and is scored against its own preset; the mean of its axis medians must be 6 or more. A fixed known-bad set, the three box-room captures from Sep 29 (`concourse`, `platform`, `ticket-hall`, preset train-station), is committed under `eval/anchors/bad/`; the mean of each anchor's axis medians must be 4 or less. On each axis, the median over the references must be at least 2 points above the median over the anchors, or that axis does not discriminate and its rubric anchors are rewritten. The three thresholds live in `config`. Closed by you.
- Current eval rooms are not a calibration bound; their scores are the measured result. Closed by you.
- Judge loop: only `blocker` and `major` findings that cite a spec item or preset rule go back to the builder; `minor` ones are only logged. The loop stops on a pass, after round 3, or when the same finding repeats twice. Each round appends one JSONL line. Finding types come from a fixed list: overlap, floating, unreachable, scale, rotation, placement, size-rule, palette, lighting, readability, spec-miss. Closed by you.
- Images sent to a reviewer are 1000-1568 px on the long edge, at most 8 per judge round, so `config.maxImagesPerCall` drops from 11 to 8. Closed by you.
- `npm run eval:studio` records each wave-1 room's axis medians and `check_map` findings in its results, and still exits 0 unless the blind place check fails. The quality gate turns on in the follow-up brief, once the rooms are fixed. Closed by your constraint that `npm run check`, `npm run smoke:studio` and `npm run eval:studio` must pass.
- Captures gain an eye-level view per room: the camera stands at player eye height inside the room, ceilings stay visible and no wall is hidden. `capture_zones` keeps views a and b as its default, and the eval asks for the eye view explicitly. Closed by exo (landed in Task 2).
- Reference images stay out of git. A tracked reference set names each kept image by game, place ID and thumbnail ID; a script downloads them into the ignored `eval/references/` folder. Closed by you (images out of git), and by exo for the set's form.
- Room-type order. Wave 1: train station `platform`, `concourse`, `ticket-hall`. Wave 2: horror facility `lab`, `cell-block`. Wave 3: cozy town `home`, `shop`. Sci-fi station comes last, because no reference is sci-fi. `eval:studio` scores the current wave's rooms. Closed by exo, as delegated.
- This brief builds the checks, the rubric and their calibration. Fixing the wave-1 rooms is a follow-up brief, written from the findings and scores the first recorded run names. Closed by exo.
- Every room floor z-fought with the place's Baseplate because both tops sat at y = 0. This is fixed in `5a84f4c` and not part of this brief. Closed by the code (`src/map/map-layout.ts` floorPart).

## Assumptions
- The avatar spans 5 to 6.5 studs tall (classic and humanoid), and 1 stud is about 28 cm. A prop type's height ratio bound is its real-world height in studs divided by 6.5 (lower) and by 5 (upper), widened by a quarter each way. Prop types whose height follows the wall height in `propSize` (such as `pillar`) carry no ratio bound; the wall-height size rule covers them.
- Every current prop type has `freeRotation` false, because `placeProps` sets no yaw and every piece sits square to its wall or row. A rotation issue is also raised when a prop's up axis is not vertical, which is how a pillar lying on the floor shows.
- Lighting intents: horror-facility "moody, high contrast"; cozy-town "bright, even"; train-station "bright and even overhead light with crisp shadows"; sci-fi-station "cool, even panel light". Each matches its preset's existing `LightingStyle`.
- The placement checks run on props only, found as the map's models named `{kind}-{count}`; walls are the parts named with `config.wallNameInfix`. A doorway's clearance box spans the doorway's width, the preset's agent height and one agent diameter on each side of the wall.
- The judge's place-check findings, formerly `unidentified-place` and `empty-room`, become `spec-miss` blockers citing `rooms[<index>].roomType`; the former `visual` type splits into palette, lighting and readability.
- Each reviewer answer holds a score and an evidence note for each of the six axes; `reviewRoomQuality` returns the notes beside the medians. `reviewRoomQuality` keeps its signature and reads the lighting intent from the genre's preset.
- Eye height is 5 studs above the floor. The eye view stands 3 studs in from the room's -Z wall at its center and looks at the room center, pitched down 10 degrees.
- Place IDs: DOORS 6516141723, Animal Hospital 78515283254292. Cozy-town has one reference until another indoor screenshot is found: every other cozy-town thumbnail is outdoor, a character close-up or a promo render.
- The reviewer ignores logos, UI and characters laid over a reference; four DOORS references carry them.
- Reviewer runs use the same headless `claude -p`, read-only and in an empty folder, as the place check. Images get neutral names, and there is no paid API.
- `eval/results.jsonl` gets per-room axis medians and `check_map` findings on each line. It stays uncommitted by this work.
- The re-checked research behind these numbers is in the ignored `docs/research.md`.

## Acceptance
- `node scripts/fetch-references.ts` downloads every image in the reference set into `eval/references/`, and `git status` lists none of them (Task 1).
- `npm run smoke:studio` captures an eye view of each smoke room, with ceilings visible (Task 2).
- `npm run smoke:studio` shows `check_map` counting scale, rotation and placement issues, zero on the smoke map, each issue naming part paths (Tasks 6, 7).
- `npm run smoke:studio` gets at most 8 images per `capture_zones` call (Task 11).
- `node scripts/calibrate-review.ts` shows each reference's mean axis median at or above 6 against its own preset, each known-bad anchor's at or below 4, and every axis with the references' median at least 2 above the anchors' (Task 12).
- `npm run eval:studio` exits 0 and writes each wave-1 room's six axis medians and its `check_map` findings with part paths to `eval/results.jsonl` (Task 13).
- `npm run check` passes (Tasks 5-13, Success criterion).

## Manual checks
- Look at the eye view of the train-station platform next to its recorded axis scores and `check_map` findings. The scores and findings should match what you would judge yourself.

## Plan basis
Repository: /Users/thomash/Documents/Code/personal/tools/roblox-kit
Branch: finished-looking-maps
Worktree setup: none
Land gate: npm run check

## Success criterion
`npm run check && node scripts/calibrate-review.ts && npm run eval:studio` passes.

## Checkpoint
- Blocks first: landed Task 4 closes the chain of Tasks 1-4, which share files with the new tasks. Task 5 (preset data feeds the checks and the lighting axis) and Task 8 (the rubric feeds the review code and the judge loop).
- Parallel: Tasks 5 and 8.
- Shared state: `src/map/check-map-tool.ts`, `src/map/check-map-tool.test.ts`, `src/map/check-report-store.ts` (Tasks 6, 7), `scripts/smoke-studio.ts` (Tasks 6, 7, 11), `src/config.ts` (Tasks 11, 13), and the one open Studio place every smoke, calibration and eval proof uses.
- Smallest safe split: one task per concern below, serialized 6 -> 7 -> 11 -> 13 on the shared files.

## Tasks
### Task 1: feat(eval): fetch the reference images the reference set names
Depends on: none | Files: `scripts/fetch-references.ts`, `eval/reference-set.json`, `.gitignore` | Data: an array of `{ game, placeId, universeId, targetId, version, note }` entries, downloaded to `eval/references/<game>/<targetId>.png`; a listed targetId the API no longer returns fails the run by name | Proof: node scripts/fetch-references.ts
### Task 2: feat(capture): add an eye-level view inside each zone
Depends on: none | Files: `src/map/zone-cameras.ts`, `src/map/zone-cameras.test.ts`, `src/map/capture-zones-tool.ts`, `src/map/capture-zones-tool.test.ts`, `src/config.ts`, `scripts/smoke-studio.ts` | Data: a fourth `ShotView` value `eye` and an optional `views` input defaulting to `a` and `b`; eye shots are taken with ceilings shown and no wall hidden | Proof: npm run smoke:studio
### Task 3: feat(visual-judge): write the reference-scored quality rubric
Depends on: none | Files: `skills/visual-judge/quality-prompt.md`, `skills/visual-judge/SKILL.md` | Data: a brief with the five axes and their anchors, evidence before score, and an answer JSON of per-axis `{ evidence, score }` plus a `defects` array | Proof: npm run validate:plugin
### Task 4: feat(eval): score a room's captures against its references
Depends on: 1, 2, 3 | Files: `src/eval/quality-review.ts`, `src/eval/quality-review.test.ts`, `src/config.ts` | Data: three reviewer answers per room reduced to one per-axis median record; passed when every median reaches `config.visualPassScore` (7) | Proof: node --test src/eval/quality-review.test.ts
### Task 5: feat(presets): declare lighting intent, prop scale bounds and free rotation per preset
Depends on: 4 | Files: `src/style/preset-schema.ts`, `src/style/preset-schema.test.ts`, `src/style/load-preset.test.ts`, `presets/cozy-town.json`, `presets/horror-facility.json`, `presets/sci-fi-station.json`, `presets/train-station.json` | Data: a top-level `lightingIntent` string, `sizeRules.avatarHeight` `{ min, max }` (5, 6.5), and a `propRules` record keyed by prop kind of `{ heightRatio?: { min, max }, freeRotation }` | Proof: node --test src/style/preset-schema.test.ts
### Task 6: feat(check-map): flag props out of scale or off the 90-degree grid by part path
Depends on: 5 | Files: `luau/read-props.luau`, `src/map/prop-rules.ts`, `src/map/prop-rules.test.ts`, `src/map/check-report-store.ts`, `src/map/check-map-tool.ts`, `src/map/check-map-tool.test.ts`, `scripts/smoke-studio.ts` | Data: new issue kinds `scale` and `rotation` in `checkIssueSchema`, computed in TypeScript from an array of `{ path, kind, size, yaw, upright }` prop records the Luau file reads, against the preset's `propRules` | Proof: npm run smoke:studio
### Task 7: feat(check-map): flag props off the floor, inside a wall or blocking a doorway
Depends on: 6 | Files: `luau/check-map.luau`, `src/map/size-rules.ts`, `src/map/size-rules.test.ts`, `src/map/set-piece-placement.ts`, `src/map/set-piece-placement.test.ts`, `src/map/build-map-tool.ts`, `src/map/check-report-store.ts`, `src/map/check-map-tool.ts`, `src/map/check-map-tool.test.ts`, `scripts/smoke-studio.ts` | Data: a new issue kind `placement` whose detail names the rule (no floor under the center and 4 corner rays, overlaps a wall part, inside a doorway clearance box); doorway boxes passed to the Luau file as an array in its arguments | Proof: npm run smoke:studio
### Task 8: feat(visual-judge): score palette, focal hierarchy, negative space, readability, atmosphere and lighting intent
Depends on: 4 | Files: `skills/visual-judge/quality-prompt.md` | Data: a brief with a `<lighting intent>` field and six axes, answering JSON of per-axis `{ evidence, score }`, the evidence at most two sentences naming what is visible in which image | Proof: npm run validate:plugin
### Task 9: feat(eval): review rooms on the six image axes with an evidence note per score
Depends on: 5, 8 | Files: `src/eval/quality-review.ts`, `src/eval/quality-review.test.ts` | Data: `qualityAxes` becomes the six axes; the answer schema is one `{ evidence, score }` per axis; the median record and `reachesPassScore` keep their shape, and `QualityResult` gains each reviewer's notes per axis | Proof: node --test src/eval/quality-review.test.ts
### Task 10: feat(visual-judge): fix the finding types and stop rule and log one line per round
Depends on: 8 | Files: `skills/visual-judge/finding.schema.json`, `skills/visual-judge/SKILL.md` | Data: the type enum becomes the fixed eleven-type list; a finding cites a spec item or preset rule; each round appends one JSONL line of `{ round, date, mapId, zones, scores, findings, stopReason }` with at most 8 images per round | Proof: npm run validate:plugin
### Task 11: feat(capture): cap each capture call at 8 images
Depends on: 7 | Files: `src/config.ts`, `src/map/capture-zones-tool.test.ts`, `scripts/smoke-studio.ts` | Data: `config.maxImagesPerCall` 8; the smoke probe expects the zones that fit 8 images and the rest in `remainingZones` | Proof: npm run smoke:studio
### Task 12: feat(eval): calibrate the reviewer on preset-tagged references and known-bad anchors
Depends on: 9 | Files: `scripts/calibrate-review.ts`, `src/config.ts`, `src/eval/quality-review.ts`, `scripts/fetch-references.ts`, `eval/reference-set.json`, `eval/anchors/bad/concourse.jpg`, `eval/anchors/bad/platform.jpg`, `eval/anchors/bad/ticket-hall.jpg` | Data: a `preset` field on each reference-set entry; the anchors copied from `eval/captures/train-station/{concourse,platform,ticket-hall}.jpg`; one JSON row per image with its axis medians, their mean and whether it lands inside its bound, then one row per axis with the reference and known-bad medians; the three thresholds in `config`, no Studio connection | Proof: node scripts/calibrate-review.ts
### Task 13: feat(eval): record wave-1 axis scores and check_map findings in eval:studio results
Depends on: 7, 9, 11, 12 | Files: `scripts/eval-studio.ts`, `src/config.ts`, `src/eval/reference-set.ts`, `src/eval/reference-set.test.ts`, `scripts/calibrate-review.ts`, `scripts/fetch-references.ts`, `src/studio/viewport-preflight.ts`, `src/studio/viewport-preflight.test.ts`, `scripts/smoke-studio.ts`, `README.md` | Data: the current wave's room types as one list in `config`; each results line gains per-room axis medians and the `check_map` issues with part paths; exit stays 0 unless the blind place check fails | Proof: npm run eval:studio
