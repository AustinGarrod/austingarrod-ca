import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const appPath = "/utilities/radius-map/";
const appDirectory = join(dist, "utilities", "radius-map");

function localFileForUrl(urlPath) {
  const decoded = decodeURIComponent(urlPath.split(/[?#]/, 1)[0]);
  const normalized = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  return join(dist, ...normalized.replace(/^\//, "").split("/"));
}

function absoluteAssetUrl(reference, sourceUrl) {
  if (!reference || reference.startsWith("data:") || reference.startsWith("#")) return null;
  try {
    const resolved = new URL(reference, `https://austingarrod.ca${sourceUrl}`);
    return resolved.origin === "https://austingarrod.ca" ? resolved.pathname : null;
  } catch {
    return null;
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const urls = new Set([
  appPath,
  `${appPath}manifest.webmanifest`,
  `${appPath}icons/icon-192.png`,
  `${appPath}icons/icon-512.png`,
  `${appPath}icons/icon-maskable-512.png`,
  `${appPath}icons/apple-touch-icon.png`,
  "/fonts/inter-latin.var.woff2",
  "/fonts/jetbrains-mono-latin.var.woff2",
]);
const pending = [appPath];
const inspected = new Set();

while (pending.length > 0) {
  const sourceUrl = pending.shift();
  if (!sourceUrl || inspected.has(sourceUrl)) continue;
  inspected.add(sourceUrl);
  const path = localFileForUrl(sourceUrl);
  if (!(await isFile(path))) continue;
  const extension = extname(path).toLowerCase();
  if (![".html", ".css", ".js", ".mjs"].includes(extension)) continue;

  const source = await readFile(path, "utf8");
  const references = [];
  if (extension === ".html") {
    references.push(...source.matchAll(/<(?:script|img|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi));
    references.push(...source.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi));
  } else if (extension === ".css") {
    references.push(...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi));
  } else {
    references.push(...source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g));
  }

  for (const match of references) {
    const assetUrl = absoluteAssetUrl(match[1], sourceUrl);
    if (!assetUrl || !(await isFile(localFileForUrl(assetUrl)))) continue;
    if (!urls.has(assetUrl)) {
      urls.add(assetUrl);
      pending.push(assetUrl);
    }
  }
}

const precacheUrls = [...urls].sort();
const hash = createHash("sha256");
for (const url of precacheUrls) {
  const path = localFileForUrl(url);
  if (!(await isFile(path))) {
    throw new Error(`Radius Map offline asset is missing: ${url}`);
  }
  hash.update(url);
  hash.update(await readFile(path));
}

const cacheName = `austingarrod-radius-map-${hash.digest("hex").slice(0, 12)}`;
const serviceWorker = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_PATH = ${JSON.stringify(appPath)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("austingarrod-radius-map-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith(APP_PATH + "api/")) return;

  if (request.mode === "navigate") {
    if (!url.pathname.startsWith(APP_PATH)) return;
    event.respondWith(fetch(request).catch(async () => (await caches.match(APP_PATH)) || Response.error()));
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
`;

await writeFile(join(appDirectory, "sw.js"), serviceWorker, "utf8");
