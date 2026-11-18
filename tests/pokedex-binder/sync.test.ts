import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { cloneState, defaultState, type BinderState, type Species } from "../../src/utilities/pokedex-binder/lib/model";
import { createBinderController, generateSyncKey, validSyncKey, type BinderController } from "../../src/utilities/pokedex-binder/lib/sync";

const species: Species[] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `Pokémon ${i + 1}`, generation: 1, printingCount: 1 }));
const controllers: BinderController[] = [];
afterEach(() => { controllers.forEach(controller => controller.stop()); controllers.length = 0; });

function service() {
  const binders = new Map<string, { state: BinderState; revision: number; acks: Map<string, number> }>();
  const revoked = new Set<string>();
  const requests: { method: string; url: string; key: string; body: any }[] = [];
  let losePatchResponse = false, loseDeleteResponse = false, loseCreateResponse = false, offline = false;
  let pendingPatch: (() => Promise<void>) | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    if (offline) throw new TypeError("Offline");
    const headers = new Headers(init?.headers), key = headers.get("X-Pokedex-Key")!, client = headers.get("X-Pokedex-Client")!;
    const method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, url: String(_input), key, body });
    if (method === "POST" && revoked.has(key)) return Response.json({ error: { code: "binder_revoked" } }, { status: 410 });
    if (method === "POST" && !binders.has(key)) binders.set(key, { state: cloneState(body.state), revision: 1, acks: new Map() });
    if (method === "POST" && loseCreateResponse) { loseCreateResponse = false; throw new TypeError("Create response lost after commit"); }
    const binder = binders.get(key);
    if (!binder) return Response.json({ error: { code: "binder_not_found" } }, { status: 404 });
    if (method === "DELETE") {
      binders.delete(key);
      revoked.add(key);
      if (loseDeleteResponse) { loseDeleteResponse = false; throw new TypeError("Delete response lost after commit"); }
      return Response.json({ deleted: true });
    }
    const reply = () => ({ schemaVersion: 1, revision: binder.revision, state: binder.state, acknowledgedSequence: binder.acks.get(client) ?? 0 });
    if (method === "PATCH") {
      if (pendingPatch) { const wait = pendingPatch; pendingPatch = undefined; await wait(); }
      const ack = binder.acks.get(client) ?? 0;
      if (body.mutationSequence > ack) {
        if (body.mutationSequence !== ack + 1) return Response.json({ ...reply(), error: { code: "sequence_gap" } }, { status: 409 });
        if (body.baseRevision !== binder.revision) return Response.json({ ...reply(), error: { code: "revision_conflict" } }, { status: 409 });
        binder.state = cloneState(body.state); binder.revision++; binder.acks.set(client, body.mutationSequence);
      }
      if (losePatchResponse) { losePatchResponse = false; throw new TypeError("Response lost after commit"); }
    }
    return Response.json(reply());
  };
  return { binders, requests, fetcher, setOffline(value: boolean) { offline = value; }, loseNextResponse() { losePatchResponse = true; }, loseNextDeleteResponse() { loseDeleteResponse = true; }, loseNextCreateResponse() { loseCreateResponse = true; },
    holdNextPatch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); pendingPatch = () => promise; return release; } };
}
async function controller(api: ReturnType<typeof service>) {
  const result = createBinderController({ species, indexedDB: null, broadcast: false, fetch: api.fetcher, autoSync: false });
  controllers.push(result); await result.start(); return result;
}

describe("private keys and local-first use", () => {
  it("generates canonical 256-bit keys and rejects truncated or noncanonical values", () => {
    const key = generateSyncKey();
    expect(validSyncKey(key)).toBe(true);
    expect(key).toHaveLength(47);
    expect(validSyncKey(key.slice(0, -1))).toBe(false);
    expect(validSyncKey("pdx_" + "_".repeat(43))).toBe(false);
  });
  it("works without IndexedDB and does not create cloud state before requested", async () => {
    const api = service(), app = await controller(api);
    await app.setOwned(17, true);
    expect(app.snapshot()).toMatchObject({ status: "local", connected: false, state: { ownedDexIds: [17] } });
    expect(app.snapshot().storageWarning).toContain("unavailable");
    expect(api.requests).toHaveLength(0);
    const key = await app.createSync();
    expect(api.binders.get(key)?.state.ownedDexIds).toEqual([17]);
    expect(app.snapshot().status).toBe("synced");
    expect(api.requests.every(request => request.url === "/utilities/pokedex-binder/api/binder.php" && !JSON.stringify(request.body).includes(key))).toBe(true);
  });
  it("never changes the local collection when a key fails validation or lookup", async () => {
    const api = service(), app = await controller(api);
    await app.setOwned(2, true);
    await expect(app.connect("invalid")).rejects.toThrow(/complete/);
    await expect(app.connect(generateSyncKey())).rejects.toThrow(/not found/);
    expect(app.snapshot().state.ownedDexIds).toEqual([2]);
    expect(api.binders.size).toBe(0);
  });
});

describe("reliable collection synchronization", () => {
  it("merges independent edits from two browser identities after a revision conflict", async () => {
    const api = service(), phone = await controller(api), desktop = await controller(api);
    const key = await phone.createSync(); await desktop.connect(key);
    await phone.setOwned(1, true); await desktop.setOwned(2, true);
    await phone.sync(); await desktop.sync(); await phone.sync();
    expect(phone.snapshot().state.ownedDexIds).toEqual([1, 2]);
    expect(desktop.snapshot().state.ownedDexIds).toEqual([1, 2]);
    expect(api.binders.get(key)?.revision).toBe(3);
  });
  it("does not replay an acknowledged edit after a lost response and a later opposite edit", async () => {
    const api = service(), phone = await controller(api), desktop = await controller(api);
    const key = await phone.createSync(); await desktop.connect(key);
    await phone.setOwned(1, true); api.loseNextResponse(); await phone.sync();
    expect(phone.snapshot().status).toBe("error");
    await desktop.sync(); await desktop.setOwned(1, false); await desktop.sync();
    expect(api.binders.get(key)?.state.ownedDexIds).toEqual([]);
    await phone.setOwned(2, true); await phone.sync();
    expect(phone.snapshot().state.ownedDexIds).toEqual([2]);
    expect(api.binders.get(key)?.state.ownedDexIds).toEqual([2]);
    const phonePatches = api.requests.filter(request => request.method === "PATCH" && request.body.clientId === api.requests.find(request => request.method === "PATCH")?.body.clientId);
    expect(phonePatches.map(request => request.body.mutationSequence)).toEqual([1, 1, 2]);
  });
  it("keeps edits made while a frozen request is in flight", async () => {
    const api = service(), app = await controller(api), key = await app.createSync();
    await app.setOwned(1, true);
    const release = api.holdNextPatch(); const syncing = app.sync();
    await new Promise(resolve => setTimeout(resolve, 5));
    await app.setOwned(2, true); release(); await syncing;
    expect(api.binders.get(key)?.state.ownedDexIds).toEqual([1, 2]);
    expect(api.requests.filter(request => request.method === "PATCH").map(request => request.body.state.ownedDexIds)).toEqual([[1], [1, 2]]);
  });
  it("reloads the exact frozen mutation and pending edits after a lost response", async () => {
    const api = service(), indexedDB = new IDBFactory();
    const options = { species, indexedDB, name: "durable-outbox", broadcast: false, fetch: api.fetcher, autoSync: false };
    const original = createBinderController(options); controllers.push(original); await original.start();
    const key = await original.createSync(); await original.setOwned(1, true); api.loseNextResponse(); await original.sync();
    await original.setOwned(2, true); original.stop();
    const remote = await controller(api); await remote.connect(key); await remote.setOwned(1, false); await remote.sync();
    const reopened = createBinderController(options); controllers.push(reopened); await reopened.start(); await reopened.sync();
    expect(reopened.snapshot().state.ownedDexIds).toEqual([2]);
    expect(api.binders.get(key)?.state.ownedDexIds).toEqual([2]);
    expect(reopened.snapshot().status).toBe("synced");
  });
  it("allows a surviving tab to flush a shared edit after the editing tab closes", async () => {
    const api = service(), indexedDB = new IDBFactory();
    const options = { species, indexedDB, name: "shared-surviving-tab", fetch: api.fetcher };
    const first = createBinderController(options), second = createBinderController(options); controllers.push(first, second);
    await first.start(); await second.start(); const key = await first.createSync();
    await first.setOwned(17, true); first.stop();
    const until = Date.now() + 2000;
    while (!api.binders.get(key)?.state.ownedDexIds.includes(17) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
    expect(api.binders.get(key)?.state.ownedDexIds).toEqual([17]);
    expect(second.snapshot().state.ownedDexIds).toEqual([17]);
  });
  it("persists a layout conflict instead of silently overwriting another device", async () => {
    const api = service(), phone = await controller(api), desktop = await controller(api), key = await phone.createSync(); await desktop.connect(key);
    await phone.setSettings({ ...defaultState().settings, rows: 3 });
    await desktop.setSettings({ ...defaultState().settings, columns: 3 });
    await phone.sync(); await desktop.sync();
    expect(desktop.snapshot().status).toBe("conflict");
    expect(api.binders.get(key)?.state.settings).toMatchObject({ rows: 3, columns: 4 });
    await desktop.resolveLayout("remote");
    expect(desktop.snapshot().status).toBe("synced");
    expect(desktop.snapshot().state.settings).toMatchObject({ rows: 3, columns: 4 });
  });
  it("recovers local work after network failure and keeps it after disconnect or cloud deletion", async () => {
    const api = service(), app = await controller(api), key = await app.createSync();
    api.setOffline(true); await app.setOwned(7, true); await app.sync();
    expect(app.snapshot().state.ownedDexIds).toEqual([7]);
    api.setOffline(false); await app.sync();
    expect(app.snapshot().status).toBe("synced");
    await app.disconnect(); expect(app.snapshot()).toMatchObject({ connected: false, state: { ownedDexIds: [7] } });
    await app.connect(key); await app.deleteCloud();
    expect(api.binders.has(key)).toBe(false);
    expect(app.snapshot()).toMatchObject({ connected: false, state: { ownedDexIds: [7] } });
  });
  it("warns about an older server snapshot without dropping the local collection", async () => {
    const api = service(), app = await controller(api), key = await app.createSync();
    await app.setOwned(3, true); await app.sync();
    const remote = api.binders.get(key)!; remote.revision = 1; remote.state = defaultState();
    await app.sync();
    expect(app.snapshot()).toMatchObject({ status: "error", state: { ownedDexIds: [3] } });
    expect(app.snapshot().error).toContain("older");
  });
  it("can finish disconnecting after a committed deletion loses its response", async () => {
    const api = service(), app = await controller(api), key = await app.createSync();
    await app.setOwned(3, true); await app.sync();
    api.loseNextDeleteResponse(); await expect(app.deleteCloud()).rejects.toThrow(/reach sync/);
    expect(api.binders.has(key)).toBe(false);
    expect(app.snapshot().connected).toBe(true);
    await app.deleteCloud();
    expect(app.snapshot()).toMatchObject({ connected: false, state: { ownedDexIds: [3] } });
  });
  it("does not recreate a revoked key when retrying a lost initial create response", async () => {
    const api = service(), original = await controller(api), other = await controller(api);
    await original.setOwned(3, true); api.loseNextCreateResponse(); const key = await original.createSync();
    expect(original.snapshot().status).toBe("error");
    await other.connect(key); await other.deleteCloud(); await original.sync();
    expect(api.binders.has(key)).toBe(false);
    expect(original.snapshot()).toMatchObject({ connected: false, state: { ownedDexIds: [3] } });
    expect(original.snapshot().error).toContain("deleted");
    const requests = api.requests.length; await original.sync(); expect(api.requests.length).toBe(requests);
  });
});
