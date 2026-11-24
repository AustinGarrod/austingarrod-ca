import { addSetImports, exportCards, groupSetImport, markKey, reviewCards, type CardExportFormat, type CardExportList, type ReviewedCard, type TcgplayerCondition, type TransferCatalog, type TransferMatch } from "../lib/card-transfer";
import { sameSave, type MasterState } from "../lib/master";
import { nationalEnabled, type BinderState } from "../lib/model";
import { csvByteLimit, mapTransferHeaders, parseTransferCsv, transferFields, transferRows, type ColumnMap, type TransferField, type TransferFormat } from "../lib/transfer-csv";

interface Options {
  catalog(): TransferCatalog;
  scope(): string;
  sets(): Promise<MasterState>;
  dex(): BinderState;
  species(): Promise<(match: TransferMatch) => readonly number[]>;
  saveSets(apply: (state: MasterState) => void): Promise<void>;
  saveDex(ids: number[], expected: BinderState, current: () => boolean): Promise<void>;
  selected(): string;
  download(text: string, name: string, type: string): void;
}

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => get<HTMLSelectElement>(id);
const button = (id: string) => get<HTMLButtonElement>(id);
const labelFor = (label: string, control: HTMLElement) => {
  const element = document.createElement("label");
  element.append(document.createTextNode(label), control);
  return element;
};

export function createTransfers(options: Options) {
  const importDialog = get<HTMLDialogElement>("card-import-dialog");
  const exportDialog = get<HTMLDialogElement>("card-export-dialog");
  const file = get<HTMLInputElement>("card-import-file");
  const filename = get("card-import-filename"), columns = get("card-import-columns");
  const form = get<HTMLFormElement>("card-import-form");
  const target = select("card-import-target"), format = select("card-import-format");
  const reviewPanel = get("card-import-review"), previewButton = button("card-import-preview");
  const status = get("card-import-status"), error = get("card-import-error");
  const applyButton = button("card-import-apply"), rowList = get("card-review-rows");
  const filter = select("card-review-filter"), mappingPanel = get<HTMLDetailsElement>("card-import-mapping");
  const destinations = new Map<string, string>();
  const choices = new Map<number, TransferMatch>();
  const pageSize = 30;
  let generation = 0, page = 0, busy = false;
  let parsed: ReturnType<typeof parseTransferCsv> | null = null;
  let review: { rows: ReviewedCard[]; forDex: boolean; beforeSets: MasterState; beforeDex: BinderState;
    ids: (match: TransferMatch) => readonly number[]; current: () => boolean } | null = null;

  function clearReview() {
    generation++;
    review = null;
    page = 0;
    choices.clear();
    destinations.clear();
    reviewPanel.hidden = true;
    rowList.replaceChildren();
    get("card-import-destinations").replaceChildren();
    error.textContent = status.textContent = "";
  }
  function setBusy(value: boolean) {
    busy = value;
    previewButton.disabled = value || !parsed;
    target.disabled = format.disabled = file.disabled = value;
    for (const control of columns.querySelectorAll<HTMLSelectElement>("select")) control.disabled = value;
    for (const control of reviewPanel.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) {
      if (!control.hasAttribute("data-close-dialog")) control.disabled = value;
    }
  }
  function openImport() {
    if (importDialog.open) return;
    clearReview();
    parsed = null;
    form.reset();
    setBusy(false);
    mappingPanel.hidden = true;
    mappingPanel.open = false;
    importDialog.showModal();
  }
  importDialog.addEventListener("close", () => {
    clearReview();
    parsed = null;
    file.value = "";
    filename.textContent = "";
    filename.hidden = true;
    columns.replaceChildren();
    setBusy(false);
  });
  function showColumns() {
    if (!parsed) return;
    const { headers } = parsed;
    const { format: detected, mapping } = mapTransferHeaders(headers, format.value as TransferFormat);
    mappingPanel.hidden = false;
    mappingPanel.open = detected === "custom" && (mapping.set === undefined || (mapping.name === undefined && mapping.number === undefined));
    const labels = (Object.keys(transferFields) as TransferField[]).map(field => {
      const control = document.createElement("select");
      control.dataset.field = field;
      control.disabled = busy;
      control.append(new Option("Skip column", ""), ...headers.map((header, i) => new Option(header || `Column ${i + 1}`, String(i))));
      control.value = mapping[field] === undefined ? "" : String(mapping[field]);
      control.addEventListener("change", clearReview);
      return labelFor(transferFields[field], control);
    });
    columns.replaceChildren(...labels);
    if (detected !== "custom") status.textContent = `Using ${({ tcgcollector: "TCG Collector", collectr: "Collectr", tcgplayer: "TCGplayer" })[detected]} columns.`;
  }
  file.addEventListener("change", async () => {
    clearReview();
    parsed = null;
    mappingPanel.hidden = true;
    const selectedFile = file.files?.[0];
    filename.textContent = selectedFile?.name ?? "";
    filename.hidden = !selectedFile;
    if (!selectedFile) { setBusy(false); return; }
    const ticket = generation;
    setBusy(true);
    try {
      if (selectedFile.size > csvByteLimit) throw new Error("Choose a CSV file up to 8 MB.");
      const bytes = await selectedFile.arrayBuffer();
      if (ticket !== generation) return;
      const first = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
      const encoding = first[0] === 255 && first[1] === 254 ? "utf-16le" : first[0] === 254 && first[1] === 255 ? "utf-16be" : "utf-8";
      let text: string;
      try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
      catch { throw new Error("Save the file as UTF-8 CSV and try again."); }
      parsed = parseTransferCsv(text);
      showColumns();
    } catch (cause) {
      if (ticket === generation) error.textContent = cause instanceof Error ? cause.message : "The CSV could not be read.";
    } finally { if (ticket === generation) setBusy(false); }
  });
  format.addEventListener("change", () => {
    clearReview();
    try { showColumns(); }
    catch (cause) { error.textContent = (cause as Error).message; mappingPanel.hidden = true; }
  });
  target.addEventListener("change", clearReview);

  const matched = (row: ReviewedCard) => choices.get(row.line) ?? row.match;
  function results() {
    const data = review!;
    const matches = data.rows.flatMap(row => {
      const match = matched(row);
      return match && (!data.forDex || data.ids(match).length) ? [match] : [];
    });
    const groups = data.forDex ? [] : groupSetImport(matches, data.beforeSets);
    const ids = data.forDex ? [...new Set(matches.flatMap(match => data.ids(match)))] : [];
    return { matches, groups, ids };
  }
  function drawRows() {
    const data = review!;
    const ownedDex = new Set(data.beforeDex.ownedDexIds);
    const ownedByBinder = new Map(data.beforeSets.binders.map(binder => [binder.id, new Set(binder.owned)]));
    const rows = data.rows.filter(row => {
      if (filter.value === "review") return !!row.choices;
      if (filter.value === "skipped") {
        const match = matched(row);
        return !match || (data.forDex && !data.ids(match).length);
      }
      return true;
    });
    page = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    const nodes = rows.slice(page * pageSize, (page + 1) * pageSize).map(row => {
      const item = document.createElement("li"), detail = document.createElement("small");
      const match = matched(row);
      item.textContent = `Row ${row.line} · ${row.label}`;
      function updateDetail(current?: TransferMatch) {
        if (!current) { detail.textContent = row.reason ?? "Skipped"; return; }
        const ids = data.forDex ? data.ids(current) : [];
        if (data.forDex && !ids.length) { detail.textContent = "No mapped Pokémon species"; return; }
        const target = destinations.get(current.set.id) ?? "";
        const alreadyOwned = data.forDex ? ids.every(id => ownedDex.has(id)) : ownedByBinder.get(target)?.has(markKey(current));
        detail.textContent = `${alreadyOwned ? "Already owned" : "Matched"} · ${current.set.name} #${current.card.number} · ${current.card.name}${current.variant ? ` · ${current.variant.label}` : ""}`;
      }
      updateDetail(match);
      item.append(detail);
      if (row.choices) {
        const control = document.createElement("select");
        control.append(new Option("Skip this row", ""));
        row.choices.forEach((choice, i) => control.add(new Option(`${choice.set.name} #${choice.card.number} · ${choice.card.name}${choice.variant ? ` · ${choice.variant.label}` : ""}`, String(i))));
        control.value = match ? String(row.choices.indexOf(match)) : "";
        control.addEventListener("change", () => {
          if (control.value === "") choices.delete(row.line);
          else choices.set(row.line, row.choices![Number(control.value)]);
          drawSummary();
          updateDetail(matched(row));
        });
        item.append(labelFor(`Match row ${row.line}`, control));
      }
      return item;
    });
    rowList.replaceChildren(...nodes);
    get("card-review-pager").hidden = rows.length <= pageSize;
    get("card-review-page").textContent = `${page + 1} of ${Math.max(1, Math.ceil(rows.length / pageSize))}`;
    button("card-review-prev").disabled = page === 0;
    button("card-review-next").disabled = (page + 1) * pageSize >= rows.length;
  }
  function drawSummary(focusSet?: string) {
    const data = review!;
    const { matches, groups, ids } = results();
    const skipped = data.rows.length - matches.length;
    const multipleCopies = data.rows.filter(row => row.quantity > 1 && matched(row)).length;
    const list = get("card-import-destinations");
    let added = 0, already = 0, missingTarget = false;
    if (data.forDex) {
      const owned = new Set(data.beforeDex.ownedDexIds);
      already = ids.filter(id => owned.has(id)).length;
      added = ids.length - already;
      list.textContent = nationalEnabled(data.beforeDex) ? "" : "This import will add the National Pokédex binder.";
    } else {
      const controls = groups.map(group => {
        const selected = destinations.get(group.set.id) ?? (group.options.length === 1 ? group.options[0].id : "");
        if (selected) destinations.set(group.set.id, selected);
        const destination = group.options.find(binder => binder.id === selected);
        const countOwned = new Set(destination?.owned);
        const owned = group.marks.filter(mark => countOwned.has(markKey(mark))).length;
        already += owned;
        added += group.marks.length - owned;
        const field = document.createElement("p");
        if (group.options.length <= 1) {
          field.textContent = `${group.set.name} · ${destination?.name ?? "Create set binder"} · ${group.marks.length} matched`;
          return field;
        }
        missingTarget ||= !destination;
        const control = document.createElement("select");
        control.dataset.set = group.set.id;
        control.append(new Option("Choose a binder", ""), ...group.options.map(binder => new Option(binder.name, binder.id)));
        control.value = selected;
        control.addEventListener("change", () => { destinations.set(group.set.id, control.value); drawSummary(group.set.id); drawRows(); });
        return labelFor(`${group.set.name} · ${group.marks.length} matched`, control);
      });
      list.replaceChildren(...controls);
      if (focusSet) list.querySelector<HTMLSelectElement>(`select[data-set="${focusSet}"]`)?.focus();
    }
    get("card-review-summary").textContent = `${added} to add · ${already} already owned · ${skipped} skipped or need review${multipleCopies ? ` · ${multipleCopies} matching rows with extra copies` : ""}.`;
    applyButton.disabled = busy || missingTarget || (!groups.length && !ids.length);
    applyButton.textContent = data.forDex ? "Add Pokémon" : "Add cards";
  }
  filter.addEventListener("change", () => { page = 0; drawRows(); });
  button("card-review-prev").addEventListener("click", () => { page--; drawRows(); });
  button("card-review-next").addEventListener("click", () => { page++; drawRows(); });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!parsed || busy) return;
    clearReview();
    const ticket = generation, scope = options.scope(), forDex = target.value === "dex";
    const current = () => ticket === generation && scope === options.scope() && importDialog.open;
    setBusy(true);
    status.textContent = "Matching cards…";
    try {
      if (mappingPanel.hidden) showColumns();
      const mapping: ColumnMap = {};
      for (const control of columns.querySelectorAll<HTMLSelectElement>("select")) {
        if (control.value) mapping[control.dataset.field as TransferField] = Number(control.value);
      }
      const { rows, invalid } = transferRows(parsed, mapping);
      const [matches, beforeSets, ids] = await Promise.all([
        reviewCards(rows, options.catalog(), forDex),
        forDex ? { schemaVersion: 1 as const, binders: [] } : options.sets(),
        forDex ? options.species() : () => [],
      ]);
      if (!current()) return;
      const invalidRows = invalid.map(line => ({ line, label: "Unrecognized row", reason: "Column count differs from the header", quantity: 0 }));
      review = { rows: [...matches, ...invalidRows].sort((a, b) => a.line - b.line), forDex, beforeSets,
        beforeDex: options.dex(), ids, current };
      filter.value = "all";
      reviewPanel.hidden = false;
      status.textContent = "";
    } catch (cause) {
      if (current()) error.textContent = cause instanceof Error ? cause.message : "The preview could not be prepared. Try again.";
    } finally {
      if (current()) {
        setBusy(false);
        if (review) { drawSummary(); drawRows(); }
      }
    }
  });
  applyButton.addEventListener("click", async () => {
    const data = review;
    if (!data || busy) return;
    if (!data.current()) { error.textContent = "The account changed. Review the import again."; return; }
    const { groups, ids } = results();
    const selectedDestinations = new Map(destinations);
    setBusy(true);
    error.textContent = "";
    status.textContent = "Saving ownership…";
    try {
      if (data.forDex) await options.saveDex(ids, data.beforeDex, data.current);
      else await options.saveSets(state => {
        if (!data.current() || !groups.length || !sameSave(data.beforeSets, state)) throw new Error("The binder collection changed. Preview the import again.");
        addSetImports(state, groups, selectedDestinations);
      });
      if (data.current()) {
        get("transfer-message").textContent = data.forDex
          ? `Saved Pokédex ownership for ${ids.length} Pokémon.` : `Saved ${groups.reduce((total, group) => total + group.marks.length, 0)} distinct printings across ${groups.length} set binders.`;
        importDialog.close();
      }
    } catch (cause) {
      if (data.current()) error.textContent = cause instanceof Error ? cause.message : "The import could not be saved. Try again.";
    } finally {
      if (data.current()) { setBusy(false); status.textContent = ""; drawSummary(); drawRows(); }
    }
  });

  const exportScope = select("card-export-scope"), exportFormat = select("card-export-format");
  const exportList = select("card-export-list");
  const exportCondition = select("card-export-tcgplayer-condition");
  const exportButton = button("card-export-download"), exportError = get("card-export-error"), exportStatus = get("card-export-status");
  let exportGeneration = 0;
  function updateExportOptions() {
    const tcgplayer = exportFormat.value === "tcgplayer";
    const missing = exportList.value === "missing";
    get("card-export-owned-help").hidden = missing;
    get("card-export-missing-help").hidden = !missing;
    get("card-export-binderloot-help").hidden = exportFormat.value !== "binderloot";
    get("card-export-tcgplayer-options").hidden = !tcgplayer;
    exportCondition.required = tcgplayer;
    exportCondition.disabled = !tcgplayer;
  }
  for (const field of [exportList, exportScope, exportFormat, exportCondition]) field.addEventListener("change", () => {
    exportStatus.textContent = exportError.textContent = "";
    updateExportOptions();
  });
  exportDialog.addEventListener("close", () => { exportGeneration++; });
  button("export-cards").addEventListener("click", async () => {
    const scope = options.scope(), ticket = ++exportGeneration;
    exportStatus.textContent = exportError.textContent = "";
    exportScope.replaceChildren();
    exportScope.disabled = exportFormat.disabled = exportList.disabled = false;
    updateExportOptions();
    exportButton.disabled = true;
    exportDialog.showModal();
    try {
      const state = await options.sets();
      if (ticket !== exportGeneration || scope !== options.scope()) return;
      exportScope.replaceChildren(new Option("All set binders", ""), ...state.binders.map(binder => new Option(binder.name, binder.id)));
      exportScope.value = options.selected();
      if (exportScope.selectedIndex < 0) exportScope.value = "";
      exportButton.disabled = !state.binders.length;
    } catch { if (ticket === exportGeneration) exportError.textContent = "The collection could not be read. Try again."; }
  });
  get("card-export-form").addEventListener("submit", async event => {
    event.preventDefault();
    const scope = options.scope(), ticket = exportGeneration, id = exportScope.value;
    const format = exportFormat.value as CardExportFormat;
    const list = exportList.value as CardExportList;
    const condition = exportCondition.value as TcgplayerCondition;
    const current = () => exportDialog.open && ticket === exportGeneration && scope === options.scope();
    exportButton.disabled = exportScope.disabled = exportFormat.disabled = exportList.disabled = exportCondition.disabled = true;
    exportError.textContent = "";
    exportStatus.textContent = `Preparing ${list} cards…`;
    try {
      const state = await options.sets();
      const binders = id ? state.binders.filter(binder => binder.id === id) : state.binders;
      if (!binders.length) throw new Error("The selected binders changed. Choose them again.");
      const output = await exportCards(binders, options.catalog(), { format, list, condition });
      if (!current()) return;
      const exportedLabel = list === "missing" ? "missing entries exported" : "distinct printings";
      exportStatus.textContent = `${output.exported} ${exportedLabel} · ${output.omitted} entries omitted.`;
      const filename = format === "tcgplayer" && list === "owned" ? "tcgplayer-mobile-collection.csv" : `${list}-cards-${format}.csv`;
      if (output.exported) options.download(output.text, filename, "text/csv;charset=utf-8");
      else exportError.textContent = `There are no ${list} cards for this export format.`;
    } catch (cause) {
      if (current()) { exportStatus.textContent = ""; exportError.textContent = (cause as Error).message; }
    } finally {
      if (current()) {
        exportButton.disabled = exportScope.disabled = exportFormat.disabled = exportList.disabled = false;
        updateExportOptions();
      }
    }
  });
  for (const id of ["first-import", "import-cards"]) button(id).addEventListener("click", openImport);
  return { scopeChanged() { importDialog.close(); exportDialog.close(); } };
}
