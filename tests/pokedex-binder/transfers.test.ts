import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addSetImports, exportCards, groupSetImport, reviewCards, type TransferCatalog } from "../../src/utilities/pokedex-binder/lib/card-transfer";
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
  return { format, invalid, cards: await reviewCards(rows, catalog, forDex, format) };
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

  it("keeps Collectr portfolio names and only matches name-only rows when the printing is unique", async () => {
    const source = readFileSync("tests/pokedex-binder/fixtures/collectr.csv", "utf8");
    const { cards, format, invalid } = await parseAndReview(source);
    expect(format).toBe("collectr");
    expect(invalid).toEqual([]);
    expect(cards[0]).toMatchObject({ portfolio: "151 binder", match: { variant: { id: "reverse" } } });
    expect(cards[1]).toMatchObject({ portfolio: "151 binder", match: { card: { number: "011" }, variant: { id: "normal" } } });
    expect(cards[2].match).toBeUndefined();
    expect(cards[2].choices?.map(choice => choice.variant?.id)).toEqual(expect.arrayContaining(["normal", "reverse"]));
    expect(cards[4].reason).toBe("Watchlist entry");
    expect(cards[8].reason).toBe("Catalog covers English cards");
    expect(cards[9].match).toBeUndefined();
    expect(cards[9].choices?.map(choice => choice.card.number)).toEqual(["001", "002", "167"]);
    expect(cards[10].reason).toBe("Card was not found in that set");
    const matched = cards.flatMap(card => card.match ? [card.match] : []);
    const groups = groupSetImport(matched, emptyMaster());
    expect(groups.find(group => group.set.id === "sv03.5")?.marks).toHaveLength(2);
    const dex = await parseAndReview(source, true);
    expect(dex.cards[1].match?.card.number).toBe("011");
    expect(dex.cards[2].match?.card.number).toBe("004");
    const sameName = await parseAndReview("Portfolio Name,Category,Set,Product Name,Variance,Quantity\n" +
      "One,Pokémon,151,Ivysaur,Regular,1\nOne,Pokémon,151,Ivysaur,,1\n");
    expect(sameName.cards[0].match?.card.number).toBe("002");
    expect(sameName.cards[1].match).toBeUndefined();
    expect(sameName.cards[1].choices?.map(choice => choice.card.number)).toContain("167");
  });

  it("uses the number embedded in a Collectr product name and flags inconsistent identities", async () => {
    const { cards } = await parseAndReview("Portfolio Name,Category,Set,Product Name,Card Number,Variance,Quantity,Product ID\n" +
      "One,Pokémon,151,Ivysaur - 167/165,,Holo,1,106996\n" +
      "One,Pokémon,151,Ivysaur - 167/165,,Regular,1,\n" +
      "One,Pokémon,151,Ivysaur - 167/165,002,Regular,1,\n" +
      "One,Pokémon,151,Bulbasaur - 001/165,1,Reverse Holo,1,\n" +
      "One,Pokémon,Lost Origin,Parasect - TG01/TG30,005/196,Holofoil,1,\n");
    expect(cards[0].match?.card.number).toBe("167");
    expect(cards[1].match).toBeUndefined();
    expect(cards[1].choices?.map(choice => choice.card.number)).toEqual(["167"]);
    expect(cards[2].match).toBeUndefined();
    expect(cards[2].choices?.map(choice => choice.card.number)).toEqual(["002", "167"]);
    expect(cards[3].match?.variant?.id).toBe("reverse");
    expect(cards[4].match).toBeUndefined();
    expect(cards[4].choices?.map(choice => choice.card.number)).toEqual(expect.arrayContaining(["005", "TG01"]));
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
    const portable = await exportCards([...state.binders, older], catalog, { format: "portable", list: "owned" });
    expect(portable.exported).toBe(2);
    expect(portable.omitted).toBe(2);
    const roundTrip = await parseAndReview(portable.text);
    expect(roundTrip.cards.map(row => row.match?.variant?.id).sort()).toEqual(["holo+subtype=shadowless+stamp=1st-edition", "reverse"]);
    const destination = await exportCards(state.binders, catalog, { format: "binderloot", list: "owned" });
    expect(destination.text).toContain("International,Charizard,4/102,,Base Set,,1st Edition Holo,English,Unspecified,1");
    expect(destination.exported).toBe(2);
  });

  it("exports the mobile collection restore format with exact TCGplayer printings", async () => {
    const base = newBinder("base1", "Base Set");
    base.owned = ["4:holo+subtype=unlimited", "4:holo+subtype=shadowless", "4:holo+subtype=shadowless+stamp=1st-edition", "4:holo+subtype=1999-2000-copyright"];
    const set151 = newBinder("sv03.5", "151");
    set151.owned = ["001:normal", "001:reverse", "002:*"];
    await expect(exportCards([base], catalog, { format: "tcgplayer", list: "owned" })).rejects.toThrow(/Choose the condition/);
    const output = await exportCards([base, set151, base], catalog, { format: "tcgplayer", list: "owned", condition: "Lightly Played" });
    expect(output.text.startsWith("Collection Name,Created At,ProductID,Condition,Language,Variant,Quantity\r\n")).toBe(true);
    expect(output.exported).toBe(5);
    expect(output.omitted).toBe(2);
    const parsed = parseTransferCsv(output.text);
    expect(parsed.records.map(({ cells }) => cells.slice(2))).toEqual([
      ["42382", "Lightly Played", "English", "Holofoil", "1"],
      ["106999", "Lightly Played", "English", "Unlimited Holofoil", "1"],
      ["106999", "Lightly Played", "English", "1st Edition Holofoil", "1"],
      ["502552", "Lightly Played", "English", "Normal", "1"],
      ["502552", "Lightly Played", "English", "Reverse Holofoil", "1"],
    ]);
    const { format, cards } = await parseAndReview(output.text);
    expect(format).toBe("tcgplayer");
    expect(cards.map(card => card.match?.variant?.id)).toEqual([
      "holo+subtype=unlimited", "holo+subtype=shadowless", "holo+subtype=shadowless+stamp=1st-edition", "normal", "reverse",
    ]);
  });

  it("omits equally eligible Product IDs and IDs with no verified printing", async () => {
    const set151 = newBinder("sv03.5", "151");
    set151.owned = ["001:normal", "002:normal"];
    const ambiguous: TransferCatalog = { ...catalog, async products() {
      return { "10": ["sv03.5", "001", null, ["Normal"]], "11": ["sv03.5", "001", null, ["Normal"]], "12": ["sv03.5", "002"] };
    } };
    const output = await exportCards([set151], ambiguous, { format: "tcgplayer", list: "owned", condition: "Near Mint" });
    expect(output).toMatchObject({ exported: 0, omitted: 2 });
    expect(output.text.split("\r\n")).toHaveLength(2);
  });

  it("exports missing checklist printings in all formats and counts unsupported entries once", async () => {
    const binder = newBinder("sv03.5", "151");
    binder.owned = ["001:normal", "002:normal", "002:reverse"];
    binder.specialties = ["001:normal+stamp=set-logo"];
    binder.settings.fillerThrough = 3;
    binder.extras = [
      { id: crypto.randomUUID(), number: "1", name: "Required extra", required: true },
      { id: crypto.randomUUID(), number: "2", name: "Optional extra", required: false },
    ];
    const selected = [binder, { ...binder, id: crypto.randomUUID() }];
    const smallCatalog = { ...catalog, async cards(setId: string) { return (await catalog.cards(setId)).slice(0, 3); } };

    const portable = await exportCards(selected, smallCatalog, { format: "portable", list: "missing" });
    expect(portable).toMatchObject({ exported: 3, omitted: 1 });
    expect(parseTransferCsv(portable.text).records.map(row => [row.cells[3], row.cells[5]])).toEqual([
      ["001", "reverse"], ["001", "normal+stamp=set-logo"], ["003", "holo"],
    ]);
    const binderloot = await exportCards(selected, smallCatalog, { format: "binderloot", list: "missing" });
    expect(binderloot).toMatchObject({ exported: 2, omitted: 2 });
    expect(binderloot.text).toContain("International,Bulbasaur,001/165,,151,,Reverse Holo,English,Unspecified,1");
    expect(binderloot.text).toContain("International,Venusaur ex,003/165,,151,,Normal Holo,English,Unspecified,1");

    const mobile = await exportCards(selected, smallCatalog, { format: "tcgplayer", list: "missing", condition: "Near Mint" });
    expect(mobile).toMatchObject({ exported: 2, omitted: 2 });
    const rows = parseTransferCsv(mobile.text).records;
    expect(rows.map(({ cells }) => [cells[0], ...cells.slice(2)])).toEqual([
      ["Pokémon Binder Tracker - Missing Cards", "502552", "Near Mint", "English", "Reverse Holofoil", "1"],
      ["Pokémon Binder Tracker - Missing Cards", "502554", "Near Mint", "English", "Holofoil", "1"],
    ]);
  });

  it("honors number-only ownership and keeps any-finish gaps in Portable CSV", async () => {
    const binder = newBinder("sv03.5", "151 numbers");
    binder.goal = "numbers";
    binder.owned = ["002:*", "004:normal"];
    const smallCatalog = { ...catalog, async cards(setId: string) { return (await catalog.cards(setId)).slice(0, 4); } };

    const portable = await exportCards([binder], smallCatalog, { format: "portable", list: "missing" });
    expect(portable).toMatchObject({ exported: 2, omitted: 0 });
    expect(parseTransferCsv(portable.text).records.map(row => row.cells.slice(3, 7))).toEqual([
      ["001", "Bulbasaur", "", "Any finish"], ["003", "Venusaur ex", "holo", "Holo"],
    ]);
    const mobile = await exportCards([binder], smallCatalog, { format: "tcgplayer", list: "missing", condition: "Near Mint" });
    expect(mobile).toMatchObject({ exported: 1, omitted: 1 });
    expect(mobile.text).toContain(",502554,Near Mint,English,Holofoil,1");

    binder.owned.push("001:*", "003:holo");
    const complete = await exportCards([binder], smallCatalog, { format: "portable", list: "missing" });
    expect(complete).toMatchObject({ exported: 0, omitted: 0 });
    expect(complete.text.split("\r\n")).toHaveLength(2);
  });

  it("exports ordered printings separately and moves an imported arrival into owned", async () => {
    const binder = newBinder("sv03.5", "151");
    binder.owned = ["001:normal"];
    binder.ordered = ["001:reverse"];
    const smallCatalog = { ...catalog, async cards(setId: string) { return (await catalog.cards(setId)).slice(0, 2); } };
    const missing = await exportCards([binder], smallCatalog, { format: "portable", list: "missing" });
    expect(missing.text).not.toContain("Bulbasaur");
    const ordered = await exportCards([binder], smallCatalog, { format: "portable", list: "ordered" });
    expect(ordered).toMatchObject({ exported: 1, omitted: 0 });
    expect(ordered.text).toContain("001,Bulbasaur,reverse");
    const mobile = await exportCards([binder], smallCatalog, { format: "tcgplayer", list: "ordered", condition: "Near Mint" });
    expect(mobile.text).toContain(",502552,Near Mint,English,Reverse Holofoil,1");
    const { cards } = await parseAndReview(ordered.text);
    const state = { ...emptyMaster(), binders: [binder] };
    addSetImports(state, groupSetImport([cards[0].match!], state), new Map([[binder.setId, binder.id]]));
    expect(binder.ordered).toBeUndefined();
    expect(binder.owned).toEqual(["001:normal", "001:reverse"]);
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
