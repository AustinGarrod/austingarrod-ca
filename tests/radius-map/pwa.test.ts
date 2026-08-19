import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectFile = (path: string): URL => new URL(`../../${path}`, import.meta.url);

async function pngDimensions(path: string): Promise<{ width: number; height: number }> {
  const png = await readFile(projectFile(path));
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("Radius Map PWA assets", () => {
  it("scopes the installable app to the utility route", async () => {
    const manifest = JSON.parse(await readFile(projectFile("public/utilities/radius-map/manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({
      id: "/utilities/radius-map/",
      name: "Radius Map",
      start_url: "/utilities/radius-map/",
      scope: "/utilities/radius-map/",
      display: "standalone",
    });
  });

  it.each([
    ["public/utilities/radius-map/icons/icon-192.png", 192],
    ["public/utilities/radius-map/icons/icon-512.png", 512],
    ["public/utilities/radius-map/icons/icon-maskable-512.png", 512],
    ["public/utilities/radius-map/icons/apple-touch-icon.png", 180],
  ])("ships %s at the declared size", async (path, size) => {
    await expect(pngDimensions(path)).resolves.toEqual({ width: size, height: size });
  });

  it("registers a scoped worker that excludes API and third-party requests", async () => {
    const registration = await readFile(projectFile("src/utilities/radius-map/scripts/pwa.ts"), "utf8");
    const generator = await readFile(projectFile("scripts/generate-radius-map-service-worker.mjs"), "utf8");

    expect(registration).toContain('register("/utilities/radius-map/sw.js", { scope: "/utilities/radius-map/" })');
    expect(generator).toContain('url.origin !== self.location.origin');
    expect(generator).toContain('url.pathname.startsWith(APP_PATH + "api/")');
  });
});
