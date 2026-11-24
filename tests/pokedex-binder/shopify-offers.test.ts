import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const php = process.env.PHP_BINARY || "php";
const phpVersion = spawnSync(php, ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8" });

function runPhp(expression: string, input?: unknown) {
  const code = [
    "require 'public/utilities/pokemon-binder/api/_offers.php';",
    "set_error_handler(static function($severity, $message) { throw new ErrorException($message, 0, $severity); });",
    "$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);",
    `echo json_encode(${expression}, JSON_THROW_ON_ERROR);`,
  ].join("\n");
  return JSON.parse(execFileSync(php, ["-r", code], { input: JSON.stringify(input ?? null), encoding: "utf8" }));
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
});
