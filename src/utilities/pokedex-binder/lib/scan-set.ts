import type { Slot } from "./master";
import { setCardKey } from "./binder-catalog";
import { normalizeSearch } from "./model";
import type { ScanLine } from "./scan-model";

export function scanCardId(slot: Slot) {
  return slot.key.startsWith("extra:") ? slot.key : setCardKey(slot);
}
const collectorNumber = (value: string) => value.toLowerCase().replace(/^([a-z]*)0+(?=\d)/, "$1");

/** Read the title only when the footer cannot identify one printed card. */
export async function matchSetCard(slots: Slot[], printedTotal: number | null, footer: ScanLine[], readTitle: () => Promise<string>) {
  const numbers = new Set<string>();
  const confidentNumbers = new Set<string>();
  let otherSet = false;
  for (const { text, confidence } of footer) {
    for (const [, number, total] of text.matchAll(/\b([a-z]{0,4}\d+[a-z]?)\s*\/\s*([a-z]*\d+)\b/gi)) {
      if (printedTotal && /^\d/.test(number) && /^\d+$/.test(total) && Number(total) !== printedTotal) {
        if (confidence >= 70) otherSet = true;
        continue;
      }
      const key = collectorNumber(number);
      numbers.add(key);
      if (confidence >= 70) confidentNumbers.add(key);
    }
  }
  if (otherSet && !numbers.size) return [];
  const numbered = slots.filter(s => numbers.has(collectorNumber(s.number)));
  const ids = (items: Slot[]) => [...new Set(items.map(scanCardId))];
  const byNumber = ids(numbered);
  if (!otherSet && numbers.size === 1 && confidentNumbers.size === 1 && byNumber.length === 1) return byNumber;

  const lines = (await readTitle()).split("\n").filter(line => !/evolves? from/i.test(line));
  // Require whole title words: "Mew" cannot identify a card headed "Mewtwo".
  const words = (value: string) => " " + value.split(/\s+/).map(normalizeSearch).filter(Boolean).join(" ") + " ";
  const titles = lines.map(words);
  const exact = slots.filter(slot => lines.some(line => normalizeSearch(line) === normalizeSearch(slot.name)));
  const named = exact.length ? exact : slots.filter(slot => titles.some(line => line.includes(words(slot.name))));
  const both = named.filter(slot => numbers.has(collectorNumber(slot.number)));
  if (both.length) return ids(both);
  if (named.length) return ids(named);
  return byNumber.length > 1 ? byNumber : [];
}
