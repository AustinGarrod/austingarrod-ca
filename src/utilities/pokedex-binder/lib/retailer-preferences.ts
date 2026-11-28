import { APIError, createAccountClient, type DocumentWrite, type RemoteDocument } from "../../../../packages/accounts/client";
import { buyingStores, type BuyingStore } from "./buying-offers";
import { BinderRecovery } from "./recovery";

export interface RetailerPreferences {
  schemaVersion: 1;
  mode: "all" | "selected";
  stores: BuyingStore[];
}

const app = "pokedex-binder", documentName = "preferences";
const defaults: RetailerPreferences = { schemaVersion: 1, mode: "all", stores: [] };
const same = (a: RetailerPreferences, b: RetailerPreferences) =>
  a.mode === b.mode && a.stores.length === b.stores.length && a.stores.every((store, index) => store === b.stores[index]);

export function retailerChoices(mode: RetailerPreferences["mode"], stores: readonly string[]): RetailerPreferences {
  return { schemaVersion: 1, mode, stores: mode === "all" ? [] : buyingStores.filter(store => stores.includes(store)) };
}

export function enabledRetailers(value: RetailerPreferences): readonly BuyingStore[] {
  return value.mode === "all" ? buyingStores : value.stores;
}

interface SavedPreferences {
  state: RetailerPreferences;
  baseline: RetailerPreferences;
  clientId: string;
  revision: number;
  sequence: number;
  ready: boolean;
  conflict?: true;
  flight?: DocumentWrite<RetailerPreferences>;
}

export interface RetailerSettings {
  scope: string | undefined;
  value?: RetailerPreferences;
  draft?: RetailerPreferences;
  guest?: RetailerPreferences;
  status: "loading" | "local" | "synced" | "pending" | "conflict" | "error";
}

function fresh(guest: boolean): SavedPreferences {
  return { state: defaults, baseline: defaults, clientId: crypto.randomUUID(), revision: 0, sequence: 0, ready: guest };
}

function readRemote(remote: RemoteDocument<RetailerPreferences> | null): RetailerPreferences {
  if (!remote) return defaults;
  const state = remote.state;
  if (remote.app !== app || remote.document !== documentName || remote.schemaVersion !== 1 || state?.schemaVersion !== 1
    || !["all", "selected"].includes(state.mode) || !Array.isArray(state.stores)
    || !state.stores.every(store => typeof store === "string")) {
    throw new Error("Saved retailer choices could not be read.");
  }
  // Retired shops are removed from the effective list without widening a custom selection.
  return retailerChoices(state.mode, state.stores);
}

export function createRetailerPreferences(onChange: (settings: RetailerSettings) => void) {
  const storage = new BinderRecovery();
  const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("pokedex-binder.preferences");
  const key = (owner: string) => "preferences:" + owner;
  let scope: string | undefined, verified = false, generation = 0, saved: SavedPreferences | undefined;
  let guest: RetailerPreferences | undefined, failed = false;

  function publish() {
    const pending = saved && (!!saved.flight || !same(saved.state, saved.baseline));
    onChange({
      scope,
      value: saved?.ready ? saved.conflict ? saved.baseline : saved.state : undefined,
      draft: saved?.conflict ? saved.state : undefined,
      guest: scope !== "guest" && saved?.ready && saved.revision === 0 && !pending ? guest : undefined,
      status: failed ? "error" : !saved?.ready ? "loading" : saved.conflict ? "conflict"
        : scope === "guest" ? "local" : pending ? "pending" : "synced",
    });
  }

  async function load(owner: string, ticket: number) {
    try {
      const record = await storage.get<SavedPreferences>(key(owner));
      if (ticket !== generation) return;
      saved = record ?? fresh(owner === "guest");
      if (owner !== "guest") {
        const device = await storage.get<SavedPreferences>(key("guest"));
        if (ticket !== generation) return;
        guest = device?.state.mode === "selected" ? device.state : undefined;
      }
      failed = false;
    } catch {
      if (ticket !== generation) return;
      // Browsing defaults are usable for guests even if their browser has disabled local storage.
      if (owner === "guest" && !saved) saved = fresh(true);
      failed = true;
    }
    publish();
  }

  async function sync() {
    const owner = scope, ticket = generation;
    const active = () => generation === ticket && verified;
    if (!owner || owner === "guest" || !active() || !navigator.onLine) return;
    try {
      await navigator.locks.request("pokedex-preferences:" + owner, async () => {
        if (!active()) return;
        const request = await storage.update<SavedPreferences>(key(owner), current => {
          const record = current ?? fresh(false);
          if (!record.flight && !record.conflict && !same(record.state, record.baseline)) {
            record.flight = {
              app, document: documentName, schemaVersion: 1, state: record.state,
              clientId: record.clientId, baseRevision: record.revision,
              mutationSequence: record.sequence + 1, operationId: crypto.randomUUID(),
            };
          }
          return record;
        });
        if (!active()) return;
        const client = createAccountClient(owner);
        let remote: RemoteDocument<RetailerPreferences> | null, rejected = false;
        try {
          remote = request.flight ? await client.writeDocument(request.flight) :
            await client.getDocument<RetailerPreferences>(app, documentName, request.clientId);
        } catch (error) {
          if (!(error instanceof APIError) || error.status !== 409 || error.remote === undefined) throw error;
          remote = error.remote as RemoteDocument<RetailerPreferences> | null;
          rejected = true;
        }
        if (!active()) return;
        const baseline = readRemote(remote);
        const result = await storage.update<SavedPreferences>(key(owner), current => {
          const record = current ?? request;
          if (record.flight?.operationId !== request.flight?.operationId || record.revision !== request.revision) return record;
          const before = request.flight?.state ?? request.baseline;
          const dirty = !same(record.state, before) || !!record.conflict;
          if ((rejected || dirty && !same(baseline, before)) && !same(record.state, baseline)) record.conflict = true;
          else {
            delete record.conflict;
            if (!dirty) record.state = baseline;
          }
          record.baseline = baseline;
          record.revision = remote?.revision ?? 0;
          record.sequence = remote?.acknowledgedSequence ?? 0;
          record.ready = true;
          delete record.flight;
          return record;
        });
        channel?.postMessage(owner);
        if (active()) { saved = result; failed = false; publish(); }
      });
    } catch {
      if (active()) { failed = true; publish(); }
    }
  }

  async function save(value: RetailerPreferences) {
    const owner = scope, ticket = generation;
    if (!owner || !saved?.ready) return;
    try {
      const result = await storage.update<SavedPreferences>(key(owner), current => {
        const record = current ?? fresh(owner === "guest");
        record.state = value;
        if (owner === "guest") record.baseline = value;
        delete record.conflict;
        return record;
      });
      channel?.postMessage(owner);
      if (ticket !== generation) return;
      saved = result; failed = false; publish();
      void sync();
    } catch {
      if (ticket === generation) { failed = true; publish(); }
    }
  }

  channel?.addEventListener("message", event => {
    if (scope && event.data === scope) void load(scope, generation);
  });
  window.addEventListener("online", () => void sync());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void sync(); });

  return {
    setScope(owner: string, canSync: boolean) {
      if (scope === owner) {
        if (verified !== canSync) {
          verified = canSync;
          if (verified) void sync();
          else if (saved?.ready) { failed = false; publish(); }
        }
        return;
      }
      scope = owner; verified = canSync; saved = guest = undefined; failed = false;
      const ticket = ++generation;
      publish();
      void load(owner, ticket).then(() => { if (ticket === generation) void sync(); });
    },
    sync,
    save,
  };
}
