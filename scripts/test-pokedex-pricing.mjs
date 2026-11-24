import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.POKEDEX_PRICING_ORIGIN || "http://127.0.0.1:4321";
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
const date = "2026-11-24";
const market = { asOf: date, prices: [
  { number: "001", variant: "normal", cents: 123, observedAt: date },
  { number: "001", variant: "reverse", cents: 525, observedAt: date },
  { number: "002", variant: "normal", cents: 349, observedAt: date },
  { number: "002", variant: "reverse", cents: 105, observedAt: date },
] };
const points = [{ date: "2026-11-19", cents: 122 }, { date: "2026-11-21", cents: 130 }, { date, cents: 123 }];
const stores = ["401 Games", "Deck Out Gaming", "Skyfox Games"];

function retailerFixture(number, variant, now) {
  const quote = (store, priceCents, condition, conditionRank, age = 0) => ({
    store, priceCents, currency: "CAD", condition, conditionRank,
    checkedAt: new Date(now - age).toISOString(), url: "https://skyfoxgames.com/products/test-printing",
  });
  const samplePrinting = number === "001" || number === "002" && variant === "normal";
  const unavailableStores = samplePrinting ? ["401 Games"] : [];
  const checkedStores = Object.fromEntries(stores.filter(store => !unavailableStores.includes(store))
    .map(store => [store, new Date(now).toISOString()]));
  const offers = samplePrinting ? [
    quote("Deck Out Gaming", 180, "Lightly Played", 1),
    quote("Skyfox Games", 250, "Near Mint", 0),
    quote("Skyfox Games", 15, "Near Mint", 0, 601_000),
  ] : number === "002" ? [] : [
    quote("401 Games", 2500 - Number(number), "Near Mint", 0),
  ];
  return { offers, unavailableStores, checkedStores };
}

try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 890 } });
    const page = await context.newPage();
    const now = Date.now();
    await page.clock.install({ time: new Date(now) });
    let fixtureCheckedAt = now;
    let marketGate;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const lookups = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/v1/auth.php") return route.fulfill({ json: { enabled: true, user: null, csrfToken: "fixture" } });
      if (url.pathname.endsWith("/market.php")) {
        if (url.searchParams.has("days")) return route.fulfill({ json: { asOf: date, points } });
        await marketGate;
        return route.fulfill({ json: market });
      }
      if (url.pathname.endsWith("/offers.php")) {
        const set = url.searchParams.get("set");
        const number = url.searchParams.get("number");
        const variant = url.searchParams.get("variant");
        lookups.push({ set, number, variant });
        return route.fulfill({ json: retailerFixture(number, variant, fixtureCheckedAt) });
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
    await expect(page.locator("#card-retail-offers")).not.toContainText("$0.15");
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
    const lookupCount = lookups.length;
    await page.locator("#buy-cards-open").click();
    const buying = page.locator("#buy-cards-dialog");
    const search = buying.locator("#buy-cards-filter");
    const finish = buying.locator("#buy-cards-finish");
    const availability = buying.locator("#buy-cards-availability");
    const sort = buying.locator("#buy-cards-sort");
    const store = buying.locator("#buy-cards-store");
    const maxPrice = buying.locator("#buy-cards-max-price");
    const condition = buying.locator("#buy-cards-condition");
    const checkPage = buying.locator("#buy-cards-check");
    const rows = buying.locator("#buy-cards-list > li");
    await expect(buying).toBeVisible();
    await page.locator("#buy-cards-scope").selectOption("");
    await search.fill("Bulbasaur 001");
    await expect(rows).toHaveCount(0);
    await search.fill("Ivysaur 002");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("2 needed");
    await expect(rows.first()).toContainText("$3.49");
    await sort.selectOption("market");
    await expect(rows.first()).toContainText("Reverse holo");
    await sort.selectOption("binder");
    await finish.selectOption("Regular");
    await expect(rows).toHaveCount(1);
    assert.equal(lookups.length, lookupCount, "Browsing and filtering a binder must not fetch retailer offers.");
    await rows.first().locator("[data-buy-check]").click();
    await expect(rows.first()).toContainText("Skyfox Games");
    await expect(rows.first()).toContainText("$2.50");
    await expect(rows.first()).not.toContainText("$0.15");
    assert.deepEqual(lookups.slice(lookupCount), [{ set: "sv03.5", number: "002", variant: "normal" }]);

    await availability.selectOption("stock");
    await buying.locator("#buy-cards-offer-filters summary").click();
    await store.selectOption("Deck Out Gaming");
    await expect(rows.first()).toContainText("$1.80");
    await maxPrice.fill("1.79");
    await expect(rows).toHaveCount(0);
    await maxPrice.fill("1.80");
    await expect(rows).toHaveCount(1);
    await condition.selectOption("0");
    await expect(rows).toHaveCount(0);
    await condition.selectOption("");
    await maxPrice.fill("");
    await store.selectOption("Skyfox Games");
    await expect(rows).toHaveCount(1);
    assert.equal(await buying.evaluate(dialog => dialog.scrollWidth > dialog.clientWidth + 1), false);

    await rows.first().locator("[data-buy-card]").click();
    await expect(details).toBeVisible();
    await expect(page.locator("#card-pricing-title")).toHaveText("Ivysaur");
    await expect(page.locator("#card-retail-offers li")).toHaveCount(2);
    await page.locator("#card-pricing-back").click();
    await expect(search).toHaveValue("Ivysaur 002");
    await expect(finish).toHaveValue("Regular");
    await expect(availability).toHaveValue("stock");
    await expect(store).toHaveValue("Skyfox Games");
    await expect(rows.first()).toContainText("$2.50");

    await availability.selectOption("");
    await store.selectOption("");
    await finish.selectOption("");
    await expect(rows).toHaveCount(2);
    const narrowedCount = lookups.length;
    await checkPage.click();
    await expect.poll(() => lookups.slice(narrowedCount).some(lookup => lookup.number === "002" && lookup.variant === "reverse")).toBe(true);
    await availability.selectOption("none");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Reverse holo");
    await store.selectOption("401 Games");
    await availability.selectOption("unavailable");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Regular");

    await availability.selectOption("");
    await store.selectOption("");
    await search.fill("");
    const nextPage = buying.locator("#buy-cards-next");
    const beforePage = lookups.length;
    const firstCardText = await rows.first().innerText();
    await nextPage.click();
    await expect(rows.first()).not.toHaveText(firstCardText);
    await expect(rows).toHaveCount(6);
    const visibleCards = await rows.allTextContents();
    assert.equal(lookups.length, beforePage, "Changing pages must not fetch retailer offers.");
    await checkPage.click();
    await expect.poll(() => lookups.length - beforePage).toBe(6);
    const pageRequests = lookups.slice(beforePage);
    assert.equal(new Set(pageRequests.map(lookup => JSON.stringify(lookup))).size, 6);
    assert.ok(pageRequests.every(({ set, number }) => set === "sv03.5" && visibleCards.some(text => text.includes("#" + number))));
    await sort.selectOption("retail");
    await expect(rows.first()).toContainText("Ivysaur");
    await expect(rows.first()).toContainText("$1.80");

    await search.fill("Ivysaur 002");
    await availability.selectOption("stock");
    await expect(rows).toHaveCount(1);
    await page.clock.fastForward(601_000);
    await expect(rows).toHaveCount(0);
    await availability.selectOption("unchecked");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Needs a check");
    await expect(rows.first()).not.toContainText("$2.50");
    await expect(rows.first()).not.toContainText("In stock");

    if (width === 1440) {
      let releaseMarket;
      marketGate = new Promise(resolve => { releaseMarket = resolve; });
      await buying.getByRole("button", { name: "Close Buy Cards" }).click();
      await page.locator("#master-new").click();
      await page.locator("#master-set").fill("sv03.5");
      await page.locator("#master-name").fill("Any finish 151");
      await page.locator("#master-goal").selectOption("numbers");
      await page.getByRole("button", { name: "Save binder", exact: true }).click();
      await expect(page.locator("#master-title")).toContainText("Any finish 151");
      const beforeChoice = lookups.length;
      await page.locator("#buy-cards-open").click();
      await buying.locator("#buy-cards-scope").selectOption({ label: "Any finish 151" });
      await search.fill("Ivysaur 002");
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator("[data-buy-check]")).toBeDisabled();
      await expect(checkPage).toBeDisabled();
      await rows.first().locator("[data-buy-finish]").selectOption("normal");
      await finish.selectOption("Reverse holo");
      await expect(rows.first()).toContainText("Reverse holo");
      await expect(rows.first().locator("[data-buy-finish]")).toHaveCount(0);
      await finish.selectOption("");
      await expect(rows.first().locator("[data-buy-finish]")).toHaveValue("normal");
      assert.equal(lookups.length, beforeChoice, "Choosing a finish must not fetch retailer offers.");
      fixtureCheckedAt = await page.evaluate(() => Date.now());
      await expect(rows.first().locator(".dex-buying-market")).toContainText("Loading");
      await rows.first().locator("[data-buy-card]").click();
      await expect(details).toBeVisible();
      await expect(page.locator("#card-retail-offers li")).toHaveCount(2);
      await page.locator("#card-pricing-back").click();
      releaseMarket();
      await expect(rows.first().locator(".dex-buying-market")).toContainText("$3.49");
      const beforeInlineCheck = lookups.length;
      await rows.first().locator("[data-buy-check]").click();
      await expect.poll(() => lookups.length).toBe(beforeInlineCheck + 1);
      await expect(rows.first()).toContainText("$2.50");
      assert.deepEqual(lookups.slice(beforeInlineCheck), [{ set: "sv03.5", number: "002", variant: "normal" }]);
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Passed ${width}px card search, pricing, and purchasing dashboard filters, lookups, and expiry.`);
  }
} finally { await browser.close(); }
