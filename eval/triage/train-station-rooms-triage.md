# Task 18 triage: look check output (train-station-rooms)

Evidence for Task 19. Labels: **predates branch** (a real or undecided entry that the `origin/main` rebuild also has), **caused by branch** (on `HEAD` only), **check gap** (the check or lint flags something built as designed). A check-gap entry also carries its origin in the last column. No entry is unproven.

## Method

- Report `ae18737c-0a09-4e21-973d-2b4a767cc4d3` lived only in the MCP server's memory, so it was regenerated: `build_map` + `check_map` of `eval/benchmarks/train-station.json` (`useRecordedAssets` true) from `HEAD` (mapId `triage-head`) and from `git archive origin/main` extracted to a scratch dir (mapId `triage-main`, its own benchmark file), both via the repo's tool handlers against the open Studio. Both scratch maps were removed afterwards.
- `HEAD` rebuild: 53 placement entries (same as the report: 12 pendant, 24 arch, 16 baseboard, 1 train car) and 99 look entries (90 gap + 9 facing). The brief's "about 100 dead-gap entries" is these 99 look entries (`origin/main` has 113: 100 gap, 12 facing, 1 density).
- Entries compared by (part, detail, x, z) for placement and by (kind, zone, detail) for look. 48 of 53 placement entries are identical on `origin/main`; the other 5 are the 4 platform pendants (same entry, y 12 -> 20 because the platform wall is now 24) and the train car.
- Part sizes read from Studio on both maps (arch frames 11.6 x 16 x 0.6, baseboards 0.5 high x 0.3 thick, car 52 x 12.5 x 8.6 centred y 7.2, track bed top at y 1.0).

## Counts

| Group                                                    | Entries | predates branch | caused by branch | check gap |
| -------------------------------------------------------- | ------- | --------------- | ---------------- | --------- |
| pendant-hero (no floor)                                  | 12      | 12              | 0                | 0         |
| arch-hero-1..8 (doorway clearance, hallway-wall overlap) | 24      | 0               | 0                | 24        |
| baseboard-hero-17..20 (doorway clearance)                | 16      | 0               | 0                | 16        |
| train-car-hero-1 (no floor)                              | 1       | 0               | 0                | 1         |
| **placement total**                                      | **53**  | 12              | 0                | 41        |
| look gap (dead gap)                                      | 90      | 85              | 5                | 0         |
| look facing (bench faces away)                           | 9       | 9               | 0                | 0         |
| **look total**                                           | **99**  | 94              | 5                | 0         |

Sum checks: 12 + 24 + 16 + 1 = 53; 90 + 9 = 99 (about 100 gap-like entries and the 9 bench warnings).

## Evidence per label

- **Pendants (12, predates)**: identical entries on the `origin/main` rebuild (pendants 1-4 and 9-12 same position; 5-8 same x/z, y 12 on main, 20 here with the 24-high platform). `git diff origin/main..HEAD` leaves `pendant.py` and the pendant declaration untouched (the preset diff only removes `heroProps` for ticket-counter and train-car and adds declarations). Real defect: the 2-high pendant body floats 3-4 studs below the ceiling with no rod; the check also counts a hanging mesh as a floor prop, so part of it is a check gap. Labelled predates because the rebuild proves origin; the earlier handoff's by-diff claim is now confirmed by a rebuilt map.
- **Arches (24, check gap)**: `luau/check-map.luau` `placedBox` skips trim meshes only by the `trim-` kind prefix, so declared `arch` meshes are checked as floor props. Each frame (11.6 x 16 x 0.6) stands in its doorway by design and sits 0.8 studs into the 1-stud hallway walls by design (`docs/specs/train-station-rooms.md` open item 2). Same 24 entries on the `origin/main` rebuild, so origin is predates.
- **Baseboards 17-20 (16, check gap)**: declared band meshes (`declaredTrimOf`, `band:baseboard`) running 12-13 studs along the hallway walls at the doorway edge (x = +-4.8, 0.3 thick, 0.5 high), flagged by the same `placedBox` gap; they never block the opening. Same 16 entries on the `origin/main` rebuild.
- **Train car (1, check gap, origin branch)**: the car (centre y 7.2, height 12.5, so its bottom is y 0.95) stands on the track bed top (y 1.0) by owner decision for Task 9 (`onto:prop:track-bed`, no fallback). `check-map.luau` comment: "A prop standing on another prop ... has no floor under its rays and is reported". `origin/main` has no `train-car-hero-1` (its recipe `5ae948997b32` had no recorded asset, so the track-bed set piece stayed).
- **Look gap**: the rebuild of `origin/main` has 100 gap entries; 85 of this build's are the same on it. The 5 caused-by-branch entries are all in the platform (clock and pillar 0.4 apart, 4x platform-edge and pillar 3 apart); on `origin/main` the platform had clock-pillar 1.4 apart and 4 platform-edge and pillar pairs 4 apart instead, so the branch moved platform prop positions. The branch also removed 10 other platform gaps (bench, lamp and sign pairs), 3 platform facing warnings and the density issue. Whether any gap is intended is not judged here: the lint flags every pair between 0 and the threshold regardless of intent, so none is labelled check gap.
- **Look facing (9, predates)**: concourse bench rows at x 9, 15 and 21 (z 393, 400, 407), all 9 present on the `origin/main` rebuild; `look-lint.ts` `facingIssues` is unchanged by the branch (its diff only touches density). Real orientation versus lint false positive is not settled here.

## Entries: placement (53)

| part              | detail                                                                                           | position       | label           | origin evidence                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ | -------------- | --------------- | ---------------------------------------------------------- |
| train-car-hero-1  | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (0, 7, 459)    | check gap       | branch (new mesh via onto:prop route; none on origin/main) |
| baseboard-hero-17 | inside the doorway clearance box of the south wall of room "concourse"                           | (5, 0, 428)    | check gap       | also on origin/main rebuild                                |
| baseboard-hero-17 | inside the doorway clearance box of the north wall of room "platform"                            | (5, 0, 428)    | check gap       | also on origin/main rebuild                                |
| baseboard-hero-17 | inside the doorway clearance box of the north wall of room "concourse-platform-hallway"          | (5, 0, 428)    | check gap       | also on origin/main rebuild                                |
| baseboard-hero-17 | inside the doorway clearance box of the south wall of room "concourse-platform-hallway"          | (5, 0, 428)    | check gap       | also on origin/main rebuild                                |
| baseboard-hero-18 | inside the doorway clearance box of the south wall of room "concourse"                           | (-5, 0, 428)   | check gap       | also on origin/main rebuild                                |
| baseboard-hero-18 | inside the doorway clearance box of the north wall of room "platform"                            | (-5, 0, 428)   | check gap       | also on origin/main rebuild                                |
| baseboard-hero-18 | inside the doorway clearance box of the north wall of room "concourse-platform-hallway"          | (-5, 0, 428)   | check gap       | also on origin/main rebuild                                |
| baseboard-hero-18 | inside the doorway clearance box of the south wall of room "concourse-platform-hallway"          | (-5, 0, 428)   | check gap       | also on origin/main rebuild                                |
| baseboard-hero-19 | inside the doorway clearance box of the west wall of room "concourse"                            | (-38, 0, 395)  | check gap       | also on origin/main rebuild                                |
| baseboard-hero-19 | inside the doorway clearance box of the east wall of room "ticket-hall"                          | (-38, 0, 395)  | check gap       | also on origin/main rebuild                                |
| baseboard-hero-19 | inside the doorway clearance box of the east wall of room "concourse-ticket-hall-hallway"        | (-38, 0, 395)  | check gap       | also on origin/main rebuild                                |
| baseboard-hero-19 | inside the doorway clearance box of the west wall of room "concourse-ticket-hall-hallway"        | (-38, 0, 395)  | check gap       | also on origin/main rebuild                                |
| baseboard-hero-20 | inside the doorway clearance box of the west wall of room "concourse"                            | (-38, 0, 405)  | check gap       | also on origin/main rebuild                                |
| baseboard-hero-20 | inside the doorway clearance box of the east wall of room "ticket-hall"                          | (-38, 0, 405)  | check gap       | also on origin/main rebuild                                |
| baseboard-hero-20 | inside the doorway clearance box of the east wall of room "concourse-ticket-hall-hallway"        | (-38, 0, 405)  | check gap       | also on origin/main rebuild                                |
| baseboard-hero-20 | inside the doorway clearance box of the west wall of room "concourse-ticket-hall-hallway"        | (-38, 0, 405)  | check gap       | also on origin/main rebuild                                |
| arch-hero-1       | inside the doorway clearance box of the south wall of room "concourse"                           | (0, 8, 419)    | check gap       | also on origin/main rebuild                                |
| arch-hero-1       | inside the doorway clearance box of the north wall of room "concourse-platform-hallway"          | (0, 8, 419)    | check gap       | also on origin/main rebuild                                |
| arch-hero-2       | inside the doorway clearance box of the west wall of room "concourse"                            | (-29, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-2       | inside the doorway clearance box of the east wall of room "concourse-ticket-hall-hallway"        | (-29, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-3       | inside the doorway clearance box of the north wall of room "platform"                            | (0, 8, 436)    | check gap       | also on origin/main rebuild                                |
| arch-hero-3       | inside the doorway clearance box of the south wall of room "concourse-platform-hallway"          | (0, 8, 436)    | check gap       | also on origin/main rebuild                                |
| arch-hero-4       | inside the doorway clearance box of the east wall of room "ticket-hall"                          | (-46, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-4       | inside the doorway clearance box of the west wall of room "concourse-ticket-hall-hallway"        | (-46, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-5       | overlaps the wall part concourse-platform-hallway-wall-west-1                                    | (0, 8, 421)    | check gap       | also on origin/main rebuild                                |
| arch-hero-5       | overlaps the wall part concourse-platform-hallway-wall-east-1                                    | (0, 8, 421)    | check gap       | also on origin/main rebuild                                |
| arch-hero-5       | inside the doorway clearance box of the south wall of room "concourse"                           | (0, 8, 421)    | check gap       | also on origin/main rebuild                                |
| arch-hero-5       | inside the doorway clearance box of the north wall of room "concourse-platform-hallway"          | (0, 8, 421)    | check gap       | also on origin/main rebuild                                |
| arch-hero-6       | overlaps the wall part concourse-platform-hallway-wall-west-1                                    | (0, 8, 434)    | check gap       | also on origin/main rebuild                                |
| arch-hero-6       | overlaps the wall part concourse-platform-hallway-wall-east-1                                    | (0, 8, 434)    | check gap       | also on origin/main rebuild                                |
| arch-hero-6       | inside the doorway clearance box of the north wall of room "platform"                            | (0, 8, 434)    | check gap       | also on origin/main rebuild                                |
| arch-hero-6       | inside the doorway clearance box of the south wall of room "concourse-platform-hallway"          | (0, 8, 434)    | check gap       | also on origin/main rebuild                                |
| arch-hero-7       | overlaps the wall part concourse-ticket-hall-hallway-wall-north-1                                | (-31, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-7       | overlaps the wall part concourse-ticket-hall-hallway-wall-south-1                                | (-31, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-7       | inside the doorway clearance box of the west wall of room "concourse"                            | (-31, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-7       | inside the doorway clearance box of the east wall of room "concourse-ticket-hall-hallway"        | (-31, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-8       | overlaps the wall part concourse-ticket-hall-hallway-wall-north-1                                | (-44, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-8       | overlaps the wall part concourse-ticket-hall-hallway-wall-south-1                                | (-44, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-8       | inside the doorway clearance box of the east wall of room "ticket-hall"                          | (-44, 8, 400)  | check gap       | also on origin/main rebuild                                |
| arch-hero-8       | inside the doorway clearance box of the west wall of room "concourse-ticket-hall-hallway"        | (-44, 8, 400)  | check gap       | also on origin/main rebuild                                |
| pendant-hero-1    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-25, 12, 395) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-2    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-25, 12, 405) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-3    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-15, 12, 395) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-4    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-15, 12, 405) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-5    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-25, 20, 445) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-6    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-25, 20, 455) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-7    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-15, 20, 445) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-8    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-15, 20, 455) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-9    | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-70, 12, 395) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-10   | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-70, 12, 405) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-11   | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-60, 12, 395) | predates branch | same entry on origin/main rebuild                          |
| pendant-hero-12   | no floor under its center or footprint corners within 0.1 studs below it, and it touches no wall | (-60, 12, 405) | predates branch | same entry on origin/main rebuild                          |

## Entries: look lint (99)

| kind   | zone        | detail                                                                                           | label            | origin evidence                   |
| ------ | ----------- | ------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------- |
| gap    | concourse   | departure-board and pillar are 2.8 studs apart: too narrow to use, too wide to look joined.      | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | sign and pillar are 3.6 studs apart: too narrow to use, too wide to look joined.                 | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | track-bed stands 2.5 studs from the west wall: too narrow to use, too wide to look flush.        | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | track-bed stands 2.5 studs from the east wall: too narrow to use, too wide to look flush.        | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | track-bed and clock are 3.4 studs apart: too narrow to use, too wide to look joined.             | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | platform-edge stands 2.5 studs from the west wall: too narrow to use, too wide to look flush.    | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | platform-edge stands 2.5 studs from the east wall: too narrow to use, too wide to look flush.    | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | platform-edge and clock are 1.4 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | platform-edge and pillar are 3 studs apart: too narrow to use, too wide to look joined.          | caused by branch | absent on origin/main rebuild     |
| gap    | platform    | platform-edge and pillar are 3 studs apart: too narrow to use, too wide to look joined.          | caused by branch | absent on origin/main rebuild     |
| gap    | platform    | platform-edge and pillar are 3 studs apart: too narrow to use, too wide to look joined.          | caused by branch | absent on origin/main rebuild     |
| gap    | platform    | platform-edge and pillar are 3 studs apart: too narrow to use, too wide to look joined.          | caused by branch | absent on origin/main rebuild     |
| gap    | platform    | clock and pillar are 0.4 studs apart: too narrow to use, too wide to look joined.                | caused by branch | absent on origin/main rebuild     |
| gap    | ticket-hall | ticket-counter and bench are 2.5 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-counter and bench are 2.5 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-counter and rail are 1.7 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | sign and ticket-machine are 1.6 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine stands 2 studs from the east wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and ticket-machine are 3 studs apart: too narrow to use, too wide to look joined. | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine stands 2 studs from the east wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and ticket-machine are 3 studs apart: too narrow to use, too wide to look joined. | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine stands 2 studs from the east wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and ticket-machine are 3 studs apart: too narrow to use, too wide to look joined. | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine stands 2 studs from the east wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and ticket-machine are 3 studs apart: too narrow to use, too wide to look joined. | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine stands 2 studs from the east wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine stands 2 studs from the east wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | ticket-machine and bench are 2.8 studs apart: too narrow to use, too wide to look joined.        | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the north wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the north wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the north wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the north wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the north wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the north wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar and bench are 3 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the south wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the south wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the south wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar stands 4 studs from the south wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | pillar and bench are 3 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | bench and bench are 3.5 studs apart: too narrow to use, too wide to look joined.                 | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | bench and bench are 3.5 studs apart: too narrow to use, too wide to look joined.                 | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | bench and bench are 3.5 studs apart: too narrow to use, too wide to look joined.                 | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | bench and bench are 3.5 studs apart: too narrow to use, too wide to look joined.                 | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | bench and bench are 3.5 studs apart: too narrow to use, too wide to look joined.                 | predates branch  | same entry on origin/main rebuild |
| gap    | concourse   | bench and bench are 3.5 studs apart: too narrow to use, too wide to look joined.                 | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | lamp and bench are 2.5 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | lamp and bench are 2.5 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | bench and bench are 2 studs apart: too narrow to use, too wide to look joined.                   | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | bench and pillar are 2.5 studs apart: too narrow to use, too wide to look joined.                | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | bench and pillar are 2.5 studs apart: too narrow to use, too wide to look joined.                | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | bench and bench are 2 studs apart: too narrow to use, too wide to look joined.                   | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | bench and pillar are 2.5 studs apart: too narrow to use, too wide to look joined.                | predates branch  | same entry on origin/main rebuild |
| gap    | platform    | bench and pillar are 2.5 studs apart: too narrow to use, too wide to look joined.                | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench stands 2 studs from the north wall: too narrow to use, too wide to look flush.             | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench stands 3.5 studs from the west wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and bench are 4 studs apart: too narrow to use, too wide to look joined.                   | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and ticket-machine are 2 studs apart: too narrow to use, too wide to look joined.          | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench stands 2 studs from the north wall: too narrow to use, too wide to look flush.             | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and rail are 3.2 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and lamp are 0.8 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and ticket-machine are 2 studs apart: too narrow to use, too wide to look joined.          | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench stands 2 studs from the south wall: too narrow to use, too wide to look flush.             | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench stands 3.5 studs from the west wall: too narrow to use, too wide to look flush.            | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and bench are 4 studs apart: too narrow to use, too wide to look joined.                   | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and ticket-machine are 2 studs apart: too narrow to use, too wide to look joined.          | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench stands 2 studs from the south wall: too narrow to use, too wide to look flush.             | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and rail are 3.2 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and lamp are 0.8 studs apart: too narrow to use, too wide to look joined.                  | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | bench and ticket-machine are 2 studs apart: too narrow to use, too wide to look joined.          | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | rail and rail are 3.5 studs apart: too narrow to use, too wide to look joined.                   | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | rail and ticket-machine are 0.5 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | rail and ticket-machine are 0.5 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | rail and ticket-machine are 3.7 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | rail and ticket-machine are 3.7 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | lamp and ticket-machine are 1.5 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | lamp and ticket-machine are 1.5 studs apart: too narrow to use, too wide to look joined.         | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-machine stands 4 studs from the north wall: too narrow to use, too wide to look flush.    | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-machine stands 3.5 studs from the east wall: too narrow to use, too wide to look flush.   | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-machine stands 4 studs from the south wall: too narrow to use, too wide to look flush.    | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-machine stands 3.5 studs from the east wall: too narrow to use, too wide to look flush.   | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-machine stands 4 studs from the west wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| gap    | ticket-hall | ticket-machine stands 4 studs from the west wall: too narrow to use, too wide to look flush.     | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (9, 393) faces away from the center of room "concourse".                                | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (9, 400) faces away from the center of room "concourse".                                | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (9, 407) faces away from the center of room "concourse".                                | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (15, 393) faces away from the center of room "concourse".                               | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (15, 400) faces away from the center of room "concourse".                               | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (15, 407) faces away from the center of room "concourse".                               | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (21, 393) faces away from the center of room "concourse".                               | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (21, 400) faces away from the center of room "concourse".                               | predates branch  | same entry on origin/main rebuild |
| facing | concourse   | bench at (21, 407) faces away from the center of room "concourse".                               | predates branch  | same entry on origin/main rebuild |

## Platform look-lint share (Task 21)

Fresh `look` build: no density, walkway, doorway or scale warning. Shares computed with the density loop of `src/map/look-lint.ts` (the lint prints only out-of-band rooms):

- platform: inner floor 1624 sq studs (400 minimum), props cover 109.7 sq studs = 6.75%, inside the 2% to 40% band in `src/config.ts`.
- concourse 11.36%, ticket hall 19.09%; both hallways are 130 sq studs, under the minimum, so not checked.

## Scale sheet (Task 22)

Reshot from the 17 eye camera (`capture_zones` view `eye`, `cutaway: false`) after the Task 17 bench change, header grounding (`5bae7c8`) and palette slots (`6675b77`). Each shot carries a 5.8-stud R15 figure placed ahead of the camera and removed afterwards; `benchmark-train-station` was parked and restored. Sheet: `docs/specs/train-station-look-files/22-scale-sheet.jpg` (17 reference on top; concourse, platform, ticket hall below), with the single shots `22a`, `22b`, `22c` beside it. `check_map look`: floating 0, placement 21 (arch, pendant and train-car, as triaged). Waiting for the owner to accept the sheet.
