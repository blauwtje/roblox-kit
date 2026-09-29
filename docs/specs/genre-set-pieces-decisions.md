Task 1 c764337: compare Workspace children to the pre-smoke snapshot instead of a fixed list
Task 5 9050c4a: setPieces is a free string array (kinds are not enum-checked in the schema; the placement task owns the kind list).
Task 5 9050c4a: signLabel must be non-empty; setPieces may be empty.
Task 7 32f946e: sign takes Label (string) and AccentColor (Color3) attributes; text is a SurfaceGui on the -Z face, blank when Label is empty. Task 8 must set them.
Task 7 32f946e: dimensions (studs): track-bed 16x1x5, platform-edge 16x0.5x2, counter 8x3.5x2.5, sign 4x1.5x0.3; the -Z side faces the track/customer/viewer.
Task 2 44f7afe: wait before each screen_capture, since it sets its own camera and the wait cannot sit between camera move and capture; it also covers the ceiling hide before the first shot.
Task 2 44f7afe: 3000 ms, not measured against wall luminance (Task 3's measure script does that); raise it in config if back-to-back captures still differ.
Task 2 44f7afe: the tool description states the per-image wait (an 11-image call takes about 33 s longer).
Task 2 44f7afe: the test uses mock.timers and the code calls timers through the default module object (`timers.setTimeout`), since a named ESM import is not mockable.
