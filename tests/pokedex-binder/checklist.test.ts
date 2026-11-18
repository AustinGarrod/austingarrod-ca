import { describe, expect, it } from "vitest";
import { filterChecklist, type ChecklistSort } from "../../src/utilities/pokedex-binder/lib/checklist";
import { DEFAULT_SETTINGS, locationFor } from "../../src/utilities/pokedex-binder/lib/model";

const species = [
  { id: 1, name: "Bulbasaur", generation: 1, printingCount: 3 },
  { id: 25, name: "Pikachu", generation: 1, printingCount: 4 },
  { id: 63, name: "Abra", generation: 1, printingCount: 2 },
];
const sets = {
  base1: { id: "base1", name: "Base Set", code: "BS" },
  base4: { id: "base4", name: "Base Set 2", code: "B2" },
  unknown: { id: "unknown", name: "Pokémon promos", code: null },
};
const index = { base1: [1, 25, 63], base4: [25], unknown: [63] };
const checklistSpecies = (items: typeof species, available: typeof sets, setSpecies: typeof index, query: string, sort: ChecklistSort) =>
  filterChecklist(items, available, setSpecies, query, sort).species;

describe("checklist sorting and set filtering", () => {
  it("sorts both directions without moving binder slots or changing catalog order", () => {
    const before = locationFor(25, DEFAULT_SETTINGS);
    expect(checklistSpecies(species, sets, index, "", "name").map(item => item.name)).toEqual(["Abra", "Bulbasaur", "Pikachu"]);
    expect(checklistSpecies(species, sets, index, "", "name-desc").map(item => item.id)).toEqual([25, 1, 63]);
    expect(checklistSpecies(species, sets, index, "", "dex-desc").map(item => item.id)).toEqual([63, 25, 1]);
    expect(checklistSpecies(species, sets, index, "", "dex").map(item => item.id)).toEqual([1, 25, 63]);
    expect(species.map(item => item.id)).toEqual([1, 25, 63]);
    expect(locationFor(25, DEFAULT_SETTINGS)).toEqual(before);
  });
  it("accepts names, codes, punctuation and exact suggestions, returning each species once", () => {
    expect(checklistSpecies(species, sets, index, "bs", "dex")).toHaveLength(3);
    expect(checklistSpecies(species, sets, index, "base set", "dex")).toHaveLength(3);
    expect(checklistSpecies(species, sets, index, "Base Set 2 (B2)", "dex").map(item => item.id)).toEqual([25]);
    expect(checklistSpecies(species, sets, index, "pokemon promos", "dex").map(item => item.id)).toEqual([63]);
    expect(checklistSpecies(species, sets, index, "not a set", "dex")).toEqual([]);
  });
  it("intersects with existing name, ownership and generation results", () => {
    expect(checklistSpecies(species.filter(item => item.id === 1), sets, index, "B2", "name")).toEqual([]);
    expect(checklistSpecies(species.filter(item => item.id === 25), sets, index, "BS", "name").map(item => item.id)).toEqual([25]);
  });
  it("prefers an exact set code over partial matches in other set names", () => {
    const moreSets = { ...sets, collision: { id: "collision", name: "Obsidian Flames", code: "OBF" } };
    const result = filterChecklist(species, moreSets, { ...index, base1: [1], collision: [25] }, "bs", "dex");
    expect(result.species.map(item => item.id)).toEqual([1]);
    expect(result.sets).toEqual([sets.base1]);
  });
});
