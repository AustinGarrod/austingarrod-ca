export type DistanceUnit = "km" | "mi";
export type MeasurementKind = "radius" | "diameter";

export interface Coordinates {
  lat: number;
  lng: number;
}

export const METERS_PER_KILOMETRE = 1_000;
export const METERS_PER_MILE = 1_609.344;
export const MAX_RADIUS_METERS = 20_000_000;

export function measurementToRadiusMeters(
  value: number,
  kind: MeasurementKind,
  unit: DistanceUnit,
): number {
  const unitInMeters = unit === "km" ? METERS_PER_KILOMETRE : METERS_PER_MILE;
  const measurementMeters = value * unitInMeters;
  return kind === "diameter" ? measurementMeters / 2 : measurementMeters;
}

export function radiusMetersToMeasurement(
  radiusMeters: number,
  kind: MeasurementKind,
  unit: DistanceUnit,
): number {
  const unitInMeters = unit === "km" ? METERS_PER_KILOMETRE : METERS_PER_MILE;
  const measurementMeters = kind === "diameter" ? radiusMeters * 2 : radiusMeters;
  return measurementMeters / unitInMeters;
}

export function convertDisplayedMeasurement(
  value: number,
  fromKind: MeasurementKind,
  fromUnit: DistanceUnit,
  toKind: MeasurementKind,
  toUnit: DistanceUnit,
): number {
  return radiusMetersToMeasurement(
    measurementToRadiusMeters(value, fromKind, fromUnit),
    toKind,
    toUnit,
  );
}

export function validateMeasurement(
  value: number,
  kind: MeasurementKind,
  unit: DistanceUnit,
): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return "Enter a number greater than zero.";
  }

  if (measurementToRadiusMeters(value, kind, unit) > MAX_RADIUS_METERS) {
    return "That circle is larger than the maximum 20,000 km radius.";
  }

  return null;
}

const COORDINATE_PATTERN = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/;

export function parseCoordinateInput(value: string): Coordinates | null {
  const match = value.trim().match(COORDINATE_PATTERN);

  if (!match) {
    return null;
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return { lat, lng };
}

/**
 * Input that is clearly a latitude and longitude pair but out of range is a
 * typing mistake, not a place name, so it should not be sent to the geocoder.
 */
export function coordinateInputError(value: string): string | null {
  const match = value.trim().match(COORDINATE_PATTERN);
  if (!match || parseCoordinateInput(value)) return null;
  return "Latitude must be between -90 and 90 and longitude between -180 and 180.";
}

export function formatMeasurement(value: number): string {
  return Number(value.toPrecision(8)).toString();
}

const twoDecimals = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

/** A derived value for display: thousands separators and at most two decimals. */
export function formatDerived(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.01) return "< 0.01";
  return twoDecimals.format(value);
}

export interface MeasurementDetails {
  /** The same distance in the other unit. */
  converted: { value: number; unit: DistanceUnit };
  /** The other measurement kind in the chosen unit: the diameter for a radius and the reverse. */
  counterpart: { value: number; kind: MeasurementKind };
  /** Area of the circle in square units of the chosen unit. */
  area: number;
}

export function measurementDetails(value: number, kind: MeasurementKind, unit: DistanceUnit): MeasurementDetails {
  const otherUnit: DistanceUnit = unit === "km" ? "mi" : "km";
  const otherKind: MeasurementKind = kind === "radius" ? "diameter" : "radius";
  const radius = kind === "radius" ? value : value / 2;
  return {
    converted: { value: convertDisplayedMeasurement(value, kind, unit, kind, otherUnit), unit: otherUnit },
    counterpart: { value: kind === "radius" ? value * 2 : value / 2, kind: otherKind },
    area: Math.PI * radius * radius,
  };
}
