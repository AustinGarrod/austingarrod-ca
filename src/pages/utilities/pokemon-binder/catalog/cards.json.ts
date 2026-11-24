import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogSearchCard, CatalogSearchIndex, CatalogSearchSet } from "../../../../utilities/pokedex-binder/lib/catalog-search";
import type { SetCard, SetSummary } from "../../../../utilities/pokedex-binder/lib/master";
import type { Species } from "../../../../utilities/pokedex-binder/lib/model";
import { identityText } from "../../../../utilities/pokedex-binder/lib/transfer-identity";

const directory = path.resolve("public/utilities/pokedex-binder/catalog");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(directory, file), "utf8"));

export const GET: APIRoute = async () => {
  const [index, setIndex] = await Promise.all([
    read<{ species: Species[]; sets: Record<string, { releaseDate: string | null }> }>("index.json"),
    read<SetSummary[]>("master-sets/index.json"),
  ]);
  const alternateNames = new Map<string, string[]>();
  for (const { id, name } of index.species) {
    const key = identityText(name);
    const printings = await read<{ setId: string; number: string; name: string }[]>(`printings/${id}.json`);
    for (const printing of printings) {
      if (identityText(printing.name).includes(key)) continue;
      const id = `${printing.setId}:${printing.number}`;
      const names = alternateNames.get(id) ?? [];
      names.push(name);
      alternateNames.set(id, names);
    }
  }
  // Full printing metadata and artwork are loaded only after choosing a card.
  const sets: CatalogSearchSet[] = [];
  for (const { id, name, code, printedTotal, artwork } of setIndex) {
    const source = await read<SetCard[]>(`master-sets/${id}.json`);
    const cards = source.map(({ number, name }): CatalogSearchCard => {
      const aliases = alternateNames.get(`${id}:${number}`);
      return aliases ? [number, name, aliases] : [number, name];
    });
    sets.push({ id, name, code, printedTotal, artwork, cards });
  }
  const release = (id: string) => index.sets[id]?.releaseDate ?? "";
  sets.sort((a, b) => release(b.id).localeCompare(release(a.id)) || a.name.localeCompare(b.name, "en", { numeric: true }));
  const result: CatalogSearchIndex = { schemaVersion: 1, sets };
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};
