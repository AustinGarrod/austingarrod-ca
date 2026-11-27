import { describe, expect, it } from "vitest";
import {
  convertDisplayedMeasurement,
  coordinateInputError,
  formatDerived,
  measurementDetails,
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

  it("explains out-of-range coordinate pairs instead of treating them as a place search", () => {
    expect(coordinateInputError("95, 200")).toMatch(/Latitude must be between -90 and 90/);
    expect(coordinateInputError("43.65, -181")).toMatch(/longitude between -180 and 180/);
    expect(coordinateInputError("43.65, -79.38")).toBeNull();
    expect(coordinateInputError("Toronto")).toBeNull();
    expect(coordinateInputError("10 Downing Street")).toBeNull();
  });
});

describe("derived measurement details", () => {
  it("formats derived values with at most two decimals", () => {
    expect(formatDerived(15.534279)).toBe("15.53");
    expect(formatDerived(1963.495)).toBe("1,963.5");
    expect(formatDerived(40)).toBe("40");
    expect(formatDerived(0.004)).toBe("< 0.01");
    expect(formatDerived(Number.NaN)).toBe("—");
  });

  it("gives the other unit, the other kind and the area without changing the typed value", () => {
    const details = measurementDetails(25, "radius", "mi");
    expect(details.converted.unit).toBe("km");
    expect(details.converted.value).toBeCloseTo(40.2336, 4);
    expect(details.counterpart).toEqual({ value: 50, kind: "diameter" });
    expect(details.area).toBeCloseTo(Math.PI * 625, 6);
    expect(measurementDetails(20, "diameter", "km").counterpart).toEqual({ value: 10, kind: "radius" });
    expect(measurementDetails(20, "diameter", "km").area).toBeCloseTo(Math.PI * 100, 6);
  });
});
