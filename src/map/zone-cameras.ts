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

/** Decimals kept in a camera coordinate; a hundredth of a stud is far below a pixel. */
const COORDINATE_DECIMALS = 2;

function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The shot that frames one zone. The camera looks at the center of the zone's bounds from the +Z
 * side, pitched down by `config.zoneShotPitchDegrees`, at the distance where the bounding sphere
 * of the zone just fits Studio's field of view (a vertical angle, so wider windows only add margin).
 */
export function zoneShot(zone: ZoneBounds): ZoneShot {
  const { min, max } = zone.bounds;
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const radius = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2;
  const distance = radius / Math.sin(degreesToRadians(config.studioFieldOfViewDegrees) / 2);
  const pitch = degreesToRadians(config.zoneShotPitchDegrees);
  return {
    zone: zone.name,
    cameraPosition: [
      roundCoordinate(center.x),
      roundCoordinate(center.y + distance * Math.sin(pitch)),
      roundCoordinate(center.z + distance * Math.cos(pitch)),
    ],
    lookAt: [roundCoordinate(center.x), roundCoordinate(center.y), roundCoordinate(center.z)],
  };
}

/** One shot per zone, in the order given. */
export function zoneCameras(zones: readonly ZoneBounds[]): ZoneShot[] {
  return zones.map(zoneShot);
}
