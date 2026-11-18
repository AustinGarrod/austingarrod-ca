import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import {
  adoptSets,
  emptyMaster,
  markSlot,
  newBinder,
  setSlots,
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
  const phpVersion = spawnSync(process.env.PHP_BINARY || "php", ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8" });
  it.skipIf(Number(phpVersion.stdout || 0) < 80400)(
    "matches every assistant slot and physical location for the complete 151 checklist",
    () => {
      const b = newBinder("sv03.5", "Master");
      b.specialties = ["001:normal+stamp=set-logo"];
      b.order = "sections";
      b.settings.leadingBlankPockets = 10;
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
