import { combinedCsv, nationalCsv, setListCsv, type BinderList } from "../lib/list-export";
import { printLists } from "./print-list";
import { binderPages, blankPocket, cardPocket, showDetailsSheet, statusControl } from "./binder-pages";
import { binderChecklist } from "./binder-checklist";
import { createMasterUI } from "./master-ui";
import { validateMaster } from "../lib/master";
import { cardStatus, defaultState, exportBackup, hasNationalData, nationalEnabled, nationalRows, importBackup, locationFor, pageCount, pageSlots, record, searchSpecies, sameState, type BinderState, type CardStatus, type Species } from "../lib/model";
import { type BinderSnapshot } from "../lib/sync";
import { combineMigrationSources, createUnifiedBinderController, type BinderAccountState, type MigrationPreview } from "../lib/accounts";
import { accountHref } from "../../../../packages/accounts/client";
import { filterChecklist, setLabel, type ChecklistSort } from "../lib/checklist";
import { createCardScanner, type CardScanner, type SetScan } from "./scanner";
import { reportFailure } from "../../../reporting/browser";
import { createTransfers } from "./transfers";
import { createPricingUI } from "./pricing-ui";
import { createBuyCards } from "./buy-cards";
import { binderViews } from "./binder-views";
import { createCatalogSearch } from "./catalog-search";
import { catalogArtwork } from "../lib/catalog-search";
import type { TransferMatch } from "../lib/card-transfer";
import type { ProductIdentity } from "../lib/transfer-identity";

interface SetInfo { id: string; name: string; code: string | null; releaseDate: string | null; symbol?: string }
interface Printing { id: string; name: string; number: string; setId: string; rarity: string | null; image: string | null }
interface Catalog { schemaVersion: number; generatedAt: string; species: Species[]; sets: Record<string, SetInfo>; setSpecies: Record<string, number[]> }
type CollectorNumbers = Record<string, Record<number, string[]>>;
const root = "/utilities/pokedex-binder/";
const el = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error("A binder control is missing. Refresh the page.");
  return node as T;
};
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const dex = (id: number) => `#${String(id).padStart(4, "0")}`;
const sprite = (item: Species, size = 64) => `<img src="${root}sprites/${item.id}.png" width="${size}" height="${size}" loading="lazy" alt="" />`;
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

async function initialize() {
  const navigation = binderViews();
  const response = await fetch(`${root}catalog/index.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error("The Pokémon catalog could not load. Reload to try again; your saved binder is safe.");
  const catalog = await response.json() as Catalog;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.species) || !catalog.species.length) throw new Error("The Pokémon catalog needs updating. Your saved binder is safe.");
  const species = catalog.species;
  for (const count of document.querySelectorAll("[data-species-count]")) count.textContent = species.length.toLocaleString("en-CA");
  const controller = createUnifiedBinderController({ species });
  let account: BinderAccountState = controller.accountState();
  let migrationPreview: MigrationPreview | null = null;
  let snapshot: BinderSnapshot = { state: defaultState(), status: "loading", error: null, storageWarning: null, connected: false, key: null, layoutConflict: null };
  let currentPage = 1, selected: number | null = null, printingQuery = "";
  const view = { checklist: false };
  let loadedPrintings: Printing[] | null = null, detailLoading = false, detailError = false;
  let renderedSpecies: number | null = null;
  let hasRendered = false;
  let collectorNumbers: CollectorNumbers | null = null;
  let numberStatus: "idle" | "loading" | "error" = "idle";
  let scanner: CardScanner | null = null;
  const printingCache = new Map<number, Printing[]>();
  const search = el<HTMLInputElement>("dex-search");
  const filter = el<HTMLSelectElement>("dex-filter");
  const generation = el<HTMLSelectElement>("dex-generation");
  const checklistSet = el<HTMLInputElement>("checklist-set");
  const checklist = binderChecklist("", filter, render);
  el("checklist-sets").innerHTML = Object.values(catalog.sets).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map(set => `<option value="${escape(setLabel(set))}"></option>`).join("");
  const details = el("pokemon-details");
  const syncDialog = el<HTMLDialogElement>("sync-dialog");
  const statusLabels = { loading: "Loading your binder…", local: "Saved locally · Sync is optional", syncing: "Syncing your binder…", synced: "Synced · Saved on this device", pending: "Saved locally · Waiting to sync", error: "Saved locally · Sync needs attention", conflict: "Saved locally · Choose a binder layout" };

  const action = async (run: () => Promise<unknown>, control?: HTMLButtonElement) => {
    if (control) control.disabled = true;
    el("sync-error").textContent = "";
    try { await run(); } catch (error) {
      const message = error instanceof Error ? error.message : "That action could not finish. Your local binder is safe.";
      el("sync-error").textContent = message;
      el("dex-warning").textContent = message;
      el("dex-warning").hidden = false;
    } finally { if (control) control.disabled = false; }
  };
  function download(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const drawPages = binderPages("", page => { currentPage = page; selected = null; render(); });
  function closeNationalDetails() {
    if (selected === null) return false;
    const id = selected;
    selected = null;
    render();
    document.getElementById("open-grid-" + id)?.focus({ preventScroll: true });
    return true;
  }
  const scanDialog = el<HTMLDialogElement>("scan-dialog");
  function closeScanner() { scanner?.close(); }
  function openScanner(target?: SetScan) {
    try {
      scanner ??= createCardScanner({ species, getSnapshot: () => snapshot, markOwned: id => controller.setOwned(id, true) });
      scanner.open(target);
    } catch {
      scanDialog.dataset.phase = "load-error";
      el("scan-status").textContent = "The scanner could not open. Reload the binder to try again.";
      if (!scanDialog.open) scanDialog.showModal();
      reportFailure(new Error("Scanner window could not open"), "binder.scanner.open", { binder: target ? "set" : "national" });
    }
  }
  const master = createMasterUI(controller.masters, openScanner, closeScanner, view, renderNationalView, catalog.sets, {
    openPrinting(target) { pricing.openPrinting(target); },
    bindersChanged() { dashboard.bindersChanged(); },
    confirm: confirmAction,
    deleted() {
      const target = ["master-switch", "first-set"].map(id => document.getElementById(id)).find(node => node?.getClientRects().length);
      target?.focus();
    },
  });
  const dashboard = createBuyCards({
    collection: master.collection,
    binders: master.backup,
    offerScope: controller.restoreScope,
    selected: () => el<HTMLSelectElement>("master-switch").value,
    inspect: target => pricing.openBuyingPrinting(target),
    closeDetail: () => pricing.closeBuyingPrinting(),
  });
  const pricing = createPricingUI({
    collection: master.collection,
    readOffers: dashboard.readOffers,
    checkOffers: dashboard.checkOffers,
    onBuyingClose: dashboard.detailClosed,
  });
  const buyCatalogSearch = createCatalogSearch({
    inline: true,
    cards: master.collection().cards,
    openPrinting: target => dashboard.inspectCatalog(target, () => buyCatalogSearch.focus()),
  });
  navigation.subscribe((selected, fromBinders) => {
    if (selected === "buy-cards") {
      closeScanner();
      for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
      dashboard.enter(fromBinders);
    } else {
      dashboard.leave();
    }
  });
  const catalogSearch = createCatalogSearch({ cards: master.collection().cards, openPrinting: pricing.openPrinting });
  const searchCards = el<HTMLButtonElement>("catalog-search-open");
  searchCards.addEventListener("click", () => catalogSearch.open());
  searchCards.disabled = false;
  let accountTicket = 0, accountKey = "", onboardingReady = false, onboardingTicket = 0;
  let productLookup: Promise<Record<string, ProductIdentity>> | undefined;
  let speciesLookup: ((match: TransferMatch) => readonly number[]) | undefined;
  const transfers = createTransfers({
    catalog: () => ({ ...master.collection(), products() {
      productLookup ??= fetch(`${root}catalog/tcgplayer-products.json`, { cache: "no-cache" }).then(async response => {
        if (!response.ok) throw new Error("The TCGplayer card lookup could not load. Try again.");
        return (await response.json()).products as Record<string, ProductIdentity>;
      }).catch(cause => { productLookup = undefined; throw cause; });
      return productLookup;
    } }),
    scope: () => `${controller.restoreScope()}:${accountTicket}`,
    sets: master.backup, dex: () => snapshot.state,
    async species() {
      if (speciesLookup) return speciesLookup;
      const data = await getCollectorNumbers();
      const index = new Map<string, number[]>();
      for (const [setId, entries] of Object.entries(data)) {
        for (const [id, numbers] of Object.entries(entries)) {
          for (const number of numbers) {
            const key = `${setId}:${number}`;
            if (!index.has(key)) index.set(key, []);
            index.get(key)!.push(Number(id));
          }
        }
      }
      return speciesLookup = match => index.get(`${match.set.id}:${match.card.number}`) ?? [];
    },
    saveSets(apply) {
      if (account.pendingMigration || account.retainedAccount) throw new Error("Finish reviewing the account connection before importing.");
      return master.applyCollection(apply);
    },
    async saveDex(ids, expected, current) {
      if (account.pendingMigration || account.retainedAccount) throw new Error("Finish reviewing the account connection before importing.");
      await controller.importSpecies(ids, expected, current);
      if (current()) await master.showNational();
    },
    selected: () => el<HTMLSelectElement>("master-switch").value,
    download,
  });
  async function backup() {
    const state = snapshot.state, scope=controller.restoreScope();
    let sets;
    try { sets=await master.backup(); } catch {
      download(exportBackup(state),"pokedex-national-dex-backup.json","application/json");
      throw new Error("National Dex backup downloaded. Set binder storage could not be read.");
    }
    if(scope!==controller.restoreScope()) throw new Error("The account changed. Download the current backup again.");
    download(JSON.stringify({utility:"pokedex-binder",schemaVersion:2,exportedAt:new Date().toISOString(),state,masterSets:sets}), "pokedex-binder-backup.json", "application/json");
  }
  function confirmAction(title: string, text: string, label: string, tone?: "danger"): Promise<boolean> {
    const dialog = el<HTMLDialogElement>("confirm-dialog");
    el("confirm-title").textContent = title; el("confirm-text").textContent = text; el("confirm-accept").textContent = label;
    el("confirm-accept").classList.toggle("dex-primary", tone !== "danger");
    el("confirm-accept").classList.toggle("dex-danger", tone === "danger");
    return new Promise(resolve => {
      let result = false;
      const accept = () => { result = true; dialog.close(); };
      const cancel = () => dialog.close();
      const closed = () => { el("confirm-accept").removeEventListener("click", accept); el("confirm-cancel").removeEventListener("click", cancel); dialog.removeEventListener("close", closed); resolve(result); };
      el("confirm-accept").addEventListener("click", accept); el("confirm-cancel").addEventListener("click", cancel); dialog.addEventListener("close", closed); dialog.showModal();
      el("confirm-cancel").focus();
    });
  }
  function matches(item: Species) {
    const status = cardStatus(snapshot.state.ownedDexIds.includes(item.id), snapshot.state.orderedDexIds?.includes(item.id) ?? false);
    return (filter.value === "all" || filter.value === status) && (generation.value === "all" || item.generation === Number(generation.value));
  }
  function filteredSpecies() { return searchSpecies(species, search.value).filter(matches); }
  function locationText(id: number) {
    const loc = locationFor(id, snapshot.state.settings, species);
    return `Page ${loc.page} · Row ${loc.row}, column ${loc.column}`;
  }
  function renderFeedback() {
    el("dex-status").textContent = snapshot.storageWarning ? "Kept in this page · Export a backup before leaving" : statusLabels[snapshot.status];
    const warning = [snapshot.storageWarning, snapshot.error].filter(Boolean).join(" ");
    el("dex-warning").textContent = warning; el("dex-warning").hidden = !warning;
    el("dex-conflict").hidden = !snapshot.layoutConflict;
  }
  function render() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
    const activeInput = document.activeElement instanceof HTMLInputElement && document.activeElement.type === "search" ? document.activeElement : null;
    const selection = activeInput ? [activeInput.selectionStart, activeInput.selectionEnd] : null;
    const scrollPositions = ["page-overview", "results-list", ...(selected === renderedSpecies ? ["printing-list"] : [])]
      .map(id => ({ id, top: document.getElementById(id)?.scrollTop ?? 0 }));
    const owned = new Set(snapshot.state.ownedDexIds), count = owned.size, ordered = new Set(snapshot.state.orderedDexIds);
    master.dex(nationalEnabled(snapshot.state), count, species.length);
    const settings = snapshot.state.settings, pages = pageCount(species.length, settings);
    currentPage = Math.max(1, Math.min(currentPage, pages));
    renderFeedback();
    el("owned-count").textContent = count.toLocaleString();
    el("ordered-count").textContent = ordered.size.toLocaleString();
    el("missing-count").textContent = (species.length - count - ordered.size).toLocaleString();
    el<HTMLProgressElement>("completion-bar").value = count / species.length * 100;
    el("completion-label").textContent = `${(count / species.length * 100).toFixed(1)}% complete`;
    el("completion-detail").textContent = `${count.toLocaleString()} of ${species.length.toLocaleString()} Pokémon · Any card counts`;
    el("binder-view").classList.toggle("has-details", selected !== null);
    details.hidden = selected === null;
    const pageCounts = new Map<number, { total: number; owned: number }>();
    for (const item of species) {
      const page = locationFor(item.id, settings).page, entry = pageCounts.get(page) ?? { total: 0, owned: 0 };
      entry.total++; if (owned.has(item.id)) entry.owned++; pageCounts.set(page, entry);
    }
    el("generation-progress").innerHTML = [...new Set(species.map(item => item.generation))].map(number => {
      const group = species.filter(item => item.generation === number);
      return `<div class="dex-generation-row"><span>Generation ${number}</span><span>${group.filter(item => owned.has(item.id)).length}/${group.length}</span></div>`;
    }).join("");
    const searched = new Set(searchSpecies(species, search.value).map(item => item.id));
    const cells = pageSlots(currentPage, species, settings).map(slot => {
      const item = slot.species;
      if (!item) return blankPocket(slot.pocket, slot.reserved ? "Reserved" : "Empty pocket");
      return cardPocket({ id: item.id, number: dex(item.id), name: item.name, image: root + "sprites/" + item.id + ".png",
        owned: owned.has(item.id), ordered: ordered.has(item.id), selected: selected === item.id, dimmed: !matches(item) || !searched.has(item.id),
        row: slot.row, column: slot.column });
    });
    drawPages(currentPage, pages, settings, pageCounts, cells);
    renderNationalView(); renderDetails(); renderSync();
    for (const { id, top } of scrollPositions) { const node = document.getElementById(id); if (node) node.scrollTop = top; }
    renderedSpecies = selected;
    if (focused && document.getElementById(focused) && document.activeElement?.id !== focused) document.getElementById(focused)?.focus({ preventScroll: true });
    if (selection && focused === "printing-search") el<HTMLInputElement>(focused).setSelectionRange(selection[0], selection[1]);
  }
  function renderNationalView() {
    if (el("national-workspace").hidden) return;
    el("binder-view").hidden = view.checklist;
    el("checklist-view").hidden = !view.checklist;
    el("view-binder").setAttribute("aria-pressed", String(!view.checklist));
    el("view-checklist").setAttribute("aria-pressed", String(view.checklist));
    renderResults();
    renderChecklist();
  }
  function renderResults() {
    const active = (!!search.value.trim() || filter.value === "ordered") && !view.checklist;
    el("dex-results").hidden = !active;
    if (!active) return;
    const results = filteredSpecies();
    el("results-count").textContent = `${results.length} Pokémon found${results.length > 60 ? " · Showing the first 60" : ""}`;
    el("results-list").innerHTML = results.slice(0, 60).map(item => `<div class="dex-result"><div><strong>${dex(item.id)} ${escape(item.name)}</strong><small>${locationText(item.id)}</small></div><button data-goto="${item.id}">Go to page</button></div>`).join("") || '<p class="dex-help">No Pokémon match. Try a name, Pokédex number, or another filter.</p>';
  }
  let collectorRequest: Promise<CollectorNumbers> | undefined;
  function getCollectorNumbers(): Promise<CollectorNumbers> {
    if (collectorNumbers) return Promise.resolve(collectorNumbers);
    collectorRequest ??= fetch(`${root}catalog/collector-numbers.json`).then(async response => {
      if (!response.ok) throw new Error("Card numbers could not load. Try again.");
      const data: unknown = await response.json();
      if (!record(data)) throw new Error("The card number catalog needs updating.");
      return collectorNumbers = data as CollectorNumbers;
    }).finally(() => { collectorRequest = undefined; });
    return collectorRequest;
  }
  async function loadCollectorNumbers() {
    numberStatus = "loading";
    try {
      await getCollectorNumbers();
      numberStatus = "idle";
    } catch {
      numberStatus = "error";
    }
    renderChecklist();
  }
  function renderChecklist() {
    if (!view.checklist || el("national-workspace").hidden) return;
    const sort = checklist.sort.value as ChecklistSort;
    const { species: results, sets } = filterChecklist(filteredSpecies(), catalog.sets, catalog.setSpecies, checklistSet.value, sort, collectorNumbers);
    const showNumbers = sets.length === 1 && results.length > 0;
    if (showNumbers && !collectorNumbers && numberStatus === "idle") void loadCollectorNumbers();
    const numbers = showNumbers ? collectorNumbers?.[sets[0].id] : undefined;
    const status = el("checklist-number-status");
    const sortByCards = sort === "collector" || sort === "collector-desc";
    let message = "";
    if (showNumbers && numberStatus === "loading") message = "Loading card numbers…";
    else if (showNumbers && numberStatus === "error") message = "Card numbers couldn’t load.";
    else if (sortByCards && sets.length !== 1) message = "Choose one set to sort by its card numbers.";
    else if (sortByCards && numbers) message = "Pokémon with multiple cards sort by their lowest number.";
    else if (sets.length > 1 && results.length) message = "Choose one set to see its card numbers.";
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !message;
    el("checklist-number-retry").hidden = !showNumbers || numberStatus !== "error";
    const owned = new Set(snapshot.state.ownedDexIds);
    const ordered = new Set(snapshot.state.orderedDexIds);
    el("checklist-clear-filters").hidden = !search.value && filter.value === "all" && generation.value === "all" && !checklistSet.value;
    checklist.render(results, item => {
      const cardNumbers = numbers?.[item.id];
      const detail = cardNumbers?.length
        ? `${cardNumbers.length === 1 ? "Card" : "Cards"} ${cardNumbers.map(number => `#${number}`).join(", ")}`
        : "";
      return {
        key: item.id, name: item.name, number: dex(item.id), owned: owned.has(item.id), ordered: ordered.has(item.id), detail,
        image: `${root}sprites/${item.id}.png`, ...locationFor(item.id, snapshot.state.settings, species),
      };
    });
  }
  function renderDetails() {
    const item = species.find(candidate => candidate.id === selected);
    if (!item) return;
    const loc = locationFor(item.id, snapshot.state.settings, species);
    details.innerHTML = `<div class="dex-detail-hero">${sprite(item, 80)}<div><p class="dex-eyebrow">${dex(item.id)} · Generation ${item.generation}</p><h2>${escape(item.name)}</h2></div><button type="button" class="dex-details-close" data-close-details aria-label="Close details for ${escape(item.name)}">×</button></div><div class="dex-detail-body"><div class="dex-location"><div><span class="dex-label">Page</span><strong>${loc.page}</strong></div><div><span class="dex-label">Row</span><strong>${loc.row}</strong></div><div><span class="dex-label">Column</span><strong>${loc.column}</strong></div><div><span class="dex-label">Sheet</span><strong>${loc.sheet} · ${titleCase(loc.side)}</strong></div></div>${statusControl(item.id, cardStatus(snapshot.state.ownedDexIds.includes(item.id), snapshot.state.orderedDexIds?.includes(item.id) ?? false), item.name)}<h3>Find a card</h3><p class="dex-help">English physical printings. Any version can fill this species’ slot.</p><label class="sr-only" for="printing-search">Filter printings by set name, code, or card number</label><input id="printing-search" type="search" placeholder="Filter by set name, code, or number" value="${escape(printingQuery)}" /><div id="printing-list" class="dex-printings" aria-live="polite"></div></div>`;
    renderPrintings();
  }
  function renderPrintings() {
    const list = document.getElementById("printing-list"); if (!list) return;
    if (detailLoading) { list.innerHTML = '<p class="dex-help">Loading card references…</p>'; return; }
    if (detailError) { list.innerHTML = '<p class="dex-help">Card references could not load. You can still update your checklist.</p><button id="retry-printings">Try again</button>'; return; }
    const query = printingQuery.trim().toLocaleLowerCase();
    const cards = (loadedPrintings ?? []).filter(card => {
      const set = catalog.sets[card.setId]; return !query || `${set?.name ?? ""} ${set?.code ?? ""} ${card.number} ${card.name}`.toLocaleLowerCase().includes(query);
    }).sort((a, b) => (catalog.sets[b.setId]?.releaseDate ?? "").localeCompare(catalog.sets[a.setId]?.releaseDate ?? "") || a.setId.localeCompare(b.setId) || a.number.localeCompare(b.number, undefined, { numeric: true }));
    if (!cards.length) { list.innerHTML = `<p class="dex-help">${query ? "No printings match this filter." : "No indexed English printings in this catalog."}</p>`; return; }
    let previous = "";
    list.innerHTML = cards.map(card => {
      const set = catalog.sets[card.setId];
      const heading = previous !== card.setId ? `<div class="dex-set-heading"><span>${escape(set?.name ?? "Unknown set")}</span><code>${escape(set?.code ?? "Code not provided")}</code></div>` : ""; previous = card.setId;
      const image = catalogArtwork({ id: card.setId }, card.number)
        ?? (card.image?.startsWith("https://assets.tcgdex.net/") ? card.image : null);
      const highImage = image?.replace(/\/low\.webp$/, "/high.webp");
      return `${heading}<article class="dex-card-printing">${image ? `<a href="${escape(highImage)}" target="_blank" rel="noopener noreferrer" aria-label="View ${escape(card.name)} ${escape(card.number)} card artwork"><img src="${escape(image)}" alt="${escape(card.name)} card" width="58" height="81" loading="lazy" /></a>` : ""}<div><p class="dex-card-title">${escape(card.name)}</p><p>Collector #${escape(card.number)}</p><small>${escape(card.rarity ?? "Rarity not provided")}</small><small>${escape(set?.releaseDate ?? "Release date not provided")}</small>
        <button type="button" data-printing-prices="${escape(card.id)}" aria-haspopup="dialog">Prices and offers</button></div></article>`;
    }).join("");
  }
  async function selectPokemon(id: number, focusSheet = true) {
    if (!species.some(item => item.id === id)) return;
    selected = id; printingQuery = ""; detailError = false;
    loadedPrintings = printingCache.get(id) ?? null; detailLoading = !loadedPrintings;
    render();
    if (focusSheet) showDetailsSheet(details, "open-grid-" + id);
    if (loadedPrintings) return;
    try {
      const response = await fetch(`${root}catalog/printings/${id}.json`);
      if (!response.ok) throw new Error("Catalog unavailable");
      const data = await response.json() as Printing[];
      if (!Array.isArray(data)) throw new Error("Catalog unavailable");
      printingCache.set(id, data);
      if (selected === id) { loadedPrintings = data; detailLoading = false; renderPrintings(); }
    } catch { if (selected === id) { detailLoading = false; detailError = true; renderPrintings(); } }
  }
  function goToPokemon(id: number) { currentPage = locationFor(id, snapshot.state.settings, species).page; view.checklist = false; void selectPokemon(id, false); el("page-heading").scrollIntoView({ behavior: "smooth", block: "start" }); }
  function renderSync() {
    el("binder-account-panel").hidden = !account.enabled;
    el<HTMLAnchorElement>("binder-account-link").href = accountHref("/utilities/pokemon-binder/");
    el("binder-account-link").textContent = account.user ? "Manage account & recovery" : "Sign in with email or Google";
    el("binder-account-status").textContent = account.retainedAccount ? `This open binder belongs to ${account.retainedAccount.email}. Your account changed, and this binder has changes that could not be saved on this device. Export its JSON backup before leaving, or retry saving to finish switching accounts.` : account.offline ? `Saved on this device for ${account.user?.email ?? "your account"}. Reconnect and sign in before syncing.` : account.mode === "account" ? `Syncing with ${account.user?.email ?? "your account"}.` : account.user
      ? `Signed in as ${account.user.email}. Review your device and account copies before connecting them.`
      : "An account can sync this binder and Idle Slayer Companion. You can also keep using this device without an account.";
    el("binder-account-review").hidden = !account.user || !account.migrationEnabled || account.mode === "account" || account.pendingMigration;
    el("binder-account-resume").hidden = !account.user || !account.pendingMigration;
    el("binder-account-sync").hidden = account.mode !== "account";
    el("binder-account-recheck").hidden = !account.storageNeedsRecovery;
    el("binder-recovery-download").hidden = !account.user;
    el("sync-message").textContent = snapshot.error ?? (snapshot.storageWarning ? "Browser storage is unavailable. Export a backup before leaving this page." : statusLabels[snapshot.status]);
  }
  async function updateOnboarding() {
    const ticket = ++onboardingTicket;
    if (account.mode === "account" || !account.user || !account.migrationEnabled) {
      master.onboarding("device");
      return;
    }
    const message = el("binder-account-onboarding-message");
    if (account.pendingMigration) {
      message.textContent = "Finish connecting your saved account binders, or keep working on this device.";
      master.onboarding("account");
      return;
    }
    master.onboarding("pending");
    try {
      const exists = await controller.accountHasBinders();
      if (ticket !== onboardingTicket) return;
      message.textContent = "Review the binders saved to your account before connecting them to this device.";
      master.onboarding(exists ? "account" : "device");
    } catch {
      if (ticket !== onboardingTicket) return;
      message.textContent = "We couldn't check your account binders. Try connecting again or keep working on this device.";
      master.onboarding("account");
    }
  }
  controller.subscribe(value => {
    const changed = !sameState(snapshot.state, value.state); snapshot = value;
    if (changed || !hasRendered) { render(); hasRendered = true; }
    else { renderFeedback(); renderSync(); }
    if (!nationalEnabled(value.state)) {
      if (scanDialog.open && scanner?.isNational()) closeScanner();
      el<HTMLDialogElement>("layout-dialog").close();
    }
    scanner?.refresh();
  });
  controller.subscribeAccount(value => {
    const key = JSON.stringify([value.mode, value.boundAccountId, value.user?.id, value.pendingMigration, value.migrationEnabled, value.retainedAccount?.id]);
    const changed = accountKey !== key;
    if (changed) {
      accountKey = key;
      accountTicket++;
      el("print-content").replaceChildren();
      el("transfer-message").textContent = "";
      transfers.scopeChanged();
      pricing.scopeChanged();
      dashboard.scopeChanged();
    }
    account = value; master.account(value); renderSync();
    if (changed) dashboard.bindersChanged();
    if (onboardingReady && changed) void updateOnboarding();
  });
  await controller.start();
  onboardingReady = true;
  void updateOnboarding();
  void master.start().then(dashboard.catalogReady).catch(error => {
    el("master-message").textContent = error.message;
    dashboard.catalogUnavailable();
  });
  el("dex-app").setAttribute("aria-busy", "false");
  el("scan-open").addEventListener("click", () => openScanner());
  if (scanDialog.open && scanDialog.dataset.phase === "loading" && nationalEnabled(snapshot.state)) openScanner();
  else { scanDialog.close(); scanDialog.dataset.phase = "closed"; }
  el("catalog-note").textContent = `English physical-card catalog · Updated ${new Date(catalog.generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })} · Community data may have gaps.`;

  document.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-page],[data-pokemon],[data-goto],[data-close-dialog],[data-close-details]");
    if (!button) return;
    if (button.hasAttribute("data-pokemon")) {
      const id = Number(button.dataset.pokemon);
      if (id === selected) closeNationalDetails(); else void selectPokemon(id);
    }
    if (button.hasAttribute("data-close-details")) {
      if (details.contains(button)) closeNationalDetails(); else master.closeDetails();
    }
    if (button.hasAttribute("data-goto")) goToPokemon(Number(button.dataset.goto));
    if (button.hasAttribute("data-close-dialog")) button.closest("dialog")?.close();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
    const target = event.target;
    // Escape in a filled search field clears the field first.
    if (target instanceof HTMLInputElement && target.type === "search" && target.value) return;
    if (closeNationalDetails() || master.closeDetails()) event.preventDefault();
  });
  document.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.matches("[data-dex-status]")) {
      if (input.checked) void action(() => controller.setStatus(Number(input.dataset.dexStatus), input.value as CardStatus));
      return;
    }
    if (input.matches("[data-owned]")) void action(() => controller.setOwned(Number(input.dataset.owned), input.checked));
  });
  details.addEventListener("input", event => { if ((event.target as HTMLElement).id === "printing-search") { printingQuery = (event.target as HTMLInputElement).value; renderPrintings(); } });
  details.addEventListener("click", event => {
    const element = event.target as Element;
    if (element.id === "retry-printings" && selected) void selectPokemon(selected, false);
    const id = element.closest<HTMLElement>("[data-printing-prices]")?.dataset.printingPrices;
    const card = id && loadedPrintings?.find(item => item.id === id);
    if (card) pricing.openPrinting({ ...card, setName: catalog.sets[card.setId]?.name ?? card.setId, variant: "*", finish: "" });
  });
  document.addEventListener("error", event => { if (event.target instanceof HTMLImageElement && el("dex-app").contains(event.target)) { event.target.hidden = true; } }, true);
  search.addEventListener("input", () => { checklist.resetLimit(); render(); });
  for (const node of [filter, generation]) node.addEventListener("change", () => { checklist.resetLimit(); render(); });
  checklistSet.addEventListener("input", () => { checklist.resetLimit(); renderChecklist(); });
  el("checklist-number-retry").addEventListener("click", () => { numberStatus = "idle"; renderChecklist(); });
  el("checklist-clear-set").addEventListener("click", () => { checklistSet.value = ""; checklist.resetLimit(); renderChecklist(); checklistSet.focus(); });
  el("checklist-clear-filters").addEventListener("click", () => {
    search.value = ""; filter.value = generation.value = "all"; checklistSet.value = "";
    checklist.resetLimit(); render(); checklistSet.focus();
  });
  el("view-binder").addEventListener("click", () => { view.checklist = false; renderNationalView(); });
  el("view-checklist").addEventListener("click", () => { view.checklist = true; renderNationalView(); });

  el("layout-open").addEventListener("click", () => {
    const form = el<HTMLFormElement>("layout-form");
    for (const [key, value] of Object.entries(snapshot.state.settings)) (form.elements.namedItem(key) as HTMLInputElement).value = String(value);
    el("layout-error").textContent = ""; el<HTMLDialogElement>("layout-dialog").showModal();
  });
  for (const id of ["first-dex", "national-add"]) el(id).addEventListener("click", event => void action(async () => {
    await controller.setEnabled(true);
    await master.showNational();
    el("layout-open").focus();
  }, event.currentTarget as HTMLButtonElement));
  el("national-hide").addEventListener("click", event => void action(async () => {
    await controller.setEnabled(false);
    el<HTMLDialogElement>("layout-dialog").close();
    el(nationalEnabled(snapshot.state) ? "layout-open" : el("binder-onboarding").hidden ? "master-switch" : "first-dex").focus();
  }, event.currentTarget as HTMLButtonElement));
  el("first-device").addEventListener("click", () => {
    onboardingTicket++;
    master.onboarding("device");
    el("first-set").focus();
  });
  el("first-connect").addEventListener("click", () => {
    if (account.pendingMigration) { el("sync-open").click(); el("binder-account-resume").focus(); }
    else el("binder-account-review").click();
  });
  el("layout-form").addEventListener("submit", event => {
    event.preventDefault(); const data = new FormData(event.target as HTMLFormElement);
    void action(async () => {
      await controller.setSettings({ columns: Number(data.get("columns")), rows: Number(data.get("rows")), useBackSides: data.get("useBackSides") === "true", leadingBlankPockets: Number(data.get("leadingBlankPockets")) });
      el<HTMLDialogElement>("layout-dialog").close();
    });
  });
  el("sync-open").addEventListener("click", () => { el("sync-error").textContent = ""; renderSync(); syncDialog.showModal();
    el("previous-restore").hidden=true;
    void controller.previousRestore().then(saved=>{el("previous-restore").hidden=!saved;}).catch(()=>{});
    el("resume-restore").hidden=true;
    void controller.pendingRestore().then(pending=>{el("resume-restore").hidden=!pending;}).catch(()=>{});
  });
  el("previous-restore").addEventListener("click",()=>void action(async()=>{const backup=await controller.previousRestore();if(backup)download(JSON.stringify(backup),"pokedex-before-restore.json","application/json");}));
  el("resume-restore").addEventListener("click",()=>void action(async()=>{await controller.resumeRestore();await master.restored();el("resume-restore").hidden=true;}));
  el("binder-account-review").addEventListener("click", event => void action(async () => {
    migrationPreview = await controller.previewMigration();
    const preview = migrationPreview;
    const describeDex = (state: BinderState | null) => {
      if (state && nationalEnabled(state)) return `${state.ownedDexIds.length} collected`;
      return state && hasNationalData(state) ? `Pokédex hidden (${state.ownedDexIds.length} collected)` : "Pokédex inactive";
    };
    el("binder-migration-summary").textContent = `This device: ${describeDex(preview.device)}, ${preview.sets?.device.binders.length ?? 0} set binders. Account: ${describeDex(preview.account)}, ${preview.sets?.account.binders.length ?? 0} set binders.`;
    const layout = el<HTMLSelectElement>("binder-migration-layout"), collection = el<HTMLSelectElement>("binder-migration-collection");
    layout.querySelector<HTMLOptionElement>('option[value="account"]')!.disabled = !preview.account;
    collection.querySelector<HTMLOptionElement>('option[value="account"]')!.disabled = !preview.account;
    layout.value = preview.layoutConflict ? "" : "device"; collection.value = "combine";
    el("binder-migration-error").textContent = "";
    syncDialog.close(); el<HTMLDialogElement>("binder-migration-dialog").showModal();
  }, event.currentTarget as HTMLButtonElement));
  el("binder-migration-form").addEventListener("submit", event => {
    event.preventDefault();
    const button = (event.target as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    void action(async () => {
      if (!migrationPreview) throw new Error("Review your binder copies again before connecting.");
      try {
        const selectedState = combineMigrationSources(migrationPreview, el<HTMLSelectElement>("binder-migration-layout").value as "device" | "legacy" | "account", el<HTMLSelectElement>("binder-migration-collection").value as "combine" | "device" | "account");
        await controller.migrate(migrationPreview, selectedState);
        el<HTMLDialogElement>("binder-migration-dialog").close();
      } catch (error) { el("binder-migration-error").textContent = error instanceof Error ? error.message : "Migration could not finish. Your original copies are preserved."; throw error; }
    }, button);
  });
  el("binder-account-resume").addEventListener("click", event => void action(() => controller.resumeMigration(), event.currentTarget as HTMLButtonElement));
  el("binder-account-sync").addEventListener("click", event => void action(() => Promise.all([controller.sync(),master.sync()]), event.currentTarget as HTMLButtonElement));
  el("binder-account-recheck").addEventListener("click", event => void action(() => controller.recheckConnection(), event.currentTarget as HTMLButtonElement));
  el("binder-recovery-download").addEventListener("click", event => void action(async () => download(await controller.recoveryBackups(), "pokedex-binder-migration-backups.json", "application/json"), event.currentTarget as HTMLButtonElement));
  el("conflict-local").addEventListener("click", () => void action(() => controller.resolveLayout("local")));
  el("conflict-remote").addEventListener("click", () => void action(() => controller.resolveLayout("remote")));
  el("export-json").addEventListener("click", () => void action(backup)); el("confirm-backup").addEventListener("click", () => void action(backup));
  el("import-json").addEventListener("change", event => void action(async () => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("This file is too large for a Pokémon Binder Tracker backup.");
      const scope=controller.restoreScope();
      const text = await file.text();
      const parsed = JSON.parse(text);
      const combined = parsed?.utility === "pokedex-binder" && parsed.schemaVersion === 2;
      const sets = combined ? validateMaster(parsed.masterSets) : null;
      const state: BinderState = combined ? importBackup(JSON.stringify({utility:"pokedex-binder",schemaVersion:1,state:parsed.state}),species) : importBackup(text,species);
      if(sets) await master.checkBackup(sets);
      if (await confirmAction("Restore this backup?", "Replace your current collection and layout with this backup. If connected, the restored collection will also sync to your other devices. Download your current backup first if needed.", "Restore backup")) {
        if(scope!==controller.restoreScope()) throw new Error("The active account changed. Review the backup again.");
        state.enabled ??= nationalEnabled(state);
        if(sets) { await controller.restoreCollections(state,sets,scope);await master.restored(); } else await controller.replaceState(state);
      }
    } finally { input.value = ""; }
  }));
  const exportButton = el<HTMLButtonElement>("export-csv");
  const printButton = el<HTMLButtonElement>("print-missing");
  const scopeSelect = el<HTMLSelectElement>("export-scope");
  const binderSelect = el<HTMLSelectElement>("master-switch");
  const positionList = el<HTMLSelectElement>("position-list");
  positionList.addEventListener("change", () => {
    const ordered = positionList.value === "ordered";
    exportButton.lastChild!.textContent = ordered ? " Export ordered CSV" : " Export missing CSV";
    printButton.textContent = ordered ? "Print ordered list" : "Print missing list";
    el("export-message").textContent = "";
  });
  async function outputList(print: boolean) {
    const all = scopeSelect.value === "all";
    const selectedId = binderSelect.value;
    const scope = controller.restoreScope();
    const status = positionList.value === "ordered" ? "ordered" : "missing";
    const lists: BinderList[] = [];
    exportButton.disabled = printButton.disabled = true;
    const message = el("export-message");
    message.textContent = `Preparing ${status} list…`;
    try {
      if ((all || !selectedId) && nationalEnabled(snapshot.state)) {
        lists.push({ name: "National Pokédex", setName: "", settings: snapshot.state.settings,
          rows: nationalRows(species, snapshot.state, status) });
      }
      if (all || selectedId) lists.push(...await master.positionLists(all ? null : selectedId, status));
      if (!lists.length) throw new Error("Choose an active binder first.");
      if (controller.restoreScope() !== scope || status !== positionList.value || all !== (scopeSelect.value === "all") || (!all && selectedId !== binderSelect.value)) {
        throw new Error("The collection selection changed. Request the list again.");
      }
      if (print) printLists(lists, all, status);
      else {
        const text = all ? combinedCsv(lists) : selectedId ? setListCsv(lists[0].rows) : nationalCsv(lists[0].rows);
        const filename = all ? "all-binders" : selectedId ? lists[0].name : "pokedex";
        download(text, filename + "-" + status + ".csv", "text/csv;charset=utf-8");
      }
      message.textContent = "";
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "The card list could not load. Try again.";
    } finally {
      exportButton.disabled = printButton.disabled = false;
    }
  }
  exportButton.addEventListener("click", () => void outputList(false));
  printButton.addEventListener("click", () => void outputList(true));
  window.addEventListener("pagehide", event => {
    dashboard.leave();
    if (!event.persisted) { master.close(); controller.stop(); }
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    if (!el("buy-cards-workspace").hidden) dashboard.enter(false);
    void controller.sync();
  });
}

void initialize().catch(error => {
  el("scan-open").hidden = false;
  el("scan-dialog").dataset.phase = "load-error";
  el("scan-status").textContent = "The binder could not load. Reload it to open the scanner.";
  reportFailure(new Error("Binder initialization failed"), "binder.start");
  el("dex-app").setAttribute("aria-busy", "false");
  el("dex-status").textContent = "Binder could not start";
  el("buy-cards-status").textContent = "The binder couldn’t load. Reload to try again.";
  el("dex-warning").textContent = error instanceof Error ? error.message : "Reload to try again. Your saved collection is safe.";
  el("dex-warning").hidden = false;
});
