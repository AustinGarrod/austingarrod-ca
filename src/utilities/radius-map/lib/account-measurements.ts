import { canonicalRadiusMeters, parseSavedMeasurementInput, type SavedMeasurement } from "./measurements";

export const RADIUS_ACCOUNT_APP = "radius-map";
export const RADIUS_ACCOUNT_DOCUMENT = "measurements";
export const RADIUS_DOCUMENT_LIMIT = 4 * 1024 * 1024;

export type AccountMeasurement = Omit<SavedMeasurement, "radiusMeters">;
export interface MeasurementsDocument {
  version: 1;
  measurements: AccountMeasurement[];
}
export type MeasurementChoice = "browser" | "account";
export interface MeasurementConflict {
  id: string;
  browser: AccountMeasurement | undefined;
  account: AccountMeasurement | undefined;
}

function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit
    && value.trim() === value && !/\p{Surrogate}/u.test(value);
}

function invalidLibrary(): never {
  throw new Error("The saved library uses an unsupported format. Your original measurements were kept.");
}

export function readMeasurementsDocument(value: unknown): MeasurementsDocument {
  if (!hasFields(value, ["version", "measurements"]) || value.version !== 1 || !Array.isArray(value.measurements)) invalidLibrary();
  const seen = new Set<string>();
  const measurements = value.measurements.map((item: unknown): AccountMeasurement => {
    if (!hasFields(item, ["id", "name", "locationLabel", "center", "value", "kind", "unit", "visible", "createdAt", "updatedAt"])
      || !isText(item.id, 128) || seen.has(item.id) || !isText(item.name, 80) || !isText(item.locationLabel, 240)
      || !hasFields(item.center, ["lat", "lng"]) || typeof item.center.lat !== "number"
      || typeof item.center.lng !== "number" || typeof item.value !== "number"
      || !isTimestamp(item.createdAt) || !isTimestamp(item.updatedAt)) invalidLibrary();
    const values = parseSavedMeasurementInput(item);
    if (typeof values === "string") invalidLibrary();
    seen.add(item.id);
    return { ...values, id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
  return makeDocument(measurements);
}

function makeDocument(measurements: AccountMeasurement[]): MeasurementsDocument {
  return { version: 1, measurements: measurements.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}

export function toMeasurementsDocument(measurements: SavedMeasurement[]): MeasurementsDocument {
  return readMeasurementsDocument({
    version: 1,
    measurements: measurements.map(({ radiusMeters: _radiusMeters, createdAt, updatedAt, ...values }) => ({
      ...values, createdAt: new Date(createdAt).toISOString(), updatedAt: new Date(updatedAt).toISOString(),
    })),
  });
}

export function requireDocumentFits(document: MeasurementsDocument): void {
  if (new TextEncoder().encode(JSON.stringify(document)).length > RADIUS_DOCUMENT_LIMIT) {
    throw new Error("The library exceeds the 4 MiB sync limit. Your original measurements were kept.");
  }
}

export function toSavedMeasurements(document: MeasurementsDocument): SavedMeasurement[] {
  return document.measurements.map(item => ({ ...item, center: { ...item.center }, radiusMeters: canonicalRadiusMeters(item) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function sameMeasurement(a: AccountMeasurement | undefined, b: AccountMeasurement | undefined): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.name === b.name && a.locationLabel === b.locationLabel
    && a.center.lat === b.center.lat && a.center.lng === b.center.lng
    && a.value === b.value && a.kind === b.kind && a.unit === b.unit
    && a.visible === b.visible && a.createdAt === b.createdAt;
}

export function sameLibrary(a: MeasurementsDocument, b: MeasurementsDocument): boolean {
  return a.measurements.length === b.measurements.length
    && a.measurements.every((item, index) => sameMeasurement(item, b.measurements[index]));
}

function indexLibrary(document: MeasurementsDocument): Map<string, AccountMeasurement> {
  return new Map(document.measurements.map(item => [item.id, item]));
}

export function mergeLibraries(
  base: MeasurementsDocument,
  browser: MeasurementsDocument,
  account: MeasurementsDocument,
  choices: ReadonlyMap<string, MeasurementChoice> = new Map(),
): { document: MeasurementsDocument; conflicts: MeasurementConflict[] } {
  const common = indexLibrary(base), local = indexLibrary(browser), remote = indexLibrary(account);
  const measurements: AccountMeasurement[] = [];
  const conflicts: MeasurementConflict[] = [];
  for (const id of new Set([...common.keys(), ...local.keys(), ...remote.keys()])) {
    const original = common.get(id), left = local.get(id), right = remote.get(id);
    let selected;
    if (sameMeasurement(left, right) || sameMeasurement(left, original)) selected = right;
    else if (sameMeasurement(right, original)) selected = left;
    else {
      const choice = choices.get(id);
      if (!choice) conflicts.push({ id, browser: left, account: right });
      selected = choice === "account" ? right : left;
    }
    if (selected) measurements.push(selected);
  }
  return { document: makeDocument(measurements), conflicts };
}
