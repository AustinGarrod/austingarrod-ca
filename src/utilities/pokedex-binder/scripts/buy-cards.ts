import { buyingStores, canCheckPrinting, combinedAvailability, matchesByStore, printingKey,
  type Availability, type BuyingStore, type OfferSnapshot, type StoreMatch } from "../lib/buying-offers";
import { catalogArtwork } from "../lib/catalog-search";
import type { MasterState, SetCard, SetSummary } from "../lib/master";
import { cad, calendarDate, freshOfferCheck, groupBuyingEntries, marketPrices, matchesBuyingEntry, missingPrintings,
  offerLifetime, pricingRequest, type BuyingEntry, type MarketPrice, type PricingTarget, type RetailOffers } from "../lib/pricing";
import { escape } from "./binder-pages";

interface Options {
  collection(): { sets: readonly SetSummary[]; cards(setId: string): Promise<SetCard[]> };
  binders(): Promise<MasterState>;
  selected(): string;
  inspect(target: PricingTarget): void;
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

const pageSize = 6;
const node = <T extends HTMLElement = HTMLElement>(part: string) => document.getElementById("buy-cards-" + part) as T;
const select = (id: string) => node<HTMLSelectElement>(id);
const button = (id: string) => node<HTMLButtonElement>(id);
const byName = new Intl.Collator("en-CA", { numeric: true });
const time = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function storeCell({ store, availability, offer }: StoreMatch, checking: boolean) {
  const state = { unchecked: "Needs a check", none: "No match", unavailable: "Couldn’t check", stock: "In stock" };
  const description = checking ? "Checking…" : state[availability];
  const price = offer && !checking
    ? `<a href="${escape(offer.url)}" target="_blank" rel="noopener noreferrer"
       aria-label="View ${escape(store)} listing for ${cad(offer.priceCents)} CAD (opens in new tab)">${cad(offer.priceCents)}</a>
       <small>${escape(offer.condition)} · In stock</small>
       <small>Checked ${escape(time.format(new Date(offer.checkedAt)))}</small>`
    : escape(description);
  return `<div data-availability="${checking ? "checking" : availability}"><dt>${escape(store)}</dt><dd>${price}</dd></div>`;
}

function priceOrder(a: number, b: number) {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function createBuyCards(options: Options) {
  const modal = node<HTMLDialogElement>("dialog"), list = node("list"), status = node("status"), progress = node("progress");
  const search = node<HTMLInputElement>("filter"), maxPrice = node<HTMLInputElement>("max-price");
  const scope = select("scope"), finish = select("finish"), availability = select("availability"), store = select("store");
  const condition = select("condition"), sort = select("sort"), next = button("next"), prev = button("prev");
  const checkPage = button("check"), clear = button("clear");
  const filters = [search, finish, availability, store, maxPrice, condition, sort];
  const picks = new Map<string, string>(), quotes = new Map<string, OfferSnapshot>();
  let entries: BuyingEntry[] = [], visible: Row[] = [], setErrors = 0, page = 0, version = 0;
  let sets = new Map<string, SetSummary>(), cards = new Map<string, Map<string, Finishes>>();
  let values = new Map<string, MarketPrice>(), marketPending = new Set<string>();
  let loading = false, failedToLoad = false, needsReload = false;
  let job: { controller: AbortController; keys: Set<string> } | undefined;
  let expiration: ReturnType<typeof setTimeout> | undefined;
  let returnPosition: { id: string; scrollTop: number } | undefined;

  function choicesFor(entry: BuyingEntry): Finishes {
    return entry.target.variant === "*" ? cards.get(entry.target.setId)?.get(entry.target.number) ?? [] : [];
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
    const target = selected ? { ...entry.target, variant: selected.id, finish: selected.label } : entry.target;
    const key = printingKey(target);
    const stores = matchesByStore(quotes.get(key), shops, now, budget, grade);
    const cheapest = Math.min(...stores.map(item => item.offer?.priceCents ?? Infinity));
    return { id, entry, target, choices, price: values.get(key), stores, availability: combinedAvailability(stores), cheapest };
  }

  function rowMarkup(row: Row) {
    const { target, choices, entry, price, stores } = row;
    const id = escape(row.id), checking = job?.keys.has(printingKey(target)) ?? false;
    const set = sets.get(target.setId);
    const image = set && catalogArtwork(set, target.number);
    const title = escape(target.name + " #" + target.number + " " + target.finish);
    const canCheck = canCheckPrinting(target);
    const picker = choices.length > 1
      ? `<label>Printing <select data-buy-finish="${id}" aria-label="Choose a finish for ${escape(target.name)}">
       <option value="">Choose a finish</option>${choices.map(choice =>
         `<option value="${escape(choice.id)}" ${choice.id === target.variant ? "selected" : ""}>${escape(choice.label)}</option>`).join("")}</select></label>`
      : "";
    const market = price ? `<strong>${cad(price.cents)} CAD</strong> <small>${escape(calendarDate(price.observedAt))}</small>`
      : marketPending.has(target.setId) ? "Loading…" : "No estimate";
    const storeResults = canCheck ? `<dl class="dex-buying-offers">${stores.map(item => storeCell(item, checking)).join("")}</dl>`
      : `<p class="dex-help">${target.variant === "*" ? "Choose a finish to check stores." : "Store lookup is unavailable for this finish."}</p>`;
    return `<li class="dex-buying-row">
      <div class="dex-buying-identity">${image ? `<img src="${escape(image)}" width="42" height="59" alt="" loading="lazy">` : ""}
        <div><strong>${escape(target.name)}</strong><small>${escape(target.setName)} · #${escape(target.number)} · ${escape(target.finish)}
        ${entry.copies > 1 ? " · " + entry.copies + " needed" : ""}</small>
        <p class="dex-buying-market"><span>Market estimate</span>${market}</p></div>
      </div>
      <div>${storeResults}
        <div class="dex-actions">${picker}
          <button type="button" data-buy-check="${id}" aria-label="Check stores for ${title}" ${!canCheck || job ? "disabled" : ""}>Check stores</button>
          <button type="button" class="dex-quiet" data-buy-card="${id}" aria-label="Compare offers for ${title}">Compare offers</button>
        </div>
      </div>
    </li>`;
  }

  function scheduleExpiration(now: number) {
    clearTimeout(expiration);
    let earliest = Infinity;
    for (const [key, snapshot] of quotes) {
      const times = [...Object.values(snapshot.results.checkedStores ?? {}).map(Date.parse),
        ...snapshot.results.offers.map(item => Date.parse(item.checkedAt))];
      if (snapshot.results.unavailableStores.length) times.push(snapshot.receivedAt);
      const future = times.map(item => item + offerLifetime).filter(item => item > now);
      if (!future.length) quotes.delete(key);
      else earliest = Math.min(earliest, ...future);
    }
    if (Number.isFinite(earliest)) expiration = setTimeout(draw, Math.max(1, earliest - now));
  }

  function draw() {
    if (!modal.open || loading) return;
    const now = Date.now();
    const shops = store.value ? buyingStores.filter(item => item === store.value) : buyingStores;
    const budget = maxPrice.value !== "" ? Math.max(0, Math.round(maxPrice.valueAsNumber * 100)) : Infinity;
    const grade = condition.value !== "" ? Number(condition.value) : Infinity;
    const matching = entries.filter(entry => matchesBuyingEntry(entry, search.value)
      && (!finish.value || entry.target.finish === finish.value || choicesFor(entry).some(item => item.label === finish.value)))
      .map(entry => getRow(entry, now, shops, budget, grade))
      .filter(row => !availability.value || row.availability === availability.value);
    if (sort.value === "name") matching.sort((a, b) => byName.compare(a.target.name, b.target.name));
    if (sort.value === "market") matching.sort((a, b) => priceOrder(a.price?.cents ?? Infinity, b.price?.cents ?? Infinity));
    if (sort.value === "retail") matching.sort((a, b) => priceOrder(a.cheapest, b.cheapest));

    const pages = Math.max(1, Math.ceil(matching.length / pageSize));
    page = Math.min(page, pages - 1);
    visible = matching.slice(page * pageSize, (page + 1) * pageSize);
    const count = matching.reduce((sum, row) => sum + row.entry.copies, 0);
    const summary = failedToLoad ? "The binders couldn’t load. Close this view and try again."
      : count ? `${count.toLocaleString()} ${count === 1 ? "card" : "cards"} still to find`
      : entries.length ? (availability.value === "stock" ? "No in-stock offers match these filters yet. Choose Any status to check more cards."
        : "No missing cards match this search.") : "No catalog cards still to find.";
    status.textContent = summary + (setErrors ? " Some set checklists couldn’t load." : "");
    node("pages").hidden = pages <= 1;
    node("page").textContent = `Page ${page + 1} of ${pages}`;
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    checkPage.disabled = Boolean(job) || !visible.some(row => canCheckPrinting(row.target));
    clear.hidden = filters.every(input => !input.value || input === sort && sort.value === "binder");

    const active = document.activeElement as HTMLElement | null;
    const attribute = ["data-buy-check", "data-buy-card", "data-buy-finish"].find(name => active?.hasAttribute(name));
    const focused = attribute && active?.getAttribute(attribute);
    list.innerHTML = visible.map(rowMarkup).join("");
    if (attribute && focused && active && !active.isConnected) {
      const replacement = list.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(focused)}"]:not(:disabled)`);
      const alternative = list.querySelector<HTMLElement>(`[data-buy-card="${CSS.escape(focused)}"]`);
      (replacement ?? alternative ?? checkPage).focus({ preventScroll: true });
    }
    scheduleExpiration(now);
  }

  function cancelChecks() {
    job?.controller.abort();
    job = undefined;
    progress.textContent = "";
  }

  async function check(rows: readonly Row[]) {
    if (job) return;
    const targets = new Map(rows.filter(row => canCheckPrinting(row.target)).map(row => [printingKey(row.target), row.target]));
    if (!targets.size) return;
    const work = [...targets];
    const lookup = { controller: new AbortController(), keys: new Set(targets.keys()) };
    job = lookup;
    let cursor = 0, completed = 0;
    progress.textContent = `Checking stores for ${work.length} ${work.length === 1 ? "printing" : "printings"}…`;
    draw();
    async function pull() {
      while (cursor < work.length && job === lookup) {
        const [key, target] = work[cursor++];
        let results: RetailOffers;
        try {
          results = await pricingRequest<RetailOffers>("offers",
            { set: target.setId, number: target.number, variant: target.variant },
            AbortSignal.any([lookup.controller.signal, AbortSignal.timeout(12_000)]));
        } catch {
          results = { offers: [], unavailableStores: [...buyingStores] };
        }
        if (job !== lookup) return;
        quotes.set(key, { results, receivedAt: Date.now() });
        lookup.keys.delete(key);
        completed++;
        draw();
      }
    }
    await Promise.all([pull(), pull()]);
    if (job !== lookup) return;
    job = undefined;
    progress.textContent = `Checked ${completed} ${completed === 1 ? "printing" : "printings"}.`;
    draw();
  }

  async function load(preferred: string) {
    const ticket = ++version;
    const current = () => modal.open && version === ticket;
    cancelChecks();
    needsReload = false;
    loading = true;
    failedToLoad = false;
    setErrors = 0;
    entries = visible = [];
    values = new Map();
    marketPending = new Set();
    scope.disabled = true;
    checkPage.disabled = true;
    list.replaceChildren();
    node("pages").hidden = true;
    status.textContent = "Checking which cards are missing…";
    try {
      const state = await options.binders();
      if (!current()) return;
      scope.replaceChildren(new Option("All binders", ""), ...state.binders.map(binder => new Option(binder.name, binder.id)));
      scope.value = state.binders.some(binder => binder.id === preferred) ? preferred : "";
      const selected = state.binders.filter(binder => !scope.value || binder.id === scope.value);
      const catalog = options.collection();
      sets = new Map(catalog.sets.map(set => [set.id, set]));
      const setIds = [...new Set(selected.map(binder => binder.setId))];
      const results = await Promise.allSettled(setIds.map(async id => [id, await catalog.cards(id)] as const));
      if (!current()) return;
      const loaded = new Map(results.flatMap(result => result.status === "fulfilled" ? [result.value] : []));
      setErrors = results.length - loaded.size;
      cards = new Map([...loaded].map(([id, data]) => [id, new Map(data.map(card => [card.number, card.variants]))]));
      entries = groupBuyingEntries(selected.flatMap(binder => {
        const set = sets.get(binder.setId), data = loaded.get(binder.setId);
        return set && data ? missingPrintings(binder, set, data) : [];
      }));
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

  button("open").addEventListener("click", () => {
    resetFilters();
    modal.showModal();
    void load(options.selected());
  });
  modal.addEventListener("close", () => {
    if (modal.open) return;
    version++;
    clearTimeout(expiration);
    cancelChecks();
  });
  for (const field of filters) {
    field.addEventListener(field instanceof HTMLInputElement ? "input" : "change", () => { page = 0; draw(); });
  }
  scope.addEventListener("change", () => { page = 0; void load(scope.value); });
  checkPage.addEventListener("click", () => void check(visible));
  clear.addEventListener("click", () => { resetFilters(); draw(); search.focus(); });
  function turnPage(offset: number) {
    page += offset;
    draw();
    list.querySelector<HTMLElement>("[data-buy-card]")?.focus();
  }
  next.addEventListener("click", () => turnPage(1));
  prev.addEventListener("click", () => turnPage(-1));
  list.addEventListener("change", event => {
    const control = (event.target as Element).closest<HTMLSelectElement>("[data-buy-finish]");
    if (!control?.dataset.buyFinish) return;
    if (control.value) picks.set(control.dataset.buyFinish, control.value);
    else picks.delete(control.dataset.buyFinish);
    draw();
  });
  list.addEventListener("click", event => {
    const control = (event.target as Element).closest<HTMLButtonElement>("[data-buy-check], [data-buy-card]");
    const row = control && visible.find(item => item.id === (control.dataset.buyCheck ?? control.dataset.buyCard));
    if (!row || !control) return;
    if (control.hasAttribute("data-buy-check")) { void check([row]); return; }
    returnPosition = { id: row.id, scrollTop: modal.scrollTop };
    modal.close();
    options.inspect(row.target);
  });

  return {
    recentOffers(target: PricingTarget) {
      const snapshot = quotes.get(printingKey(target));
      if (!snapshot || Date.now() - snapshot.receivedAt >= offerLifetime || snapshot.results.unavailableStores.length) return;
      const times = [...Object.values(snapshot.results.checkedStores ?? {}), ...snapshot.results.offers.map(offer => offer.checkedAt)];
      if (times.length && times.every(at => freshOfferCheck(at, Date.now()))) return snapshot.results;
    },
    recordOffers(target: PricingTarget, results: RetailOffers) {
      quotes.set(printingKey(target), { results, receivedAt: Date.now() });
    },
    async reopen() {
      const position = returnPosition;
      returnPosition = undefined;
      modal.showModal();
      if (needsReload || marketPending.size) await load(scope.value);
      else draw();
      if (!position || !modal.open) return;
      list.querySelector<HTMLElement>(`[data-buy-card="${CSS.escape(position.id)}"]`)?.focus({ preventScroll: true });
      modal.scrollTop = position.scrollTop;
    },
    bindersChanged() {
      if (modal.open) void load(scope.value);
      else if (returnPosition) needsReload = true;
    },
    scopeChanged() {
      version++;
      modal.close();
      clearTimeout(expiration);
      cancelChecks();
      entries = visible = [];
      sets.clear();
      cards.clear();
      picks.clear();
      quotes.clear();
      values.clear();
      marketPending.clear();
      scope.replaceChildren(new Option("All binders", ""));
      list.replaceChildren();
      returnPosition = undefined;
    },
  };
}
