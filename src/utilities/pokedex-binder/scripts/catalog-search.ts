import { catalogArtwork, catalogNumberLabel, createCardIndex, searchCards,
  type CatalogPrinting, type CatalogResult, type CatalogSearchIndex, type CatalogSearchSet } from "../lib/catalog-search";
import type { SetCard } from "../lib/master";

const catalogRoot = "/utilities/pokemon-binder/catalog/";
let catalog: Promise<{ index: ReturnType<typeof createCardIndex>; sets: CatalogSearchSet[] }> | undefined;

async function fetchCatalog<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error("Card catalog request failed.");
  return response.json();
}

function cardIndex() {
  catalog ??= fetchCatalog<CatalogSearchIndex>(catalogRoot + "cards.json").then(data => {
    if (data.schemaVersion !== 1 || !Array.isArray(data.sets) || !data.sets.length) throw new Error("Card catalog unavailable.");
    const sets = [...data.sets].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    return { index: createCardIndex(data.sets), sets };
  }).catch(error => {
    catalog = undefined;
    throw error;
  });
  return catalog;
}

function resultButton(text: string, label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function resultContext({ set, number }: CatalogResult) {
  return `#${catalogNumberLabel(number)} · ${set.name}${set.code ? ` (${set.code})` : ""}`;
}

/** A binder that can hold a printing: a set binder's id and name, or "national" for the National Pokédex. */
export interface MarkTarget { id: string; name: string }

export function createCatalogSearch({ cards: loadCards, openPrinting, inline = false, markTargets, markCollected }: {
  cards(setId: string): Promise<SetCard[]>;
  openPrinting(printing: CatalogPrinting): void;
  inline?: boolean;
  /** The existing binders that can hold a printing. Search offers Mark collected only for those. */
  markTargets?(printing: CatalogPrinting): Promise<MarkTarget[]>;
  /** Marks a printing collected in one of its targets and returns a confirmation. */
  markCollected?(printing: CatalogPrinting, targetId: string): Promise<string>;
}) {
  const pageSize = inline ? 8 : 20;
  const prefix = inline ? "buy-catalog-search" : "catalog-search";
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(`${prefix}-${id}`) as T;
  const dialog = inline ? undefined : el<HTMLDialogElement>("dialog");
  const form = el<HTMLFormElement>("form");
  const query = el<HTMLInputElement>("query"), setFilter = el<HTMLSelectElement>("set");
  const results = el<HTMLOListElement>("results"), status = el("status"), pages = el("pages");
  const previous = el<HTMLButtonElement>("prev"), next = el<HTMLButtonElement>("next");
  const retry = el<HTMLButtonElement>("retry"), printingsRetry = el<HTMLButtonElement>("printings-retry");
  const printings = el<HTMLUListElement>("printings"), printingsStatus = el("printings-status");
  const resultsPanel = el("results-panel"), printingsPanel = el("printings-panel");
  const cardName = el("card-name"), cardSet = el("card-set");

  let index: ReturnType<typeof createCardIndex> | undefined, pendingIndex: Promise<void> | undefined;
  let matching: CatalogResult[] = [], offset = 0;
  let selected: CatalogResult | undefined, opener: HTMLButtonElement | undefined, printingOpener: HTMLButtonElement | undefined;
  let renderingToken = 0, timer: ReturnType<typeof setTimeout> | undefined;

  async function loadIndex() {
    if (index) { updateMatches(); return; }
    if (pendingIndex) return;
    status.textContent = "Loading card catalog…";
    retry.hidden = true;
    pendingIndex = (async () => {
      try {
        const data = await cardIndex();
        index = data.index;
        setFilter.append(...data.sets.map(set => new Option(set.code ? `${set.name} (${set.code})` : set.name, set.id)));
        setFilter.disabled = false;
        if (!dialog || dialog.open) updateMatches();
      } catch {
        status.textContent = "The card catalog could not load.";
        retry.hidden = false;
      }
    })();
    try { await pendingIndex; } finally { pendingIndex = undefined; }
  }

  function updateMatches() {
    if (!index) return;
    matching = searchCards(index, query.value, setFilter.value);
    offset = 0;
    renderResults();
  }

  function renderResults() {
    const visible = matching.slice(offset, offset + pageSize);
    results.replaceChildren(...visible.map(result => {
      const row = document.createElement("li"), text = document.createElement("div");
      const title = document.createElement("strong"), subtitle = document.createElement("small");
      title.textContent = result.name;
      subtitle.textContent = resultContext(result);
      text.append(title, subtitle);
      const button = resultButton("Choose printing", `Choose printing for ${result.name}, ${resultContext(result)}`, () => {
        opener = button;
        void choosePrinting(result);
      });
      row.append(text, button);
      return row;
    }));
    const count = matching.length;
    status.textContent = count
      ? `${count.toLocaleString("en-CA")} ${count === 1 ? "card" : "cards"} found.`
      : query.value.trim() || setFilter.value ? "No cards match this search." : "Choose a set or enter a search.";
    pages.hidden = count <= pageSize;
    previous.disabled = offset === 0;
    next.disabled = offset + pageSize >= count;
    el("page").textContent = `${offset + 1}–${offset + visible.length} of ${count.toLocaleString("en-CA")}`;
  }

  async function choosePrinting(result: CatalogResult) {
    selected = result;
    printingOpener = undefined;
    const token = ++renderingToken;
    const loadingActive = () => (!dialog || dialog.open) && token === renderingToken;
    resultsPanel.hidden = true;
    printingsPanel.hidden = false;
    printingsRetry.hidden = true;
    printings.replaceChildren();
    cardName.textContent = result.name;
    cardSet.textContent = resultContext(result);
    printingsStatus.textContent = "Loading printings…";
    cardName.focus();
    try {
      const cards = await loadCards(result.set.id);
      if (!loadingActive()) return;
      const card = cards.find(card => card.number === result.number && card.name === result.name);
      if (!card || !card.variants.length) throw new Error("Printing unavailable.");
      printingsStatus.textContent = "Choose a printing to see prices and history.";
      const choices = card.variants.map(variant => ({
        setId: result.set.id,
        setName: result.set.name,
        number: card.number,
        name: card.name,
        variant: variant.id,
        finish: variant.label,
        image: catalogArtwork(result.set, card.number),
      }));
      const rows = choices.map(printing => {
        const row = document.createElement("li");
        const name = document.createElement("strong");
        name.textContent = printing.finish;
        const actions = document.createElement("div");
        actions.className = "catalog-search-actions";
        const button = resultButton(inline ? "View prices" : "View card", `View ${result.name}, ${printing.finish}`, () => {
          printingOpener = button;
          dialog?.close();
          openPrinting(printing);
        });
        actions.append(button);
        row.append(name, actions);
        return row;
      });
      printings.replaceChildren(...rows);
      if (!inline && markTargets && markCollected) void offerMarks(choices, rows, loadingActive);
    } catch {
      if (!loadingActive()) return;
      printingsStatus.textContent = "Printings for this card could not load.";
      printingsRetry.hidden = false;
    }
  }

  // Adds Mark collected to each printing an existing binder can hold.
  async function offerMarks(choices: CatalogPrinting[], rows: HTMLLIElement[], current: () => boolean) {
    const targets = await Promise.all(choices.map(printing => markTargets!(printing).catch(() => [])));
    if (!current()) return;
    targets.forEach((options, index) => {
      if (!options.length) return;
      const printing = choices[index], label = `${printing.name}, ${printing.finish}`;
      const actions = rows[index].querySelector(".catalog-search-actions")!;
      let destination: HTMLSelectElement | undefined;
      if (options.length > 1) {
        destination = document.createElement("select");
        destination.setAttribute("aria-label", `Binder for ${label}`);
        destination.append(...options.map(option => new Option(option.name, option.id)));
      }
      const mark = resultButton("Mark collected",
        `Mark ${label} collected${destination ? "" : " in " + options[0].name}`, async () => {
          mark.disabled = true;
          try {
            printingsStatus.textContent = await markCollected!(printing, destination?.value ?? options[0].id);
            mark.textContent = "Collected";
          } catch (error) {
            printingsStatus.textContent = error instanceof Error ? error.message : "The card could not be marked. Try again.";
            mark.disabled = false;
          }
        });
      actions.append(...(destination ? [destination] : []), mark);
    });
  }

  function showResults() {
    renderingToken++;
    selected = undefined;
    printingsPanel.hidden = true;
    resultsPanel.hidden = false;
  }

  function turnPage(change: number) {
    offset += change * pageSize;
    renderResults();
    results.querySelector("button")?.focus();
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    clearTimeout(timer);
    void loadIndex();
  });
  query.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void loadIndex(), 130);
  });
  setFilter.addEventListener("change", () => {
    clearTimeout(timer);
    updateMatches();
  });
  previous.addEventListener("click", () => turnPage(-1));
  next.addEventListener("click", () => turnPage(1));
  retry.addEventListener("click", () => void loadIndex());
  el("back").addEventListener("click", () => {
    showResults();
    (opener?.isConnected ? opener : query).focus();
  });
  printingsRetry.addEventListener("click", () => { if (selected) void choosePrinting(selected); });
  dialog?.addEventListener("close", () => {
    clearTimeout(timer);
    renderingToken++;
  });
  if (inline) {
    for (const control of [query, setFilter]) {
      control.addEventListener("focus", () => { if (!index) void loadIndex(); });
    }
    if (query.value || form.contains(document.activeElement)) void loadIndex();
  }

  return {
    open() {
      showResults();
      if (dialog && !dialog.open) dialog.showModal();
      query.focus();
      void loadIndex();
    },
    focus() {
      if (!printingsPanel.hidden) (printingOpener?.isConnected ? printingOpener : cardName).focus();
      else query.focus();
    },
  };
}
