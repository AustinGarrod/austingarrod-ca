import { freshOfferCheck, freshOffers, type PricingTarget, type RetailOffer, type RetailOffers } from "./pricing";
import retailers from "../../../../public/utilities/pokemon-binder/retailers.json";

export type BuyingStore = keyof typeof retailers;
export const buyingStores: readonly BuyingStore[] = Object.keys(retailers) as BuyingStore[];

export function isCrossBorder(store: string): boolean {
  return Object.hasOwn(retailers, store) && retailers[store as BuyingStore].country !== "CA";
}

export function offersForStores(data: RetailOffers, stores: readonly BuyingStore[]): RetailOffers {
  const allowed = (store: string) => stores.some(name => name === store);
  const selected = <T>(record?: Record<string, T>) =>
    record && Object.fromEntries(Object.entries(record).filter(([store]) => allowed(store)));
  return {
    ...data,
    offers: data.offers.filter(offer => allowed(offer.store)),
    unavailableStores: data.unavailableStores.filter(allowed),
    checkedStores: selected(data.checkedStores),
    expiresAt: selected(data.expiresAt),
    storeRetryAfter: selected(data.storeRetryAfter),
  };
}
export type Availability = "stock" | "none" | "unchecked" | "unavailable";
export interface StoreMatch { store: BuyingStore; availability: Availability; offer?: RetailOffer; checkedAt?: string }

export function printingKey(target: PricingTarget) {
  return JSON.stringify([target.setId, target.number, target.variant]);
}

export function canCheckPrinting(target: PricingTarget) {
  return /^(normal|holo|reverse)(?:\+|$)/.test(target.variant);
}

export function matchesByStore(
  results: RetailOffers | undefined, stores: readonly BuyingStore[], now: number, maxPrice: number, maxCondition: number,
  byPrice = false,
): StoreMatch[] {
  const offers = freshOffers(results?.offers ?? [], now, results?.expiresAt);
  return stores.map(store => {
    const storeOffers = offers.filter(offer => offer.store === store);
    const eligible = storeOffers.filter(item => item.priceCents <= maxPrice && item.conditionRank <= maxCondition
      && item.url.startsWith("https://"));
    const offer = byPrice ? eligible.sort((a, b) => a.priceCents - b.priceCents)[0] : eligible[0];
    const at = results?.checkedStores?.[store];
    const expiresAt = results?.expiresAt?.[store];
    const checkedAt = at && freshOfferCheck(at, now) && (!expiresAt || Date.parse(expiresAt) > now) ? at : undefined;
    const checked = Boolean(checkedAt || storeOffers.length);
    const unavailable = results?.unavailableStores.includes(store);
    const availability: Availability = offer ? "stock" : checked ? "none" : unavailable ? "unavailable" : "unchecked";
    return { store, offer, checkedAt, availability };
  });
}

export function combinedAvailability(stores: readonly StoreMatch[]): Availability {
  if (stores.some(store => store.availability === "stock")) return "stock";
  if (stores.some(store => store.availability === "unavailable")) return "unavailable";
  return stores.every(store => store.availability === "none") ? "none" : "unchecked";
}
