import type { SetScan } from "./scanner";
import { binderPages, blankPocket, cardPocket, escape, filterControl, showDetailsSheet, statusControl } from "./binder-pages";
import { binderChecklist } from "./binder-checklist";
import { setBulkSelection } from "./set-bulk-selection";
import { renderSetOverview, type OverviewBinder } from "./set-overview";
import { sortSetChecklist, type SetChecklistSort } from "../lib/checklist";
import { createAccountClient } from "../../../../packages/accounts/client";
import {
  binderSectionLayout,
  emptyMaster,
  extraSectionId,
  isCardPocket,
  sameSave,
  markSlot,
  newBinder,
  setPockets,
  setSlots,
  setSlotStatus,
  setSlotsStatus,
  validateMaster,
  type MasterState,
  type SectionPlacement,
  type SetBinder,
  type SetCard,
  type SetSummary,
} from "../lib/master";
import type { BinderAccountState } from "../lib/accounts";
import { conflictInvolvesDelete, type MasterStore } from "../lib/master-store";
import { validateSettings, type CardStatus } from "../lib/model";
import { marketPrices, valueBinder, type PricingTarget } from "../lib/pricing";
import { binderCards, binderSetIds, loadBinderCards, relatedSets, setCardKey } from "../lib/binder-catalog";
import { catalogArtwork } from "../lib/catalog-search";
import { binderViewForUrl } from "../lib/view-routes";

const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => node<HTMLInputElement>(id);
const select = (id: string) => node<HTMLSelectElement>(id);
const dialog = (id: string) => node<HTMLDialogElement>(id);
const base = "/utilities/pokedex-binder/catalog/master-sets/";
async function json<T>(file: string): Promise<T> {
  const response = await fetch(base + encodeURIComponent(file) + ".json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Set catalog could not load. Try again.");
  return response.json();
}
export interface MasterOptions {
  openPrinting(target: PricingTarget): void;
  bindersChanged(): void;
  binderChanged(): void;
  guestEditSaved(): void;
  /** Asks before a destructive action. The dialog also offers a backup download. */
  confirm(title: string, text: string, label: string, tone?: "danger"): Promise<boolean>;
  /** Called after the open binder was deleted, so focus can move somewhere useful. */
  deleted(): void;
}
export function createMasterUI(store: MasterStore, openScan: (target: SetScan) => void, scannerClose: () => void,
  view: { checklist: boolean }, renderNationalView: () => void, setInfo: Record<string, { symbol?: string }>,
  pricing: MasterOptions) {
  let scope = "guest",
    online = false,
    state = emptyMaster(),
    id = "",
    page = 1,
    editing: string | null = null,
    renderVersion = 0,
    started = false,
    ready = false;
  let readVersion = 0,
    hasDex = false,
    dexCounts = { owned: 0, ordered: 0, total: 0 },
    onboarding: "pending" | "device" | "account" = "pending",
    accountVersion = 0;
  let sets: SetSummary[] = [];
  const cache = new Map<string, SetCard[]>(),
    pending = new Map<string, Promise<SetCard[]>>();
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pokedex-set-binders") : null;
  let selectedKey = "";
  // The Binders tab is either the home list of binders or one open binder ("" is the National Pokédex).
  let showing: "home" | "binder" = "home", displayedId: string | null = null;
  let sectionSetId = "", sectionLayout: SectionPlacement[] = [];
  const searchInput = input("master-search"), statusSelect = select("master-status");
  const finishSelect = select("master-checklist-finish");
  const checklist = binderChecklist("master-", statusSelect, () => void render().catch(report));
  const drawPages = binderPages("master-", n => { page = n; selectedKey = ""; void render().catch(report); });
  const showFilterCount = filterControl("master-", [statusSelect]);
  const bulkMessage = node("master-bulk-message");
  const bulkSelection = setBulkSelection(dialog("master-bulk-dialog"), bulkMessage);
  const selectSet = node<HTMLButtonElement>("master-select-set");
  const selectPage = node<HTMLButtonElement>("master-select-page");
  const active = () => state.binders.find((b) => b.id === id);
  const label = (s: SetSummary) => s.name + " (" + (s.code || s.id) + ")";
  function chosenSet() {
    const query = input("master-set").value.trim().toLowerCase();
    if (!query) return;
    const exact = sets.find((s) => label(s).toLowerCase() === query || s.id.toLowerCase() === query);
    if (exact) return exact;
    const matches = sets.filter((s) => s.name.toLowerCase() === query || s.code.toLowerCase() === query);
    return matches.length === 1 ? matches[0] : undefined;
  }
  let suggestedName = "";
  function suggestBinderName() {
    const name = input("master-name"), set = chosenSet();
    if (!set || (name.value.trim() && name.value !== suggestedName)) return;
    suggestedName = set.name;
    name.value = set.name;
  }
  const report = (error: unknown) => {
    node("master-message").textContent = error instanceof Error ? error.message : "Set binder action failed.";
  };
  const listen = (name: string, event: string, fn: () => unknown) =>
    node(name).addEventListener(event, () => {
      Promise.resolve().then(fn).catch(report);
    });
  function cards(setId: string) {
    if (cache.has(setId)) return Promise.resolve(cache.get(setId)!);
    if (!pending.has(setId))
      pending.set(
        setId,
        json<SetCard[]>(setId)
          .then((items) => {
            cache.set(setId, items);
            return items;
          })
          .finally(() => pending.delete(setId)),
      );
    return pending.get(setId)!;
  }
  const cachedBinderCards = (binder: SetBinder) => binderCards(binder, setId => cache.get(setId) ?? []);
  const binderCardsReady = (binder: SetBinder) => binderSetIds(binder).every(setId => cache.has(setId));
  const loadChecklist = (binder: SetBinder) => loadBinderCards(binder, cards);
  let timer: ReturnType<typeof setTimeout>;
  function schedule(delay = 350) {
    clearTimeout(timer);
    if (online) timer = setTimeout(() => void sync().catch(report), delay);
  }
  async function sync() {
    const target = scope,
      version = accountVersion;
    if (!online || scope === "guest") return;
    const current = () => target === scope && version === accountVersion && online;
    await store.sync(target, createAccountClient(target), current);
    if (!current()) return;
    await refresh();
    const saved = await store.read(target);
    if (current() && !saved.conflict && !sameSave(saved.state, saved.baseline)) schedule();
    channel?.postMessage(target);
  }
  let pendingEdits = 0;
  function waitForLocalSave(event: BeforeUnloadEvent) {
    event.preventDefault();
    event.returnValue = true;
  }
  async function change(fn: (doc: MasterState) => void) {
    const target = scope;
    const generation = accountVersion;
    let changed = false;
    if (++pendingEdits === 1) window.addEventListener("beforeunload", waitForLocalSave);
    try {
      await store.update(target, (save) => {
        const before = target === "guest" ? structuredClone(save.state) : null;
        fn(save.state);
        changed = before !== null && !sameSave(before, save.state);
      });
      if (changed && generation === accountVersion) pricing.guestEditSaved();
    } finally {
      if (--pendingEdits === 0) window.removeEventListener("beforeunload", waitForLocalSave);
    }
    if (target === scope) {
      await refresh();
      schedule();
    }
    channel?.postMessage(target);
  }
  function edit(fn: (b: SetBinder) => void) {
    const binderId = id;
    return change((doc) => {
      const b = doc.binders.find((b) => b.id === binderId);
      if (!b) throw new Error("Reopen the set binder.");
      fn(b);
    });
  }
  async function refresh() {
    const ticket = ++readVersion,
      target = scope,
      save = await store.read(target);
    if (ticket !== readVersion || target !== scope) return;
    const changed = !sameSave(state, save.state);
    state = save.state;
    if (changed) pricing.bindersChanged();
    if (editing && dialog("master-editor").open && !state.binders.some((b) => b.id === editing))
      node("master-form-error").textContent = "This binder was deleted. Close these settings to continue.";
    ready = true;
    node("master-conflict").hidden = !save.conflict;
    node("master-message").textContent =
      target === "guest"
        ? ""
        : !online || save.flight || !sameSave(save.state, save.baseline)
          ? "Set binders saved on this device · Waiting to sync"
          : "Set binders synced";
    if (save.conflict) {
      const deleted = conflictInvolvesDelete(save);
      node("master-message").textContent = deleted
        ? "A binder was deleted on one device and changed on another. Keep the changed binder to bring it back; you can delete it again afterwards."
        : "Two devices changed the same binder. Review the copies by keeping both.";
      node("master-conflict").textContent = deleted ? "Keep the changed binder" : "Keep both versions of conflicting set binders";
    }
    await render();
  }
  function progress(b: SetBinder) {
    const pockets = setPockets(b, cachedBinderCards(b)),
      all = pockets.filter(isCardPocket),
      required = all.filter((s) => s.required);
    return { pockets, all, required, owned: required.filter(s => s.owned).length, ordered: required.filter(s => s.ordered).length };
  }
  function openBulkSelection(pageNumber: number | null) {
    const binder = active();
    if (!binder || !binderCardsReady(binder)) return;
    const target = scope, binderId = binder.id;
    const current = () => scope === target && showing === "binder" && id === binderId
      && (pageNumber === null || (page === pageNumber && !node("master-binder-view").hidden));
    if (!current()) return;
    const eligible = (b: SetBinder) => setSlots(b, cachedBinderCards(b))
      .filter(slot => pageNumber === null ? slot.required : slot.page === pageNumber);
    const slots = eligible(binder);
    const expected = slots.map(slot => slot.key).sort();
    const cards = slots.filter(slot => !slot.owned).map(slot => ({
      key: slot.key,
      label: [
        slot.number && "#" + slot.number, slot.name, slot.finish,
        slot.sourceSetId && sets.find(set => set.id === slot.sourceSetId)?.name,
        !slot.required && "Optional", slot.ordered && "Ordered",
      ].filter(Boolean).join(" · "),
    }));
    const description = pageNumber === null ? "Whole set · Required cards" : `Page ${pageNumber}`;
    const restorePageFocus = () => {
      if (!current()) return;
      (selectPage.disabled ? node("master-page-heading") : selectPage).focus({ preventScroll: true });
    };
    bulkMessage.textContent = "";
    bulkSelection.open(`${binder.name} · ${description}`, cards, async keys => {
      const selection = new Set(keys);
      let marked = 0;
      await edit(b => {
        if (!current() || !binderCardsReady(b)) throw new Error("The binder changed. Reopen card selection.");
        const latest = eligible(b);
        if (!sameSave(expected, latest.map(slot => slot.key).sort())) {
          throw new Error("The binder layout or checklist changed. Reopen card selection.");
        }
        const pending = latest.filter(slot => !slot.owned && selection.has(slot.key)).map(slot => slot.key);
        setSlotsStatus(b, pending, "owned");
        marked = pending.length;
      });
      if (!current()) return;
      return marked
        ? `Marked ${marked} ${marked === 1 ? "card" : "cards"} collected.`
        : "The selected cards are already collected.";
    }, pageNumber === null ? undefined : restorePageFocus);
  }
  function clearFilters() {
    searchInput.value = "";
    statusSelect.value = "all";
    finishSelect.value = "";
    checklist.resetLimit();
  }
  function updateFinishes(finishes: string[]) {
    const current = finishSelect.value;
    const options = finishSelect.options;
    if (options.length === finishes.length + 1 && finishes.every((finish, i) => options[i + 1].value === finish)) return;
    finishSelect.replaceChildren(new Option("All finishes", ""), ...finishes.map(finish => new Option(finish)));
    finishSelect.value = finishes.includes(current) ? current : "";
  }
  function renderHome(ticket: number) {
    const overviewRows: OverviewBinder[] = hasDex ? [{
      kind: "national", id: "national", name: "National Pokédex", setName: "", goal: "numbers",
      progress: { status: "ready", owned: dexCounts.owned, ordered: dexCounts.ordered, required: dexCounts.total },
    }] : [];
    let framePending = false;
    function scheduleOverviewUpdate() {
      if (framePending) return;
      framePending = true;
      requestAnimationFrame(() => {
        framePending = false;
        if (ticket === renderVersion) renderSetOverview(overviewRows);
      });
    }
    for (const b of state.binders) {
      const set = sets.find(s => s.id === b.setId);
      const row: OverviewBinder = {
        kind: "set", id: b.id, name: b.name, setName: set?.name ?? b.setId, code: set?.code,
        symbol: setInfo[b.setId]?.symbol, goal: b.goal, progress: { status: "loading" },
      };
      overviewRows.push(row);
      {
        if (!b.owned.length) row.value = valueBinder(b);
        else {
          const ids = binderSetIds(b).filter(id => id === b.setId || b.owned.some(key => key.startsWith(id + "/")));
          void Promise.all(ids.map(async id => [id, await marketPrices(id).catch(() => undefined)] as const)).then(values => {
            if (ticket !== renderVersion) return;
            const markets = new Map(values);
            row.value = valueBinder(b, markets.get(b.setId), markets);
            scheduleOverviewUpdate();
          });
        }
      }
      const updateProgress = () => {
        const { owned, ordered, required } = progress(b);
        row.progress = { status: "ready", owned, ordered, required: required.length };
      };
      if (binderCardsReady(b)) updateProgress();
      else {
        void loadChecklist(b).then(() => {
          if (ticket !== renderVersion) return;
          updateProgress();
          scheduleOverviewUpdate();
        }).catch(() => {
          if (ticket !== renderVersion) return;
          row.progress = { status: "error" };
          scheduleOverviewUpdate();
        });
      }
    }
    renderSetOverview(overviewRows);
  }
  async function render() {
    const ticket = ++renderVersion;
    // An open binder that no longer exists shows the home list instead.
    const b = showing === "binder" && id ? active() : undefined;
    const showDex = showing === "binder" && !id && hasDex;
    const shownId = b ? b.id : showDex ? "" : null;
    if (shownId !== displayedId) {
      displayedId = shownId;
      pricing.binderChanged();
      bulkSelection.close();
      bulkMessage.textContent = "";
      page = 1;
      selectedKey = "";
      checklist.resetSelection();
      clearFilters();
      scannerClose();
    }
    const hasBinders = hasDex || state.binders.length > 0;
    const atHome = ready && hasBinders && shownId === null;
    if (atHome) renderHome(ticket);
    node("set-overview").hidden = !atHome;
    node("binder-back").hidden = shownId === null;
    node("binder-share-open").hidden = shownId === null;
    node("binder-share-menu").hidden = shownId === null;
    node("binder-onboarding").hidden = !ready || hasBinders || onboarding !== "device";
    node("binder-account-onboarding").hidden = !ready || hasBinders || onboarding !== "account";
    node("missing-list-controls").hidden = !ready || shownId === null;
    node("national-add").hidden = hasDex;
    node("export-cards").hidden = !state.binders.length;
    const national = node("national-workspace");
    const openingNational = showDex && national.hidden;
    national.hidden = !showDex;
    node("master-workspace").hidden = !b;
    // The page's one h1 is the open binder's name, or the utility's name on the home list.
    node("home-title").hidden = shownId !== null;
    node("national-title").hidden = !showDex;
    node("master-title").hidden = !b;
    if (!b) node("master-set-label").hidden = true;
    // Menu actions for the open binder. Home scans into the National Pokédex when there is one.
    node("layout-open").hidden = !showDex;
    node("scan-open").hidden = !(hasDex && (showDex || shownId === null));
    node("master-settings").hidden = !b;
    node("master-add-extra").hidden = !b;
    node("master-scan").hidden = !b;
    node<HTMLButtonElement>("master-scan").disabled = !!b && !binderCardsReady(b);
    selectSet.hidden = !b;
    showFilterCount();
    if (!b) {
      if (openingNational) renderNationalView();
      return;
    }
    if (!binderCardsReady(b)) {
      selectSet.disabled = true;
      node("master-title").textContent = b.name;
      node("master-binder-grid").replaceChildren();
      node("master-workspace").hidden = true;
      try {
        await loadChecklist(b);
      } catch {
        if (ticket === renderVersion) {
          showing = "home";
          await render();
          node("master-message").textContent = "Checklist could not load. Open the binder again to retry.";
        }
        return;
      }
      if (ticket !== renderVersion) return;
      node("master-workspace").hidden = false;
      node<HTMLButtonElement>("master-scan").disabled = false;
    }
    const { pockets, all, required, owned, ordered } = progress(b),
      extras = all.filter((s) => !s.required);
    selectSet.disabled = owned === required.length;
    node("master-title").textContent = b.name;
    // The set shows as a label above the name only when the binder is named something else.
    const binderSet = sets.find((s) => s.id === b.setId);
    const setLabel = node("master-set-label");
    setLabel.textContent = [binderSet?.name ?? b.setId, binderSet?.code].filter(Boolean).join(" · ");
    setLabel.hidden = (binderSet?.name ?? b.setId) === b.name;
    node("master-progress").textContent = owned + " / " + required.length;
    node("master-optional").textContent = extras.filter((s) => s.owned).length + " / " + extras.length;
    node("master-percent").textContent =
      (required.length ? ((100 * owned) / required.length).toFixed(1) : "0") + "% complete";
    // Phones show progress as one line beside a thin bar.
    node("master-progress-line").textContent =
      `${owned} of ${required.length} · ${ordered} ordered · ${(required.length ? (100 * owned) / required.length : 0).toFixed(1)}%`;
    const bar = node<HTMLProgressElement>("master-bar");
    bar.max = required.length || 1;
    bar.value = owned;
    const missingFinishes =
      b.goal === "variants" ? b.owned.filter(k => k.endsWith(":*") && (b.settings.includeRelated || !k.includes("/"))
        && !all.some(s => s.key === k)) : [];
    if (missingFinishes.length)
      node("master-message").textContent =
        "Choose the finish for " +
        missingFinishes.map((k) => "#" + k.slice(0, -2)).join(", ") +
        ". Your earlier number marks are saved.";
    node("master-owned").textContent = String(owned);
    node("master-ordered").textContent = String(ordered);
    node("master-missing").textContent = String(required.length - owned - ordered);
    const set = sets.find(s => s.id === b.setId);
    const sourceSet = (slot: typeof all[number]) => slot.sourceSetId ? sets.find(s => s.id === slot.sourceSetId) : set;
    const artwork = (slot: typeof all[number]) => {
      const source = sourceSet(slot);
      return source && slot.category !== "Extra" ? catalogArtwork(source, slot.number) : null;
    };
    const search = searchInput.value.trim().toLowerCase().replace(/^#/, "");
    const status = statusSelect.value;
    const matches = (s: typeof all[number]) => (status === "all" || status === s.status) &&
      [s.name,s.number,s.finish,sourceSet(s)?.name ?? ""].some(value => value.toLowerCase().includes(search));
    const filtered = all.filter(matches);
    const count = Math.max(1,pockets.at(-1)?.page ?? 1);
    page = Math.min(count, Math.max(1,page));
    selectPage.disabled = !all.some(slot => slot.page === page && !slot.owned);
    const selected = all.find(s => s.key === selectedKey);
    const place = (s: typeof all[number]) => `Page ${s.page} · Row ${s.row} · Column ${s.column}`;
    const finishLabel = (s: typeof all[number]) => [s.finish, s.sourceSetId && sourceSet(s)?.name, !s.required && "Optional"].filter(Boolean).join(" · ");
    const identity = (s: typeof all[number]) => [s.number && "#" + s.number,s.name,finishLabel(s)].filter(Boolean).join(" · ");
    const jump = (s: typeof all[number]) => `<button data-set-jump="${escape(s.key)}" aria-label="View page for ${escape(identity(s))}">View page</button>`;
    const image = (s: typeof all[number]) => artwork(s) ? `<img loading="lazy" alt="" src="${escape(artwork(s))}">` : "";
    const results = node("master-results");
    const listView = view.checklist;
    results.hidden = listView || (!search && status !== "ordered");
    results.innerHTML = results.hidden ? "" : `<p class="dex-label" role="status">${filtered.length ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}` : "No cards match. Try a name, collector number or finish."}</p><ol class="dex-result-list set-results">${filtered.map(s =>
      `<li class="dex-result"><span class="dex-result-number">${escape(s.number ? "#" + s.number : "")}</span><strong class="dex-result-name">${escape(s.name)}</strong><span class="dex-result-finish">${escape(finishLabel(s))}</span><span class="dex-result-place">${place(s)}</span>${jump(s)}</li>`).join("")}</ol>`;
    // While a search is active its results replace the page grid.
    node("master-binder-view").hidden = listView || !!search;
    node("master-checklist").hidden = !listView;
    node("master-view-checklist").setAttribute("aria-pressed",String(listView));
    node("master-view-binder").setAttribute("aria-pressed",String(!listView));
    const focused = document.activeElement?.id;
    if (listView) {
      node("master-binder-grid").replaceChildren();
      updateFinishes([...new Set(all.map(slot => slot.finish))].sort());
      const finish = finishSelect.value;
      const rows = finish ? filtered.filter(slot => slot.finish === finish) : filtered;
      node("master-checklist-clear-filters").hidden = !searchInput.value && status === "all" && !finish;
      checklist.render(sortSetChecklist(rows, checklist.sort.value as SetChecklistSort), slot => ({
        ...slot, number: slot.number && "#" + slot.number, image: artwork(slot), actionLabel: identity(slot),
        detail: finishLabel(slot),
      }));
    } else {
      node("master-list").replaceChildren();
      const counts = new Map<number,{total:number;owned:number}>();
      for (const slot of required) {
        const data = counts.get(slot.page) ?? {total:0,owned:0};
        data.total++; if (slot.owned) data.owned++; counts.set(slot.page,data);
      }
      const positions = new Map(pockets.filter(p => p.page === page).map(p => [p.pocket,p]));
      const capacity = b.settings.rows * b.settings.columns;
      const cells = Array.from({length:capacity},(_,i) => {
        const p = positions.get(i+1);
        if (!p) return blankPocket(i+1, (page-1)*capacity+i < b.settings.leadingBlankPockets ? "Reserved" : "Empty pocket");
        if (!isCardPocket(p)) return "filler" in p ? blankPocket(i+1,"Filler after #" + p.number,true)
          : blankPocket(i+1,"Blank before next section");
        return cardPocket({set:true,id:p.key,number:p.number && "#" + p.number,name:p.name,finish:finishLabel(p),
          owned:p.owned,ordered:p.ordered,selected:p.key === selectedKey,dimmed:!matches(p),row:p.row,column:p.column,image:artwork(p)});
      });
      drawPages(page,count,b.settings,counts,cells);
      const optional = extras.filter(s => s.page === page);
      if (optional.length) node("master-page-progress").append(` · Optional extras ${optional.filter(s=>s.owned).length}/${optional.length}`);
    }
    const detail = node("master-pokemon-details");
    detail.hidden = !selected || listView;
    node("master-binder-view").classList.toggle("has-details", !detail.hidden);
    detail.innerHTML = detail.hidden || !selected ? "" : `<div class="dex-detail-hero">${image(selected)}<div><p class="dex-eyebrow">${escape(sourceSet(selected)?.code || selected.sourceSetId || b.setId)} · ${escape(selected.number)}</p><h2>${escape(selected.name)}</h2><p>${escape(finishLabel(selected))}</p></div><button type="button" class="dex-details-close" data-close-details aria-label="Close details for ${escape(identity(selected))}">×</button></div>
      <div class="dex-detail-body"><div class="dex-location">${[["Page",selected.page],["Row",selected.row],["Column",selected.column],["Sheet",selected.sheet + " · " + (selected.side === "back" ? "Back" : "Front")]].map(([label,value])=>`<div><span class="dex-label">${label}</span><strong>${value}</strong></div>`).join("")}</div>
      ${statusControl(selected.key, selected.status, identity(selected), true)}
      ${selected.category === "Extra" ? "" : '<div class="dex-actions"><button id="set-card-prices" type="button" aria-haspopup="dialog">Prices and offers</button></div>'}</div>`;
    if (focused && document.activeElement === document.body) document.getElementById(focused)?.focus({preventScroll:true});
  }
  async function specialties() {
    const set = chosenSet(),
      region = node("master-specialties");
    region.replaceChildren();
    if (!set) return;
    const all = await cards(set.id);
    if (chosenSet()?.id !== set.id) return;
    const selected = new Set(state.binders.find((b) => b.id === editing)?.specialties);
    const variants = new Map<string, { label: string; cards: SetCard[] }>();
    for (const c of all)
      for (const v of c.variants) {
        if (!v.specialty) continue;
        const group = variants.get(v.id) ?? { label: v.label, cards: [] };
        group.cards.push(c);
        variants.set(v.id, group);
      }
    for (const [key, group] of variants) {
      const section = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = group.label + " (" + group.cards.length + ")";
      section.append(summary);
      const add = (value: string, text: string, checked: boolean) => {
        const row = document.createElement("label"),
          box = document.createElement("input");
        box.type = "checkbox";
        box.value = value;
        box.checked = checked;
        row.append(box, document.createTextNode(text));
        section.append(row);
        return box;
      };
      const bulk = add(key, "All cards with this printing", selected.has(key));
      const children = group.cards.map((c) =>
        add(
          c.number + ":" + key,
          "#" + c.number + " " + c.name,
          selected.has(key) || selected.has(c.number + ":" + key),
        ),
      );
      bulk.onchange = () => {
        for (const child of children) child.checked = bulk.checked;
      };
      const update = () => {
        bulk.checked = children.every((box) => box.checked);
        bulk.indeterminate = !bulk.checked && children.some((box) => box.checked);
      };
      for (const child of children) child.onchange = update;
      update();
      region.append(section);
    }
    if (!variants.size) region.textContent = "No specialty printings are documented for this set.";
  }
  function showFillerCutoff() {
    const enabled = input("master-fillers").checked;
    node("master-filler-options").hidden = !enabled;
    input("master-filler-through").disabled = !enabled;
  }
  function showRelatedOption() {
    const set = chosenSet();
    const related = set ? relatedSets(set.id) : [];
    node("master-related-option").hidden = !related.length;
    const count = (set?.count ?? 0) + related.reduce((total, entry) =>
      total + (entry.numbers?.length ?? sets.find(s => s.id === entry.setId)?.count ?? 0), 0);
    node("master-related-label").textContent = `Include the full checklist (${count} distinct cards)`;
    if (set && sectionSetId !== set.id) {
      sectionSetId = set.id;
      sectionLayout = binderSectionLayout(set.id);
      input("master-related").checked = false;
    }
    renderSectionLayout();
  }
  function renderSectionLayout(focusId?: string, direction?: number) {
    const set = chosenSet();
    const fieldset = node("master-section-layout");
    fieldset.hidden = !set || !relatedSets(set.id).length || !input("master-related").checked;
    const list = node("master-section-order");
    list.replaceChildren();
    if (fieldset.hidden) return;
    const extras = state.binders.find(b => b.id === editing)?.extras.length;
    const visible = sectionLayout.filter(section => section.id !== extraSectionId || extras);
    visible.forEach((section, index) => {
      const name = section.id === extraSectionId ? "Custom extras" : sets.find(item => item.id === section.id)?.name ?? section.id;
      const row = document.createElement("li"), heading = document.createElement("strong");
      heading.textContent = name;
      const actions = document.createElement("div");
      actions.className = "dex-section-move";
      for (const step of [-1, 1]) {
        const target = visible[index + step];
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = step === -1 ? "↑" : "↓";
        button.title = `Move ${name} ${step === -1 ? "up" : "down"}`;
        button.setAttribute("aria-label", button.title);
        button.disabled = !target;
        button.onclick = () => {
          if (!target) return;
          const from = sectionLayout.indexOf(section), to = sectionLayout.indexOf(target);
          [sectionLayout[from], sectionLayout[to]] = [sectionLayout[to], sectionLayout[from]];
          renderSectionLayout(section.id, step);
          scheduleSummary();
        };
        actions.append(button);
      }
      const label = document.createElement("label"), box = document.createElement("input");
      label.className = "dex-dialog-checkbox";
      box.type = "checkbox";
      box.checked = section.newPage === true;
      box.setAttribute("aria-label", `Start ${name} on a fresh page`);
      box.onchange = () => {
        if (box.checked) section.newPage = true;
        else delete section.newPage;
      };
      label.append(box, "Start on a fresh page");
      row.append(heading, actions, label);
      list.append(row);
      if (section.id === focusId) {
        const preferred = actions.children[direction === -1 ? 0 : 1] as HTMLButtonElement;
        (preferred.disabled ? actions.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? box : preferred)
          .focus({ preventScroll: true });
      }
    });
  }
  async function openEditor(b?: SetBinder) {
    if (!sets.length) sets = await json("index");
    const options = sets.map((s) => new Option(label(s)));
    node("master-catalog").replaceChildren(...options);
    editing = b?.id ?? null;
    const model = b ?? newBinder("", "");
    node("master-editor-title").textContent = b ? "Binder settings" : "New set binder";
    const set = sets.find((s) => s.id === b?.setId);
    input("master-set").value = set ? label(set) : "";
    input("master-set").disabled = !!b;
    input("master-related").checked = model.settings.includeRelated === true;
    sectionSetId = model.setId;
    sectionLayout = binderSectionLayout(model.setId, model.settings.sectionLayout).map(section => ({ ...section }));
    showRelatedOption();
    input("master-name").value = model.name;
    suggestedName = "";
    select("master-goal").value = model.goal;
    select("master-order").value = model.order;
    input("master-fillers").checked = model.settings.fillerThrough !== undefined;
    input("master-filler-through").value = String(model.settings.fillerThrough ?? set?.printedTotal ?? "");
    showFillerCutoff();
    input("master-columns").value = String(model.settings.columns);
    input("master-rows").value = String(model.settings.rows);
    input("master-blanks").value = String(model.settings.leadingBlankPockets);
    input("master-backs").checked = model.settings.useBackSides;
    node("master-specialty-section").hidden = model.goal === "numbers";
    node("master-extra-options").hidden = !model.extras.length;
    const extras = node("master-extra-options-list");
    extras.replaceChildren();
    for (const e of model.extras) {
      const label = document.createElement("label"),
        box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.extra = e.id;
      box.checked = e.required;
      label.append(box, document.createTextNode("Count " + e.name + " toward completion"));
      extras.append(label);
    }
    node("master-form-error").textContent = "";
    node("master-delete-section").hidden = !b;
    await specialties();
    void updateSummary();
    dialog("master-editor").showModal();
    input(b ? "master-name" : "master-set").focus({ preventScroll: true });
  }
  /** Reads the binder form. Throws when a page setting is out of range. */
  function readForm(set: SetSummary) {
    const settings: SetBinder["settings"] = validateSettings({
      columns: +input("master-columns").value,
      rows: +input("master-rows").value,
      leadingBlankPockets: +input("master-blanks").value,
      useBackSides: input("master-backs").checked,
    });
    if (input("master-fillers").checked) settings.fillerThrough = input("master-filler-through").valueAsNumber;
    if (input("master-related").checked && relatedSets(set.id).length) settings.includeRelated = true;
    if (relatedSets(set.id).length && !sameSave(sectionLayout, binderSectionLayout(set.id))) {
      settings.sectionLayout = sectionLayout.map(section => ({ ...section }));
    }
    const spec = Array.from(node("master-specialties").querySelectorAll("details")).flatMap((group) => {
      const [bulk, ...individual] = group.querySelectorAll<HTMLInputElement>("input");
      return bulk.checked ? [bulk.value] : individual.filter((box) => box.checked).map((box) => box.value);
    });
    return {
      name: input("master-name").value.trim(), settings, specialties: spec,
      goal: select("master-goal").value as SetBinder["goal"], order: select("master-order").value as SetBinder["order"],
    };
  }
  // A live summary of what the form would build: cards, pages and sheets.
  let summaryTicket = 0, summaryTimer: ReturnType<typeof setTimeout> | undefined;
  const count = (value: number) => value.toLocaleString("en-CA");
  async function updateSummary() {
    const ticket = ++summaryTicket, summary = node("master-summary");
    const set = chosenSet();
    if (!set) { summary.textContent = "Choose a set to see how many cards, pages and sheets this binder needs."; return; }
    let draft: SetBinder;
    try {
      const form = readForm(set), existing = state.binders.find((b) => b.id === editing);
      draft = { ...newBinder(set.id, form.name), ...form, extras: existing?.extras ?? [] };
      if (form.settings.fillerThrough !== undefined && !(form.settings.fillerThrough >= 1)) throw new Error("Filler cutoff");
    } catch {
      summary.textContent = "Enter page settings within their ranges to see the result.";
      return;
    }
    try { await loadBinderCards(draft, cards); } catch {
      if (ticket === summaryTicket) summary.textContent = "The set checklist could not load, so the size is unknown.";
      return;
    }
    if (ticket !== summaryTicket) return;
    const pockets = setPockets(draft, binderCards(draft, (setId) => cache.get(setId) ?? []));
    const pages = Math.max(1, pockets.at(-1)?.page ?? 1), sheets = draft.settings.useBackSides ? Math.ceil(pages / 2) : pages;
    const total = pockets.filter(isCardPocket).length;
    summary.textContent = `${count(total)} ${total === 1 ? "card" : "cards"} · ${count(pages)} ${pages === 1 ? "page" : "pages"} · ${count(sheets)} ${sheets === 1 ? "sheet" : "sheets"}`;
  }
  function scheduleSummary() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => void updateSummary(), 150);
  }
  node("master-form").addEventListener("input", scheduleSummary);
  node("master-form").addEventListener("change", scheduleSummary);
  async function saveForm() {
    const set = chosenSet();
    if (!set) throw new Error("Choose a set from the catalog list.");
    const existing = editing;
    const binderId = existing ?? crypto.randomUUID();
    const { name, settings, specialties: spec, goal, order } = readForm(set);
    await change((doc) => {
      let b = doc.binders.find((v) => v.id === binderId);
      if (!b) {
        // Never bring back a binder that was deleted while its settings were open.
        if (existing) throw new Error("This binder was deleted. Close these settings to continue.");
        b = { ...newBinder(set.id, name), id: binderId };
        doc.binders.push(b);
      }
      Object.assign(b, { name, settings, goal, order, specialties: spec });
      for (const box of node("master-extra-options-list").querySelectorAll<HTMLInputElement>("input")) {
        const e = b.extras.find((e) => e.id === box.dataset.extra);
        if (e) e.required = box.checked;
      }
    });
    if (existing && showing === "binder" && id === binderId) await render();
    else await openBinder(binderId);
    dialog("master-editor").close();
  }
  node("master-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveForm().catch((e) => {
      node("master-form-error").textContent = e.message;
    });
  });
  async function deleteBinder() {
    const binderId = editing, target = scope, generation = accountVersion;
    const b = state.binders.find((binder) => binder.id === binderId);
    if (!binderId || !b) throw new Error("This binder was already deleted.");
    const marks = b.owned.length + (b.ordered?.length ?? 0);
    const confirmed = await pricing.confirm(`Delete “${b.name}”?`,
      `This removes the binder${marks ? ` and its ${marks} card ${marks === 1 ? "mark" : "marks"}` : ""} from this device`
        + (target === "guest" ? ". " : " and your account. Your account keeps a recovery copy. ")
        + "Download a backup first if you might want it back.",
      "Delete binder", "danger");
    if (!confirmed) {
      input("master-name").focus({ preventScroll: true });
      return;
    }
    if (target !== scope || editing !== binderId) throw new Error("The binder changed. Open its settings again.");
    if (++pendingEdits === 1) window.addEventListener("beforeunload", waitForLocalSave);
    try {
      await store.remove(target, binderId);
      if (target === "guest" && generation === accountVersion) pricing.guestEditSaved();
    } finally {
      if (--pendingEdits === 0) window.removeEventListener("beforeunload", waitForLocalSave);
    }
    editing = null;
    dialog("master-editor").close();
    if (showing === "binder" && id === binderId) goHome();
    if (target === scope) {
      await refresh();
      schedule();
    }
    channel?.postMessage(target);
    node("master-message").textContent = `Deleted “${b.name}”.`;
    pricing.deleted();
  }
  node("master-delete").addEventListener("click", () => {
    node("master-form-error").textContent = "";
    void deleteBinder().catch((e) => { node("master-form-error").textContent = e instanceof Error ? e.message : "The binder could not be deleted."; });
  });
  listen("master-new", "click", () => openEditor());
  listen("first-set", "click", () => openEditor());
  listen("master-settings", "click", () => openEditor(active()));
  listen("master-fillers", "change", showFillerCutoff);
  listen("master-related", "change", () => renderSectionLayout());
  listen("master-set", "input", () => {
    showRelatedOption();
    suggestBinderName();
    input("master-filler-through").value = String(chosenSet()?.printedTotal ?? "");
    return specialties();
  });
  listen("master-goal", "change", () => {
    node("master-specialty-section").hidden = select("master-goal").value === "numbers";
  });
  // Which binder is open lives in history.state, never in the URL, so Back and reload return to it.
  function remember(binderId: string | null) {
    try { history.pushState(binderId === null ? null : { binder: binderId }, "", location.href); } catch { /* History is optional. */ }
  }
  function openBinder(binderId: string, push = true) {
    if (push && !(showing === "binder" && id === binderId)) remember(binderId);
    showing = "binder";
    id = binderId;
    node("master-message").textContent = "";
    return render();
  }
  function goHome(push = true) {
    if (push && showing !== "home") remember(null);
    showing = "home";
    scannerClose();
    return render();
  }
  function fromHistory() {
    const binder = (history.state as { binder?: unknown } | null)?.binder;
    if (typeof binder === "string") { showing = "binder"; id = binder; }
    else showing = "home";
    return render();
  }
  window.addEventListener("popstate", () => {
    if (binderViewForUrl(new URL(location.href)) === "binders") void fromHistory().catch(report);
  });
  node("binder-back").addEventListener("click", () => {
    void goHome().then(() => node("set-overview-title").focus()).catch(report);
  });
  listen("set-overview-retry", "click", render);
  node("set-overview").addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-overview-binder]");
    const target = button?.dataset.overviewBinder;
    const binderId = target === "national" ? "" : target;
    if (binderId === undefined || (binderId && !state.binders.some(b => b.id === binderId))) return;
    void openBinder(binderId).then(() => {
      if (showing === "binder" && id === binderId) node("binder-view-title").focus();
    }).catch(report);
  });
  for (const [name, event] of [
    ["master-search", "input"],
    ["master-status", "change"],
    ["master-checklist-finish", "change"],
  ])
    listen(name, event, () => { checklist.resetLimit(); return render(); });
  listen("master-checklist-clear-filters", "click", () => { clearFilters(); finishSelect.focus(); return render(); });
  listen("master-view-checklist", "click", () => { view.checklist = true; return render(); });
  listen("master-view-binder", "click", () => { view.checklist = false; return render(); });
  listen("master-select-set", "click", () => openBulkSelection(null));
  listen("master-select-page", "click", () => openBulkSelection(page));
  node("master-workspace").addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement) event.target.hidden = true;
  },true);
  node("master-workspace").addEventListener("click", async event => {
    const element = event.target as Element;
    if (element.closest("#set-card-prices")) {
      const binder = active();
      const printing = binder && progress(binder).all.find(slot => slot.key === selectedKey);
      const set = sets.find(item => item.id === (printing?.sourceSetId ?? binder?.setId));
      if (set && printing && printing.category !== "Extra") pricing.openPrinting({
        setId: set.id, setName: set.name, number: printing.number, name: printing.name, finish: printing.finish,
        variant: printing.key.slice(printing.key.indexOf(":") + 1),
      });
      return;
    }
    const btn = (event.target as Element).closest<HTMLElement>("[data-set-open],[data-set-jump]");
    const b = active(); if (!btn || !b) return;
    const slot = progress(b).all.find(s => s.key === (btn.dataset.setOpen ?? btn.dataset.setJump));
    if (!slot) return;
    if (btn.dataset.setOpen && slot.key === selectedKey) { closeDetails(); return; }
    page = slot.page; selectedKey = slot.key; view.checklist = false;
    // Leaving the search shows the page grid again.
    if (btn.dataset.setJump) searchInput.value = "";
    await render();
    if(btn.dataset.setJump) document.getElementById("set-open-grid-"+slot.key)?.focus();
    else showDetailsSheet(node("master-pokemon-details"), "set-open-grid-" + slot.key);
  });
  function closeDetails() {
    if (!selectedKey || node("master-pokemon-details").hidden) return false;
    const key = selectedKey;
    selectedKey = "";
    void render().then(() => document.getElementById("set-open-grid-" + key)?.focus({ preventScroll: true })).catch(report);
    return true;
  }
  node("master-workspace").addEventListener("change", (event) => {
    const box = event.target as HTMLInputElement;
    const statusKey = box.dataset.setStatus;
    if (statusKey) {
      if (box.checked) void edit((b) => setSlotStatus(b, statusKey, box.value as CardStatus)).catch(error => { report(error); void render(); });
      return;
    }
    const key = box.dataset.key;
    if (!key) return;
    const checked = box.checked;
    void edit((b) => markSlot(b, key, checked)).catch((e) => {
      box.checked = !checked;
      report(e);
    });
  });
  listen("master-add-extra", "click", () => {
    node<HTMLFormElement>("master-extra-form").reset();
    dialog("master-extra-dialog").showModal();
    input("master-extra-name").focus({ preventScroll: true });
  });
  node("master-extra-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void edit((b) =>
      b.extras.push({
        id: crypto.randomUUID(),
        name: input("master-extra-name").value.trim(),
        number: input("master-extra-number").value.trim(),
        required: input("master-extra-required").checked,
      }),
    )
      .then(() => dialog("master-extra-dialog").close())
      .catch(report);
  });
  listen("master-conflict", "click", async () => {
    await store.resolve(scope);
    await refresh();
    schedule();
  });
  listen("master-scan", "click", () => {
    const binderId = id, target = scope;
    const current = () => id === binderId && scope === target ? active() : undefined;
    return openScan({
      printedTotal: sets.find(s => s.id === current()?.setId)?.printedTotal ?? null,
      slots() { const b = current(); return b ? progress(b).all : []; },
      mark(key) {
        if (!current()) throw new Error("Reopen the scanner for this binder.");
        return edit(b => {
          if (!setSlots(b, cachedBinderCards(b)).some(s => s.key === key)) throw new Error("Printing changed.");
          markSlot(b,key,true);
        });
      },
    });
  });
  channel?.addEventListener("message", (e) => {
    if (e.data === scope) void refresh().catch(report);
  });
  window.addEventListener("online", () => schedule(0));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule(0);
  });
  return {
    hasPendingEdits: () => pendingEdits > 0,
    async start() {
      sets = await json("index");
      started = true;
      await refresh();
      schedule(0);
    },
    account(a: BinderAccountState) {
      const next = a.mode === "account" ? (a.boundAccountId ?? "guest") : "guest";
      const available = next !== "guest" && a.user?.id === next && !a.offline && !a.retainedAccount;
      if (scope === next && online === available) return;
      accountVersion++;
      if (scope !== next) {
        scope = next;
        bulkSelection.close();
        bulkMessage.textContent = "";
        renderSetOverview([]);
        // The open binder stays open when the new scope has it (as after connecting an account);
        // otherwise render shows the home list.
        state = emptyMaster();
        ready = false;
        scannerClose();
        for (const name of ["master-editor", "master-extra-dialog"]) dialog(name).close();
        void render().catch(report);
      }
      online = available;
      if (started)
        void refresh()
          .then(() => schedule(0))
          .catch(report);
    },
    dex(enabled: boolean, owned: number, total: number, ordered: number) {
      const counts = { owned, ordered, total };
      if (enabled === hasDex && sameSave(counts, dexCounts)) return;
      const changed = enabled !== hasDex;
      hasDex = enabled;
      dexCounts = counts;
      // The home list shows the National Pokédex's progress, so it redraws when that changes.
      if (changed || !node("set-overview").hidden) void render().catch(report);
    },
    showNational() { return openBinder(""); },
    goHome,
    fromHistory,
    /** The open set binder's id; "" for the National Pokédex or the home list. */
    currentId() { return showing === "binder" && active() ? id : ""; },
    /** Whether a binder (set or National) is open rather than the home list. */
    inBinder() { return showing === "binder" && (id ? !!active() : hasDex); },
    closeDetails,
    onboarding(value: typeof onboarding) {
      if (value === onboarding) return;
      onboarding = value;
      void render().catch(report);
    },
    collection() { return { sets, cards }; },
    applyCollection(fn: (doc: MasterState) => void) { return change(fn); },
    async positionLists(binderId: string | null, status: CardStatus) {
      const version = accountVersion;
      const { state: saved } = await store.read(scope);
      const binders = binderId === null ? saved.binders : saved.binders.filter(b => b.id === binderId);
      if (binderId && !binders.length) throw new Error("The selected binder has changed. Choose it again.");
      const lists = await Promise.all(binders.map(async b => {
        const catalog = await loadChecklist(b);
        const set = sets.find(s => s.id === b.setId);
        const setName = set?.name ?? b.setId;
        const rows = setSlots(b, catalog).filter(slot => slot.status === status).map(slot => {
          if (!b.settings.includeRelated) return slot;
          return { ...slot, setName: slot.sourceSetId ? sets.find(s => s.id === slot.sourceSetId)?.name ?? slot.sourceSetId : setName };
        });
        return { name: b.name, setName, settings: b.settings, rows };
      }));
      if (version !== accountVersion) throw new Error("The account changed. Request the list again.");
      return lists;
    },
    async backup() {
      return (await store.read(scope)).state;
    },
    async checkBackup(next: MasterState) {
      validateMaster(next);
      const index = sets.length ? sets : await json<SetSummary[]>("index");
      for (const b of next.binders) {
        if (!index.some((s) => s.id === b.setId))
          throw new Error("This backup references a set outside the installed catalog.");
        const entries = await loadBinderCards(b, cards, true),
          keys = new Set(b.extras.map((e) => "extra:" + e.id)),
          special = new Set<string>();
        for (const c of entries) {
          const prefix = setCardKey(c) + ":";
          keys.add(prefix + "*");
          for (const v of c.variants) {
            keys.add(prefix + v.id);
            if (v.specialty) {
              special.add(v.id);
              special.add(prefix + v.id);
            }
          }
        }
        if ([...b.owned, ...(b.ordered ?? [])].some((k) => !keys.has(k)) || b.specialties.some((k) => !special.has(k)))
          throw new Error("This backup contains a printing outside the installed checklist.");
      }
    },
    async restored() {
      await refresh();
      schedule();
      channel?.postMessage(scope);
    },
    sync,
    async syncedBinderRevision(accountId: string, binderId: string): Promise<number> {
      if (!online || scope !== accountId) return 0;
      const version = accountVersion;
      await sync();
      const saved = await store.read(accountId);
      if (!online || scope !== accountId || version !== accountVersion || saved.conflict || saved.flight) return 0;
      const binder = saved.state.binders.find(item => item.id === binderId);
      return binder && sameSave(binder, saved.baseline.binders.find(item => item.id === binderId)) ? saved.revision : 0;
    },
    close() {
      clearTimeout(timer);
      online = false;
      channel?.close();
      scannerClose();
    },
  };
}
