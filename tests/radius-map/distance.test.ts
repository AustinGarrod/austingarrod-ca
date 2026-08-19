import { describe, expect, it } from "vitest";
import {
  convertDisplayedMeasurement,
  measurementToRadiusMeters,
  parseCoordinateInput,
  radiusMetersToMeasurement,
  validateMeasurement,
} from "../../src/utilities/radius-map/lib/distance";

describe("distance conversion", () => {
  it("converts kilometres and miles to radius metres", () => {
    expect(measurementToRadiusMeters(10, "radius", "km")).toBe(10_000);
    expect(measurementToRadiusMeters(10, "diameter", "km")).toBe(5_000);
    expect(measurementToRadiusMeters(1, "radius", "mi")).toBeCloseTo(1_609.344);
  });

  it("changes the circle size when the same entered value switches between radius and diameter", () => {
    const radiusMode = measurementToRadiusMeters(10, "radius", "km");
    const diameterMode = measurementToRadiusMeters(10, "diameter", "km");

    expect(radiusMode).toBe(diameterMode * 2);
  });

  it("preserves the physical radius when type and unit change", () => {
    const originalRadius = measurementToRadiusMeters(10, "radius", "km");
    const displayedMilesDiameter = convertDisplayedMeasurement(10, "radius", "km", "diameter", "mi");
    const convertedRadius = measurementToRadiusMeters(displayedMilesDiameter, "diameter", "mi");

    expect(convertedRadius).toBeCloseTo(originalRadius, 8);
    expect(radiusMetersToMeasurement(originalRadius, "diameter", "km")).toBe(20);
  });

  it("rejects non-positive and earth-scale overflow values", () => {
    expect(validateMeasurement(0, "radius", "km")).toMatch(/greater than zero/i);
    expect(validateMeasurement(40_001, "diameter", "km")).toMatch(/maximum/i);
    expect(validateMeasurement(40_000, "diameter", "km")).toBeNull();
  });
});

describe("coordinate parsing", () => {
  it("accepts decimal latitude and longitude", () => {
    expect(parseCoordinateInput("43.6532, -79.3832")).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(parseCoordinateInput(".5, +1.25")).toEqual({ lat: 0.5, lng: 1.25 });
  });

  it("rejects malformed and out-of-range coordinates", () => {
    expect(parseCoordinateInput("Toronto")).toBeNull();
    expect(parseCoordinateInput("91, -79")).toBeNull();
    expect(parseCoordinateInput("43 -79")).toBeNull();
  });
});
