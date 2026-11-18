import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BinderStore } from "../../src/utilities/pokedex-binder/lib/store";
import type { Species } from "../../src/utilities/pokedex-binder/lib/model";

const species: Species[] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `Pokémon ${i + 1}`, generation: 1, printingCount: 1 }));
const stores: BinderStore[] = [];
afterEach(() => { stores.forEach(store => store.close()); stores.length = 0; vi.restoreAllMocks(); });
function newStore(indexedDB: IDBFactory, name = "test-binder") { const store = new BinderStore({ species, indexedDB, name, broadcast: false }); stores.push(store); return store; }

async function rawValue(factory: IDBFactory, name: string, value?: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open(name, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("binder", value === undefined ? "readonly" : "readwrite");
      const request = value === undefined ? tx.objectStore("binder").get("main") : tx.objectStore("binder").put(value, "main");
      let result: unknown;
      request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

describe("transactional binder storage", () => {
  it("persists layout, ownership and browser identity across reloads", async () => {
    const indexedDB = new IDBFactory(), original = newStore(indexedDB);
    const first = await original.open();
    await original.update(doc => { doc.state.ownedDexIds = [17]; doc.state.settings.columns = 3; return doc; });
    original.close();
    const reopened = newStore(indexedDB); const next = await reopened.open();
    expect(next.clientId).toBe(first.clientId);
    expect(next.state.ownedDexIds).toEqual([17]);
    expect(next.state.settings.columns).toBe(3);
    expect(reopened.warning).toBeNull();
  });
  it("serializes simultaneous tab edits without dropping either change", async () => {
    const indexedDB = new IDBFactory(), first = newStore(indexedDB), second = newStore(indexedDB);
    await Promise.all([first.open(), second.open()]);
    expect(first.read().clientId).toBe(second.read().clientId);
    await Promise.all([
      first.update(doc => { doc.state.ownedDexIds = [...doc.state.ownedDexIds, 1]; return doc; }),
      second.update(doc => { doc.state.ownedDexIds = [...doc.state.ownedDexIds, 2]; return doc; }),
    ]);
    await first.refresh(); await second.refresh();
    expect(first.read().state.ownedDexIds).toEqual([1, 2]);
    expect(second.read().state.ownedDexIds).toEqual([1, 2]);
  });
  it("leaves unsupported persisted data untouched and allows exportable session edits", async () => {
    const indexedDB = new IDBFactory(), first = newStore(indexedDB);
    await first.open(); first.close();
    const original = { version: 99, data: "preserve-this-value" };
    await rawValue(indexedDB, "test-binder", original);
    const reopened = newStore(indexedDB); await reopened.open();
    expect(reopened.warning).toContain("could not be opened");
    await reopened.update(doc => { doc.state.ownedDexIds = [5]; return doc; });
    expect(reopened.read().state.ownedDexIds).toEqual([5]);
    expect(await rawValue(indexedDB, "test-binder")).toEqual(original);
  });
  it("reports unavailable storage instead of pretending the session was saved", async () => {
    const store = new BinderStore({ species, indexedDB: null, broadcast: false }); stores.push(store);
    await store.open(); await store.update(doc => { doc.state.ownedDexIds = [8]; return doc; });
    expect(store.read().state.ownedDexIds).toEqual([8]);
    expect(store.warning).toMatch(/export a backup/);
  });
  it("keeps a quota-failed edit in memory and preserves the last persisted document", async () => {
    const indexedDB = new IDBFactory(), store = newStore(indexedDB); await store.open();
    await store.update(doc => { doc.state.ownedDexIds = [1]; return doc; });
    const saved = await rawValue(indexedDB, "test-binder");
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("Quota reached", "QuotaExceededError"); });
    await store.update(doc => { doc.state.ownedDexIds = [1, 2]; return doc; });
    expect(store.warning).toContain("could not save");
    expect(store.read().state.ownedDexIds).toEqual([1, 2]);
    expect(await rawValue(indexedDB, "test-binder")).toEqual(saved);
  });
});
