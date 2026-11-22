// Rebuild the optional ID crosswalk from public catalog metadata only.
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { cardNameKey, findTransferSets, numberKey } from "../src/utilities/pokedex-binder/lib/transfer-identity.ts";

const directory = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + sep) : new URL("../public/utilities/pokedex-binder/catalog/", import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, directory), "utf8"));
const api = "https://tcgcsv.com/tcgplayer/3/";
const headers = { "User-Agent": "AustinGarrod.ca Pokédex Binder catalog refresh" };
async function fetchCatalog(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(api + path, { headers, signal: AbortSignal.timeout(20000) });
      if (response.status === 404 && /\/(?:products|prices)$/.test(path)) return [];
      if (!response.ok) throw new Error(`TCGCSV returned ${response.status} for ${path}`);
      const result = await response.json();
      if (!result.success || !Array.isArray(result.results)) throw new Error(`Invalid catalog response for ${path}`);
      return result.results;
    } catch (error) {
      if (attempt === 2) throw error;
      await setTimeout(1000 * (attempt + 1));
    }
  }
}

const sets = await read("master-sets/index.json");
const products = {};
const groups = await fetchCatalog("groups");
let mappedGroups = 0;
for (const group of groups) {
  const byName = findTransferSets(sets, group.name);
  const byCode = findTransferSets(sets, group.abbreviation ?? "");
  const shared = byName.filter(set => byCode.includes(set));
  const matched = shared.length ? shared : byName.length ? byName : byCode;
  if (matched.length !== 1 || (byName.length && byCode.length && !shared.length)) continue;
  const [set] = matched;
  const cards = await read(`master-sets/${set.id}.json`);
  const byNumber = Map.groupBy(cards, card => numberKey(card.number));
  const subtype = group.name === "Base Set (Shadowless)" ? "shadowless" : null;
  await setTimeout(275);
  const listings = await fetchCatalog(`${group.groupId}/products`);
  await setTimeout(275);
  // Only the available printing labels are retained. Prices are not part of the crosswalk.
  const prices = Map.groupBy(await fetchCatalog(`${group.groupId}/prices`), item => item.productId);
  let matchedProducts = 0;
  for (const product of listings) {
    const number = product.extendedData?.find(item => item.name === "Number")?.value;
    if (!number || !Number.isSafeInteger(product.productId) || product.productId < 1) continue;
    const candidates = (byNumber.get(numberKey(number)) ?? []).filter(card =>
      cardNameKey(product.name) === cardNameKey(card.name) && (!subtype || card.variants.some(v => v.id.includes("subtype=" + subtype))));
    if (candidates.length !== 1) continue;
    const printings = [...new Set((prices.get(product.productId) ?? []).map(item => item.subTypeName)
      .filter(name => typeof name === "string" && name.trim()))].sort();
    const entry = [set.id, candidates[0].number, subtype, printings];
    if (Object.hasOwn(products, product.productId) && JSON.stringify(products[product.productId]) !== JSON.stringify(entry)) {
      throw new Error(`Conflicting mapping for Product ID ${product.productId}`);
    }
    products[product.productId] = entry;
    matchedProducts++;
  }
  if (matchedProducts) mappedGroups++;
}
if (Object.keys(products).length < 10000) throw new Error("The refreshed crosswalk has unexpectedly low coverage.");
const data = { source: api, generatedAt: new Date().toISOString(), products };
await writeFile(new URL("tcgplayer-products.json", directory), JSON.stringify(data) + "\n");
console.log(`Mapped ${Object.keys(products).length} products from ${mappedGroups} groups.`);
