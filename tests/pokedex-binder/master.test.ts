import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import {
  adoptSets,
  emptyMaster,
  markSlot,
  newBinder,
  setSlots,
  setSlotStatus,
  setPockets,
  setCsv,
  validateMaster,
  type SetCard,
  type SetSummary,
} from "../../src/utilities/pokedex-binder/lib/master";
import { masterCatalog } from "../../scripts/pokedex-master-catalog.mjs";
import { binderCards, relatedSets } from "../../src/utilities/pokedex-binder/lib/binder-catalog";
import { catalogArtwork } from "../../src/utilities/pokedex-binder/lib/catalog-search";
import { missingPrintings, valueBinder } from "../../src/utilities/pokedex-binder/lib/pricing";
import { exportCards, addSetImports, groupSetImport } from "../../src/utilities/pokedex-binder/lib/card-transfer";

const installed = "public/utilities/pokedex-binder/catalog/master-sets/";
const loadCards = (id: string) => JSON.parse(readFileSync(installed + id + ".json", "utf8")) as SetCard[];
const index = JSON.parse(readFileSync(installed + "index.json", "utf8")) as SetSummary[];
const summaries = new Map(index.map(set => [set.id, set]));
const fixture = (number: string, variants: unknown, category = "Pokemon") => ({
  number,
  card: {
    category,
    name: { en: "Card" },
    set: { id: "test", name: { en: "Test" }, serie: { id: "b", name: { en: "Test" } } },
    variants,
  },
});
describe("set catalog and independent pocket goals", () => {
  it("preserves subtype, print size, language and compound stamp identity", () => {
    const cards = masterCatalog([
      fixture("001", [
        { type: "normal", subtype: "shadowless" },
        { type: "normal", subtype: "unlimited" },
        { type: "reverse", foil: "pokeball", languages: ["en"] },
        { type: "normal", stamp: ["staff", "set-logo"] },
        { type: "normal", size: "jumbo" },
        { type: "holo", languages: ["ja"] },
      ]),
      fixture("GG01", undefined, "Trainer"),
    ]).get("test")!.cards;
    expect(cards[0].variants.map((v: { id: string }) => v.id).sort()).toEqual(
      [
        "normal+subtype=shadowless",
        "normal+subtype=unlimited",
        "reverse+foil=pokeball",
        "normal+stamp=set-logo+stamp=staff",
        "normal+size=jumbo",
      ].sort(),
    );
    expect(cards[1].variants[0].id).toBe("unspecified");
  });
  it("classifies the reviewed printing during refresh and preserves its stable ID", () => {
    const upstream = fixture("035", [{ type: "normal" }, { type: "holo" }, { type: "reverse" }]);
    upstream.card.set.id = "me05";
    const refreshed = masterCatalog([upstream]).get("me05")!.cards[0];
    expect(refreshed.variants).toEqual([
      { id: "holo", label: "Holo", specialty: false },
      { id: "reverse", label: "Reverse holo", specialty: false },
      { id: "normal", label: "Regular · Non-booster printing", specialty: true },
    ]);
    upstream.card.set.id = "test";
    expect(masterCatalog([upstream]).get("test")!.cards[0].variants[0].specialty).toBe(false);
  });

  it("keeps non-booster ownership recoverable without adding a default Spiritomb pocket", () => {
    const cards: SetCard[] = JSON.parse(readFileSync("public/utilities/pokedex-binder/catalog/master-sets/me05.json", "utf8"));
    const b = newBinder("me05", "Pitch Black");
    b.owned = ["035:normal", "035:reverse"];
    const spiritomb = () => setSlots(b, cards).filter(slot => slot.number === "035").map(slot => [slot.key, slot.owned]);
    expect(spiritomb()).toEqual([["035:holo", false], ["035:reverse", true]]);
    b.specialties = ["035:normal"];
    expect(spiritomb()).toEqual([["035:holo", false], ["035:reverse", true], ["035:normal", true]]);
    expect(setSlots(b, cards).some(slot => slot.key === "062:normal")).toBe(false);
  });

  it("requires review when a booster card gains both plain regular and holo slots", () => {
    const dir = "public/utilities/pokedex-binder/catalog/master-sets/";
    const sets: {id: string}[] = JSON.parse(readFileSync(dir + "index.json", "utf8"));
    for (const {id} of sets) {
      // These promotional series include printings from several distributed products.
      if (/^pop[1-9]$/.test(id) || ["np", "swshp"].includes(id)) continue;
      const cards: SetCard[] = JSON.parse(readFileSync(dir + id + ".json", "utf8"));
      const mixed = cards.filter(card => {
        const required = card.variants.filter(v => !v.specialty).map(v => v.id);
        return required.includes("normal") && required.includes("holo");
      });
      expect(mixed.map(card => card.number), id).toEqual([]);
    }
  }, 30000); // Reads every shipped set catalog on the shared runner.

  const cards: SetCard[] = JSON.parse(
    readFileSync("public/utilities/pokedex-binder/catalog/master-sets/sv03.5.json", "utf8"),
  );
  it("keeps finish evidence across goal changes, custom extras and different pocket orders", () => {
    const b = newBinder("sv03.5", "Master");
    const trade = newBinder(b.setId, "Trade");
    b.goal = "numbers";
    markSlot(b, "001:*", true);
    expect(setSlots(b, cards)[0].owned).toBe(true);
    b.goal = "variants";
    expect(
      setSlots(b, cards)
        .filter((s) => s.number === "001")
        .every((s) => !s.owned),
    ).toBe(true);
    markSlot(b, "001:reverse", true);
    expect(b.owned).toEqual(["001:reverse"]);
    b.order = "sections";
    expect(setSlots(b, cards).find((s) => s.key === "001:reverse")!.page).toBeGreaterThan(1);
    b.goal = "numbers";
    expect(setSlots(b, cards)[0].owned).toBe(true);
    b.goal = "variants";
    expect(
      setSlots(b, cards)
        .filter((s) => s.owned)
        .map((s) => s.key),
    ).toEqual(["001:reverse"]);
    expect(setSlots(trade, cards).some((s) => s.owned)).toBe(false);
    const combined = adoptSets({ schemaVersion: 1, binders: [b, trade] }, emptyMaster());
    expect(combined.binders).toHaveLength(2);
  });
  it.each([
    ["me05", 84, "004", "005", 194],
    ["me04", 86, "003", "004", 198],
  ] as const)("pads only single finishes through the printed total in %s", (id, limit, ex, next, required) => {
    const dir = "public/utilities/pokedex-binder/catalog/master-sets/";
    const index = JSON.parse(readFileSync(dir + "index.json", "utf8"));
    expect(index.find((s: { id: string }) => s.id === id).printedTotal).toBe(limit);
    const cards: SetCard[] = JSON.parse(readFileSync(dir + id + ".json", "utf8"));
    const b = newBinder(id, "My binder");
    markSlot(b, ex + ":holo", true);
    const original = setSlots(b, cards);
    b.settings.fillerThrough = limit;
    const pockets = setPockets(b, cards);
    expect(pockets.filter((s) => "filler" in s)).toHaveLength(10);
    const indexOfEx = pockets.findIndex((s) => "number" in s && s.number === ex);
    expect(pockets[indexOfEx + 1]).toMatchObject({ filler: true, number: ex });
    expect(pockets[indexOfEx + 2]).toMatchObject({ number: next });
    expect(pockets.some((s) => "filler" in s && Number(s.number) > limit)).toBe(false);
    const collectible = setSlots(b, cards);
    expect(collectible.map((s) => [s.key, s.owned])).toEqual(original.map((s) => [s.key, s.owned]));
    expect(collectible).toHaveLength(required);
    expect(setCsv(collectible)).not.toContain("Filler");
    delete b.settings.fillerThrough;
    expect(setSlots(b, cards)).toEqual(original);
  });

  it("honours the inclusive cutoff, selected specialties and page breaks in either collection goal", () => {
    const plain = { id: "normal", label: "Regular", specialty: false };
    const foil = { id: "holo", label: "Holo", specialty: true };
    const cards = ["001", "002", "003", "TG01"].map((number) => ({
      number, name: number, category: "Trainer", variants: number === "001" ? [plain, foil] : [plain],
    }));
    const b = newBinder("test", "Physical binder");
    b.settings = { columns: 2, rows: 1, useBackSides: true, leadingBlankPockets: 1, fillerThrough: 2 };
    const state = { schemaVersion: 1, binders: [b] };
    expect(validateMaster(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => validateMaster({ ...state, binders: [{ ...b, settings: { ...b.settings, fillerThrough: 0 } }] })).toThrow();
    expect(setPockets(b, cards).filter((s) => "filler" in s).map((s) => s.number)).toEqual(["001", "002"]);
    b.specialties = ["001:holo"];
    b.order = "sections";
    for (const goal of ["variants", "numbers"] as const) {
      b.goal = goal;
      const pockets = setPockets(b, cards);
      expect(pockets.filter((s) => "filler" in s)).toMatchObject([{ number: "002", page: 2, side: "back", pocket: 2 }]);
      expect(setSlots(b, cards).find((s) => s.number === "003")).toMatchObject({ page: 3, side: "front", pocket: 1 });
    }
  });

  it("tracks ordered slots and clears their orders when collected or cancelled", () => {
    const binder = newBinder("sv03.5", "151");
    setSlotStatus(binder, "001:normal", "ordered");
    setSlotStatus(binder, "001:reverse", "ordered");
    expect(setSlots(binder, cards).slice(0, 2).map(slot => slot.status)).toEqual(["ordered", "ordered"]);
    markSlot(binder, "001:normal", true);
    expect(binder.ordered).toEqual(["001:reverse"]);
    expect(setSlots(binder, cards).slice(0, 2).map(slot => slot.status)).toEqual(["owned", "ordered"]);
    setSlotStatus(binder, "001:reverse", "missing");
    expect(binder.ordered).toBeUndefined();
    expect(validateMaster({ schemaVersion: 1, binders: [binder] }).binders[0].owned).toEqual(["001:normal"]);
    expect(() => validateMaster({ schemaVersion: 1, binders: [{ ...binder, ordered: binder.owned }] })).toThrow();
  });

  const phpVersion = spawnSync(process.env.PHP_BINARY || "php", ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8" });
  it.skipIf(Number(phpVersion.stdout || 0) < 80400)(
    "matches every assistant slot and physical location for the complete 151 checklist",
    () => {
      const b = newBinder("sv03.5", "Master");
      b.specialties = ["001:normal+stamp=set-logo"];
      b.order = "sections";
      b.settings.leadingBlankPockets = 10;
      b.settings.fillerThrough = 165;
      markSlot(b, "001:reverse", true);
      b.extras = [{ id: crypto.randomUUID(), number: "P", name: "Promo", required: false }];
      setSlotStatus(b, "001:normal", "ordered");
      setSlotStatus(b, "extra:" + b.extras[0].id, "ordered");
      const php =
        "require 'public/api/v1/_master-sets.php'; [$b,$cards]=json_decode(stream_get_contents(STDIN)); echo json_encode(master_slots($b,$cards));";
      const actual = execFileSync(process.env.PHP_BINARY || "php", ["-r", php], {
        input: JSON.stringify([b, cards]),
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      expect(JSON.parse(actual)).toEqual(setSlots(b, cards));
    },
  );

  it("audits installed set identities and the distinct-card totals of split expansions", () => {
    const all = new Map(index.map(set => [set.id, loadCards(set.id)]));
    expect(all.size).toBe(index.length);
    const installedTotals: Record<string, number> = {
      "30th": 199, cel25: 50, ex10: 145, sm115: 163, "swsh4.5": 195,
      swsh9: 216, swsh10: 246, swsh11: 247, swsh12: 245, "swsh12.5": 230,
    };
    for (const set of index) {
      const rows = all.get(set.id)!;
      expect(rows.length, set.id).toBe(set.count);
      expect(new Set(rows.map(row => row.number)).size, set.id).toBe(rows.length);
      expect(rows.every(row => row.variants.length && new Set(row.variants.map(v => v.id)).size === row.variants.length), set.id).toBe(true);
      const hasRelated = relatedSets(set.id).length > 0;
      expect(hasRelated, set.id).toBe(Object.hasOwn(installedTotals, set.id));
      if (!hasRelated) continue;
      const binder = newBinder(set.id, set.name);
      binder.settings.includeRelated = true;
      binder.goal = "numbers";
      const slots = setSlots(binder, binderCards(binder, id => all.get(id)!));
      expect(new Set(slots.map(slot => slot.key)).size, set.id).toBe(slots.length);
      expect(slots.length, set.id).toBe(installedTotals[set.id]);
    }
  });

  it("adds the 38 companion cards without moving existing slots or altering marks", async () => {
    const read = (id: string) => loadCards(id);
    const binder = newBinder("30th", "Anniversary");
    const [owned, ordered] = setSlots(binder, read("30th"));
    setSlotStatus(binder, owned.key, "owned");
    setSlotStatus(binder, ordered.key, "ordered");
    const original = setSlots(binder, read("30th"));
    expect(original).toHaveLength(161);
    binder.settings.includeRelated = true;
    const expandedCards = binderCards(binder, read);
    const expanded = setSlots(binder, expandedCards);
    expect(expanded).toHaveLength(199);
    expect(expanded.slice(0, 161)).toEqual(original);
    expect(expanded.filter(slot => slot.sourceSetId === "30th-c")).toHaveLength(30);
    const energy = expanded.filter(slot => slot.sourceSetId === "mee");
    expect(energy.map(slot => slot.number)).toEqual(["009", "010", "011", "012", "013", "014", "015", "016"]);
    expect(energy.every(slot => slot.key.endsWith(":holo+stamp=30th-anniversary"))).toBe(true);
    setSlotStatus(binder, energy[0].key, "ordered");
    const targets = missingPrintings(binder, summaries.get("30th")!, expandedCards, summaries);
    expect(targets).toHaveLength(196);
    expect(targets).toContainEqual(expect.objectContaining({ setId: "mee", number: "010", variant: "holo+stamp=30th-anniversary" }));
    const markets = { asOf: "2026-11-26", prices: [{ number: "009", variant: "holo+stamp=30th-anniversary", cents: 100, observedAt: "2026-11-26" }] };
    expect(valueBinder(binder, undefined, new Map([["mee", markets]]))).toMatchObject({ cents: 0, collected: 1 });
    const imported = { set: summaries.get("mee")!, card: read("mee").find(card => card.number === "009")! };
    const state = { schemaVersion: 1 as const, binders: [binder] };
    const groups = groupSetImport([{ ...imported, variant: imported.card.variants[0] }], state);
    addSetImports(state, groups, new Map([["mee", binder.id]]));
    expect(binder.owned).toContain(energy[0].key);
    expect(binder.ordered).toEqual([ordered.key]);
    expect(valueBinder(binder, undefined, new Map([["mee", markets]]))).toMatchObject({ cents: 100, collected: 2 });
    const portable = await exportCards([binder], { sets: index, cards: async id => read(id), products: async () => ({}) },
      { format: "portable", list: "missing" });
    expect(portable.exported).toBe(196);
    expect(portable.text).toContain("mee,MEE,Mega Evolution Energy,010");
    delete binder.settings.includeRelated;
    expect(setSlots(binder, binderCards(binder, read))).toEqual(original);
    binder.settings.includeRelated = true;
    expect(setSlots(binder, binderCards(binder, read)).find(slot => slot.key === energy[0].key)?.status).toBe("owned");
  });

  it("reorders the full checklist and pads only to the next page boundary", () => {
    const binder = newBinder("30th", "Anniversary");
    binder.owned = ["30th-c/001:holo+stamp=30th-anniversary"];
    binder.ordered = ["001:*"];
    binder.settings = {
      ...binder.settings, includeRelated: true, leadingBlankPockets: 8,
      sectionLayout: [{ id: "mee" }, { id: "30th-c", newPage: true }, { id: "30th", newPage: true }],
    };
    const cards = binderCards(binder, loadCards);
    let slots = setSlots(binder, cards);
    expect(slots).toHaveLength(199);
    expect(slots[0]).toMatchObject({ sourceSetId: "mee", page: 1, pocket: 9 });
    expect(slots[8]).toMatchObject({ sourceSetId: "30th-c", page: 2, pocket: 1, status: "owned" });
    expect(slots[38]).toMatchObject({ key: "001:*", page: 4, pocket: 1, status: "ordered" });
    expect(setPockets(binder, cards).filter(pocket => "sectionBreak" in pocket)).toHaveLength(2);
    binder.settings.sectionLayout![0].newPage = true;
    slots = setSlots(binder, cards);
    expect(slots[0]).toMatchObject({ sourceSetId: "mee", page: 2, pocket: 1 });
    expect(slots[8]).toMatchObject({ sourceSetId: "30th-c", page: 3, pocket: 1 });
    const state = { schemaVersion: 1, binders: [binder] };
    delete binder.settings.includeRelated;
    expect(validateMaster(state)).toEqual(state);
    expect(setSlots(binder, binderCards(binder, loadCards))[0]).toMatchObject({ key: "001:*", page: 1, pocket: 9 });
    expect(() => validateMaster({
      ...state, binders: [{ ...binder, settings: { ...binder.settings, sectionLayout: [{ id: "mee" }, { id: "mee" }] } }],
    })).toThrow();
  });

  it("resolves distinct card artwork for all 199 anniversary checklist entries", () => {
    const binder = newBinder("30th", "Anniversary");
    binder.settings.includeRelated = true;
    const images = binderCards(binder, loadCards).map(card =>
      catalogArtwork(summaries.get(card.sourceSetId ?? binder.setId)!, card.number));
    expect(images).toHaveLength(199);
    expect(images).not.toContain(null);
    expect(new Set(images).size).toBe(199);
    expect(catalogArtwork(summaries.get("mee")!, "009")).toBe("https://tcgplayer-cdn.tcgplayer.com/product/713248_200w.jpg");
  });

  const phpValidation = spawnSync(process.env.PHP_BINARY || "php", [
    "-r", "echo (int) (PHP_VERSION_ID >= 80400 && extension_loaded('mbstring'));",
  ], { encoding: "utf8" });
  it.skipIf(phpValidation.stdout !== "1")("validates expansion marks and exposes identical slots through PHP", () => {
    const binder = newBinder("30th", "Anniversary");
    binder.settings.includeRelated = true;
    binder.settings.leadingBlankPockets = 4;
    binder.settings.sectionLayout = [{ id: "30th-c", newPage: true }, { id: "mee" }, { id: "30th", newPage: true }];
    binder.ordered = ["001:*", "mee/009:holo+stamp=30th-anniversary"];
    binder.owned = ["30th-c/001:holo+stamp=30th-anniversary"];
    const php = `
      require 'public/api/v1/_validators.php';
      $root = 'public';
      $b = json_decode(stream_get_contents(STDIN));
      $s = (object)['schemaVersion'=>1,'binders'=>[$b]];
      master_validate($s,$root);
      $index = master_set_index($root);
      $slots = master_slots($b,master_binder_cards($root,$b->setId,$index,true));
      unset($b->settings->includeRelated);
      master_validate($s,$root);
      echo json_encode($slots);
    `;
    const actual = execFileSync(process.env.PHP_BINARY || "php", ["-r", php], { input: JSON.stringify(binder), encoding: "utf8" });
    expect(JSON.parse(actual)).toEqual(setSlots(binder, binderCards(binder, loadCards)));
  });
});
