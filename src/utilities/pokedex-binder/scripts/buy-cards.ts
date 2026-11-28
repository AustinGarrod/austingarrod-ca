import { buyingStores, canCheckPrinting, combinedAvailability, isCrossBorder, matchesByStore, printingKey,
  type Availability, type BuyingStore, type StoreMatch } from "../lib/buying-offers";
import { createBuyOfferCache, offerBatchSize } from "../lib/buying-offer-cache";
import { catalogArtwork } from "../lib/catalog-search";
import { binderCards, binderSetIds } from "../lib/binder-catalog";
import type { MasterState, SetCard, SetSummary } from "../lib/master";
import { cad, calendarDate, groupBuyingEntries, marketPrices, matchesBuyingEntry, missingPrintings,
  type BuyingEntry, type MarketPrice, type PricingTarget, type RetailOffer, type RetailOffers } from "../lib/pricing";
import { escape } from "./binder-pages";

interface Options {
  collection(): { sets: readonly SetSummary[]; cards(setId: string): Promise<SetCard[]> };
  binders(): Promise<MasterState>;
  selected(): string;
  offerScope(): string;
  inspect(target: PricingTarget): void;
  closeDetail(): void;
}

type Finishes = SetCard["variants"];
interface Row {
  id: string;
  entry: BuyingEntry;
  target: PricingTarget;
  choices: Finishes;
  price?: MarketPrice;
  stores: StoreMatch[];
  availability: Availability;
  cheapest: number;
}

type CheckKind = "manual" | "all" | "refresh";

interface CheckWork {
  key: string;
  target: PricingTarget;
  stores?: readonly BuyingStore[];
  unavailable?: boolean;
}

interface CheckJob {
  kind: CheckKind;
  controller: AbortController;
  keys: Set<string>;
  total: number;
  completed: number;
  unavailable: number;
}

// Display only: rows are not checked until the person asks.
const pageSize = 24;
const node = <T extends HTMLElement = HTMLElement>(part: string) => document.getElementById("buy-cards-" + part) as T;
const select = (id: string) => node<HTMLSelectElement>(id);
const button = (id: string) => node<HTMLButtonElement>(id);
const byName = new Intl.Collator("en-CA", { numeric: true });
const time = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function listingLink(offer: RetailOffer, key: string) {
  return `<a href="${escape(offer.url)}" target="_blank" rel="noopener noreferrer" data-buy-store-link="${escape(key)}"
    aria-label="View ${escape(offer.store)} listing for ${cad(offer.priceCents)} CAD (opens in new tab)">${cad(offer.priceCents)} CAD</a>`;
}

function storeCell({ store, availability, offer }: StoreMatch, checking: boolean, rowId: string) {
  const state = { unchecked: "Needs a check", none: "No matching offer", unavailable: "Couldn’t check", stock: "In stock" };
  const pending = checking && availability === "unchecked";
  const description = pending ? "Checking…" : state[availability];
  const price = offer
    ? `${listingLink(offer, JSON.stringify([rowId, store]))}<small>${escape(offer.condition)} · In stock</small>`
    : escape(description);
  const checked = offer ? `<small>Checked ${escape(time.format(new Date(offer.checkedAt)))}</small>` : "";
  return `<div data-availability="${pending ? "checking" : availability}"><dt>${escape(store)}${isCrossBorder(store) ? "<small>Cross-border</small>" : ""}</dt><dd>${price}${checked}</dd></div>`;
}

function priceOrder(a: number, b: number) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  return hours > 0 ? `${hours}h ${minutes}m ${seconds % 60}s` : `${minutes}m ${seconds % 60}s`;
}

export function createBuyCards(options: Options) {
  const workspace = node("workspace"), list = node("list"), status = node("status");
  const empty = node("empty"), progress = node("check-status"), countdown = node("countdown");
  const missing = node("missing"), detail = document.getElementById("buy-card-pricing")!;
  const binderFilters = node("binder-filters"), binderActions = node("binder-actions");
  const search = node<HTMLInputElement>("filter"), maxPrice = node<HTMLInputElement>("max-price");
  const scope = select("scope"), finish = select("finish"), availability = select("availability"), store = select("store");
  const condition = select("condition"), sort = select("sort"), next = button("next"), prev = button("prev");
  const checkPage = button("check"), checkAll = button("check-all"), cancel = button("cancel"), clear = button("clear");
  const filters = [search, finish, availability, store, maxPrice, condition, sort];
  // On phones the filters other than search sit behind one button that says how many are applied.
  const filtersToggle = button("filters-toggle"), filterCount = node("filter-count"), offerFilterCount = node("offer-filter-count");
  filtersToggle.addEventListener("click", () => {
    const open = !binderFilters.classList.contains("is-open");
    binderFilters.classList.toggle("is-open", open);
    filtersToggle.setAttribute("aria-expanded", String(open));
  });
  function showFilterCount() {
    const applied = [scope, finish, availability, store, maxPrice, condition].filter(field => field.value).length;
    filterCount.textContent = applied ? String(applied) : "";
    filterCount.hidden = !applied;
    filtersToggle.setAttribute("aria-label", applied ? `Filters, ${applied} applied` : "Filters");
    const offerFilters = [store, maxPrice, condition].filter(field => field.value).length;
    offerFilterCount.textContent = `${offerFilters} applied`;
    offerFilterCount.hidden = !offerFilters;
  }
  const picks = new Map<string, string>();
  const expandedStores = new Set<string>();
  const quotes = createBuyOfferCache(options.offerScope, draw);
  let entries: BuyingEntry[] = [], visible: Row[] = [], setErrors = 0, page = 0, version = 0;
  let sets = new Map<string, SetSummary>(), cards = new Map<string, Map<string, Finishes>>();
  let values = new Map<string, MarketPrice>(), marketPending = new Set<string>();
  let loading = false, failedToLoad = false, needsReload = false, hasBinders = true;
  let catalogState: "loading" | "ready" | "error" = "loading";
  let visited = false, entryFromBinder = false;
  let job: CheckJob | undefined;
  let binderTargets = new Map<string, PricingTarget>();
  let rateLimitedUntil = 0, refreshPaused = false;
  let expiration: ReturnType<typeof setTimeout> | undefined;
  let inspectedRow: string | undefined;
  let restoreCatalogFocus: (() => void) | undefined;
  const isActive = () => !workspace.hidden;

  function choicesFor(entry: BuyingEntry): Finishes {
    return entry.target.variant === "*" ? cards.get(entry.target.setId)?.get(entry.target.number) ?? [] : [];
  }

  function targetsFor(target: PricingTarget, choices: Finishes) {
    return target.variant === "*"
      ? choices.map(choice => ({ ...target, variant: choice.id, finish: choice.label }))
      : [target];
  }

  function checkableTargets(targets: readonly PricingTarget[]) {
    return new Map(targets.filter(canCheckPrinting).map(target => [printingKey(target), target]));
  }

  function fillFinishes() {
    const preferred = finish.value;
    const labels = new Set(entries.flatMap(entry => [entry.target.finish, ...choicesFor(entry).map(item => item.label)]));
    finish.replaceChildren(new Option("All finishes", ""), ...[...labels].sort(byName.compare).map(item => new Option(item, item)));
    if (labels.has(preferred)) finish.value = preferred;
  }

  function getRow(entry: BuyingEntry, now: number, shops: readonly BuyingStore[], budget: number, grade: number): Row {
    const id = printingKey(entry.target);
    const availableChoices = choicesFor(entry);
    const matchingChoices = availableChoices.filter(item => item.label === finish.value);
    const choices = matchingChoices.length ? matchingChoices : availableChoices;
    const selected = choices.find(item => item.id === picks.get(id)) ?? (choices.length === 1 ? choices[0] : undefined);
    const priceSort = sort.value === "retail" || sort.value === "retail-desc";
    const targetFor = (choice: Finishes[number]) => ({ ...entry.target, variant: choice.id, finish: choice.label });
    function match(target: PricingTarget, results: RetailOffers | undefined) {
      const stores = matchesByStore(results, shops, now, budget, grade, priceSort);
      return { target, stores, cheapest: Math.min(...stores.map(item => item.offer?.priceCents ?? Infinity)) };
    }
    const target = selected ? targetFor(selected) : entry.target;
    let matched = match(target, quotes.peek(printingKey(target), now));
    if (!selected) {
      const alternatives: StoreMatch[][] = [];
      for (const choice of choices) {
        const exact = targetFor(choice), results = quotes.peek(printingKey(exact), now);
        if (!results) continue;
        const candidate = match(exact, results);
        alternatives.push(candidate.stores);
        if (candidate.cheapest >= matched.cheapest) continue;
        matched = candidate;
        if (!priceSort) break;
      }
      if (matched.target.variant === "*" && alternatives.length) {
        matched.stores = shops.map((store, index) => {
          const checks = alternatives.map(matches => matches[index]);
          const observed = combinedAvailability(checks);
          const availability = observed === "none" && alternatives.length < choices.length ? "unchecked" : observed;
          const checkedAt = availability === "none"
            ? checks.flatMap(check => check.checkedAt ?? []).sort((a, b) => Date.parse(a) - Date.parse(b))[0]
            : undefined;
          return { store, availability, checkedAt };
        });
      }
    }
    return { id, entry, choices, ...matched, price: values.get(printingKey(matched.target)), availability: combinedAvailability(matched.stores) };
  }

  function rowMarkup(row: Row) {
    const { target, choices, entry, price, stores } = row;
    const id = escape(row.id);
    const checking = targetsFor(target, choices).some(printing => job?.keys.has(printingKey(printing)));
    const set = sets.get(target.setId);
    const image = set && catalogArtwork(set, target.number);
    const title = escape(target.name + " #" + target.number + " " + target.finish);
    const canCheck = canCheckPrinting(target);
    const manualCheck = job && job.kind !== "refresh";
    const picker = choices.length > 1
      ? `<label>Printing <select data-buy-finish="${id}" aria-label="Choose a finish for ${escape(target.name)}">
       <option value="">Choose a finish</option>${choices.map(choice =>
         `<option value="${escape(choice.id)}" ${choice.id === target.variant ? "selected" : ""}>${escape(choice.label)}</option>`).join("")}</select></label>`
      : "";
    const market = price ? `<strong>${cad(price.cents)} CAD</strong>
      <small>TCGplayer sales · <time class="dex-price-date">${escape(calendarDate(price.observedAt))}</time></small>`
      : marketPending.has(target.setId) ? "Loading…" : "No estimate";
    // Store checks stay manual: they share a server-wide lookup limit.
    const checkButton = (text: string, inline = false) =>
      `<button type="button" ${inline ? 'class="dex-link"' : ""} data-buy-check="${id}" aria-label="${escape(text)} for ${title}" ${!canCheck || manualCheck ? "disabled" : ""}>${escape(text)}</button>`;
    const unchecked = stores.every(item => item.availability === "unchecked");
    const allFailed = stores.length > 0 && stores.every(item => item.availability === "unavailable");
    const someUnchecked = stores.some(item => item.availability === "unchecked");
    const failed = stores.filter(item => item.availability === "unavailable");
    const retryLabel = failed.length === 1 && stores.length === buyingStores.length ? `Retry ${failed[0].store}` : "Retry stores";
    const recheck = canCheck && !checking && !unchecked && (someUnchecked || failed.length)
      ? checkButton(someUnchecked ? "Check remaining stores" : retryLabel) : "";
    const checkedCount = stores.filter(item => item.checkedAt || item.offer).length;
    const stocked = stores.flatMap(item => item.offer ? [item.offer] : []);
    const byPrice = sort.value === "retail" || sort.value === "retail-desc";
    const best = stocked.sort((a, b) => byPrice
      ? a.priceCents - b.priceCents || a.conditionRank - b.conditionRank
      : a.conditionRank - b.conditionRank || a.priceCents - b.priceCents)[0];
    const resultLabel = allFailed ? "Stores unavailable" : someUnchecked || failed.length
      ? "No matching offer so far" : "No matching offer";
    const storeOrder = { stock: 0, unavailable: 1, unchecked: 2, none: 3 };
    const ordered = stores.slice().sort((a, b) => storeOrder[a.availability] - storeOrder[b.availability]);
    const coverage = `${checkedCount} of ${stores.length} checked${failed.length ? ` · ${failed.length} couldn’t be checked` : ""}`;
    const comparison = `<details class="dex-buying-compare" data-buy-stores="${id}" ${expandedStores.has(row.id) ? "open" : ""}>
      <summary data-buy-compare-stores="${id}">Compare stores <small>${coverage}</small></summary>
      <dl class="dex-buying-offers">${ordered.map(item => storeCell(item, checking, row.id)).join("")}</dl>
    </details>`;
    const storeResults = !canCheck && unchecked
      ? `<p class="dex-buying-store-line">${target.variant === "*" ? "Choose a finish to check stores." : "Store lookup is unavailable for this finish."}</p>`
      : unchecked && checking ? `<p class="dex-buying-store-line" role="status">Checking stores…</p>`
      : unchecked ? `<p class="dex-buying-store-line">Stores: Needs a check · ${checkButton("Check stores", true)}</p>`
      : `${best ? `<div class="dex-buying-best"><div><small>${byPrice ? "Lowest price" : "Best condition"}</small><strong>${escape(best.store)}</strong>
        <small>${escape(best.condition)} · In stock${isCrossBorder(best.store) ? " · Cross-border" : ""}</small></div>
        ${listingLink(best, JSON.stringify([row.id, "best"]))}</div>`
        : `<p class="dex-buying-store-line" data-availability="${allFailed ? "unavailable" : "none"}">${resultLabel}</p>`}
        ${comparison}`;
    return `<li class="dex-buying-row" data-buy-row="${id}">
      <div class="dex-buying-identity">${image ? `<img src="${escape(image)}" width="42" height="59" alt="" loading="lazy">` : ""}
        <div><strong>${escape(target.name)}</strong><small>${escape(target.setName)} · #${escape(target.number)} · ${escape(target.finish)}
        ${entry.copies > 1 ? " · " + entry.copies + " needed" : ""}</small>
        <p class="dex-buying-market"><span>Market estimate</span> ${market}</p></div>
      </div>
      <div>${storeResults}
        <div class="dex-actions">${picker}${recheck}
          <button type="button" data-buy-card="${id}" aria-controls="buy-card-pricing" aria-expanded="${row.id === inspectedRow}" aria-label="Price details for ${title}">Price details</button>
        </div>
      </div>
    </li>`;
  }

  function canRefresh() {
    return isActive() && !document.hidden && !loading && catalogState === "ready" && !job && !refreshPaused;
  }

  function visibleTargets() {
    return checkableTargets(visible.flatMap(row => targetsFor(row.target, row.choices)));
  }

  function refreshVisible() {
    const now = Date.now();
    if (canRefresh() && now >= rateLimitedUntil) {
      const due = new Map([...visibleTargets()].filter(([key]) => quotes.refreshAt(key, now) <= now));
      if (due.size) {
        void check(due, "refresh");
        return;
      }
    }
    draw();
  }

  function scheduleExpiration(now: number, quoteExpiry: number) {
    clearTimeout(expiration);
    let earliest = quoteExpiry;
    if (canRefresh()) {
      for (const key of visibleTargets().keys()) {
        earliest = Math.min(earliest, Math.max(rateLimitedUntil, quotes.refreshAt(key, now)));
      }
    }
    if (Number.isFinite(earliest)) expiration = setTimeout(refreshVisible, Math.max(1, earliest - now));
  }

  function draw() {
    const now = Date.now();
    const quoteExpiry = quotes.expire(now);
    if (!isActive() || document.hidden || loading || catalogState !== "ready") {
      scheduleExpiration(now, quoteExpiry);
      return;
    }
    const shops = store.value ? buyingStores.filter(item => item === store.value) : buyingStores;
    const budget = Number.isFinite(maxPrice.valueAsNumber) ? Math.max(0, Math.round(maxPrice.valueAsNumber * 100)) : Infinity;
    const grade = condition.value !== "" ? Number(condition.value) : Infinity;
    const requiresOffer = Number.isFinite(budget) || Number.isFinite(grade);
    const matching = entries.filter(entry => matchesBuyingEntry(entry, search.value)
      && (!finish.value || entry.target.finish === finish.value || choicesFor(entry).some(item => item.label === finish.value)))
      .map(entry => getRow(entry, now, shops, budget, grade))
      .filter(row => availability.value ? row.availability === availability.value : !requiresOffer || row.availability === "stock");
    if (sort.value === "name") matching.sort((a, b) => byName.compare(a.target.name, b.target.name));
    if (sort.value === "market") matching.sort((a, b) => priceOrder(a.price?.cents ?? Infinity, b.price?.cents ?? Infinity));
    if (sort.value === "stock") matching.sort((a, b) => Number(b.availability === "stock") - Number(a.availability === "stock"));
    if (sort.value === "retail") matching.sort((a, b) => priceOrder(a.cheapest, b.cheapest));
    if (sort.value === "retail-desc") matching.sort((a, b) =>
      Number(!Number.isFinite(a.cheapest)) - Number(!Number.isFinite(b.cheapest)) || priceOrder(b.cheapest, a.cheapest));

    const pages = Math.max(1, Math.ceil(matching.length / pageSize));
    page = Math.min(page, pages - 1);
    visible = matching.slice(page * pageSize, (page + 1) * pageSize);
    const count = matching.reduce((sum, row) => sum + row.entry.copies, 0);
    const summary = failedToLoad ? "The binders couldn’t load. Switch to Binders and return to try again."
      : !hasBinders ? "You don’t have any set binders yet."
      : count ? `${count.toLocaleString()} ${count === 1 ? "card" : "cards"} still to find`
      : entries.length ? (availability.value === "stock" || requiresOffer ? "No in-stock offers match. Clear offer filters to check more cards."
        : "No missing cards match this search.") : "No catalog cards still to find.";
    status.textContent = summary + (setErrors ? " Some set checklists couldn’t load." : "");
    empty.hidden = hasBinders || failedToLoad;
    binderFilters.hidden = binderActions.hidden = !hasBinders || failedToLoad;
    node("pages").hidden = pages <= 1;
    node("page").textContent = `Page ${page + 1} of ${pages}`;
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    const manualCheck = !!job && job.kind !== "refresh";
    checkPage.disabled = manualCheck || !visible.some(row => canCheckPrinting(row.target));
    checkAll.disabled = manualCheck || !binderTargets.size;
    cancel.hidden = !manualCheck;
    clear.hidden = binderActions.hidden || filters.every(input => !input.value || input === sort && sort.value === "binder");
    showFilterCount();

    const active = document.activeElement as HTMLElement | null;
    const attribute = ["data-buy-check", "data-buy-card", "data-buy-finish", "data-buy-compare-stores", "data-buy-store-link"].find(name => active?.hasAttribute(name));
    const focused = attribute && active?.getAttribute(attribute);
    const focusedRow = active?.closest<HTMLElement>("[data-buy-row]")?.dataset.buyRow;
    for (const details of list.querySelectorAll<HTMLDetailsElement>("details[data-buy-stores]")) {
      const id = details.dataset.buyStores!;
      if (details.open) expandedStores.add(id);
      else expandedStores.delete(id);
    }
    list.innerHTML = visible.map(rowMarkup).join("");
    if (attribute && focused && active && !active.isConnected) {
      const replacement = list.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(focused)}"]:not(:disabled)`);
      const alternative = focusedRow ? list.querySelector<HTMLElement>(`[data-buy-card="${CSS.escape(focusedRow)}"]`) : null;
      (replacement ?? alternative ?? (manualCheck ? cancel : checkPage)).focus({ preventScroll: true });
    }
    scheduleExpiration(now, quoteExpiry);
  }

  function showProgress(message: string, seconds = 0, retailer?: BuyingStore) {
    const timer = seconds > 0 ? `${retailer ?? "Store"} checks will resume in ${formatWait(seconds)}. ` : "";
    if (countdown.textContent !== timer) countdown.textContent = timer;
    if (progress.textContent !== message) progress.textContent = message;
  }

  function cancelChecks() {
    job?.controller.abort();
    job = undefined;
    cancel.hidden = true;
    showProgress("");
  }

  async function check(targets: Map<string, PricingTarget>, kind: CheckKind = "manual") {
    if (!targets.size || job && job.kind !== "refresh") return;
    if (job) cancelChecks();
    if (kind !== "refresh") refreshPaused = false;

    const work = [...targets].map(([key, target]): CheckWork => ({ key, target }));
    const deferred: (CheckWork & { resumeAt: number })[] = [];
    const lookup: CheckJob = {
      kind, controller: new AbortController(), keys: new Set(targets.keys()),
      total: work.length, completed: 0, unavailable: 0,
    };
    const signal = lookup.controller.signal;
    const focusStop = kind !== "refresh" && (document.activeElement === checkPage || document.activeElement === checkAll);
    job = lookup;
    let cursor = 0;

    function report(wait = rateLimitedUntil - Date.now(), retailer?: BuyingStore) {
      if (kind === "refresh") return;
      const seconds = Math.ceil(wait / 1_000);
      const count = `${lookup.completed} of ${lookup.total} ${lookup.total === 1 ? "printing" : "printings"}`;
      showProgress(seconds > 0 ? `${count} checked.` : `Checking store prices · ${count}`, seconds, retailer);
    }

    async function waitUntil(resumeAt: number, retailer?: BuyingStore) {
      const wait = resumeAt - Date.now();
      if (wait <= 0 || signal.aborted) return;
      report(wait, retailer);
      const delay = kind === "refresh" ? Math.min(wait, 2_147_483_647) : wait % 1_000 || 1_000;
      await new Promise<void>(resolve => {
        const finishWaiting = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finishWaiting);
          resolve();
        };
        const timer = setTimeout(finishWaiting, delay);
        signal.addEventListener("abort", finishWaiting, { once: true });
      });
    }

    report();
    draw();
    if (focusStop) cancel.focus({ preventScroll: true });

    while (job === lookup) {
      const batch = work.slice(cursor, cursor + offerBatchSize);
      cursor += batch.length;
      if (!batch.length && !deferred.length) break;
      const now = Date.now();
      if (!batch.length && rateLimitedUntil <= now) {
        for (let index = 0; index < deferred.length && batch.length < offerBatchSize;) {
          if (deferred[index].resumeAt > now) index++;
          else batch.push(deferred.splice(index, 1)[0]);
        }
      }
      if (!batch.length) {
        const next = Math.min(...deferred.map(candidate => candidate.resumeAt));
        const firstStore = deferred[0].stores?.[0];
        const retailer = next >= rateLimitedUntil && deferred.every(candidate =>
          candidate.stores?.length === 1 && candidate.stores[0] === firstStore) ? firstStore : undefined;
        await waitUntil(Math.max(rateLimitedUntil, next), retailer);
        continue;
      }
      report(0);
      const results = await quotes.checkMany(batch, signal).catch(() => []);
      if (job !== lookup) return;
      const finished = Date.now();
      batch.forEach((item, index) => {
        const result = results[index];
        const unavailable = item.unavailable || !result || result.unavailableStores.length > 0;
        if (result?.retryAfter) {
          rateLimitedUntil = Math.max(rateLimitedUntil, finished + result.retryAfter * 1_000);
          deferred.push({ ...item, resumeAt: rateLimitedUntil, unavailable });
          return;
        }
        const delays = result?.storeRetryAfter ?? {};
        const waiting = buyingStores.filter(shop => delays[shop] > 0);
        if (waiting.length) {
          const seconds = Math.min(...waiting.map(shop => delays[shop]));
          deferred.push({ ...item, stores: waiting, resumeAt: finished + seconds * 1_000, unavailable });
          return;
        }
        if (unavailable) lookup.unavailable++;
        lookup.keys.delete(item.key);
        lookup.completed++;
      });
      report();
      draw();
    }
    if (job !== lookup) return;
    const restoreFocus = document.activeElement === cancel;
    job = undefined;
    if (kind !== "refresh") {
      showProgress(`Checked ${lookup.completed} of ${lookup.total} ${lookup.total === 1 ? "printing" : "printings"}.`
        + (lookup.unavailable ? ` Some stores couldn’t be checked for ${lookup.unavailable} ${lookup.unavailable === 1 ? "printing" : "printings"}.` : ""));
    }
    draw();
    if (restoreFocus) (kind === "all" ? checkAll : checkPage).focus({ preventScroll: true });
  }

  async function load(preferred: string) {
    const ticket = ++version;
    const current = () => isActive() && version === ticket;
    cancelChecks();
    needsReload = false;
    loading = true;
    failedToLoad = false;
    setErrors = 0;
    entries = visible = [];
    binderTargets.clear();
    values = new Map();
    marketPending = new Set();
    scope.disabled = true;
    checkPage.disabled = checkAll.disabled = true;
    empty.hidden = true;
    list.replaceChildren();
    node("pages").hidden = true;
    status.textContent = "Checking which cards are missing…";
    try {
      const [state] = await Promise.all([options.binders(), quotes.hydrate()]);
      if (!current()) return;
      hasBinders = state.binders.length > 0;
      scope.replaceChildren(new Option("All binders", ""), ...state.binders.map(binder => new Option(binder.name, binder.id)));
      scope.value = state.binders.some(binder => binder.id === preferred) ? preferred : "";
      const selected = state.binders.filter(binder => !scope.value || binder.id === scope.value);
      const catalog = options.collection();
      sets = new Map(catalog.sets.map(set => [set.id, set]));
      const setIds = [...new Set(selected.flatMap(binder => binderSetIds(binder)))];
      const results = await Promise.allSettled(setIds.map(async id => [id, await catalog.cards(id)] as const));
      if (!current()) return;
      const loaded = new Map(results.flatMap(result => result.status === "fulfilled" ? [result.value] : []));
      setErrors = results.length - loaded.size;
      cards = new Map([...loaded].map(([id, data]) => [id, new Map(data.map(card => [card.number, card.variants]))]));
      entries = groupBuyingEntries(selected.flatMap(binder => {
        const set = sets.get(binder.setId), data = loaded.get(binder.setId);
        return set && data ? missingPrintings(binder, set, binderCards(binder, id => loaded.get(id) ?? []), sets) : [];
      }));
      binderTargets = checkableTargets(entries.flatMap(entry => targetsFor(entry.target, choicesFor(entry))));
      fillFinishes();
      const ids = [...new Set(entries.map(entry => entry.target.setId))];
      marketPending = new Set(ids);
      let index = 0;
      async function pullMarket() {
        while (index < ids.length && current()) {
          const setId = ids[index++];
          try {
            const market = await marketPrices(setId);
            if (!current()) return;
            for (const price of market.prices) values.set(JSON.stringify([setId, price.number, price.variant]), price);
          } catch {
            if (!current()) return;
          } finally {
            if (current()) { marketPending.delete(setId); draw(); }
          }
        }
      }
      for (let worker = 0; worker < Math.min(4, ids.length); worker++) void pullMarket();
    } catch {
      if (current()) failedToLoad = true;
    } finally {
      if (current()) { loading = false; scope.disabled = false; draw(); }
    }
  }

  function resetFilters() {
    for (const field of filters) field.value = field === sort ? "binder" : "";
    node<HTMLDetailsElement>("offer-filters").open = false;
    page = 0;
  }

  function activate() {
    if (catalogState !== "ready") {
      status.textContent = catalogState === "error" ? "The set catalog couldn’t load. Reload to try again." : "Loading your set binders…";
      return;
    }
    if (!visited) {
      visited = true;
      void load(entryFromBinder ? options.selected() : "");
    } else if (needsReload || marketPending.size || failedToLoad) {
      void load(scope.value);
    } else {
      refreshVisible();
    }
  }

  function deactivate() {
    needsReload ||= loading;
    loading = false;
    version++;
    cancelChecks();
    clearInspection();
    options.closeDetail();
  }
  function clearInspection() {
    inspectedRow = undefined;
    restoreCatalogFocus = undefined;
    list.querySelector('[data-buy-card][aria-expanded="true"]')?.setAttribute("aria-expanded", "false");
  }
  function changeVisibleRows() {
    if (job?.kind === "refresh") cancelChecks();
    draw();
  }

  for (const field of filters) {
    field.addEventListener(field instanceof HTMLInputElement ? "input" : "change", () => { page = 0; changeVisibleRows(); });
  }
  scope.addEventListener("change", () => {
    if (catalogState !== "ready") return;
    if (!restoreCatalogFocus) {
      clearInspection();
      options.closeDetail();
    }
    page = 0;
    void load(scope.value);
  });
  checkPage.addEventListener("click", () => void check(checkableTargets(visible.map(row => row.target))));
  checkAll.addEventListener("click", () => void check(binderTargets, "all"));
  cancel.addEventListener("click", () => {
    if (!job || job.kind === "refresh") return;
    const { kind, completed, total } = job;
    refreshPaused = true;
    cancelChecks();
    showProgress(`Stopped after ${completed} of ${total} ${total === 1 ? "printing" : "printings"}.`);
    draw();
    (kind === "all" ? checkAll : checkPage).focus({ preventScroll: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && job?.kind === "refresh") cancelChecks();
    refreshVisible();
  });
  clear.addEventListener("click", () => { resetFilters(); changeVisibleRows(); search.focus(); });
  function turnPage(offset: number) {
    page += offset;
    changeVisibleRows();
    list.querySelector<HTMLElement>("[data-buy-card]")?.focus();
  }
  next.addEventListener("click", () => turnPage(1));
  prev.addEventListener("click", () => turnPage(-1));
  list.addEventListener("change", event => {
    const control = (event.target as Element).closest<HTMLSelectElement>("[data-buy-finish]");
    if (!control?.dataset.buyFinish) return;
    if (control.value) picks.set(control.dataset.buyFinish, control.value);
    else picks.delete(control.dataset.buyFinish);
    changeVisibleRows();
  });
  list.addEventListener("click", event => {
    const control = (event.target as Element).closest<HTMLButtonElement>("[data-buy-check], [data-buy-card]");
    const row = control && visible.find(item => item.id === (control.dataset.buyCheck ?? control.dataset.buyCard));
    if (!row || !control) return;
    if (control.hasAttribute("data-buy-check")) { void check(checkableTargets([row.target])); return; }
    clearInspection();
    inspectedRow = row.id;
    control.setAttribute("aria-expanded", "true");
    if (detail.nextElementSibling !== list) list.before(detail);
    options.inspect(row.target);
  });

  return {
    readOffers: quotes.read,
    checkOffers: quotes.check,
    inspectCatalog(target: PricingTarget, restoreFocus: () => void) {
      clearInspection();
      restoreCatalogFocus = restoreFocus;
      if (detail.nextElementSibling !== missing) missing.before(detail);
      options.inspect(target);
    },
    enter(fromBinders: boolean) {
      if (!visited) entryFromBinder = fromBinders;
      refreshPaused = false;
      activate();
    },
    leave: deactivate,
    catalogReady() {
      catalogState = "ready";
      if (isActive()) activate();
    },
    catalogUnavailable() {
      catalogState = "error";
      if (isActive()) activate();
    },
    detailClosed() {
      const id = inspectedRow;
      const restoreFocus = restoreCatalogFocus;
      clearInspection();
      if (!isActive()) return;
      if (restoreFocus) { restoreFocus(); return; }
      const row = id ? list.querySelector<HTMLElement>(`[data-buy-card="${CSS.escape(id)}"]`) : null;
      (row ?? document.getElementById("binder-view-title"))?.focus();
    },
    bindersChanged() {
      needsReload = true;
      if (isActive() && catalogState === "ready" && visited) void load(scope.value);
    },
    scopeChanged() {
      deactivate();
      resetFilters();
      entries = visible = [];
      binderTargets.clear();
      sets.clear();
      cards.clear();
      picks.clear();
      expandedStores.clear();
      quotes.reset();
      values.clear();
      marketPending.clear();
      scope.replaceChildren(new Option("All binders", ""));
      list.replaceChildren();
      empty.hidden = true;
      binderFilters.hidden = binderActions.hidden = true;
      node("pages").hidden = true;
      checkPage.disabled = checkAll.disabled = true;
      clear.hidden = true;
      status.textContent = "Loading your set binders…";
      needsReload = true;
    },
  };
}
