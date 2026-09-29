Task 1 c764337: compare Workspace children to the pre-smoke snapshot instead of a fixed list
Task 5 9050c4a: setPieces is a free string array (kinds are not enum-checked in the schema; the placement task owns the kind list).
Task 5 9050c4a: signLabel must be non-empty; setPieces may be empty.
Task 7 32f946e: sign takes Label (string) and AccentColor (Color3) attributes; text is a SurfaceGui on the -Z face, blank when Label is empty. Task 8 must set them.
Task 7 32f946e: dimensions (studs): track-bed 16x1x5, platform-edge 16x0.5x2, counter 8x3.5x2.5, sign 4x1.5x0.3; the -Z side faces the track/customer/viewer.
Task 2 44f7afe: wait before each screen_capture, since it sets its own camera and the wait cannot sit between camera move and capture; it also covers the ceiling hide before the first shot.
Task 2 44f7afe: 3000 ms, not measured against wall luminance (Task 3's measure script does that); raise it in config if back-to-back captures still differ.
Task 2 44f7afe: the tool description states the per-image wait (an 11-image call takes about 33 s longer).
Task 2 44f7afe: the test uses mock.timers and the code calls timers through the default module object (`timers.setTimeout`), since a named ESM import is not mockable.
Task 6 5634f0f: a room type on a spec with no style is rejected as "declared room types: none" rather than ignored.
Task 6 5634f0f: an empty roomType string is rejected by the schema (min 1), matching the preset's roomTypes keys.
Task 8 477e8f2: typed rooms get only their set pieces and signs; plain kit props are placed only in untyped rooms (spec filtered before placeProps), so random props cannot overlap set pieces.
Task 8 477e8f2: "entry door" = the room's first door; a piece other than track bed/platform edge stands on the opposite wall, centered on that door's offset (clamped), facing it; no door means south entry.
Task 8 477e8f2: any setPieces kind that is a propKind but not track-bed/platform-edge/sign follows the counter rule (so Task 10/11 kinds place without edits); "sign" in setPieces is ignored since signs come from doors; unknown kind throws.
Task 8 477e8f2: signs hang just inside the doorway under the arch lintel (door gaps are full wall height, so there is no wall above), facing into the room.
Task 8 477e8f2: track bed and platform edge span the wall minus corner-pillar reach; a room with a door in every wall, or too small for a piece, throws a named error instead of dropping it.
Task 9 9788a92: concourse gets set piece "bench", signLabels CONCOURSE / PLATFORM 1 / TICKETS.
Task 9 9788a92: smoke room mapping hall=concourse, vault=ticket-hall, yard=platform.
Task 9 9788a92: Luau treats an attribute whose name ends in "Color" as a hex color (Color3), others as strings.
Task 9 9788a92: smoke duplicates build-map-tool's private propsOf split (plain rooms get kit props, typed rooms set pieces) because build-map-tool.ts is not in Task 9 Files.
Task 10 47fbc8c: dimensions (studs x,y,z) lab-bench 7x3.2x2.5, cell-bars 8x9x0.5, control-console 6x3.5x3.5, crate-stack 4x4x2.5, fireplace 6x5x2
Task 10 47fbc8c: front of every piece faces -Z, like counter and sign
Task 10 47fbc8c: crate-stack and fireplace use Neon flame/monitor colors and Seed-driven variation (vessels, bar spacing, button colors, crate jitter, flame height)
Task 10 47fbc8c: counter left as the existing generator for the shop room
Task 11 36f3ad2: set pieces per room type: lab lab-bench, cell-block cell-bars, bridge control-console, cargo-bay crate-stack, shop counter, home fireplace (one each, per plan Assumptions).
Task 11 36f3ad2: sign labels LABORATORY, CELL BLOCK, BRIDGE, CARGO BAY, SHOP, HOME.
Task 11 36f3ad2: propKit left unchanged (train-station's already omits its set pieces).
