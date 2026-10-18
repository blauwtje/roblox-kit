---
name: recreate-from-screenshot
description: Recreates a place from a reference image as a Roblox map and compares the build with the reference. Use for "make it look like this picture", "copy this screenshot", "recreate this image", "match this reference". Not for judging a map with no reference (visual-judge skill), building from a written spec (map-building skill) or Luau.
---

# Recreate from screenshot

A recreation matches the numbers in the reference, not your memory of it. The enemy is building from the impression "a cozy cabin" and calling it close. The overcorrection is chasing every pixel, when the three largest gaps decide whether it reads as the same place.

## When to use

- The user supplies a reference image and wants a map built to match it.
- A built map must be compared against a reference image.
- Not for judging without a reference (visual-judge skill) or building from a written spec alone (map-building skill).

## Process

1. **Run `analyze_image` on the reference.** Pass its absolute path. Read the returned `tables` and `summaryPath`: palette, value structure, regions, horizon row and the depth grid.
2. **Write intent lines from its numbers before building.** One testable line each, such as "floor palette near the second palette color, horizon at row 3 of 8, brightest region top left". Use the measured values, not adjectives.
3. **Call `build_map`.** Choose the preset and surfaces closest to the palette and write the spec to satisfy the intent lines. Keep the `mapId`.
4. **Call `capture_zones` for the room the reference shows.** On the first round use the eye view; on later rounds apply the `suggestedCamera` from the last `compare_images` (pitch change and advice).
5. **Call `compare_images` with the reference and the capture.** Both accept paths or an `analysisId`. Read `deltas` (largest first), `suggestedCamera` and `table`.
6. **Fix the top three gaps only.** Edit the `build_map` spec for each (palette, value, depth, layout) and rebuild with the same `mapId`; a hand patch in Studio is erased by the next rebuild. Then repeat from step 4.
7. **Stop by the `judge_round` limits.** After each rebuild call `judge_round` with the next `round` (from 1). Stop on `pass`, on `round-limit` (after round 3) or on `repeat`, report the open gaps with the `compare_images` deltas and ask the user before another round.

## Rules

- Run `check_map` after `build_map` and fix what it reports before any capture.
- The reference is never uploaded or copied into the place; only its measurements feed the spec.
