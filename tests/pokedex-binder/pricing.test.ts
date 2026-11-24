import { describe, expect, it } from "vitest";
import { newBinder, type SetCard, type SetSummary } from "../../src/utilities/pokedex-binder/lib/master";
import { freshOffers, groupBuyingEntries, matchesBuyingEntry, missingPrintings, sumBinderValues, valueBinder, type RetailOffer } from "../../src/utilities/pokedex-binder/lib/pricing";

const set: SetSummary = { id: "sv03.5", name: "151", code: "MEW", count: 1, printedTotal: 165 };
const cards: SetCard[] = [{ number: "001", name: "Bulbasaur", category: "Pokemon", variants: [
  { id: "normal", label: "Regular", specialty: false },
  { id: "reverse", label: "Reverse holo", specialty: false },
  { id: "normal+stamp=set-logo", label: "Set logo", specialty: true },
] }];

describe("binder pricing", () => {
  it("counts exact collected copies per binder and shows coverage for unavailable prices", () => {
    const first = newBinder(set.id, "First");
    const second = newBinder(set.id, "Second");
    first.owned = ["001:*", "001:normal", "003:*", "extra:example"];
    first.ordered = ["001:reverse"];
    second.owned = ["001:normal"];
    const market = { asOf: "2026-11-24", prices: [
      { number: "001", variant: "normal", cents: 123, observedAt: "2026-11-24" },
      { number: "001", variant: "reverse", cents: 900, observedAt: "2026-11-24" },
    ] };
    expect(valueBinder(first, market)).toEqual({ cents: 123, priced: 1, collected: 3, asOf: market.asOf });
    expect(sumBinderValues([valueBinder(first, market), valueBinder(second, market)]))
      .toEqual({ cents: 246, priced: 2, collected: 4, asOf: market.asOf });
    expect(valueBinder(first)).toMatchObject({ cents: 0, priced: 0, collected: 3 });
  });

  it("uses only missing required catalog slots and preserves copy counts across binders", () => {
    const first = newBinder(set.id, "First");
    first.ordered = ["001:reverse"];
    first.extras = [{ id: "example", number: "", name: "Manual extra", required: true }];
    expect(missingPrintings(first, set, cards).map(printing => printing.variant)).toEqual(["normal"]);
    const rows = groupBuyingEntries([...missingPrintings(first, set, cards), ...missingPrintings(first, set, cards)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].copies).toBe(2);
    expect(matchesBuyingEntry(rows[0], "Bulbasaur 151")).toBe(true);
    expect(matchesBuyingEntry(rows[0], "reverse")).toBe(false);
  });

  it("expires offers at ten minutes and ranks condition before price", () => {
    const now = Date.parse("2026-11-24T21:00:00Z");
    const quote = (store: string, rank: number, priceCents: number, age: number): RetailOffer => ({
      store, condition: "Condition", conditionRank: rank, priceCents, currency: "CAD", url: "https://example.test/product",
      checkedAt: new Date(now - age).toISOString(),
    });
    const offers = [quote("expired", 0, 1, 600_000), quote("lower condition", 2, 3, 0),
      quote("highest", 0, 800, 0), quote("same condition", 0, 700, 1_000)];
    expect(freshOffers(offers, now).map(offer => offer.store)).toEqual(["same condition", "highest", "lower condition"]);
  });
});
