import { normalizeSearch, type Species } from "./model";

export interface ChecklistSet { id: string; name: string; code: string | null }
export type ChecklistSort = "dex" | "dex-desc" | "name" | "name-desc" | "collector" | "collector-desc";
type CollectorNumbers = Record<string, Record<number, readonly string[]>>;
export const setLabel = (set: ChecklistSet) => `${set.name} (${set.code ?? "Code unavailable"})`;
const names = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true, numeric: true });
const cardNumbers = new Intl.Collator("en", { numeric: true });

export function filterChecklist(species: readonly Species[], sets: Record<string, ChecklistSet>, setSpecies: Record<string, number[]>, query: string, sort: ChecklistSort, collectorNumbers?: CollectorNumbers | null) {
  const normalized = normalizeSearch(query.trim());
  const available = Object.values(sets);
  // A selected suggestion identifies one set, even when its name/code is shared in part by others.
  const exact = available.filter(set => normalizeSearch(setLabel(set)) === normalized
    || normalizeSearch(set.name) === normalized || (set.code && normalizeSearch(set.code) === normalized));
  let matching = exact;
  if (normalized && !exact.length) {
    matching = available.filter(set => normalizeSearch(set.name).includes(normalized) || (set.code && normalizeSearch(set.code).includes(normalized)));
  }
  const ids = normalized ? new Set(matching.flatMap(set => setSpecies[set.id] ?? [])) : null;
  const results = species.filter(item => !ids || ids.has(item.id));
  const setNumbers = matching.length === 1 ? collectorNumbers?.[matching[0].id] : undefined;
  if (setNumbers && (sort === "collector" || sort === "collector-desc")) {
    const lowestNumbers = new Map(results.map(({ id }) => {
      const lowest = setNumbers[id]?.reduce<string | undefined>((first, number) =>
        first === undefined || cardNumbers.compare(number, first) < 0 ? number : first, undefined);
      return [id, lowest] as const;
    }));
    const direction = sort === "collector-desc" ? -1 : 1;
    results.sort((a, b) => {
      const left = lowestNumbers.get(a.id), right = lowestNumbers.get(b.id);
      if (left === undefined || right === undefined) {
        return Number(left === undefined) - Number(right === undefined) || a.id - b.id;
      }
      return direction * cardNumbers.compare(left, right) || a.id - b.id;
    });
    return { species: results, sets: matching };
  }
  results.sort((a, b) => {
    const order = sort === "name" || sort === "name-desc" ? names.compare(a.name, b.name) || a.id - b.id : a.id - b.id;
    return sort === "name-desc" || sort === "dex-desc" ? -order : order;
  });
  return { species: results, sets: matching };
}
