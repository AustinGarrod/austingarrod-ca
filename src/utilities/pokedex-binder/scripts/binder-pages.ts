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
  el("page-overview").onclick = event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-page]");
    if (button) turn(Number(button.dataset.page));
  };
  return function render(currentPage: number, pages: number, settings: BinderSettings,
    pageCounts: Map<number, {total: number; owned: number}>, cells: string[]) {
    const overview = el("page-overview"), top = overview.scrollTop;
    el("page-total").textContent = String(pages);
    el("capacity-summary").textContent = `${settings.columns} × ${settings.rows} pockets · ${settings.useBackSides ? Math.ceil(pages / 2) : pages} sheets needed · ${settings.useBackSides ? "Both sides" : "Fronts only"}`;
    el("page-overview").innerHTML = Array.from({ length: pages }, (_, index) => {
      const page = index + 1, data = pageCounts.get(page) ?? { total: 0, owned: 0 };
      return `<button class="dex-page-chip" id="${prefix}page-chip-${page}" data-page="${page}" aria-label="Page ${page}, ${data.owned} of ${data.total} collected" ${page === currentPage ? 'aria-current="page"' : ""} style="--filled:${data.total ? data.owned / data.total * 100 : 0}%">${page}</button>`;
    }).join("");
    el("page-heading").textContent = `Page ${currentPage}`;
    el("sheet-label").textContent = `Sheet ${settings.useBackSides ? Math.ceil(currentPage / 2) : currentPage} · ${settings.useBackSides && currentPage % 2 === 0 ? "Back" : "Front"}`;
    const pageData = pageCounts.get(currentPage) ?? { total: 0, owned: 0 };
    el("page-progress").textContent = `${pageData.owned} of ${pageData.total} collected on this page`;
    el<HTMLButtonElement>("page-prev").disabled = currentPage === 1; el<HTMLButtonElement>("page-next").disabled = currentPage === pages;
    el<HTMLSelectElement>("page-select").innerHTML = Array.from({ length: pages }, (_, index) => `<option value="${index + 1}" ${index + 1 === currentPage ? "selected" : ""}>${index + 1} / ${pages}</option>`).join("");
    overview.scrollTop = top;
    const grid = el("binder-grid");
    grid.style.setProperty("--columns", String(settings.columns));
    grid.dataset.dense = String(settings.columns > 4);
    grid.innerHTML = cells.join("");
  };
}

export function blankPocket(position: number, label: string, filler = false) {
  return '<div class="dex-pocket-blank' + (filler ? ' master-filler' : '') + '"><span>Pocket ' + position + '</span>' + escape(label) + '</div>';
}
interface Pocket {
  id: string | number; number: string; name: string; finish?: string; image?: string | null;
  owned: boolean; selected: boolean; dimmed: boolean; row: number; column: number; set?: boolean;
}
export function cardPocket(p: Pocket) {
  const id = escape(p.id), ns = p.set ? "set-" : "";
  const title = escape(p.name), number = escape(p.number), finish = escape(p.finish ?? "");
  const art = p.image ? `<img src="${escape(p.image)}" width="64" height="64" loading="lazy" alt=""/>` : "";
  return `<div class="dex-pocket ${p.owned ? "owned" : ""} ${p.selected ? "selected" : ""} ${p.dimmed ? "dimmed" : ""}">
    <button id="${ns}open-grid-${id}" class="dex-pocket-open" ${p.set ? "data-set-open" : "data-pokemon"}="${id}" aria-label="${title}, ${number} ${finish}, row ${p.row}, column ${p.column}. View card references" aria-pressed="${p.selected}">
      <span class="dex-pocket-number">${number}</span>${art}<span class="dex-pocket-name">${title}</span>${finish ? `<small>${finish}</small>` : ""}</button>
    <label class="dex-pocket-check"><input id="${ns}owned-grid-${id}" type="checkbox" ${p.set ? "data-key" : "data-owned"}="${id}" ${p.owned ? "checked" : ""} aria-label="Own ${title}${finish ? " " + finish : ""}"/><span>${p.owned ? "Owned" : "Missing"}</span></label></div>`;
}
