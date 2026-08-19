import { describe, expect, it } from "vitest";
import { canonicalRadiusMeters, parseSavedMeasurementInput } from "../../src/utilities/radius-map/lib/measurements";

const validInput = {
  name: "Toronto coverage",
  locationLabel: "Toronto, Ontario",
  center: { lat: 43.6532, lng: -79.3832 },
  value: 20,
  kind: "diameter",
  unit: "km",
  visible: true,
} as const;

describe("saved measurement validation", () => {
  it("normalizes and validates a saved measurement", () => {
    const parsed = parseSavedMeasurementInput(validInput);
    expect(parsed).not.toBeTypeOf("string");
    expect(canonicalRadiusMeters(parsed as typeof validInput)).toBe(10_000);
  });

  it("rejects invalid names, coordinates, and measurements", () => {
    expect(parseSavedMeasurementInput({ ...validInput, name: "" })).toMatch(/name/i);
    expect(parseSavedMeasurementInput({ ...validInput, center: { lat: 91, lng: 0 } })).toMatch(/latitude/i);
    expect(parseSavedMeasurementInput({ ...validInput, value: 0 })).toMatch(/greater than zero/i);
    expect(parseSavedMeasurementInput({ ...validInput, visible: "yes" })).toMatch(/visible/i);
  });
});
