Task 5 179398e: new fields are required (not optional), so every preset must declare them.
Task 5 179398e: heightRatio bounds = propDimensions height / 6.5 * 0.75 (min, floored) and / 5 * 1.25 (max, ceiled), 2 decimals, using the current propDimensions y as the real-world studs height.
Task 5 179398e: pillar has no heightRatio; track-bed and platform-edge get one from their 1 and 0.5 stud heights.
Task 5 179398e: propRules keys cover each preset's propKit, set pieces and arrangement pieces; freeRotation false everywhere.
Task 5 179398e: lightingIntent texts from the spec's Assumptions; min<=max refine on both ranges.
Task 6 dd8e739: prop records also carry `position` (issue needs a stud position; the brief's record lacks it)
Task 6 dd8e739: scale flags a prop when height/avatarHeight.min exceeds heightRatio.max or height/avatarHeight.max is under heightRatio.min (inverse of Task 5's bounds)
Task 6 dd8e739: a tilted prop (upright false) is a rotation issue unless freeRotation; a kind without a rule is not checked
Task 6 dd8e739: props are read only when a preset is given; yaw grid tolerance 0.5 degrees, a local constant (config.ts is outside Files)
Task 8 924e430: axis keys palette, focalHierarchy, negativeSpace, readability, atmosphere, lighting
Task 9 137ecda: mergedDefects and its test removed with the defects field, since the reviewer now answers scores only
Task 10 25b96e0: stopReason values pass, round-limit, repeat, null
Task 8/9 50925ea: each axis answers { evidence, score }; QualityResult.evidence keeps every reviewer's note per axis
Task 12: bounds per the user: reference mean axis median >= 6, known-bad anchor mean <= 4, per-axis reference median >= known-bad median + 2; thresholds in config
Task 12: Brookhaven reference dropped; no other indoor cozy-town screenshot in the fetched set, so cozy-town has Animal Hospital alone
Task 12: first passing run: 8/8 images, 6/6 axes; palette gap exactly 2 (reference 8, known-bad 6)
