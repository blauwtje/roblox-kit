Task 1 495406c: the east/west fallback sign (hung in the doorway) shares the same record, so it also moves onto the wall face.
Task 1 495406c: the arch lintel (0.6 deep) still protrudes past the sign's back face; the sign hangs below the lintel, so they do not overlap.
Revision after the Task 3 eval (d1a9511): lighting, focalHierarchy and negativeSpace did not rise, so Tasks 11-14 run before Task 4.
Task 13: the eye view (5 studs up, tilted 10 degrees down) never frames a ceiling-center fixture, and each room had 1-2 lights, so reviewers saw no light source; fixtures move into the forward view in a preset-driven pattern, and the eye camera stays unchanged.
Task 13: ShadowSoftness only sharpens sun shadows under LightingStyle Realistic, and no local light cast shadows outside the largest room, so each room's ceiling-center light becomes a shadow-casting hero once a preset has fixtures; fixture lights cast none.
Task 12: Task 1 rested on a false premise: a doorway is a full-height wall gap with no wall part above it, so its sign touched no wall at any inset; its unit test used a hand-made spec, not the benchmark layout, and missed it.
Task 11: the concourse place check failed on the answer "waiting concourse" because placeMatches compares whole normalized names; the room term inside a longer name now passes.
