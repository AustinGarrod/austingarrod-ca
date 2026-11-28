import type { Variant } from "./master";
import type { ProductIdentity } from "./transfer-identity";

const tcgplayerPrintings: Record<string, readonly string[]> = {
  normal: ["Normal", "Unlimited"], holo: ["Holofoil", "Unlimited Holofoil"], reverse: ["Reverse Holofoil"],
  "normal+subtype=unlimited": ["Unlimited", "Normal"], "holo+subtype=unlimited": ["Unlimited Holofoil", "Holofoil"],
  "normal+subtype=shadowless": ["Unlimited", "Normal"], "holo+subtype=shadowless": ["Unlimited Holofoil", "Holofoil"],
  "normal+stamp=1st-edition": ["1st Edition"], "holo+stamp=1st-edition": ["1st Edition Holofoil"],
  "normal+subtype=shadowless+stamp=1st-edition": ["1st Edition"], "holo+subtype=shadowless+stamp=1st-edition": ["1st Edition Holofoil"],
};

export function tcgplayerProduct(products: [string, ProductIdentity][], variant: Pick<Variant, "id">) {
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
