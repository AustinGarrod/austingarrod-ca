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

export function parseCoordinateInput(value: string): Coordinates | null {
  const match = value
    .trim()
    .match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);

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

export function formatMeasurement(value: number): string {
  return Number(value.toPrecision(8)).toString();
}
