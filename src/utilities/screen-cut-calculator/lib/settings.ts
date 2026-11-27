import type { MeasurementUnit } from "./calculator";

/** Settings the calculator remembers on this device between visits. */
export interface ScreenCutSettings {
  unit: MeasurementUnit;
  /** A preset clearance in mm as the select's value ("0" to "3"), or "custom". */
  clearance: string;
  customClearanceMm: number;
  /** The rounding select's value: "0" (exact), "0.5" or "1". */
  rounding: string;
  cornerExtensionPerEndMm: number;
}

export const SETTINGS_STORAGE_KEY = "austingarrod.utilities.screen-cut-calculator.settings.v1";

export const DEFAULT_SETTINGS: Readonly<ScreenCutSettings> = Object.freeze({
  unit: "mm",
  clearance: "2",
  customClearanceMm: 2,
  rounding: "1",
  cornerExtensionPerEndMm: 19.05,
});

const CLEARANCE_CHOICES = ["0", "1", "2", "3", "custom"];
const ROUNDING_CHOICES = ["0", "0.5", "1"];

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Reads stored settings, keeping each valid value and falling back to the
 * default for anything missing or malformed.
 */
export function parseSettings(stored: unknown): ScreenCutSettings {
  const settings: ScreenCutSettings = { ...DEFAULT_SETTINGS };
  if (typeof stored !== "object" || stored === null) return settings;
  const value = stored as Record<string, unknown>;

  if (value.unit === "mm" || value.unit === "cm") settings.unit = value.unit;
  if (typeof value.clearance === "string" && CLEARANCE_CHOICES.includes(value.clearance)) {
    settings.clearance = value.clearance;
  }
  if (nonNegative(value.customClearanceMm)) settings.customClearanceMm = value.customClearanceMm;
  if (typeof value.rounding === "string" && ROUNDING_CHOICES.includes(value.rounding)) {
    settings.rounding = value.rounding;
  }
  if (nonNegative(value.cornerExtensionPerEndMm)) {
    settings.cornerExtensionPerEndMm = value.cornerExtensionPerEndMm;
  }
  return settings;
}
