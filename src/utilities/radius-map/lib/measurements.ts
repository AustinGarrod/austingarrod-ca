import {
  measurementToRadiusMeters,
  validateMeasurement,
  type Coordinates,
  type DistanceUnit,
  type MeasurementKind,
} from "./distance";

export interface SavedMeasurementInput {
  name: string;
  locationLabel: string;
  center: Coordinates;
  value: number;
  kind: MeasurementKind;
  unit: DistanceUnit;
  visible: boolean;
}

export interface SavedMeasurement extends SavedMeasurementInput {
  id: string;
  radiusMeters: number;
  createdAt: string;
  updatedAt: string;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSavedMeasurementInput(value: unknown): SavedMeasurementInput | string {
  if (!isRecord(value)) {
    return "Enter a valid measurement.";
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const locationLabel = typeof value.locationLabel === "string" ? value.locationLabel.trim() : "";
  const center = isRecord(value.center)
    ? { lat: Number(value.center.lat), lng: Number(value.center.lng) }
    : { lat: Number.NaN, lng: Number.NaN };
  const measurementValue = Number(value.value);
  const kind = value.kind;
  const unit = value.unit;

  if (name.length === 0 || name.length > 80) {
    return "Name the measurement using 80 characters or fewer.";
  }
  if (locationLabel.length === 0 || locationLabel.length > 240) {
    return "Enter a valid location label.";
  }
  if (!Number.isFinite(center.lat) || center.lat < -90 || center.lat > 90) {
    return "Latitude must be between -90 and 90.";
  }
  if (!Number.isFinite(center.lng) || center.lng < -180 || center.lng > 180) {
    return "Longitude must be between -180 and 180.";
  }
  if (kind !== "radius" && kind !== "diameter") {
    return "Choose radius or diameter.";
  }
  if (unit !== "km" && unit !== "mi") {
    return "Choose kilometres or miles.";
  }
  const measurementError = validateMeasurement(measurementValue, kind, unit);
  if (measurementError) {
    return measurementError;
  }
  if (typeof value.visible !== "boolean") {
    return "Choose whether the measurement should be visible.";
  }

  return {
    name,
    locationLabel,
    center,
    value: measurementValue,
    kind,
    unit,
    visible: value.visible,
  };
}

export function canonicalRadiusMeters(input: SavedMeasurementInput): number {
  return measurementToRadiusMeters(input.value, input.kind, input.unit);
}
