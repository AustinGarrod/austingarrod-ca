import type { BinderSettings } from "../lib/model";
const element = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error("A binder control is missing. Refresh the page.");
  return node as T;
};
export const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function binderPages(prefix: string, turn: (page: number) => void) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => element<T>(prefix + id);
  const select = el<HTMLSelectElement>("page-select");
  select.onchange = () => turn(Number(select.value));
  el("page-prev").onclick = () => turn(Number(select.value) - 1);
  el("page-next").onclick = () => turn(Number(select.value) + 1);
  const overview = el("page-overview");
  overview.onclick = event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-page]");
    if (button) turn(Number(button.dataset.page));
  };
  // The page chips are one tab stop: arrow keys, Home and End move between them, Enter opens a page.
  overview.onkeydown = event => {
    const chips = [...overview.querySelectorAll<HTMLButtonElement>("button[data-page]")];
    const index = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const template = getComputedStyle(overview).gridTemplateColumns;
    const columns = getComputedStyle(overview).display === "grid" && template !== "none" ? template.split(" ").length : 1;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, Home: -index, End: chips.length - 1 - index };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = chips[Math.max(0, Math.min(chips.length - 1, index + steps[event.key]))];
    for (const chip of chips) chip.tabIndex = chip === next ? 0 : -1;
    next.focus();
  };
  return function render(currentPage: number, pages: number, settings: BinderSettings,
    pageCounts: Map<number, {total: number; owned: number}>, cells: string[]) {
    const top = overview.scrollTop;
    const focusedPage = overview.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.page : undefined;
    el("page-total").textContent = String(pages);
    el("capacity-summary").textContent = `${settings.columns} × ${settings.rows} pockets · ${settings.useBackSides ? Math.ceil(pages / 2) : pages} sheets needed · ${settings.useBackSides ? "Both sides" : "Fronts only"}`;
    overview.innerHTML = Array.from({ length: pages }, (_, index) => {
      const page = index + 1, data = pageCounts.get(page) ?? { total: 0, owned: 0 };
      return `<button class="dex-page-chip" id="${prefix}page-chip-${page}" data-page="${page}" tabindex="${page === currentPage ? 0 : -1}" aria-label="Page ${page}, ${data.owned} of ${data.total} collected" ${page === currentPage ? 'aria-current="page"' : ""} style="--filled:${data.total ? data.owned / data.total * 100 : 0}%">${page}</button>`;
    }).join("");
    if (focusedPage) el("page-chip-" + (Number(focusedPage) <= pages ? focusedPage : currentPage)).focus({ preventScroll: true });
    // In the single scrolling row on phones, keep the open page's chip in view.
    if (overview.scrollWidth > overview.clientWidth) {
      const chip = el("page-chip-" + currentPage);
      overview.scrollLeft = chip.offsetLeft - (overview.clientWidth - chip.offsetWidth) / 2;
    }
    el("page-heading").textContent = `Page ${currentPage}`;
    el("sheet-label").textContent = `Sheet ${settings.useBackSides ? Math.ceil(currentPage / 2) : currentPage} · ${settings.useBackSides && currentPage % 2 === 0 ? "Back" : "Front"}`;
    const pageData = pageCounts.get(currentPage) ?? { total: 0, owned: 0 };
    el("page-progress").textContent = `${pageData.owned} of ${pageData.total} collected on this page`;
    el<HTMLButtonElement>("page-prev").disabled = currentPage === 1; el<HTMLButtonElement>("page-next").disabled = currentPage === pages;
    el<HTMLSelectElement>("page-select").innerHTML = Array.from({ length: pages }, (_, index) => `<option value="${index + 1}" ${index + 1 === currentPage ? "selected" : ""}>${index + 1} / ${pages}</option>`).join("");
    overview.scrollTop = top;
    if (focusedPage) {
      const chip = document.getElementById(prefix + "page-chip-" + (Number(focusedPage) <= pages ? focusedPage : currentPage));
      for (const other of overview.querySelectorAll<HTMLButtonElement>("button[data-page]")) other.tabIndex = other === chip ? 0 : -1;
    }
    const grid = el("binder-grid");
    grid.style.setProperty("--columns", String(settings.columns));
    grid.dataset.dense = String(settings.columns > 4);
    grid.innerHTML = cells.join("");
  };
}

/** Opens card details as a sheet on narrow screens: focus moves into it and the chosen pocket stays visible above it. */
export function showDetailsSheet(sheet: HTMLElement, pocketId: string) {
  if (!matchMedia("(max-width: 900px)").matches || sheet.hidden) return;
  sheet.focus({ preventScroll: true });
  const pocket = document.getElementById(pocketId)?.closest(".dex-pocket");
  if (!pocket) return;
  const overlap = pocket.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + 8;
  if (overlap > 0) window.scrollBy({ top: overlap, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

export function blankPocket(position: number, label: string, filler = false) {
  return '<div class="dex-pocket-blank' + (filler ? ' master-filler' : '') + '"><span>Pocket ' + position + '</span>' + escape(label) + '</div>';
}
interface Pocket {
  id: string | number; number: string; name: string; finish?: string; image?: string | null;
  owned: boolean; ordered: boolean; selected: boolean; dimmed: boolean; row: number; column: number; set?: boolean;
}
export function cardPocket(p: Pocket) {
  const id = escape(p.id), ns = p.set ? "set-" : "";
  const title = escape(p.name), number = escape(p.number), finish = escape(p.finish ?? "");
  const art = p.image ? `<img src="${escape(p.image)}" width="64" height="64" loading="lazy" alt=""/>` : "";
  const tag = p.ordered && !p.owned ? `<span class="dex-pocket-tag">Ordered</span>` : "";
  const state = p.owned ? "collected" : p.ordered ? "ordered" : "missing";
  return `<div class="dex-pocket ${p.owned ? "owned" : p.ordered ? "ordered" : ""} ${p.selected ? "selected" : ""} ${p.dimmed ? "dimmed" : ""}">
    <button id="${ns}open-grid-${id}" class="dex-pocket-open" ${p.set ? "data-set-open" : "data-pokemon"}="${id}" aria-label="${title}, ${number} ${finish}, ${state}, row ${p.row}, column ${p.column}. View card details" aria-pressed="${p.selected}">
      <span class="dex-pocket-number">${number}</span>${art}<span class="dex-pocket-name">${title}</span>${finish ? `<small>${finish}</small>` : ""}${tag}</button>
    <label class="dex-pocket-check"><input id="${ns}owned-grid-${id}" type="checkbox" ${p.set ? "data-key" : "data-owned"}="${id}" ${p.owned ? "checked" : ""} aria-label="Have ${title}${finish ? " " + finish : ""}${p.ordered ? " (ordered)" : ""}"/><span>Have it</span></label></div>`;
}

/** One control for a card's three states: Missing, Ordered and Have it. */
export function statusControl(key: string | number, status: "missing" | "ordered" | "owned", label: string, isSet = false) {
  const options = [["missing", "Missing"], ["ordered", "Ordered"], ["owned", "Have it"]] as const;
  const prefix = isSet ? "set-detail-status-" : "detail-status-";
  return `<div class="dex-status-control dex-detail-status" role="radiogroup" aria-label="Status of ${escape(label)}">${options.map(([value, text]) =>
    `<label class="dex-status-option"><input type="radio" id="${prefix}${value}" name="${prefix.slice(0, -1)}" value="${value}" data-${isSet ? "set" : "dex"}-status="${escape(key)}" ${value === status ? "checked" : ""} /><span>${text}</span></label>`).join("")}</div>`;
}
