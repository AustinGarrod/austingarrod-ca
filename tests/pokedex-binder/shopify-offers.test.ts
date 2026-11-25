import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const php = process.env.PHP_BINARY || "php";
const phpVersion = spawnSync(php, ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8" });

function runPhp(expression: string, input?: unknown, args: string[] = []) {
  const code = [
    "require 'public/utilities/pokemon-binder/api/_offers.php';",
    "set_error_handler(static function($severity, $message) { throw new ErrorException($message, 0, $severity); });",
    "$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);",
    `echo json_encode(${expression}, JSON_THROW_ON_ERROR);`,
  ].join("\n");
  return JSON.parse(execFileSync(php, [...args, "-r", code], { input: JSON.stringify(input ?? null), encoding: "utf8" }));
}

const target = { set: "sv03.5", number: "135", variant: "reverse" };

const printing = {
  id: "gid://shopify/ProductVariant/12345",
  title: "Near Mint",
  price: { amount: 300, currency: "CAD" },
  availability: { available: true },
  options: [{ name: "Condition", label: "Near Mint" }],
};

const store401 = {
  title: "Jolteon - 135/165 - Rare - Reverse Holo",
  url: "https://store.401games.ca/products/jolteon-135-165-rare-reverse-holo",
  description: { html: "<p>Jolteon from Scarlet &amp; Violet: 151, available at 401 Games Canada.</p>Finish: Reverse Holo<br>Artist: Example" },
  variants: [printing],
};

function offers(products: unknown[], store = 0, card = target) {
  return runPhp("binder_offer_rows(binder_offer_target('public', $input['card']), BINDER_OFFER_STORES[$input['store']], $input['products'], 1771000000)", { products, store, card });
}

describe.skipIf(Number(phpVersion.stdout || 0) < 80400)("Shopify card offers", () => {
  it("quotes an exact 401 Games printing and links to the in-stock condition", () => {
    expect(offers([store401])).toEqual([{
      store: "401 Games",
      priceCents: 300,
      currency: "CAD",
      condition: "Near Mint",
      conditionRank: 0,
      checkedAt: new Date(1771000000 * 1000).toISOString().replace(".000Z", "+00:00"),
      url: store401.url + "?variant=12345",
    }]);
  });

  it("keeps Shopify attribution when linking to the matched variant", () => {
    const [offer] = offers([{
      ...store401, url: store401.url + "?shcgid=group%2F1&variant=999&shclid=click%261&utm_source=extra#fragment",
    }]);
    expect(offer.url).toBe(store401.url + "?shcgid=group%2F1&shclid=click%261&variant=12345");
  });

  it("recognizes the Deck Out and Skyfox formats for an unlimited holo card", () => {
    const vintage = { set: "base5", number: "9", variant: "holo" };
    const heavierPlay = { ...printing, title: "Heavily Played Holofoil", options: [{ name: "Title", label: "Heavily Played Holofoil" }] };
    const moderatePlay = { ...printing, title: "Moderately Played Holofoil", options: [{ name: "Title", label: "Moderately Played Holofoil" }] };
    const deckOut = { title: "Dark Hypno (9) (9) [Team Rocket] Unlimited Holofoil", url: "https://deckoutgaming.ca/products/dark-hypno-9-9", variants: [heavierPlay] };
    const skyfox = { title: "Dark Hypno (9/82) [Team Rocket Unlimited]", url: "https://skyfoxgames.com/products/dark-hypno-9-9-team-rocket", variants: [moderatePlay] };
    expect(offers([deckOut], 1, vintage)).toEqual([expect.objectContaining({ store: "Deck Out Gaming", conditionRank: 3 })]);
    expect(offers([skyfox], 2, vintage)).toEqual([expect.objectContaining({ store: "Skyfox Games", conditionRank: 2 })]);
    expect(offers([skyfox], 2, { ...vintage, variant: "holo+stamp=1st-edition" })).toEqual([]);
    expect(offers([{ ...skyfox, title: skyfox.title.replace("Unlimited", "1st Edition") }], 2, vintage)).toEqual([]);
  });

  it("rejects near-miss printings, conflicting data, and unavailable quotes", () => {
    const cases = [
      { ...store401, title: store401.title.replace("Jolteon", "Flareon") },
      { ...store401, title: store401.title.replace("135/165", "136/165") },
      { ...store401, title: store401.title.replace("135/165", "135/196") },
      { ...store401, description: { html: store401.description.html.replace("151", "Obsidian Flames") } },
      { ...store401, description: { html: store401.description.html.replace("Finish: Reverse Holo", "Finish: Holofoil") } },
      { ...store401, description: { html: store401.description.html + "<br>Language: Japanese" } },
      { ...store401, title: store401.title + " Poké Ball" },
      { ...store401, title: store401.title + " Prize Pack" },
      { ...store401, title: "Jolteon - 135/165 - Rare", description: { html: "Jolteon from Scarlet &amp; Violet: 151, available at 401 Games." } },
      { ...store401, variants: [{ ...printing, options: [{ name: "Language", label: "JP" }] }] },
      { ...store401, variants: [{ ...printing, availability: { available: false } }] },
      { ...store401, variants: [{ ...printing, availability: { available: "true" } }] },
      { ...store401, variants: [{ ...printing, price: { amount: 200, currency: "USD" } }] },
      { ...store401, variants: [{ ...printing, price: { amount: "300", currency: "CAD" } }] },
      { ...store401, variants: [{ ...printing, title: "Factory Sealed", options: [] }] },
      { ...store401, variants: "invalid" },
      { ...store401, url: "https://store.401games.ca.example.com/products/jolteon" },
      { ...store401, url: "https://store.401games.ca:1234/products/jolteon" },
      { ...store401, url: "https://example.com@store.401games.ca/products/jolteon" },
      { ...store401, url: "https://store.401games.ca/cart/12345:1" },
    ];
    const matches = runPhp("array_map(static fn($product) => binder_offer_rows(binder_offer_target('public', $input['card']), BINDER_OFFER_STORES[0], [$product], 1771000000), $input['cases'])", { card: target, cases });
    expect(matches.map((rows: unknown[]) => rows.length)).toEqual(cases.map(() => 0));
  });

  it("uses the exact catalog slot and limits requests to Canadian product searches", () => {
    expect(runPhp("binder_offer_target('public', $input)", { ...target, variant: "*" })).toBeNull();
    expect(runPhp("binder_offer_target('public', $input)", { ...target, set: "../other" })).toBeNull();
    const payload = runPhp("json_decode(binder_offer_payload(binder_offer_query(binder_offer_target('public', $input)), BINDER_OFFER_PROFILE), true)", target);
    expect(payload).toMatchObject({
      method: "tools/call",
      params: {
        name: "search_catalog",
        arguments: {
          catalog: {
            query: "Jolteon 135/165 Scarlet & Violet 151 Reverse holo",
            context: { address_country: "CA", currency: "CAD", language: "en" },
          },
        },
      },
    });
  });

  it("handles Shopify JSON and server-sent event responses and rejects failed envelopes", () => {
    const valid = JSON.stringify({ result: { structuredContent: { ucp: { status: "success" }, products: [store401] } } });
    expect(runPhp("binder_offer_products($input)", valid)).toEqual([store401]);
    expect(runPhp("binder_offer_products($input)", `event: message\r\ndata: ${valid}\r\n\r\n`)).toEqual([store401]);
    expect(runPhp("binder_offer_products($input)", JSON.stringify({ result: { isError: true } }))).toBeNull();
    expect(runPhp("binder_offer_products($input)", JSON.stringify({ result: { structuredContent: { ucp: { status: "partial" }, products: [store401] } } }))).toBeNull();
  });

  it("reports original check times even for stores with no offers", () => {
    const [offer] = offers([store401]);
    const checks = {
      "store.401games.ca": { checkedAt: 1771000000, offers: [offer, offer] },
      "deckoutgaming.ca": { checkedAt: 1770999700, offers: [] },
    };
    const cachedStores = `array_map(static fn(array $check): array => [
      'expiresAt' => $check['checkedAt'] + BINDER_OFFER_TTL, 'offers' => $check['offers'],
    ], $input)`;
    const result = runPhp(`binder_offer_result(${cachedStores})`, checks);
    expect(result).toEqual({
      offers: [offer],
      unavailableStores: ["Skyfox Games"],
      checkedStores: {
        "401 Games": offer.checkedAt,
        "Deck Out Gaming": new Date(1770999700 * 1000).toISOString().replace(".000Z", "+00:00"),
      },
    });
    expect(runPhp(`binder_offer_result(${cachedStores}, 17)`, checks)).toEqual({
      ...result,
      unavailableStores: [],
      retryAfter: 17,
    });
    expect(runPhp("binder_offer_result([])")).toEqual({
      offers: [],
      unavailableStores: ["401 Games", "Deck Out Gaming", "Skyfox Games"],
      checkedStores: {},
    });
  });

  it("defers an uncached printing until the shared rolling budget reopens", () => {
    const directory = mkdtempSync(join(tmpdir(), "binder-offer-rate-"));
    const limiter = join(directory, "austingarrod-binder-offers");
    try {
      const result = runPhp(`(static function ($target) {
        $now = time();
        $granted = [];
        for ($index = 0; $index < 24; $index++) {
          $granted[] = binder_offer_reserve($now);
        }
        return [
          'granted' => $granted,
          'lookup' => binder_offer_lookup(binder_offer_target('public', $target)),
          'lastSecond' => binder_offer_reserve($now + 59),
          'nextWindow' => binder_offer_reserve($now + 60),
        ];
      })($input)`, target, ["-d", `sys_temp_dir=${directory}`, "-d", "apc.enabled=0"]);
      expect(result.granted).toEqual(Array(24).fill(0));
      expect(result.lookup).toEqual({
        offers: [], unavailableStores: [], checkedStores: {}, retryAfter: expect.any(Number),
      });
      expect(result.lookup.retryAfter).toBeGreaterThan(0);
      expect(result.lookup.retryAfter).toBeLessThanOrEqual(60);
      expect(result.lastSecond).toBe(1);
      expect(result.nextWindow).toBe(0);
    } finally {
      removeLimiter(directory, limiter);
    }
  });

  it("adds token-tier credentials only to the retailer Catalog headers", () => {
    const anonymous = runPhp("binder_offer_headers(null)");
    expect(anonymous).not.toContainEqual(expect.stringMatching(/^(Authorization|Shopify-Buyer-IP):/));
    expect(runPhp("binder_offer_headers($input)", { token: "fixture-token", buyerIp: "8.8.8.8" })).toEqual([
      ...anonymous, "Authorization: Bearer fixture-token", "Shopify-Buyer-IP: 8.8.8.8",
    ]);
  });

  it("accepts only exact retailer names and reports only the requested stores", () => {
    const expression = "array_column(binder_offer_stores($input), 'name')";
    expect(runPhp(expression, "401 Games,Skyfox Games")).toEqual(["401 Games", "Skyfox Games"]);
    expect(runPhp(expression)).toEqual(["401 Games", "Deck Out Gaming", "Skyfox Games"]);
    for (const selection of ["", "https://example.org", "401 Games,401 Games", "401 Games,wrong", ["401 Games"]]) {
      expect(runPhp("binder_offer_stores($input)", selection)).toBeNull();
    }
    expect(runPhp("binder_offer_result([], stores: binder_offer_stores($input))", "Skyfox Games")).toEqual({
      offers: [], unavailableStores: ["Skyfox Games"], checkedStores: {},
    });
  });

  it("honors both Retry-After formats and persists cooldown for just the affected retailer", () => {
    const directory = mkdtempSync(join(tmpdir(), "binder-store-cooldown-"));
    const limiter = join(directory, "austingarrod-binder-offers");
    const args = ["-d", `sys_temp_dir=${directory}`, "-d", "apc.enabled=0"];
    try {
      const waits = runPhp(`(static function () {
        $host = BINDER_OFFER_STORES[0]['host'];
        $now = time();
        $duration = binder_offer_store_wait($host, $now, true, '150');
        return [
          $duration,
          binder_offer_store_wait($host, $now + 20, true, '1'),
          binder_offer_store_wait(BINDER_OFFER_STORES[1]['host'], $now),
          binder_offer_store_wait($host, $now + 150),
          binder_offer_retry_delay(gmdate(DATE_RFC7231, $now + 61), $now),
          binder_offer_retry_delay('unrecognized', $now),
        ];
      })()`, null, args);
      expect(waits).toEqual([150, 130, 0, 0, 61, null]);
      const cooled = runPhp("binder_offer_lookup(binder_offer_target('public', $input), stores: binder_offer_stores('401 Games'))", target, args);
      expect(cooled).toEqual({ offers: [], unavailableStores: [], checkedStores: {}, storeRetryAfter: { "401 Games": expect.any(Number) } });
      expect(cooled.storeRetryAfter["401 Games"]).toBeGreaterThan(60);
    } finally {
      removeLimiter(directory, limiter);
    }
  });

  it("keeps the other retailer's original quote while a store waits", () => {
    const [offer] = offers([store401]);
    const result = runPhp(`binder_offer_result(
      ['store.401games.ca' => ['expiresAt' => 1771000000 + BINDER_OFFER_TTL, 'offers' => [$input]]],
      stores: binder_offer_stores('401 Games,Skyfox Games'),
      waiting: ['skyfoxgames.com' => time() + 75]
    )`, offer);
    expect(result).toEqual({
      offers: [offer], unavailableStores: [], checkedStores: { "401 Games": offer.checkedAt },
      storeRetryAfter: { "Skyfox Games": expect.any(Number) },
    });
    expect(result.storeRetryAfter["Skyfox Games"]).toBeGreaterThan(60);
  });
});

function removeLimiter(directory: string, limiter: string) {
  if (existsSync(limiter)) {
    for (const file of readdirSync(limiter)) rmSync(join(limiter, file));
    rmdirSync(limiter);
  }
  rmdirSync(directory);
}
