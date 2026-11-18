import type { APIRoute } from "astro";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

interface Printing { setId: string; number: string }

export const GET: APIRoute = async () => {
  // Derive a static lookup from the same committed data used by the card details.
  const directory = path.resolve("public/utilities/pokedex-binder/catalog/printings");
  const files = (await readdir(directory)).filter(name => /^\d+\.json$/.test(name));
  const sets: Record<string, Record<string, string[]>> = Object.create(null);

  for (const file of files) {
    const dexId = path.basename(file, ".json");
    const printings = JSON.parse(await readFile(path.join(directory, file), "utf8")) as Printing[];
    for (const { setId, number } of printings) {
      const species = sets[setId] ??= {};
      const numbers = species[dexId] ??= [];
      if (!numbers.includes(number)) numbers.push(number);
    }
  }

  return new Response(JSON.stringify(sets), { headers: { "Content-Type": "application/json" } });
};
