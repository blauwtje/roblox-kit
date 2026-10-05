---
name: visual-judge
description: Use when a built Roblox map must be judged by how it looks, or the user asks whether it looks right, or before calling a map's appearance done. Not for overlap or reachability (check_map), building (map-building skill) or Luau.
---

# Visual judge

An author who built a map reads its screenshots as the map they meant, not the map they got. The enemy is judging your own build: the intent fills every gap the image leaves. The overcorrection is an endless polish loop over taste, when only a mismatch with the stated intent is a defect.

## When to use

- A map passed `check_map` and the user wants to know if it looks right.
- Judging rooms for palette, lighting, readability, wall gaps or missing floors before calling a map done.
- Not for overlap, floating, unreachable geometry, prop scale, rotation or placement (`check_map` decides those), building the map (map-building skill) or scripts.

## Process

1. **Write the intent as testable lines before any capture.** One line per room, such as "door on the north wall, floor Concrete, spawn inside". A judge with no stated intent can only say a room looks fine.
2. **Run `check_map` first and fix what it reports.** A failed check is a code fact, so the judge never spends an image on it.
3. **Dispatch the `visual-judge` agent to capture and judge.** Give it only the `mapId`, the intent lines, the preset's palette, surfaces and lighting as the rubric, the `check_map` JSON and the `zones` to look at, at most 8 images per round (`capture_zones` returns the rest in `remainingZones` for the next round). It calls `capture_zones` itself, so the images stay out of your context and it never sees your reasoning.
4. **Ask for one finding per issue, reasoning before verdict.** Each finding validates against `finding.schema.json`, its `type` from the fixed list there (overlap, floating, unreachable, scale, rotation, placement, size-rule, palette, lighting, readability, spec-miss) and its `cites` naming the spec item or preset rule it breaks; reject one without an image-based `evidence.visible`, because it is a guess. "No findings" is a valid answer: a judge pushed to find something invents defects.
5. **Run the place check on each typed room's zone, with its own `place-check` agent.** Skip a map whose intent names no genre. Brief it with `place-check-prompt.md` only, with its skill `<source>`: the zone and nothing about the map, so it cannot borrow the intent. Keep its answer (`clues`, `genre`, `room`, `furnished`) as it came; step 7 hands it to `judge_round`, which compares it with the map's `style.preset` and the room's `roomType`. A map built without a style has no typed rooms, so run the subagent on each room zone instead; it fails there, with `style` as `specField`. `npm run eval:studio` runs the same check on each typed room of its benchmarks and fails on a mismatch or an `empty` answer.
6. **Score each room against the references, with three `quality-reviewer` agents per room.** Brief each with `quality-prompt.md` only: the map's `style.preset` as `<genre>`, the room's `roomType`, the reference images and the room's captures, with its eye view first; never the intent, the spec or the pass score. Pass the preset's `lightingIntent` as `<lighting intent>`. Each reviewer answers, per axis, a score from 1 to 10 and an evidence note of at most two sentences naming what is visible in which image: palette, focalHierarchy, negativeSpace, readability, atmosphere and lighting against the intent. Keep the three answers per room unchanged for step 7; `judge_round` takes the medians, because a mean hides one broken axis. Skip a map without a style, which has no genre to state. `npm run eval:studio` runs the same scoring on each room of the current wave and records the medians.
7. **Hand the answers to `judge_round`.** Call it once per round with `round` (from 1), the `build_map` `spec` with its `mapId`, the `zones` judged, the judge's `findings`, a `placeChecks` entry for each typed room (`zone` and the place-check `answer`) and a `qualityAnswers` entry for each room (`zone` and its three reviewer `answers`). It drops judge findings without `evidence.visible` (returned as `rejected`), turns a differing or `unknown` `genre` or `room` and an `empty` answer into `spec-miss` `blocker` findings, turns each axis median below 7 into a `major` finding, marks repeats, sets `stopReason` and appends the round to `.roblox-kit/judge-log.jsonl` in the user's project, adding `.roblox-kit/` to that project's `.gitignore`. It needs `PROJECT_DIR` set to the project folder; the call fails otherwise. Dispatching the agents stays with you.
8. **Send only `blocker` and `major` findings that cite a spec item or preset rule to the builder.** Take them from the `findings` that `judge_round` returned. Edit the `build_map` spec at `specField`. For a place-check `spec-miss` naming the wrong place, fix the style and room type so the room gets its set pieces and sign, not its size; for one naming an empty room, add arrangements to the room type, not more rooms or size. Then rebuild with the same `mapId`; a hand patch in Studio is erased by the next rebuild. `minor` findings are only logged and go in the final report.
9. **Judge the changed zones again with a new `visual-judge` agent after `check_map`.** A fix can open a gap or an overlap, and a reused judge already knows what to expect.
10. **Act on `stopReason` from `judge_round`.** `pass` (a round with no `blocker` or `major`) ends the loop. `round-limit` (after round 3) or `repeat` (the same `type`, `cites` and `imageId` in two rounds) also stops it: report open findings in the judge's words and ask the user before another round, because past that the loop chases taste. `null` means go on with steps 8 and 9.

## Limits

- View a looks from the +Z side with the zone's +Z wall hidden; view b looks from the -Z side, where the zone's -Z wall can hide the strip behind it. Tell the judge, do not count a hidden strip as a defect, and do not count the missing +Z wall in view a, or its doorway frames and signs left standing, as a wall gap or floating part.
- `capture_zones` moves the Studio camera and needs an open viewport. A capture error is a setup fault: report it rather than judge without images.

## References

| File                    | Read it when                                                                     |
| ----------------------- | -------------------------------------------------------------------------------- |
| `finding.schema.json`   | Steps 4 and 5, when writing the judge's brief or checking a finding it returned. |
| `place-check-prompt.md` | Step 5, when briefing the image-only place-check subagent.                       |
| `quality-prompt.md`     | Step 6, when briefing a reference-scored reviewer.                               |

## Judgment

- The stated intent outranks the judge's taste.
- `check_map` outranks the image: a failed check is fixed first.
- Fewer zones per round outrank full coverage.
