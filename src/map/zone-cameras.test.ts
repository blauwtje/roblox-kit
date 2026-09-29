import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { zoneCameras, zoneShot, type Bounds } from "./zone-cameras.ts";

const room: Bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 12, z: 30 } };
const degrees = (radians: number): number => (radians * 180) / Math.PI;

function corners(bounds: Bounds): [number, number, number][] {
  const { min, max } = bounds;
  return [min.x, max.x].flatMap((x) =>
    [min.y, max.y].flatMap((y) => [min.z, max.z].map((z): [number, number, number] => [x, y, z])),
  );
}

await test("the camera looks at the zone center from the configured pitch", () => {
  const shot = zoneShot({ name: "start", bounds: room });
  assert.equal(shot.zone, "start");
  assert.deepEqual(shot.lookAt, [20, 6, 15]);
  const [cameraX, cameraY, cameraZ] = shot.cameraPosition;
  assert.equal(cameraX, 20);
  const pitch = degrees(Math.atan2(cameraY - 6, cameraZ - 15));
  assert.ok(Math.abs(pitch - config.zoneShotPitchDegrees) < 0.05, `pitch was ${String(pitch)}`);
});

await test("every corner of the zone lies inside the field of view, and the zone fills it", () => {
  const shot = zoneShot({ name: "start", bounds: room });
  const axis = shot.lookAt.map((value, index) => value - (shot.cameraPosition[index] ?? 0));
  const axisLength = Math.hypot(...axis);
  const halfFieldOfView = config.studioFieldOfViewDegrees / 2;
  const angles = corners(room).map(([x, y, z]) => {
    const toCorner = [
      x - shot.cameraPosition[0],
      y - shot.cameraPosition[1],
      z - shot.cameraPosition[2],
    ];
    const dot = toCorner.reduce((sum, value, index) => sum + value * (axis[index] ?? 0), 0);
    return degrees(Math.acos(dot / (Math.hypot(...toCorner) * axisLength)));
  });
  for (const angle of angles) {
    assert.ok(angle <= halfFieldOfView, `corner at ${String(angle)} degrees is outside the view`);
  }
  assert.ok(Math.max(...angles) > halfFieldOfView * 0.7, "the zone should fill most of the view");
});

await test("a larger zone gets a camera farther away, and shots follow the input order", () => {
  const big: Bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 200, y: 12, z: 200 } };
  const [first, second] = zoneCameras([
    { name: "hall", bounds: big },
    { name: "closet", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 12, z: 10 } } },
  ]);
  assert.deepEqual([first?.zone, second?.zone], ["hall", "closet"]);
  const heightAbove = (shot: typeof first) =>
    (shot?.cameraPosition[1] ?? 0) - (shot?.lookAt[1] ?? 0);
  assert.ok(heightAbove(first) > heightAbove(second));
});

await test("coordinates are rounded to hundredths of a stud", () => {
  const shot = zoneShot({
    name: "odd",
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 7, y: 3, z: 5 } },
  });
  for (const value of [...shot.cameraPosition, ...shot.lookAt]) {
    assert.equal(value, Math.round(value * 100) / 100);
  }
});
