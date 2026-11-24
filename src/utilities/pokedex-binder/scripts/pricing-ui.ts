import type { MasterState, SetCard, SetSummary } from "../lib/master";
import {
  cad, calendarDate, freshOffers, groupBuyingEntries, marketPrices, matchesBuyingEntry,
  missingPrintings, offerLifetime, pricingRequest, type BuyingEntry, type PriceHistory,
  type PricingTarget, type RetailOffers,
} from "../lib/pricing";
import { escape } from "./binder-pages";
import { createPriceChart } from "./price-chart";

interface Options {
  collection(): { sets: readonly SetSummary[]; cards(setId: string): Promise<SetCard[]> };
  binders(): Promise<MasterState>;
  selected(): string;
}

const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => node<HTMLSelectElement>(id);
const dialog = (id: string) => node<HTMLDialogElement>(id);
const button = (id: string) => node<HTMLButtonElement>(id);
const choiceCount = 24;
const offerTime = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" });

export function createPricingUI(options: Options) {
  const prices = dialog("card-pricing-dialog"), buy = dialog("buy-cards-dialog");
  const variant = select("card-pricing-variant"), range = select("card-market-range");
  const region = node("card-market-chart-region");
  const drawChart = createPriceChart(node<HTMLCanvasElement>("card-market-chart"),
    node<HTMLInputElement>("card-market-point"), node<HTMLOutputElement>("card-market-point-value"));
  const retailerList = node("card-retail-offers"), retailerStatus = node("card-retail-status");
  const refreshOffers = button("card-retail-refresh");
  let target: PricingTarget | undefined, candidates: SetCard["variants"] = [];
  let cardVersion = 0, historyVersion = 0, retailVersion = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, offerRequest: AbortController | undefined;
  let returnToBuy = false;
  const exact = () => target && !["", "*"].includes(target.variant);
  const active = (version: number) => version === cardVersion && prices.open;
  const query = () => ({ set: target!.setId, number: target!.number, variant: target!.variant });

  function cancelOffers() {
    retailVersion++;
    offerRequest?.abort();
    clearTimeout(timer);
  }

  async function loadMarket(version: number) {
    const current = node("card-market-current"), date = node("card-market-date");
    current.textContent = "Loading market estimate…";
    date.textContent = "";
    try {
      const { set, number, variant } = query();
      const market = await marketPrices(set);
      if (!active(version)) return;
      const price = market.prices.find(item => item.number === number && item.variant === variant);
      current.textContent = price ? cad(price.cents) + " CAD" : "No market estimate for this printing.";
      if (price && Number.isFinite(Date.parse(price.observedAt))) {
        date.textContent = "European market · Converted to CAD · " + calendarDate(price.observedAt);
      }
    } catch {
      if (active(version)) current.textContent = "Market prices are temporarily unavailable.";
    }
  }

  async function loadHistory() {
    const version = cardVersion, ticket = ++historyVersion;
    const current = () => active(version) && ticket === historyVersion;
    const status = node("card-market-history-status");
    region.hidden = true;
    drawChart([]);
    status.textContent = "Loading price history…";
    try {
      const history = await pricingRequest<PriceHistory>("market", { ...query(), days: range.value }, AbortSignal.timeout(10_000));
      if (!current()) return;
      const points = history.points.filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date)
        && Number.isFinite(Date.parse(point.date)) && Number.isSafeInteger(point.cents) && point.cents > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (points.length < 2) {
        status.textContent = points.length
          ? `${cad(points[0].cents)} CAD on ${calendarDate(points[0].date)}. The chart appears after the next observation.`
          : "No recorded prices in this date range.";
        return;
      }
      status.textContent = `${points.length} prices recorded`;
      region.hidden = false;
      drawChart(points);
    } catch {
      if (current()) status.textContent = "Price history is temporarily unavailable.";
    }
  }

  async function loadOffers() {
    cancelOffers();
    const version = cardVersion, ticket = retailVersion, controller = new AbortController();
    offerRequest = controller;
    const current = () => active(version) && ticket === retailVersion;
    retailerList.replaceChildren();
    retailerStatus.textContent = "Checking Canadian stores…";
    refreshOffers.disabled = true;
    try {
      const data = await pricingRequest<RetailOffers>("offers", query(), AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
      function show() {
        if (!current()) return;
        const now = Date.now(), offers = freshOffers(data.offers, now).filter(offer => {
          try { return new URL(offer.url).protocol === "https:"; } catch { return false; }
        });
        retailerList.innerHTML = offers.map(offer =>
          `<li><div><strong>${escape(offer.store)}</strong><span>${escape(offer.condition)} · Available online</span>
          <small>Checked ${escape(offerTime.format(new Date(offer.checkedAt)))}</small></div>
          <div><strong>${cad(offer.priceCents)} CAD</strong><a href="${escape(offer.url)}" target="_blank" rel="noopener noreferrer"
            aria-label="Open ${escape(offer.store)} listing (opens in new tab)">View listing</a></div></li>`).join("");
        const messages = [];
        if (!offers.length) messages.push(data.offers.length ? "The previous offers expired. Refresh to check again."
          : data.unavailableStores.length >= 3 ? "Canadian stores are temporarily unavailable."
          : "No exact in-stock offers found.");
        if (data.unavailableStores.length && data.unavailableStores.length < 3) {
          messages.push(`Couldn’t check ${data.unavailableStores.join(", ")}.`);
        }
        retailerStatus.textContent = messages.join(" ");
        const next = Math.min(...offers.map(offer => Date.parse(offer.checkedAt) + offerLifetime));
        if (Number.isFinite(next)) timer = setTimeout(show, Math.max(20, next - now));
      }
      show();
    } catch {
      if (current()) retailerStatus.textContent = "Canadian offers are temporarily unavailable. Try refreshing.";
    } finally {
      if (current()) refreshOffers.disabled = false;
    }
  }

  function showPrinting() {
    const version = ++cardVersion;
    cancelOffers();
    node("card-pricing-finish").textContent = target?.finish ?? "";
    node("card-pricing-exact").hidden = !exact();
    if (!exact()) return;
    node("card-pricing-status").textContent = "";
    void loadMarket(version);
    void loadHistory();
    void loadOffers();
  }

  function openPrinting(printing: PricingTarget, fromBuy = false) {
    target = printing;
    candidates = [];
    returnToBuy = fromBuy;
    node("card-pricing-title").textContent = printing.name;
    node("card-pricing-identity").textContent = `${printing.setName} · #${printing.number}`;
    button("card-pricing-back").hidden = !fromBuy;
    node("card-pricing-variants").hidden = true;
    const image = node<HTMLImageElement>("card-pricing-image");
    const catalog = options.collection();
    const set = catalog.sets.find(item => item.id === printing.setId);
    const art = set?.artwork;
    const fallback = art && !art.missing.includes(printing.number)
      ? "https://assets.tcgdex.net/en/" + [art.series, printing.setId, printing.number].map(encodeURIComponent).join("/") + "/low.webp" : "";
    const artwork = printing.image?.startsWith("https://assets.tcgdex.net/") ? printing.image : fallback;
    image.hidden = !artwork;
    if (artwork) { image.alt = printing.name + " card artwork"; image.src = artwork; }
    else image.removeAttribute("src");
    range.value = "30";
    node("card-pricing-status").textContent = exact() ? "" : "Loading printings…";
    if (fromBuy && buy.open) buy.close();
    if (!prices.open) prices.showModal();
    showPrinting();
    const version = cardVersion;
    if (!set) {
      node("card-pricing-status").textContent = "This card has no exact printing in the price catalog.";
      return;
    }
    void catalog.cards(printing.setId).then(cards => {
      if (!active(version)) return;
      candidates = cards.find(card => card.number === printing.number)?.variants ?? [];
      if (!candidates.length) {
        if (!exact()) node("card-pricing-status").textContent = "This card has no exact printing in the price catalog.";
        return;
      }
      if (!exact() && candidates.length === 1) {
        const only = candidates[0];
        target = { ...printing, variant: only.id, finish: only.label };
        showPrinting();
        return;
      }
      if (!exact() || candidates.length > 1) {
        variant.replaceChildren(new Option("Choose a finish", ""), ...candidates.map(item => new Option(item.label, item.id)));
        variant.value = exact() ? printing.variant : "";
        variant.options[0].disabled = true;
        node("card-pricing-variants").hidden = false;
        if (!exact()) node("card-pricing-status").textContent = "Choose a finish to see exact prices.";
      }
    }).catch(() => {
      if (active(version) && !exact()) node("card-pricing-status").textContent = "Printings could not load. Try opening the card again.";
    });
  }

  node("card-pricing-image").addEventListener("error", () => { node("card-pricing-image").hidden = true; });
  variant.addEventListener("change", () => {
    const next = candidates.find(item => item.id === variant.value);
    if (!next || !target) return;
    target = { ...target, variant: next.id, finish: next.label };
    showPrinting();
  });
  range.addEventListener("change", () => { if (exact()) void loadHistory(); });
  refreshOffers.addEventListener("click", () => { if (exact()) void loadOffers(); });
  prices.addEventListener("close", () => {
    if (!prices.open) { cardVersion++; cancelOffers(); }
  });

  const scopeSelect = select("buy-cards-scope"), filter = node<HTMLInputElement>("buy-cards-filter");
  const more = button("buy-cards-more"), buyStatus = node("buy-cards-status"), list = node("buy-cards-list");
  let entries: BuyingEntry[] = [], matching: BuyingEntry[] = [], limit = choiceCount, buyVersion = 0;
  let checklistErrors = 0, loading = false;
  function drawBuy() {
    matching = entries.filter(row => matchesBuyingEntry(row, filter.value));
    more.hidden = matching.length <= limit;
    const cards = matching.reduce((count, row) => count + row.copies, 0);
    const summary = cards ? `${cards.toLocaleString()} ${cards === 1 ? "card" : "cards"} still to find`
      : entries.length ? "No missing cards match this search." : "No catalog cards still to find.";
    buyStatus.textContent = summary + (checklistErrors ? " Some set checklists couldn’t load." : "");
    list.innerHTML = matching.slice(0, limit).map(({ target, copies }, index) =>
      `<li><div><strong>${escape(target.name)}</strong><span>${escape(target.setName)} · #${escape(target.number)} · ${escape(target.finish)}${copies > 1 ? " · " + copies + " needed" : ""}</span></div>
      <button type="button" data-buy-card="${index}" aria-label="Compare offers for ${escape(target.name)} #${escape(target.number)} ${escape(target.finish)}">Compare offers</button></li>`).join("");
  }
  async function loadBuy(preferred: string) {
    const ticket = ++buyVersion;
    const current = () => buy.open && ticket === buyVersion;
    entries = [];
    matching = [];
    list.replaceChildren();
    more.hidden = true;
    scopeSelect.disabled = filter.disabled = true;
    loading = true;
    buyStatus.textContent = "Checking which cards are missing…";
    try {
      const state = await options.binders();
      if (!current()) return;
      scopeSelect.replaceChildren(new Option("All set binders", ""), ...state.binders.map(binder => new Option(binder.name, binder.id)));
      scopeSelect.value = state.binders.some(binder => binder.id === preferred) ? preferred : "";
      const selected = state.binders.filter(binder => !scopeSelect.value || binder.id === scopeSelect.value);
      const catalog = options.collection();
      const results = await Promise.allSettled(selected.map(async binder => {
        const set = catalog.sets.find(item => item.id === binder.setId);
        if (!set) throw new Error("Set catalog unavailable.");
        return missingPrintings(binder, set, await catalog.cards(binder.setId));
      }));
      if (!current()) return;
      checklistErrors = results.filter(result => result.status === "rejected").length;
      entries = groupBuyingEntries(results.flatMap(result => result.status === "fulfilled" ? result.value : []));
      drawBuy();
    } catch {
      if (current()) buyStatus.textContent = "The binders could not load. Close this view and try again.";
    } finally {
      if (current()) { scopeSelect.disabled = filter.disabled = false; loading = false; }
    }
  }

  button("buy-cards-open").addEventListener("click", () => {
    filter.value = "";
    limit = choiceCount;
    buy.showModal();
    void loadBuy(options.selected());
  });
  button("card-pricing-back").addEventListener("click", () => {
    if (!returnToBuy) return;
    prices.close();
    buy.showModal();
    void loadBuy(scopeSelect.value);
  });
  buy.addEventListener("close", () => { if (!buy.open) { buyVersion++; loading = false; } });
  scopeSelect.addEventListener("change", () => { limit = choiceCount; void loadBuy(scopeSelect.value); });
  filter.addEventListener("input", () => { limit = choiceCount; if (!loading) drawBuy(); });
  more.addEventListener("click", () => { limit += choiceCount; drawBuy(); });
  list.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-buy-card]");
    if (!button) return;
    const row = matching[Number(button.dataset.buyCard)];
    if (row) openPrinting(row.target, true);
  });

  return {
    openPrinting,
    bindersChanged() { if (buy.open) void loadBuy(scopeSelect.value); },
    scopeChanged() {
      buyVersion++;
      cardVersion++;
      cancelOffers();
      returnToBuy = false;
      buy.close();
      prices.close();
      entries = matching = [];
      list.replaceChildren();
      scopeSelect.replaceChildren();
    },
  };
}
