import { cloneState, mergeStates, record, sameState, validateSettings, validateState, type BinderSettings, type BinderState } from "./model";
import { BinderStore, type BinderStoreOptions, type StoredBinder } from "./store";

export type BinderStatus = "loading" | "local" | "syncing" | "synced" | "pending" | "error" | "conflict";
export interface BinderSnapshot {
  state: BinderState;
  status: BinderStatus;
  error: string | null;
  storageWarning: string | null;
  connected: boolean;
  key: string | null;
  layoutConflict: { local: BinderSettings; remote: BinderSettings } | null;
}
export interface RemoteBinder { schemaVersion: 1; revision: number; state: BinderState; acknowledgedSequence: number }
export interface BinderControllerOptions extends BinderStoreOptions {
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
  store?: BinderStore;
  autoSync?: boolean;
}

export function generateSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "pdx_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function validSyncKey(key: string): boolean {
  if (!/^pdx_[A-Za-z0-9_-]{43}$/.test(key)) return false;
  try {
    const raw = atob(key.slice(4).replace(/-/g, "+").replace(/_/g, "/") + "=");
    return raw.length === 32 && "pdx_" + btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === key;
  } catch { return false; }
}

class SyncError extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly remote?: RemoteBinder) { super(message); }
}

export function createBinderController(options: BinderControllerOptions) {
  const store = options.store ?? new BinderStore(options);
  const endpoint = options.endpoint ?? "/utilities/pokedex-binder/api/binder.php";
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  const listeners = new Set<(snapshot: BinderSnapshot) => void>();
  let busy = false, started = false, stopped = false;
  let error: string | null = null;
  let serial: Promise<void> = Promise.resolve();
  let interval: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeStore: (() => void) | undefined;

  function snapshot(): BinderSnapshot {
    const doc = store.read(), session = doc.session;
    const status: BinderStatus = !started ? "loading" : doc.layoutConflict ? "conflict" : error ? "error" : busy ? "syncing"
      : !session ? "local" : session.creating || session.inFlight || !sameState(doc.state, session.baseline) ? "pending" : "synced";
    return { state: cloneState(doc.state), status, error, storageWarning: store.warning, connected: !!session, key: session?.key ?? null,
      layoutConflict: doc.layoutConflict ? structuredClone(doc.layoutConflict) : null };
  }
  function emit(): void { const value = snapshot(); listeners.forEach(listener => listener(value)); }
  function subscribe(listener: (value: BinderSnapshot) => void): () => void { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); }
  function schedule(): void {
    if (options.autoSync === false || stopped) return;
    clearTimeout(debounce); debounce = setTimeout(() => { void sync(); }, 350);
  }
  async function start(): Promise<void> {
    if (started) return;
    await store.open(); started = true;
    unsubscribeStore = store.subscribe(() => {
      emit();
      const doc = store.read();
      if (!busy && !error && doc.session && !doc.layoutConflict
        && (doc.session.creating || doc.session.inFlight || !sameState(doc.state, doc.session.baseline))) schedule();
    });
    if (options.autoSync !== false) {
      interval = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") void sync(); }, 30000);
      if (typeof window !== "undefined") { window.addEventListener("focus", refreshEvent); window.addEventListener("online", refreshEvent); document.addEventListener("visibilitychange", visibilityEvent); }
      schedule();
    }
    emit();
  }
  function refreshEvent(): void { void sync(); }
  function visibilityEvent(): void { if (document.visibilityState === "visible") void sync(); }
  function parseRemote(raw: unknown): RemoteBinder {
    if (!record(raw) || raw.schemaVersion !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1
      || (raw.acknowledgedSequence !== undefined && (!Number.isSafeInteger(raw.acknowledgedSequence) || Number(raw.acknowledgedSequence) < 0))) {
      throw new SyncError("The sync service returned an unsupported response. Your local binder is safe.", "invalid_response", 0);
    }
    return { schemaVersion: 1, revision: Number(raw.revision), state: validateState(raw.state, options.species), acknowledgedSequence: Number(raw.acknowledgedSequence ?? 0) };
  }
  async function request(method: string, key: string, body?: unknown): Promise<RemoteBinder | null> {
    const clientId = store.read().clientId;
    let response: Response;
    let raw: unknown;
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 15000);
    try {
      response = await send(endpoint, { method, cache: "no-store", credentials: "same-origin",
        signal: abort.signal,
        headers: { "X-Pokedex-Key": key, "X-Pokedex-Client": clientId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      try { raw = await response.json(); } catch { throw new SyncError("The sync service is unavailable. Your local binder is safe.", "invalid_response", response.status); }
    } catch (cause) {
      if (cause instanceof SyncError) throw cause;
      throw new SyncError("Could not reach sync. Your changes are kept in this page; retry when connected.", "network", 0);
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      const code = record(raw) && record(raw.error) && typeof raw.error.code === "string" ? raw.error.code : "unavailable";
      const message = code === "binder_revoked" ? "This synced binder was deleted. Your local collection is kept here; create a new sync key to start again."
        : response.status === 401 || response.status === 404 ? "This sync key was not found or is no longer valid. Your local binder is safe."
        : response.status === 429 ? "Sync is temporarily rate limited. Your local changes are safe; try again shortly."
        : code === "sequence_gap" ? "This device's sync history needs refreshing. Disconnect and reconnect with your key after exporting a backup."
        : response.status === 422 ? "The sync service could not accept this binder. Export a backup before refreshing the page."
        : "Sync is temporarily unavailable. Your local changes are safe; try again shortly.";
      throw new SyncError(message, code, response.status, code === "revision_conflict" ? parseRemote(raw) : undefined);
    }
    if (method === "DELETE") return null;
    return parseRemote(raw);
  }

  async function serialized<T>(run: () => Promise<T>): Promise<T> {
    const execute = async () => {
      if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`${store.name}.sync`, run);
      return run();
    };
    const promise = serial.then(execute, execute); serial = promise.then(() => undefined, () => undefined); return promise;
  }
  function rebase(doc: StoredBinder, remote: RemoteBinder, base: BinderState): StoredBinder {
    const merged = mergeStates(base, doc.state, remote.state);
    doc.state = merged.state;
    doc.layoutConflict = merged.layoutConflict ? { local: { ...doc.state.settings }, remote: { ...remote.state.settings } } : null;
    doc.session!.baseline = cloneState(remote.state); doc.session!.revision = remote.revision;
    return doc;
  }
  async function runSync(): Promise<void> {
    try { await store.refresh(); }
    catch { error = "The saved binder could not be read. Export this page's collection before refreshing."; emit(); return; }
    if (!store.read().session || store.read().layoutConflict || stopped) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { error = null; emit(); return; }
    busy = true; error = null; emit();
    let attemptedKey: string | null = null;
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        let doc = store.read();
        const session = doc.session;
        if (!session || doc.layoutConflict) break;
        const key = session.key;
        attemptedKey = key;
        if (session.creating) {
          const remote = (await request("POST", key, { state: session.baseline }))!;
          await store.update(current => {
            if (current.session?.key !== key || !current.session.creating) return current;
            rebase(current, remote, current.session.baseline);
            current.session!.creating = false; current.session!.nextSequence = remote.acknowledgedSequence + 1;
            return current;
          });
          continue;
        }
        if (!session.inFlight && sameState(doc.state, session.baseline)) {
          const remote = (await request("GET", key))!;
          if (remote.revision < session.revision) throw new SyncError("The synced binder is older than this device's saved copy. Export a backup before reconnecting.", "older_revision", 0);
          await store.update(current => {
            if (current.session?.key !== key || current.session.inFlight || remote.revision < current.session.revision) return current;
            rebase(current, remote, current.session.baseline);
            current.session!.nextSequence = Math.max(current.session!.nextSequence, remote.acknowledgedSequence + 1);
            return current;
          });
          doc = store.read();
          if (doc.layoutConflict || !doc.session || sameState(doc.state, doc.session.baseline)) break;
          continue;
        }
        if (!session.inFlight) {
          await store.update(current => {
            if (current.session?.key !== key || current.session.inFlight || current.layoutConflict || sameState(current.state, current.session.baseline)) return current;
            current.session.inFlight = { sequence: current.session.nextSequence, baseRevision: current.session.revision,
              baseline: cloneState(current.session.baseline), state: cloneState(current.state) };
            return current;
          });
        }
        const flight = store.read().session?.inFlight;
        if (!flight) continue;
        try {
          const remote = (await request("PATCH", key, { clientId: doc.clientId, mutationSequence: flight.sequence, baseRevision: flight.baseRevision, state: flight.state }))!;
          if (remote.acknowledgedSequence < flight.sequence) throw new SyncError("Sync did not acknowledge this change. Your local binder is safe; retry shortly.", "invalid_ack", 0);
          await store.update(current => {
            if (current.session?.key !== key || current.session.inFlight?.sequence !== flight.sequence || remote.revision < current.session.revision) return current;
            // The frozen payload has already been applied. Rebase only edits made after it.
            rebase(current, remote, flight.state);
            current.session!.inFlight = null; current.session!.nextSequence = remote.acknowledgedSequence + 1;
            return current;
          });
        } catch (cause) {
          if (!(cause instanceof SyncError) || cause.code !== "revision_conflict" || !cause.remote) throw cause;
          const remote = cause.remote;
          await store.update(current => {
            if (current.session?.key !== key || current.session.inFlight?.sequence !== flight.sequence || remote.revision < current.session.revision) return current;
            rebase(current, remote, flight.baseline); current.session!.inFlight = null;
            return current;
          });
        }
        doc = store.read();
        if (doc.layoutConflict || !doc.session || (!doc.session.inFlight && sameState(doc.state, doc.session.baseline))) break;
      }
    } catch (cause) {
      if (store.read().session?.key !== attemptedKey) error = null;
      else {
        if (cause instanceof SyncError && cause.code === "binder_revoked") {
          await store.update(doc => { if (doc.session?.key === attemptedKey) { doc.session = null; doc.layoutConflict = null; } return doc; });
        }
        error = cause instanceof SyncError ? cause.message : "Sync could not finish. Your local binder is safe; export a backup and retry.";
      }
    }
    finally { busy = false; emit(); }
  }
  async function sync(): Promise<void> { if (!started || stopped) return; await serialized(runSync); }
  async function edit(change: (state: BinderState) => BinderState): Promise<void> {
    await store.update(doc => { doc.state = validateState(change(cloneState(doc.state)), options.species); if (doc.layoutConflict) doc.layoutConflict.local = { ...doc.state.settings }; return doc; });
    emit(); schedule();
  }
  async function setOwned(id: number, owned: boolean): Promise<void> {
    if (!options.species.some(item => item.id === id)) throw new Error("This Pokémon is not in the catalog.");
    await edit(state => { const ids = new Set(state.ownedDexIds); if (owned) ids.add(id); else ids.delete(id); state.ownedDexIds = [...ids].sort((a, b) => a - b); return state; });
  }
  async function setSettings(settings: BinderSettings): Promise<void> { const validated = validateSettings(settings); await edit(state => ({ ...state, settings: validated })); }
  async function replaceState(state: BinderState): Promise<void> { const validated = validateState(state, options.species); await edit(() => validated); }
  async function createSync(): Promise<string> {
    const key = await serialized(async () => {
      await store.refresh();
      if (store.read().session) return store.read().session!.key;
      const generated = generateSyncKey();
      await store.update(doc => { doc.session = { key: generated, revision: 0, baseline: cloneState(doc.state), nextSequence: 1, inFlight: null, creating: true }; return doc; });
      return generated;
    });
    await sync(); return key;
  }
  async function checkKey(key: string): Promise<RemoteBinder> {
    const trimmed = key.trim();
    if (!validSyncKey(trimmed)) throw new Error("Paste the complete private sync key, starting with pdx_.");
    return (await request("GET", trimmed))!;
  }
  async function connect(key: string): Promise<void> {
    await serialized(async () => {
      await store.refresh(); const previous = store.read();
      const remote = await checkKey(key);
      await store.update(doc => {
        if (!sameState(previous.state, doc.state) || previous.session?.key !== doc.session?.key
          || previous.session?.revision !== doc.session?.revision
          || previous.session?.inFlight?.sequence !== doc.session?.inFlight?.sequence) throw new Error("The local binder changed while connecting. Review it and try again.");
        doc.state = cloneState(remote.state); doc.layoutConflict = null;
        doc.session = { key: key.trim(), revision: remote.revision, baseline: cloneState(remote.state), nextSequence: remote.acknowledgedSequence + 1, inFlight: null, creating: false };
        return doc;
      });
      error = null; emit();
    });
  }
  async function disconnect(): Promise<void> {
    await serialized(async () => { await store.update(doc => { doc.session = null; doc.layoutConflict = null; return doc; }); error = null; emit(); });
  }
  async function deleteCloud(): Promise<void> {
    await serialized(async () => {
      await store.refresh(); const key = store.read().session?.key;
      if (!key) return;
      try { await request("DELETE", key); }
      catch (cause) {
        // A successful deletion may lose its response. Repeating it must still detach this device.
        if (!(cause instanceof SyncError) || !["binder_not_found", "binder_revoked"].includes(cause.code)) throw cause;
      }
      await store.update(doc => { if (doc.session?.key === key) { doc.session = null; doc.layoutConflict = null; } return doc; });
      error = null; emit();
    });
  }
  async function resolveLayout(choice: "local" | "remote"): Promise<void> {
    await store.update(doc => { if (doc.layoutConflict) { doc.state.settings = { ...doc.layoutConflict[choice] }; doc.layoutConflict = null; } return doc; });
    emit(); await sync();
  }
  function stop(): void {
    stopped = true; clearInterval(interval); clearTimeout(debounce); unsubscribeStore?.(); store.close(); listeners.clear();
    if (typeof window !== "undefined") { window.removeEventListener("focus", refreshEvent); window.removeEventListener("online", refreshEvent); document.removeEventListener("visibilitychange", visibilityEvent); }
  }
  return { start, subscribe, snapshot, setOwned, setSettings, replaceState, createSync, checkKey, connect, disconnect, deleteCloud, sync, resolveLayout, stop };
}
export type BinderController = ReturnType<typeof createBinderController>;
