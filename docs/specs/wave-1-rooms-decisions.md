Task 1 495406c: the east/west fallback sign (hung in the doorway) shares the same record, so it also moves onto the wall face.
Task 1 495406c: the arch lintel (0.6 deep) still protrudes past the sign's back face; the sign hangs below the lintel, so they do not overlap.
Revision after the Task 3 eval (d1a9511): lighting, focalHierarchy and negativeSpace did not rise, so Tasks 11-14 run before Task 4.
Task 13: the eye view (5 studs up, tilted 10 degrees down) never frames a ceiling-center fixture, and each room had 1-2 lights, so reviewers saw no light source; fixtures move into the forward view in a preset-driven pattern, and the eye camera stays unchanged.
Task 13: ShadowSoftness only sharpens sun shadows under LightingStyle Realistic, and no local light cast shadows outside the largest room, so each room's ceiling-center light becomes a shadow-casting hero once a preset has fixtures; fixture lights cast none.
Task 12: Task 1 rested on a false premise: a doorway is a full-height wall gap with no wall part above it, so its sign touched no wall at any inset; its unit test used a hand-made spec, not the benchmark layout, and missed it.
Task 11: the concourse place check failed on the answer "waiting concourse" because placeMatches compares whole normalized names; the room term inside a longer name now passes.
Task 11 7f4cd47: empty accepted names never match
Task 13 d08e58b: fixture `height`/`drop` measure to the fixture's center (sconce y = height; pendant y = wallHeight - drop).
Task 13 d08e58b: train-station sconce size 2 wide x 3 tall x 1 deep studs (brief gave none).
Task 13 d08e58b: sconce flush to the wall's inner face; skipped within doorWidth/2 + half its width of a door offset, and within cornerReachStuds of a corner.
Task 13 d08e58b: pendants form a centered grid inside the room bounds; an odd grid puts one at the center, beside the hero light.
Task 13 d08e58b: with lightFixtures every room's center light is a shadow-casting hero (not only the largest room).
Task 14 969a464: the fixture record carries `pendant: boolean`, because the Luau cannot tell a pendant from a sconce by position (both sit under the tagged ceiling).
Task 14 969a464: the fixture part name gets a running number (`-fixture-<n>`), because a zone holds many fixtures.
Task 14 969a464: the fixture Attachment keeps the name `<zone>-<role>-light`.
Task 6 8aa3aed: every part of a prop takes the role color and material, with no per-part roles.
Task 6 8aa3aed: unset attributes default to a new Part's own color and material (Plastic), which is today's look.
Revision after the Task 10 eval (3e40298): no train-station room reached 7 (platform focalHierarchy 3, readability 4), so Tasks 15-26 add generated hero props as each room's focal point; asset packs, store and downloaded models stay out.
Tasks 15-26: Blender runs headless (`blender -b --factory-startup -P`), as the animation skill runs it, so blender-mcp's integrations and default-on telemetry never load.
Tasks 17-18: GLB over FBX: Open Cloud accepts `model/gltf-binary` for Models, and its JSON chunk gives triangles, bounds and names to a TypeScript check with no FBX parser; the first upload confirms Studio imports it.
Task 18: one object per surface role, so each role becomes one MeshPart that build_map colors from the preset, as Task 6 colors primitive props; the palette stays in presets/.
Task 22: asset ids live in `src/hero-props/hero-assets.json`, not presets/, because `loadPresets` parses every `.json` in presets/ as a preset.
Task 22: the upload runs inside build_map, because plugin `userConfig` values reach only the plugin's MCP servers (via `env`) and hooks, not npm scripts.
Task 23: a hero prop takes the slot of the set piece it replaces, and that set piece is the fallback, so a build without an uploaded asset looks as it does today.
Task 16: the platform's train car replaces the track bed, which runs along the far (south) wall opposite the entry, inside the eye view.
Task 25: the ticket hall's hero is its ticket counter, which holds the facing-entry slot; a ticket machine has no slot there.
Task 15 cd12a65: renamed `fixtureSize` to `studDimensions` so fixtures and hero-prop sizes share one width/height/depth schema.
Task 15 cd12a65: extracted `surfaceRoleName` so `propRule.surface` and the hero part `role` share one role enum.
Task 15 cd12a65: a room type's `heroProps` kinds are not cross-checked against the preset's `heroProps` keys in the schema, because the brief names no such rule; a later task can add it.
Task 15 cd12a65: `profile` part is a polygon of at least 3 x/y points extruded `depth` studs along z; `cylinder` takes `radius`, `length` and `axis`; every part has a `center` in studs from the footprint center.
Task 17 6363b68: size is the union of position accessor min/max across all primitives, node transforms not applied.
Task 17 6363b68: a primitive whose mode is not a triangle list, or a position accessor without min/max, throws instead of being skipped.
Task 17 6363b68: triangles come from the indices accessor count, else the POSITION count, divided by 3.
Task 17 6363b68: unnamed meshes and materials are reported as empty-string names.
Task 16 2a0a7f5: car length 40 studs, under the 55-stud track-bed span on the 60-wide benchmark platform, over the 16-stud default.
Task 16 2a0a7f5: car depth 4.2 studs so it stays on the 5-stud-deep track bed; height 8.6 under the 16-stud wall.
Task 16 2a0a7f5: length runs along `width` (x), the same axis as the track bed's x length.
Task 16 2a0a7f5: the wall role colors the body, accent the window band, since roles are limited to five.
Task 18 3a0b10c: Blender units are studs (1 unit = 1 stud); recipe (x, y, z) maps to Blender (x, -z, y), which exports as glTF (x, y, z).
Task 18 3a0b10c: a profile's points are offsets from its `center`, not absolute; cylinders use 16 segments.
Task 18 3a0b10c: the hash is the first 12 hex characters of a SHA-256 over the canonical (key-sorted) recipe, the used roles' colors and the .py source.
Task 18 3a0b10c: `heroPropSizeToleranceStuds` is 0.1 and `blenderPath` is /opt/homebrew/bin/blender in config.
Task 18 3a0b10c: the color on each role material is the preset's surface color (sRGB to linear); the surface material name is not exported.
Task 18 3a0b10c: Blender always reruns (no cache by hash); the run passes `--python-exit-code 1` so a script error fails it.
Task 19 19bf528: views are orthographic on a neutral grey background at 768px, constants in render-hero-prop.py (config.ts is outside Files).
Task 19 19bf528: front looks along Blender's Y (recipe depth axis, the car's long face), side along the width axis (end-on for the car), three-quarter from a raised corner.
Task 20 59128ee: one fresh reviewer per round (spec says "a fresh reviewer"), not three.
Task 20 59128ee: rounds.json lives at .roblox-kit/hero-props/<preset>-<kind>/rounds.json, a list of hashes; a hash is recorded before the reviewer runs, so a reviewer crash still uses the round; a re-run of a recorded hash costs none.
Task 20 59128ee: review.json is {hash, passed, axes: {axis: {score, note}}} in the hash folder.
Task 20 59128ee: the reviewer gets the recipe's kind, description, size and per-role color and part count, with renders copied as render-1..3.
Task 22 0599cec: userConfig keys are snake_case (roblox_open_cloud_api_key, roblox_creator_user_id), both required: false so the plugin installs without a key.
Task 22 0599cec: uploadReviewedHeroProp is idempotent by hash and refuses without a passed review of that hash.
Task 22 0599cec: failed upload records nothing; polling stops after config.openCloudMaxPolls (60 x 2s).
Task 21 (user, 2026-09-30): after three failed rounds (8/6/7/6) the rule is fixed at its source: the track bed widens to 10 studs (two 5-stud grid cells) through a preset `depth` on the `track-bed` prop rule (new Task 27), the car grows to about 7 studs deep, its body takes the `trim` role, and Task 21 gets three new rounds; the old rounds file is kept as rounds-before-task-27.json.
Task 21 f710b85: dropped the `wall` role from the car so the taupe-grey wall/floor blur is gone.
Task 21 f710b85: wheels radius 0.9 in `floor` role with amber hubs, not dark-green `trim` as before.
