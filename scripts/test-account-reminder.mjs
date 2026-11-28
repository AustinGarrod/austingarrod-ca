import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, devices, expect } from "@playwright/test";

const origin = "http://127.0.0.1:" + Number(process.env.PORT || 4321);
const binder = "/utilities/pokemon-binder/";
const companion = "/utilities/idle-slayer-companion/ascension/";
const radius = "/utilities/radius-map/";
const visitKey = "austingarrod.account-reminder.v1";
const output = resolve("output/account-reminder");
const capture = process.argv.includes("--screenshots");
const accountUser = { id: "1840f35e-3d1f-4bc2-80e5-825163502147", email: "guest@example.test" };
const openNotice = page => page.getByRole("complementary", { name: "Utility account reminder" });
const visit = page => expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), visitKey));
const browser = await chromium.launch();
const pageErrors = [];
if (capture) await mkdir(output, { recursive: true });

async function fixture(device, { enabled = true, migrationEnabled = true, user = null } = {}) {
  const context = await browser.newContext({ ...device, serviceWorkers: "block" });
  const session = () => ({ enabled, migrationEnabled, user, csrfToken: "local-fixture" });
  await context.addInitScript(localOrigin => {
    if (window.location.origin !== localOrigin) return;
    localStorage.setItem("umami.disabled", "1");
    localStorage.setItem("idle-slayer-ascension-map.analytics.v1", "disabled");
  }, origin);
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/v1/auth.php") {
      const action = url.searchParams.get("action");
      if (action === "session") return route.fulfill({ json: session() });
      if (action === "email-start") {
        expect(route.request().postDataJSON().returnTo).toBe(radius);
        return route.fulfill({ json: { challengeId: "local-challenge", expiresIn: 600, retryAfter: 30 } });
      }
      if (action === "email-verify") {
        user = accountUser;
        return route.fulfill({ json: session() });
      }
    }
    if (url.pathname === "/api/v1/sync.php") return route.fulfill({ json: { document: null, snapshots: [] } });
    return route.continue();
  });
  context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
  return context;
}

async function shot(page, name) {
  if (!capture) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, name + ".png"), animations: "disabled" });
}

async function checkNotice(page, title, route) {
  const notice = openNotice(page);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(title);
  const create = notice.getByRole(route === radius ? "button" : "link", { name: "Create an account" });
  if (route !== radius) await expect(create).toHaveAttribute("href", "/account/?returnTo=" + encodeURIComponent(route));
  for (const control of [create, notice.getByRole("button", { name: "Keep working" })]) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await visit(page).toBe("shown");
}

async function startBinder(page) {
  await page.goto(origin + binder);
  await expect(page.locator("#dex-app")).toHaveAttribute("aria-busy", "false");
  await page.locator("#first-dex").click();
  await expect(page.locator("#owned-count")).toHaveText("0");
  await visit(page).toBe("1");
  await expect(openNotice(page)).toBeHidden();
}

async function editBinder(page) {
  await page.locator("#open-grid-1").click();
  const details = page.locator("#pokemon-details");
  await expect(details).toBeVisible();
  const owned = details.locator('label').filter({ has: page.locator('input[data-dex-status][value="owned"]') });
  await owned.click();
  await expect(page.locator("#owned-count")).toHaveText("1");
}

async function placeCircle(page) {
  await page.locator("#location-search").fill("45.4215, -75.6972");
  await page.locator("#search-button").click();
  await expect(page.locator("#app-status")).toContainText("entered coordinates");
}

async function changeDistance(page, distance) {
  const value = page.locator("#measurement-value");
  await value.fill(String(distance));
  await value.press("Enter");
}

async function openRadius(page) {
  await page.goto(origin + radius);
  await expect(page.locator("#location-search")).toBeVisible();
}

try {
  for (const [layout, device] of [
    ["desktop", { viewport: { width: 1440, height: 900 } }],
    ["mobile", devices["Pixel 7"]],
    ["narrow", { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } }],
  ]) {
    const binderContext = await fixture(device);
    const binderPage = await binderContext.newPage();
    await startBinder(binderPage);
    await editBinder(binderPage);
    await checkNotice(binderPage, "Sync your collection", binder);
    await shot(binderPage, "binder-details-" + layout);
    await binderContext.close();

    const companionContext = await fixture(device);
    const companionPage = await companionContext.newPage();
    await companionPage.goto(origin + companion);
    await companionPage.getByRole("button", { name: "Return to start", exact: true }).click();
    await companionPage.getByRole("button", { name: "Record purchase…", exact: true }).click();
    await companionPage.getByRole("button", { name: "Apply purchases", exact: true }).click();
    await visit(companionPage).toBe("1");
    await expect(openNotice(companionPage)).toBeHidden();
    const undo = companionPage.locator(".companion-session-status").getByRole("button", { name: "Undo", exact: true });
    if (await undo.isVisible()) await undo.click();
    else {
      await companionPage.locator(".toolbar").getByRole("button", { name: "Record", exact: true }).click();
      await companionPage.locator(".menu-popup > button").filter({ has: companionPage.locator("span", { hasText: /^Undo$/ }) }).click();
    }
    await checkNotice(companionPage, "Sync your progress", "/utilities/idle-slayer-companion/");
    await shot(companionPage, "companion-ascension-" + layout);
    await companionContext.close();

    const radiusContext = await fixture(device);
    const radiusPage = await radiusContext.newPage();
    await openRadius(radiusPage);
    await placeCircle(radiusPage);
    await visit(radiusPage).toBe("1");
    await changeDistance(radiusPage, 10);
    await visit(radiusPage).toBe("1");
    await expect(openNotice(radiusPage)).toBeHidden();
    await changeDistance(radiusPage, 14);
    await checkNotice(radiusPage, "Save this measurement", radius);
    const toggle = radiusPage.locator("#panel-toggle");
    const mobile = await toggle.getAttribute("aria-expanded") === "false";
    await shot(radiusPage, "radius-map-" + layout + (mobile ? "-peek" : ""));
    if (mobile) {
      for (const selector of ["#measurement-value", "#summary-value", "#peek-save-button"]) {
        await expect(radiusPage.locator(selector)).toBeInViewport({ ratio: 1 });
      }
      await toggle.click();
      await expect(radiusPage.locator("#save-measurement-button")).toBeVisible();
      await shot(radiusPage, "radius-map-" + layout + "-expanded");
    }
    const dismiss = openNotice(radiusPage).getByRole("button", { name: "Keep working" });
    await dismiss.focus();
    await dismiss.press("Enter");
    await expect(openNotice(radiusPage)).toBeHidden();
    await changeDistance(radiusPage, 16);
    await expect(openNotice(radiusPage)).toBeHidden();
    await radiusPage.reload();
    await expect(radiusPage.locator("#measurement-value")).toHaveValue("16");
    await changeDistance(radiusPage, 17);
    await expect(openNotice(radiusPage)).toBeHidden();
    await radiusContext.close();
  }

  const sharedContext = await fixture();
  const page = await sharedContext.newPage();
  await startBinder(page);
  await page.reload();
  await visit(page).toBe("1");
  const placeLabel = "Local fixture location " + "long locality name ".repeat(18);
  await page.route(origin + "/utilities/radius-map/api/geocode.php?*", route => route.fulfill({
    json: { results: [{ lat: 45.4215, lng: -75.6972, label: placeLabel }] },
  }));
  await openRadius(page);
  await page.locator("#location-search").fill("Local fixture location");
  await page.locator("#search-button").click();
  await page.locator(".search-result-button").click();
  await checkNotice(page, "Save this measurement", radius);
  const independent = await sharedContext.newPage();
  await openRadius(independent);
  await placeCircle(independent);
  await visit(independent).toBe("1");
  await expect(openNotice(independent)).toBeHidden();
  await independent.close();
  await openNotice(page).getByRole("button", { name: "Create an account" }).click();
  await expect(page).toHaveURL(origin + "/account/?returnTo=" + encodeURIComponent(radius));
  await page.locator("#account-email").fill(accountUser.email);
  await page.locator("#account-email-submit").click();
  await page.locator("#account-code").fill("123456");
  await page.locator("#account-code-submit").click();
  await expect(page).toHaveURL(origin + radius);
  await expect(page.locator("#save-dialog")).toBeVisible();
  await expect(page.locator("#save-dialog-summary")).toContainText("10 km radius");
  await expect(openNotice(page)).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(origin + "/account/?returnTo=" + encodeURIComponent(radius));
  await page.goBack();
  await expect(page).toHaveURL(origin + radius);
  await expect(openNotice(page)).toBeHidden();
  await sharedContext.close();

  for (const configuration of [{ enabled: false }, { user: accountUser }]) {
    const context = await fixture({}, configuration);
    const page = await context.newPage();
    await openRadius(page);
    await placeCircle(page);
    await changeDistance(page, 14);
    await expect(openNotice(page)).toBeHidden();
    expect(await page.evaluate(key => sessionStorage.getItem(key), visitKey)).not.toBe("shown");
    await context.close();
  }

  const delayedContext = await fixture();
  const delayedPage = await delayedContext.newPage();
  await openRadius(delayedPage);
  await placeCircle(delayedPage);
  await delayedContext.setOffline(true);
  await changeDistance(delayedPage, 14);
  await visit(delayedPage).toBe("2");
  await expect(openNotice(delayedPage)).toBeHidden();
  await delayedContext.setOffline(false);
  await checkNotice(delayedPage, "Save this measurement", radius);
  await delayedPage.locator("#centre-chip-clear").click();
  await expect(openNotice(delayedPage)).toBeHidden();
  await placeCircle(delayedPage);
  await expect(openNotice(delayedPage)).toBeHidden();
  await delayedContext.close();

  const storageContext = await fixture();
  const storagePage = await storageContext.newPage();
  await storagePage.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "austingarrod.utilities.radius-map.draft.v1") throw new DOMException("Fixture quota exceeded", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
  await openRadius(storagePage);
  await placeCircle(storagePage);
  await changeDistance(storagePage, 14);
  await expect(openNotice(storagePage)).toBeHidden();
  await visit(storagePage).toBe(null);
  await storagePage.locator("#save-measurement-button").click();
  await storagePage.locator("#radius-sign-in-to-save").click();
  await expect(storagePage.locator("#sign-in-dialog-copy")).toContainText("Your draft could not be kept for sign-in.");
  await expect(storagePage).toHaveURL(origin + radius);
  await storageContext.close();

  const updateContext = await fixture();
  const updatePage = await updateContext.newPage();
  const releaseUrl = origin + binder + "utility-release.json";
  const release = await (await updateContext.request.get(releaseUrl)).json();
  let updateReady = false;
  await updatePage.route(releaseUrl, route => route.fulfill({
    json: updateReady ? { ...release, version: "a".repeat(64) } : release,
    headers: { "cache-control": "no-store" },
  }));
  await startBinder(updatePage);
  updateReady = true;
  await updatePage.evaluate(() => window.scrollTo(0, 500));
  const update = updatePage.locator(".utility-update");
  await expect.poll(async () => {
    await updatePage.evaluate(() => window.dispatchEvent(new Event("online")));
    return update.isVisible();
  }).toBe(true);
  await editBinder(updatePage);
  await visit(updatePage).toBe("2");
  await expect(openNotice(updatePage)).toBeHidden();
  await update.getByRole("button", { name: "Later" }).click();
  await checkNotice(updatePage, "Sync your collection", binder);
  await updatePage.locator("#settings-open").click();
  await expect(openNotice(updatePage)).toBeHidden();
  await updatePage.locator("#binders-open").click();
  await expect(openNotice(updatePage)).toBeHidden();
  await updateContext.close();

  expect(pageErrors).toEqual([]);
  console.log("Account reminder passed for all utilities, tab sessions, offline recovery, and Radius Map sign-in.");
} finally {
  await browser.close();
}
