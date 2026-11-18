import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function buildScanIndex(species, printings) {
  const names = new Map();
  const add = (name, id) => {
    const entry = names.get(name) ?? new Set(); entry.add(id); names.set(name, entry);
  };
  for (const item of species) {
    add(item.name, item.id);
    for (const card of printings.get(item.id) ?? []) add(card.name, item.id);
  }
  return { schemaVersion: 1, aliases: [...names].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([name, ids]) => ({ name, dexIds: [...ids].sort((a, b) => a - b) })) };
}

export async function refreshScanIndex(directory = new URL('../public/utilities/pokedex-binder/catalog/', import.meta.url)) {
  const catalog = JSON.parse(await readFile(new URL('index.json', directory), 'utf8'));
  const entries = await Promise.all(catalog.species.map(async species => [species.id,
    JSON.parse(await readFile(new URL(`printings/${species.id}.json`, directory), 'utf8'))]));
  const index = buildScanIndex(catalog.species, new Map(entries));
  await writeFile(new URL('scan-index.json', directory), JSON.stringify(index) + '\n');
  console.log(`Indexed ${index.aliases.length} card/species names for local scanning.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await refreshScanIndex();
