import type { SetSummary } from "./master";
import { findTransferSets, identityText, numberKey } from "./transfer-identity";

export type CatalogSearchCard = [number: string, name: string, speciesNames?: string[]];
export interface CatalogSearchSet extends Pick<SetSummary, "id" | "name" | "code" | "printedTotal" | "artwork"> {
  cards: CatalogSearchCard[];
}
export interface CatalogSearchIndex {
  schemaVersion: 1;
  sets: CatalogSearchSet[];
}

export interface CatalogResult {
  set: CatalogSearchSet;
  number: string;
  name: string;
}

export interface CatalogPrinting {
  setId: string;
  setName: string;
  number: string;
  name: string;
  variant: string;
  finish: string;
  image?: string | null;
}

const markedNumber = /^#([^/#\s]+)(?:\/([a-z]*\d+[a-z]*))?$/i;
const printedNumber = /^([a-z]*\d+[a-z]*)\/([a-z]*\d+[a-z]*)$/i;
const plainNumber = /^[a-z]*\d+[a-z]*$/i;

export function catalogNumberLabel(number: string): string {
  // The existing catalog stores the Unown question-mark collector number as %3F.
  return number.replace(/^%3f$/i, "?");
}

export function createCardIndex(sets: CatalogSearchSet[]) {
  return sets.map(set => ({
    set,
    keys: [set.id, set.code, set.name].map(identityText).filter(Boolean),
    cards: set.cards.map(([number, name, speciesNames]) => ({
      number, name, numberKey: numberKey(catalogNumberLabel(number)), nameKey: identityText(name),
      speciesKeys: (speciesNames ?? []).map(identityText),
    })),
  }));
}

export function searchCards(index: ReturnType<typeof createCardIndex>, input: string, selectedSetId = ""): CatalogResult[] {
  const query = input.trim(), phrase = identityText(query);
  const terms = query.replace(/\s*\/\s*/g, "/").replace(/#\s+/g, "#").split(/\s+/)
    .map(value => ({ value, key: identityText(value), number: value.match(markedNumber) ?? value.match(printedNumber) }))
    .filter(term => term.key || term.number);
  if (!terms.length && !selectedSetId) return [];
  const exactSets = !selectedSetId && phrase && !query.startsWith("#")
    ? new Set(findTransferSets(index.map(entry => entry.set), query).map(set => set.id))
    : new Set<string>();
  const matches: { result: CatalogResult; rank: number }[] = [];
  for (const { set, keys, cards } of index) {
    if (selectedSetId && set.id !== selectedSetId) continue;
    if (exactSets.size && !exactSets.has(set.id)) continue;
    for (const card of cards) {
      const result = { set, number: card.number, name: card.name };
      if (!terms.length || exactSets.size) {
        matches.push({ result, rank: 0 });
        continue;
      }
      if (!terms.every(({ value, key, number }) => {
        if (number) {
          if (card.numberKey !== numberKey(catalogNumberLabel(number[1]))) return false;
          if (!number[2]) return true;
          const total = numberKey(number[2]).match(/^([a-z]*)(\d+)$/);
          return total && (!total[1] || card.numberKey.startsWith(total[1])) && Number(total[2]) === set.printedTotal;
        }
        if (plainNumber.test(value) && card.numberKey === numberKey(value)) return true;
        return card.nameKey.includes(key) || card.speciesKeys.some(species => species.includes(key)) ||
          keys.some(setKey => plainNumber.test(value) ? setKey === key : setKey.includes(key));
      })) continue;
      const rank = card.nameKey === phrase ? 0 : card.nameKey.startsWith(phrase) ? 1
        : card.nameKey.includes(phrase) ? 2 : card.speciesKeys.includes(phrase) ? 3 : 4;
      matches.push({ result, rank });
    }
  }
  return matches.sort((a, b) => a.rank - b.rank).map(({ result }) => result);
}

export function catalogArtwork(set: Pick<SetSummary, "id" | "artwork">, number: string): string | null {
  return set.artwork && !set.artwork.missing.includes(number)
    ? "https://assets.tcgdex.net/en/" + [set.artwork.series, set.id, number].map(encodeURIComponent).join("/") + "/low.webp"
    : null;
}
