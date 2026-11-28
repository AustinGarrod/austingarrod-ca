export const identityText = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/♀/g, " female ").replace(/♂/g, " male ")
  .replace(/&/g, " and ").replace(/[^a-z0-9]/g, "");

export function collectorNumber(value: string): string {
  return value.trim().replace(/\s*\/\s*[a-z]*\d+[a-z]*\s*$/i, "");
}

export function numberKey(value: string): string {
  return collectorNumber(value).toLowerCase().replace(/^([a-z]*)0+(?=\d)/, "$1");
}

const numberedNameSuffix = /\s+-\s+([a-z]*\d+)\s*\/\s*[a-z]*\d+\s*$/i;

export function embeddedCollectorNumber(name: string): string {
  return name.match(numberedNameSuffix)?.[1] ?? "";
}

export function cardNameKey(name: string): string {
  return identityText(name.replace(numberedNameSuffix, ""));
}

const aliases: Record<string, readonly string[]> = {
  base1: ["Base Set (Shadowless)"], ex1: ["EX Ruby & Sapphire"],
  ex2: ["EX Sandstorm"], ex3: ["EX Dragon"],
  "sv03.5": ["Scarlet & Violet 151", "Scarlet & Violet—151"],
};

interface SetIdentity { id: string; code: string; name: string }

const setNameKey = (value: string) =>
  identityText(value.replace(/^(?:SV|SWSH|SM|XY|BW|ME|HGSS|DP|PL|EX)\d*(?:\.\d+)?\s*:\s*/i, ""));

function matchesSetName(set: SetIdentity, name: string) {
  return identityText(set.name) === name || aliases[set.id]?.some(alias => identityText(alias) === name)
    || (name.startsWith("ex") && /^ex\d+$/.test(set.id) && identityText(set.name) === name.slice(2));
}

export function findTransferSetNames<T extends SetIdentity>(sets: readonly T[], value: string): T[] {
  const name = setNameKey(value);
  return name ? sets.filter(set => matchesSetName(set, name)) : [];
}

export function findTransferSets<T extends SetIdentity>(sets: readonly T[], value: string): T[] {
  const raw = value.trim().toLowerCase();
  if (!raw) return [];
  const exactId = sets.find(set => set.id.toLowerCase() === raw);
  if (exactId) return [exactId];
  const key = identityText(value);
  if (!key) return [];
  const name = setNameKey(value);
  return sets.filter(set => identityText(set.code) === key || matchesSetName(set, name));
}

export function findNumberedTransferSets<T extends SetIdentity>(sets: readonly T[], value: string, ...numbers: string[]): T[] {
  const candidates = findTransferSets(sets, value);
  const names: Record<string, string> = { tg: "Trainer Gallery", gg: "Galarian Gallery", sv: "Shiny Vault" };
  const suffixes = [...new Set(numbers.flatMap(number => {
    const prefix = numberKey(number).match(/^(tg|gg|sv)\d/)?.[1];
    return prefix ? [names[prefix]] : [];
  }))];
  if (!suffixes.length) return candidates;
  return [...new Set(candidates.flatMap(set => [set, ...sets.filter(item =>
    suffixes.some(suffix => item.name === `${set.name} ${suffix}`))]))];
}

export type ProductIdentity = [setId: string, number: string, subtype?: "shadowless" | null, printings?: string[]];
