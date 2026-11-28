import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, posix, resolve } from "node:path";
import { releaseContentHash } from "./utility-release-content.mts";

const dist = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, "../dist");
const placeholder = 'data-utility-version="UTILITY_RELEASE_PLACEHOLDER"';
const utilityRoot = "utilities";
const { release: reportingRelease } = JSON.parse(await readFile(new URL("../src/reporting/build.json", import.meta.url), "utf8"));
const releases = [
  {
    slug: "pokemon-binder",
    pages: ["index.html", "buy-cards/index.html", "shared/index.html", "settings/index.html"],
    extras: [
      "utilities/pokemon-binder/shopify-profile.json",
      "utilities/pokemon-binder/catalog/cards.json",
      "utilities/pokedex-binder/scanner-update.js",
    ],
    directories: ["utilities/pokedex-binder/catalog", "utilities/pokedex-binder/scanner-assets/v1"],
  },
  {
    slug: "radius-map",
    pages: ["index.html"],
    extras: ["utilities/radius-map/manifest.webmanifest"],
    directories: ["utilities/radius-map/icons"],
  },
  { slug: "screen-cut-calculator", pages: ["index.html"], extras: [], directories: [] },
];

async function listFiles(dir) {
  const entries = await readdir(resolve(dist, dir), { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = posix.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }))).flat();
}

const bundledAssets = new Set((await Promise.all([listFiles("_astro"), listFiles("fonts")])).flat());

function fileReferences(path, contents) {
  if (![".html", ".js", ".css"].includes(extname(path))) return [];
  const matches = contents.toString("utf8").matchAll(/(?:\/_astro\/|\/fonts\/|\.\/)[\w./-]+\.(?:css|js|mjs|woff2|png|svg|webp)\b/g);
  const references = new Set();
  for (const [reference] of matches) {
    const asset = reference.startsWith("/") ? reference.slice(1) : posix.join(posix.dirname(path), reference);
    if (bundledAssets.has(asset)) references.add(asset);
  }
  return references;
}

async function createRelease({ slug, pages, extras, directories }) {
  const directory = posix.join(utilityRoot, slug);
  const entryPaths = pages.map((page) => posix.join(directory, page));
  const entries = new Map(await Promise.all(entryPaths.map(async (path) => {
    const contents = await readFile(resolve(dist, path), "utf8");
    if (contents.split(placeholder).length !== 2) throw new Error(`Expected one utility release placeholder in ${path}`);
    return [path, contents];
  })));

  const files = new Set([...entryPaths, ...extras, ...(await Promise.all(directories.map(listFiles))).flat()]);
  const assets = new Map();
  const pending = [...files];
  while (pending.length) {
    const group = pending.splice(0, 32);
    await Promise.all(group.map(async (path) => {
      const contents = entries.get(path) ?? await readFile(resolve(dist, path));
      assets.set(path, contents);
      if (!entries.has(path) && !path.startsWith("_astro/")) return;
      for (const asset of fileReferences(path, contents)) {
        if (files.has(asset)) continue;
        files.add(asset);
        pending.push(asset);
      }
    }));
  }

  const version = releaseContentHash(assets, files, [reportingRelease]);
  const shellAssets = [...files].filter((path) => bundledAssets.has(path)).sort().map((path) => `/${path}`);
  for (const [path, contents] of entries) {
    await writeFile(resolve(dist, path), contents.replace(placeholder, `data-utility-version="${version}"`));
  }
  await writeFile(resolve(dist, directory, "utility-release.json"), JSON.stringify({ version, assets: shellAssets }) + "\n");
  console.log(`Utility release ${slug}: ${version.slice(0, 12)} (${files.size} files)`);
}

for (const release of releases) await createRelease(release);
