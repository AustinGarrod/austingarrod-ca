import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.POKEDEX_PRICING_ORIGIN || "http://127.0.0.1:4321";
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
const date = "2026-11-24";
const market = { asOf: date, prices: [
  { number: "001", variant: "normal", cents: 123, observedAt: date },
  { number: "001", variant: "reverse", cents: 525, observedAt: date },
] };
const points = [{ date: "2026-11-19", cents: 122 }, { date: "2026-11-21", cents: 130 }, { date, cents: 123 }];

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 890 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let lookups = 0;
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/v1/auth.php") return route.fulfill({ json: { enabled: true, user: null, csrfToken: "fixture" } });
      if (url.pathname.endsWith("/market.php")) return route.fulfill({ json: url.searchParams.has("days") ? { asOf: date, points } : market });
      if (url.pathname.endsWith("/offers.php")) {
        lookups++;
        const quote = (store, priceCents, condition, conditionRank, age = 0) => ({
          store, priceCents, currency: "CAD", condition, conditionRank, checkedAt: new Date(Date.now() - age).toISOString(),
          url: "https://skyfoxgames.com/products/dark-hypno-9-9-team-rocket",
        });
        return route.fulfill({ json: { offers: [
          quote("Deck Out Gaming", 80, "Lightly Played", 2), quote("Skyfox Games", 125, "Near Mint", 1),
          quote("Expired offer", 15, "Near Mint", 1, 601_000),
        ], unavailableStores: ["401 Games"] } });
      }
      return route.continue();
    });
    await page.goto(origin + "/utilities/pokemon-binder/");
    await expect(page.locator("#binder-onboarding")).toBeVisible();
    await page.locator("#catalog-search-open").click();
    await page.locator("#catalog-search-query").fill("Bulbasaur 001/165");
    await page.locator("#catalog-search-set").selectOption("sv03.5");
    await page.locator("#catalog-search-results li").filter({ hasText: "Bulbasaur" }).getByRole("button").first().click();
    await page.locator("#catalog-search-printings li").filter({ hasText: /^Regular/ }).getByRole("button").first().click();
    const details = page.locator("#card-pricing-dialog");
    await expect(details).toBeVisible();
    await expect(page.locator("#card-market-current")).toHaveText("$1.23 CAD");
    await expect(page.locator("#card-market-chart-region")).toBeVisible();
    await page.locator("#card-market-point").press("ArrowLeft");
    await expect(page.locator("#card-market-point-value")).toContainText("$1.30 CAD");
    await page.locator("#card-market-range").selectOption("90");
    await expect(page.locator("#card-market-history-status")).toHaveText("3 prices recorded");
    await expect(page.locator("#card-retail-offers li").first()).toContainText("Skyfox Games");
    await expect(page.locator("#card-retail-offers")).not.toContainText("Expired offer");
    await expect(page.locator("#card-retail-status")).toContainText("401 Games");
    assert.equal(await details.evaluate(dialog => dialog.scrollWidth > dialog.clientWidth + 1), false);
    await details.getByRole("button", { name: "Close card prices" }).click();

    for (const name of ["First 151", "Second 151"]) {
      await page.locator(name === "First 151" ? "#first-set" : "#master-new").click();
      await page.locator("#master-set").fill("sv03.5");
      await page.locator("#master-name").fill(name);
      await page.getByRole("button", { name: "Save binder", exact: true }).click();
      await expect(page.locator("#master-title")).toContainText(name);
      if (await page.locator("#master-checklist").isHidden()) await page.locator("#master-view-checklist").click();
      await page.locator('[data-checklist-row="001:normal"]').getByRole("checkbox").check();
      await page.locator('[data-checklist-row="001:reverse"]').getByRole("button", { name: /Mark ordered/ }).click();
      await expect(page.locator("#master-ordered")).toHaveText("1");
    }
    await page.locator("#set-overview-open").click();
    await expect(page.locator("#set-overview-totals [data-value-amount]")).toHaveText("$2.46 CAD");
    await expect(page.locator("#set-overview-totals [data-value-coverage]")).toContainText("2 of 2 collected");
    await expect(page.locator("#set-overview-list [data-value-amount]")).toHaveText(["$1.23 CAD", "$1.23 CAD"]);
    const lookupCount = lookups;
    await page.locator("#buy-cards-open").click();
    await page.locator("#buy-cards-scope").selectOption("");
    await page.locator("#buy-cards-filter").fill("Bulbasaur 001");
    await expect(page.locator("#buy-cards-status")).toHaveText("No missing cards match this search.");
    await page.locator("#buy-cards-filter").fill("Ivysaur 002");
    await expect(page.locator("#buy-cards-list li").first()).toContainText("2 needed");
    assert.equal(lookups, lookupCount, "Browsing a binder must not fetch offers in bulk.");
    await page.locator("#buy-cards-list li").first().getByRole("button").click();
    await expect(details).toBeVisible();
    await expect(page.locator("#card-pricing-title")).toHaveText("Ivysaur");
    await expect(page.locator("#card-retail-offers li")).toHaveCount(2);
    await page.locator("#card-pricing-back").click();
    await expect(page.locator("#buy-cards-filter")).toHaveValue("Ivysaur 002");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Passed ${width}px card search, price chart, offer ranking, binder valuation, and Buy Cards.`);
  }
} finally { await browser.close(); }
