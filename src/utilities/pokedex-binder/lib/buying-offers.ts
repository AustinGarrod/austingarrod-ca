import { freshOfferCheck, freshOffers, offerLifetime, type PricingTarget, type RetailOffer, type RetailOffers } from "./pricing";

export const buyingStores = ["401 Games", "Deck Out Gaming", "Skyfox Games"] as const;
export type BuyingStore = typeof buyingStores[number];
export type Availability = "stock" | "none" | "unchecked" | "unavailable";
export interface OfferSnapshot { results: RetailOffers; receivedAt: number }
export interface StoreMatch { store: BuyingStore; availability: Availability; offer?: RetailOffer }

export function printingKey(target: PricingTarget) {
  return JSON.stringify([target.setId, target.number, target.variant]);
}

export function canCheckPrinting(target: PricingTarget) {
  return /^(normal|holo|reverse)(?:\+|$)/.test(target.variant);
}

export function matchesByStore(
  snapshot: OfferSnapshot | undefined, stores: readonly BuyingStore[], now: number, maxPrice: number, maxCondition: number,
): StoreMatch[] {
  const offers = freshOffers(snapshot?.results.offers ?? [], now);
  return stores.map(store => {
    const storeOffers = offers.filter(offer => offer.store === store);
    const offer = storeOffers.find(item => item.priceCents <= maxPrice && item.conditionRank <= maxCondition
      && item.url.startsWith("https://"));
    const checkedAt = snapshot?.results.checkedStores?.[store];
    const unavailable = snapshot && now - snapshot.receivedAt < offerLifetime
      && snapshot.results.unavailableStores.includes(store);
    const checked = storeOffers.length || (checkedAt && freshOfferCheck(checkedAt, now));
    return { store, offer, availability: offer ? "stock" : unavailable ? "unavailable" : checked ? "none" : "unchecked" };
  });
}

export function combinedAvailability(stores: readonly StoreMatch[]): Availability {
  if (stores.some(store => store.availability === "stock")) return "stock";
  if (stores.some(store => store.availability === "unavailable")) return "unavailable";
  return stores.every(store => store.availability === "none") ? "none" : "unchecked";
}
