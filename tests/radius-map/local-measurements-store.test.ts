import { describe, expect, it } from "vitest";
import {
  LocalMeasurementStorageError,
  LocalMeasurementsStore,
  RADIUS_MAP_STORAGE_KEY,
  type StorageLike,
} from "../../src/utilities/radius-map/lib/local-measurements-store";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error("storage blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

const validInput = {
  name: "Toronto coverage",
  locationLabel: "Toronto, Ontario",
  center: { lat: 43.6532, lng: -79.3832 },
  value: 10,
  kind: "radius",
  unit: "km",
  visible: true,
} as const;

describe("local Radius Map measurement storage", () => {
  it("creates, updates, toggles, reloads, and deletes measurements", () => {
    const storage = new MemoryStorage();
    let timestamp = Date.parse("2026-08-19T12:00:00.000Z");
    const store = new LocalMeasurementsStore(storage, {
      now: () => new Date(timestamp += 1000),
      randomUUID: () => "measurement-1",
    });

    const created = store.create(validInput);
    expect(created.radiusMeters).toBe(10_000);
    expect(store.load().measurements).toEqual([created]);

    const renamed = store.update(created.id, { ...created, name: "Updated coverage" });
    expect(renamed?.name).toBe("Updated coverage");
    expect(renamed?.createdAt).toBe(created.createdAt);
    expect(renamed?.updatedAt).not.toBe(created.updatedAt);

    expect(store.setVisibility(created.id, false)?.visible).toBe(false);
    expect(store.delete(created.id)).toBe(true);
    expect(store.load().measurements).toEqual([]);
  });

  it("recovers safely from corrupt documents and invalid rows", () => {
    const storage = new MemoryStorage();
    storage.values.set(RADIUS_MAP_STORAGE_KEY, "not json");
    const store = new LocalMeasurementsStore(storage);

    expect(store.load()).toMatchObject({ measurements: [], warning: expect.stringMatching(/damaged/i) });

    storage.values.set(RADIUS_MAP_STORAGE_KEY, JSON.stringify({
      version: 1,
      measurements: [{ id: "broken" }],
    }));
    expect(store.load()).toMatchObject({ measurements: [], warning: expect.stringMatching(/ignored/i) });
  });

  it("reports storage quota failures without losing the live draft", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const store = new LocalMeasurementsStore(storage, { randomUUID: () => "measurement-1" });

    expect(() => store.create(validInput)).toThrow(LocalMeasurementStorageError);
    expect(store.load().measurements).toEqual([]);
  });

  it("reports when browser storage is unavailable", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    const store = new LocalMeasurementsStore(storage);

    expect(() => store.load()).toThrow("This browser is blocking access to saved measurements.");
  });
});
