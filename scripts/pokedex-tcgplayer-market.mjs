import { tcgplayerProduct } from "../src/utilities/pokedex-binder/lib/tcgplayer-identity.ts";
import { cardNameKey, findTransferSetNames, findTransferSets, numberKey } from "../src/utilities/pokedex-binder/lib/transfer-identity.ts";

// The Binder numbers Classic Collection cards in checklist order. TCGplayer uses the original printed numbers.
const classicCollectorNumbers = new Map([
  ["4/102", ["001"]],
  ["5/109", ["002"]],
  ["11/113", ["003", "Metagross (Delta Species)", "Metagross"]],
  ["11/101", ["004", "Genesect EX (Team Plasma)", "Genesect EX"]],
  ["18/132", ["005"]],
  ["19/109", ["006"]],
  ["25/111", ["007"]],
  ["33/181", ["008"]],
  ["41/122", ["009"]],
  ["43/146", ["010"]],
  ["47/127", ["011"]],
  ["50/185", ["012"]],
  ["57/111", ["013"]],
  ["58/102", ["014"]],
  ["69/132", ["015"]],
  ["85/124", ["016"]],
  ["89/149", ["017"]],
  ["94/102", ["018", "Gengar (Prime)", "Gengar"]],
  ["99/102", ["019", "Darkrai & Cresselia Legend (Top)", "Darkrai & Cresselia LEGEND"]],
  ["100/102", ["020", "Darkrai & Cresselia Legend (Bottom)", "Darkrai & Cresselia LEGEND"]],
  ["101/101", ["021", "N (Supporter)", "N"]],
  ["106/106", ["022", "Palkia LV.X", "Palkia"]],
  ["106/160", ["023"]],
  ["106/105", ["024"]],
  ["108/115", ["025"]],
  ["114/264", ["026"]],
  ["123/172", ["027"]],
  ["138/202", ["028"]],
  ["149/147", ["029"]],
  ["203/193", ["030"]],
]);

export function tcgplayerCardName(name, number) {
  // TCGplayer appends the collector number to some names with multiple cards in the same set.
  const suffix = name.match(/\s+\(([a-z]*\d+[a-z]*)\)$/i);
  if (suffix && numberKey(suffix[1]) === numberKey(number)) return cardNameKey(name.slice(0, suffix.index));
  return cardNameKey(name);
}

export function tcgplayerListingIdentity(setId, name, number) {
  if (setId === "30th-c") {
    const printedNumber = number.trim().replace(/^0+(?=\d)/, "");
    const entry = classicCollectorNumbers.get(printedNumber);
    if (!entry) return;
    const [binderNumber, marketplaceName, binderName] = entry;
    // Keep the top and bottom halves distinct by requiring the full provider name where it differs.
    if (marketplaceName && cardNameKey(name) !== cardNameKey(marketplaceName)) return;
    return [numberKey(binderNumber), cardNameKey(binderName ?? name)];
  }
  if (setId === "30th") {
    const rgb = number.match(/^([rgb])\/rgb$/i);
    if (rgb && cardNameKey(name) === cardNameKey(`Mew - ${number}`)) return [numberKey(rgb[1]), "mew"];
    if (numberKey(number) === "87" && cardNameKey(name) === "nidoranf") return ["87", cardNameKey("Nidoran♀")];
  }
  if (setId === "mee") {
    const energy = name.match(/^(Basic .+ Energy) - (\d+) \(30th Celebration\)$/i);
    if (energy && numberKey(energy[2]) === numberKey(number)) return [numberKey(number), cardNameKey(energy[1])];
  }
  return [numberKey(number), tcgplayerCardName(name, number)];
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
