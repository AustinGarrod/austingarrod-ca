import { tcgplayerProduct } from "../src/utilities/pokedex-binder/lib/tcgplayer-identity.ts";
import { cardNameKey, findTransferSetNames, findTransferSets, numberKey } from "../src/utilities/pokedex-binder/lib/transfer-identity.ts";

export function tcgplayerCardName(name, number) {
  // TCGplayer appends the collector number to some names with multiple cards in the same set.
  const suffix = name.match(/\s+\(([a-z]*\d+[a-z]*)\)$/i);
  if (suffix && numberKey(suffix[1]) === numberKey(number)) return cardNameKey(name.slice(0, suffix.index));
  return cardNameKey(name);
}

export function tcgplayerGroupSet(sets, group) {
  const byName = findTransferSetNames(sets, group.name);
  if (byName.length === 1) return byName[0];
  const byCode = findTransferSets(sets, group.abbreviation ?? "");
  const candidates = byName.length ? byName.filter(set => byCode.includes(set)) : byCode;
  if (candidates.length === 1) return candidates[0];
}

export function marketPrintingCrosswalk(cardsBySet, products, groupsBySet) {
  const byNumber = Map.groupBy(Object.entries(products), ([, [set, number]]) => JSON.stringify([set, number]));
  const byPrice = new Map();
  for (const [set, cards] of cardsBySet) {
    if (!groupsBySet.has(set)) continue;
    for (const { number, variants } of cards) {
      const candidates = byNumber.get(JSON.stringify([set, number])) ?? [];
      for (const variant of variants) {
        const price = tcgplayerProduct(candidates, variant);
        if (!price) continue;
        const key = JSON.stringify([price.productId, price.printing]);
        // A provider price must identify only one catalog printing.
        byPrice.set(key, byPrice.has(key) ? null : { set, number, variant: variant.id, ...price });
      }
    }
  }

  const sets = {};
  for (const match of byPrice.values()) {
    if (!match) continue;
    const { set, number, variant, productId, printing } = match;
    ((sets[set] ??= {})[number] ??= {})[variant] = [Number(productId), printing];
  }
  const groups = [...new Set(Object.keys(sets).flatMap(set => groupsBySet.get(set)))].sort((a, b) => a - b);
  return { schemaVersion: 1, groups, sets };
}
