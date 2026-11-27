import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";

const stores = ["401 Games", "Deck Out Gaming", "Skyfox Games"];
const smallCatalog = new Map(await Promise.all([["sv03.5", 9], ["sv01", 1], ["base1", 12]].map(async ([set, count]) => {
  const file = new URL("../public/utilities/pokedex-binder/catalog/master-sets/" + set + ".json", import.meta.url);
  const cards = JSON.parse(await readFile(file, "utf8")).slice(0, count);
  return [set, cards.map(card => ({ ...card, variants: card.variants.filter(item => !item.specialty) }))];
})));
const rateLimited = { offers: [], unavailableStores: [], checkedStores: {}, retryAfter: 4 };
const key = ({ set, number, variant }) => [set, number, variant].join("/");
const initialPrice = 250;

export async function testFullBuyCards(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 890 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const start = Date.now();
  await page.clock.install({ time: new Date(start) });
  const lookups = [], requests = [];
  let observed = start, cents = initialPrice, throttle = "none", limitedStore = false;
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
        const isBatch = route.request().method() === "POST";
        const targets = isBatch ? route.request().postDataJSON().targets : [Object.fromEntries(url.searchParams)];
        assert.ok(targets.length > 0 && targets.length <= 10);
        assert.equal(new Set(targets.map(key)).size, targets.length, "A single batch must not repeat a printing.");
        const throttled = throttle !== "none";
        if (throttle === "once") throttle = "none";
        requests.push({ isBatch, size: targets.length, throttled });
        const results = targets.map(lookup => {
          const requested = Array.isArray(lookup.stores) ? lookup.stores : lookup.stores?.split(",") ?? stores;
          lookups.push({ ...lookup, stores: requested.join(","), throttled });
          if (throttled) return rateLimited;
          const deferred = limitedStore && requested.includes(stores[0]);
          const checked = deferred ? requested.filter(store => store !== stores[0]) : requested;
          const checkedAt = new Date(observed).toISOString();
          return {
            offers: checked.includes(stores[0]) ? [{ store: stores[0], priceCents: cents, currency: "CAD", condition: "Near Mint", conditionRank: 0,
              checkedAt, url: "https://store.401games.ca/products/example-printing?variant=1" }] : [],
            checkedStores: Object.fromEntries(checked.map(store => [store, checkedAt])),
            unavailableStores: [],
            ...(deferred ? { storeRetryAfter: { [stores[0]]: 75 } } : {}),
          };
        });
        return route.fulfill({ json: isBatch ? { results } : results[0] });
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
    const countdownStatus = buying.getByRole("timer");
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
      await page.locator('[data-checklist-row="003:*"]').getByRole("radio", { name: "Have it" }).check();
      await page.locator('[data-checklist-row="006:*"]').getByRole("radio", { name: "Ordered" }).check();
      await expect(page.locator("#master-ordered")).toHaveText("1");
    }

    await buyTab.click();
    await buying.locator("#buy-cards-filters-toggle").click();
    await scope.selectOption({ label: "Main 151" });
    // 24 cards per page: the seven missing cards share one page.
    await expect(rows).toHaveCount(7);
    await expect(buying.locator("#buy-cards-pages")).toBeHidden();
    await search.fill("Ivysaur 002");
    await availability.selectOption("stock");
    await expect(rows).toHaveCount(0);
    await expect(checkAll).toBeEnabled();
    assert.deepEqual(lookups, [], "Opening Buy Cards, paging, and filtering must not check previously unchecked printings.");
    await expect(buying.locator("#buy-cards-watches")).toHaveCount(0);

    const freezeAt = await page.evaluate(() => Date.now() + 5_000);
    await page.clock.pauseAt(freezeAt);
    const countdownUpdates = await countdownStatus.evaluateHandle(status => {
      const messages = [];
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) messages.push(node.textContent ?? "");
        }
      }).observe(status, { childList: true });
      return messages;
    });
    throttle = "always";
    await checkAll.dispatchEvent("click");
    await expect(countdownStatus).toHaveText("Store checks will resume in 4 seconds.");
    await page.clock.runFor(1_000);
    await expect(countdownStatus).toHaveText("Store checks will resume in 3 seconds.");
    await expect(stop).toBeVisible();
    await stop.dispatchEvent("click");
    await expect(progress).toContainText(/stopped/i);
    await expect(countdownStatus).toBeEmpty();
    await expect(checkAll).toBeEnabled();
    const afterStop = lookups.length;
    await page.clock.runFor(4_000);
    assert.equal(lookups.length, afterStop, "Cancel must stop the paused work when its retry time arrives.");

    // The shortened collection has seven missing numbers, including one on the second page.
    const expected = smallCatalog.get("sv03.5").filter(card => !["003", "006"].includes(card.number))
      .flatMap(card => card.variants.map(printing => key({ set: "sv03.5", number: card.number, variant: printing.id }))).sort();
    throttle = "once";
    const scopedStart = lookups.length;
    const requestStart = requests.length;
    await checkAll.dispatchEvent("click");
    await expect(countdownStatus).toHaveText("Store checks will resume in 4 seconds.");
    const throttledPrinting = lookups.slice(scopedStart).find(lookup => lookup.throttled);
    assert.ok(throttledPrinting);
    for (const countdown of ["3 seconds", "2 seconds", "1 second"]) {
      await page.clock.runFor(1_000);
      await expect(countdownStatus).toHaveText("Store checks will resume in " + countdown + ".");
    }
    await page.clock.runFor(999);
    const triedAgain = lookups.slice(scopedStart).some(lookup => !lookup.throttled && key(lookup) === key(throttledPrinting));
    assert.equal(triedAgain, false, "The browser must wait for the full server delay.");
    await expect(countdownStatus).toHaveText("Store checks will resume in 1 second.");
    await page.clock.runFor(1);
    await expect(progress).toContainText("Checked " + expected.length + " of " + expected.length + " printings");
    await expect(countdownStatus).toBeEmpty();
    const messages = await countdownUpdates.jsonValue();
    assert.ok(messages.some(message => message.includes("resume in 1 second.")));
    assert.ok(!messages.some(message => /resume in 0 second/.test(message)), "The countdown must never show zero.");
    await countdownUpdates.dispose();
    await page.clock.resume();
    await expect(checkAll).toBeEnabled();
    const scoped = lookups.slice(scopedStart);
    const deferred = scoped.filter(lookup => lookup.throttled);
    assert.ok(requests.slice(requestStart).some(request => request.isBatch && request.size === 10),
      "A full binder should send up to ten printings in one request.");
    assert.equal(requests.slice(requestStart).filter(request => request.throttled).length, 1,
      "The test should exercise resuming one throttled batch.");
    const completed = scoped.filter(lookup => !lookup.throttled).map(key);
    assert.ok(deferred.every(lookup => completed.includes(key(lookup))), "Every printing in the paused batch should be retried.");
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
    const beforeCachedChecks = requests.length;
    // A checked row offers Compare offers only; the page check covers it.
    await expect(rows.first().locator("[data-buy-check]")).toHaveCount(0);
    await buying.locator("#buy-cards-check").click();
    await expect(progress).toContainText("Checked 1 of 1 printings");
    assert.equal(requests.length, beforeCachedChecks, "A fresh price and fresh empty retailer checks must satisfy a page check.");
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
    await buying.locator("#buy-cards-filters-toggle").click();
    await scope.selectOption({ label: "Main 151" });
    await search.fill("Ivysaur 002");
    await finish.selectOption({ label: "Regular" });
    await expect(rows.first()).toContainText("$6.40");
    assert.ok(lookups.slice(beforeReload).some(lookup => key(lookup) === visiblePrinting),
      "A previously checked printing can refresh after reopening an expired dashboard in a new document.");
    await bindersTab.click();
    await page.locator("#master-new").click();
    await page.locator("#master-set").fill("base1");
    await page.locator("#master-name").fill("Base Set cooldown test");
    await page.locator("#master-goal").selectOption("numbers");
    await page.getByRole("button", { name: "Save binder", exact: true }).click();
    await expect(page.locator("#master-title")).toContainText("Base Set cooldown test");
    await buyTab.click();
    await scope.selectOption({ label: "Base Set cooldown test" });
    await search.fill("");
    await finish.selectOption("");
    await availability.selectOption("");
    await expect(checkAll).toBeEnabled();

    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5_000));
    observed = await page.evaluate(() => Date.now());
    limitedStore = true;
    const storeStart = lookups.length;
    const basePrintings = smallCatalog.get("base1").flatMap(card => card.variants.map(printing =>
      key({ set: "base1", number: card.number, variant: printing.id }))).sort();
    await checkAll.dispatchEvent("click");
    await expect(countdownStatus).toHaveText("401 Games checks will resume in 1m 15s.");
    const firstPass = lookups.slice(storeStart);
    assert.deepEqual(firstPass.map(key).sort(), basePrintings, "Healthy retailers should finish every printing before the wait.");
    assert.ok(firstPass.some(lookup => lookup.stores === stores.slice(1).join(",")),
      "Later printings should skip the retailer with a known cooldown.");
    await expect(rows.first().locator(".dex-buying-offers")).toContainText("No matching offer");

    await page.clock.runFor(74_999);
    assert.deepEqual(lookups.slice(storeStart), firstPass, "A retailer delay longer than 60 seconds must be honored.");
    await expect(countdownStatus).toHaveText("401 Games checks will resume in 1 second.");
    limitedStore = false;
    await page.clock.runFor(1);
    await expect(progress).toContainText(`Checked ${basePrintings.length} of ${basePrintings.length} printings`);
    const retries = lookups.slice(storeStart + firstPass.length);
    assert.deepEqual(retries.map(key).sort(), basePrintings);
    assert.ok(retries.every(lookup => lookup.stores === stores[0]), "Retry only the retailer that reported a cooldown.");
    await page.clock.resume();

    assert.deepEqual(errors, []);
    console.log("Passed full-binder store checks, global and per-retailer rate-limit recovery, cancellation, and visible offer refresh.");
  } finally {
    await context.close();
  }
}
