import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { GET } from "../../src/pages/utilities/pokemon-binder/catalog/cards.json";
import { catalogArtwork, createCardIndex, searchCards, type CatalogSearchIndex, type CatalogSearchSet } from "../../src/utilities/pokedex-binder/lib/catalog-search";

const sets: CatalogSearchSet[] = [
  { id: "sv03.5", name: "151", code: "MEW", printedTotal: 165, artwork: { series: "sv", missing: ["001"] },
    cards: [["001", "Bulbasaur"], ["160", "Erika's Invitation"], ["207", "Basic Psychic Energy"]] },
  { id: "base1", name: "Base Set", code: "BS", printedTotal: 102,
    cards: [["1", "Alakazam"], ["44", "Bulbasaur"], ["99", "Grass Energy"]] },
  { id: "swsh9tg", name: "Brilliant Stars Trainer Gallery", code: "BRS", printedTotal: 30,
    cards: [["TG01", "Flareon"], ["TG30", "Single Strike Urshifu VMAX"]] },
  { id: "sm12", name: "Cosmic Eclipse", code: "CEC", printedTotal: 236,
    cards: [["215", "Charizard & Braixen-GX", ["Fennekin"]]] },
];
const index = createCardIndex(sets);
const numbers = (query: string, setId?: string) => searchCards(index, query, setId).map(row => row.number);

describe("card catalog search", () => {
  it("finds cards by name, species, and combined set and card terms", () => {
    expect(numbers("Bulbasaur")).toEqual(["001", "44"]);
    expect(numbers("Bulbasaur 151")).toEqual(["001"]);
    expect(numbers("Fennekin")).toEqual(["215"]);
    expect(numbers("Erika’s Invitation")).toEqual(["160"]);
    expect(numbers("Grass Energy")).toEqual(["99"]);
  });

  it("finds set names, codes, and numeric set names without letting them swallow explicit card numbers", () => {
    expect(numbers("Scarlet & Violet—151")).toEqual(["001", "160", "207"]);
    expect(numbers("Base Set")).toEqual(["1", "44", "99"]);
    expect(numbers("MEW 001")).toEqual(["001"]);
    expect(numbers("#001")).toEqual(["001", "1"]);
    expect(numbers("001/165")).toEqual(["001"]);
    expect(numbers("001 / 102")).toEqual(["1"]);
    expect(numbers("tg1/tg30")).toEqual(["TG01"]);
    expect(numbers("tg1/tg150")).toEqual([]);
  });

  it("supports an explicit set filter and artwork availability", () => {
    expect(numbers("Bulbasaur", "base1")).toEqual(["44"]);
    expect(numbers("", "base1")).toEqual(["1", "44", "99"]);
    expect(numbers("")).toEqual([]);
    expect(catalogArtwork(sets[0], "001")).toBeNull();
    expect(catalogArtwork(sets[0], "160")).toBe("https://assets.tcgdex.net/en/sv/sv03.5/160/low.webp");
  });

  it("generates the index from the bundled catalog, including Trainer and Energy cards", async () => {
    const response = await GET({} as APIContext);
    const { schemaVersion, sets } = await response.json() as CatalogSearchIndex;
    expect(schemaVersion).toBe(1);
    expect(sets.length).toBeGreaterThan(100);
    const masterSets = createCardIndex(sets);
    expect(searchCards(masterSets, "Bulbasaur #001", "sv03.5")).toMatchObject([{ number: "001", name: "Bulbasaur" }]);
    expect(searchCards(masterSets, "Erika's Invitation", "sv03.5")).toContainEqual(expect.objectContaining({ number: "160" }));
    expect(searchCards(masterSets, "Energy", "sv03.5")).toContainEqual(expect.objectContaining({ number: "207" }));
    expect(searchCards(masterSets, "Unown #?", "exu")).toMatchObject([{ number: "%3F", name: "Unown" }]);
    expect(searchCards(masterSets, "#!", "exu")).toMatchObject([{ number: "!", name: "Unown" }]);
  });
});
