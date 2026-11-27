import { describe, expect, it } from "vitest";
import { DRAFT_KEY, forgetDraft, parseDraft, readDraft, writeDraft, type RadiusDraft } from "../../src/utilities/radius-map/lib/draft";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    source: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    }),
  };
}

const draft: RadiusDraft = {
  center: { lat: 43.65, lng: -79.38 }, centerLabel: "Toronto, Ontario", value: "25", kind: "radius", unit: "mi", pendingSave: true,
};

describe("Radius Map draft", () => {
  it("keeps the unsaved circle under its own key, not the retired library key", () => {
    const storage = memoryStorage();
    writeDraft(draft, storage.source);
    expect([...storage.values.keys()]).toEqual([DRAFT_KEY]);
    expect(DRAFT_KEY).not.toBe("austingarrod.utilities.radius-map.v1");
    expect(readDraft(storage.source)).toEqual(draft);
    forgetDraft(storage.source);
    expect(readDraft(storage.source)).toBeNull();
  });

  it("survives storage that throws", () => {
    const failing = () => { throw new DOMException("Storage unavailable", "SecurityError"); };
    expect(() => writeDraft(draft, failing)).not.toThrow();
    expect(readDraft(failing)).toBeNull();
    expect(() => forgetDraft(failing)).not.toThrow();
  });

  it("rejects malformed or out-of-range drafts", () => {
    expect(parseDraft("not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, kind: "area" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, unit: "m" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, center: { lat: 95, lng: 0 } }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, value: 25 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, center: null }))).toEqual({ ...draft, center: null, centerLabel: "" });
  });
});
