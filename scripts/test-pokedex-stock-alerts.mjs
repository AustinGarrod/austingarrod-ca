import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { newSetBinder } from "./test-pokedex-helpers.mjs";

const origin = process.env.POKEDEX_PRICING_ORIGIN || "http://127.0.0.1:4321";
const binder = "/utilities/pokemon-binder/";
const deepLink = binder + "buy-cards/?alerts=1";
const screenshots = "output/pokedex-stock-alerts";
const release = JSON.parse(await readFile(`dist${binder}utility-release.json`, "utf8"));
const buyCardsPage = await readFile(`dist${binder}buy-cards/index.html`, "utf8");
const nextVersion = release.version === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
await mkdir(screenshots, { recursive: true });

try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width, height: 890 } });
    const page = await context.newPage();
    const signedIn = { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", email: "collector@example.test" };
    let user = null;
    let revision = "a".repeat(64);
    let alerts = [
      { store: "401 Games", minimum: 5, lastCheckedAt: "2026-11-27T18:35:00Z" },
      { store: "Deck Out Gaming", minimum: 3, lastCheckedAt: null },
    ];
    let failRead = false;
    let conflict = false;
    let version = release.version;
    let waitForSave;
    const writes = [];
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === binder + "utility-release.json") return route.fulfill({ json: { ...release, version } });
      if (url.pathname === binder + "buy-cards/" && !request.isNavigationRequest()) {
        return route.fulfill({ contentType: "text/html", body: buyCardsPage.replace(`data-utility-version="${release.version}"`, `data-utility-version="${version}"`) });
      }
      if (url.pathname === "/api/v1/auth.php") {
        return route.fulfill({ json: { enabled: true, migrationEnabled: false, user, csrfToken: "fixture" } });
      }
      if (url.pathname === "/api/v1/sync.php") {
        if (url.searchParams.get("action") !== "binder-stock-alerts") return route.fulfill({ json: { document: null } });
        assert.equal(request.headers()["x-account-id"], user.id);
        if (request.method() === "POST") {
          if (waitForSave) await waitForSave;
          assert.equal(request.headers()["x-csrf-token"], "fixture");
          const body = request.postDataJSON();
          assert.equal(body.revision, revision);
          writes.push(body.alerts);
          revision = revision === "a".repeat(64) ? "b".repeat(64) : "a".repeat(64);
          if (conflict) return route.fulfill({ status: 409, json: { error: { code: "alerts_changed" } } });
          alerts = body.alerts.map(alert => ({ ...alert, lastCheckedAt: null }));
        } else if (failRead) {
          return route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
        }
        return route.fulfill({ json: { revision, alerts, hasSyncedBinders: true } });
      }
      if (url.pathname.endsWith("/market.php")) return route.fulfill({ json: { asOf: null, prices: [] } });
      return route.continue();
    });

    await page.goto(binder);
    await newSetBinder(page);
    await page.locator("#master-set").fill("sv03.5");
    await page.locator("#master-name").fill("Scarlet & Violet—151");
    await page.getByRole("button", { name: "Save binder", exact: true }).click();
    await expect(page.locator("#master-title")).toHaveText("Scarlet & Violet—151");
    await page.getByRole("link", { name: "Buy cards" }).click();
    const toggle = page.getByRole("button", { name: "Stock alerts", exact: true });
    const panel = page.getByRole("region", { name: "Back-in-stock emails" });
    const signIn = page.getByRole("link", { name: "Sign in to set up stock alerts" });
    await expect(page.locator(".dex-buying-row").first()).toBeVisible();
    await expect(panel).toBeHidden();
    await page.screenshot({ path: `${screenshots}/${width}-closed.png` });
    await toggle.press("Enter");
    await expect(signIn).toHaveAttribute("href", "/account/?returnTo=" + encodeURIComponent(deepLink));
    await page.screenshot({ path: `${screenshots}/${width}-guest.png` });

    user = signedIn;
    failRead = true;
    await page.goto(width === 390 ? binder + "?view=buy-cards&alerts=1" : deepLink);
    await expect(page).toHaveURL(new URL(deepLink, origin).href);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByText("Couldn’t load stock alerts.")).toBeVisible();
    failRead = false;
    await panel.getByRole("button", { name: "Retry" }).click();
    const first = panel.getByRole("checkbox", { name: "401 Games" });
    const third = panel.getByRole("checkbox", { name: "Skyfox Games" });
    const firstMinimum = panel.locator('input[aria-label="Minimum missing cards at 401 Games"]');
    const thirdMinimum = panel.locator('input[aria-label="Minimum missing cards at Skyfox Games"]');
    await expect(firstMinimum).toHaveValue("5");
    await expect(thirdMinimum).toBeDisabled();
    await expect(thirdMinimum).toBeHidden();
    await expect(panel.getByText("Waiting for the first check")).toBeVisible();
    await expect(panel.getByText("Cross-border")).toBeVisible();
    await expect(page.locator(".dex-buying-row").first()).toBeVisible();
    await page.screenshot({ path: `${screenshots}/${width}-settings.png` });
    if (width === 390) await panel.screenshot({ path: `${screenshots}/${width}-panel.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);

    await page.locator("#settings-open").click();
    await page.getByRole("radio", { name: "Choose stores" }).check();
    await page.locator('#retailer-settings-stores input[value="401 Games"]').uncheck();
    await page.getByRole("button", { name: "Save retailer choices" }).click();
    await expect(page.getByRole("button", { name: "Save retailer choices" })).toBeEnabled();
    await page.getByRole("link", { name: "Manage email stock alerts in Buy Cards" }).click();
    await expect(panel).toBeVisible();
    await expect(first).toBeChecked();
    await expect(firstMinimum).toHaveValue("5");
    assert.deepEqual(writes, [], "Price lookup settings must not write email alert preferences.");

    await first.uncheck();
    await expect(firstMinimum).toBeDisabled();
    await expect(firstMinimum).toBeHidden();
    await third.check();
    await expect(thirdMinimum).toBeEnabled();
    await thirdMinimum.fill("7");
    const update = page.getByRole("button", { name: "Update now", exact: true });
    const updateMessage = page.locator("[data-utility-update-message]");
    let finishSave;
    if (width === 1440) {
      version = nextVersion;
      await expect.poll(async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        return update.isVisible();
      }).toBe(true);
      await update.click();
      await expect(updateMessage).toHaveText("Save your stock alert changes before updating.");
      waitForSave = new Promise(resolve => { finishSave = resolve; });
    }
    await panel.getByRole("button", { name: "Save alerts" }).click();
    if (finishSave) {
      try {
        await expect(panel.getByText("Saving stock alerts…")).toBeVisible();
        await update.click();
        await expect(updateMessage).toHaveText("Wait for stock alerts to finish saving before updating.");
      } finally {
        finishSave();
        waitForSave = undefined;
        version = release.version;
      }
    }
    await expect(panel.getByText("Stock alerts saved.")).toBeVisible();
    assert.deepEqual(writes[0], [{ store: "Deck Out Gaming", minimum: 3 }, { store: "Skyfox Games", minimum: 7 }]);
    await page.reload();
    await expect(thirdMinimum).toHaveValue("7");
    await expect(first).not.toBeChecked();

    conflict = true;
    await thirdMinimum.fill("9");
    await panel.getByRole("button", { name: "Save alerts" }).click();
    await expect(panel.getByText("Alerts changed on another device.", { exact: false })).toBeVisible();
    await expect(thirdMinimum).toHaveValue("7");
    await toggle.click();
    await expect(panel).toBeHidden();
    await context.close();
  }
  console.log("Stock alert settings passed at 320, 390 and 1440 px.");
} finally {
  await browser.close();
}
