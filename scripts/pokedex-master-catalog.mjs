import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const english = (name) => name?.en ?? Object.entries(name ?? {}).find(([lang]) => lang.startsWith("en-"))?.[1];
const words = (value) => value.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
const types = { normal: "Regular", holo: "Holo", reverse: "Reverse holo", unspecified: "Finish unspecified" };
function normalizeVariants(raw) {
  let entries;
  if (Array.isArray(raw)) {
    entries = raw.filter((item) => !item.languages || item.languages.some((lang) => /^en($|-)/.test(lang)));
  } else {
    entries = Object.entries(raw ?? {})
      .filter(([, value]) => value === true)
      .map(([type]) => ({ type }));
  }
  if (!entries.length) entries = [{ type: "unspecified" }];
  const variants = new Map();
  for (const entry of entries) {
    const { type, foil, subtype, stamp = [], size } = entry;
    const stamps = [...new Set(stamp)].sort();
    const format = size && size !== "standard" ? size : undefined;
    const parts = [type, subtype, foil, ...stamps, format].filter(Boolean);
    const id = [
      type,
      subtype && "subtype=" + subtype,
      foil && "foil=" + foil,
      ...stamps.map((s) => "stamp=" + s),
      format && "size=" + format,
    ]
      .filter(Boolean)
      .join("+");
    const label = parts.map((part) => types[part] ?? words(part)).join(" · ");
    const specialty = Boolean(
      foil || (subtype && subtype !== "unlimited") || stamps.length || format || !Object.hasOwn(types, type),
    );
    variants.set(id, { id, label, specialty });
  }
  return [...variants.values()].sort(
    (a, b) =>
      Number(a.specialty) - Number(b.specialty) ||
      ["normal", "holo", "reverse"].indexOf(a.id) - ["normal", "holo", "reverse"].indexOf(b.id) ||
      a.id.localeCompare(b.id, "en"),
  );
}

export function masterCatalog(cards) {
  const sets = new Map();
  for (const { number, card } of cards) {
    const set = card.set;
    if (!english(card.name) || !english(set?.name) || !english(set.serie?.name) || set.serie.id === "tcgp") continue;
    if (!["Pokemon", "Trainer", "Energy"].includes(card.category)) continue;
    if (!/^[a-zA-Z0-9._-]+$/.test(set.id)) throw new Error("Invalid set identifier");
    if (!sets.has(set.id))
      sets.set(set.id, {
        id: set.id,
        name: english(set.name),
        code: set.abbreviations?.official ?? set.tcgOnline ?? "",
        printedTotal: Number.isSafeInteger(set.cardCount?.official) && set.cardCount.official > 0 ? set.cardCount.official : null,
        cards: [],
      });
    sets
      .get(set.id)
      .cards.push({
        number,
        name: english(card.name),
        category: card.category,
        variants: normalizeVariants(card.variants),
      });
  }
  return sets;
}

export function artworkForSet(id, cards, assets) {
  for (const [series, sets] of Object.entries(assets.en ?? {})) {
    const listings = sets[id];
    if (!listings) continue;
    const missing = cards.filter(card => !Object.hasOwn(listings, card.number)).map(card => card.number);
    return missing.length === cards.length ? null : { series, missing };
  }
  return null;
}

export async function writeMasterCatalog(cards, destination, assets) {
  const sets = masterCatalog(cards);
  const index = [];
  await mkdir(destination, { recursive: true });
  for (const set of [...sets.values()].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    set.cards.sort(
      (a, b) => a.number.localeCompare(b.number, "en", { numeric: true }) || a.number.localeCompare(b.number, "en"),
    );
    if (new Set(set.cards.map((c) => c.number)).size !== set.cards.length)
      throw new Error("Duplicate number in " + set.id);
    const bytes = JSON.stringify(set.cards) + "\n";
    await writeFile(path.join(destination, set.id + ".json"), bytes);
    index.push({
      id: set.id,
      name: set.name,
      code: set.code,
      count: set.cards.length,
      printedTotal: set.printedTotal,
      artwork: artworkForSet(set.id, set.cards, assets),
      digest: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(path.join(destination, "index.json"), JSON.stringify(index) + "\n");
  return index;
}
