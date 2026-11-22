import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addSetImports, exportOwnedCards, groupSetImport, reviewCards, type TransferCatalog } from "../../src/utilities/pokedex-binder/lib/card-transfer";
import { emptyMaster, newBinder, type SetCard, type SetSummary } from "../../src/utilities/pokedex-binder/lib/master";
import { defaultState, mergeStates, nationalEnabled, validateState } from "../../src/utilities/pokedex-binder/lib/model";
import { mapTransferHeaders, parseTransferCsv, transferRows } from "../../src/utilities/pokedex-binder/lib/transfer-csv";
import type { ProductIdentity } from "../../src/utilities/pokedex-binder/lib/transfer-identity";

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/utilities/pokedex-binder/catalog/${path}.json`, "utf8"));
const catalog: TransferCatalog = {
  sets: read<SetSummary[]>("master-sets/index"),
  async cards(setId) { return read<SetCard[]>(`master-sets/${setId}`); },
  async products() { return read<{ products: Record<string, ProductIdentity> }>("tcgplayer-products").products; },
};

async function parseAndReview(text: string, forDex = false) {
  const csv = parseTransferCsv(text);
  const { format, mapping } = mapTransferHeaders(csv.headers, "auto");
  const { rows, invalid } = transferRows(csv, mapping);
  return { format, invalid, cards: await reviewCards(rows, catalog, forDex) };
}

describe("optional National Pokédex state", () => {
  it("keeps legacy progress visible and syncs explicit visibility across independent ownership edits", () => {
    const base = defaultState();
    const legacy = { ...base, ownedDexIds: [1] };
    const hidden = { ...legacy, enabled: false };
    expect(nationalEnabled(base)).toBe(false);
    expect(nationalEnabled(legacy)).toBe(true);
    expect(nationalEnabled({ ...base, settings: { ...base.settings, rows: 3 } })).toBe(true);
    expect(nationalEnabled(validateState(hidden))).toBe(false);
    expect(mergeStates(legacy, hidden, { ...legacy, ownedDexIds: [1, 25] }).state).toEqual({ ...hidden, ownedDexIds: [1, 25] });
    expect(mergeStates(legacy, { ...legacy, ownedDexIds: [1, 25] }, hidden).state).toEqual({ ...hidden, ownedDexIds: [1, 25] });
    expect(() => validateState({ ...base, enabled: "false" })).toThrow();
  });
});

describe("collection transfers", () => {
  it("reads published TCG Collector shapes and uses the correct vintage subtypes", async () => {
    const { cards, format } = await parseAndReview("TCG region,Card name,Card number,Expansion,Card variant,Card language,Quantity,Note\r\n" +
      'International,Rayquaza ex,97/97,EX Dragon,Normal Holo,English,1,"quoted, note\r\nwith ""quotes"""\r\n' +
      "International,Dragonite,4/62,Fossil,1st Edition Holo,English,1,\r\n" +
      "International,Charizard,4/102,Base Set,Normal Holo,English,2,\r\n" +
      "Japan,Charizard,4/102,Base Set,Normal Holo,Japanese,1,\r\n");
    expect(format).toBe("tcgcollector");
    expect(cards.map(row => row.match?.variant?.id)).toEqual(["holo", "holo+stamp=1st-edition", "holo+subtype=unlimited", undefined]);
    expect(cards.map(row => row.line)).toEqual([2, 4, 5, 6]);
    expect(cards[2].quantity).toBe(2);
    expect(cards[3].reason).toMatch(/region/i);
  });

  it("filters Collectr watchlists and matches collector numbers without dropping their padding", async () => {
    const { cards, format } = await parseAndReview("\uFEFFPortfolio Name;Category;Set;Product Name;Card Number;Variance;Quantity;Watchlist\n" +
      "Mine;Pokémon;Scarlet & Violet 151;Bulbasaur;1/165;Reverse Holo;3;false\n" +
      "Mine;Pokémon;Scarlet & Violet 151;Ivysaur;002/165;Normal;1;true\n" +
      "Mine;Pokémon;Scarlet & Violet 151;Venusaur ex;003/165;Normal;0;false\n" +
      "Mine;Magic;Scarlet & Violet 151;Bulbasaur;001/165;Normal;1;false\n");
    expect(format).toBe("collectr");
    expect(cards[0].match?.card.number).toBe("001");
    expect(cards[0].match?.variant?.id).toBe("reverse");
    expect(cards.slice(1).map(row => row.reason)).toEqual(["Watchlist entry", "Quantity must be a positive whole number", "Different game or product type"]);
  });

  it("matches a TCGplayer Product ID and surfaces unknown or ambiguous rows", async () => {
    const { cards, format } = await parseAndReview("Collection Name,Product ID,Condition,Language,Variant,Quantity\n" +
      "Collection,451396,Near Mint,English,Holofoil,1\n" +
      "Collection,106996,Near Mint,English,Unlimited,1\n" +
      "Collection,502548,Near Mint,English,Foil,1\n" +
      "Collection,111,Near Mint,English,,1\n");
    expect(format).toBe("tcgplayer");
    expect(cards[0].match?.card.number).toBe("139");
    expect(cards[0].match?.variant?.id).toBe("holo");
    expect(cards[1].match?.variant?.id).toBe("holo+subtype=shadowless");
    expect(cards[2].match ?? cards[2].choices?.[0]).toBeDefined();
    expect(cards[3].reason).toMatch(/not recognized/);
    const ambiguous = await parseAndReview("Set ID,Collector number,Card name\nsv03.5,001,Bulbasaur\n");
    expect(ambiguous.cards[0].match).toBeUndefined();
    expect(ambiguous.cards[0].choices?.length).toBeGreaterThan(1);
    const dex = await parseAndReview("Set ID,Collector number,Card name\nsv03.5,001,Bulbasaur\n", true);
    expect(dex.cards[0].match?.card.name).toBe("Bulbasaur");
  });

  it("routes set ownership additively and round-trips portable CSV without inventing cards", async () => {
    const { cards } = await parseAndReview("Set,Number,Name,Finish\nBase Set,04,Charizard,1st Edition Holo\n151,1,Bulbasaur,Reverse Holo\n");
    const matches = cards.map(row => row.match!);
    expect(matches).toHaveLength(2);
    const state = emptyMaster();
    const older = newBinder("base1", "Existing");
    older.owned = ["001:*", "4:*"];
    state.binders.push(older);
    const destinations = new Map([["base1", older.id]]);
    const groups = groupSetImport(matches, state);
    addSetImports(state, groups, destinations);
    expect(() => addSetImports(state, groups, destinations)).toThrow(/destination binders changed/);
    const nextDestinations = new Map(state.binders.map(binder => [binder.setId, binder.id]));
    addSetImports(state, groupSetImport(matches, state), nextDestinations);
    expect(state.binders).toHaveLength(2);
    expect(older.owned).toContain("4:*");
    expect(older.specialties).toEqual(["4:holo+subtype=shadowless+stamp=1st-edition"]);
    const portable = await exportOwnedCards([...state.binders, older], catalog, "portable");
    expect(portable.exported).toBe(2);
    expect(portable.omitted).toBe(2);
    const roundTrip = await parseAndReview(portable.text);
    expect(roundTrip.cards.map(row => row.match?.variant?.id).sort()).toEqual(["holo+subtype=shadowless+stamp=1st-edition", "reverse"]);
    const destination = await exportOwnedCards(state.binders, catalog, "binderloot");
    expect(destination.text).toContain("International,Charizard,4/102,,Base Set,,1st Edition Holo,English,Unspecified,1");
    expect(destination.exported).toBe(2);
  });

  it("supports mapped columns, preserves alphanumeric identifiers and rejects malformed rows", async () => {
    const file = parseTransferCsv('Expansion text,"Printed #",Pokémon,Parallel\nLost Origin,TG01/TG30,Parasect,Normal Holo\nMissing,a,column\n');
    const { rows, invalid } = transferRows(file, { set: 0, number: 1, name: 2, finish: 3 });
    expect(invalid).toEqual([3]);
    const [preview] = await reviewCards(rows, catalog, false);
    expect(preview.match?.card.number).toBe("TG01");
    expect(() => parseTransferCsv('Set,Number\n"151,001')).toThrow(/unclosed quote/);
    expect(() => transferRows(file, { set: 0, number: 0 })).toThrow(/only one/);
  });
});
