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
2. **Dispatch a fresh subagent to capture and judge.** Give it the `mapId`, the intent lines and the `zones` to look at. It calls `capture_zones` itself, so the images stay out of your context and it never sees your reasoning.
3. **Ask for the verdict first.** Per zone: `ok` or `defect`, a defect naming what the image shows against which intent line, and a spec field to change when it can tell. A verdict without an image-based reason is not accepted, because it is a guess.
4. **Fix the spec, not the parts.** Edit the `build_map` spec and rebuild with the same `mapId`. A hand patch in Studio is erased by the next rebuild.
5. **Rerun `check_map`, then judge the changed zones with a new subagent.** A fix can open a gap or an overlap, and a reused judge already knows what to expect. Pass only zones that changed.
6. **Stop after three rounds or when every zone is `ok`.** Report zones still marked `defect` with the judge's words. Ask the user before a fourth round, because past that the loop chases taste.

## Limits

- Every shot looks from the +Z side, so a wall on that side can hide the room. Tell the judge, and do not count a hidden interior as a defect.
- `capture_zones` moves the Studio camera and needs an open viewport. A capture error is a setup fault: report it rather than judge without images.

## Judgment

- The stated intent outranks the judge's taste.
- `check_map` outranks the image: a failed check is fixed first.
- Fewer zones per round outrank full coverage.
