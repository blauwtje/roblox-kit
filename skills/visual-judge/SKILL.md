---
name: visual-judge
description: Use when a built Roblox map must be judged by how it looks, or the user asks whether it looks right, or before calling a map's appearance done. Not for overlap or reachability (check_map), building (map-building skill) or Luau.
---

# Visual judge

An author who built a map reads its screenshots as the map they meant, not the map they got. The enemy is judging your own build: the intent fills every gap the image leaves. The overcorrection is an endless polish loop over taste, when only a mismatch with the stated intent is a defect.

## When to use

- A map passed `check_map` and the user wants to know if it looks right.
- Judging rooms for scale, wall gaps, door placement or missing floors before calling a map done.
- Not for overlap, floating or unreachable geometry (`check_map` decides those), building the map (map-building skill) or scripts.

## Process

1. **Write the intent as testable lines before any capture.** One line per room, such as "door on the north wall, floor Concrete, spawn inside". A judge with no stated intent can only say a room looks fine.
2. **Run `check_map` first and fix what it reports.** A failed check is a code fact, so the judge never spends an image on it.
3. **Dispatch a fresh subagent to capture and judge.** Give it only the `mapId`, the intent lines, the preset's palette, surfaces and lighting as the rubric, the `check_map` JSON and the `zones` to look at. It calls `capture_zones` itself, so the images stay out of your context and it never sees your reasoning.
4. **Ask for one finding per issue, reasoning before verdict.** Each finding validates against `finding.schema.json`; reject one without an image-based `evidence.visible`, because it is a guess. "No findings" is a valid answer: a judge pushed to find something invents defects.
5. **Run the place check on each typed room's zone, with its own fresh subagent.** Skip a map whose intent names no genre. Brief it with `place-check-prompt.md` only, with its skill `<source>`: the zone and nothing about the map, so it cannot borrow the intent. Compare its `genre` and `room` with the map's `style.preset` and that room's `roomType` (both spelled as in the spec); compare `room` ignoring case and treating spaces and hyphens alike, so "ticket hall" matches `ticket-hall`; the room's `roomType` in the resolved style may list `roomNames`, and `room` matching any of them passes as well. A differing value, or `unknown`, is one `unidentified-place` `blocker` finding on the room's `<zone>:<view>` image; put the subagent's `clues` in `evidence.visible` and the room's `roomType` in `specField` as `rooms[<index>].roomType`. An `empty` `furnished` answer, whatever `genre` and `room` say, is one `empty-room` `blocker` finding on the same image, with the subagent's `clues` in `evidence.visible` and `rooms[<index>].roomType` as `specField`. A map built without a style has no typed rooms, so run the subagent on each room zone instead; it fails here, with `style` as `specField`. No `blocker` from this step is a pass; it costs no model call beyond the subagent. `npm run eval:studio` runs the same check on each typed room of its benchmarks and fails on a mismatch or an `empty` answer.
6. **Score each room against the references, with three fresh subagents per room.** Brief each with `quality-prompt.md` only: the map's `style.preset` as `<genre>`, the room's `roomType`, the reference images and the room's captures, with its eye view first; never the intent, the spec or the pass score. Each answer scores scale, rotation, placement, materials and lighting from 1 to 10, evidence before score, plus `defects`. Take the median of the three for each axis; a room passes only when every axis median is 7 or more, because a mean hides one broken axis. Report each failing axis with its median and the defects the reviewers named, and send them to the builder in step 8. Skip a map without a style, which has no genre to state. `npm run eval:studio` runs the same scoring on each room of the current wave and fails on an axis below 7.
7. **Log the round.** Append one line to `.roblox-kit/judge-log.jsonl` in the user's project: `{ "round", "date", "mapId", "zones", "findings" }`. Add `.roblox-kit/` to that project's `.gitignore` when missing.
8. **Send only `blocker` and `major` findings to the builder.** Edit the `build_map` spec at `specField`. For `unidentified-place`, fix the style and room type so the room gets its set pieces and sign, not its size; for `empty-room`, add arrangements to the room type, not more rooms or size. Then rebuild with the same `mapId`; a hand patch in Studio is erased by the next rebuild. `minor` findings go in the final report.
9. **Judge the changed zones again with a new subagent after `check_map`.** A fix can open a gap or an overlap, and a reused judge already knows what to expect.
10. **Stop on a round with no `blocker` or `major`, after round 3, or when a finding repeats.** A repeat is the same `type`, `specField` and `imageId` in two rounds. Report open findings in the judge's words and ask the user before another round, because past that the loop chases taste.

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
