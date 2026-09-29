import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutMap } from "./map-layout.ts";
import type { PartRecord } from "./map-layout.ts";
import { mapSpecSchema } from "./map-spec.ts";
import { buildRoomDetails, detailDimensions } from "./room-details.ts";
import type { DetailPart } from "./room-details.ts";

const surfaces = {
  trim: { color: "#112233", material: "Wood" },
  accent: { color: "#aa5500", material: "Neon" },
};

function detailsOf(input: unknown, overrides?: { parts?: PartRecord[] }): DetailPart[] {
  const spec = mapSpecSchema.parse(input);
  const { parts } = layoutMap(spec);
  return buildRoomDetails(spec, overrides?.parts ?? parts, surfaces);
}

function named(details: DetailPart[], name: string): DetailPart {
  const detail = details.find((candidate) => candidate.name === name);
  assert.ok(detail, `detail ${name} exists`);
  return detail;
}

const closedRoom = {
  mapId: "closed",
  rooms: [{ name: "box", x: 10, z: 20, width: 30, depth: 20 }],
};

const doorRoom = {
  mapId: "door",
  rooms: [
    {
      name: "hall",
      x: 0,
      z: 0,
      width: 40,
      depth: 40,
      doors: [{ side: "north", offset: 0 }],
    },
  ],
};

await test("every detail is decorative: it never collides, touches or answers queries", () => {
  const details = detailsOf(doorRoom);
  assert.ok(details.length > 0);
  for (const detail of details) {
    assert.equal(detail.canCollide, false, detail.name);
    assert.equal(detail.canTouch, false, detail.name);
    assert.equal(detail.canQuery, false, detail.name);
  }
});

await test("names are unique, and the same spec gives the same details", () => {
  const first = detailsOf(doorRoom);
  const second = detailsOf(structuredClone(doorRoom));
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((detail) => detail.name)).size, first.length);
});

await test("a closed room gets a baseboard, crown and stripe per wall and four pillars", () => {
  const details = detailsOf(closedRoom);
  const countOf = (kind: DetailPart["kind"]) =>
    details.filter((detail) => detail.kind === kind).length;
  assert.equal(countOf("trim"), 8);
  assert.equal(countOf("stripe"), 4);
  assert.equal(countOf("pillar"), 4);
  assert.equal(countOf("arch"), 0);
});

await test("trim and pillars take the trim surface, stripes take the accent surface", () => {
  for (const detail of detailsOf(doorRoom)) {
    const surface = detail.kind === "stripe" ? surfaces.accent : surfaces.trim;
    assert.equal(detail.color, surface.color, detail.name);
    assert.equal(detail.material, surface.material, detail.name);
    assert.equal(detail.role, detail.kind === "stripe" ? "accent" : "trim", detail.name);
  }
});

await test("a baseboard stands on the floor against the inner face of its wall", () => {
  const baseboard = named(detailsOf(closedRoom), "box-baseboard-north-1");
  const { trimHeightStuds, trimDepthStuds } = detailDimensions;
  // The north wall of the room at z = 20, depth 20 is centered at z = 10.5 and 1 thick.
  assert.equal(baseboard.position.y, trimHeightStuds / 2);
  assert.equal(baseboard.position.z, 11 + trimDepthStuds / 2);
  assert.equal(baseboard.size.y, trimHeightStuds);
  assert.equal(baseboard.size.z, trimDepthStuds);
});

await test("a crown hangs from the top of the wall, and a stripe sits at its fraction of the height", () => {
  const details = detailsOf(closedRoom);
  const crown = named(details, "box-crown-east-1");
  assert.equal(crown.position.y, 12 - detailDimensions.trimHeightStuds / 2);
  assert.equal(crown.position.x, 24 - detailDimensions.trimDepthStuds / 2);
  const stripe = named(details, "box-stripe-south-1");
  assert.equal(stripe.position.y, 12 * detailDimensions.stripeHeightFraction);
  assert.equal(stripe.position.z, 29 - detailDimensions.stripeDepthStuds / 2);
});

await test("north and south bands reach the side walls and east and west bands stop at them", () => {
  const details = detailsOf(closedRoom);
  const north = named(details, "box-baseboard-north-1");
  const east = named(details, "box-baseboard-east-1");
  assert.equal(north.size.x, 28);
  // The east wall is 18 long; the north and south baseboards take 0.3 off each end.
  assert.equal(east.size.z, 17.4);
});

await test("a doorway splits the bands of its wall and gets two jambs and a lintel", () => {
  const details = detailsOf(doorRoom);
  const northBaseboards = details.filter((detail) =>
    detail.name.startsWith("hall-baseboard-north-"),
  );
  assert.equal(northBaseboards.length, 2);
  const archPieces = details.filter((detail) => detail.kind === "arch");
  assert.deepEqual(
    archPieces.map((detail) => detail.name),
    ["hall-arch-1-left", "hall-arch-1-right", "hall-arch-1-lintel"],
  );
  const lintel = named(details, "hall-arch-1-lintel");
  assert.equal(lintel.position.x, 0);
  assert.equal(lintel.position.y, 12 - detailDimensions.archLintelHeightStuds / 2);
  const left = named(details, "hall-arch-1-left");
  const right = named(details, "hall-arch-1-right");
  assert.equal(left.position.x, -right.position.x);
  assert.equal(left.size.y, 12);
});

await test("a pillar is skipped where a doorway arch covers its corner", () => {
  const details = detailsOf({
    mapId: "corner-door",
    rooms: [
      {
        name: "hall",
        x: 0,
        z: 0,
        width: 40,
        depth: 40,
        doors: [{ side: "north", offset: -17 }],
      },
    ],
  });
  const pillars = details.filter((detail) => detail.kind === "pillar").map((detail) => detail.name);
  assert.deepEqual(pillars, [
    "hall-pillar-northeast",
    "hall-pillar-southwest",
    "hall-pillar-southeast",
  ]);
});

await test("a room too small to leave four pillar widths free gets no pillars", () => {
  const details = detailsOf({
    mapId: "tiny",
    rooms: [{ name: "closet", x: 0, z: 0, width: 7, depth: 7 }],
  });
  assert.equal(details.filter((detail) => detail.kind === "pillar").length, 0);
  assert.ok(details.some((detail) => detail.kind === "trim"));
});

await test("room, wall and door settings size the details of each room", () => {
  const details = detailsOf({
    mapId: "sizes",
    wallHeight: 20,
    rooms: [
      { name: "tall", x: 0, z: 0, width: 40, depth: 40 },
      { name: "low", x: 100, z: 0, width: 40, depth: 40, wallHeight: 8 },
    ],
  });
  assert.equal(named(details, "tall-pillar-northwest").size.y, 20);
  assert.equal(named(details, "low-pillar-northwest").size.y, 8);
});

await test("a wall part whose name does not carry its side is rejected", () => {
  const spec = mapSpecSchema.parse(closedRoom);
  const { parts } = layoutMap(spec);
  const renamed = parts.map((part) =>
    part.kind === "wall" ? { ...part, name: `${part.room}-panel` } : part,
  );
  assert.throws(() => buildRoomDetails(spec, renamed, surfaces), /its side is unknown/);
});
