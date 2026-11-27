import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { testFullBuyCards } from "./test-pokedex-buying-bulk.mjs";

const origin = process.env.POKEDEX_PRICING_ORIGIN || "http://127.0.0.1:4321";
const binderUrl = origin + "/utilities/pokemon-binder/";
const buyingUrl = binderUrl + "?view=buy-cards";
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
const account = { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", email: "buying@example.test" };

async function notifySessionChange(page) {
  await page.evaluate(() => {
    const channel = new BroadcastChannel("austingarrod.accounts.session.v1");
    channel.postMessage("session-changed");
    channel.close();
  });
}

function retailerFixture(number, variant, now, skyfoxPrice) {
  const quote = (store, priceCents, condition, conditionRank, age = 0) => ({
    store, priceCents, currency: "CAD", condition, conditionRank,
    checkedAt: new Date(now - age).toISOString(), url: "https://skyfoxgames.com/products/test-printing?variant=" + conditionRank,
  });
  const samplePrinting = number === "001" || number === "002" && variant === "normal";
  const unavailableStores = samplePrinting ? ["401 Games"] : [];
  const checkedStores = Object.fromEntries(stores.filter(store => !unavailableStores.includes(store))
    .map(store => [store, new Date(now).toISOString()]));
  const offers = samplePrinting ? [
    quote("Deck Out Gaming", 180, "Lightly Played", 1),
    quote("Skyfox Games", skyfoxPrice, "Near Mint", 0),
    quote("Skyfox Games", 195, "Heavily Played", 3),
    quote("Skyfox Games", 15, "Near Mint", 0, 601_000),
  ] : number === "002" ? [] : [
    quote("401 Games", 2500 - Number(number), "Near Mint", 0),
  ];
  const expiresAt = samplePrinting ? { "Deck Out Gaming": new Date(now + 300_000).toISOString() } : {};
  return { offers, unavailableStores, checkedStores, expiresAt };
}

try {
  const emptyContext = await browser.newContext({ viewport: { width: 390, height: 890 } });
  try {
    const page = await emptyContext.newPage();
    const offers = [];
    let catalogReads = 0, marketReads = 0;
    await emptyContext.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/v1/auth.php") return route.fulfill({ json: { enabled: true, migrationEnabled: false, user: null, csrfToken: "fixture" } });
      if (url.pathname.endsWith("/catalog/cards.json")) catalogReads++;
      if (url.pathname.endsWith("/market.php")) {
        marketReads++;
        return route.fulfill({ json: url.searchParams.has("days") ? { asOf: date, points } : {
          ...market, prices: [{ number: "003", variant: "holo", cents: 999, observedAt: date }],
        } });
      }
      if (url.pathname.endsWith("/offers.php")) {
        const target = Object.fromEntries(url.searchParams);
        offers.push({ method: route.request().method(), ...target });
        return route.fulfill({ json: retailerFixture(target.number, target.variant, Date.now(), 250) });
      }
      return route.continue();
    });
    await page.goto(buyingUrl);
    const buying = page.locator("#buy-cards-workspace");
    await expect(buying.getByRole("heading", { name: "Buy cards", level: 1 })).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("#buy-cards-open")).toHaveAttribute("aria-current", "page");
    const setup = buying.getByRole("link", { name: "Go to Binders" });
    await expect(setup).toBeVisible();
    await expect(buying.locator("#buy-cards-check")).toBeDisabled();
    await expect(buying.locator("#buy-cards-check-all")).toBeDisabled();
    await expect(buying.locator("dialog[open]")).toHaveCount(0);
    await page.reload();
    await expect(setup).toBeVisible();
    assert.equal(offers.length, 0, "A fresh dashboard opening and reload must not fetch retailer offers.");
    assert.equal(catalogReads, 0, "The search index should load when the visitor starts to search.");

    const catalogQuery = buying.locator("#buy-catalog-search-query");
    const catalogSet = buying.locator("#buy-catalog-search-set");
    const inlineDetails = buying.locator("#buy-card-pricing");
    await expect(buying.getByRole("heading", { name: "Find any card" })).toBeVisible();
    await catalogSet.focus();
    await catalogSet.selectOption("sv03.5");
    await catalogQuery.fill("Venusaur ex");
    await buying.getByRole("button", { name: /^Choose printing for Venusaur ex,/ }).click();
    const printing = buying.getByRole("button", { name: "View Venusaur ex, Holo", exact: true });
    await expect(printing).toBeVisible();
    assert.equal(catalogReads, 1);
    assert.equal(marketReads + offers.length, 0, "Choosing a card must wait for an exact printing before requesting prices.");
    await printing.click();
    await expect(inlineDetails.getByRole("heading", { name: "Venusaur ex" })).toBeFocused();
    await expect(inlineDetails.locator("#card-market-current")).toHaveText("$9.99 CAD");
    await expect(inlineDetails.locator("#card-retail-offers")).toContainText("$24.97 CAD");
    assert.deepEqual(offers, [{ method: "GET", set: "sv03.5", number: "003", variant: "holo" }]);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    await inlineDetails.locator("#card-pricing-back").click();
    await expect(inlineDetails).toBeHidden();
    await expect(printing).toBeFocused();
    await printing.click();
    await expect(inlineDetails.locator("#card-retail-offers")).toContainText("$24.97 CAD");
    const refresh = inlineDetails.locator("#card-retail-refresh");
    await refresh.click();
    await expect(refresh).toBeEnabled();
    assert.equal(offers.length, 1, "A repeat catalog lookup should reuse fresh retailer checks.");
    await inlineDetails.locator("#card-pricing-back").click();

    await setup.press("Enter");
    await expect(page).toHaveURL(binderUrl);
    await expect(page.getByRole("heading", { name: "Pokémon Binder Tracker", level: 1 })).toBeVisible();
    await expect(page.locator("#binder-onboarding")).toBeVisible();
    console.log("Passed signed-out Buy Cards catalog lookup without a binder, caching, and focus restoration.");
  } finally {
    await emptyContext.close();
  }

  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 890 } });
    const page = await context.newPage();
    const now = Date.now();
    await page.clock.install({ time: new Date(now) });
    let fixtureCheckedAt = now;
    let skyfoxPrice = 250, retailerFailure = false;
    let marketGate, offerGate, user = null, catalogReads = 0;
    const documents = new Map(), staged = new Map();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const lookups = [], requestedStores = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith("/catalog/cards.json")) catalogReads++;
      if (url.pathname === "/api/v1/auth.php") return route.fulfill({ json: { enabled: true, migrationEnabled: true, user, csrfToken: "fixture" } });
      if (url.pathname === "/api/v1/sync.php") {
        if (!user) return route.fulfill({ status: 401, json: { error: { code: "auth_required" } } });
        const action = url.searchParams.get("action");
        const body = route.request().postDataJSON();
        if (action === "read") return route.fulfill({ json: { document: documents.get(url.searchParams.get("document")) ?? null } });
        if (action === "migration-stage") {
          if (body.variant === "selected") staged.set(body.document, body.state);
          return route.fulfill({ json: { staged: true } });
        }
        if (action === "migration-commit") {
          for (const [document, state] of staged) {
            documents.set(document, { app: "pokedex-binder", document, resourceId: user.id, schemaVersion: 1, revision: 1, acknowledgedSequence: 0, state });
          }
          return route.fulfill({ json: { documents: [...documents.values()] } });
        }
        if (action === "write") {
          const document = documents.get(body.document);
          if (body.mutationSequence > document.acknowledgedSequence) {
            document.revision++;
            document.state = body.state;
            document.acknowledgedSequence = body.mutationSequence;
          }
          return route.fulfill({ json: { document } });
        }
        return route.fulfill({ status: 400, json: { error: { code: "unknown_action" } } });
      }
      if (url.pathname.endsWith("/market.php")) {
        if (url.searchParams.has("days")) return route.fulfill({ json: { asOf: date, points } });
        await marketGate;
        return route.fulfill({ json: market });
      }
      if (url.pathname.endsWith("/offers.php")) {
        const batch = route.request().method() === "POST";
        const targets = batch ? route.request().postDataJSON().targets : [Object.fromEntries(url.searchParams)];
        lookups.push(...targets.map(({ set, number, variant }) => ({ set, number, variant })));
        if (offerGate) {
          await offerGate;
          return route.abort().catch(() => {});
        }
        const results = targets.map(target => {
          const requested = Array.isArray(target.stores) ? target.stores : target.stores?.split(",") ?? stores;
          requestedStores.push(requested);
          if (retailerFailure) return { offers: [], unavailableStores: requested };
          const fixture = retailerFixture(target.number, target.variant, fixtureCheckedAt, skyfoxPrice);
          return {
            offers: fixture.offers.filter(offer => requested.includes(offer.store)),
            unavailableStores: fixture.unavailableStores.filter(store => requested.includes(store)),
            checkedStores: Object.fromEntries(Object.entries(fixture.checkedStores).filter(([store]) => requested.includes(store))),
            expiresAt: fixture.expiresAt,
          };
        });
        return route.fulfill({ json: batch ? { results } : results[0] });
      }
      return route.continue();
    });
    await page.goto(binderUrl);
    await expect(page.locator("#binder-onboarding")).toBeVisible();
    await page.locator("#catalog-search-open").click();
    await page.locator("#catalog-search-query").fill("Bulbasaur 001/165");
    await page.locator("#catalog-search-set").selectOption("sv03.5");
    await page.locator("#catalog-search-results li").filter({ hasText: "Bulbasaur" }).getByRole("button").first().click();
    await page.locator("#catalog-search-printings li").filter({ hasText: /^Regular/ }).getByRole("button").first().click();
    const priceDialog = page.locator("#card-pricing-dialog");
    await expect(priceDialog).toBeVisible();
    await expect(page.locator("#card-market-current")).toHaveText("$1.23 CAD");
    await expect(page.locator("#card-market-chart-region")).toBeVisible();
    await page.locator("#card-market-point").press("ArrowLeft");
    await expect(page.locator("#card-market-point-value")).toContainText("$1.30 CAD");
    await page.locator("#card-market-range").selectOption("90");
    await expect(page.locator("#card-market-history-status")).toHaveText("3 prices recorded");
    await expect(page.locator("#card-retail-offers li").first()).toContainText("Skyfox Games");
    await expect(page.locator("#card-retail-offers")).not.toContainText("$0.15");
    await expect(page.locator("#card-retail-status")).toContainText("401 Games");
    assert.equal(await priceDialog.evaluate(dialog => dialog.scrollWidth > dialog.clientWidth + 1), false);
    await priceDialog.getByRole("button", { name: "Close card prices" }).click();

    for (const name of ["First 151", "Second 151"]) {
      await page.locator(name === "First 151" ? "#first-set" : "#master-new").click();
      await page.locator("#master-set").fill("sv03.5");
      await page.locator("#master-name").fill(name);
      await page.getByRole("button", { name: "Save binder", exact: true }).click();
      await expect(page.locator("#master-title")).toContainText(name);
      if (await page.locator("#master-checklist").isHidden()) await page.locator("#master-view-checklist").click();
      await page.locator('[data-checklist-row="001:normal"]').getByRole("radio", { name: "Have it" }).check();
      await page.locator('[data-checklist-row="001:reverse"]').getByRole("radio", { name: "Ordered" }).check();
      await expect(page.locator("#master-ordered")).toHaveText("1");
    }
    const buying = page.locator("#buy-cards-workspace");
    const buyTab = page.locator("#buy-cards-open");
    const bindersTab = page.locator("#binders-open");
    const scope = buying.locator("#buy-cards-scope");
    const inlineDetails = buying.locator("#buy-card-pricing");
    const activeBinder = await page.locator("#master-switch").inputValue();
    assert.ok(activeBinder);
    await buyTab.press("Enter");
    await expect(page).toHaveURL(buyingUrl);
    await expect(buyTab).toHaveAttribute("aria-current", "page");
    await expect(buying.getByRole("heading", { name: "Buy cards" })).toBeFocused();
    const filtersToggle = buying.locator("#buy-cards-filters-toggle");
    await expect(buying.locator("#buy-cards-filter")).toBeVisible();
    if (await filtersToggle.isVisible()) {
      // On phones the filters sit behind one button that counts the applied filters.
      await expect(filtersToggle).toHaveAttribute("aria-label", "Filters, 1 applied");
      await filtersToggle.click();
      await expect(filtersToggle).toHaveAttribute("aria-expanded", "true");
    }
    await expect(scope).toHaveValue(activeBinder);
    await expect(scope.locator("option:checked")).toHaveText("Second 151");
    await expect(page.locator("#master-title")).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(binderUrl);
    await expect(bindersTab).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#master-title")).toContainText("Second 151");
    await expect(page.locator("#master-checklist")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(buyingUrl);
    await expect(scope).toBeVisible();
    await expect(scope).toHaveValue(activeBinder);
    await bindersTab.click();
    await expect(page).toHaveURL(binderUrl);
    await expect(page.locator("#master-title")).toBeVisible();
    await page.locator("#set-overview-open").click();
    await expect(page.locator("#set-overview-totals [data-value-amount]")).toHaveText("$2.46 CAD");
    await expect(page.locator("#set-overview-totals [data-value-coverage]")).toContainText("2 of 2 collected");
    await expect(page.locator("#set-overview-list [data-value-amount]")).toHaveText(["$1.23 CAD", "$1.23 CAD"]);
    await buyTab.click();
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
    await expect(page.locator("#set-overview")).toBeHidden();
    if (width === 1440) {
      await expect(scope).toBeEnabled();
      const beforeLookup = lookups.length;
      const binderScope = await scope.inputValue();
      const catalogQuery = buying.locator("#buy-catalog-search-query");
      const catalogSet = buying.locator("#buy-catalog-search-set");
      await catalogQuery.fill("Alakazam");
      await catalogSet.selectOption("base1");
      await buying.getByRole("button", { name: /^Choose printing for Alakazam, #1 · Base Set/ }).click();
      const printing = buying.getByRole("button", { name: "View Alakazam, Holo · Unlimited", exact: true });
      await printing.click();
      await expect(inlineDetails.getByRole("heading", { name: "Alakazam" })).toBeFocused();
      await expect(inlineDetails.locator("#card-pricing-identity")).toContainText("Base Set");
      await expect(inlineDetails.locator("#card-retail-offers")).toContainText("$24.99 CAD");
      assert.deepEqual(lookups.slice(beforeLookup), [{ set: "base1", number: "1", variant: "holo+subtype=unlimited" }]);
      assert.equal(catalogReads, 1, "Binder and Buy Cards search should share the loaded catalog.");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await inlineDetails.locator("#card-pricing-back").press("Enter");
      await expect(printing).toBeFocused();
      await expect(scope).toHaveValue(binderScope);
    }
    const lookupCount = lookups.length;
    await scope.selectOption("");
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);

    const beforeCompare = lookups.length;
    await rows.first().locator("[data-buy-card]").click();
    await expect(inlineDetails).toBeVisible();
    await expect(inlineDetails.getByRole("heading", { name: "Ivysaur" })).toBeFocused();
    await expect(inlineDetails.locator("#card-market-chart-region")).toBeVisible();
    await expect(inlineDetails.locator("#card-retail-offers li")).toHaveCount(3);
    assert.equal(lookups.length, beforeCompare, "Opening a partially successful check should reuse fresh quotes.");
    retailerFailure = true;
    await inlineDetails.locator("#card-retail-refresh").click();
    await expect.poll(() => lookups.length).toBe(beforeCompare + 1);
    await expect(inlineDetails.locator("#card-retail-refresh")).toBeEnabled();
    assert.deepEqual(requestedStores.at(-1), ["401 Games"], "Refresh should retry only the retailer without a fresh check.");
    await expect(inlineDetails.locator("#card-retail-offers li")).toHaveCount(3);
    retailerFailure = false;
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(search).toBeVisible();
    await expect(rows.first()).toBeVisible();
    await inlineDetails.locator("#card-pricing-back").press("Enter");
    await expect(inlineDetails).toBeHidden();
    await expect(rows.first().locator("[data-buy-card]")).toBeFocused();
    await expect(search).toHaveValue("Ivysaur 002");
    await expect(finish).toHaveValue("Regular");
    await expect(availability).toHaveValue("stock");
    await expect(store).toHaveValue("Skyfox Games");
    await expect(rows.first()).toContainText("$2.50");
    await bindersTab.click();
    await expect(page.locator("#set-overview")).toBeVisible();
    await buyTab.click();
    await expect(search).toHaveValue("Ivysaur 002");
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
    await expect(rows).toHaveCount(24);
    const secondPageLabel = await buying.locator("#buy-cards-page").textContent();
    await page.goBack();
    await expect(page).toHaveURL(binderUrl);
    await expect(page.locator("#set-overview")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(buyingUrl);
    await expect(rows).toHaveCount(24);
    await expect(buying.locator("#buy-cards-page")).toHaveText(secondPageLabel);
    const visibleCards = await rows.allTextContents();
    assert.equal(lookups.length, beforePage, "Changing pages must not fetch retailer offers.");
    await checkPage.click();
    await expect.poll(() => lookups.length - beforePage).toBe(24);
    const pageRequests = lookups.slice(beforePage);
    assert.equal(new Set(pageRequests.map(lookup => JSON.stringify(lookup))).size, 24);
    assert.ok(pageRequests.every(({ set, number }) => set === "sv03.5" && visibleCards.some(text => text.includes("#" + number))));
    await sort.selectOption("retail");
    await expect(rows.first()).toContainText("Ivysaur");
    await expect(rows.first()).toContainText("$1.80");
    const cheapestSkyfox = rows.first().getByRole("link", { name: /Skyfox Games listing for \$1\.95/ });
    await expect(cheapestSkyfox).toHaveAttribute("href", /variant=3$/);
    await sort.selectOption("retail-desc");
    await expect(rows.first()).not.toContainText("Ivysaur");
    await sort.selectOption("stock");
    await expect(rows.first()).toContainText("In stock");

    await search.fill("Ivysaur 002");
    await availability.selectOption("stock");
    await expect(rows).toHaveCount(1);
    await page.clock.fastForward(301_000);
    await expect(rows.first().locator(".dex-buying-offers > div").filter({ hasText: "Deck Out Gaming" })).not.toContainText("$1.80");
    await expect(rows.first().locator(".dex-buying-offers > div").filter({ hasText: "Skyfox Games" })).toContainText("$2.50");
    await page.clock.fastForward(300_000);
    await expect(rows).toHaveCount(0);
    await availability.selectOption("");
    await expect(rows).toHaveCount(2);
    const expiredRow = rows.filter({ hasText: "Regular" });
    await expect(expiredRow).not.toContainText("$2.50");
    await expect(expiredRow).not.toContainText("In stock");
    await expect(rows.filter({ hasText: "Reverse holo" })).toContainText("Needs a check");

    if (width === 1440) {
      let releaseMarket;
      marketGate = new Promise(resolve => { releaseMarket = resolve; });
      await bindersTab.click();
      await page.locator("#master-new").click();
      await page.locator("#master-set").fill("sv03.5");
      await page.locator("#master-name").fill("Any finish 151");
      await page.locator("#master-goal").selectOption("numbers");
      await page.getByRole("button", { name: "Save binder", exact: true }).click();
      await expect(page.locator("#master-title")).toContainText("Any finish 151");
      const beforeChoice = lookups.length;
      await buyTab.click();
      await scope.selectOption({ label: "Any finish 151" });
      await availability.selectOption("");
      await search.fill("Ivysaur 002");
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator("[data-buy-check]")).toHaveCount(0); // A row without an exact finish cannot be checked.
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
      await expect(inlineDetails).toBeVisible();
      await expect(inlineDetails.locator("#card-retail-offers li")).toHaveCount(3);
      await inlineDetails.locator("#card-pricing-back").click();
      releaseMarket();
      await expect(rows.first().locator(".dex-buying-market")).toContainText("$3.49");
      const beforeInlineCheck = lookups.length;
      await checkPage.click(); // Once a row has offers, the page check refreshes it.
      await expect.poll(() => lookups.length).toBe(beforeInlineCheck + 1);
      await expect(rows.first()).toContainText("$2.50");
      assert.deepEqual(lookups.slice(beforeInlineCheck), [{ set: "sv03.5", number: "002", variant: "normal" }]);

      const beforeReload = lookups.length;
      await page.reload();
      await expect(page).toHaveURL(buyingUrl);
      await expect(scope).toHaveValue("");
      await expect(scope.locator("option")).toHaveCount(4);
      await expect(search).toHaveValue("");
      await expect(rows).toHaveCount(24);
      await search.fill("Ivysaur 002");
      await expect(rows.first()).toContainText("$2.50");
      await expect(rows.first()).toContainText("Checked");
      assert.ok(!lookups.slice(beforeReload).some(({ set, number, variant }) =>
        set === "sv03.5" && number === "002" && variant === "normal"), "A dashboard reload should reuse a fresh store check.");

      await bindersTab.click();
      user = account;
      await notifySessionChange(page);
      await page.locator("#sync-open").click();
      await page.locator("#binder-account-review").click();
      await page.locator("#binder-migration-layout").selectOption("device");
      await page.locator("#binder-migration-form button[type=submit]").click();
      await expect(page.locator("#dex-status")).toHaveText("Synced · Saved on this device");
      await expect(page.locator("#binder-migration-dialog")).toBeHidden();
      await page.locator("#master-new").click();
      await page.locator("#master-set").fill("sv03.5");
      await page.locator("#master-name").fill("Account only 151");
      await page.getByRole("button", { name: "Save binder", exact: true }).click();
      await expect(page.locator("#master-title")).toContainText("Account only 151");
      await buyTab.click();
      await scope.selectOption({ label: "Account only 151" });
      await search.fill("Ivysaur 002");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).not.toContainText("$2.50");
      fixtureCheckedAt = await page.evaluate(() => Date.now());
      skyfoxPrice = 280;
      await rows.first().locator("[data-buy-check]").click();
      await expect(rows.first()).toContainText("$2.80");
      await rows.first().locator("[data-buy-card]").click();
      await expect(inlineDetails.locator("#card-retail-offers li")).toHaveCount(3);

      user = null;
      await notifySessionChange(page);
      await expect(page).toHaveURL(buyingUrl);
      await expect(inlineDetails).toBeHidden();
      await expect(scope.locator("option").filter({ hasText: "Account only 151" })).toHaveCount(0);
      await expect(scope.locator("option")).toHaveCount(4);
      await expect(scope).toHaveValue("");
      await expect(search).toHaveValue("");
      await search.fill("Ivysaur 002");
      await expect(rows.first()).toContainText("$2.50");
      await expect(rows.first()).not.toContainText("$2.80");
      await page.clock.fastForward(601_000);
      await expect(rows.first()).toContainText("Needs a check");
      await expect(rows.first()).not.toContainText("$2.50");

      let releaseOffer;
      offerGate = new Promise(resolve => { releaseOffer = resolve; });
      try {
        const beforeCheck = lookups.length;
        await rows.filter({ hasText: "Regular" }).first().locator("[data-buy-check]").click();
        await expect.poll(() => lookups.length).toBe(beforeCheck + 1);
        const aborted = page.waitForEvent("requestfailed", {
          predicate: request => new URL(request.url()).pathname.endsWith("/offers.php"),
          timeout: 5000,
        });
        await Promise.all([aborted, bindersTab.click()]);
        await expect(buying).toBeHidden();
        await buyTab.click();
        await expect(search).toHaveValue("Ivysaur 002");
        await expect(rows.filter({ hasText: "Regular" }).first()).toContainText("Needs a check");
      } finally {
        releaseOffer();
        offerGate = undefined;
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Passed ${width}px card search, pricing, and purchasing dashboard navigation, filters, lookups, and expiry.`);
  }
  await testFullBuyCards(browser, origin);
} finally { await browser.close(); }
