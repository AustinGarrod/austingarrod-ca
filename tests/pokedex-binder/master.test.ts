import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import {
  adoptSets,
  emptyMaster,
  markSlot,
  newBinder,
  setSlots,
  setPockets,
  setCsv,
  validateMaster,
  type SetCard,
} from "../../src/utilities/pokedex-binder/lib/master";
import { masterCatalog } from "../../scripts/pokedex-master-catalog.mjs";
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
  });

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
    const indexOfEx = pockets.findIndex((s) => s.number === ex);
    expect(pockets[indexOfEx + 1]).toMatchObject({ filler: true, number: ex });
    expect(pockets[indexOfEx + 2].number).toBe(next);
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
});
