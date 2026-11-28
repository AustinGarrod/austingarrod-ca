import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, devices, expect } from "@playwright/test";

const origin = "http://127.0.0.1:4321";
const output = resolve("output/utility-updates");
const capture = process.argv.includes("--screenshots");
if (capture) await mkdir(output, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [layout, device] of [
    ["desktop", { viewport: { width: 1440, height: 900 } }],
    ["mobile", devices["Pixel 7"]],
    ["narrow", { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } }],
  ]) {
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    await context.route((url) => url.origin !== origin && url.hostname !== "tile.openstreetmap.org", (route) => route.abort());
    try {
      for (const [slug, entry] of [
        ["pokemon-binder", ""],
        ["pokemon-binder", "buy-cards/"],
        ["pokemon-binder", "shared/"],
        ["radius-map", ""],
        ["screen-cut-calculator", ""],
      ]) {
        const path = `/utilities/${slug}/`;
        const { version: current, assets } = JSON.parse(await readFile(resolve(`dist${path}utility-release.json`), "utf8"));
        const version = current === "a".repeat(64) ? "b".repeat(64) : "a".repeat(64);
        const entryMarkup = await readFile(resolve(`dist${path}${entry}index.html`), "utf8");
        const releaseUrl = `${origin}${path}utility-release.json`;
        const entryUrl = `${origin}${path}${entry}`;
        const shareToken = entry === "shared/" ? `pbs_${"a".repeat(64)}` : "";
        let publishedVersion = current;
        let missingBundle = false;
        let ready = false;
        let releaseRequests = 0;
        const page = await context.newPage();
        const reconnect = () => page.evaluate(() => window.dispatchEvent(new Event("online")));
        const update = page.getByRole("button", { name: "Update now", exact: true });
        await page.route(releaseUrl, (route) => {
          expect(route.request().url()).not.toContain("pbs_");
          releaseRequests++;
          return route.fulfill({
            json: { version: publishedVersion, assets: missingBundle ? [...assets, "/_astro/missing-update.js"] : assets },
            headers: { "cache-control": "no-store" },
          });
        });
        await page.route(entryUrl, (route) => route.fulfill({
          body: ready ? entryMarkup.replace(`data-utility-version="${current}"`, `data-utility-version="${publishedVersion}"`) : entryMarkup,
          contentType: "text/html",
        }));
        if (shareToken) {
          await page.route(`${origin}/api/v1/binder-share.php`, (route) => {
            expect(route.request().headers()["x-binder-share-token"]).toBe(shareToken);
            return route.fulfill({ json: {
              kind: "national", ownedDexIds: [1, 2, 4, 7], orderedDexIds: [25],
              settings: { columns: 4, rows: 4, useBackSides: true, leadingBlankPockets: 0 },
            } });
          });
        }
        await page.goto(entryUrl + (shareToken ? `#${shareToken}` : ""), { waitUntil: "domcontentloaded" });
        await expect.poll(() => releaseRequests).toBeGreaterThan(0);
        await expect(update).toBeHidden();

        if (shareToken) {
          await expect(page.locator("#shared-read-only")).toBeVisible();
        } else if (slug === "screen-cut-calculator") {
          await page.locator("#opening-width").fill("815");
          await page.locator("#opening-height").fill("536");
          await page.locator("#opening-height").blur();
          await expect(page.getByRole("button", { name: "Copy cut list" })).toBeEnabled();
        } else if (slug === "radius-map") {
          await page.locator("#location-search").fill("45.4215, -75.6972");
          await page.locator("#search-button").click();
          await page.locator("#measurement-value").fill("14");
          if (layout !== "desktop" && await page.locator("#panel-toggle").getAttribute("aria-expanded") === "false") {
            await page.locator("#panel-toggle").click();
          }
        }

        publishedVersion = version;
        await expect.poll(async () => { await reconnect(); return await update.isVisible(); }).toBe(true);
        const notice = page.locator(".utility-update");
        expect((await update.boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect((await notice.boundingBox()).height).toBeLessThan(60);
        if (capture) {
          const name = [slug, entry.replace("/", ""), layout].filter(Boolean).join("-");
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
        }

        await update.click();
        await expect(page.locator("[data-utility-update-message]")).toHaveText("The update isn’t ready on this page yet. Try again shortly.");
        if (layout === "narrow" && capture) {
          const name = [slug, entry.replace("/", ""), layout, "blocked"].filter(Boolean).join("-");
          await page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
        }
        await expect(page.locator("[data-utility-version]")).toHaveAttribute("data-utility-version", current);

        if (layout === "desktop" && slug === "screen-cut-calculator") {
          ready = true;
          missingBundle = true;
          await page.route(`${origin}/_astro/missing-update.js`, (route) => route.fulfill({ status: 404 }));
          const missing = page.waitForResponse(`${origin}/_astro/missing-update.js`);
          await update.click();
          expect((await missing).request().method()).toBe("HEAD");
          await expect(update).toBeEnabled();
          await expect(page.locator("[data-utility-version]")).toHaveAttribute("data-utility-version", current);
          missingBundle = false;
          ready = false;
        }

        if (layout === "narrow" && slug === "radius-map") {
          await context.setOffline(true);
          await update.click();
          await expect(page.locator("[data-utility-update-message]")).toHaveText("Reconnect to update.");
          await context.setOffline(false);
        }

        if (layout === "desktop" && slug === "pokemon-binder" && !entry) {
          ready = true;
          const scanner = page.locator("#scan-dialog");
          await scanner.evaluate((dialog) => /** @type {HTMLDialogElement} */ (dialog).showModal());
          await update.evaluate((button) => /** @type {HTMLButtonElement} */ (button).click());
          await expect(page.locator("[data-utility-update-message]")).toHaveText("Finish or close the current binder dialog before updating.");
          await expect(scanner).toBeVisible();
          await scanner.evaluate((dialog) => /** @type {HTMLDialogElement} */ (dialog).close());
          ready = false;
        }

        const later = page.getByRole("button", { name: "Later", exact: true });
        await later.click();
        const previousChecks = releaseRequests;
        await expect.poll(async () => { await reconnect(); return releaseRequests; }).toBeGreaterThan(previousChecks);
        await expect(update).toBeHidden();

        publishedVersion = "c".repeat(64);
        await expect.poll(async () => { await reconnect(); return await update.isVisible(); }).toBe(true);
        ready = true;
        await update.click();
        await expect(page.locator("[data-utility-version]")).toHaveAttribute("data-utility-version", publishedVersion);
        await expect(update).toBeHidden();
        if (shareToken) {
          expect(new URL(page.url()).hash).toBe(`#${shareToken}`);
          await expect(page.locator("#shared-read-only")).toBeVisible();
        } else if (slug === "screen-cut-calculator") {
          await expect(page.locator("#opening-width")).toHaveValue("815");
          await expect(page.locator("#opening-height")).toHaveValue("536");
          await expect(page.getByRole("button", { name: "Copy cut list" })).toBeEnabled();
        } else if (slug === "radius-map") {
          await expect(page.locator("#measurement-value")).toHaveValue("14");
          await expect(page.locator("#location-chosen-label")).toContainText("45.4215");
        }
        console.log(`Utility update passed: ${slug}/${entry} (${layout})`);
        await page.close();
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
