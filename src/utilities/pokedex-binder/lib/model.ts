export interface Species { id: number; name: string; generation: number; printingCount: number }
export interface BinderSettings { columns: number; rows: number; useBackSides: boolean; leadingBlankPockets: number }
export interface BinderState { schemaVersion: 1; settings: BinderSettings; ownedDexIds: number[] }
export type Settings = BinderSettings;
export type State = BinderState;
export interface PocketLocation { page: number; sheet: number; side: "front" | "back"; pocket: number; row: number; column: number }
export interface PageSlot { pocket: number; row: number; column: number; species: Species | null; reserved: boolean }

export const DEFAULT_SETTINGS: BinderSettings = { columns: 4, rows: 4, useBackSides: true, leadingBlankPockets: 0 };
export function defaultState(): BinderState { return { schemaVersion: 1, settings: { ...DEFAULT_SETTINGS }, ownedDexIds: [] }; }
export function cloneState(state: BinderState): BinderState { return { schemaVersion: 1, settings: { ...state.settings }, ownedDexIds: [...state.ownedDexIds] }; }
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

export function validateSettings(value: unknown): BinderSettings {
  if (!record(value) || !Number.isInteger(value.columns) || !Number.isInteger(value.rows)
    || Number(value.columns) < 1 || Number(value.columns) > 6 || Number(value.rows) < 1 || Number(value.rows) > 6
    || typeof value.useBackSides !== "boolean" || !Number.isInteger(value.leadingBlankPockets)
    || Number(value.leadingBlankPockets) < 0 || Number(value.leadingBlankPockets) > 1000) {
    throw new Error("Choose 1–6 rows and columns, and 0–1,000 reserved starting pockets.");
  }
  return { columns: Number(value.columns), rows: Number(value.rows), useBackSides: value.useBackSides, leadingBlankPockets: Number(value.leadingBlankPockets) };
}

export function validateState(value: unknown, species?: readonly Species[] | readonly number[]): BinderState {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.ownedDexIds) || value.ownedDexIds.length > 10000) {
    throw new Error("This binder uses an invalid or unsupported backup format.");
  }
  const ids = species ? new Set(species.map(item => typeof item === "number" ? item : item.id)) : null;
  const owned = value.ownedDexIds as unknown[];
  if (owned.some(id => !Number.isInteger(id) || Number(id) < 1 || Number(id) > 10000 || (ids && !ids.has(Number(id))))
    || new Set(owned).size !== owned.length) throw new Error("The binder contains duplicate or unrecognized Pokémon numbers.");
  return { schemaVersion: 1, settings: validateSettings(value.settings), ownedDexIds: (owned as number[]).slice().sort((a, b) => a - b) };
}

export function sameSettings(a: BinderSettings, b: BinderSettings): boolean {
  return a.columns === b.columns && a.rows === b.rows && a.useBackSides === b.useBackSides && a.leadingBlankPockets === b.leadingBlankPockets;
}
export function sameState(a: BinderState, b: BinderState): boolean {
  return sameSettings(a.settings, b.settings) && a.ownedDexIds.length === b.ownedDexIds.length && a.ownedDexIds.every((id, i) => id === b.ownedDexIds[i]);
}
export function pageCount(speciesCount: number, settings: BinderSettings): number {
  return Math.max(1, Math.ceil((speciesCount + settings.leadingBlankPockets) / (settings.columns * settings.rows)));
}
export function locationFor(id: number, settings: BinderSettings, species?: readonly Species[]): PocketLocation {
  const index = species ? species.findIndex(item => item.id === id) : id - 1;
  if (index < 0 || !Number.isInteger(index)) throw new Error("This Pokémon is not in the catalog.");
  const capacity = settings.columns * settings.rows;
  const absolute = index + settings.leadingBlankPockets;
  const page = Math.floor(absolute / capacity) + 1;
  const pocket = absolute % capacity + 1;
  return { page, sheet: settings.useBackSides ? Math.ceil(page / 2) : page,
    side: settings.useBackSides && page % 2 === 0 ? "back" : "front", pocket,
    row: Math.floor((pocket - 1) / settings.columns) + 1, column: (pocket - 1) % settings.columns + 1 };
}
export function pageSlots(page: number, species: readonly Species[], settings: BinderSettings): PageSlot[] {
  const capacity = settings.columns * settings.rows;
  return Array.from({ length: capacity }, (_, index) => {
    const speciesIndex = (page - 1) * capacity + index - settings.leadingBlankPockets;
    return { pocket: index + 1, row: Math.floor(index / settings.columns) + 1, column: index % settings.columns + 1,
      species: species[speciesIndex] ?? null, reserved: speciesIndex < 0 };
  });
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/♀/g, " female ").replace(/♂/g, " male ").replace(/[^a-z0-9]/g, "");
}
export function searchSpecies(species: readonly Species[], query: string): Species[] {
  const normalized = normalizeSearch(query.trim());
  if (!normalized) return [...species];
  const numeric = /^0*\d+$/.test(normalized) ? Number(normalized) : null;
  return species.filter(item => numeric !== null ? item.id === numeric : normalizeSearch(item.name).includes(normalized)
    || (item.name.includes("♀") && normalized === "nidoranf") || (item.name.includes("♂") && normalized === "nidoranm"));
}

export function exportBackup(state: BinderState): string {
  return JSON.stringify({ utility: "pokedex-binder", schemaVersion: 1, exportedAt: new Date().toISOString(), state: cloneState(state) }, null, 2);
}
export function importBackup(text: string, species?: readonly Species[]): BinderState {
  if (text.length > 65536) throw new Error("This backup is too large. Choose a Pokédex Binder JSON backup.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("The selected file is not valid JSON."); }
  if (!record(parsed) || parsed.utility !== "pokedex-binder" || parsed.schemaVersion !== 1) throw new Error("Choose a supported Pokédex Binder backup.");
  return validateState(parsed.state, species);
}
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function exportCsv(species: readonly Species[], state: BinderState, missingOnly = false): string {
  const owned = new Set(state.ownedDexIds);
  const rows: (string | number)[][] = [["Pokédex number", "Pokémon", "Status", "Page", "Sheet", "Side", "Pocket", "Row", "Column"]];
  for (const item of species) {
    if (missingOnly && owned.has(item.id)) continue;
    const place = locationFor(item.id, state.settings, species);
    rows.push([item.id, item.name, owned.has(item.id) ? "Owned" : "Missing", place.page, place.sheet, place.side, place.pocket, place.row, place.column]);
  }
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Merge net changes, never device-clock timestamps. Layout is one atomic choice. */
export function mergeStates(base: BinderState, local: BinderState, remote: BinderState): { state: BinderState; layoutConflict: boolean } {
  const previous = new Set(base.ownedDexIds), desired = new Set(local.ownedDexIds), latest = new Set(remote.ownedDexIds);
  const owned = new Set(latest);
  for (const id of new Set([...previous, ...desired])) {
    if (previous.has(id) === desired.has(id)) continue;
    if (desired.has(id)) owned.add(id); else owned.delete(id);
  }
  const localLayoutChanged = !sameSettings(base.settings, local.settings);
  const remoteLayoutChanged = !sameSettings(base.settings, remote.settings);
  return { state: { schemaVersion: 1, settings: { ...(localLayoutChanged ? local.settings : remote.settings) }, ownedDexIds: [...owned].sort((a, b) => a - b) },
    layoutConflict: localLayoutChanged && remoteLayoutChanged && !sameSettings(local.settings, remote.settings) };
}
