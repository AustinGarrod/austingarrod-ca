import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";

const stores = ["401 Games", "Deck Out Gaming", "Skyfox Games"];
const smallCatalog = new Map(await Promise.all([["sv03.5", 9], ["sv01", 1]].map(async ([set, count]) => {
  const file = new URL("../public/utilities/pokedex-binder/catalog/master-sets/" + set + ".json", import.meta.url);
  const cards = JSON.parse(await readFile(file, "utf8")).slice(0, count);
  return [set, cards.map(card => ({ ...card, variants: card.variants.filter(item => !item.specialty) }))];
})));
const rateLimited = { offers: [], unavailableStores: [], checkedStores: {}, retryAfter: 2 };
const key = ({ set, number, variant }) => [set, number, variant].join("/");
const initialPrice = 250;

export async function testFullBuyCards(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 890 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const start = Date.now();
  await page.clock.install({ time: new Date(start) });
  const lookups = [];
  let observed = start, cents = initialPrice, throttle = "none";
  try {
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/v1/auth.php") {
        return route.fulfill({ json: { enabled: true, migrationEnabled: false, user: null, csrfToken: "fixture" } });
      }
      const setFile = url.pathname.match(/\/catalog\/master-sets\/([^/]+)\.json$/)?.[1];
      if (smallCatalog.has(setFile)) return route.fulfill({ json: smallCatalog.get(setFile) });
      if (url.pathname.endsWith("/market.php")) return route.fulfill({ json: { asOf: null, prices: [], points: [] } });
      if (url.pathname.endsWith("/offers.php")) {
        const lookup = Object.fromEntries(url.searchParams);
        const throttled = throttle !== "none";
        if (throttle === "once") throttle = "none";
        lookups.push({ ...lookup, throttled });
        if (throttled) return route.fulfill({ json: rateLimited });
        const checkedAt = new Date(observed).toISOString();
        return route.fulfill({ json: {
          offers: [{ store: stores[0], priceCents: cents, currency: "CAD", condition: "Near Mint", conditionRank: 0,
            checkedAt, url: "https://store.401games.ca/products/example-printing?variant=1" }],
          checkedStores: Object.fromEntries(stores.map(store => [store, checkedAt])),
          unavailableStores: [],
        } });
      }
      if (url.pathname.endsWith("/watches.php") || url.pathname.endsWith("/retail-feed.php")) {
        errors.push("Expected only the store offer endpoint for pricing.");
        return route.abort();
      }
      return route.continue();
    });

    const buying = page.locator("#buy-cards-workspace");
    const rows = buying.locator("#buy-cards-list > li");
    const buyTab = page.locator("#buy-cards-open"), bindersTab = page.locator("#binders-open");
    const checkAll = buying.locator("#buy-cards-check-all"), stop = buying.locator("#buy-cards-cancel");
    const progress = buying.locator("#buy-cards-progress"), scope = buying.locator("#buy-cards-scope");
    const search = buying.locator("#buy-cards-filter"), availability = buying.locator("#buy-cards-availability");
    const finish = buying.locator("#buy-cards-finish");

    await page.goto(origin + "/utilities/pokemon-binder/");
    for (const [index, [set, name]] of [["sv03.5", "Main 151"], ["sv03.5", "Spare 151"], ["sv01", "Other expansion"]].entries()) {
      await page.locator(index === 0 ? "#first-set" : "#master-new").click();
      await page.locator("#master-set").fill(set);
      await page.locator("#master-name").fill(name);
      await page.locator("#master-goal").selectOption("numbers");
      await page.getByRole("button", { name: "Save binder", exact: true }).click();
      await expect(page.locator("#master-title")).toContainText(name);
      if (set !== "sv03.5") continue;
      if (await page.locator("#master-checklist").isHidden()) await page.locator("#master-view-checklist").click();
      await page.locator('[data-checklist-row="003:*"]').getByRole("checkbox").check();
      await page.locator('[data-checklist-row="006:*"]').getByRole("button", { name: /Mark ordered/ }).click();
      await expect(page.locator("#master-ordered")).toHaveText("1");
    }

    await buyTab.click();
    await scope.selectOption({ label: "Main 151" });
    await expect(rows).toHaveCount(6);
    await buying.locator("#buy-cards-next").click();
    await expect(rows).toHaveCount(1);
    await search.fill("Ivysaur 002");
    await availability.selectOption("stock");
    await expect(rows).toHaveCount(0);
    await expect(checkAll).toBeEnabled();
    assert.deepEqual(lookups, [], "Opening Buy Cards, paging, and filtering must not check previously unchecked printings.");
    await expect(buying.locator("#buy-cards-watches")).toHaveCount(0);

    throttle = "always";
    await checkAll.click();
    await expect(progress).toContainText(/will resume/i);
    await stop.click();
    await expect(progress).toContainText(/stopped/i);
    await expect(checkAll).toBeEnabled();
    const afterStop = lookups.length;
    await page.clock.fastForward(3_000);
    assert.equal(lookups.length, afterStop, "Cancel must stop the paused work when its retry time arrives.");

    // The shortened collection has seven missing numbers, including one on the second page.
    const expected = smallCatalog.get("sv03.5").filter(card => !["003", "006"].includes(card.number))
      .flatMap(card => card.variants.map(printing => key({ set: "sv03.5", number: card.number, variant: printing.id }))).sort();
    throttle = "once";
    const scopedStart = lookups.length;
    await checkAll.click();
    await expect(progress).toContainText(/will resume/i);
    await page.clock.fastForward(3_000);
    await expect(progress).toContainText("Checked " + expected.length + " of " + expected.length + " printings");
    await expect(checkAll).toBeEnabled();
    const scoped = lookups.slice(scopedStart);
    const deferred = scoped.filter(lookup => lookup.throttled);
    assert.equal(deferred.length, 1, "The test should exercise resuming one throttled printing.");
    const completed = scoped.filter(lookup => !lookup.throttled).map(key);
    assert.ok(completed.includes(key(deferred[0])), "The paused exact printing should be retried.");
    assert.deepEqual(completed.sort(), expected,
      "The selected binder should check all supported missing printings, regardless of filters and page.");

    const other = smallCatalog.get("sv01").flatMap(card => card.variants.map(printing =>
      key({ set: "sv01", number: card.number, variant: printing.id }))).sort();
    const combinedStart = lookups.length;
    await scope.selectOption("");
    await expect(checkAll).toBeEnabled();
    await checkAll.click();
    const total = expected.length + other.length;
    await expect(progress).toContainText("Checked " + total + " of " + total + " printings");
    assert.deepEqual(lookups.slice(combinedStart).map(key).sort(), other,
      "All binders should deduplicate overlapping printings and reuse complete fresh checks.");

    await finish.selectOption({ label: "Regular" });
    await expect(availability).toHaveValue("stock");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("$2.50");
    const beforeExpiry = lookups.length;
    observed += 606_000;
    cents = 325;
    await page.clock.fastForward(601_000);
    await expect(rows.first()).toContainText("$3.25");
    const visiblePrinting = "sv03.5/002/normal";
    assert.deepEqual(lookups.slice(beforeExpiry).map(key), [visiblePrinting],
      "Only the visible previously checked printing should refresh on expiration.");

    await bindersTab.click();
    await expect(buying).toBeHidden();
    const whileHidden = lookups.length;
    observed += 602_000;
    cents = 450;
    await page.clock.fastForward(602_000);
    assert.equal(lookups.length, whileHidden, "The app should not refresh retailer offers while the Buy Cards view is closed.");
    await buyTab.click();
    await expect(rows.first()).toContainText("$4.50");
    assert.deepEqual(lookups.slice(whileHidden).map(key), [visiblePrinting],
      "Reopening the Buy Cards view should refresh expired visible checks.");
    // Simulate the browser backgrounding this document without changing the dashboard route.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const whileBackgrounded = lookups.length;
    observed += 602_000;
    cents = 525;
    await page.clock.fastForward(602_000);
    assert.equal(lookups.length, whileBackgrounded, "A backgrounded tab must leave expired offers alone.");
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      Reflect.deleteProperty(document, "visibilityState");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(rows.first()).toContainText("$5.25");
    assert.deepEqual(lookups.slice(whileBackgrounded).map(key), [visiblePrinting]);
    await bindersTab.click();
    const beforeReload = lookups.length;
    observed += 602_000;
    cents = 640;
    await page.clock.fastForward(602_000);
    await page.reload();
    await expect(buying).toBeHidden();
    assert.equal(lookups.length, beforeReload, "Reloading in Binders must not start any retailer checks.");
    await buyTab.click();
    await scope.selectOption({ label: "Main 151" });
    await search.fill("Ivysaur 002");
    await finish.selectOption({ label: "Regular" });
    await expect(rows.first()).toContainText("$6.40");
    assert.ok(lookups.slice(beforeReload).some(lookup => key(lookup) === visiblePrinting),
      "A previously checked printing can refresh after reopening an expired dashboard in a new document.");
    assert.deepEqual(errors, []);
    console.log("Passed full-binder store checks, rate-limit recovery, cancellation, and visible offer refresh.");
  } finally {
    await context.close();
  }
}
