export type MeasurementUnit = "mm" | "cm";
export type RoundingIncrementMm = 0 | 0.5 | 1;

export type CalculatorField =
  | "openingWidth"
  | "openingHeight"
  | "clearanceMm"
  | "cornerExtensionPerEndMm"
  | "roundingIncrementMm";

export interface CalculatorInput {
  openingWidth: number;
  openingHeight: number;
  unit: MeasurementUnit;
  clearanceMm: number;
  cornerExtensionPerEndMm: number;
  roundingIncrementMm: RoundingIncrementMm;
}

export interface CalculationError {
  /** The field the error is shown under. */
  field: CalculatorField;
  message: string;
  /** Other fields whose value caused the error. Editing them should not raise it mid-entry. */
  relatedFields?: CalculatorField[];
}

export interface DimensionPair {
  width: number;
  height: number;
}

export interface CutMeasurement {
  exactMm: number;
  practicalMm: number;
}

export interface FrameCutCalculation {
  openingMm: DimensionPair;
  /** Opening minus total clearance: the frame size the cuts aim for. */
  finishedMm: DimensionPair;
  /** The frame the rounded cuts actually make: rounded cut plus total corner allowance. */
  builtFrameMm: DimensionPair;
  clearanceMm: number;
  cornerExtensionPerEndMm: number;
  totalCornerAllowanceMm: number;
  roundingIncrementMm: RoundingIncrementMm;
  horizontal: CutMeasurement;
  vertical: CutMeasurement;
}

export type CalculationResult =
  | { ok: true; value: FrameCutCalculation }
  | { ok: false; errors: CalculationError[] };

const VALID_ROUNDING_INCREMENTS: RoundingIncrementMm[] = [0, 0.5, 1];

function cleanFloatingPoint(value: number): number {
  const cleaned = Number(value.toFixed(10));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

export function toMillimetres(value: number, unit: MeasurementUnit): number {
  return cleanFloatingPoint(unit === "cm" ? value * 10 : value);
}

export function convertMeasurement(
  value: number,
  fromUnit: MeasurementUnit,
  toUnit: MeasurementUnit,
): number {
  if (!Number.isFinite(value) || fromUnit === toUnit) return value;
  return cleanFloatingPoint(toUnit === "mm" ? value * 10 : value / 10);
}

export function roundToIncrement(value: number, incrementMm: RoundingIncrementMm): number {
  if (incrementMm === 0) return cleanFloatingPoint(value);
  return cleanFloatingPoint(Math.round(value / incrementMm) * incrementMm);
}

export function formatMeasurement(value: number, maximumFractionDigits = 3): string {
  if (!Number.isFinite(value)) return "";
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toLocaleString("en-CA", {
    maximumFractionDigits,
    useGrouping: false,
  });
}

export function calculateFrameCuts(input: CalculatorInput): CalculationResult {
  const errors: CalculationError[] = [];

  if (!Number.isFinite(input.openingWidth)) {
    errors.push({ field: "openingWidth", message: "Enter an opening width." });
  } else if (input.openingWidth <= 0) {
    errors.push({ field: "openingWidth", message: "Opening width must be greater than zero." });
  }

  if (!Number.isFinite(input.openingHeight)) {
    errors.push({ field: "openingHeight", message: "Enter an opening height." });
  } else if (input.openingHeight <= 0) {
    errors.push({ field: "openingHeight", message: "Opening height must be greater than zero." });
  }

  if (!Number.isFinite(input.clearanceMm)) {
    errors.push({ field: "clearanceMm", message: "Enter a total fitting clearance." });
  } else if (input.clearanceMm < 0) {
    errors.push({ field: "clearanceMm", message: "Fitting clearance cannot be negative." });
  }

  if (!Number.isFinite(input.cornerExtensionPerEndMm)) {
    errors.push({ field: "cornerExtensionPerEndMm", message: "Enter a corner extension per end." });
  } else if (input.cornerExtensionPerEndMm < 0) {
    errors.push({ field: "cornerExtensionPerEndMm", message: "Corner extension cannot be negative." });
  }

  if (!VALID_ROUNDING_INCREMENTS.includes(input.roundingIncrementMm)) {
    errors.push({ field: "roundingIncrementMm", message: "Choose a supported rounding option." });
  }

  if (errors.length > 0) return { ok: false, errors };

  const openingMm = {
    width: toMillimetres(input.openingWidth, input.unit),
    height: toMillimetres(input.openingHeight, input.unit),
  };

  if (!Number.isFinite(openingMm.width)) {
    errors.push({ field: "openingWidth", message: "Opening width is too large." });
  }
  if (!Number.isFinite(openingMm.height)) {
    errors.push({ field: "openingHeight", message: "Opening height is too large." });
  }
  if (errors.length > 0) return { ok: false, errors };

  if (input.clearanceMm >= openingMm.width || input.clearanceMm >= openingMm.height) {
    errors.push({
      field: "clearanceMm",
      message: `Clearance must be smaller than the opening (${formatMeasurement(openingMm.width)} × ${formatMeasurement(openingMm.height)} mm).`,
      relatedFields: ["openingWidth", "openingHeight"],
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const finishedMm = {
    width: cleanFloatingPoint(openingMm.width - input.clearanceMm),
    height: cleanFloatingPoint(openingMm.height - input.clearanceMm),
  };
  const totalCornerAllowanceMm = cleanFloatingPoint(input.cornerExtensionPerEndMm * 2);
  const horizontalExactMm = cleanFloatingPoint(finishedMm.width - totalCornerAllowanceMm);
  const verticalExactMm = cleanFloatingPoint(finishedMm.height - totalCornerAllowanceMm);

  // The opening is what the user can see and change, so a cut that the corner
  // allowance would use up is reported against the dimension, not the hidden setting.
  const allowance = `${formatMeasurement(totalCornerAllowanceMm)} mm`;
  if (horizontalExactMm <= 0) {
    errors.push({
      field: "openingWidth",
      message: `Opening width is too small for the ${allowance} corner allowance.`,
      relatedFields: ["clearanceMm", "cornerExtensionPerEndMm"],
    });
  }
  if (verticalExactMm <= 0) {
    errors.push({
      field: "openingHeight",
      message: `Opening height is too small for the ${allowance} corner allowance.`,
      relatedFields: ["clearanceMm", "cornerExtensionPerEndMm"],
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const horizontalPracticalMm = roundToIncrement(horizontalExactMm, input.roundingIncrementMm);
  const verticalPracticalMm = roundToIncrement(verticalExactMm, input.roundingIncrementMm);

  return {
    ok: true,
    value: {
      openingMm,
      finishedMm,
      builtFrameMm: {
        width: cleanFloatingPoint(horizontalPracticalMm + totalCornerAllowanceMm),
        height: cleanFloatingPoint(verticalPracticalMm + totalCornerAllowanceMm),
      },
      clearanceMm: cleanFloatingPoint(input.clearanceMm),
      cornerExtensionPerEndMm: cleanFloatingPoint(input.cornerExtensionPerEndMm),
      totalCornerAllowanceMm,
      roundingIncrementMm: input.roundingIncrementMm,
      horizontal: {
        exactMm: horizontalExactMm,
        practicalMm: horizontalPracticalMm,
      },
      vertical: {
        exactMm: verticalExactMm,
        practicalMm: verticalPracticalMm,
      },
    },
  };
}

/** A length in the chosen unit, for display: "777 mm" or "77.7 cm". */
export function formatLength(valueMm: number, unit: MeasurementUnit): string {
  return `${formatMeasurement(convertMeasurement(valueMm, "mm", unit))} ${unit}`;
}

/** Plain-text cut list for the clipboard, one line per item. */
export function cutListText(result: FrameCutCalculation, unit: MeasurementUnit): string {
  const opening = `${formatMeasurement(convertMeasurement(result.openingMm.width, "mm", unit))} × ${formatLength(result.openingMm.height, unit)}`;
  return [
    `Top and bottom: 2 × ${formatLength(result.horizontal.practicalMm, unit)}`,
    `Left and right: 2 × ${formatLength(result.vertical.practicalMm, unit)}`,
    `Opening ${opening}, clearance ${formatMeasurement(result.clearanceMm)} mm, corner allowance ${formatMeasurement(result.totalCornerAllowanceMm)} mm`,
  ].join("\n");
}
