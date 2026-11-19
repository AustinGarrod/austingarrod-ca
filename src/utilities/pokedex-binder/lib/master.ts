import { DEFAULT_SETTINGS, locationFor, record, validateSettings, type BinderSettings, type PocketLocation } from "./model";

export interface Variant {
  id: string;
  label: string;
  specialty: boolean;
}
export interface SetCard {
  number: string;
  name: string;
  category: string;
  variants: Variant[];
}
export interface SetSummary {
  id: string;
  name: string;
  code: string;
  count: number;
  printedTotal: number | null;
  artwork?: { series: string; missing: string[] } | null;
}
export interface Extra {
  id: string;
  name: string;
  number: string;
  required: boolean;
}
export interface SetBinder {
  id: string;
  setId: string;
  name: string;
  goal: "numbers" | "variants";
  order: "together" | "sections";
  settings: BinderSettings & { fillerThrough?: number };
  specialties: string[];
  owned: string[];
  extras: Extra[];
}
export interface MasterState {
  schemaVersion: 1;
  binders: SetBinder[];
}
export const emptyMaster = (): MasterState => ({ schemaVersion: 1, binders: [] });
export const masterLimit = 4 * 1024 * 1024;
export const newBinder = (setId: string, name: string): SetBinder => ({
  id: crypto.randomUUID(),
  setId,
  name,
  goal: "variants",
  order: "together",
  settings: { ...DEFAULT_SETTINGS },
  specialties: [],
  owned: [],
  extras: [],
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function strings(list: unknown, limit: number): boolean {
  return (
    Array.isArray(list) &&
    list.every((s) => typeof s === "string" && s.length > 0 && s.length <= limit) &&
    new Set(list).size === list.length
  );
}
/** PHP canonicalizes object keys for replay hashing. Field order carries no meaning in a save. */
export function sameSave(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => sameSave(v, right[i]))
    );
  }
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((k) => Object.hasOwn(right, k) && sameSave(left[k], right[k]))
  );
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
}
export function validateMaster(value: unknown): MasterState {
  const bad = () => new Error("Set binder data is invalid or exceeds the supported backup size.");
  if (
    !record(value) ||
    !fields(value, ["schemaVersion", "binders"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.binders) ||
    new TextEncoder().encode(JSON.stringify(value)).length > masterLimit
  )
    throw bad();
  const ids = new Set<string>();
  for (const b of value.binders) {
    if (
      !record(b) ||
      !fields(b, ["id", "setId", "name", "goal", "order", "settings", "specialties", "owned", "extras"]) ||
      typeof b.id !== "string" ||
      !uuid.test(b.id) ||
      ids.has(b.id) ||
      typeof b.setId !== "string" ||
      !/^[a-zA-Z0-9._-]{1,64}$/.test(b.setId) ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 100 ||
      !["numbers", "variants"].includes(String(b.goal)) ||
      !["sections", "together"].includes(String(b.order)) ||
      !strings(b.owned, 256) ||
      !strings(b.specialties, 200) ||
      !Array.isArray(b.extras)
    )
      throw bad();
    if (!record(b.settings)) throw bad();
    const hasFillers = Object.hasOwn(b.settings, "fillerThrough");
    const keys = ["columns", "rows", "useBackSides", "leadingBlankPockets"];
    if (hasFillers) {
      keys.push("fillerThrough");
      if (!Number.isSafeInteger(b.settings.fillerThrough) || Number(b.settings.fillerThrough) < 1) throw bad();
    }
    if (!fields(b.settings, keys)) throw bad();
    validateSettings(b.settings);
    const extras = new Set<string>();
    for (const e of b.extras) {
      if (
        !record(e) ||
        !fields(e, ["id", "name", "number", "required"]) ||
        typeof e.id !== "string" ||
        !uuid.test(e.id) ||
        extras.has(e.id) ||
        typeof e.name !== "string" ||
        !e.name.trim() ||
        e.name.length > 100 ||
        typeof e.number !== "string" ||
        e.number.length > 32 ||
        typeof e.required !== "boolean"
      )
        throw bad();
      extras.add(e.id);
    }
    ids.add(b.id);
  }
  return structuredClone(value) as unknown as MasterState;
}

export interface Slot {
  key: string;
  name: string;
  number: string;
  finish: string;
  required: boolean;
  owned: boolean;
  category: string;
}
interface Filler {
  filler: true;
  number: string;
}
type SetPocket = (Slot | Filler) & PocketLocation;
export function isCardPocket(pocket: SetPocket): pocket is Slot & PocketLocation {
  return "key" in pocket;
}
export function setPockets(b: SetBinder, cards: SetCard[]): SetPocket[] {
  const marks = new Set(b.owned),
    main: (Slot | Filler)[] = [],
    parallel: Slot[] = [];
  for (const card of cards) {
    const prefix = card.number + ":";
    const variants = card.variants.filter(
      (v) => !v.specialty || b.specialties.includes(v.id) || b.specialties.includes(card.number + ":" + v.id),
    );
    const any = b.goal === "numbers" || !variants.length;
    const items = any ? [{ id: "*", label: "Any finish" }] : variants;
    items.forEach((v, i) => {
      const key = prefix + v.id;
      const owned = any
        ? marks.has(prefix + "*") || card.variants.some((item) => marks.has(prefix + item.id))
        : marks.has(key);
      (i && b.order === "sections" ? parallel : main).push({
        key,
        number: card.number,
        name: card.name,
        category: card.category,
        finish: v.label,
        owned,
        required: true,
      });
    });
    if (
      b.settings.fillerThrough && variants.length <= 1 &&
      /^\d+$/.test(card.number) && Number(card.number) >= 1 && Number(card.number) <= b.settings.fillerThrough
    ) main.push({ filler: true, number: card.number });
  }
  const extras = b.extras.map((e) => ({
    key: "extra:" + e.id,
    name: e.name,
    number: e.number,
    finish: "Custom extra",
    category: "Extra",
    owned: marks.has("extra:" + e.id),
    required: e.required,
  }));
  return [...main, ...parallel, ...extras].map((slot, i) => ({ ...slot, ...locationFor(i + 1, b.settings) }));
}

export function setSlots(b: SetBinder, cards: SetCard[]) {
  return setPockets(b, cards).filter(isCardPocket);
}

export function markSlot(b: SetBinder, key: string, owned: boolean) {
  const marks = new Set(b.owned);
  const prefix = key.slice(0, key.indexOf(":") + 1);
  if (key.endsWith(":*") && !owned)
    for (const mark of marks) {
      if (mark.startsWith(prefix)) marks.delete(mark);
    }
  if (owned) {
    marks.add(key);
    if (!key.endsWith(":*")) marks.delete(prefix + "*");
  } else marks.delete(key);
  b.owned = [...marks].sort();
}

export function adoptSets(device: MasterState, account: MasterState): MasterState {
  const result = structuredClone(account);
  for (const binder of device.binders) {
    const match = result.binders.find((b) => b.id === binder.id);
    if (!match) result.binders.push(structuredClone(binder));
    else if (!sameSave(match, binder))
      result.binders.push({
        ...structuredClone(binder),
        id: crypto.randomUUID(),
        name: binder.name.slice(0, 91) + " (device)",
      });
  }
  return validateMaster(result);
}

export function setCsv(slots: ReturnType<typeof setSlots>) {
  const cell = (value: string | number) => {
    const s = String(value);
    return '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      ["Number", "Card", "Finish", "Goal", "Page", "Sheet", "Side", "Row", "Column"],
      ...slots
        .filter((s) => !s.owned)
        .map((s) => [
          s.number,
          s.name,
          s.finish,
          s.required ? "Required" : "Optional",
          s.page,
          s.sheet,
          s.side,
          s.row,
          s.column,
        ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
