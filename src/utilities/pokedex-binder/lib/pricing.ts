import { setSlots, type SetBinder, type SetCard, type SetSummary } from "./master";
import { normalizeSearch } from "./model";
import { numberKey } from "./transfer-identity";

export interface PricingTarget {
  setId: string;
  setName: string;
  number: string;
  name: string;
  variant: string;
  finish: string;
  image?: string | null;
}
export interface MarketPrice { number: string; variant: string; cents: number; observedAt: string }
export interface MarketSet { asOf: string | null; prices: MarketPrice[] }
export interface PricePoint { date: string; cents: number }
export interface PriceHistory { asOf: string | null; points: PricePoint[] }
export interface RetailOffer {
  store: string;
  priceCents: number;
  currency: "CAD";
  condition: string;
  conditionRank: number;
  checkedAt: string;
  url: string;
}
export interface RetailOffers {
  offers: RetailOffer[];
  unavailableStores: string[];
  checkedStores?: Record<string, string>;
  expiresAt?: Record<string, string>;
  retryAfter?: number;
  storeRetryAfter?: Record<string, number>;
}
export interface BinderValue { cents: number; priced: number; collected: number; asOf: string | null }

const formatter = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "symbol" });
export const cad = (cents: number) => formatter.format(cents / 100);
export const calendarDate = (date: string) => new Intl.DateTimeFormat("en-CA", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
}).format(new Date(date));
export const offerLifetime = 10 * 60_000;

export function valueBinder(binder: SetBinder, market?: MarketSet): BinderValue {
  const exact = new Set(binder.owned.filter(key => !key.startsWith("extra:") && !key.endsWith(":*")));
  const identifiedNumbers = new Set([...exact].map(key => key.slice(0, key.indexOf(":"))));
  const collected = binder.owned.filter(key => !key.endsWith(":*") || !identifiedNumbers.has(key.slice(0, -2))).length;
  let cents = 0, priced = 0;
  for (const row of market?.prices ?? []) {
    if (!exact.delete(row.number + ":" + row.variant)) continue;
    cents += row.cents;
    priced++;
  }
  return { cents, priced, collected, asOf: market?.asOf ?? null };
}

export function sumBinderValues(values: readonly BinderValue[]): BinderValue {
  return values.reduce((total, value) => ({
    cents: total.cents + value.cents,
    priced: total.priced + value.priced,
    collected: total.collected + value.collected,
    asOf: !value.asOf || (total.asOf && total.asOf < value.asOf) ? total.asOf : value.asOf,
  }), { cents: 0, priced: 0, collected: 0, asOf: null } as BinderValue);
}

export interface BuyingEntry { target: PricingTarget; copies: number }
export function missingPrintings(binder: SetBinder, set: SetSummary, cards: SetCard[]): PricingTarget[] {
  return setSlots(binder, cards).flatMap(slot => {
    if (!slot.required || slot.status !== "missing" || slot.key.startsWith("extra:")) return [];
    return [{ setId: set.id, setName: set.name, number: slot.number, name: slot.name,
      variant: slot.key.slice(slot.key.indexOf(":") + 1), finish: slot.finish }];
  });
}

export function groupBuyingEntries(targets: readonly PricingTarget[]): BuyingEntry[] {
  const rows = new Map<string, BuyingEntry>();
  for (const target of targets) {
    const id = JSON.stringify([target.setId, target.number, target.variant]);
    const row = rows.get(id);
    if (row) row.copies++;
    else rows.set(id, { target, copies: 1 });
  }
  return [...rows.values()];
}

export function matchesBuyingEntry({ target }: BuyingEntry, query: string) {
  const words = query.trim().replace(/\s*\/\s*/g, "/").split(/\s+/);
  const fields = [target.setName, target.setId, target.number, target.name, target.finish].map(normalizeSearch);
  return words.every(word => {
    const collector = word.match(/^#?([a-z]*\d+[a-z]*)(?:\/[a-z]*\d+[a-z]*)?$/i);
    if (collector && numberKey(collector[1]) === numberKey(target.number)) return true;
    const normalized = normalizeSearch(word);
    return fields.some(field => field.includes(normalized));
  });
}

export function freshOfferCheck(checkedAt: string, now: number) {
  const age = now - Date.parse(checkedAt);
  return age >= -60_000 && age < offerLifetime;
}

export function freshOffers(offers: readonly RetailOffer[], now: number, expiresAt?: Record<string, string>) {
  return offers.filter(offer => freshOfferCheck(offer.checkedAt, now)
    && (!expiresAt?.[offer.store] || Date.parse(expiresAt[offer.store]) > now))
    .sort((a, b) => a.conditionRank - b.conditionRank || a.priceCents - b.priceCents || a.store.localeCompare(b.store));
}

const api = "/utilities/pokemon-binder/api/";

async function requestPrices<T>(path: string, signal?: AbortSignal, body?: string): Promise<T> {
  const response = await fetch(api + path, {
    credentials: "omit", signal, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body } : {}),
  });
  if (!response.ok) throw new Error("Pricing is temporarily unavailable.");
  return await response.json() as T;
}

export function pricingRequest<T>(endpoint: "market" | "offers", query: Record<string, string>, signal?: AbortSignal) {
  return requestPrices<T>(endpoint + ".php?" + new URLSearchParams(query), signal);
}

export async function batchRetailOffers(targets: readonly { set: string; number: string; variant: string; stores?: readonly string[] }[],
  signal: AbortSignal) {
  const { results } = await requestPrices<{ results: RetailOffers[] }>("offers.php", signal, JSON.stringify({ targets }));
  if (!Array.isArray(results) || results.length !== targets.length) throw new Error("Pricing returned an incomplete batch.");
  return results;
}

const requests = new Map<string, { deadline: number; prices: Promise<MarketSet> }>();
export function marketPrices(setId: string) {
  const now = Date.now(), cached = requests.get(setId);
  if (cached && cached.deadline > now) return cached.prices;
  const prices = pricingRequest<MarketSet>("market", { set: setId }, AbortSignal.timeout(10_000));
  const request = { prices, deadline: now + 600_000 };
  void prices.catch(() => { request.deadline = Date.now() + 10_000; });
  requests.set(setId, request);
  return prices;
}
