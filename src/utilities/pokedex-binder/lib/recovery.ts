import { abortWriteOnSignal } from "./abort-write";

/** A separate journal leaves the original guest IndexedDB schema and bytes intact. */
export class BinderRecovery {
  private database: IDBDatabase | null = null;
  constructor(private readonly factory: IDBFactory | null | undefined = globalThis.indexedDB) {}
  private async open(signal?: AbortSignal): Promise<IDBDatabase> {
    if (signal?.aborted) throw signal.reason;
    if (this.database) return this.database;
    if (!this.factory) throw new Error("Browser storage is unavailable. Export a backup before connecting an account.");
    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open("austingarrod.utilities.pokedex-binder.recovery.v1", 1);
      let abandoned = false;
      const fail = (error: unknown) => {
        abandoned = true;
        signal?.removeEventListener("abort", cancel);
        reject(error);
      };
      const cancel = () => fail(signal?.reason);
      request.onupgradeneeded = () => request.result.createObjectStore("records");
      request.onsuccess = () => {
        signal?.removeEventListener("abort", cancel);
        if (abandoned) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("Close other binder windows before reviewing migration."));
      signal?.addEventListener("abort", cancel, { once: true });
    });
    this.database.onversionchange = () => { this.database?.close(); this.database = null; };
    return this.database;
  }
  async get<T>(key: string): Promise<T | undefined> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("records", "readonly"), request = tx.objectStore("records").get(key);
      request.onsuccess = () => resolve(request.result as T | undefined); request.onerror = () => reject(request.error);
    });
  }
  async put(key: string, value: unknown): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("records", "readwrite");
      tx.objectStore("records").put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  async update<T>(key: string, apply: (current: T | undefined) => T, signal?: AbortSignal): Promise<T> {
    const database = await this.open(signal);
    if (signal?.aborted) throw signal.reason;
    return new Promise((resolve, reject) => {
      const tx = database.transaction("records", "readwrite"), store = tx.objectStore("records");
      abortWriteOnSignal(tx, signal);
      const request = store.get(key);
      let value: T;
      request.onsuccess = () => {
        try { value = apply(request.result as T | undefined); store.put(value, key); }
        catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("Set binders could not be saved."));
    });
  }
  async all(): Promise<{ key: string; value: unknown }[]> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("records", "readonly"), request = tx.objectStore("records").openCursor();
      const result: { key: string; value: unknown }[] = [];
      request.onsuccess = () => { const cursor = request.result; if (cursor) { result.push({ key: String(cursor.key), value: cursor.value }); cursor.continue(); } };
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error);
    });
  }
  close(): void { this.database?.close(); this.database = null; }
}
