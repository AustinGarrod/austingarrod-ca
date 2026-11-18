import { describe, expect, it } from "vitest";
import {
  mergeLibraries, readMeasurementsDocument, requireDocumentFits, toMeasurementsDocument, toSavedMeasurements,
  type AccountMeasurement, type MeasurementChoice, type MeasurementsDocument,
} from "../../src/utilities/radius-map/lib/account-measurements";
import { redactReporting } from "../../src/reporting/privacy";

const timestamp = "2026-11-18T10:00:00.000Z";
const point = (id: string, name = id): AccountMeasurement => ({
  id, name, locationLabel: "Fixture", center: { lat: 43.651073, lng: -79.347015 }, kind: "diameter",
  value: 4, unit: "mi", visible: true, createdAt: timestamp, updatedAt: timestamp,
});
const library = (...measurements: AccountMeasurement[]): MeasurementsDocument => ({ version: 1, measurements });

describe("Radius Map account documents", () => {
  it("round trips exact centres, distances and visibility while deriving the drawn radius", () => {
    const original = library({ ...point("a"), visible: false });
    const saved = toSavedMeasurements(original);
    expect(saved[0].radiusMeters).toBe(3218.688);
    expect(toMeasurementsDocument(saved)).toEqual(original);
    expect(() => readMeasurementsDocument(library(point("a"), point("a")))).toThrow("unsupported format");
    expect(() => readMeasurementsDocument(library({ ...point("a"), createdAt: "2026-02-30T10:00:00.000Z" }))).toThrow("unsupported format");
    expect(() => readMeasurementsDocument(library({ ...point("a"), center: { lat: 91, lng: 0 } }))).toThrow("unsupported format");
    expect(() => requireDocumentFits(library(...Array.from({ length: 6_000 }, (_, i) => ({
      ...point(String(i)), locationLabel: "é".repeat(240),
    }))))).toThrow("4 MiB");
  });

  it("combines different first saves from two devices sharing an empty account library", () => {
    expect(mergeLibraries(library(), library(point("a")), library(point("b")))).toEqual({
      document: library(point("a"), point("b")),
      conflicts: [],
    });
  });

  it("merges independent changes and detects competing edits and measurement deletions", () => {
    const a = point("a"), b = point("b"), c = point("c"), d = point("d"), e = point("e"), f = point("f");
    const local = library({ ...a, visible: false }, b, { ...d, name: "Browser" }, e, point("g"));
    const remote = library(a, { ...b, value: 2 }, { ...c, name: "Account" }, { ...d, name: "Account" }, point("h"));
    const base = library(a, b, c, d, e, f);
    expect(mergeLibraries(base, local, remote).conflicts).toEqual([
      { id: "c", browser: undefined, account: { ...c, name: "Account" } },
      { id: "d", browser: { ...d, name: "Browser" }, account: { ...d, name: "Account" } },
    ]);
    const choices = new Map<string, MeasurementChoice>([["c", "browser"], ["d", "account"]]);
    expect(mergeLibraries(base, local, remote, choices)).toEqual({
      conflicts: [],
      document: library({ ...a, visible: false }, { ...b, value: 2 }, { ...d, name: "Account" }, point("g"), point("h")),
    });
  });

  it("redacts sync data and tile coordinates in diagnostics", () => {
    const data = library(point("a", "Private point"));
    expect(redactReporting({ url: "/api/v1/sync.php?action=read", data })).toEqual({ url: "/api/v1/sync.php", data: "[private]" });
    expect(redactReporting(JSON.stringify(data))).toBe("[private measurement data]");
    expect(redactReporting("https://tile.openstreetmap.org/8/123/43.png")).toBe("https://tile.openstreetmap.org");
  });
});
