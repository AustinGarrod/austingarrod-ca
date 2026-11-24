import type { SetCard, SetSummary } from "../lib/master";
import {
  cad, calendarDate, freshOffers, marketPrices, offerLifetime, pricingRequest, type PriceHistory,
  type PricingTarget, type RetailOffers,
} from "../lib/pricing";
import { escape } from "./binder-pages";
import { createPriceChart } from "./price-chart";

interface Options {
  collection(): { sets: readonly SetSummary[]; cards(setId: string): Promise<SetCard[]> };
  recentOffers(target: PricingTarget): RetailOffers | undefined;
  recordOffers(target: PricingTarget, offers: RetailOffers): void;
  onBuyingClose(): void;
}

type Presentation = "dialog" | "inline";

const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => node<HTMLSelectElement>(id);
const dialog = (id: string) => node<HTMLDialogElement>(id);
const button = (id: string) => node<HTMLButtonElement>(id);
const offerTime = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" });

export function createPricingUI(options: Options) {
  const prices = dialog("card-pricing-dialog");
  const inline = node("buy-card-pricing"), content = node("card-pricing-content");
  const title = node("card-pricing-title"), header = title.closest("header")!, back = button("card-pricing-back");
  const variant = select("card-pricing-variant"), range = select("card-market-range");
  const region = node("card-market-chart-region");
  const drawChart = createPriceChart(node<HTMLCanvasElement>("card-market-chart"),
    node<HTMLInputElement>("card-market-point"), node<HTMLOutputElement>("card-market-point-value"));
  const retailerList = node("card-retail-offers"), retailerStatus = node("card-retail-status");
  const refreshOffers = button("card-retail-refresh");
  let target: PricingTarget | undefined, candidates: SetCard["variants"] = [];
  let cardVersion = 0, historyVersion = 0, retailVersion = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offerRequest: AbortController | undefined, historyRequest: AbortController | undefined;
  let presentation: Presentation | undefined;
  const exact = () => target && !["", "*"].includes(target.variant);
  const active = (version: number) => version === cardVersion &&
    (presentation === "inline" ? !inline.hidden : presentation === "dialog" && prices.open);
  const query = () => ({ set: target!.setId, number: target!.number, variant: target!.variant });

  function cancelOffers() {
    retailVersion++;
    offerRequest?.abort();
    clearTimeout(timer);
  }

  function endPrinting() {
    presentation = undefined;
    cardVersion++;
    historyRequest?.abort();
    cancelOffers();
    target = undefined;
    candidates = [];
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
    historyRequest?.abort();
    const controller = new AbortController();
    historyRequest = controller;
    const version = cardVersion, ticket = ++historyVersion;
    const current = () => active(version) && ticket === historyVersion;
    const status = node("card-market-history-status");
    region.hidden = true;
    drawChart([]);
    status.textContent = "Loading price history…";
    try {
      const history = await pricingRequest<PriceHistory>("market", { ...query(), days: range.value },
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
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
    } finally {
      if (historyRequest === controller) historyRequest = undefined;
    }
  }

  async function loadOffers(refresh = false) {
    cancelOffers();
    const version = cardVersion, ticket = retailVersion, controller = new AbortController();
    offerRequest = controller;
    const current = () => active(version) && ticket === retailVersion;
    retailerList.replaceChildren();
    retailerStatus.textContent = "Checking Canadian stores…";
    refreshOffers.disabled = true;
    try {
      const printing = target!;
      const previous = refresh ? undefined : options.recentOffers(printing);
      const data = previous ?? await pricingRequest<RetailOffers>("offers", query(), AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
      if (current() && !previous) options.recordOffers(printing, data);
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
    historyRequest?.abort();
    cancelOffers();
    node("card-pricing-finish").textContent = target?.finish ?? "";
    node("card-pricing-exact").hidden = !exact();
    if (!exact()) return;
    node("card-pricing-status").textContent = "";
    void loadMarket(version);
    void loadHistory();
    void loadOffers();
  }

  function presentPrinting(printing: PricingTarget, where: Presentation) {
    const buying = where === "inline";
    presentation = where;
    if (buying && prices.open) prices.close();
    const container = buying ? inline : prices;
    if (content.parentElement !== container) container.append(content);
    inline.hidden = !buying;
    header.classList.toggle("dex-dialog-header", !buying);
    button("card-pricing-close").hidden = buying;
    back.hidden = !buying;
    node("card-pricing-actions").hidden = buying;
    target = printing;
    candidates = [];
    title.textContent = printing.name;
    node("card-pricing-identity").textContent = `${printing.setName} · #${printing.number}`;
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
    if (buying) {
      title.focus({ preventScroll: true });
      inline.scrollIntoView({ block: "start" });
    } else if (!prices.open) prices.showModal();
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

  function closeBuyingPrinting() {
    if (presentation !== "inline") return;
    endPrinting();
    inline.hidden = true;
    prices.append(content);
  }

  node("card-pricing-image").addEventListener("error", () => { node("card-pricing-image").hidden = true; });
  variant.addEventListener("change", () => {
    const next = candidates.find(item => item.id === variant.value);
    if (!next || !target) return;
    target = { ...target, variant: next.id, finish: next.label };
    showPrinting();
  });
  range.addEventListener("change", () => { if (exact()) void loadHistory(); });
  refreshOffers.addEventListener("click", () => { if (exact()) void loadOffers(true); });
  prices.addEventListener("close", () => {
    if (!prices.open && presentation === "dialog") endPrinting();
  });
  back.addEventListener("click", () => {
    if (presentation !== "inline") return;
    closeBuyingPrinting();
    options.onBuyingClose();
  });

  return {
    openPrinting: (printing: PricingTarget) => presentPrinting(printing, "dialog"),
    openBuyingPrinting: (printing: PricingTarget) => presentPrinting(printing, "inline"),
    closeBuyingPrinting,
    scopeChanged() {
      if (presentation === "inline") closeBuyingPrinting();
      else endPrinting();
      prices.close();
    },
  };
}
