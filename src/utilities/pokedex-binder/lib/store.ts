import { defaultState, record, validateSettings, validateState, type BinderSettings, type BinderState, type Species } from "./model";

export interface InFlightMutation { sequence: number; baseRevision: number; baseline: BinderState; state: BinderState }
export interface SyncSession {
  key: string;
  revision: number;
  baseline: BinderState;
  nextSequence: number;
  inFlight: InFlightMutation | null;
  creating: boolean;
}
export interface StoredBinder {
  version: 1;
  state: BinderState;
  clientId: string;
  session: SyncSession | null;
  layoutConflict: { local: BinderSettings; remote: BinderSettings } | null;
}
export const STORAGE_NAME = "austingarrod.utilities.pokedex-binder.v1";

export function freshDocument(): StoredBinder {
  return { version: 1, state: defaultState(), clientId: crypto.randomUUID(), session: null, layoutConflict: null };
}
export function copyDocument(doc: StoredBinder): StoredBinder { return structuredClone(doc); }
export function validateDocument(value: unknown, species: readonly Species[]): StoredBinder {
  if (!record(value) || value.version !== 1 || typeof value.clientId !== "string" || !/^[a-f0-9-]{36}$/i.test(value.clientId)) throw new Error("Unsupported saved binder format.");
  const result: StoredBinder = { version: 1, state: validateState(value.state, species), clientId: value.clientId, session: null, layoutConflict: null };
  if (value.session !== null) {
    const session = value.session;
    if (!record(session) || typeof session.key !== "string" || !/^pdx_[A-Za-z0-9_-]{43}$/.test(session.key)
      || !Number.isSafeInteger(session.revision) || Number(session.revision) < 0 || !Number.isSafeInteger(session.nextSequence)
      || Number(session.nextSequence) < 1 || typeof session.creating !== "boolean") throw new Error("Unsupported saved sync format.");
    result.session = { key: session.key, revision: Number(session.revision), nextSequence: Number(session.nextSequence),
      baseline: validateState(session.baseline, species), creating: session.creating, inFlight: null };
    if (session.inFlight !== null) {
      const flight = session.inFlight;
      if (!record(flight) || !Number.isSafeInteger(flight.sequence) || flight.sequence !== session.nextSequence
        || !Number.isSafeInteger(flight.baseRevision) || Number(flight.baseRevision) < 0) throw new Error("Unsupported pending sync format.");
      result.session.inFlight = { sequence: Number(flight.sequence), baseRevision: Number(flight.baseRevision),
        baseline: validateState(flight.baseline, species), state: validateState(flight.state, species) };
    }
  }
  if (value.layoutConflict !== null) {
    if (!record(value.layoutConflict)) throw new Error("Unsupported saved layout choice.");
    result.layoutConflict = { local: validateSettings(value.layoutConflict.local), remote: validateSettings(value.layoutConflict.remote) };
  }
  return result;
}

export interface BinderStoreOptions { species: readonly Species[]; indexedDB?: IDBFactory | null; name?: string; broadcast?: boolean }

/** Every read/modify/write is one IndexedDB transaction, including edits from other tabs. */
export class BinderStore {
  private database: IDBDatabase | null = null;
  private current: StoredBinder = freshDocument();
  private channel: BroadcastChannel | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly factory: IDBFactory | null;
  readonly name: string;
  warning: string | null = null;

  constructor(private readonly options: BinderStoreOptions) {
    this.name = options.name ?? STORAGE_NAME;
    try { this.factory = options.indexedDB === undefined ? globalThis.indexedDB ?? null : options.indexedDB; }
    catch { this.factory = null; }
  }
  async open(): Promise<StoredBinder> {
    if (!this.factory) { this.warning = "Browser storage is unavailable. Keep this page open and export a backup before leaving."; return this.read(); }
    try {
      this.database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory!.open(this.name, 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("binder")) request.result.createObjectStore("binder"); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Close other binder windows to finish opening storage."));
      });
      this.database.onversionchange = () => { this.database?.close(); this.database = null; this.warning = "Binder storage changed in another window. Reload this page before editing."; this.emit(false); };
      await this.update(doc => doc, false);
      if (this.options.broadcast !== false && typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel(this.name);
        this.channel.onmessage = () => { void this.refresh().catch(() => undefined); };
      }
    } catch {
      this.database?.close(); this.database = null;
      this.warning ??= "Browser storage could not be opened. This session is usable, but export a backup before leaving.";
    }
    return this.read();
  }
  read(): StoredBinder { return copyDocument(this.current); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(broadcast = true): void { this.listeners.forEach(listener => listener()); if (broadcast) this.channel?.postMessage("changed"); }
  async refresh(): Promise<StoredBinder> {
    if (!this.database) return this.read();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = this.database!.transaction("binder", "readonly"), request = tx.objectStore("binder").get("main");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (raw !== undefined) this.current = validateDocument(raw, this.options.species);
    this.emit(false); return this.read();
  }
  async update(change: (doc: StoredBinder) => StoredBinder, broadcast = true): Promise<StoredBinder> {
    if (!this.database) {
      this.current = validateDocument(change(copyDocument(this.current)), this.options.species);
      this.emit(broadcast); return this.read();
    }
    let next: StoredBinder | undefined;
    let rejectedChange: unknown;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = this.database!.transaction("binder", "readwrite"), store = tx.objectStore("binder"), request = store.get("main");
        request.onsuccess = () => {
          try {
            const doc = request.result === undefined ? copyDocument(this.current) : validateDocument(request.result, this.options.species);
            next = validateDocument(change(doc), this.options.species);
          } catch (error) { rejectedChange = error; reject(error); tx.abort(); }
          if (next && !rejectedChange) {
            try { store.put(next, "main"); } catch (error) { reject(error); tx.abort(); }
          }
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("Save interrupted."));
      });
      this.current = next!;
    } catch {
      if (rejectedChange) throw rejectedChange;
      this.database?.close(); this.database = null;
      // Never replace unreadable persisted bytes with a fresh default document.
      this.warning = "This browser could not save the binder. Your saved data has been left untouched; export this session before leaving.";
      this.current = next ?? validateDocument(change(copyDocument(this.current)), this.options.species);
    }
    this.emit(broadcast); return this.read();
  }
  close(): void { this.channel?.close(); this.channel = null; this.database?.close(); this.database = null; this.listeners.clear(); }
}
