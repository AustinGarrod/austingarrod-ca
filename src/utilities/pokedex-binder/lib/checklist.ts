import { normalizeSearch, type Species } from "./model";

export interface ChecklistSet { id: string; name: string; code: string | null }
export type ChecklistSort = "dex" | "dex-desc" | "name" | "name-desc";
export const setLabel = (set: ChecklistSet) => `${set.name} (${set.code ?? "Code unavailable"})`;

export function filterChecklist(species: readonly Species[], sets: Record<string, ChecklistSet>, setSpecies: Record<string, number[]>, query: string, sort: ChecklistSort) {
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
  const names = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true, numeric: true });
  results.sort((a, b) => {
    const order = sort === "name" || sort === "name-desc" ? names.compare(a.name, b.name) || a.id - b.id : a.id - b.id;
    return sort === "name-desc" || sort === "dex-desc" ? -order : order;
  });
  return { species: results, sets: matching };
}
