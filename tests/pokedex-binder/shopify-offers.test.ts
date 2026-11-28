import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import retailers from "../../public/utilities/pokemon-binder/retailers.json";

const storeNames = Object.keys(retailers);
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

const secondTarget = { ...target, number: "025" };
const secondPrint = {
  ...store401,
  title: "Pikachu - 025/165 - Common - Reverse Holo",
  url: "https://store.401games.ca/products/pikachu-025-165",
  variants: [{ ...printing, id: "gid://shopify/ProductVariant/34567", availability: { available: false } }],
};
const offeredPrint = {
  ...store401,
  variants: [printing, {
    ...printing,
    id: "gid://shopify/ProductVariant/23456",
    title: "Lightly Played",
    availability: { available: false },
    options: [{ name: "Condition", label: "Lightly Played" }],
  }],
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

  it("matches the numbered 30th Celebration printing when the retailer omits the anniversary stamp", () => {
    const card = { set: "30th", number: "027", variant: "holo+stamp=30th-anniversary" };
    const swirl = {
      title: "Pikachu (027/128) [ME: 30th Celebration]",
      url: "https://swirlyeg.com/products/pikachu-027-128-me-30th-celebration",
      variants: [{
        ...printing,
        title: "Foil / Near Mint",
        options: [{ name: "Foiling", label: "Foil" }, { name: "Grading", label: "Near Mint" }],
      }],
    };
    const store = storeNames.indexOf("Swirl Café & Games");
    expect(offers([swirl], store, card)).toEqual([expect.objectContaining({
      store: "Swirl Café & Games",
      condition: "Near Mint",
      url: swirl.url + "?variant=12345",
    })]);
    const dungeon = {
      ...swirl,
      title: "Pikachu (037/128) [Mega Evolution: 30th Celebration]",
      url: "https://www.dungeoncomicsandcards.ca/products/pikachu-037-128-mega-evolution-30th-celebration",
      variants: [{ ...printing, title: "Near Mint Holofoil", options: [] }],
    };
    expect(offers([dungeon], storeNames.indexOf("Dungeon Comics & Cards"), { ...card, number: "037" }))
      .toEqual([expect.objectContaining({ store: "Dungeon Comics & Cards" })]);
    const danireon = {
      ...dungeon,
      title: "Pikachu ex - 053/128 - ME: 30th Celebration - Holofoil",
      url: "https://www.danireon.com/products/pikachu-ex-053-128-53-me-30th-celebration-holofoil",
    };
    expect(offers([danireon], storeNames.indexOf("Danireon"), { ...card, number: "053" }))
      .toEqual([expect.objectContaining({ store: "Danireon" })]);
    const wrongTitles = [
      "Pikachu (028/128) [30th Celebration]",
      "Pikachu (027/165) [30th Celebration]",
      "Pikachu (027/128) [30th Celebration Classic Collection]",
      "Pikachu (027/128) [30th Celebration] Classic Collection",
      "Pikachu (027/128) ME 30th Celebration Classic Collection",
      "Pikachu (027/128) [30th Celebration] Unstamped",
      "Pikachu (027/128) [30th Celebration] Non 30th Anniversary Stamped",
      "Pikachu (027/128) [30th Celebration] Without a 30th Anniversary Stamp",
      "Pikachu (027/128) [30th Celebration] Not 30th Anniversary Stamped",
      "Pikachu (027/128) [30th Celebration Promo] Holofoil",
      "Pikachu (027/128) ME 30th Celebration Promo Holofoil",
      "Pikachu (027/128) [30th Celebration] Staff",
      "Pikachu (027/128) [30th Celebration] Japanese",
      "Pikachu ex (027/128) [30th Celebration]",
    ];
    expect(offers(wrongTitles.map(title => ({ ...swirl, title, collections: [{ title: "30th Celebration" }] })), store, card)).toEqual([]);
    expect(offers([{
      ...swirl, title: "Pikachu (027/128)", collections: [{ title: "30th Celebration" }],
    }], store, card)).toEqual([]);
    expect(offers([{ ...swirl, variants: [{ ...swirl.variants[0], title: "Unstamped Foil / Near Mint" }] }], store, card)).toEqual([]);
    const explicitStamp = (label: string) => ({ ...swirl, variants: [{
      ...swirl.variants[0], options: [...swirl.variants[0].options, { name: "Stamp", label }],
    }] });
    expect(offers([explicitStamp("30th Anniversary")], store, card)).toHaveLength(1);
    expect(offers([explicitStamp("Unstamped"), explicitStamp("None")], store, card)).toEqual([]);
    expect(offers([{ ...swirl, variants: [{ ...swirl.variants[0], title: "Foil / Near Mint / Heavily Played" }] }], store, card)).toEqual([]);
    expect(offers([{ ...swirl, variants: [{ ...printing, title: "Non Foil / Near Mint", options: [] }] }], store, card)).toEqual([]);
    const egg = { ...card, number: "001", variant: "normal+stamp=30th-anniversary" };
    const eggListing = { ...swirl, title: "Exeggcute (001/128) [30th Celebration]" };
    expect(offers([{ ...eggListing, variants: [{ ...printing, title: "Non Foil / Near Mint", options: [] }] }], store, egg)).toHaveLength(1);
    expect(offers([{ ...eggListing, variants: [{ ...printing, title: "Foil / Non Foil / Near Mint", options: [] }] }], store, egg)).toEqual([]);
    expect(runPhp("binder_offer_target('public', $input)", { ...card, variant: "holo" })).toBeNull();
    expect(runPhp("binder_offer_query(binder_offer_target('public', $input))", card)).toBe("Pikachu 027/128 30th Celebration");
  });

  it("quotes the Canadian market listing from an eligible US store", () => {
    const weavile = { set: "dp1", number: "40", variant: "reverse" };
    const pokemonPlug = {
      title: "Weavile (40/130) [Diamond & Pearl: Base Set]",
      url: "https://pokemonplug.com/products/weavile-40-130-diamond-pearl-base-set-2",
      variants: [{ ...printing, title: "Heavily Played Reverse Holofoil", options: [] }],
    };
    const store = storeNames.indexOf("Pokemon Plug");
    expect(offers([pokemonPlug], store, weavile)).toEqual([expect.objectContaining({
      store: "Pokemon Plug", currency: "CAD", condition: "Heavily Played", url: pokemonPlug.url + "?variant=12345",
    })]);
    expect(offers([{
      ...pokemonPlug, variants: [{ ...pokemonPlug.variants[0], price: { amount: 300, currency: "USD" } }],
    }], store, weavile)).toEqual([]);
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
      unavailableStores: storeNames.slice(2),
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
      unavailableStores: storeNames,
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
    expect(runPhp(expression)).toEqual(storeNames);
    expect(runPhp(expression, storeNames.join(","))).toEqual(storeNames);
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

  it("backs off once per retailer cooldown and honors a longer explicit wait", () => {
    const directory = mkdtempSync(join(tmpdir(), "binder-store-cooldown-"));
    const limiter = join(directory, "austingarrod-binder-offers");
    try {
      const [initial, duplicate, extended, remaining, next] = runPhp(`(static function () {
        $host = BINDER_OFFER_STORES[0]['host'];
        $now = time();
        return [
          binder_offer_store_wait($host, $now, true),
          binder_offer_store_wait($host, $now, true),
          binder_offer_store_wait($host, $now + 2, true, '25'),
          binder_offer_store_wait($host, $now + 23, true),
          binder_offer_store_wait($host, $now + 27, true),
        ];
      })()`, null, ["-d", `sys_temp_dir=${directory}`]);
      expect(initial).toBeGreaterThanOrEqual(10);
      expect(initial).toBeLessThanOrEqual(13);
      expect(duplicate).toBe(initial);
      expect(extended).toBe(25);
      expect(remaining).toBe(4);
      expect(next).toBeGreaterThanOrEqual(20);
      expect(next).toBeLessThanOrEqual(23);
    } finally {
      removeLimiter(directory, limiter);
    }
  });

  it("validates a bounded batch of distinct printings and an exact retailer list", () => {
    const parse = "binder_offer_batch_targets('public', $input)";
    const selected = { ...target, stores: ["Skyfox Games"] };
    expect(runPhp(parse, { targets: [selected, secondTarget] })).toMatchObject([
      { target: { card: { number: "135" } }, stores: [{ name: "Skyfox Games" }] },
      { target: { card: { number: "025" } }, stores: storeNames.map(name => ({ name })) },
    ]);
    for (const input of [[], [target, target], Array(11).fill(target), [{ ...target, stores: [] }],
      [{ ...target, stores: ["401 Games,Deck Out Gaming"] }], [{ ...target, stores: ["401 Games", "401 Games"] }]]) {
      expect(runPhp(parse, { targets: input })).toBeNull();
    }
  });

  it("batches expired observations and avoids transport and auth for fresh hits, including empty results", () => {
    const { cold, cached, refreshed, requests, authCalls } = offerBatchScenario("complete");
    expect(cached).toEqual(cold);
    expect(authCalls).toBe(2);
    expect(cold[1]).toMatchObject({ offers: [], checkedStores: { "401 Games": expect.any(String) } });
    expect(refreshed[0]).toMatchObject({ offers: [
      { priceCents: 850, condition: "Near Mint" },
      { priceCents: 850, condition: "Lightly Played" },
    ] });
    expect(refreshed[1]).toMatchObject({ offers: [{ priceCents: 850, condition: "Near Mint" }] });
    expect(requests.map(([name]: [string, string[]]) => name)).toEqual(["search_catalog", "search_catalog", "lookup_catalog"]);
    expect(requests[2][1]).toEqual(["gid://shopify/ProductVariant/12345", "gid://shopify/ProductVariant/23456", "gid://shopify/ProductVariant/34567"]);
  });

  it("searches only the affected printing after a partial lookup misses a known condition", () => {
    const { refreshed, requests } = offerBatchScenario("partial");
    expect(refreshed[0]).toMatchObject({ offers: [{ priceCents: 300, condition: "Near Mint" }] });
    expect(refreshed[1]).toMatchObject({ offers: [{ priceCents: 850, condition: "Near Mint" }] });
    expect(requests.slice(2)).toEqual([
      ["lookup_catalog", expect.any(Array)],
      ["search_catalog", "Jolteon 135/165 Scarlet & Violet 151 Reverse holo"],
    ]);
  });

  it("honors a rate-limited lookup without sending fallback searches", () => {
    const { refreshed, requests } = offerBatchScenario("throttled");
    expect(refreshed).toEqual(Array(2).fill({
      offers: [], checkedStores: {}, unavailableStores: [], storeRetryAfter: { "401 Games": expect.any(Number) },
    }));
    expect(requests.slice(2)).toEqual([["lookup_catalog", expect.any(Array)]]);
  });

  it("sends lookups in CAD and accepts the Shopify lookup envelope with omitted or partial status", () => {
    const ids = [printing.id];
    expect(runPhp("json_decode(binder_offer_payload($input, BINDER_OFFER_PROFILE), true)", ids)).toMatchObject({
      params: { name: "lookup_catalog", arguments: { catalog: { ids, context: { address_country: "CA", currency: "CAD" } } } },
    });
    expect(runPhp("binder_offer_headers(null, 'lookup_catalog')")).toContain("Mcp-Name: lookup_catalog");
    for (const status of [undefined, "partial"]) {
      const fixture = JSON.stringify({ result: { structuredContent: { ucp: { version: "2026-08-25", status }, products: [store401] } } });
      expect(runPhp("binder_offer_products($input, 'lookup_catalog')", fixture)).toEqual([store401]);
    }
  });
});

function offerBatchScenario(mode: "complete" | "partial" | "throttled") {
  const directory = mkdtempSync(join(tmpdir(), "binder-offer-batch-"));
  const limiter = join(directory, "austingarrod-binder-offers");
  try {
    return runPhp(`(static function ($input) {
      $items = binder_offer_batch_targets('public', $input);
      $host = BINDER_OFFER_STORES[0]['host'];
      $requests = [];
      $authCalls = 0;
      $authenticate = static function () use (&$authCalls): array {
        $authCalls++;
        return ['token' => 'fixture', 'buyerIp' => '8.8.8.8'];
      };
      $fetch = static function (array $queries, string $tool) use ($input, $host, &$requests): array {
        $query = $queries[$host];
        $requests[] = [$tool, $query];
        if ($tool === 'search_catalog') {
          $product = str_starts_with($query, 'Jolteon ') ? $input['products'][0] : $input['products'][1];
          return [$host => ['status' => 200, 'products' => [$product]]];
        }
        if ($input['mode'] === 'throttled') {
          return [$host => ['status' => 429, 'retryAt' => time() + 180]];
        }
        $products = $input['products'];
        if ($input['mode'] === 'partial') {
          array_pop($products[0]['variants']);
        }
        foreach ($products as &$product) {
          // Lookup can omit the listing URL. Reuse the validated search URL only for the exact correlated ID.
          unset($product['url']);
          foreach ($product['variants'] as &$variant) {
            $variant['inputs'] = [['id' => $variant['id'], 'match' => 'exact']];
            $variant['availability']['available'] = true;
            $variant['price']['amount'] = 850;
          }
          unset($variant);
        }
        unset($product);
        return [$host => ['status' => 200, 'products' => array_reverse($products)]];
      };
      $cold = binder_offer_lookups($items, fetch: $fetch, authenticate: $authenticate);
      $cached = binder_offer_lookups($items, fetch: $fetch, authenticate: $authenticate);
      foreach ($items as $item) {
        $key = binder_offer_cache_key(binder_offer_printing_key($item['target']), $host);
        $slot = binder_offer_cache_file($key, 'c+');
        ftruncate($slot, 0);
        fclose($slot);
      }
      $refreshed = binder_offer_lookups($items, fetch: $fetch, authenticate: $authenticate);
      return compact('cold', 'cached', 'refreshed', 'requests', 'authCalls');
    })($input)`, {
      targets: [target, secondTarget].map(item => ({ ...item, stores: ["401 Games"] })),
      products: [offeredPrint, secondPrint],
      mode,
    }, ["-d", `sys_temp_dir=${directory}`, "-d", "apc.enabled=0"]);
  } finally {
    removeLimiter(directory, limiter);
  }
}

function removeLimiter(directory: string, limiter: string) {
  if (existsSync(limiter)) {
    for (const file of readdirSync(limiter)) rmSync(join(limiter, file));
    rmdirSync(limiter);
  }
  rmdirSync(directory);
}
