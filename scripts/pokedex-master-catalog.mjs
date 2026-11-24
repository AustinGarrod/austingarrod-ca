import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { nonBoosterFinishes } from "./pokedex-non-booster-finishes.mjs";

const english = (name) => name?.en ?? Object.entries(name ?? {}).find(([lang]) => lang.startsWith("en-"))?.[1];
const words = (value) => value.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
const types = { normal: "Regular", holo: "Holo", reverse: "Reverse holo", unspecified: "Finish unspecified" };
const englishVariant = (entry) => !entry.languages || entry.languages.some((lang) => /^en($|-)/.test(lang));

function variantIdentity({ type, foil, subtype, stamp = [], size }) {
  const stamps = [...new Set(stamp)].sort();
  const format = size && size !== "standard" ? size : undefined;
  const id = [
    type,
    subtype && "subtype=" + subtype,
    foil && "foil=" + foil,
    ...stamps.map((value) => "stamp=" + value),
    format && "size=" + format,
  ].filter(Boolean).join("+");
  return { id, type, foil, subtype, stamps, format };
}

function normalizeVariants(raw, nonBoosterFinish) {
  let entries;
  if (Array.isArray(raw)) {
    entries = raw.filter(englishVariant);
  } else {
    entries = Object.entries(raw ?? {})
      .filter(([, value]) => value === true)
      .map(([type]) => ({ type }));
  }
  if (!entries.length) entries = [{ type: "unspecified" }];
  const variants = new Map();
  for (const entry of entries) {
    const { id, type, foil, subtype, stamps, format } = variantIdentity(entry);
    const parts = [type, subtype, foil, ...stamps, format].filter(Boolean);
    const label = parts.map((part) => types[part] ?? words(part)).join(" · ");
    const nonBooster = id === nonBoosterFinish;
    const specialty = nonBooster || Boolean(
      foil || (subtype && subtype !== "unlimited") || stamps.length || format || !Object.hasOwn(types, type),
    );
    variants.set(id, { id, label: nonBooster ? label + " · Non-booster printing" : label, specialty });
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
        variants: normalizeVariants(card.variants, nonBoosterFinishes.get(set.id + ":" + number)),
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

/** Match only explicit English product IDs that unambiguously identify a single price series. */
export function cardmarketPrintings(cards, sets = masterCatalog(cards)) {
  const catalog = new Map([...sets].map(([id, set]) => [id, new Map(set.cards.map((card) => [
    card.number, new Set(card.variants.map((variant) => variant.id)),
  ]))]));
  const byProduct = new Map();
  for (const { number, card } of cards) {
    const setId = card.set?.id;
    const allowed = catalog.get(setId)?.get(number);
    if (!allowed || !Array.isArray(card.variants)) continue;
    for (const entry of card.variants.filter(englishVariant)) {
      const productId = entry.thirdParty?.cardmarket;
      const { id, type, format } = variantIdentity(entry);
      if (!allowed.has(id) || !Number.isSafeInteger(productId) || productId <= 0) continue;
      const claims = byProduct.get(productId) ?? [];
      claims.push({
        key: JSON.stringify([setId, number, id]), cardKey: JSON.stringify([setId, number]),
        setId, number, id, type, format,
      });
      byProduct.set(productId, claims);
    }
  }

  const bySlot = new Map();
  for (const [productId, claims] of byProduct) {
    const base = new Map();
    const foil = new Map();
    const sameCard = claims.every((claim) => claim.cardKey === claims[0].cardKey);
    const includesNormal = claims.some((claim) => claim.type === "normal");
    for (const claim of claims) {
      if (claim.format || !["normal", "holo", "reverse"].includes(claim.type)) {
        // An unrecognized identity tied to the same listing can conflict with either price.
        base.set(claim.key, null);
        foil.set(claim.key, null);
      } else if (claim.type === "reverse" || (claim.type === "holo" && includesNormal)) {
        foil.set(claim.key, claim);
      } else {
        base.set(claim.key, claim);
      }
    }
    for (const [metric, bindings] of [["trend", base], ["trend-holo", foil]]) {
      for (const [key, claim] of bindings) {
        const candidates = bySlot.get(key) ?? [];
        candidates.push(sameCard && bindings.size === 1 && claim ? { claim, price: [productId, metric] } : null);
        bySlot.set(key, candidates);
      }
    }
  }

  const mappings = Object.create(null);
  for (const [, candidates] of [...bySlot].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    if (candidates.length !== 1 || !candidates[0]) continue;
    const { claim: { setId, number, id }, price } = candidates[0];
    const set = mappings[setId] ??= Object.create(null);
    const card = set[number] ??= Object.create(null);
    card[id] = price;
  }
  return { schemaVersion: 1, sets: mappings };
}

export async function writeCardmarketPrintings(cards, destination) {
  const mappings = cardmarketPrintings(cards);
  if (!Object.keys(mappings.sets).length) throw new Error("Refusing to write an empty Cardmarket crosswalk");
  await writeFile(destination, JSON.stringify(mappings) + "\n");
  return mappings;
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
