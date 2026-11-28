import { loadBinderCards } from "../lib/binder-catalog";
import { binderShareToken, type SharedBinder } from "../lib/binder-share";
import { catalogArtwork } from "../lib/catalog-search";
import { sortSetChecklist, type SetChecklistSort } from "../lib/checklist";
import { isCardPocket, setPockets, type SetCard, type SetSummary } from "../lib/master";
import { cardStatus, cardStatusLabel, nationalRows, normalizeSearch, searchSpecies, validateState,
  type BinderSettings, type PocketLocation, type Species } from "../lib/model";
import { binderChecklist } from "./binder-checklist";
import { binderPages, blankPocket, cardPocket, escape, filterControl, showDetailsSheet } from "./binder-pages";

const root = "/utilities/pokedex-binder/";
const catalogRoot = root + "catalog/";
const masterRoot = catalogRoot + "master-sets/";
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const workspace = (set: boolean) => el((set ? "master-" : "") + "shared-workspace");
const countFormat = new Intl.NumberFormat("en-CA");

interface Card extends PocketLocation {
  key: string;
  name: string;
  number: string;
  detail: string;
  image: string | null;
  owned: boolean;
  ordered: boolean;
  required: boolean;
  group: string;
}
interface Collection {
  name: string;
  label: string;
  goal: string;
  settings: BinderSettings;
  cards: Card[];
  spaces: Map<number, { label: string; filler: boolean }>;
  species?: Species[];
  referenceSets?: Record<string, { name: string; code: string | null }>;
}

async function catalog<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "omit", cache: "no-cache", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("Catalog unavailable");
  return response.json();
}

async function collection(binder: SharedBinder): Promise<Collection> {
  const spaces: Collection["spaces"] = new Map();
  if (binder.kind === "national") {
    const { species, sets } = await catalog<{ species: Species[]; sets: NonNullable<Collection["referenceSets"]> }>(catalogRoot + "index.json");
    const state = validateState({ ...binder, schemaVersion: 1 }, species);
    const cards = nationalRows(species, state).map((row, index) => ({
      ...row, key: String(row.number), number: String(row.number).padStart(4, "0"),
      detail: "Generation " + species[index].generation, group: String(species[index].generation),
      required: true, image: root + "sprites/" + row.number + ".png",
    }));
    return { name: "National Pokédex", label: "", goal: "All species · Any card counts", settings: state.settings,
      cards, spaces, species, referenceSets: sets };
  }
  const [sets, checklist] = await Promise.all([
    catalog<SetSummary[]>(masterRoot + "index.json"),
    loadBinderCards(binder, id => catalog<SetCard[]>(masterRoot + encodeURIComponent(id) + ".json")),
  ]);
  const byId = new Map(sets.map(set => [set.id, set]));
  const set = byId.get(binder.setId);
  const cards: Card[] = [];
  const capacity = binder.settings.rows * binder.settings.columns;
  for (const pocket of setPockets(binder, checklist)) {
    if (isCardPocket(pocket)) {
      const source = pocket.sourceSetId ? byId.get(pocket.sourceSetId) : set;
      cards.push({
        ...pocket, image: source && pocket.category !== "Extra" ? catalogArtwork(source, pocket.number) : null,
        detail: [pocket.finish, pocket.sourceSetId && source?.name, !pocket.required && "Optional"].filter(Boolean).join(" · "),
        group: pocket.finish,
      });
    } else {
      const filler = "filler" in pocket;
      spaces.set((pocket.page - 1) * capacity + pocket.pocket,
        { label: filler ? "Filler after #" + pocket.number : "Blank before next section", filler });
    }
  }
  const label = set?.name === binder.name ? (set.code ?? "") : [set?.name ?? binder.setId, set?.code].filter(Boolean).join(" · ");
  const goal = binder.goal === "numbers" ? "One of each number" : "Every selected finish";
  return { name: binder.name, label, goal, settings: binder.settings, cards, spaces };
}

function showProgress(data: Collection) {
  const required = data.cards.filter(card => card.required);
  const owned = required.filter(card => card.owned).length;
  const ordered = required.filter(card => card.ordered && !card.owned).length;
  const extras = data.cards.filter(card => !card.required);
  const percent = required.length ? (100 * owned / required.length).toFixed(1) : "0";
  el("shared-owned").textContent = countFormat.format(owned);
  el("shared-ordered").textContent = countFormat.format(ordered);
  el("shared-missing").textContent = countFormat.format(required.length - owned - ordered);
  el("shared-percent").textContent = percent + "% complete";
  el("shared-progress-line").textContent = `${countFormat.format(owned)} of ${countFormat.format(required.length)} collected · ${countFormat.format(ordered)} ordered`;
  el("shared-goal").textContent = data.goal + (extras.length ? ` · Optional extras ${countFormat.format(extras.filter(card => card.owned).length)}/${countFormat.format(extras.length)}` : "");
  const progress = el<HTMLProgressElement>("shared-bar");
  progress.max = required.length || 1;
  progress.value = owned;
  el("shared-progress").hidden = false;
}

function showCollection(data: Collection, isSet: boolean) {
  const prefix = isSet ? "master-" : "";
  const group = el<HTMLSelectElement>(isSet ? "shared-finish" : "shared-generation");
  const status = el<HTMLSelectElement>(isSet ? "master-status" : "dex-filter");
  const search = el<HTMLInputElement>(isSet ? "master-search" : "dex-search");
  const format = { pages: el<HTMLButtonElement>(prefix + "view-binder"), list: el<HTMLButtonElement>(prefix + "view-checklist") };
  const pagesView = el(prefix + "binder-view");
  const listView = el(isSet ? "master-checklist" : "checklist-view");
  const details = el(prefix + "pokemon-details");
  const clear = el<HTMLButtonElement>(prefix + "checklist-clear-filters");
  const capacity = data.settings.rows * data.settings.columns;
  const cards = new Map(data.cards.map(card => [card.key, card]));
  const positions = new Map(data.cards.map(card => [(card.page - 1) * capacity + card.pocket, card]));
  const lastPocket = Math.max(data.settings.leadingBlankPockets, ...data.spaces.keys(), ...positions.keys());
  const pages = Math.max(1, Math.ceil(lastPocket / capacity));
  const counts = new Map<number, { total: number; owned: number }>();
  for (const card of data.cards) {
    if (!card.required) continue;
    const count = counts.get(card.page) ?? { total: 0, owned: 0 };
    count.total++;
    if (card.owned) count.owned++;
    counts.set(card.page, count);
  }
  if (isSet) {
    for (const finish of [...new Set(data.cards.map(card => card.group))].sort()) group.add(new Option(finish, finish));
  }
  let page = 1;
  let selected: Card | undefined;
  let displayed: Card | undefined;
  let list = false;
  const checklist = binderChecklist(prefix, status, draw, true);
  const showFilterCount = filterControl(prefix, [status, group]);
  const drawPages = binderPages(prefix, next => {
    page = next;
    selected = undefined;
    draw();
  });
  const pocketId = (card: Card) => (isSet ? "set-" : "") + "open-grid-" + card.key;
  const numberLabel = (card: Card) => card.number && "#" + card.number;
  const showStatus = (card: Card) => cardStatus(card.owned, card.ordered);

  function draw() {
    const query = normalizeSearch(search.value.trim());
    const wantedSpecies = query && data.species ? new Set(searchSpecies(data.species, search.value).map(item => String(item.id))) : null;
    const showList = list || !!query;
    showFilterCount();
    [format.pages, format.list].forEach((button, index) => button.setAttribute("aria-pressed", String(showList === !!index)));
    pagesView.hidden = showList;
    listView.hidden = !showList;
    const matches = (card: Card) => (status.value === "all" || status.value === showStatus(card)) &&
      (group.value === "all" || group.value === card.group) &&
      (!query || (wantedSpecies ? wantedSpecies.has(card.key) : normalizeSearch(card.name + " " + card.number + " " + card.detail).includes(query)));
    if (showList) {
      const filtered = data.cards.filter(matches);
      const sort = checklist.sort.value;
      const rows = sort === "dex-desc" ? filtered.reverse()
        : sort === "dex" ? filtered : sortSetChecklist(filtered, sort as SetChecklistSort);
      clear.hidden = !query && status.value === "all" && group.value === "all";
      checklist.render(rows, card => ({ ...card, number: numberLabel(card) }));
    } else {
      const cells = Array.from({ length: capacity }, (_, index) => {
        const pocket = index + 1;
        const position = (page - 1) * capacity + pocket;
        const card = positions.get(position);
        if (!card) {
          const blank = data.spaces.get(position);
          return blankPocket(pocket, blank?.label ?? (position <= data.settings.leadingBlankPockets ? "Reserved" : "Empty pocket"), blank?.filler);
        }
        return cardPocket({ ...card, id: card.key, number: numberLabel(card), finish: isSet ? card.detail : undefined,
          set: isSet, readOnly: true, selected: selected === card, dimmed: !matches(card) });
      });
      drawPages(page, pages, data.settings, counts, cells);
    }
    const nextDetail = showList ? undefined : selected;
    details.hidden = !nextDetail;
    pagesView.classList.toggle("has-details", !!nextDetail);
    if (nextDetail !== displayed) {
      displayed = nextDetail;
      details.replaceChildren();
      if (nextDetail) showDetails(nextDetail);
    }
  }

  function showDetails(card: Card) {
    const state = showStatus(card);
    const location = [["Page", card.page], ["Row", card.row], ["Column", card.column],
      ["Sheet", card.sheet + " · " + (card.side === "front" ? "Front" : "Back")]];
    details.innerHTML = `<div class="dex-detail-hero">${card.image ? `<img src="${escape(card.image)}" alt="" width="80" height="80" />` : ""}
      <div><p class="dex-eyebrow">${escape(numberLabel(card))}</p><h2>${escape(card.name)}</h2><p>${escape(card.detail)}</p></div>
      <button type="button" class="dex-details-close" data-close-details aria-label="Close details">×</button></div>
      <div class="dex-detail-body ${state}"><div class="dex-location">${location.map(([label, value]) =>
        `<div><span class="dex-label">${label}</span><strong>${value}</strong></div>`).join("")}</div>
      <p class="dex-read-status">${cardStatusLabel[state]}</p></div>`;
    if (data.referenceSets) {
      const disclosures = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "English card printings";
      disclosures.append(summary);
      disclosures.addEventListener("toggle", () => {
        if (disclosures.open) void showPrintings(disclosures, card.key, data.referenceSets!);
      }, { once: true });
      details.querySelector(".dex-detail-body")?.append(disclosures);
    }
  }

  function closeDetails() {
    if (!displayed) return;
    const id = pocketId(displayed);
    selected = undefined;
    draw();
    el(id)?.focus({ preventScroll: true });
  }
  search.addEventListener("input", () => {
    selected = undefined;
    checklist.filterChanged();
  });
  status.addEventListener("change", checklist.filterChanged);
  group.addEventListener("change", checklist.filterChanged);
  format.pages.addEventListener("click", () => {
    list = false;
    search.value = "";
    draw();
  });
  format.list.addEventListener("click", () => { list = true; draw(); });
  clear.addEventListener("click", () => {
    search.value = "";
    status.value = group.value = "all";
    checklist.filterChanged();
    search.focus();
  });
  workspace(isSet).addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLButtonElement>("button");
    if (target?.hasAttribute("data-close-details")) { closeDetails(); return; }
    const key = target?.dataset.setJump ?? target?.dataset.goto ?? target?.dataset.setOpen ?? target?.dataset.pokemon;
    const card = key && cards.get(key);
    if (!card || !target) return;
    if (target.classList.contains("dex-checklist-jump")) {
      list = false;
      search.value = "";
      page = card.page;
    }
    selected = card;
    draw();
    el(pocketId(card))?.focus();
    showDetailsSheet(details, pocketId(card));
  });
  workspace(isSet).addEventListener("keydown", event => {
    if (event.key === "Escape" && displayed) { event.preventDefault(); closeDetails(); }
  });
  el("shared-title").textContent = data.name;
  el("shared-set-label").textContent = data.label;
  el("shared-set-label").hidden = !data.label;
  el("shared-read-only").hidden = false;
  showProgress(data);
  workspace(isSet).hidden = false;
  draw();
}

async function showPrintings(node: HTMLElement, species: string, sets: NonNullable<Collection["referenceSets"]>) {
  const output = document.createElement("div");
  output.className = "dex-printings";
  output.textContent = "Loading card printings…";
  node.append(output);
  try {
    const printings = await catalog<{ setId: string; number: string; name: string }[]>(catalogRoot + "printings/" + species + ".json");
    for (const printing of printings) {
      const row = document.createElement("div");
      row.textContent = [printing.name, sets[printing.setId]?.name, "#" + printing.number].filter(Boolean).join(" · ");
      output.append(row);
    }
    if (printings.length) output.firstChild?.remove();
    else output.textContent = "No English printings are listed.";
  } catch {
    output.textContent = "Card printings couldn’t load.";
  }
}

async function load() {
  const notice = el("shared-notice");
  const message = el("shared-message");
  const retry = el("shared-retry");
  retry.hidden = true;
  message.textContent = "Loading shared binder…";
  const token = location.hash.slice(1);
  if (!binderShareToken.test(token)) {
    message.textContent = "This shared binder is unavailable. Check the link or ask the owner for a new one.";
    return;
  }
  try {
    const response = await fetch("/api/v1/binder-share.php", { credentials: "omit", mode: "same-origin",
      cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "X-Binder-Share-Token": token } });
    if (response.status === 404) {
      message.textContent = "This shared binder is unavailable. Check the link or ask the owner for a new one.";
      return;
    }
    if (!response.ok) throw new Error("Share unavailable");
    const binder = await response.json() as SharedBinder;
    const data = await collection(binder);
    if (location.hash.slice(1) !== token) return;
    showCollection(data, binder.kind === "set");
    notice.hidden = true;
  } catch {
    message.textContent = "The shared binder couldn’t load. Try again.";
    retry.hidden = false;
  }
}

el("shared-retry").addEventListener("click", () => void load());
document.querySelector(".skip-link")?.addEventListener("click", event => {
  event.preventDefault();
  const main = el("main");
  main.tabIndex = -1;
  main.focus();
});
window.addEventListener("hashchange", () => location.reload());
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void load();
