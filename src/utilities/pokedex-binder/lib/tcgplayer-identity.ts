import type { Variant } from "./master";
import type { ProductIdentity } from "./transfer-identity";

const tcgplayerPrintings: Record<string, readonly string[]> = {
  normal: ["Normal", "Unlimited"], holo: ["Holofoil", "Unlimited Holofoil"], reverse: ["Reverse Holofoil"],
  "normal+subtype=unlimited": ["Unlimited", "Normal"], "holo+subtype=unlimited": ["Unlimited Holofoil", "Holofoil"],
  "normal+subtype=shadowless": ["Unlimited", "Normal"], "holo+subtype=shadowless": ["Unlimited Holofoil", "Holofoil"],
  "normal+stamp=1st-edition": ["1st Edition"], "holo+stamp=1st-edition": ["1st Edition Holofoil"],
  "normal+subtype=shadowless+stamp=1st-edition": ["1st Edition"], "holo+subtype=shadowless+stamp=1st-edition": ["1st Edition Holofoil"],
};

// TCGplayer lists the standard 30C singles as Holofoil, including cards the Binder labels regular.
const anniversaryHolo = ["Holofoil"];
const anniversaryVariants: Record<string, readonly string[]> = {
  "30th": ["normal+stamp=30th-anniversary", "holo+stamp=30th-anniversary"],
  "30th-c": ["holo+stamp=30th-anniversary"],
  mee: ["holo+stamp=30th-anniversary"],
};

export function tcgplayerProduct(products: [string, ProductIdentity][], variant: Pick<Variant, "id">) {
  const shadowless = variant.id.includes("+subtype=shadowless");
  const matches = products.flatMap(([productId, [setId, , subtype, listed]]) => {
    if (shadowless !== (subtype === "shadowless")) return [];
    const printings = anniversaryVariants[setId]?.includes(variant.id) ? anniversaryHolo : tcgplayerPrintings[variant.id];
    const printing = printings?.find(name => listed?.includes(name));
    return printing ? [{ productId, printing }] : [];
  });
  if (matches.length === 1) return matches[0];
}
