import { config } from "../config.ts";
import type { PartRecord } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import type { DetailSurfaces } from "./room-details.ts";

type Side = RoomSpec["doors"][number]["side"];

/**
 * One decorative box on the outer face of a wall of an exterior room. Like a detail part it never collides,
 * fires touch events or answers spatial queries, so it cannot block a player or change what `check_map` measures.
 */
export interface FacadePart extends Omit<PartRecord, "kind" | "role"> {
  kind: "facade";
  role: "trim" | "accent";
  canCollide: false;
  canTouch: false;
  canQuery: false;
}

/** Sizes and defaults of the facade grammar, in studs, until they move to `config`. */
export const facadeDimensions = Object.freeze({
  /** Storeys of an exterior room that sets no `facadeFloors`. */
  defaultFloors: 2,
  /** A window every bay; a wall stretch fits as many whole bays as it can and centers them. */
  bayWidthStuds: 6,
  windowWidthStuds: 3,
  /** Window height and sill height, as fractions of a storey's height. */
  windowHeightFraction: 0.4,
  sillHeightFraction: 0.35,
  frameBorderStuds: 0.4,
  frameDepthStuds: 0.3,
  /** The pane stands out of the frame so the two faces are never coplanar. */
  paneDepthStuds: 0.4,
  /** A band over the wall between two storeys. */
  bandHeightStuds: 0.6,
  bandDepthStuds: 0.4,
  /** The cornice that caps the wall. */
  corniceHeightStuds: 1,
  corniceDepthStuds: 0.9,
  paneColor: "#1d2733",
  paneMaterial: "Glass",
});

/** A wall stretch's outer face: where it stands, which way it runs and which way out of the building is. */
interface OuterFace {
  runsAlongX: boolean;
  /** +1 or -1 along the axis across the wall. */
  outward: number;
  /** Center of the stretch along the wall, and of the outer face across it. */
  along: number;
  across: number;
  length: number;
}

function sideOfWall(wall: PartRecord): Side {
  const label = wall.name.slice(wall.room.length + config.wallNameInfix.length);
  const side = label.split("-")[0];
  if (side === "north" || side === "south" || side === "east" || side === "west") {
    return side;
  }
  throw new Error(
    `Wall part "${wall.name}" is not named after its side, so its outer face is unknown.`,
  );
}

const outwardOfSide: Record<Side, number> = { north: -1, south: 1, west: -1, east: 1 };

function outerFaceOf(wall: PartRecord): OuterFace {
  const side = sideOfWall(wall);
  const runsAlongX = side === "north" || side === "south";
  const outward = outwardOfSide[side];
  const thickness = runsAlongX ? wall.size.z : wall.size.x;
  const across = (runsAlongX ? wall.position.z : wall.position.x) + (outward * thickness) / 2;
  return {
    runsAlongX,
    outward,
    along: runsAlongX ? wall.position.x : wall.position.z,
    across,
    length: runsAlongX ? wall.size.x : wall.size.z,
  };
}

/** A box on the outer face: `along` is its center along the wall, `height` its center above the floor, `depth` how far it stands out. */
function boxOnFace(
  face: OuterFace,
  along: number,
  height: number,
  length: number,
  verticalSize: number,
  depth: number,
) {
  const across = face.across + (face.outward * depth) / 2;
  return {
    position: {
      x: face.runsAlongX ? along : across,
      y: height,
      z: face.runsAlongX ? across : along,
    },
    size: {
      x: face.runsAlongX ? length : depth,
      y: verticalSize,
      z: face.runsAlongX ? depth : length,
    },
  };
}

function facadePart(
  fields: Pick<FacadePart, "name" | "room" | "role" | "position" | "size"> &
    Partial<Pick<FacadePart, "color" | "material">>,
  surfaces: DetailSurfaces,
): FacadePart {
  const surface = surfaces[fields.role];
  return {
    ...fields,
    kind: "facade",
    color: fields.color ?? surface.color,
    material: fields.material ?? surface.material,
    canCollide: false,
    canTouch: false,
    canQuery: false,
  };
}

/** The window rhythm of one wall stretch: the centers of the whole bays that fit, centered on the stretch. */
export function windowCenters(stretchLength: number, bayWidth: number): number[] {
  const bays = Math.floor(stretchLength / bayWidth);
  const margin = (stretchLength - bays * bayWidth) / 2;
  return Array.from(
    { length: bays },
    (_, bay) => margin + (bay + 0.5) * bayWidth - stretchLength / 2,
  );
}

function stretchParts(
  room: RoomSpec,
  wall: PartRecord,
  floors: number,
  surfaces: DetailSurfaces,
): FacadePart[] {
  const dimensions = facadeDimensions;
  const face = outerFaceOf(wall);
  const wallHeight = wall.size.y;
  const storeyHeight = wallHeight / floors;
  const label = wall.name.slice(room.name.length + config.wallNameInfix.length);
  const name = (what: string, number: number) =>
    `${room.name}-facade-${what}-${label}-${String(number)}`;
  const parts: FacadePart[] = [];

  parts.push(
    facadePart(
      {
        name: name("cornice", 1),
        room: room.name,
        role: "trim",
        ...boxOnFace(
          face,
          face.along,
          wallHeight + dimensions.corniceHeightStuds / 2,
          face.length,
          dimensions.corniceHeightStuds,
          dimensions.corniceDepthStuds,
        ),
      },
      surfaces,
    ),
  );

  for (let floor = 1; floor < floors; floor += 1) {
    parts.push(
      facadePart(
        {
          name: name("band", floor),
          room: room.name,
          role: "accent",
          ...boxOnFace(
            face,
            face.along,
            floor * storeyHeight,
            face.length,
            dimensions.bandHeightStuds,
            dimensions.bandDepthStuds,
          ),
        },
        surfaces,
      ),
    );
  }

  const windowHeight = storeyHeight * dimensions.windowHeightFraction;
  const centers = windowCenters(face.length, dimensions.bayWidthStuds);
  let number = 0;
  for (let floor = 0; floor < floors; floor += 1) {
    const centerHeight =
      floor * storeyHeight + storeyHeight * dimensions.sillHeightFraction + windowHeight / 2;
    for (const center of centers) {
      number += 1;
      const along = face.along + center;
      parts.push(
        facadePart(
          {
            name: name("frame", number),
            room: room.name,
            role: "trim",
            ...boxOnFace(
              face,
              along,
              centerHeight,
              dimensions.windowWidthStuds + 2 * dimensions.frameBorderStuds,
              windowHeight + 2 * dimensions.frameBorderStuds,
              dimensions.frameDepthStuds,
            ),
          },
          surfaces,
        ),
        facadePart(
          {
            name: name("pane", number),
            room: room.name,
            role: "accent",
            color: dimensions.paneColor,
            material: dimensions.paneMaterial,
            ...boxOnFace(
              face,
              along,
              centerHeight,
              dimensions.windowWidthStuds,
              windowHeight,
              dimensions.paneDepthStuds,
            ),
          },
          surfaces,
        ),
      );
    }
  }
  return parts;
}

/**
 * The shape grammar of an exterior room's facade, one wall stretch (a wall between door gaps) at a time: the
 * wall is split into `facadeFloors` storeys, an accent band marks each storey boundary, a window (trim frame and
 * dark pane) stands in every whole bay of every storey, and a trim cornice caps the wall. Doors keep their gaps
 * because stretches end at them. Deterministic: the same inputs give the same parts. `parts` are the parts
 * `layoutMap` returned for `spec`; rooms not marked `exterior` get nothing.
 */
export function buildFacades(
  spec: MapSpec,
  parts: PartRecord[],
  surfaces: DetailSurfaces,
): FacadePart[] {
  const facades: FacadePart[] = [];
  for (const room of spec.rooms) {
    if (room.exterior !== true) {
      continue;
    }
    const floors = room.facadeFloors ?? facadeDimensions.defaultFloors;
    for (const wall of parts) {
      if (wall.kind === "wall" && wall.room === room.name) {
        facades.push(...stretchParts(room, wall, floors, surfaces));
      }
    }
  }
  return facades;
}
