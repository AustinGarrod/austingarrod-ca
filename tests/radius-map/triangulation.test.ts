import { describe, expect, it } from "vitest";
import { measurementToRadiusMeters, type Coordinates } from "../../src/utilities/radius-map/lib/distance";
import {
  EARTH_RADIUS_METERS,
  greatCircleDistanceMeters,
  triangulateBestFit,
  type TriangulationInput,
} from "../../src/utilities/radius-map/lib/triangulation";

function destination(origin: Coordinates, bearingDegrees: number, distanceMeters: number): Coordinates {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = bearingDegrees * Math.PI / 180;
  const latitude = origin.lat * Math.PI / 180;
  const longitude = origin.lng * Math.PI / 180;
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
  );
  return {
    lat: nextLatitude * 180 / Math.PI,
    lng: ((nextLongitude * 180 / Math.PI + 540) % 360) - 180,
  };
}

function exactInputs(target: Coordinates): TriangulationInput[] {
  return [
    { id: "north", center: destination(target, 5, 12_000), radiusMeters: 12_000 },
    { id: "south-east", center: destination(target, 125, 21_000), radiusMeters: 21_000 },
    { id: "south-west", center: destination(target, 245, 16_000), radiusMeters: 16_000 },
  ];
}

describe("best-fit triangulation", () => {
  it("recovers an exact point from three geodesic measurements", () => {
    const target = { lat: 43.6532, lng: -79.3832 };
    const result = triangulateBestFit(exactInputs(target));

    expect(result).not.toBeNull();
    expect(greatCircleDistanceMeters(result!.center, target)).toBeLessThan(2);
    expect(result!.rmsErrorMeters).toBeLessThan(2);
    expect(result!.inputCount).toBe(3);
  });

  it("returns a useful best-fit point for inconsistent measurements", () => {
    const target = { lat: 45.4215, lng: -75.6972 };
    const inputs = exactInputs(target).map((input, index) => ({
      ...input,
      radiusMeters: input.radiusMeters + [-180, 120, 260][index],
    }));
    const result = triangulateBestFit(inputs);

    expect(result).not.toBeNull();
    expect(greatCircleDistanceMeters(result!.center, target)).toBeLessThan(500);
    expect(result!.rmsErrorMeters).toBeGreaterThan(0);
    expect(result!.rmsErrorMeters).toBeLessThan(500);
  });

  it("works across the antimeridian and with normalized diameter input", () => {
    const target = { lat: 11.2, lng: 179.92 };
    const inputs = exactInputs(target);
    inputs[0].radiusMeters = measurementToRadiusMeters(24, "diameter", "km");
    const result = triangulateBestFit(inputs);

    expect(result).not.toBeNull();
    expect(greatCircleDistanceMeters(result!.center, target)).toBeLessThan(3);
    expect(result!.center.lng).toBeGreaterThanOrEqual(-180);
    expect(result!.center.lng).toBeLessThan(180);
  });

  it("rejects fewer than three distinct centres", () => {
    const repeated = { lat: 43.65, lng: -79.38 };
    expect(triangulateBestFit([
      { id: "one", center: repeated, radiusMeters: 1_000 },
      { id: "two", center: repeated, radiusMeters: 2_000 },
      { id: "three", center: { lat: 44, lng: -79 }, radiusMeters: 3_000 },
    ])).toBeNull();
  });
});
