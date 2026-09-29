import { config } from "../config.ts";

export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface ZoneBounds {
  name: string;
  bounds: Bounds;
}

/** One screenshot: the camera stands at `cameraPosition` and looks at `lookAt`, both in studs. */
export interface ZoneShot {
  zone: string;
  cameraPosition: [number, number, number];
  lookAt: [number, number, number];
}

function roundCoordinate(value: number): number {
  const factor = 10 ** config.cameraCoordinateDecimals;
  return Math.round(value * factor) / factor;
}

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export type ShotView = "a" | "b" | "top";

/** A zone shot tagged with the view it takes: `a` and `b` look from opposite sides, `top` from above. */
export interface ViewedZoneShot extends ZoneShot {
  view: ShotView;
}

/**
 * The top view pitches to just short of straight down: a camera looking exactly along the world up
 * axis has no defined roll in Studio. Lift it to 90 only with an explicit up vector in the capture call.
 */
const topViewPitchDegrees = 89;

/**
 * The shot that frames one zone. The camera looks at the center of the zone's bounds from the
 * `side` (+1 for +Z, -1 for -Z), pitched down by `pitchDegrees`, at the distance where the bounding
 * sphere of the zone just fits Studio's field of view (a vertical angle, so wider windows only add margin).
 */
function framedShot(zone: ZoneBounds, side: 1 | -1, pitchDegrees: number): ZoneShot {
  const { min, max } = zone.bounds;
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const radius = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2;
  const distance = radius / Math.sin(degreesToRadians(config.studioFieldOfViewDegrees) / 2);
  const pitch = degreesToRadians(pitchDegrees);
  return {
    zone: zone.name,
    cameraPosition: [
      roundCoordinate(center.x),
      roundCoordinate(center.y + distance * Math.sin(pitch)),
      roundCoordinate(center.z + side * distance * Math.cos(pitch)),
    ],
    lookAt: [roundCoordinate(center.x), roundCoordinate(center.y), roundCoordinate(center.z)],
  };
}

/** The single angled shot of one zone, from the +Z side at `config.zoneShotPitchDegrees`. */
export function zoneShot(zone: ZoneBounds): ZoneShot {
  return framedShot(zone, 1, config.zoneShotPitchDegrees);
}

/** The three shots of one zone in order: view `a` from +Z, view `b` from -Z, then the `top` cutaway. */
export function zoneShots(zone: ZoneBounds): ViewedZoneShot[] {
  return [
    { ...framedShot(zone, 1, config.zoneShotPitchDegrees), view: "a" },
    { ...framedShot(zone, -1, config.zoneShotPitchDegrees), view: "b" },
    { ...framedShot(zone, 1, topViewPitchDegrees), view: "top" },
  ];
}
