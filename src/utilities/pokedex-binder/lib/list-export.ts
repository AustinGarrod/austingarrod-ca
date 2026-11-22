import type { BinderSettings, PocketLocation } from "./model";

export interface ListRow extends PocketLocation {
  number: number | string;
  name: string;
  owned: boolean;
  finish?: string;
  required?: boolean;
}

export interface BinderList {
  name: string;
  setName: string;
  settings: BinderSettings;
  rows: ListRow[];
}

type Cell = string | number;
export function csv(header: string[], rows: Cell[][], quoteAll = false) {
  const cell = (value: Cell) => {
    const raw = String(value);
    // Custom binder and extra names may be opened in a spreadsheet.
    const safe = /^[\t\r\n]|^\s*[=+@-]/.test(raw) ? "'" + raw : raw;
    return quoteAll || /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
  };
  return "\uFEFF" + [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const locationHeaders = ["Page", "Sheet", "Side", "Pocket", "Row", "Column"];
const location = (r: ListRow) => [r.page, r.sheet, r.side, r.pocket, r.row, r.column];
const status = (r: ListRow) => r.owned ? "Owned" : "Missing";
const goal = (r: ListRow) => r.required === false ? "Optional" : "Required";

export function nationalCsv(rows: ListRow[]) {
  return csv(["Pokédex number", "Pokémon", "Status", ...locationHeaders],
    rows.map(r => [r.number, r.name, status(r), ...location(r)]));
}

export function setListCsv(rows: ListRow[]) {
  // Keep the existing set columns in order, then append the national list's pocket and status.
  return csv(["Number", "Card", "Finish", "Goal", "Page", "Sheet", "Side", "Row", "Column", "Pocket", "Status"],
    rows.map(r => [r.number, r.name, r.finish ?? "", goal(r), r.page, r.sheet, r.side, r.row, r.column, r.pocket, status(r)]), true);
}

export function combinedCsv(lists: BinderList[]) {
  return csv(["Binder", "Set", "Number", "Card", "Finish", "Goal", "Status", ...locationHeaders, "Binder #"],
    lists.flatMap((list, index) => list.rows.map(r => [list.name, list.setName, r.number, r.name, r.finish ?? "", goal(r), status(r), ...location(r), index + 1])), true);
}
