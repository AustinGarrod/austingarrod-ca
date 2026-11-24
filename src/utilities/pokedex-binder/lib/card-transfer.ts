import { csv } from "./list-export";
import { newBinder, setSlots, type MasterState, type SetBinder, type SetCard, type SetSummary, type Variant } from "./master";
import { cardNameKey, findNumberedTransferSets, findTransferSets, identityText, numberKey, type ProductIdentity } from "./transfer-identity";
import type { TransferRow } from "./transfer-csv";

export interface TransferCatalog {
  sets: readonly SetSummary[];
  cards: (setId: string) => Promise<SetCard[]>;
  products: () => Promise<Record<string, ProductIdentity>>;
}
export interface TransferMatch { set: SetSummary; card: SetCard; variant?: Variant }
export interface ReviewedCard {
  line: number;
  label: string;
  quantity: number;
  match?: TransferMatch;
  choices?: TransferMatch[];
  reason?: string;
}

const finishAliases: Record<string, string> = {
  normal: "normal", regular: "normal", nonfoil: "normal", nonholo: "normal", false: "normal",
  normalholo: "holo", holofoil: "holo", normalholofoil: "holo", holo: "holo",
  reverseholo: "reverse", reversefoil: "reverse", reverseholofoil: "reverse", reverse: "reverse",
};
function finishOptions(card: SetCard, row: TransferRow, shadowless: boolean): Variant[] {
  const variants = shadowless ? card.variants.filter(v => v.id.includes("subtype=shadowless")) : card.variants;
  if (row.variantId) return variants.filter(v => v.id === row.variantId);
  if (!row.finish?.trim()) return variants;
  const key = identityText(row.finish);
  const explicit = variants.filter(v => identityText(v.label) === key || identityText(v.id) === key);
  if (explicit.length) return explicit;
  if (key === "foil" || key === "true") return variants.filter(v => /^(holo|reverse)(\+|$)/.test(v.id));
  const unlimited = key.match(/^unlimited(holo(?:foil)?)?$/);
  if (unlimited) return variants.filter(v => (shadowless ? !v.id.includes("stamp=") : v.id.includes("subtype=unlimited") || !v.specialty)
    && (!unlimited[1] || v.id.split("+")[0] === "holo"));
  const pattern = key.match(/^(pokeball|masterball)(?:reverseholo(?:foil)?|reversefoil)?$/);
  if (pattern) return variants.filter(v => v.id === `reverse+foil=${pattern[1]}`);
  const edition = key.match(/^(?:1st|first)edition(holo(?:foil)?|normal|nonholo|nonfoil)?$/);
  const shadow = key.match(/^shadowless(holo(?:foil)?|normal|nonholo|nonfoil)?$/);
  if (edition || shadow) {
    const baseFinish = (edition ?? shadow)![1];
    const type = baseFinish?.startsWith("holo") ? "holo" : "normal";
    return variants.filter(v => (edition ? v.id.includes("stamp=1st-edition") : v.id.includes("subtype=shadowless") && !v.id.includes("stamp="))
      && (!baseFinish || v.id.split("+")[0] === type));
  }
  const finish = finishAliases[key];
  return finish ? variants.filter(v => v.id.split("+")[0] === finish && (shadowless ? !v.id.includes("stamp=") : !v.specialty)) : [];
}

function eligibility(row: TransferRow): { quantity: number; reason?: string } {
  const qty = row.quantity === undefined ? "1" : row.quantity;
  const quantity = /^\d+$/.test(qty) && Number.isSafeInteger(Number(qty)) ? Number(qty) : 0;
  if (row.watchlist && !["no", "false", "0", "n", "off"].includes(row.watchlist.toLowerCase())) return { quantity, reason: "Watchlist entry" };
  if (row.game && !["pokemon", "pokemontcg", "pokemonen", "pokemonenglish", "pokemontcgen"].includes(identityText(row.game))) return { quantity, reason: "Different game or product type" };
  if (row.region && identityText(row.region) !== "international") return { quantity, reason: "Unsupported TCG region" };
  if (row.language && !/^(?:english|en)(?:[- ](?:us|gb|uk))?$/i.test(row.language)) return { quantity, reason: "Catalog covers English cards" };
  if (!quantity) return { quantity, reason: "Quantity must be a positive whole number" };
  return { quantity };
}

export async function reviewCards(rows: TransferRow[], catalog: TransferCatalog, forDex: boolean): Promise<ReviewedCard[]> {
  const reviewed = new Map<number, ReviewedCard>();
  const work = new Map<SetSummary, { row: TransferRow; result: ReviewedCard; product?: ProductIdentity }[]>();
  const setCache = new Map<string, SetSummary[]>();
  let products: Record<string, ProductIdentity> | undefined;
  for (const row of rows) {
    const { quantity, reason } = eligibility(row);
    const label = [row.name || row.productId || "Card", row.set, row.number && `#${row.number}`, row.finish]
      .filter(Boolean).map(value => value!.slice(0, 120)).join(" · ");
    const result: ReviewedCard = { line: row.line, label, quantity, reason };
    reviewed.set(row.line, result);
    if (reason) continue;
    if (row.productId && !products) products = await catalog.products();
    const product = row.productId && products && Object.hasOwn(products, row.productId) ? products[row.productId] : undefined;
    const number = row.number || product?.[1] || "";
    const setKey = JSON.stringify([row.set ?? "", row.set ? number.match(/^(tg|gg|sv)/i)?.[0].toLowerCase() : product?.[0]]);
    let sets = setCache.get(setKey);
    if (!sets) {
      sets = row.set ? findNumberedTransferSets(catalog.sets, row.set, number) : product ? findTransferSets(catalog.sets, product[0]) : [];
      setCache.set(setKey, sets);
    }
    if (product && row.set && sets.length && !sets.some(set => set.id === product[0])) {
      result.reason = "Set and Product ID disagree";
      continue;
    }
    const candidates = product && sets.length > 1 ? sets.filter(set => set.id === product[0]) : sets;
    if (!candidates.length) { result.reason = row.set ? "Set is outside the catalog" : "Set or Product ID was not recognized"; continue; }
    for (const set of candidates) {
      if (!work.has(set)) work.set(set, []);
      work.get(set)!.push({ row, result, product });
    }
  }
  const candidates = new Map<ReviewedCard, { options: TransferMatch[]; exact: boolean; rank: number }>();
  const pending = [...work];
  // Reuse the same set shards as the binders, with a bounded number of concurrent reads.
  for (let i = 0; i < pending.length; i += 6) {
    await Promise.all(pending.slice(i, i + 6).map(async ([set, entries]) => {
      const cards = await catalog.cards(set.id);
      const byNumber = Map.groupBy(cards, card => numberKey(card.number));
      const byName = Map.groupBy(cards, card => cardNameKey(card.name));
      for (const { row, result, product } of entries) {
        const number = row.number || product?.[1];
        const key = number ? numberKey(number) : "";
        const numbered = key ? byNumber.get(key) ?? [] : [];
        const named = row.name ? byName.get(cardNameKey(row.name)) ?? [] : [];
        const matching = numbered.length ? numbered.filter(card => !row.name || named.includes(card)) : [];
        const conflicting = !!(row.number && product && numberKey(row.number) !== numberKey(product[1]));
        const possible = matching.length && !conflicting ? matching : [...new Set([...numbered, ...named])];
        const withProduct = product?.[0] === set.id && (row.number ? !conflicting : true);
        const shadowless = (withProduct && product?.[2] === "shadowless") || identityText(row.set ?? "") === "basesetshadowless";
        const options = possible.flatMap(card => {
          if (forDex) return [{ set, card }];
          const finishes = finishOptions(card, row, shadowless);
          return (finishes.length ? finishes : card.variants).map(variant => ({ set, card, variant }));
        });
        const exact = matching.length === 1 && !conflicting && (forDex || finishOptions(matching[0], row, shadowless).length === 1);
        const rank = matching.length && !conflicting ? 2 : numbered.length ? 1 : 0;
        const previous = candidates.get(result);
        if (previous && previous.rank > rank) continue;
        const existing = previous?.rank === rank ? previous : { options: [], exact: false, rank };
        existing.options.push(...options);
        existing.exact ||= exact;
        candidates.set(result, existing);
      }
    }));
  }
  for (const [result, { options, exact, rank }] of candidates) {
    if (exact && options.length === 1) result.match = options[0];
    else if (options.length) {
      result.choices = options;
      result.reason = "Choose the matching card or finish";
    } else result.reason = rank ? "Finish is outside the catalog" : "Card was not found in that set";
  }
  return [...reviewed.values()];
}

export interface SetImportGroup { set: SetSummary; marks: TransferMatch[]; options: SetBinder[] }
export function groupSetImport(matches: TransferMatch[], state: MasterState): SetImportGroup[] {
  return [...Map.groupBy(matches, match => match.set.id).values()].map(marks => ({ set: marks[0].set,
    marks: [...new Map(marks.map(match => [markKey(match), match])).values()],
    options: state.binders.filter(b => b.setId === marks[0].set.id),
  })).sort((a, b) => a.set.name.localeCompare(b.set.name));
}
export const markKey = (match: TransferMatch) => `${match.card.number}:${match.variant?.id ?? "*"}`;

export function addSetImports(state: MasterState, groups: SetImportGroup[], destinations: ReadonlyMap<string, string>) {
  for (const { set, marks, options } of groups) {
    const destination = destinations.get(set.id);
    const binder = destination ? state.binders.find(b => b.id === destination && b.setId === set.id) : undefined;
    const current = state.binders.filter(b => b.setId === set.id);
    if (current.length !== options.length || current.some(b => !options.some(option => option.id === b.id)) || (current.length && !binder)) {
      throw new Error("The destination binders changed. Review the import again.");
    }
    const target = binder ?? newBinder(set.id, set.name.slice(0, 100));
    if (!binder) state.binders.push(target);
    target.owned = [...new Set([...target.owned, ...marks.map(markKey)])].sort();
    const specialties = marks.filter(match => match.variant?.specialty && !target.specialties.includes(match.variant.id)).map(markKey);
    target.specialties = [...new Set([...target.specialties, ...specialties])].sort();
  }
}

function binderLootFinish(variant: Variant) {
  const id = variant.id.replace("+subtype=unlimited", "");
  const names: Record<string, string> = {
    normal: "Normal", holo: "Normal Holo", reverse: "Reverse Holo",
    "reverse+foil=pokeball": "Poké Ball Reverse Holo", "reverse+foil=masterball": "Master Ball Reverse Holo",
    "normal+subtype=shadowless": "Shadowless", "holo+subtype=shadowless": "Shadowless Holo",
    "normal+subtype=shadowless+stamp=1st-edition": "1st Edition", "holo+subtype=shadowless+stamp=1st-edition": "1st Edition Holo",
    "normal+stamp=1st-edition": "1st Edition", "holo+stamp=1st-edition": "1st Edition Holo",
  };
  return names[id];
}

export const tcgplayerConditions = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"] as const;
export type TcgplayerCondition = typeof tcgplayerConditions[number];

const tcgplayerPrintings: Record<string, readonly string[]> = {
  normal: ["Normal", "Unlimited"], holo: ["Holofoil", "Unlimited Holofoil"], reverse: ["Reverse Holofoil"],
  "normal+subtype=unlimited": ["Unlimited", "Normal"], "holo+subtype=unlimited": ["Unlimited Holofoil", "Holofoil"],
  "normal+subtype=shadowless": ["Unlimited", "Normal"], "holo+subtype=shadowless": ["Unlimited Holofoil", "Holofoil"],
  "normal+stamp=1st-edition": ["1st Edition"], "holo+stamp=1st-edition": ["1st Edition Holofoil"],
  "normal+subtype=shadowless+stamp=1st-edition": ["1st Edition"], "holo+subtype=shadowless+stamp=1st-edition": ["1st Edition Holofoil"],
};

function tcgplayerProduct(products: [string, ProductIdentity][], variant: Variant) {
  const printings = tcgplayerPrintings[variant.id];
  if (!printings) return;
  const shadowless = variant.id.includes("+subtype=shadowless");
  const matches = products.flatMap(([productId, [, , subtype, listed]]) => {
    if (shadowless !== (subtype === "shadowless")) return [];
    const printing = printings.find(name => listed?.includes(name));
    return printing ? [{ productId, printing }] : [];
  });
  if (matches.length === 1) return matches[0];
}

export type CardExportFormat = "portable" | "binderloot" | "tcgplayer";
export type CardExportList = "owned" | "missing";

export async function exportCards(
  binders: readonly SetBinder[],
  catalog: TransferCatalog,
  { format, list, condition }: { format: CardExportFormat; list: CardExportList; condition?: TcgplayerCondition },
) {
  const missing = list === "missing";
  const forTcgplayer = format === "tcgplayer";
  if (forTcgplayer && (!condition || !tcgplayerConditions.includes(condition))) {
    throw new Error("Choose the condition for the TCGplayer export.");
  }
  const products = forTcgplayer ? Map.groupBy(Object.entries(await catalog.products()), ([, [setId, number]]) => `${setId}:${number}`) : null;
  const createdAt = forTcgplayer ? new Date().toISOString().replace(/Z$/, "+0000") : "";
  const collectionName = missing ? "Pokémon Binder Tracker - Missing Cards" : "Pokémon Binder Tracker";
  const sets = new Map(catalog.sets.map(set => [set.id, set]));
  const rows: (string | number)[][] = [], exported = new Set<string>(), omitted = new Set<string>();
  for (const binder of binders) {
    if (!missing && !binder.owned.length) continue;
    const set = sets.get(binder.setId);
    const setCards = set ? await catalog.cards(set.id) : [];
    const cards = new Map(setCards.map(card => [card.number, card]));
    const keys = missing ? setSlots(binder, setCards).filter(slot => slot.required && !slot.owned).map(slot => slot.key) : binder.owned;
    for (const key of keys) {
      const colon = key.indexOf(":"), number = key.slice(0, colon);
      const card = cards.get(number);
      const finishId = key.slice(colon + 1);
      const anyFinish = missing && finishId === "*";
      const targetId = anyFinish && card?.variants.length === 1 ? card.variants[0].id : finishId;
      const allowUnspecified = missing && !anyFinish && format === "portable";
      const variant = card?.variants.find(v => v.id === targetId && (allowUnspecified || !v.id.startsWith("unspecified")));
      const unique = `${binder.setId}:${variant ? `${number}:${variant.id}` : key}`;
      if (exported.has(unique) || omitted.has(unique)) continue;
      if (!set || !card || (!variant && !(anyFinish && format === "portable"))) { omitted.add(unique); continue; }
      const externalFinish = format === "binderloot" && variant ? binderLootFinish(variant) : null;
      const product = products && variant && tcgplayerProduct(products.get(`${set.id}:${card.number}`) ?? [], variant);
      if ((forTcgplayer && !product) || (format === "binderloot" && !externalFinish)) { omitted.add(unique); continue; }
      exported.add(unique);
      if (product && condition) rows.push([collectionName, createdAt, product.productId, condition, "English", product.printing, 1]);
      else if (format === "portable") rows.push([set.id, set.code, set.name, card.number, card.name, variant?.id ?? "", variant?.label ?? "Any finish", "English", 1]);
      else {
        const printedNumber = set.printedTotal && /^\d+$/.test(card.number) ? `${card.number}/${set.printedTotal}` : card.number;
        rows.push(["International", card.name, printedNumber, "", set.name, "", externalFinish!, "English", "Unspecified", 1, "", "", ""]);
      }
    }
  }
  const headers = forTcgplayer ? ["Collection Name", "Created At", "ProductID", "Condition", "Language", "Variant", "Quantity"]
    : format === "portable" ? ["Set ID", "Set code", "Set name", "Collector number", "Card name", "Variant ID", "Finish", "Language", "Quantity"]
    : ["TCG region", "Card name", "Card number", "Card number sorting order", "Expansion", "Rarity", "Card variant", "Card language", "Card condition", "Quantity", "Price", "Total price", "Note"];
  const text = csv(headers, rows);
  return { text: forTcgplayer ? text.slice(1) : text, exported: exported.size, omitted: omitted.size };
}
