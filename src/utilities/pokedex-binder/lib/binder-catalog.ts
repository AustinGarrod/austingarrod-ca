import expansions from "../../../../public/utilities/pokedex-binder/binder-expansions.json";
import type { SetBinder, SetCard } from "./master";

interface RelatedSet {
  setId: string;
  numbers?: readonly string[];
  variantId?: string;
}

const catalog: Record<string, readonly RelatedSet[]> = expansions;

export function relatedSets(setId: string): readonly RelatedSet[] {
  return Object.hasOwn(catalog, setId) ? catalog[setId] : [];
}

export function binderSetIds(binder: SetBinder, includeRelated: boolean = binder.settings.includeRelated === true) {
  const related = includeRelated ? relatedSets(binder.setId) : [];
  return [binder.setId, ...related.map(set => set.setId)];
}

export function binderCards(
  binder: SetBinder,
  cards: (setId: string) => readonly SetCard[],
  includeRelated: boolean = binder.settings.includeRelated === true,
): SetCard[] {
  const main = cards(binder.setId);
  if (!includeRelated) return [...main];
  const related = relatedSets(binder.setId).flatMap(set => cards(set.setId).flatMap(card => {
    if (set.numbers && !set.numbers.includes(card.number)) return [];
    const variants = set.variantId ? card.variants.filter(variant => variant.id === set.variantId) : card.variants;
    return variants.length ? [{ ...card, variants, sourceSetId: set.setId }] : [];
  }));
  return [...main, ...related];
}

export async function loadBinderCards(
  binder: SetBinder,
  cards: (setId: string) => Promise<SetCard[]>,
  includeRelated: boolean = binder.settings.includeRelated === true,
) {
  const loaded = new Map(await Promise.all(binderSetIds(binder, includeRelated).map(async id => [id, await cards(id)] as const)));
  return binderCards(binder, id => loaded.get(id) ?? [], includeRelated);
}

export function setCardKey(card: Pick<SetCard, "number" | "sourceSetId">) {
  return card.sourceSetId ? card.sourceSetId + "/" + card.number : card.number;
}
