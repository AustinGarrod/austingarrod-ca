import {
  canonicalRadiusMeters,
  parseSavedMeasurementInput,
  type SavedMeasurement,
  type SavedMeasurementInput,
} from "./measurements";

export const RADIUS_MAP_STORAGE_KEY = "austingarrod.utilities.radius-map.v1";
const STORAGE_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredDocument {
  version: typeof STORAGE_VERSION;
  measurements: SavedMeasurement[];
}

export interface MeasurementLoadResult {
  measurements: SavedMeasurement[];
  warning: string | null;
}

export class LocalMeasurementStorageError extends Error {
  constructor(message = "This browser could not save measurements on this device.") {
    super(message);
    this.name = "LocalMeasurementStorageError";
  }
}

interface StoreDependencies {
  now?: () => Date;
  randomUUID?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseStoredMeasurement(value: unknown): SavedMeasurement | null {
  if (!isRecord(value)) return null;
  const parsed = parseSavedMeasurementInput(value);
  if (typeof parsed === "string") return null;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) return null;
  if (!validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt)) return null;

  return {
    ...parsed,
    id: value.id,
    radiusMeters: canonicalRadiusMeters(parsed),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function defaultRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export class LocalMeasurementsStore {
  private readonly now: () => Date;
  private readonly randomUUID: () => string;

  constructor(
    private readonly storage: StorageLike,
    dependencies: StoreDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.randomUUID = dependencies.randomUUID ?? defaultRandomUUID;
  }

  load(): MeasurementLoadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(RADIUS_MAP_STORAGE_KEY);
    } catch {
      throw new LocalMeasurementStorageError("This browser is blocking access to saved measurements.");
    }
    if (!raw) return { measurements: [], warning: null };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return {
        measurements: [],
        warning: "Saved data on this device is damaged. A new save will start a fresh library.",
      };
    }

    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.measurements)) {
      return {
        measurements: [],
        warning: "Saved data on this device uses an unsupported format. A new save will start a fresh library.",
      };
    }

    const unique = new Map<string, SavedMeasurement>();
    let skipped = 0;
    for (const value of parsed.measurements) {
      const measurement = parseStoredMeasurement(value);
      if (!measurement || unique.has(measurement.id)) {
        skipped += 1;
        continue;
      }
      unique.set(measurement.id, measurement);
    }
    const measurements = [...unique.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      measurements,
      warning: skipped > 0 ? `${skipped} damaged saved ${skipped === 1 ? "measurement was" : "measurements were"} ignored.` : null,
    };
  }

  create(input: SavedMeasurementInput): SavedMeasurement {
    const timestamp = this.now().toISOString();
    const measurement: SavedMeasurement = {
      ...input,
      id: this.randomUUID(),
      radiusMeters: canonicalRadiusMeters(input),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const current = this.load().measurements;
    this.write([measurement, ...current]);
    return measurement;
  }

  update(id: string, input: SavedMeasurementInput): SavedMeasurement | null {
    const current = this.load().measurements;
    const existing = current.find((measurement) => measurement.id === id);
    if (!existing) return null;
    const updated: SavedMeasurement = {
      ...input,
      id,
      radiusMeters: canonicalRadiusMeters(input),
      createdAt: existing.createdAt,
      updatedAt: this.now().toISOString(),
    };
    this.write(current.map((measurement) => measurement.id === id ? updated : measurement));
    return updated;
  }

  setVisibility(id: string, visible: boolean): SavedMeasurement | null {
    const existing = this.load().measurements.find((measurement) => measurement.id === id);
    return existing ? this.update(id, { ...existing, visible }) : null;
  }

  delete(id: string): boolean {
    const current = this.load().measurements;
    const remaining = current.filter((measurement) => measurement.id !== id);
    if (remaining.length === current.length) return false;
    this.write(remaining);
    return true;
  }

  private write(measurements: SavedMeasurement[]): void {
    const document: StoredDocument = {
      version: STORAGE_VERSION,
      measurements: [...measurements].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
    try {
      this.storage.setItem(RADIUS_MAP_STORAGE_KEY, JSON.stringify(document));
    } catch {
      throw new LocalMeasurementStorageError();
    }
  }
}
