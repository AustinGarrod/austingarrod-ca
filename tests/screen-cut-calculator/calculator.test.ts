import { describe, expect, it } from "vitest";
import {
  calculateFrameCuts,
  convertMeasurement,
  cutListText,
  formatLength,
  formatMeasurement,
  roundToIncrement,
  type CalculatorInput,
} from "../../src/utilities/screen-cut-calculator/lib/calculator";
import { DEFAULT_SETTINGS, parseSettings } from "../../src/utilities/screen-cut-calculator/lib/settings";

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
        builtFrameMm: { width: 815.1, height: 838.1 },
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

  it("reports clearance that is not smaller than the opening once, naming the opening", () => {
    const both = calculateFrameCuts({
      ...defaultInput,
      openingWidth: 2,
      openingHeight: 1,
      clearanceMm: 2,
    });
    expect(both).toEqual({
      ok: false,
      errors: [{
        field: "clearanceMm",
        message: "Clearance must be smaller than the opening (2 × 1 mm).",
        relatedFields: ["openingWidth", "openingHeight"],
      }],
    });

    const heightOnly = calculateFrameCuts({ ...defaultInput, openingHeight: 0.2, unit: "cm" });
    expect(heightOnly).toMatchObject({
      ok: false,
      errors: [{ field: "clearanceMm", message: expect.stringContaining("(8170 × 2 mm)") }],
    });
  });

  it("files a cut the corner allowance uses up under the opening dimension", () => {
    const result = calculateFrameCuts({
      ...defaultInput,
      openingWidth: 40.1,
      openingHeight: 35,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          field: "openingWidth",
          message: "Opening width is too small for the 38.1 mm corner allowance.",
          relatedFields: ["clearanceMm", "cornerExtensionPerEndMm"],
        },
        {
          field: "openingHeight",
          message: "Opening height is too small for the 38.1 mm corner allowance.",
          relatedFields: ["clearanceMm", "cornerExtensionPerEndMm"],
        },
      ],
    });

    const typingHeight = calculateFrameCuts({ ...defaultInput, openingHeight: 8 });
    expect(typingHeight).toMatchObject({ ok: false, errors: [{ field: "openingHeight" }] });
    if (!typingHeight.ok) expect(typingHeight.errors).toHaveLength(1);
  });
});

describe("rounded cuts and the cut list", () => {
  it("reports the frame the rounded cuts make", () => {
    const exact = calculateFrameCuts({ ...defaultInput, roundingIncrementMm: 0 });
    expect(exact.ok && exact.value.builtFrameMm).toEqual({ width: 815, height: 838 });

    const half = calculateFrameCuts({ ...defaultInput, openingWidth: 817.3, roundingIncrementMm: 0.5 });
    expect(half.ok && half.value.horizontal).toEqual({ exactMm: 777.2, practicalMm: 777 });
    expect(half.ok && half.value.builtFrameMm.width).toBe(815.1);
  });

  it("formats lengths in the chosen unit", () => {
    expect(formatLength(777, "mm")).toBe("777 mm");
    expect(formatLength(777, "cm")).toBe("77.7 cm");
    expect(formatLength(776.5, "cm")).toBe("77.65 cm");
  });

  it("writes a plain-text cut list in the chosen unit", () => {
    const result = calculateFrameCuts(defaultInput);
    if (!result.ok) throw new Error("expected a result");

    expect(cutListText(result.value, "mm")).toBe([
      "Top and bottom: 2 × 777 mm",
      "Left and right: 2 × 800 mm",
      "Opening 817 × 840 mm, clearance 2 mm, corner allowance 38.1 mm",
    ].join("\n"));
    expect(cutListText(result.value, "cm")).toBe([
      "Top and bottom: 2 × 77.7 cm",
      "Left and right: 2 × 80 cm",
      "Opening 81.7 × 84 cm, clearance 2 mm, corner allowance 38.1 mm",
    ].join("\n"));
  });
});

describe("remembered settings", () => {
  it("falls back to the defaults for missing or malformed storage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not an object")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({
      unit: "in",
      clearance: "7",
      customClearanceMm: -1,
      rounding: "2",
      cornerExtensionPerEndMm: Number.NaN,
    })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps each valid stored value", () => {
    expect(parseSettings({
      unit: "cm",
      clearance: "custom",
      customClearanceMm: 3.5,
      rounding: "0.5",
      cornerExtensionPerEndMm: 20,
    })).toEqual({
      unit: "cm",
      clearance: "custom",
      customClearanceMm: 3.5,
      rounding: "0.5",
      cornerExtensionPerEndMm: 20,
    });
    expect(parseSettings({ clearance: "3", cornerExtensionPerEndMm: 0 })).toEqual({
      ...DEFAULT_SETTINGS,
      clearance: "3",
      cornerExtensionPerEndMm: 0,
    });
  });
});
