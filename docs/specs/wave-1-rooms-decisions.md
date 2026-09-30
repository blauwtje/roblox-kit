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
