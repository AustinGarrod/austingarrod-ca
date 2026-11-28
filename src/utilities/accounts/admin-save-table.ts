export function item<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function facts(fields: Array<readonly [string, string]>): HTMLElement {
  const list = item("dl", "", "admin-facts admin-save-facts");
  for (const [label, value] of fields) {
    const entry = item("div");
    entry.append(item("dt", label), item("dd", value));
    list.append(entry);
  }
  return list;
}

export function savePanel(title: string, ...children: HTMLElement[]): HTMLElement {
  const panel = item("section", "", "admin-panel admin-save-panel");
  panel.append(item("h2", title), ...children);
  return panel;
}

export interface SaveRow {
  cells: string[];
  group?: string;
  action?: { label: string; open: (button: HTMLButtonElement) => void };
}

const pageSize = 50;
const format = new Intl.NumberFormat();
const searchKey = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function saveTable(options: {
  title: string;
  columns: string[];
  rows: SaveRow[];
  search?: string;
  match?: (row: SaveRow, query: string) => boolean;
  filter?: { label: string; choices: string[] };
  empty: string;
}): HTMLElement {
  const { title, columns, rows, filter, empty } = options;
  const panel = savePanel(title);
  if (!rows.length) {
    panel.append(item("p", empty));
    return panel;
  }

  const toolbar = item("div", "", "admin-record-controls");
  const search = item("input");
  search.type = "search";
  search.autocomplete = "off";
  const select = item("select");
  if (options.search) {
    const label = item("label", options.search);
    label.append(search);
    toolbar.append(label);
  }
  if (filter) {
    const label = item("label", filter.label);
    select.add(new Option("All", ""));
    for (const choice of filter.choices) select.add(new Option(choice, choice));
    label.append(select);
    toolbar.append(label);
  }
  if (toolbar.childElementCount) panel.append(toolbar);

  const hasActions = rows.some(row => row.action);
  const scroller = item("div", "", "admin-table-scroll");
  const table = item("table", "", "admin-data-table");
  table.setAttribute("role", "table");
  table.setAttribute("aria-label", title);
  const head = table.createTHead().insertRow();
  head.setAttribute("role", "row");
  for (const label of hasActions ? [...columns, "Open"] : columns) {
    const cell = item("th", label);
    cell.scope = "col";
    head.append(cell);
  }
  const body = table.createTBody();
  body.setAttribute("role", "rowgroup");
  scroller.append(table);
  const status = item("p", "", "admin-table-status");
  status.setAttribute("role", "status");
  const heading = panel.querySelector("h2")!;
  heading.tabIndex = -1;
  const pager = item("div", "", "admin-pagination admin-table-pagination");
  const controls = item("div", "", "admin-actions");
  const previous = item("button", "Previous", "button secondary");
  const next = item("button", "Next", "button secondary");
  previous.type = next.type = "button";
  controls.append(previous, next);
  pager.append(status, controls);
  panel.append(pager, scroller);

  let start = 0;
  let query = "";
  let pendingSearch: number | undefined;
  function render() {
    const filtered = query || select.value ? rows.filter(row => (!select.value || row.group === select.value)
      && (!query || (options.match ? options.match(row, query) : row.cells.some(cell => searchKey(cell).includes(query))))) : rows;
    body.replaceChildren();
    for (const row of filtered.slice(start, start + pageSize)) {
      const entry = body.insertRow();
      entry.setAttribute("role", "row");
      row.cells.forEach((value, index) => {
        const cell = entry.insertCell();
        cell.setAttribute("role", "cell");
        cell.append(item("span", columns[index], "admin-cell-label"), item("span", value));
        cell.firstElementChild!.setAttribute("aria-hidden", "true");
      });
      if (hasActions) {
        const cell = entry.insertCell();
        cell.setAttribute("role", "cell");
        if (row.action) {
          const open = item("button", "Open", "button secondary");
          open.type = "button";
          open.setAttribute("aria-label", row.action.label);
          open.addEventListener("click", () => row.action!.open(open));
          cell.append(open);
        }
      }
    }
    scroller.hidden = !filtered.length;
    controls.hidden = filtered.length <= pageSize;
    previous.disabled = start === 0;
    next.disabled = start + pageSize >= filtered.length;
    status.textContent = filtered.length
      ? `Showing ${format.format(start + 1)}–${format.format(Math.min(start + pageSize, filtered.length))} of ${format.format(filtered.length)}`
      : "No records match these filters.";
  }

  const refilter = () => {
    window.clearTimeout(pendingSearch);
    query = searchKey(search.value.trim());
    start = 0;
    render();
  };
  search.addEventListener("input", () => {
    window.clearTimeout(pendingSearch);
    pendingSearch = window.setTimeout(() => { if (panel.isConnected) refilter(); }, 120);
  });
  select.addEventListener("change", refilter);
  previous.addEventListener("click", () => { start -= pageSize; render(); heading.focus(); });
  next.addEventListener("click", () => { start += pageSize; render(); heading.focus(); });
  render();
  return panel;
}
