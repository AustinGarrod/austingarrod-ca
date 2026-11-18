import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, defaultState, exportBackup, exportCsv, importBackup, locationFor, mergeStates, pageCount, pageSlots, searchSpecies, validateState, type Species } from "../../src/utilities/pokedex-binder/lib/model";

const species: Species[] = Array.from({ length: 1025 }, (_, index) => ({ id: index + 1, name: `Pokémon ${index + 1}`, generation: 1, printingCount: 1 }));
describe("Pokédex binder placement", () => {
  it("places boundaries and final blank pockets without counting blanks as Pokémon", () => {
    expect(locationFor(1, DEFAULT_SETTINGS)).toEqual({ page: 1, sheet: 1, side: "front", pocket: 1, row: 1, column: 1 });
    expect(locationFor(16, DEFAULT_SETTINGS)).toMatchObject({ page: 1, pocket: 16, row: 4, column: 4 });
    expect(locationFor(17, DEFAULT_SETTINGS)).toMatchObject({ page: 2, sheet: 1, side: "back", pocket: 1 });
    expect(pageCount(species.length, DEFAULT_SETTINGS)).toBe(65);
    expect(pageSlots(65, species, DEFAULT_SETTINGS).filter(slot => slot.species)).toHaveLength(1);
    expect(pageSlots(65, species, DEFAULT_SETTINGS).filter(slot => slot.reserved)).toHaveLength(0);
  });
  it("supports reserved complete pages, custom dimensions, and front-only sheets", () => {
    const settings = { columns: 3, rows: 2, useBackSides: false, leadingBlankPockets: 8 };
    expect(locationFor(1, settings)).toEqual({ page: 2, sheet: 2, side: "front", pocket: 3, row: 1, column: 3 });
    expect(pageSlots(1, species, settings).every(slot => slot.reserved)).toBe(true);
    expect(pageSlots(2, species, settings).map(slot => slot.species?.id ?? null)).toEqual([null, null, 1, 2, 3, 4]);
    expect(locationFor(16, settings)).toMatchObject({ page: 4, pocket: 6 });
  });
  it("uses the full catalog position rather than a filtered index", () => {
    const result = searchSpecies(species, "0017")[0];
    expect(locationFor(result.id, DEFAULT_SETTINGS, species).page).toBe(2);
  });
});

describe("Pokédex search and portable backups", () => {
  const names = ["Nidoran♀", "Nidoran♂", "Farfetch’d", "Mr. Mime", "Mime Jr.", "Type: Null", "Flabébé"].map((name, i) => ({ id: i + 1, name, generation: 1, printingCount: 1 }));
  it.each([["nidoran female", "Nidoran♀"], ["Nidoran-F", "Nidoran♀"], ["nidoranm", "Nidoran♂"], ["Farfetch'd", "Farfetch’d"], ["mr mime", "Mr. Mime"], ["mimejr", "Mime Jr."], ["type null", "Type: Null"], ["flabebe", "Flabébé"], ["#0004", "Mr. Mime"]])("finds %s", (query, expected) => {
    expect(searchSpecies(names, query)[0]?.name).toBe(expected);
  });
  it("validates imports completely before returning a replacement and excludes private keys", () => {
    const state = { ...defaultState(), ownedDexIds: [1, 17, 1025] };
    const backup = exportBackup(state);
    expect(importBackup(backup, species)).toEqual(state);
    expect(backup).not.toContain("key");
    expect(() => importBackup("{}", species)).toThrow(/supported/);
    expect(() => importBackup("broken", species)).toThrow(/JSON/);
    expect(() => validateState({ ...state, ownedDexIds: [1, 1] }, species)).toThrow(/duplicate/);
    expect(() => validateState({ ...state, ownedDexIds: [1026] }, species)).toThrow(/unrecognized/);
    expect(() => validateState({ ...state, settings: { ...state.settings, columns: 0 } }, species)).toThrow(/1–6/);
    expect(() => validateState({ ...state, schemaVersion: 2 }, species)).toThrow(/unsupported/);
  });
  it("exports missing pocket locations without shifting pages", () => {
    const csv = exportCsv(species.slice(0, 17), { ...defaultState(), ownedDexIds: [1] }, true);
    expect(csv).not.toContain("1,Pokémon 1,");
    expect(csv).toContain("17,Pokémon 17,Missing,2,1,back,1,1,1");
    expect(csv.split("\r\n")).toHaveLength(18);
  });
});

describe("net-state reconciliation", () => {
  it("keeps independent additions and removals from both devices", () => {
    const base = { ...defaultState(), ownedDexIds: [1, 2] };
    const local = { ...defaultState(), ownedDexIds: [2, 3] };
    const remote = { ...defaultState(), ownedDexIds: [1, 4] };
    expect(mergeStates(base, local, remote)).toEqual({ state: { ...defaultState(), ownedDexIds: [3, 4] }, layoutConflict: false });
  });
  it("converges matching boolean edits and detects atomic layout conflicts", () => {
    const base = defaultState();
    const local = { ...defaultState(), ownedDexIds: [1], settings: { ...DEFAULT_SETTINGS, rows: 3 } };
    const remote = { ...defaultState(), ownedDexIds: [1], settings: { ...DEFAULT_SETTINGS, columns: 3 } };
    const merged = mergeStates(base, local, remote);
    expect(merged.state.ownedDexIds).toEqual([1]);
    expect(merged.layoutConflict).toBe(true);
    expect(merged.state.settings).toEqual(local.settings);
    expect(mergeStates(base, local, local).layoutConflict).toBe(false);
  });
});
