# Visual quality scored against real Roblox rooms

## Goal
`npm run eval:studio` scores each first-wave room from 1 to 10 on scale, rotation, placement, materials and lighting against screenshots of popular Roblox games, and fails any room with an axis below 7, so today's train station (about 1-2 out of 10) fails where the place check let it pass.

## Decisions
- The reviewer scores five axes, each 1-10 against fixed anchors: scale, rotation, placement, materials, lighting (anchors under Assumptions). Closed by exo: the user named the five axes and delegated the anchors.
- Pass score: every axis median at or above 7. One weak axis fails the room; there is no averaging. A mean hides one broken axis, which is how the place check passed rooms with pillars lying on the floor. Closed by exo, as delegated.
- Each room is scored by three fresh reviewers; each axis takes the median of the three. One outlier cannot pass or fail a room. Closed by exo.
- The reviewer sees the room's captures plus the whole reference pool, marked as references, and knows the genre and room type. The references set the bar for craft, not for content: of 52 thumbnails from the eight games only 6 are in-engine indoor rooms (DOORS 4, Brookhaven RP 1, Animal Hospital 1), none a train station, so per-room-type matching has nothing to match against. It does not know the pass score, the map spec or the builder's intent. It rates quality, not whether it can identify the room, so the blind place check stays as it is. Closed by exo.
- The rubric is calibrated before it gates: each reference, scored as a capture with the other five shown (leave one out), must score at or above 8 on every axis median, and today's train-station captures at or below 4 on their lowest axis. A rubric that fails either bound is fixed before the gate lands. Closed by exo.
- Captures gain an eye-level view per room: the camera stands at player eye height inside the room, ceilings stay visible and no wall is hidden. The references are shot from where the player stands, and the two cutaway views are not, so lighting and scale cannot be compared from them. `capture_zones` keeps views a and b as its default, and the eval asks for the eye view explicitly. Closed by exo.
- Reference images stay out of git. A tracked reference set names each kept image by game, place ID and thumbnail ID; a script downloads them into the ignored `eval/references/` folder. Dropped images (logo-only, text-only, avatar close-ups, outdoor-only, offline promo renders) are not listed. The kept six and their notes are in the ignored `eval/references/manifest.json`, the seed for the set. Closed by you (images out of git), and by exo for the set's form.
- Room-type order. Wave 1: train station `platform`, `concourse`, `ticket-hall`, the pieces you called wrong and the only typed benchmark. Wave 2: horror facility `lab`, `cell-block`, the closest to the DOORS references. Wave 3: cozy town `home`, `shop`, closest to the DOORS lounge and the Animal Hospital waiting room. Sci-fi station comes last, because no reference is sci-fi. Only the current wave gates; the rest is scored and reported. Closed by exo, as delegated.
- This brief builds the scorer and its gate. Fixing the wave-1 rooms is a follow-up brief, written from the defects the first scored run names. Closed by exo.
- Every room floor z-fought with the place's Baseplate because both tops sat at y = 0. This is fixed in `5a84f4c` and not part of this brief. Closed by the code (`src/map/map-layout.ts` floorPart).

## Assumptions
- Scale anchors, against a 5-stud-tall character: door 7-8 studs tall, bench seat 2 studs high, counter 3.5 studs high, ceiling 10-14 studs. 10 means every piece reads right beside a player; 5 means one piece is obviously off; 1 means pieces read as toys or giants.
- Rotation anchors: 10 means every piece stands upright, sits square to its wall or row and faces the side it is used from; 5 means one piece is turned wrong; 1 means pieces lie on their side or stand skewed.
- Placement anchors: 10 means pieces are grouped by use, stand against walls or in rows, walkways stay clear, and nothing clips or floats; 5 means one cluster blocks a path or clips; 1 means pieces are scattered or stacked into each other.
- Materials anchors: 10 means surface variety and trim density close to the references (floor distinct from walls, skirting, frames, signage); 5 means plain but coherent; 1 means one flat material everywhere.
- Lighting anchors: 10 means visible light sources, contrast and shadow like the references' interiors; 5 means even but readable; 1 means flat outdoor sun or blown-out white.
- Each axis answer gives its evidence from the capture before its score, plus up to five named defects (piece, what is wrong, where), so a fix can target a piece.
- Eye height is 5 studs above the floor. The eye view stands 3 studs in from the room's -Z wall at its center and looks at the room center, pitched down 10 degrees.
- Place IDs: DOORS 6516141723, Brookhaven RP 4924922222, LifeTogether RP 13967668166, Adopt Me! 920587237, Murder Mystery 2 142823291, Forsaken 18687417158, Dandy's World 16116270224, Animal Hospital 78515283254292 ("Animal Hospital (Anomaly)", the most-visited of three games with that name). LifeTogether, Adopt Me!, Murder Mystery 2, Forsaken and Dandy's World gave no usable image.
- The reviewer ignores logos, UI and characters laid over a reference; four DOORS references and the Brookhaven one carry them.
- Reviewer runs use the same headless `claude -p`, read-only and in an empty folder, as the place check. Images get neutral names, and there is no paid API.
- `eval/results.jsonl` gets per-room axis medians and defects on each line. It stays uncommitted by this work.

## Acceptance
- `node scripts/fetch-references.ts` downloads every image in the reference set into `eval/references/`, and `git status` lists none of them (Task 1).
- `npm run smoke:studio` captures an eye view of each smoke room, with ceilings visible (Task 2).
- `node scripts/calibrate-review.ts` shows each leave-one-out reference at or above 8 on every axis median and today's train-station rooms at or below 4 on their lowest axis (Task 5).
- `npm run eval:studio` exits non-zero today, naming each wave-1 room with its five axis medians and its defects (Task 6).
- `npm run check` passes (Tasks 1-6, Success criterion).

## Manual checks
- Look at the eye view of the train-station platform next to its three references. The comparison should match what you would judge yourself.

## Plan basis
Repository: /Users/thomash/Documents/Code/personal/tools/roblox-kit
Branch: finished-looking-maps
Worktree setup: none
Land gate: npm run check

## Success criterion
`npm run check && node scripts/calibrate-review.ts` passes.

## Checkpoint
- Blocks first: Task 1 (references gate the reviewer) and Task 2 (the eye view gates every score).
- Parallel: Tasks 1, 2 and 3.
- Shared state: `src/config.ts` (Tasks 2, 4, 6), `skills/visual-judge/SKILL.md` (Task 3), and the one open Studio place every smoke, calibration and eval proof uses.
- Smallest safe split: one task per concern below, serialized on `src/config.ts`.

## Tasks
### Task 1: feat(eval): fetch the reference images the reference set names
Depends on: none | Files: `scripts/fetch-references.ts`, `eval/reference-set.json`, `.gitignore` | Data: an array of `{ game, placeId, universeId, targetId, version, note }` entries, downloaded to `eval/references/<game>/<targetId>.png`; a listed targetId the API no longer returns fails the run by name | Proof: node scripts/fetch-references.ts
### Task 2: feat(capture): add an eye-level view inside each zone
Depends on: none | Files: `src/map/zone-cameras.ts`, `src/map/zone-cameras.test.ts`, `src/map/capture-zones-tool.ts`, `src/map/capture-zones-tool.test.ts`, `src/config.ts`, `scripts/smoke-studio.ts` | Data: a fourth `ShotView` value `eye` and an optional `views` input defaulting to `a` and `b`; eye shots are taken with ceilings shown and no wall hidden | Proof: npm run smoke:studio
### Task 3: feat(visual-judge): write the reference-scored quality rubric
Depends on: none | Files: `skills/visual-judge/quality-prompt.md`, `skills/visual-judge/SKILL.md` | Data: a brief with the five axes and their anchors, evidence before score, and an answer JSON of per-axis `{ evidence, score }` plus a `defects` array | Proof: npm run validate:plugin
### Task 4: feat(eval): score a room's captures against its references
Depends on: 1, 2, 3 | Files: `src/eval/quality-review.ts`, `src/eval/quality-review.test.ts`, `src/config.ts` | Data: three reviewer answers per room reduced to one per-axis median record; passed when every median reaches `config.visualPassScore` (7) | Proof: node --test src/eval/quality-review.test.ts
### Task 5: feat(eval): calibrate the reviewer on leave-one-out references and today's rooms
Depends on: 4 | Files: `scripts/calibrate-review.ts` | Data: one JSON row per calibration image with its axis medians and whether it lands inside its bound (at or above 8 for a reference, at or below 4 lowest axis for a current room) | Proof: node scripts/calibrate-review.ts
### Task 6: feat(eval): gate eval:studio on the quality score of the current wave
Depends on: 5 | Files: `scripts/eval-studio.ts`, `src/config.ts` | Data: the wave's room types as one list in `config`; exits 1 until every wave-1 room reaches the pass score, which is expected today | Proof: npm run eval:studio
