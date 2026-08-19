import { describe, expect, it } from "vitest";
import {
  calculateFrameCuts,
  convertMeasurement,
  formatMeasurement,
  roundToIncrement,
  type CalculatorInput,
} from "../../src/utilities/screen-cut-calculator/lib/calculator";

const defaultInput: CalculatorInput = {
  openingWidth: 817,
  openingHeight: 840,
  unit: "mm",
  clearanceMm: 2,
  cornerExtensionPerEndMm: 19.05,
  roundingIncrementMm: 1,
};

describe("window screen frame cuts", () => {
  it("calculates the supplied millimetre example", () => {
    const result = calculateFrameCuts(defaultInput);

    expect(result).toEqual({
      ok: true,
      value: {
        openingMm: { width: 817, height: 840 },
        finishedMm: { width: 815, height: 838 },
        clearanceMm: 2,
        cornerExtensionPerEndMm: 19.05,
        totalCornerAllowanceMm: 38.1,
        roundingIncrementMm: 1,
        horizontal: { exactMm: 776.9, practicalMm: 777 },
        vertical: { exactMm: 799.9, practicalMm: 800 },
      },
    });
  });

  it("calculates the supplied centimetre example in millimetres", () => {
    const result = calculateFrameCuts({
      ...defaultInput,
      openingWidth: 46,
      openingHeight: 81.5,
      unit: "cm",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.openingMm).toEqual({ width: 460, height: 815 });
    expect(result.value.finishedMm).toEqual({ width: 458, height: 813 });
    expect(result.value.horizontal).toEqual({ exactMm: 419.9, practicalMm: 420 });
    expect(result.value.vertical).toEqual({ exactMm: 774.9, practicalMm: 775 });
  });

  it("supports exact, whole-millimetre, and half-millimetre cuts", () => {
    expect(roundToIncrement(776.9, 0)).toBe(776.9);
    expect(roundToIncrement(776.9, 1)).toBe(777);
    expect(roundToIncrement(776.9, 0.5)).toBe(777);
    expect(roundToIncrement(776.7, 0.5)).toBe(776.5);
  });

  it("supports custom clearance, connector extensions, and zero-extension systems", () => {
    const custom = calculateFrameCuts({
      ...defaultInput,
      clearanceMm: 3.5,
      cornerExtensionPerEndMm: 12.25,
      roundingIncrementMm: 0.5,
    });
    expect(custom.ok).toBe(true);
    if (!custom.ok) return;
    expect(custom.value.finishedMm).toEqual({ width: 813.5, height: 836.5 });
    expect(custom.value.totalCornerAllowanceMm).toBe(24.5);
    expect(custom.value.horizontal).toEqual({ exactMm: 789, practicalMm: 789 });

    const noExtension = calculateFrameCuts({
      ...defaultInput,
      cornerExtensionPerEndMm: 0,
      roundingIncrementMm: 0,
    });
    expect(noExtension.ok).toBe(true);
    if (!noExtension.ok) return;
    expect(noExtension.value.horizontal.exactMm).toBe(815);
    expect(noExtension.value.vertical.exactMm).toBe(838);
  });
});

describe("measurement conversion and formatting", () => {
  it("preserves the physical measurement when units switch", () => {
    expect(convertMeasurement(817, "mm", "cm")).toBe(81.7);
    expect(convertMeasurement(81.7, "cm", "mm")).toBe(817);
    expect(convertMeasurement(Number.NaN, "mm", "cm")).toBeNaN();
  });

  it("trims display precision without floating-point noise", () => {
    expect(formatMeasurement(776.9)).toBe("776.9");
    expect(formatMeasurement(777)).toBe("777");
    expect(formatMeasurement(19.05678)).toBe("19.057");
    expect(formatMeasurement(-0)).toBe("0");
  });
});

describe("calculator validation", () => {
  it("rejects blank, non-finite, zero, and negative opening dimensions", () => {
    const blank = calculateFrameCuts({ ...defaultInput, openingWidth: Number.NaN });
    const zero = calculateFrameCuts({ ...defaultInput, openingHeight: 0 });
    const negative = calculateFrameCuts({ ...defaultInput, openingWidth: -1 });

    expect(blank).toMatchObject({ ok: false, errors: [{ field: "openingWidth" }] });
    expect(zero).toMatchObject({ ok: false, errors: [{ field: "openingHeight" }] });
    expect(negative).toMatchObject({ ok: false, errors: [{ field: "openingWidth" }] });
  });

  it("rejects invalid allowances", () => {
    expect(calculateFrameCuts({ ...defaultInput, clearanceMm: -1 })).toMatchObject({
      ok: false,
      errors: [{ field: "clearanceMm" }],
    });
    expect(calculateFrameCuts({ ...defaultInput, cornerExtensionPerEndMm: -1 })).toMatchObject({
      ok: false,
      errors: [{ field: "cornerExtensionPerEndMm" }],
    });
  });

  it("rejects clearance equal to or greater than an opening dimension", () => {
    const result = calculateFrameCuts({
      ...defaultInput,
      openingWidth: 2,
      openingHeight: 1,
      clearanceMm: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({ field: "clearanceMm", message: expect.stringMatching(/width/i) }),
      expect.objectContaining({ field: "clearanceMm", message: expect.stringMatching(/height/i) }),
    ]);
  });

  it("rejects corner allowances that leave a zero or negative cut", () => {
    const result = calculateFrameCuts({
      ...defaultInput,
      openingWidth: 40.1,
      openingHeight: 35,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((error) => error.field === "cornerExtensionPerEndMm")).toBe(true);
  });
});
