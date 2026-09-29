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
5. **Log the round.** Append one line to `.roblox-kit/judge-log.jsonl` in the user's project: `{ "round", "date", "mapId", "zones", "findings" }`. Add `.roblox-kit/` to that project's `.gitignore` when missing.
6. **Send only `blocker` and `major` findings to the builder.** Edit the `build_map` spec at `specField` and rebuild with the same `mapId`; a hand patch in Studio is erased by the next rebuild. `minor` findings go in the final report.
7. **Judge the changed zones again with a new subagent after `check_map`.** A fix can open a gap or an overlap, and a reused judge already knows what to expect.
8. **Stop on a round with no `blocker` or `major`, after round 3, or when a finding repeats.** A repeat is the same `type`, `specField` and `imageId` in two rounds. Report open findings in the judge's words and ask the user before another round, because past that the loop chases taste.

## Limits

- Every shot looks from the +Z side, so a wall on that side can hide the room. Tell the judge, and do not count a hidden interior as a defect.
- `capture_zones` moves the Studio camera and needs an open viewport. A capture error is a setup fault: report it rather than judge without images.

## References

| File                  | Read it when                                                              |
| --------------------- | ------------------------------------------------------------------------- |
| `finding.schema.json` | Step 4, when writing the judge's brief or checking a finding it returned. |

## Judgment

- The stated intent outranks the judge's taste.
- `check_map` outranks the image: a failed check is fixed first.
- Fewer zones per round outrank full coverage.
