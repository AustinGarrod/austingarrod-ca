import { nationalCsv } from "./list-export";

export interface Species { id: number; name: string; generation: number; printingCount: number }
export interface BinderSettings { columns: number; rows: number; useBackSides: boolean; leadingBlankPockets: number }
export interface BinderState { schemaVersion: 1; settings: BinderSettings; ownedDexIds: number[]; orderedDexIds?: number[]; enabled?: boolean }
export type CardStatus = "missing" | "ordered" | "owned";
export const cardStatus = (owned: boolean, ordered: boolean): CardStatus => owned ? "owned" : ordered ? "ordered" : "missing";
export const cardStatusLabel: Record<CardStatus, string> = { owned: "Collected", ordered: "Ordered", missing: "Missing" };
export type Settings = BinderSettings;
export type State = BinderState;
export interface PocketLocation { page: number; sheet: number; side: "front" | "back"; pocket: number; row: number; column: number }
export interface PageSlot { pocket: number; row: number; column: number; species: Species | null; reserved: boolean }

export const DEFAULT_SETTINGS: BinderSettings = { columns: 4, rows: 4, useBackSides: true, leadingBlankPockets: 0 };
export function defaultState(): BinderState { return { schemaVersion: 1, settings: { ...DEFAULT_SETTINGS }, ownedDexIds: [] }; }
export function cloneState(state: BinderState): BinderState {
  return { ...state, settings: { ...state.settings }, ownedDexIds: [...state.ownedDexIds],
    ...(state.orderedDexIds ? { orderedDexIds: [...state.orderedDexIds] } : {}) };
}
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
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.ownedDexIds) || value.ownedDexIds.length > 10000
    || (Object.hasOwn(value, "enabled") && typeof value.enabled !== "boolean")
    || (Object.hasOwn(value, "orderedDexIds") && (!Array.isArray(value.orderedDexIds) || value.orderedDexIds.length > 10000))) {
    throw new Error("This binder uses an invalid or unsupported backup format.");
  }
  const ids = species ? new Set(species.map(item => typeof item === "number" ? item : item.id)) : null;
  const owned = value.ownedDexIds as unknown[];
  const ordered = (value.orderedDexIds ?? []) as number[];
  const marked = [...owned, ...ordered];
  if (marked.some(id => !Number.isInteger(id) || Number(id) < 1 || Number(id) > 10000 || (ids && !ids.has(Number(id))))
    || new Set(marked).size !== marked.length) throw new Error("The binder contains duplicate or unrecognized Pokémon numbers.");
  return { schemaVersion: 1, settings: validateSettings(value.settings), ownedDexIds: (owned as number[]).slice().sort((a, b) => a - b),
    ...(Object.hasOwn(value, "orderedDexIds") ? { orderedDexIds: ordered.slice().sort((a, b) => a - b) } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}) };
}

export function sameSettings(a: BinderSettings, b: BinderSettings): boolean {
  return a.columns === b.columns && a.rows === b.rows && a.useBackSides === b.useBackSides && a.leadingBlankPockets === b.leadingBlankPockets;
}
export function hasNationalData(state: BinderState): boolean {
  return state.ownedDexIds.length > 0 || !!state.orderedDexIds?.length || !sameSettings(state.settings, DEFAULT_SETTINGS);
}
export function nationalEnabled(state: BinderState): boolean { return state.enabled ?? hasNationalData(state); }
export function sameState(a: BinderState, b: BinderState): boolean {
  const ordered = a.orderedDexIds ?? [];
  return a.enabled === b.enabled && sameSettings(a.settings, b.settings) && a.ownedDexIds.length === b.ownedDexIds.length && a.ownedDexIds.every((id, i) => id === b.ownedDexIds[i])
    && ordered.length === (b.orderedDexIds?.length ?? 0) && ordered.every((id, i) => id === b.orderedDexIds?.[i]);
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
  if (text.length > 65536) throw new Error("This backup is too large. Choose a Pokémon Binder Tracker JSON backup.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("The selected file is not valid JSON."); }
  if (!record(parsed) || parsed.utility !== "pokedex-binder" || parsed.schemaVersion !== 1) throw new Error("Choose a supported Pokémon Binder Tracker backup.");
  return validateState(parsed.state, species);
}
export function nationalRows(species: readonly Species[], state: BinderState, filter: "all" | CardStatus = "all") {
  const owned = new Set(state.ownedDexIds);
  const ordered = new Set(state.orderedDexIds);
  return species.flatMap((item, index) => {
    const has = owned.has(item.id);
    const pending = ordered.has(item.id);
    if (filter !== "all" && filter !== cardStatus(has, pending)) return [];
    return [{ number: item.id, name: item.name, owned: has, ordered: pending, ...locationFor(index + 1, state.settings) }];
  });
}

export function exportCsv(species: readonly Species[], state: BinderState, missingOnly = false): string {
  return nationalCsv(nationalRows(species, state, missingOnly ? "missing" : "all"));
}

export function mergeCardMarks<T>(base: Map<T, CardStatus>, local: Map<T, CardStatus>, remote: Map<T, CardStatus>) {
  const result = new Map(remote);
  for (const key of new Set([...base.keys(), ...local.keys()])) {
    const before = base.get(key), desired = local.get(key), latest = remote.get(key);
    if (before === desired) continue;
    // A conflicting order must not move an arrival back to Ordered.
    if (latest !== before && latest === "owned" && desired === "ordered") continue;
    if (desired) result.set(key, desired); else result.delete(key);
  }
  return result;
}

export function cardMarks<T>(owned: readonly T[], ordered: readonly T[] = []) {
  return new Map<T, CardStatus>([...ordered.map(key => [key, "ordered"] as const), ...owned.map(key => [key, "owned"] as const)]);
}

/** Merge net changes, never device-clock timestamps. Layout is one atomic choice. */
export function mergeStates(base: BinderState, local: BinderState, remote: BinderState): { state: BinderState; layoutConflict: boolean } {
  const marks = (state: BinderState) => cardMarks(state.ownedDexIds, state.orderedDexIds);
  const merged = mergeCardMarks(marks(base), marks(local), marks(remote));
  const owned: number[] = [], ordered: number[] = [];
  for (const [id, status] of merged) (status === "owned" ? owned : ordered).push(id);
  const localLayoutChanged = !sameSettings(base.settings, local.settings);
  const remoteLayoutChanged = !sameSettings(base.settings, remote.settings);
  const enabled = local.enabled !== base.enabled ? local.enabled : remote.enabled;
  return { state: { schemaVersion: 1, settings: { ...(localLayoutChanged ? local.settings : remote.settings) }, ownedDexIds: owned.sort((a, b) => a - b),
    ...([base, local, remote].some(state => state.orderedDexIds !== undefined) ? { orderedDexIds: ordered.sort((a, b) => a - b) } : {}),
    ...(enabled === undefined ? {} : { enabled }) },
    layoutConflict: localLayoutChanged && remoteLayoutChanged && !sameSettings(local.settings, remote.settings) };
}
