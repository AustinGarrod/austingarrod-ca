import type { PocketLocation } from "../lib/model";

interface ChecklistRow extends Pick<PocketLocation, "page" | "row" | "column"> {
  key: string | number;
  name: string;
  number: string;
  detail?: string;
  image?: string | null;
  actionLabel?: string;
  owned: boolean;
  ordered: boolean;
}

function setText(node: Element, text: string) {
  // Leave unchanged text nodes in place so a sync refresh preserves text selection.
  if (node.textContent !== text) node.textContent = text;
}

export function binderChecklist(prefix: "" | "master-", status: HTMLSelectElement, onChange: () => void) {
  const isSet = prefix === "master-";
  const id = (suffix: string) => prefix + "checklist-" + suffix;
  const element = <T extends HTMLElement = HTMLElement>(suffix: string) => document.getElementById(id(suffix)) as T;
  const list = document.getElementById(isSet ? "master-list" : id("list"))!;
  const count = document.getElementById(isSet ? "master-list-count" : id("count"))!;
  const template = element<HTMLTemplateElement>("row-template");
  const sort = element<HTMLSelectElement>("sort");
  const hideCollected = element<HTMLInputElement>("hide-collected");
  const letters = element("letters");
  const more = element<HTMLButtonElement>("more");
  const pageSize = 100;
  let limit = pageSize;
  let selectedKey: string | null = null;
  const firstByLetter = new Map<string, number>();
  let drawVisible = () => {};

  function filterChanged() {
    limit = pageSize;
    onChange();
  }
  sort.addEventListener("change", filterChanged);
  hideCollected.addEventListener("change", () => {
    status.value = hideCollected.checked ? "missing" : "all";
    filterChanged();
  });

  function highlight(row: HTMLElement, selected: boolean) {
    row.classList.toggle("selected", selected);
    row.querySelector(".dex-checklist-name")!.setAttribute("aria-pressed", String(selected));
  }
  list.addEventListener("click", event => {
    const target = event.target as Element;
    const row = target.closest<HTMLElement>("[data-checklist-row]");
    if (!row || target.closest(".dex-status-control, .dex-checklist-jump")) return;
    const previous = list.querySelector<HTMLElement>(".selected");
    if (previous && previous !== row) highlight(previous, false);
    selectedKey = row.dataset.checklistRow!;
    highlight(row, true);
  });
  letters.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-letter]");
    const index = button && firstByLetter.get(button.dataset.letter!);
    if (index == null) return;
    if (index >= limit) {
      limit = Math.ceil((index + 1) / pageSize) * pageSize;
      drawVisible();
    }
    const row = list.children[index];
    row.scrollIntoView({ block: "center" });
    row.querySelector<HTMLButtonElement>(".dex-checklist-name")!.focus({ preventScroll: true });
  });
  more.addEventListener("click", () => {
    limit += pageSize;
    drawVisible();
  });

  function updateRow(entry: ChecklistRow, key: string) {
    const rowId = id("row-" + key);
    let row = document.getElementById(rowId);
    if (!row) {
      row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.id = rowId;
      row.dataset.checklistRow = key;
      for (const radio of row.querySelectorAll<HTMLInputElement>(".dex-status-control input")) {
        radio.name = (isSet ? "set-list-status-" : "list-status-") + key;
        // "Have it" keeps the id and data attribute of the checkbox it replaced.
        radio.id = radio.value === "owned" ? (isSet ? "set-list-" : "owned-list-") + key : (isSet ? "set-list-" : "list-") + radio.value + "-" + key;
        radio.dataset[isSet ? "setStatus" : "dexStatus"] = key;
        if (radio.value === "owned") radio.dataset[isSet ? "key" : "owned"] = key;
      }
      row.querySelector<HTMLButtonElement>(".dex-checklist-jump")!.dataset[isSet ? "setJump" : "goto"] = key;
    }
    row.classList.toggle("owned", entry.owned);
    row.classList.toggle("ordered", entry.ordered);
    highlight(row, selectedKey === key);
    const actionLabel = entry.actionLabel ?? entry.name;
    const status = entry.owned ? "owned" : entry.ordered ? "ordered" : "missing";
    for (const radio of row.querySelectorAll<HTMLInputElement>(".dex-status-control input")) radio.checked = radio.value === status;
    const group = row.querySelector(".dex-status-control")!;
    if (group.getAttribute("aria-label") !== "Status of " + actionLabel) group.setAttribute("aria-label", "Status of " + actionLabel);
    const name = row.querySelector(".dex-checklist-name")!;
    setText(name, entry.name);
    name.setAttribute("aria-label", "Highlight " + actionLabel);
    setText(row.querySelector(".dex-label")!, entry.number);
    const detail = row.querySelector<HTMLElement>(".dex-checklist-card-numbers")!;
    setText(detail, entry.detail ?? "");
    detail.hidden = !entry.detail;
    const image = row.querySelector("img")!;
    if (image.getAttribute("src") !== (entry.image ?? null)) {
      if (entry.image) image.setAttribute("src", entry.image);
      else image.removeAttribute("src");
      image.hidden = !entry.image;
    }
    const location = row.querySelector(".dex-checklist-location")!;
    const locationLabel = `Page ${entry.page} · Row ${entry.row}, column ${entry.column}`;
    if (location.getAttribute("aria-label") !== locationLabel) {
      location.setAttribute("aria-label", locationLabel);
      const [page, rowNumber, column] = location.querySelectorAll("strong");
      setText(page, String(entry.page));
      setText(rowNumber, String(entry.row));
      setText(column, String(entry.column));
    }
    row.querySelector(".dex-checklist-jump")!.setAttribute("aria-label", "Go to " + actionLabel + " binder page");
    return row;
  }

  function render<T extends { name: string }>(items: readonly T[], describe: (item: T) => ChecklistRow) {
    hideCollected.checked = status.value === "missing";
    letters.hidden = sort.value !== "name" && sort.value !== "name-desc";
    firstByLetter.clear();
    if (!letters.hidden) {
      items.forEach((item, index) => {
        const initial = item.name.charAt(0).toUpperCase();
        if (!firstByLetter.has(initial)) firstByLetter.set(initial, index);
      });
      for (const button of letters.querySelectorAll<HTMLButtonElement>("[data-letter]")) {
        button.disabled = !firstByLetter.has(button.dataset.letter!);
      }
    }
    drawVisible = () => {
      const unit = isSet ? (items.length === 1 ? "card" : "cards") : "Pokémon";
      more.hidden = items.length <= limit;
      setText(count, `${items.length} ${unit}${more.hidden ? "" : " · Showing " + limit}`);
      const visible = items.slice(0, limit).map(describe);
      const keys = new Set(visible.map(entry => String(entry.key)));
      for (const row of list.querySelectorAll<HTMLElement>("[data-checklist-row]")) {
        if (!keys.has(row.dataset.checklistRow!)) row.remove();
      }
      if (!visible.length) {
        if (!list.firstElementChild) {
          const message = document.createElement("p");
          message.className = "dex-help";
          message.textContent = isSet ? "No cards match these filters." : "No Pokémon match these filters.";
          list.append(message);
        }
        return;
      }
      list.querySelector(".dex-help")?.remove();
      visible.forEach((entry, index) => {
        const row = updateRow(entry, String(entry.key));
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
      });
    };
    drawVisible();
  }
  return {
    sort,
    resetLimit() { limit = pageSize; },
    resetSelection() { selectedKey = null; },
    render,
  };
}
