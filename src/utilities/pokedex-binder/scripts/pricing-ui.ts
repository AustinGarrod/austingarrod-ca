import type { SetCard, SetSummary } from "../lib/master";
import { buyingStores, isCrossBorder, matchesByStore } from "../lib/buying-offers";
import { catalogArtwork } from "../lib/catalog-search";
import {
  cad, calendarDate, freshOffers, marketPrices, offerLifetime, pricingRequest, type PriceHistory,
  type PricingTarget, type RetailOffers,
} from "../lib/pricing";
import { escape } from "./binder-pages";
import { createPriceChart } from "./price-chart";

interface Options {
  collection(): { sets: readonly SetSummary[]; cards(setId: string): Promise<SetCard[]> };
  readOffers(target: PricingTarget): Promise<RetailOffers | undefined>;
  checkOffers(target: PricingTarget, options?: { force?: boolean }): Promise<RetailOffers>;
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
  const historyPanel = node<HTMLDetailsElement>("card-market-history");
  const region = node("card-market-chart-region");
  const drawChart = createPriceChart(node<HTMLCanvasElement>("card-market-chart"),
    node<HTMLInputElement>("card-market-point"), node<HTMLOutputElement>("card-market-point-value"));
  const retailerList = node("card-retail-offers"), retailerStatus = node("card-retail-status");
  const refreshOffers = button("card-retail-refresh");
  let target: PricingTarget | undefined, candidates: SetCard["variants"] = [];
  let cardVersion = 0, historyVersion = 0, retailVersion = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let historyRequest: AbortController | undefined;
  let presentation: Presentation | undefined;
  const exact = () => target && !["", "*"].includes(target.variant);
  const active = (version: number) => version === cardVersion &&
    (presentation === "inline" ? !inline.hidden : presentation === "dialog" && prices.open);
  const query = () => ({ set: target!.setId, number: target!.number, variant: target!.variant });

  function cancelOffers() {
    retailVersion++;
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
    const current = node("card-market-current"), source = node("card-market-source");
    const date = node<HTMLTimeElement>("card-market-date");
    current.textContent = "Loading market estimate…";
    current.classList.remove("has-amount");
    source.hidden = true;
    try {
      const { set, number, variant } = query();
      const market = await marketPrices(set);
      if (!active(version)) return;
      const price = market.prices.find(item => item.number === number && item.variant === variant);
      current.textContent = price ? cad(price.cents) + " CAD" : "No market estimate for this printing.";
      current.classList.toggle("has-amount", !!price);
      if (price && Number.isFinite(Date.parse(price.observedAt))) {
        date.dateTime = price.observedAt;
        date.textContent = calendarDate(price.observedAt);
        source.hidden = false;
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
    const current = () => active(version) && historyPanel.open && ticket === historyVersion;
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
    const version = cardVersion, ticket = retailVersion;
    const current = () => active(version) && ticket === retailVersion;
    if (!refresh) retailerList.replaceChildren();
    retailerStatus.textContent = "Checking stores…";
    refreshOffers.disabled = true;
    try {
      const printing = target!;
      function show(data: RetailOffers, checking: boolean) {
        if (!current()) return;
        clearTimeout(timer);
        const now = Date.now(), offers = freshOffers(data.offers, now, data.expiresAt).filter(offer => {
          try { return new URL(offer.url).protocol === "https:"; } catch { return false; }
        });
        retailerList.innerHTML = offers.map(offer =>
          `<li><div><strong>${escape(offer.store)}</strong><span>${escape(offer.condition)} · In stock${isCrossBorder(offer.store) ? " · Cross-border" : ""}</span>
          <small>Checked ${escape(offerTime.format(new Date(offer.checkedAt)))}</small></div>
          <div><strong>${cad(offer.priceCents)} CAD</strong><a href="${escape(offer.url)}" target="_blank" rel="noopener noreferrer"
            aria-label="Open ${escape(offer.store)} listing (opens in new tab)">View listing</a></div></li>`).join("");
        const messages = [];
        if (checking) messages.push("Checking stores…");
        if (data.retryAfter) messages.push(`Store checks are busy. Try again in about ${data.retryAfter} seconds.`);
        const waitingStores = Object.keys(data.storeRetryAfter ?? {});
        if (waitingStores.length) messages.push(`Waiting to check ${waitingStores.join(", ")}. Refresh offers to retry.`);
        const allUnavailable = buyingStores.every(store => data.unavailableStores.includes(store));
        const checked = matchesByStore(data, buyingStores, now, Infinity, Infinity)
          .filter(store => store.checkedAt || store.offer).length;
        if (checked) messages.push(`${checked} of ${buyingStores.length} stores checked.`);
        if (!checking && !offers.length && !data.retryAfter && !waitingStores.length) messages.push(data.offers.length ? "The previous offers expired. Refresh to check again."
          : allUnavailable ? "Stores are temporarily unavailable."
          : checked < buyingStores.length ? "No exact in-stock offers so far." : "No exact in-stock offers found.");
        if (data.unavailableStores.length && !allUnavailable) {
          messages.push(`Couldn’t check ${data.unavailableStores.join(", ")}.`);
        }
        retailerStatus.textContent = messages.join(" ");
        const expirations = [...offers.map(offer => Date.parse(offer.checkedAt) + offerLifetime),
          ...Object.values(data.expiresAt ?? {}).map(Date.parse)].filter(at => at > now);
        const next = Math.min(...expirations);
        if (Number.isFinite(next)) timer = setTimeout(() => show(data, checking), Math.max(20, next - now));
      }
      const previous = await options.readOffers(printing);
      if (!current()) return;
      const needsCheck = refresh || !Object.keys(previous?.checkedStores ?? {}).length;
      if (previous) show(previous, needsCheck);
      if (needsCheck) show(await options.checkOffers(printing, { force: refresh }), false);
    } catch {
      if (current()) retailerStatus.textContent = "Store offers are temporarily unavailable. Try refreshing.";
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
    if (historyPanel.open) void loadHistory();
    else {
      region.hidden = true;
      node("card-market-history-status").textContent = "";
    }
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
    node("card-pricing-finish").hidden = false;
    const image = node<HTMLImageElement>("card-pricing-image");
    const catalog = options.collection();
    const set = catalog.sets.find(item => item.id === printing.setId);
    const artwork = catalogArtwork({ id: printing.setId }, printing.number)
      ?? (printing.image?.startsWith("https://assets.tcgdex.net/") ? printing.image
        : set ? catalogArtwork(set, printing.number) : null);
    image.hidden = !artwork;
    if (artwork) { image.alt = printing.name + " card artwork"; image.src = artwork; }
    else image.removeAttribute("src");
    historyPanel.open = false;
    range.value = "30";
    node("card-pricing-status").textContent = exact() ? "" : "Loading printings…";
    if (buying) {
      title.focus({ preventScroll: true });
    } else if (!prices.open) prices.showModal();
    showPrinting();
    const version = cardVersion;
    if (buying) requestAnimationFrame(() => {
      if (active(version) && document.activeElement === title) inline.scrollIntoView({ block: "start" });
    });
    if (!set && !exact()) {
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
        variant.replaceChildren(...candidates.map(item => new Option(item.label, item.id)));
        node("card-pricing-variants").hidden = false;
        node("card-pricing-finish").hidden = true;
        if (exact()) variant.value = printing.variant;
        else {
          // Start with the first finish so prices load at once; the select switches finishes.
          const first = candidates[0];
          target = { ...printing, variant: first.id, finish: first.label };
          variant.value = first.id;
          showPrinting();
        }
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
  historyPanel.addEventListener("toggle", () => {
    if (historyPanel.open && exact() && active(cardVersion)) void loadHistory();
    else historyRequest?.abort();
  });
  range.addEventListener("change", () => { if (historyPanel.open && exact()) void loadHistory(); });
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
