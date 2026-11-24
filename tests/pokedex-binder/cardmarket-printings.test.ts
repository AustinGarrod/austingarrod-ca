import { describe, expect, it } from "vitest";
import { cardmarketPrintings } from "../../scripts/pokedex-master-catalog.mjs";

const set = { id: "test", name: { en: "Fixture Set" }, serie: { id: "fixture", name: { en: "Fixture series" } } };

function printing(type: string, id: number, options = {}) {
  return { type, thirdParty: { cardmarket: id }, ...options };
}

function card(number: string, ...variants: ReturnType<typeof printing>[]) {
  return { number, card: { set, category: "Pokemon", name: { en: "Bulbasaur" }, variants } };
}

describe("Cardmarket printing crosswalk", () => {
  it("uses separate series for regular and reverse, including distinct promotional product IDs", () => {
    const { sets } = cardmarketPrintings([
      card("001",
        printing("normal", 101),
        printing("normal", 101), // Repeated English metadata does not make this ambiguous.
        printing("reverse", 101),
        printing("normal", 102, { stamp: ["set-logo"] }),
        printing("reverse", 103, { foil: "cosmos" })),
      card("002", printing("holo", 104)),
      card("003", printing("normal", 105), printing("holo", 105)),
    ]);
    expect(sets.test).toEqual({
      "001": { normal: [101, "trend"], reverse: [101, "trend-holo"], "normal+stamp=set-logo": [102, "trend"], "reverse+foil=cosmos": [103, "trend-holo"] },
      "002": { holo: [104, "trend"] },
      "003": { normal: [105, "trend"], holo: [105, "trend-holo"] },
    });
  });

  it("omits ambiguous vintage, cross-number, and conflicting product references", () => {
    const { sets } = cardmarketPrintings([
      card("004",
        printing("holo", 201, { subtype: "shadowless" }),
        printing("holo", 201, { subtype: "1st-edition" }),
        printing("holo", 202, { subtype: "unlimited" })),
      card("005", printing("normal", 203), printing("normal", 204)),
      card("006", printing("normal", 205)),
      card("007", printing("reverse", 205)),
      card("008", printing("normal", 206), printing("normal", 207, { languages: ["fr"] })),
      card("009", printing("holo", 208), printing("holo", 208, { size: "jumbo" })),
    ]);
    expect(sets.test).toEqual({
      "004": { "holo+subtype=unlimited": [202, "trend"] },
      "008": { normal: [206, "trend"] },
    });
  });
});
