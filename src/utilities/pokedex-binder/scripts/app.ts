import { createMasterUI } from "./master-ui";
import { validateMaster } from "../lib/master";
import { defaultState, exportBackup, exportCsv, importBackup, locationFor, pageCount, pageSlots, record, searchSpecies, sameState, type BinderState, type Species } from "../lib/model";
import { type BinderSnapshot } from "../lib/sync";
import { combineMigrationSources, createUnifiedBinderController, type BinderAccountState, type MigrationPreview } from "../lib/accounts";
import { accountHref } from "../../../../packages/accounts/client";
import { filterChecklist, setLabel, type ChecklistSort } from "../lib/checklist";
import type { CardScanner } from "./scanner";

interface SetInfo { id: string; name: string; code: string | null; releaseDate: string | null; symbol?: string }
interface Printing { id: string; name: string; number: string; setId: string; rarity: string | null; image: string | null }
interface Catalog { schemaVersion: number; generatedAt: string; species: Species[]; sets: Record<string, SetInfo>; setSpecies: Record<string, number[]> }
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
  const response = await fetch(`${root}catalog/index.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error("The Pokémon catalog could not load. Reload to try again; your saved binder is safe.");
  const catalog = await response.json() as Catalog;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.species) || !catalog.species.length) throw new Error("The Pokémon catalog needs updating. Your saved binder is safe.");
  const species = catalog.species;
  const controller = createUnifiedBinderController({ species });
  let account: BinderAccountState = controller.accountState();
  let migrationPreview: MigrationPreview | null = null;
  let snapshot: BinderSnapshot = { state: defaultState(), status: "loading", error: null, storageWarning: null, connected: false, key: null, layoutConflict: null };
  let currentPage = 1, selected: number | null = null, view: "binder" | "checklist" = "binder", checklistLimit = 100, printingQuery = "";
  let loadedPrintings: Printing[] | null = null, detailLoading = false, detailError = false;
  let renderedSpecies: number | null = null;
  let checklistSelected: number | null = null, hasRendered = false;
  let collectorNumbers: Record<string, Record<number, string[]>> | null = null;
  let numberStatus: "idle" | "loading" | "error" = "idle";
  let scanner: CardScanner | null = null;
  const printingCache = new Map<number, Printing[]>();
  const search = el<HTMLInputElement>("dex-search");
  const filter = el<HTMLSelectElement>("dex-filter");
  const generation = el<HTMLSelectElement>("dex-generation");
  const checklistSet = el<HTMLInputElement>("checklist-set");
  const checklistSort = el<HTMLSelectElement>("checklist-sort");
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
  const master = createMasterUI(controller.masters, download);
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
  function confirmAction(title: string, text: string, label: string): Promise<boolean> {
    const dialog = el<HTMLDialogElement>("confirm-dialog");
    el("confirm-title").textContent = title; el("confirm-text").textContent = text; el("confirm-accept").textContent = label;
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
    const has = snapshot.state.ownedDexIds.includes(item.id);
    return (filter.value === "all" || (filter.value === "owned" ? has : !has)) && (generation.value === "all" || item.generation === Number(generation.value));
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
    const owned = new Set(snapshot.state.ownedDexIds), count = owned.size;
    master.dex(count,species.length);
    const settings = snapshot.state.settings, pages = pageCount(species.length, settings);
    currentPage = Math.max(1, Math.min(currentPage, pages));
    renderFeedback();
    el("owned-count").textContent = count.toLocaleString(); el("missing-count").textContent = (species.length - count).toLocaleString();
    el<HTMLProgressElement>("completion-bar").value = count / species.length * 100;
    el("completion-label").textContent = `${(count / species.length * 100).toFixed(1)}% complete`;
    el("completion-detail").textContent = `${count.toLocaleString()} of ${species.length.toLocaleString()} Pokémon · Any card counts`;
    el("binder-view").hidden = view !== "binder"; el("checklist-view").hidden = view !== "checklist";
    el("binder-view").classList.toggle("has-details", selected !== null);
    details.hidden = selected === null;
    el("view-binder").setAttribute("aria-pressed", String(view === "binder")); el("view-checklist").setAttribute("aria-pressed", String(view === "checklist"));
    el("page-total").textContent = String(pages);
    el("capacity-summary").textContent = `${settings.columns} × ${settings.rows} pockets · ${settings.useBackSides ? Math.ceil(pages / 2) : pages} sheets needed · ${settings.useBackSides ? "Both sides" : "Fronts only"}`;
    const pageCounts = new Map<number, { total: number; owned: number }>();
    for (const item of species) {
      const page = locationFor(item.id, settings).page, entry = pageCounts.get(page) ?? { total: 0, owned: 0 };
      entry.total++; if (owned.has(item.id)) entry.owned++; pageCounts.set(page, entry);
    }
    el("page-overview").innerHTML = Array.from({ length: pages }, (_, index) => {
      const page = index + 1, data = pageCounts.get(page) ?? { total: 0, owned: 0 };
      return `<button class="dex-page-chip" data-page="${page}" aria-label="Page ${page}, ${data.owned} of ${data.total} collected" ${page === currentPage ? 'aria-current="page"' : ""} style="--filled:${data.total ? data.owned / data.total * 100 : 0}%">${page}</button>`;
    }).join("");
    el("generation-progress").innerHTML = [...new Set(species.map(item => item.generation))].map(number => {
      const group = species.filter(item => item.generation === number);
      return `<div class="dex-generation-row"><span>Generation ${number}</span><span>${group.filter(item => owned.has(item.id)).length}/${group.length}</span></div>`;
    }).join("");
    el("page-heading").textContent = `Page ${currentPage}`;
    el("sheet-label").textContent = `Sheet ${settings.useBackSides ? Math.ceil(currentPage / 2) : currentPage} · ${settings.useBackSides && currentPage % 2 === 0 ? "Back" : "Front"}`;
    const pageData = pageCounts.get(currentPage) ?? { total: 0, owned: 0 };
    el("page-progress").textContent = `${pageData.owned} of ${pageData.total} collected on this page`;
    el<HTMLButtonElement>("page-prev").disabled = currentPage === 1; el<HTMLButtonElement>("page-next").disabled = currentPage === pages;
    el<HTMLSelectElement>("page-select").innerHTML = Array.from({ length: pages }, (_, index) => `<option value="${index + 1}" ${index + 1 === currentPage ? "selected" : ""}>${index + 1} / ${pages}</option>`).join("");
    const grid = el("binder-grid"); grid.style.setProperty("--columns", String(settings.columns)); grid.dataset.dense = String(settings.columns > 4);
    const searched = new Set(searchSpecies(species, search.value).map(item => item.id));
    grid.innerHTML = pageSlots(currentPage, species, settings).map(slot => {
      if (!slot.species) return `<div class="dex-pocket-blank"><span>Pocket ${slot.pocket}</span>${slot.reserved ? "Reserved" : "Empty pocket"}</div>`;
      const item = slot.species, has = owned.has(item.id);
      return `<div class="dex-pocket ${has ? "owned" : ""} ${selected === item.id ? "selected" : ""} ${!matches(item) || !searched.has(item.id) ? "dimmed" : ""}"><button id="open-grid-${item.id}" class="dex-pocket-open" data-pokemon="${item.id}" aria-label="${escape(item.name)}, ${dex(item.id)}, row ${slot.row}, column ${slot.column}. View card references" aria-pressed="${selected === item.id}"><span class="dex-pocket-number">${dex(item.id)}</span>${sprite(item)}<span class="dex-pocket-name">${escape(item.name)}</span></button><label class="dex-pocket-check"><input id="owned-grid-${item.id}" type="checkbox" data-owned="${item.id}" ${has ? "checked" : ""} aria-label="Own ${escape(item.name)}" /><span>${has ? "Owned" : "Missing"}</span></label></div>`;
    }).join("");
    renderResults(); renderChecklist(); renderDetails(); renderSync();
    for (const { id, top } of scrollPositions) { const node = document.getElementById(id); if (node) node.scrollTop = top; }
    renderedSpecies = selected;
    if (focused && document.getElementById(focused) && document.activeElement?.id !== focused) document.getElementById(focused)?.focus({ preventScroll: true });
    if (selection && focused === "printing-search") el<HTMLInputElement>(focused).setSelectionRange(selection[0], selection[1]);
  }
  function renderResults() {
    const active = !!search.value.trim() && view === "binder";
    el("dex-results").hidden = !active;
    if (!active) return;
    const results = filteredSpecies();
    el("results-count").textContent = `${results.length} Pokémon found${results.length > 60 ? " · Showing the first 60" : ""}`;
    el("results-list").innerHTML = results.slice(0, 60).map(item => `<div class="dex-result"><div><strong>${dex(item.id)} ${escape(item.name)}</strong><small>${locationText(item.id)}</small></div><button data-goto="${item.id}">Go to page</button></div>`).join("") || '<p class="dex-help">No Pokémon match. Try a name, Pokédex number, or another filter.</p>';
  }
  async function loadCollectorNumbers() {
    numberStatus = "loading";
    try {
      const response = await fetch(`${root}catalog/collector-numbers.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error("Card numbers unavailable");
      const data = await response.json();
      if (!record(data)) throw new Error("Card numbers unavailable");
      collectorNumbers = data as typeof collectorNumbers;
      numberStatus = "idle";
    } catch {
      numberStatus = "error";
    }
    renderChecklist();
  }
  function renderChecklist() {
    if (view !== "checklist") return;
    const { species: results, sets } = checklistResults();
    const showNumbers = sets.length === 1 && results.length > 0;
    if (showNumbers && !collectorNumbers && numberStatus === "idle") void loadCollectorNumbers();
    const numbers = showNumbers ? collectorNumbers?.[sets[0].id] : undefined;
    const status = el("checklist-number-status");
    const sortByCards = checklistSort.value === "collector" || checklistSort.value === "collector-desc";
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
    el<HTMLInputElement>("checklist-hide-collected").checked = filter.value === "missing";
    el("checklist-count").textContent = `${results.length} Pokémon${results.length > checklistLimit ? ` · Showing ${checklistLimit}` : ""}`;
    const list = el("checklist-list"), visible = results.slice(0, checklistLimit), ids = new Set(visible.map(item => item.id));
    for (const row of list.querySelectorAll<HTMLElement>("[data-checklist-row]")) if (!ids.has(Number(row.dataset.checklistRow))) row.remove();
    list.querySelector(".dex-help")?.remove();
    visible.forEach((item, index) => {
      let row = document.getElementById(`checklist-row-${item.id}`);
      if (!row) {
        row = document.createElement("div"); row.id = `checklist-row-${item.id}`; row.className = "dex-checklist-row"; row.dataset.checklistRow = String(item.id);
        row.innerHTML = `<input id="owned-list-${item.id}" type="checkbox" data-owned="${item.id}" aria-label="Own ${escape(item.name)}" />${sprite(item, 48)}<div class="dex-checklist-identity"><span class="dex-label">${dex(item.id)}</span><button class="dex-checklist-name" aria-label="Highlight ${escape(item.name)}" aria-pressed="false">${escape(item.name)}</button><span class="dex-label dex-checklist-card-numbers" hidden></span><span class="dex-collected-label" hidden>✓ Collected</span></div><div class="dex-checklist-location"></div><button data-goto="${item.id}" aria-label="Go to ${escape(item.name)} binder page">View page</button>`;
      }
      const has = owned.has(item.id);
      row.classList.toggle("owned", has); row.classList.toggle("selected", item.id === checklistSelected);
      row.querySelector<HTMLInputElement>("input")!.checked = has;
      row.querySelector<HTMLElement>(".dex-collected-label")!.hidden = !has;
      row.querySelector(".dex-checklist-name")!.setAttribute("aria-pressed", String(item.id === checklistSelected));
      const numberLine = row.querySelector<HTMLElement>(".dex-checklist-card-numbers")!;
      const cardNumbers = numbers?.[item.id];
      const numberLabel = cardNumbers?.length
        ? `${cardNumbers.length === 1 ? "Card" : "Cards"} ${cardNumbers.map(number => `#${number}`).join(", ")}`
        : "";
      if (numberLine.textContent !== numberLabel) numberLine.textContent = numberLabel;
      numberLine.hidden = !numberLabel;
      const location = row.querySelector<HTMLElement>(".dex-checklist-location")!, loc = locationFor(item.id, snapshot.state.settings, species);
      const label = locationText(item.id);
      if (location.getAttribute("aria-label") !== label) {
        location.setAttribute("aria-label", label);
        location.innerHTML = `<span>Page <strong>${loc.page}</strong></span><span>Row <strong>${loc.row}</strong></span><span>Col <strong>${loc.column}</strong></span>`;
      }
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    });
    if (!visible.length) list.innerHTML = '<p class="dex-help">No Pokémon match these filters.</p>';
    const alphabetical = checklistSort.value === "name" || checklistSort.value === "name-desc";
    el("checklist-letters").hidden = !alphabetical;
    const letters = new Set(results.map(item => item.name[0].toUpperCase()));
    for (const button of el("checklist-letters").querySelectorAll<HTMLButtonElement>("[data-letter]")) button.disabled = !letters.has(button.dataset.letter!);
    el("checklist-more").hidden = results.length <= checklistLimit;
  }
  function checklistResults() {
    return filterChecklist(filteredSpecies(), catalog.sets, catalog.setSpecies, checklistSet.value, checklistSort.value as ChecklistSort, collectorNumbers);
  }
  function renderDetails() {
    const item = species.find(candidate => candidate.id === selected);
    if (!item) return;
    const loc = locationFor(item.id, snapshot.state.settings, species);
    details.innerHTML = `<div class="dex-detail-hero">${sprite(item, 80)}<div><p class="dex-eyebrow">${dex(item.id)} · Generation ${item.generation}</p><h2>${escape(item.name)}</h2><p class="dex-help">Sheet ${loc.sheet} · ${titleCase(loc.side)}</p></div></div><div class="dex-detail-body"><div class="dex-location"><div><span class="dex-label">Page</span><strong>${loc.page}</strong></div><div><span class="dex-label">Row</span><strong>${loc.row}</strong></div><div><span class="dex-label">Column</span><strong>${loc.column}</strong></div></div><label class="dex-owned-label"><input id="detail-owned" type="checkbox" data-owned="${item.id}" ${snapshot.state.ownedDexIds.includes(item.id) ? "checked" : ""} /> I have a card for this slot</label><h3>Find a card</h3><p class="dex-help">English physical printings. Any version can fill this species’ slot.</p><label class="sr-only" for="printing-search">Filter printings by set name, code, or card number</label><input id="printing-search" type="search" placeholder="Filter by set name, code, or number" value="${escape(printingQuery)}" /><div id="printing-list" class="dex-printings" aria-live="polite"></div></div>`;
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
      const image = card.image && /^https:\/\/assets\.tcgdex\.net\//.test(card.image) ? card.image : null;
      const highImage = image?.replace(/\/low\.webp$/, "/high.webp");
      return `${heading}<article class="dex-card-printing">${image ? `<a href="${escape(highImage)}" target="_blank" rel="noopener noreferrer" aria-label="View ${escape(card.name)} ${escape(card.number)} card artwork"><img src="${escape(image)}" alt="${escape(card.name)} card" width="58" height="81" loading="lazy" /></a>` : ""}<div><p class="dex-card-title">${escape(card.name)}</p><p>Collector #${escape(card.number)}</p><small>${escape(card.rarity ?? "Rarity not provided")}</small><small>${escape(set?.releaseDate ?? "Release date not provided")}</small></div></article>`;
    }).join("");
  }
  async function selectPokemon(id: number, scroll = true) {
    if (!species.some(item => item.id === id)) return;
    selected = id; printingQuery = ""; detailError = false;
    loadedPrintings = printingCache.get(id) ?? null; detailLoading = !loadedPrintings;
    render();
    if (scroll && matchMedia("(max-width: 900px)").matches) details.scrollIntoView({ behavior: "smooth", block: "start" });
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
  function goToPokemon(id: number) { currentPage = locationFor(id, snapshot.state.settings, species).page; view = "binder"; void selectPokemon(id, false); el("page-heading").scrollIntoView({ behavior: "smooth", block: "start" }); }
  function renderSync() {
    el("binder-account-panel").hidden = !account.enabled;
    el<HTMLAnchorElement>("binder-account-link").href = accountHref(root);
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
  controller.subscribe(value => {
    const changed = !sameState(snapshot.state, value.state); snapshot = value;
    if (changed || !hasRendered) { render(); hasRendered = true; }
    else { renderFeedback(); renderSync(); }
    scanner?.refresh();
  });
  controller.subscribeAccount(value => { account = value; master.account(value); renderSync(); });
  await controller.start();
  void master.start().catch(error=>{el("master-message").textContent=error.message;});
  el("dex-app").setAttribute("aria-busy", "false");
  el("scan-open").addEventListener("click", async event => {
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
    try {
      if (!scanner) {
        const { createCardScanner } = await import("./scanner");
        scanner = createCardScanner({ species, getSnapshot: () => snapshot, markOwned: id => controller.setOwned(id, true) });
      }
      scanner.open();
    } catch { el("dex-warning").textContent = "The scanner could not load. Check your connection and try again."; el("dex-warning").hidden = false; }
    finally { button.disabled = false; }
  });
  el("catalog-note").textContent = `English physical-card catalog · Updated ${new Date(catalog.generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })} · Community data may have gaps.`;

  document.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-page],[data-pokemon],[data-goto],[data-close-dialog]");
    if (!button) return;
    if (button.hasAttribute("data-page")) { currentPage = Number(button.dataset.page); render(); }
    if (button.hasAttribute("data-pokemon")) void selectPokemon(Number(button.dataset.pokemon));
    if (button.hasAttribute("data-goto")) goToPokemon(Number(button.dataset.goto));
    if (button.hasAttribute("data-close-dialog")) button.closest("dialog")?.close();
  });
  document.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.matches("[data-owned]")) void action(() => controller.setOwned(Number(input.dataset.owned), input.checked));
  });
  details.addEventListener("input", event => { if ((event.target as HTMLElement).id === "printing-search") { printingQuery = (event.target as HTMLInputElement).value; renderPrintings(); } });
  details.addEventListener("click", event => { if ((event.target as HTMLElement).id === "retry-printings" && selected) void selectPokemon(selected, false); });
  document.addEventListener("error", event => { if (event.target instanceof HTMLImageElement && el("dex-app").contains(event.target)) { event.target.hidden = true; } }, true);
  search.addEventListener("input", () => { checklistLimit = 100; render(); });
  for (const node of [filter, generation]) node.addEventListener("change", () => { checklistLimit = 100; render(); });
  checklistSet.addEventListener("input", () => { checklistLimit = 100; renderChecklist(); });
  el("checklist-number-retry").addEventListener("click", () => { numberStatus = "idle"; renderChecklist(); });
  checklistSort.addEventListener("change", () => { checklistLimit = 100; renderChecklist(); });
  el("checklist-hide-collected").addEventListener("change", event => { filter.value = (event.target as HTMLInputElement).checked ? "missing" : "all"; checklistLimit = 100; render(); });
  el("checklist-list").addEventListener("click", event => {
    const target = event.target as HTMLElement, row = target.closest<HTMLElement>("[data-checklist-row]");
    if (!row || target.closest("input,[data-goto]")) return;
    checklistSelected = Number(row.dataset.checklistRow);
    for (const item of el("checklist-list").querySelectorAll<HTMLElement>("[data-checklist-row]")) {
      const active = Number(item.dataset.checklistRow) === checklistSelected;
      item.classList.toggle("selected", active); item.querySelector(".dex-checklist-name")!.setAttribute("aria-pressed", String(active));
    }
  });
  el("checklist-letters").addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-letter]"); if (!button) return;
    const { species: results } = checklistResults(), index = results.findIndex(item => item.name[0].toUpperCase() === button.dataset.letter);
    if (index < 0) return;
    checklistLimit = Math.max(checklistLimit, Math.ceil((index + 1) / 100) * 100); renderChecklist();
    const row = el(`checklist-row-${results[index].id}`); row.scrollIntoView({ block: "center" });
    row.querySelector<HTMLButtonElement>(".dex-checklist-name")!.focus({ preventScroll: true });
  });
  el("checklist-clear-set").addEventListener("click", () => { checklistSet.value = ""; checklistLimit = 100; renderChecklist(); checklistSet.focus(); });
  el("view-binder").addEventListener("click", () => { view = "binder"; render(); });
  el("view-checklist").addEventListener("click", () => { view = "checklist"; render(); });
  el("checklist-more").addEventListener("click", () => { checklistLimit += 100; renderChecklist(); });
  el("page-prev").addEventListener("click", () => { currentPage--; render(); });
  el("page-next").addEventListener("click", () => { currentPage++; render(); });
  el("page-select").addEventListener("change", event => { currentPage = Number((event.target as HTMLSelectElement).value); render(); });

  el("layout-open").addEventListener("click", () => {
    const form = el<HTMLFormElement>("layout-form");
    for (const [key, value] of Object.entries(snapshot.state.settings)) (form.elements.namedItem(key) as HTMLInputElement).value = String(value);
    el("layout-error").textContent = ""; el<HTMLDialogElement>("layout-dialog").showModal();
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
    el("binder-migration-summary").textContent = `This device: ${preview.device.ownedDexIds.length} collected. Named binders: ${preview.sets?.device.binders.length ?? 0} on this device, ${preview.sets?.account.binders.length ?? 0} on the account. Conflicting copies are kept separately. Account: ${preview.account ? preview.account.ownedDexIds.length + " collected" : "new binder"}.`;
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
  el("export-csv").addEventListener("click", () => download(exportCsv(species, snapshot.state, true), "pokedex-missing.csv", "text/csv;charset=utf-8"));
  el("import-json").addEventListener("change", event => void action(async () => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("This file is too large for a Pokédex Binder backup.");
      const scope=controller.restoreScope();
      const text = await file.text();
      const parsed = JSON.parse(text);
      const combined = parsed?.utility === "pokedex-binder" && parsed.schemaVersion === 2;
      const sets = combined ? validateMaster(parsed.masterSets) : null;
      const state: BinderState = combined ? importBackup(JSON.stringify({utility:"pokedex-binder",schemaVersion:1,state:parsed.state}),species) : importBackup(text,species);
      if(sets) await master.checkBackup(sets);
      if (await confirmAction("Restore this backup?", "Replace your current collection and layout with this backup. If connected, the restored collection will also sync to your other devices. Download your current backup first if needed.", "Restore backup")) {
        if(scope!==controller.restoreScope()) throw new Error("The active account changed. Review the backup again.");
        if(sets) { await controller.restoreCollections(state,sets,scope);await master.restored(); } else await controller.replaceState(state);
      }
    } finally { input.value = ""; }
  }));
  el("print-missing").addEventListener("click", () => {
    const missing = species.filter(item => !snapshot.state.ownedDexIds.includes(item.id));
    el("print-content").innerHTML = `<h1>Pokédex Binder · Missing Pokémon</h1><p>${missing.length} still to find · ${snapshot.state.settings.columns} × ${snapshot.state.settings.rows} pockets per side</p><table><thead><tr><th>Pokédex</th><th>Pokémon</th><th>Page</th><th>Sheet / side</th><th>Row / column</th></tr></thead><tbody>${missing.map(item => { const loc = locationFor(item.id, snapshot.state.settings); return `<tr><td>☐ ${dex(item.id)}</td><td>${escape(item.name)}</td><td>${loc.page}</td><td>${loc.sheet} / ${loc.side}</td><td>${loc.row} / ${loc.column}</td></tr>`; }).join("")}</tbody></table>`;
    window.print();
  });
  window.addEventListener("pagehide", event => { if (!event.persisted) { master.close(); controller.stop(); } });
  window.addEventListener("pageshow", event => { if (event.persisted) void controller.sync(); });
}

void initialize().catch(error => {
  el("dex-app").setAttribute("aria-busy", "false");
  el("dex-status").textContent = "Binder could not start";
  el("dex-warning").textContent = error instanceof Error ? error.message : "Reload to try again. Your saved collection is safe.";
  el("dex-warning").hidden = false;
});
