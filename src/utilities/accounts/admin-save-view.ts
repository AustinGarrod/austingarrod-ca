import { COMPANION_SYSTEMS, type CompanionCatalog, type CompanionProgress } from "../../../apps/idle-slayer-companion/src/domain/companion-types";
import type { CompanionWorkspace } from "../../../apps/idle-slayer-companion/src/domain/companion-workspace";
import type { CheckpointVault } from "../../../apps/idle-slayer-companion/src/domain/checkpoints";
import type { Catalog, Profile } from "../../../apps/idle-slayer-companion/src/domain/types";
import { binderCards, binderSetIds, setCardKey } from "../pokedex-binder/lib/binder-catalog";
import { binderSectionLayout, extraSectionId, setSlots, type MasterState, type SetBinder, type SetCard, type SetSummary } from "../pokedex-binder/lib/master";
import { cardStatus, cardStatusLabel, nationalEnabled, normalizeSearch, record, validateState, type BinderSettings, type Species } from "../pokedex-binder/lib/model";
import { buyingStores } from "../pokedex-binder/lib/buying-offers";
import { readMeasurementsDocument } from "../radius-map/lib/account-measurements";
import { facts, item, savePanel, saveTable, type SaveRow } from "./admin-save-table";

export interface SavedVersion {
  id: string;
  app: string;
  document: string;
  revision: number;
  schemaVersion: number;
  bytes: number;
  date: string;
  label: string | null;
}

export interface BinderShare { binderKey: string; active: boolean; name: string | null }

interface ViewerContext {
  signal: AbortSignal;
  shares: BinderShare[] | null;
  historical: boolean;
  selectBinder: (title: string | null, back?: () => void) => void;
}

const pokemonCatalog = "/utilities/pokedex-binder/catalog/";
const masterCatalog = pokemonCatalog + "master-sets/";
const slayerCatalog = "/utilities/idle-slayer-companion/";
const systemNames: Record<string, string> = {
  ascension: "Ascension", achievement: "Achievements", craft: "Crafting", material: "Materials",
  quest: "Quests", village: "Village", enemy: "Bestiary", divinity: "Divinities",
};
const fieldNames: Record<string, string> = {
  completed: "Completed", active: "Active", discovered: "Discovered", claimed: "Claimed",
  selected: "Selected", built: "Built", count: "Count", stage: "Stage",
};
const sourceNames = { manual: "Manual", save: "Imported save", legacy: "Legacy progress", reset: "Reset" };
const shortTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat();
const statuses = Object.values(cardStatusLabel);
const yesNo = (value: boolean) => value ? "Yes" : "No";
const rowCount = (rows: readonly unknown[]) => number.format(rows.length);
const date = (value: string) => Number.isFinite(Date.parse(value)) ? shortTime.format(new Date(value)) : value;
const human = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

async function catalog<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("Catalog unavailable");
  return response.json();
}

function layout(settings: BinderSettings): Array<readonly [string, string]> {
  return [["Page grid", `${settings.rows} rows × ${settings.columns} columns`], ["Pocket sides", settings.useBackSides ? "Front and back" : "Front only"],
    ["Reserved starting pockets", number.format(settings.leadingBlankPockets)]];
}

function shareStatus(context: ViewerContext, key: string): Array<readonly [string, string]> {
  if (context.historical) return [];
  return [["Public sharing", context.shares === null ? "Status unavailable"
    : context.shares.some(share => share.binderKey === key && share.active) ? "Link active" : "Link off"]];
}

async function national(value: unknown, context: ViewerContext): Promise<HTMLElement[]> {
  const state = validateState(value);
  const dataset = await catalog<{ species: Species[] }>(pokemonCatalog + "index.json", context.signal).catch(() => null);
  const species = Array.isArray(dataset?.species) ? dataset.species : [];
  const names = new Map(species.map(entry => [entry.id, entry]));
  const owned = new Set(state.ownedDexIds), ordered = new Set(state.orderedDexIds ?? []);
  const ids = [...new Set([...names.keys(), ...owned, ...ordered])].sort((a, b) => a - b);
  const rows = ids.map(id => {
    const entry = names.get(id);
    const status = cardStatusLabel[cardStatus(owned.has(id), ordered.has(id))];
    return { cells: [entry?.name ?? "Unlisted species", `#${String(id).padStart(4, "0")}`, entry ? String(entry.generation) : "—", status], group: status };
  });
  return [
    savePanel("Binder settings", facts([["Visibility", nationalEnabled(state) ? "Enabled" : "Hidden"], ...layout(state.settings),
      ["Collected", number.format(owned.size)], ["Ordered", number.format(ordered.size)], ...shareStatus(context, "national")])),
    ...(!species.length ? [item("p", "The species catalog is unavailable. Saved Dex numbers are still shown.", "admin-notice")] : []),
    saveTable({ title: "Pokédex checklist", columns: ["Pokémon", "Dex number", "Generation", "Status"], rows,
      search: "Search by name or Dex number",
      match: ({ cells: [name, id] }, query) => /^#?\d+$/.test(query) ? Number(id.slice(1)) === Number(query.replace(/^#/, ""))
        : normalizeSearch(name).includes(normalizeSearch(query)),
      filter: { label: "Status", choices: statuses }, empty: "This save has no recorded species." }),
  ];
}

function marks(binder: SetBinder, cards: SetCard[], represented: ReadonlySet<string>): SaveRow[] {
  const printings = new Map<string, readonly [string, string]>(cards.flatMap(card => card.variants.map(variant =>
    [`${setCardKey(card)}:${variant.id}`, [card.name, variant.label]] as const)));
  const sources = [{ status: "Collected", keys: binder.owned }, { status: "Ordered", keys: binder.ordered ?? [] }];
  return sources.flatMap(({ status, keys }) => keys.filter(key => !represented.has(key)).map(key => {
      const printing = printings.get(key);
      return { cells: [printing?.[0] ?? "Saved card mark", key, printing?.[1] ?? "—", status] };
    }));
}

async function binderPanels(binder: SetBinder, sets: Map<string, SetSummary>, context: ViewerContext): Promise<HTMLElement[]> {
  const sources = new Map(await Promise.all(binderSetIds(binder).map(async id => {
    const entries = await catalog<SetCard[]>(masterCatalog + encodeURIComponent(id) + ".json", context.signal).catch(() => null);
    return [id, Array.isArray(entries) ? entries : null] as const;
  })));
  const missing = [...sources].filter(([, entries]) => !entries).map(([id]) => id);
  const cards = binderCards(binder, id => sources.get(id) ?? []);
  const slots = setSlots(binder, cards);
  const required = slots.filter(slot => slot.required);
  const setName = (id: string) => sets.get(id)?.name ?? id;
  const active = new Set(slots.map(slot => slot.key.startsWith("extra:") ? extraSectionId : slot.sourceSetId ?? binder.setId));
  const savedLayout = binder.settings.sectionLayout;
  const sections = binderSectionLayout(binder.setId, binder.settings.includeRelated ? savedLayout : undefined)
    .filter(section => active.has(section.id));
  const sectionRows = (entries: typeof sections) => entries.map(section => ({
    cells: [section.id === extraSectionId ? "Custom extras" : setName(section.id), section.newPage ? "Starts on a new page" : "Continues"],
  }));
  const details = item("details", "", "admin-checkpoint admin-binder-layout");
  details.append(item("summary", "Binder settings and section layout"), facts([["Set", setName(binder.setId)],
    ["Collection goal", binder.goal === "numbers" ? "One card per number" : "Every required finish"],
    ["Finish placement", binder.order === "sections" ? "Separate sections" : "Keep finishes together"],
    ...layout(binder.settings), ["Fillers through", binder.settings.fillerThrough?.toString() ?? "Off"],
    ["Related sets", binder.settings.includeRelated ? "Included" : "Off"],
    ["Specialty finishes", binder.specialties.join(", ") || "None"],
    ...shareStatus(context, binder.id)]),
    saveTable({ title: missing.length ? "Available sections" : "Section layout", columns: ["Section", "Placement"],
      rows: sectionRows(sections), empty: "No available sections." }));
  if (savedLayout?.length && (missing.length || !binder.settings.includeRelated)) {
    details.append(saveTable({ title: binder.settings.includeRelated ? "Saved section settings" : "Inactive related-set layout",
      columns: ["Section", "Placement setting"], rows: sectionRows(savedLayout), empty: "No saved sections." }));
  }
  const cardRows = slots.map(slot => ({ cells: [slot.name, slot.key.startsWith("extra:") ? "Custom extra" : setName(slot.sourceSetId ?? binder.setId),
    slot.number || "—", slot.finish, cardStatusLabel[slot.status], yesNo(slot.required)], group: cardStatusLabel[slot.status] }));
  const panels: HTMLElement[] = [];
  if (!missing.length) {
    panels.push(savePanel("Required card progress", facts([["Collected", rowCount(required.filter(slot => slot.owned))],
      ["Ordered", rowCount(required.filter(slot => slot.ordered))], ["Required slots", rowCount(required)]])));
  } else {
    panels.push(item("p", `Catalog unavailable for ${missing.map(setName).join(", ")}. The checklist shows available cards, custom extras, and saved marks.`, "admin-notice"));
  }
  panels.push(
    details,
    saveTable({ title: "Card checklist", columns: ["Card", "Set", "Number", "Finish", "Status", "Required"], rows: cardRows,
      search: "Search cards, sets, or finishes", filter: { label: "Status", choices: statuses }, empty: "No cards to display." }),
  );
  const additional = marks(binder, cards, new Set(slots.map(slot => slot.key)));
  if (additional.length) panels.push(saveTable({ title: "Additional saved marks", columns: ["Card", "Saved identifier", "Finish", "Status"],
    rows: additional, search: "Search saved marks", empty: "No additional marks." }));
  return panels;
}

async function master(state: MasterState, context: ViewerContext): Promise<HTMLElement[]> {
  const dataset = await catalog<SetSummary[]>(masterCatalog + "index.json", context.signal).catch(() => []);
  const sets = new Map(dataset.map(entry => [entry.id, entry]));
  const list = item("div", "", "admin-view");
  const drilldown = item("div", "", "admin-view");
  drilldown.hidden = true;
  const rows = state.binders.map(binder => ({
    cells: [binder.name, sets.get(binder.setId)?.name ?? binder.setId, rowCount(binder.owned), rowCount(binder.ordered ?? []),
      ...shareStatus(context, binder.id).map(([, value]) => value)],
    action: { label: `Open ${binder.name}`, open: async (trigger: HTMLButtonElement) => {
      const scroll = window.scrollY;
      list.hidden = true;
      drilldown.hidden = false;
      context.selectBinder(binder.name, () => {
        drilldown.hidden = true;
        drilldown.replaceChildren();
        list.hidden = false;
        context.selectBinder(null);
        trigger.focus({ preventScroll: true });
        window.scrollTo({ top: scroll, behavior: "instant" });
      });
      const status = item("p", "Loading binder…", "admin-notice");
      status.setAttribute("role", "status");
      drilldown.replaceChildren(status);
      try {
        const panels = await binderPanels(binder, sets, context);
        if (!context.signal.aborted && status.isConnected) status.replaceWith(...panels);
      } catch {
        if (!context.signal.aborted && status.isConnected) status.textContent = "This binder could not be displayed. Download the original save for its stored data.";
      }
    } },
  }));
  list.append(saveTable({ title: "Binders in this save", columns: ["Binder", "Set", "Collected marks", "Ordered marks",
    ...(!context.historical ? ["Public sharing"] : [])], rows, search: "Search binders or sets", empty: "No named binders in this save." }));
  return [list, drilldown];
}

export function retailerFields(mode: "all" | "selected", stores: string[]) {
  const known = stores.filter(store => buyingStores.some(name => name === store));
  const retired = stores.filter(store => !known.includes(store));
  return facts([["Lookup mode", mode === "all" ? "All retailers" : "Selected retailers"],
    ["Retailers used for lookups", mode === "all" ? "All supported retailers" : known.join(", ") || "None selected"],
    ...(retired.length ? [["Retired retailers in this save", retired.join(", ")] as const] : [])]);
}

async function slayerNames(signal: AbortSignal) {
  const [map, companion] = await Promise.all([
    catalog<Catalog>(slayerCatalog + "catalog.json", signal).catch(() => null),
    catalog<CompanionCatalog>(slayerCatalog + "companion-catalog.json", signal).catch(() => null),
  ]);
  const upgrades = new Map((map?.upgrades ?? []).map(entry => [entry.id, entry.title]));
  const milestones = new Map((map?.milestones ?? []).map(entry => [entry.id, entry.title]));
  const entities = new Map((companion?.entities ?? []).map(entry => [`${entry.system}:${entry.id}`, entry.title]));
  return { upgrades, milestones, entities };
}

type SlayerNames = Awaited<ReturnType<typeof slayerNames>>;
const profileFacts = (profile: Profile) => facts([["Catalog revision", profile.catalogRevision],
  ["Ultra Ascensions", number.format(profile.epoch)], ["Show spoilers", yesNo(profile.showSpoilers)]]);

function profileRows(profile: Profile, names: SlayerNames): SaveRow[] {
  return [
    ...Object.entries(profile.purchases).map(([id, purchase]) => ({
      cells: [names.upgrades.get(id) ?? id, "Ascension upgrades", `${purchase.active ? "Active" : "Inactive"} · Recorded at Ultra Ascension ${number.format(purchase.epoch)}`, id],
      group: "Ascension upgrades",
    })),
    ...Object.keys(profile.milestones).map(id => ({
      cells: [names.milestones.get(id) ?? id, "Milestones", "Reached", id], group: "Milestones",
    })),
  ];
}

function slayerRecords(rows: SaveRow[], groups: string[]): HTMLElement {
  return saveTable({ title: "Recorded progress", columns: ["Item", "System", "Recorded values", "Saved identifier"], rows,
    filter: { label: "System", choices: groups }, search: "Search progress", empty: "No progress records in this save." });
}

function slayerProgress(value: CompanionProgress, names: SlayerNames): HTMLElement[] {
  const modules = Object.entries(value.modules);
  const rows = modules.flatMap(([system, module]) => Object.entries(module.records).map(([id, entry]) => {
    const fields = Object.entries(entry).map(([field, data]) => `${fieldNames[field] ?? human(field)} · ${typeof data === "boolean" ? yesNo(data) : data}`);
    const group = systemNames[system] ?? system;
    return { cells: [names.entities.get(`${system}:${id}`) ?? id, group, fields.join(" / ") || "Unobserved", id], group };
  }));
  return [
    savePanel("Ascension profile", profileFacts(value.ascension)),
    slayerRecords([...profileRows(value.ascension, names), ...rows], ["Ascension upgrades", "Milestones", ...COMPANION_SYSTEMS.map(system => systemNames[system])]),
    saveTable({ title: "Tracking details", columns: ["System", "Tracking", "Source", "Observed"],
      rows: modules.map(([system, module]) => ({ cells: [systemNames[system] ?? system, module.tracked ? "On" : "Off",
        module.source ? sourceNames[module.source] : "Unrecorded", module.observedAt ? date(module.observedAt) : "Unrecorded"] })), empty: "No tracked systems." }),
  ];
}

function intentions(state: CompanionWorkspace, names: SlayerNames): HTMLElement[] {
  const goals = state.goals.map(({ ref, mode }) => ({ cells: [
    (ref.system === "ascension" ? names.upgrades.get(ref.id) : names.entities.get(`${ref.system}:${ref.id}`)) ?? ref.id,
    systemNames[ref.system] ?? ref.system, human(mode), ref.id,
  ] }));
  return [
    saveTable({ title: "Goals", columns: ["Goal", "System", "Action", "Saved identifier"], rows: goals, empty: "No saved goals." }),
    saveTable({ title: "Recipe plans", columns: ["Recipe", "Quantity", "Saved identifier"], rows: Object.entries(state.recipePlans)
      .map(([id, quantity]) => ({ cells: [names.entities.get(`craft:${id}`) ?? id, quantity, id] })), empty: "No planned recipe quantities." }),
  ];
}

function checkpoints(state: CheckpointVault, names: SlayerNames): HTMLElement[] {
  if (!state.entries.length) return [savePanel("Progress checkpoints", item("p", "No saved checkpoints."))];
  return [savePanel("Progress checkpoints", ...state.entries.map(entry => {
    const section = item("details", "", "admin-checkpoint");
    section.append(item("summary", entry.name));
    section.addEventListener("toggle", () => {
      if (section.open && section.childElementCount === 1) {
        section.append(facts([["Captured revision", entry.capturedRevision], ["Checkpoint ID", entry.id]]),
          profileFacts(entry.profile), slayerRecords(profileRows(entry.profile, names), ["Ascension upgrades", "Milestones"]));
      }
    });
    return section;
  }))];
}

export async function savedDataView(save: SavedVersion, json: string, context: ViewerContext): Promise<HTMLElement[] | null> {
  const value: unknown = JSON.parse(json);
  if (save.schemaVersion !== 1 || !record(value)) return null;
  if (save.app === "pokedex-binder" && value.schemaVersion === 1) {
    if (save.document === "binder") return national(value, context);
    if (save.document === "master-sets" && Array.isArray(value.binders)) return master(value as unknown as MasterState, context);
    if (save.document === "preferences" && (value.mode === "all" || value.mode === "selected") &&
      Array.isArray(value.stores) && value.stores.every(store => typeof store === "string")) {
      return [savePanel("Retailer lookup settings", retailerFields(value.mode, value.stores))];
    }
  }
  if (save.app === "radius-map" && save.document === "measurements" && value.version === 1) {
    const state = readMeasurementsDocument(value);
    return [saveTable({ title: "Saved measurements", columns: ["Name", "Location", "Latitude / longitude", "Measurement", "Visibility", "Created", "Updated"],
      rows: state.measurements.map(m => {
        const visibility = m.visible ? "Visible" : "Hidden";
        return { cells: [m.name, m.locationLabel, `${m.center.lat}, ${m.center.lng}`, `${m.value} ${m.unit} ${m.kind}`, visibility,
          date(m.createdAt), date(m.updatedAt)], group: visibility };
      }), search: "Search measurements", filter: { label: "Visibility", choices: ["Visible", "Hidden"] }, empty: "No saved measurements." })];
  }
  if (save.app !== "idle-slayer-companion" || value.version !== 1) return null;
  const names = await slayerNames(context.signal);
  if (save.document === "progress" && value.format === "idle-slayer-companion-progress") return slayerProgress(value as unknown as CompanionProgress, names);
  if (save.document === "intentions" && value.format === "idle-slayer-companion-workspace") return intentions(value as unknown as CompanionWorkspace, names);
  if (save.document === "checkpoints" && value.kind === "progress-checkpoints" && Array.isArray(value.entries)) return checkpoints(value as unknown as CheckpointVault, names);
  if (save.document === "comparison" && value.kind === "upgrade-comparison" && Array.isArray(value.ids)) {
    return [saveTable({ title: "Compared upgrades", columns: ["Order", "Upgrade", "Saved identifier"],
      rows: value.ids.map((id: string, index) => ({ cells: [String(index + 1), names.upgrades.get(id) ?? id, id] })), empty: "No saved upgrade comparison." })];
  }
  return null;
}
