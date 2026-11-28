import { createHash } from "node:crypto";

const assetSuffix = /([.-])[A-Za-z0-9_-]{8}(?=\.(?:m?js|css|woff2?|png|svg|webp)$)/;
const textAsset = /\.(?:html|m?js|css)$/;

export function releaseAssetName(path: string): string {
  return path.replace(assetSuffix, "$1[hash]");
}

/** The bundler propagates diagnostics-only changes into the names of dependent chunks. */
export function releaseContentHash(assets: Iterable<[string, string | Uint8Array]>, files: Iterable<string>, reportingIds: string[]): string {
  const names = new Map<string, string>();
  for (const file of files) {
    const name = file.split("/").at(-1)!;
    const stable = releaseAssetName(name);
    if (name !== stable) names.set(name, stable);
  }
  const identity = createHash("sha256");
  const entries = [];
  for (const [path, bytes] of assets) {
    let content = bytes;
    if (textAsset.test(path)) {
      let source = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
      source = source.replace(/[\w.-]+\.(?:m?js|css|woff2?|png|svg|webp)\b/g, (name) => names.get(name) ?? name);
      for (const id of reportingIds) if (id) source = source.replaceAll(id, "[reporting-id]");
      content = source;
    }
    const digest = createHash("sha256").update(content).digest("hex");
    const name = path.startsWith("_astro/") || path.startsWith("assets/") ? releaseAssetName(path) : path;
    entries.push(`${name}\0${digest}\n`);
  }
  for (const entry of entries.sort()) identity.update(entry);
  return identity.digest("hex");
}
