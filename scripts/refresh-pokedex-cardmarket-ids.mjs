import { getCardObjects } from "./refresh-pokedex-catalog.mjs";
import { writeCardmarketPrintings } from "./pokedex-master-catalog.mjs";

const { cards } = await getCardObjects();
const path = new URL("../public/utilities/pokedex-binder/catalog/cardmarket-printings.json", import.meta.url);
const { sets } = await writeCardmarketPrintings(cards, path);
const printings = Object.values(sets).reduce((count, cards) =>
  count + Object.values(cards).reduce((sum, variants) => sum + Object.keys(variants).length, 0), 0);
console.log(`Mapped ${printings} Cardmarket printing prices across ${Object.keys(sets).length} sets.`);
