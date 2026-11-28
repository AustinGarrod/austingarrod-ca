import { describe, expect, it } from "vitest";
import { marketPrintingCrosswalk, tcgplayerCardName, tcgplayerGroupSet } from "../../scripts/pokedex-tcgplayer-market.mjs";
import catalog from "../../public/utilities/pokedex-binder/catalog/tcgplayer-printings.json";

describe("TCGplayer market printing crosswalk", () => {
  it("uses the exact finish and separates catalog and marketplace editions", () => {
    expect(catalog.groups).toContain(23237);
    expect(catalog.sets["sv03.5"]["001"]).toEqual({
      normal: [502552, "Normal"],
      reverse: [502552, "Reverse Holofoil"],
    });
    expect(catalog.sets.base1["9"]).toMatchObject({
      "holo+subtype=unlimited": [42433, "Holofoil"],
      "holo+subtype=shadowless": [107003, "Unlimited Holofoil"],
      "holo+subtype=shadowless+stamp=1st-edition": [107003, "1st Edition Holofoil"],
    });
    expect(catalog.groups).toEqual(expect.arrayContaining([1373, 1428, 1441]));
    expect(catalog.sets.base5["9"]).toMatchObject({
      holo: [84613, "Unlimited Holofoil"],
      "holo+stamp=1st-edition": [84613, "1st Edition Holofoil"],
    });
  });

  it("matches numeric name suffixes only when they agree with the explicit collector number", () => {
    expect(tcgplayerCardName("Dark Hypno (9)", "09/82")).toBe("darkhypno");
    expect(tcgplayerCardName("Dark Hypno (26)", "09/82")).toBe("darkhypno26");
    expect(tcgplayerCardName("Dark Hypno (World Collection)", "09/82")).toBe("darkhypnoworldcollection");
  });

  it("prefers a unique provider set name when abbreviations collide across catalogs", () => {
    const rocket = { id: "base5", name: "Team Rocket", code: "RO" };
    const returns = { id: "ex7", name: "Team Rocket Returns", code: "TR" };
    expect(tcgplayerGroupSet([rocket, returns], { name: "Team Rocket", abbreviation: "TR" })).toBe(rocket);
    expect(tcgplayerGroupSet([rocket, returns], { name: "EX Team Rocket Returns", abbreviation: "TRR" })).toBe(returns);
  });

  it("omits shared price series, conflicting products and unsupported finishes", () => {
    const cards = new Map([["test", [
      { number: "001", variants: ["normal", "normal+subtype=unlimited", "reverse", "normal+stamp=cosmos"].map(id => ({ id })) },
      { number: "002", variants: [{ id: "holo" }] },
    ]]]);
    const products = {
      10: ["test", "001", null, ["Normal", "Reverse Holofoil"]],
      11: ["test", "002", null, ["Holofoil"]],
      12: ["test", "002", null, ["Holofoil"]],
    };
    expect(marketPrintingCrosswalk(cards, products, new Map([["test", [10]]]))).toEqual({
      schemaVersion: 1, groups: [10], sets: { test: { "001": { reverse: [10, "Reverse Holofoil"] } } },
    });
  });
});
