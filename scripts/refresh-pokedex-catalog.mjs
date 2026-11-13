import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = path.join(ROOT, "public/utilities/pokedex-binder");
const CACHE = path.join(ROOT, "tmp/pokedex-catalog-cache");
export const SOURCE_REVISIONS = Object.freeze({
  tcgdex: "cff6522d736af05fd7c398607bb32297f14dc62f",
  pokeapi: "8a92bfa7dab2f12b84b5d151562f9857c133ff30",
  sprites: "c0542f7c51215d9672439012838c99f520596cbd",
});
const RAW = "https://raw.githubusercontent.com";
const ASSET_INDEX = "https://assets.tcgdex.net/datas.json";

async function exists(file) {
  return access(file).then(() => true, () => false);
}

async function fetchBytes(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Could not fetch ${url}`);
}

async function cached(url, filename) {
  const file = path.join(CACHE, filename);
  if (!(await exists(file))) {
    const body = await fetchBytes(url);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return readFile(file);
}

export function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = []; value = "";
    } else value += character;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (value || row.length) { row.push(value); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}

function english(text) {
  return text?.en ?? Object.entries(text ?? {}).find(([language]) => language.startsWith("en-"))?.[1];
}

export function createSpecies(speciesCsv, namesCsv) {
  const names = new Map(parseCsv(namesCsv).filter((row) => row.local_language_id === "9")
    .map((row) => [Number(row.pokemon_species_id), row.name]));
  const species = parseCsv(speciesCsv).map((row) => ({
    id: Number(row.id), name: names.get(Number(row.id)), generation: Number(row.generation_id), printingCount: 0,
  })).sort((a, b) => a.id - b.id);
  for (const [index, entry] of species.entries()) {
    if (entry.id !== index + 1 || !entry.name || !Number.isInteger(entry.generation) || entry.generation < 1) {
      throw new Error(`Invalid National Pokédex species entry ${entry.id}`);
    }
  }
  if (!species.length) throw new Error("Species source is empty");
  return species;
}

/** Normalize resolved upstream objects, never inferring a species from a card's name. */
export function normalizeCatalog(speciesInput, cards, assets = {}) {
  const species = speciesInput.map((entry) => ({ ...entry, printingCount: 0 }));
  const speciesIds = new Set(species.map((entry) => entry.id));
  const printings = new Map(species.map((entry) => [entry.id, []]));
  const sets = {};
  const seenCards = new Set();
  const audit = {
    sourceCards: 0, englishPokemonCards: 0, indexedCards: 0, excludedPocketCards: 0,
    missingDexIdCards: [], missingSetCodes: [], speciesWithoutPrintings: [],
  };
  for (const { number, card } of cards) {
    audit.sourceCards++;
    if (!english(card.name) || !english(card.set?.name) || !english(card.set?.serie?.name)) continue;
    if (card.set.serie.id === "tcgp") { audit.excludedPocketCards++; continue; }
    if (card.category !== "Pokemon") continue;
    audit.englishPokemonCards++;
    const set = card.set;
    if (typeof set.id !== "string" || !set.id || typeof number !== "string" || !number) {
      throw new Error("Invalid upstream set or collector number");
    }
    const id = `${set.id}-${number}`;
    if (seenCards.has(id)) throw new Error(`Duplicate printing ID ${id}`);
    seenCards.add(id);
    if (!Array.isArray(card.dexId) || card.dexId.length === 0) {
      audit.missingDexIdCards.push(id); continue;
    }
    const dexIds = [...new Set(card.dexId)];
    if (dexIds.some((dexId) => !Number.isInteger(dexId) || !speciesIds.has(dexId))) {
      throw new Error(`Unknown or invalid species reference in ${id}: ${JSON.stringify(card.dexId)}`);
    }
    if (!sets[set.id]) {
      const code = set.abbreviations?.official ?? set.tcgOnline ?? null;
      const releaseDate = typeof set.releaseDate === "string" ? set.releaseDate : english(set.releaseDate) ?? null;
      sets[set.id] = { id: set.id, name: english(set.name), code, releaseDate };
      if (assets.univ?.[set.serie.id]?.[set.id]?.symbol) {
        sets[set.id].symbol = `https://assets.tcgdex.net/univ/${set.serie.id}/${set.id}/symbol.webp`;
      }
    }
    const hasImage = Boolean(assets.en?.[set.serie.id]?.[set.id]?.[number]);
    const printing = {
      id, name: english(card.name), number, setId: set.id,
      rarity: typeof card.rarity === "string" && card.rarity ? card.rarity : null,
      image: hasImage ? `https://assets.tcgdex.net/en/${set.serie.id}/${set.id}/${number}/low.webp` : null,
    };
    for (const dexId of dexIds) printings.get(dexId).push(printing);
    audit.indexedCards++;
  }
  const sortedSets = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b, "en")));
  for (const entry of species) {
    const entries = printings.get(entry.id);
    entries.sort((a, b) => (sortedSets[b.setId].releaseDate ?? "").localeCompare(sortedSets[a.setId].releaseDate ?? "")
      || a.setId.localeCompare(b.setId, "en") || a.number.localeCompare(b.number, "en", { numeric: true }));
    entry.printingCount = entries.length;
    if (!entries.length) audit.speciesWithoutPrintings.push(entry.id);
  }
  audit.missingDexIdCards.sort();
  audit.missingSetCodes = Object.values(sortedSets).filter((set) => !set.code).map((set) => set.id);
  return { species, sets: sortedSets, printings, audit };
}

async function filesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(file));
    else if (entry.isFile()) found.push(file);
  }
  return found.sort();
}

export function transpileData(source, file) {
  return ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false },
    transformers: {
      after: [(context) => (root) => {
        const visit = (node) => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
            && node.moduleSpecifier.text.startsWith(".")) {
            const module = node.moduleSpecifier.text.replace(/\.ts$/, "");
            return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
              ts.factory.createStringLiteral(`${module}.mjs`), node.attributes);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(root, visit);
      }],
    },
  }).outputText;
}

async function getCardObjects() {
  const revision = SOURCE_REVISIONS.tcgdex;
  const archiveName = `tcgdex-${revision}.tar.gz`;
  await cached(`https://codeload.github.com/tcgdex/cards-database/tar.gz/${revision}`, archiveName);
  const extracted = path.join(CACHE, `tcgdex-${revision}`);
  const compiled = path.join(CACHE, `tcgdex-${revision}-modules`);
  if (!(await exists(path.join(extracted, ".complete-utf8")))) {
    await mkdir(extracted, { recursive: true });
    const arguments_ = ["-xzf", path.join(CACHE, archiveName), "-C", extracted, "--strip-components", "1"];
    // Windows bsdtar otherwise converts UTF-8 archive filenames through the local code page.
    if (process.platform === "win32") arguments_.push("--options", "hdrcharset=UTF-8");
    arguments_.push(`cards-database-${revision}/data`, `cards-database-${revision}/LICENSE`);
    const result = spawnSync("tar", arguments_, { encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`Could not extract source archive: ${result.error ?? result.stderr}`);
    await writeFile(path.join(extracted, ".complete-utf8"), revision);
  }
  const files = (await filesUnder(path.join(extracted, "data"))).filter((file) => file.endsWith(".ts"));
  if (!(await exists(path.join(compiled, ".complete")))) {
    console.log(`Transpiling ${files.length} pinned upstream data modules…`);
    for (const [index, sourcePath] of files.entries()) {
      const output = path.join(compiled, path.relative(extracted, sourcePath)).replace(/\.ts$/, ".mjs");
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, transpileData(await readFile(sourcePath, "utf8"), sourcePath));
      if ((index + 1) % 2000 === 0) console.log(`  ${index + 1}/${files.length} modules`);
    }
    await writeFile(path.join(compiled, ".complete"), revision);
  }
  const cards = [];
  for (const file of files) {
    const relative = path.relative(path.join(extracted, "data"), file).split(path.sep);
    if (relative.length !== 3) continue;
    const moduleFile = path.join(compiled, "data", ...relative).replace(/\.ts$/, ".mjs");
    const { default: card } = await import(pathToFileURL(moduleFile).href);
    cards.push({ number: path.basename(file, ".ts"), card });
  }
  return { cards, license: await readFile(path.join(extracted, "LICENSE"), "utf8") };
}

async function concurrent(items, count, callback) {
  let next = 0;
  await Promise.all(Array.from({ length: count }, async () => {
    while (next < items.length) { const index = next++; await callback(items[index], index); }
  }));
}

async function removeTemporary(directory) {
  const resolved = path.resolve(directory);
  const allowed = path.resolve(ROOT, "tmp") + path.sep;
  if (!resolved.startsWith(allowed)) throw new Error(`Refusing to remove non-temporary directory ${resolved}`);
  await rm(resolved, { recursive: true, force: true });
}

async function publishDirectories(stage) {
  await mkdir(APP, { recursive: true });
  const published = [], backups = [];
  try {
    for (const name of ["catalog", "sprites", "licenses"]) {
      const destination = path.join(APP, name);
      if (await exists(destination)) {
        const backup = path.join(stage, `${name}.previous`);
        await rename(destination, backup); backups.push({ destination, backup });
      }
      await rename(path.join(stage, name), destination); published.push(destination);
    }
  } catch (error) {
    for (const destination of published.reverse()) await rename(destination, path.join(stage, `${path.basename(destination)}.failed`));
    for (const { destination, backup } of backups.reverse()) await rename(backup, destination);
    throw error;
  }
}

export async function refreshCatalog() {
  await mkdir(CACHE, { recursive: true });
  const pokeRoot = `${RAW}/PokeAPI/pokeapi/${SOURCE_REVISIONS.pokeapi}`;
  const spritesRoot = `${RAW}/PokeAPI/sprites/${SOURCE_REVISIONS.sprites}`;
  const [speciesBytes, namesBytes, assetBytes, pokeLicense, spriteLicense, source] = await Promise.all([
    cached(`${pokeRoot}/data/v2/csv/pokemon_species.csv`, `species-${SOURCE_REVISIONS.pokeapi}.csv`),
    cached(`${pokeRoot}/data/v2/csv/pokemon_species_names.csv`, `names-${SOURCE_REVISIONS.pokeapi}.csv`),
    fetchBytes(ASSET_INDEX),
    cached(`${pokeRoot}/LICENSE.md`, `pokeapi-${SOURCE_REVISIONS.pokeapi}-LICENSE.md`),
    cached(`${spritesRoot}/LICENCE.txt`, `sprites-${SOURCE_REVISIONS.sprites}-LICENSE.txt`),
    getCardObjects(),
  ]);
  const catalog = normalizeCatalog(createSpecies(speciesBytes.toString("utf8"), namesBytes.toString("utf8")),
    source.cards, JSON.parse(assetBytes.toString("utf8")));
  if (!catalog.audit.indexedCards) throw new Error("Refusing to publish an empty card catalog");
  const stage = path.join(ROOT, "tmp", `pokedex-refresh-${randomUUID()}`);
  await mkdir(path.join(stage, "catalog/printings"), { recursive: true });
  await mkdir(path.join(stage, "sprites"), { recursive: true });
  await mkdir(path.join(stage, "licenses"), { recursive: true });
  try {
    console.log(`Preparing ${catalog.species.length} species and ${catalog.audit.indexedCards} English physical printings…`);
    await concurrent(catalog.species, 8, async (entry, index) => {
      await writeFile(path.join(stage, "catalog/printings", `${entry.id}.json`), JSON.stringify(catalog.printings.get(entry.id)) + "\n");
      const sprite = await cached(`${spritesRoot}/sprites/pokemon/${entry.id}.png`, `sprites-${SOURCE_REVISIONS.sprites}/${entry.id}.png`);
      if (sprite.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`Invalid sprite ${entry.id}`);
      await writeFile(path.join(stage, "sprites", `${entry.id}.png`), sprite);
      if ((index + 1) % 200 === 0) console.log(`  ${index + 1}/${catalog.species.length} species assets`);
    });
    const index = {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      sources: {
        tcgdex: { repository: "https://github.com/tcgdex/cards-database", revision: SOURCE_REVISIONS.tcgdex },
        pokeapi: { repository: "https://github.com/PokeAPI/pokeapi", revision: SOURCE_REVISIONS.pokeapi },
        sprites: { repository: "https://github.com/PokeAPI/sprites", revision: SOURCE_REVISIONS.sprites },
        assets: { url: ASSET_INDEX, sha256: createHash("sha256").update(assetBytes).digest("hex") },
      },
      species: catalog.species, sets: catalog.sets, audit: catalog.audit,
    };
    await writeFile(path.join(stage, "catalog/index.json"), JSON.stringify(index) + "\n");
    await writeFile(path.join(stage, "licenses/TCGdex-MIT.txt"), source.license);
    await writeFile(path.join(stage, "licenses/PokeAPI-LICENSE.txt"), pokeLicense);
    await writeFile(path.join(stage, "licenses/PokeAPI-sprites-LICENSE.txt"), spriteLicense);
    await writeFile(path.join(stage, "licenses/ATTRIBUTION.txt"),
      "Pokédex Binder is an unofficial fan utility, unaffiliated with Nintendo, Creatures, GAME FREAK, or The Pokémon Company.\n"
      + "Pokémon names, characters, card artwork, and sprites belong to their respective owners.\n"
      + "Species metadata: PokéAPI (https://pokeapi.co/). Card metadata: TCGdex (https://tcgdex.dev/), MIT licensed.\n"
      + "Species sprites: PokeAPI/sprites (https://github.com/PokeAPI/sprites). See the accompanying license notices.\n"
      + "Card coverage reflects the pinned catalog snapshot and may be incomplete. Ownership is tracked by species, not a particular printing.\n");
    await publishDirectories(stage);
    console.log(`Published ${catalog.species.length} species, ${Object.keys(catalog.sets).length} sets, ${catalog.audit.indexedCards} printings.`);
    console.log(`Audit: ${catalog.audit.missingDexIdCards.length} cards without species IDs; ${catalog.audit.missingSetCodes.length} sets without codes.`);
  } finally {
    await removeTemporary(stage);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshCatalog().catch((error) => { console.error(error); process.exitCode = 1; });
}
