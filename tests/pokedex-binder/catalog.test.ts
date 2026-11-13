import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createSpecies, normalizeCatalog, parseCsv, transpileData } from "../../scripts/refresh-pokedex-catalog.mjs";

const species = [
  { id: 1, name: "Bulbasaur", generation: 1, printingCount: 0 },
  { id: 19, name: "Rattata", generation: 1, printingCount: 0 },
  { id: 25, name: "Pikachu", generation: 1, printingCount: 0 },
  { id: 644, name: "Zekrom", generation: 5, printingCount: 0 },
];
const physicalSet = {
  id: "sv03.5", name: { en: "151" }, abbreviations: { official: "MEW" },
  releaseDate: "2023-09-22", serie: { id: "sv", name: { en: "Scarlet & Violet" } },
};
const card = (overrides: Record<string, unknown> = {}) => ({
  name: { en: "Bulbasaur" }, category: "Pokemon", dexId: [1], set: physicalSet, rarity: "Common", ...overrides,
});

describe("Pokédex catalog normalization", () => {
  it("uses national species IDs and exact English display names from the CSV source", () => {
    const result = createSpecies("id,generation_id\n2,1\n1,1\n", "pokemon_species_id,local_language_id,name\n1,5,Bulbizarre\n1,9,Bulbasaur\n2,9,Ivysaur\n");
    expect(result).toEqual([
      { id: 1, name: "Bulbasaur", generation: 1, printingCount: 0 },
      { id: 2, name: "Ivysaur", generation: 1, printingCount: 0 },
    ]);
    expect(parseCsv('id,name\r\n1,"Name, with ""quotes"""\r\n')).toEqual([{ id: "1", name: 'Name, with "quotes"' }]);
    expect(() => createSpecies("id,generation_id\n2,1\n", "pokemon_species_id,local_language_id,name\n2,9,Ivysaur\n")).toThrow("Invalid National");
  });

  it("preserves official codes, collector numbers, rarity, and verified asset paths", () => {
    const result = normalizeCatalog(species, [{ number: "001", card: card() }], {
      en: { sv: { "sv03.5": { "001": true } } }, univ: { sv: { "sv03.5": { symbol: true } } },
    });
    expect(result.sets["sv03.5"]).toMatchObject({ name: "151", code: "MEW", releaseDate: "2023-09-22" });
    expect(result.printings.get(1)).toEqual([{
      id: "sv03.5-001", name: "Bulbasaur", number: "001", setId: "sv03.5", rarity: "Common",
      image: "https://assets.tcgdex.net/en/sv/sv03.5/001/low.webp",
    }]);
    expect(result.sets["sv03.5"].symbol).toBe("https://assets.tcgdex.net/univ/sv/sv03.5/symbol.webp");
  });

  it("indexes forms and multi-species cards by source dexId without counting artwork cameos", () => {
    const result = normalizeCatalog(species, [
      { number: "019", card: card({ name: { en: "Alolan Rattata" }, dexId: [19], cameoDexIds: [25] }) },
      { number: "033", card: card({ name: { en: "Pikachu & Zekrom GX" }, dexId: [25, 644] }) },
      { number: "999", card: card({ name: { en: "Bulbasaur" }, dexId: undefined }) },
    ]);
    expect(result.printings.get(19)).toHaveLength(1);
    expect(result.printings.get(25).map((entry: { id: string }) => entry.id)).toEqual(["sv03.5-033"]);
    expect(result.printings.get(644)).toHaveLength(1);
    expect(result.printings.get(1)).toEqual([]);
    expect(result.audit.missingDexIdCards).toEqual(["sv03.5-999"]);
  });

  it("excludes Pocket, non-English cards, trainers, and energy while retaining physical promos", () => {
    const result = normalizeCatalog(species, [
      { number: "1", card: card() },
      { number: "2", card: card({ set: { ...physicalSet, id: "A1", serie: { id: "tcgp", name: { en: "Pokémon TCG Pocket" } } } }) },
      { number: "3", card: card({ name: { fr: "Bulbizarre" } }) },
      { number: "4", card: card({ category: "Trainer" }) },
      { number: "5", card: card({ category: "Energy" }) },
      { number: "XY01", card: card({ set: { ...physicalSet, id: "xyp", tcgOnline: "PR-XY", abbreviations: undefined } }) },
    ]);
    expect(result.printings.get(1)).toHaveLength(2);
    expect(result.sets.A1).toBeUndefined();
    expect(result.sets.xyp.code).toBe("PR-XY");
    expect(result.audit.excludedPocketCards).toBe(1);
    expect(result.audit.indexedCards).toBe(2);
  });

  it("retains unknown codes/images as absent and rejects corrupt IDs or duplicate printings", () => {
    const result = normalizeCatalog(species, [{ number: "GG01", card: card({ set: { ...physicalSet, abbreviations: undefined }, rarity: undefined }) }]);
    expect(result.sets["sv03.5"].code).toBeNull();
    expect(result.audit.missingSetCodes).toEqual(["sv03.5"]);
    expect(result.printings.get(1)[0]).toMatchObject({ number: "GG01", image: null, rarity: null });
    expect(() => normalizeCatalog(species, [{ number: "1", card: card({ dexId: [99999] }) }])).toThrow("Unknown or invalid species");
    expect(() => normalizeCatalog(species, [{ number: "1", card: card() }, { number: "1", card: card() }])).toThrow("Duplicate printing");
  });

  it("resolves imported set definitions and shared-card overrides when transpiling source modules", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "pokedex-module-test-"));
    try {
      const sources = {
        "set.ts": 'interface Set { id: string }; const set: Set = { id: "base1", name: {en:"Base Set"}, serie: {id:"base",name:{en:"Base"}}, tcgOnline:"BS", releaseDate:"1999-01-09" }; export default set;',
        "shared.ts": 'import Set from "./set"; import { Card } from "./interfaces"; const card: Card = {name:{en:"Pikachu"},category:"Pokemon",dexId:[25],set:Set}; export default card;',
        "card.ts": 'import shared from "./shared"; const card = {...shared, name:{en:"Alolan Rattata"}, dexId:[19]}; export default card;',
      };
      for (const [filename, source] of Object.entries(sources)) {
        await writeFile(path.join(temporary, filename.replace(/\.ts$/, ".mjs")), transpileData(source, filename));
      }
      const resolved = await import(/* @vite-ignore */ pathToFileURL(path.join(temporary, "card.mjs")).href);
      const result = normalizeCatalog(species, [{ number: "019", card: resolved.default }]);
      expect(result.sets.base1.code).toBe("BS");
      expect(result.printings.get(19)[0].name).toBe("Alolan Rattata");
      expect(result.printings.get(25)).toEqual([]);
    } finally {
      const allowed = path.join(path.resolve(os.tmpdir()), "pokedex-module-test-");
      if (!path.resolve(temporary).startsWith(allowed)) throw new Error("Unexpected temporary test directory");
      await rm(temporary, { recursive: true, force: true });
    }
  });
});

describe("shipped Pokédex catalog", () => {
  const publicFile = (relative: string) => new URL(`../../public/utilities/pokedex-binder/${relative}`, import.meta.url);

  it("ships a complete species catalog, consistent printing shards, and local sprites", async () => {
    const index = JSON.parse(await readFile(publicFile("catalog/index.json"), "utf8"));
    expect(index.schemaVersion).toBe(1);
    expect(index.species).toHaveLength(1025);
    expect(index.species[0]).toMatchObject({ id: 1, name: "Bulbasaur" });
    expect(index.species[1024]).toMatchObject({ id: 1025, name: "Pecharunt" });
    expect(index.sets.sv01.code).toBe("SVI");
    expect(index.sets["sv03.5"].code).toBe("MEW");
    expect(index.sets.base1.code).toBe("BS");
    expect(index.sets.A1).toBeUndefined();
    const printingFiles = await readdir(publicFile("catalog/printings/"));
    expect(printingFiles).toHaveLength(index.species.length);
    const allCardIds = new Set();
    for (const entry of index.species) {
      const printings = JSON.parse(await readFile(publicFile(`catalog/printings/${entry.id}.json`), "utf8"));
      expect(printings, entry.name).toHaveLength(entry.printingCount);
      const perSpeciesIds = new Set();
      for (const printing of printings) {
        expect(index.sets[printing.setId], printing.id).toBeDefined();
        expect(typeof printing.number).toBe("string");
        expect(printing.id).toBe(`${printing.setId}-${printing.number}`);
        expect(perSpeciesIds.has(printing.id)).toBe(false);
        perSpeciesIds.add(printing.id); allCardIds.add(printing.id);
        if (printing.image) expect(printing.image).toMatch(/^https:\/\/assets\.tcgdex\.net\/en\/.+\/low\.webp$/);
      }
      const sprite = await readFile(publicFile(`sprites/${entry.id}.png`));
      expect(sprite.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    expect(allCardIds.size).toBe(index.audit.indexedCards);
    expect(allCardIds.size).toBeGreaterThan(15000);
    expect(index.audit.excludedPocketCards).toBeGreaterThan(0);
  }, 30000); // Read every shipped shard and sprite, including on slower Windows disks.
});
