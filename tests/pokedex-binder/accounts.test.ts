import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { APIError, type AccountClient, type AccountSession, type DocumentWrite, type MigrationCommit, type MigrationStage, type RemoteDocument } from "../../packages/accounts/client";
import { combineMigrationSources, createUnifiedBinderController } from "../../src/utilities/pokedex-binder/lib/accounts";
import { BinderStore, STORAGE_NAME } from "../../src/utilities/pokedex-binder/lib/store";
import { defaultState, cloneState, type BinderState, type Species } from "../../src/utilities/pokedex-binder/lib/model";
import { generateSyncKey } from "../../src/utilities/pokedex-binder/lib/sync";

const species: Species[] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `Pokémon ${i + 1}`, generation: 1, printingCount: 1 }));
const controllers: ReturnType<typeof createUnifiedBinderController>[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.stop()); vi.restoreAllMocks(); });
function state(ids: number[], rows = 4): BinderState { return { ...defaultState(), ownedDexIds: ids, settings: { ...defaultState().settings, rows } }; }

function service(initial: BinderState | null = null) {
  let session: AccountSession = { enabled: true, migrationEnabled: true, user: { id: "account-a", email: "a@example.test" }, csrfToken: "test" };
  const listeners = new Set<(session: AccountSession) => void>();
  const documents = new Map<string, RemoteDocument<BinderState>>();
  if (initial) documents.set("account-a", { resourceId: "resource-a", app: "pokedex-binder", document: "binder", schemaVersion: 1, revision: 1, state: initial, acknowledgedSequence: 0 });
  const setDocs = new Map<string, RemoteDocument>();
  const acks = new Map<string, number>(), stages = new Map<string, Map<string, MigrationStage<BinderState>>>(), committed = new Set<string>();
  const legacy = new Map<string, { revision: number; state: BinderState; acks: Map<string, number>; revoked: boolean }>();
  const calls: { account: string; operation: string; body?: unknown }[] = [];
  const snapshots: BinderState[] = [];
  let loseCommit = false, loseLegacyPatch = false, heldCommit: Promise<void> | null = null, heldWrite: Promise<void> | null = null;
  const assertAccount = (id: string) => { if (session.user?.id !== id) throw new APIError("Account changed", "account_changed", 409); };
  function client(id: string): AccountClient {
    return {
      async getDocument(_app: string, _document: string, clientId: string) {
        assertAccount(id); calls.push({ account: id, operation: "read" });
        if (_document === "master-sets") return structuredClone(setDocs.get(id) ?? null);
        const value = documents.get(id);
        return value ? structuredClone({ ...value, acknowledgedSequence: acks.get(`${id}:${clientId}`) ?? 0 }) : null;
      },
      async writeDocument(body: DocumentWrite<BinderState>) {
        assertAccount(id); calls.push({ account: id, operation: "write", body });
        const prior = documents.get(id)!;
        const ackKey = `${id}:${body.clientId}`, ack = acks.get(ackKey) ?? 0;
        if (body.mutationSequence > ack) {
          if (body.baseRevision !== prior.revision) throw new APIError("Revision conflict", "revision_conflict", 409, { remote: structuredClone({ ...prior, acknowledgedSequence: ack }) });
          prior.state = cloneState(body.state); prior.revision++; acks.set(ackKey, body.mutationSequence);
        }
        const result = structuredClone({ ...prior, acknowledgedSequence: acks.get(ackKey) ?? 0 });
        if (heldWrite) { const held = heldWrite; heldWrite = null; await held; }
        return result;
      },
      async stageMigration(body: MigrationStage<BinderState>) {
        assertAccount(id); calls.push({ account: id, operation: "stage", body });
        const key = `${id}:${body.migrationId}`;
        if (!stages.has(key)) stages.set(key, new Map());
        stages.get(key)!.set(body.document+":"+body.variant, structuredClone(body));
        return { staged: true };
      },
      async commitMigration(body: MigrationCommit, legacyKey?: string) {
        assertAccount(id); calls.push({ account: id, operation: "commit", body });
        const migrationKey = `${id}:${body.migrationId}`;
        if (!committed.has(migrationKey)) {
          const staged = stages.get(migrationKey)!, prior = documents.get(id), legacySource = legacyKey ? legacy.get(legacyKey) : undefined;
          if ((prior?.revision ?? 0) !== body.documents[0].baseRevision || legacySource && legacySource.revision !== body.legacy?.revision) throw new APIError("Copies changed. Review again.", "revision_conflict", 409);
          if (prior) snapshots.push(cloneState(prior.state));
          if (legacySource) snapshots.push(cloneState(legacySource.state));
          snapshots.push(cloneState(staged.get("binder:device")!.state));
          documents.set(id, { resourceId: `resource-${id}`, app: "pokedex-binder", document: "binder", schemaVersion: 1, revision: (prior?.revision ?? 0) + 1,
            state: cloneState(staged.get("binder:selected")!.state), acknowledgedSequence: 0 });
          if (legacySource) legacySource.revoked = true;
          const sets = staged.get("master-sets:selected");
          if (sets) setDocs.set(id,{ resourceId:"set-doc-"+id, app:"pokedex-binder",document:"master-sets",schemaVersion:1, revision:(setDocs.get(id)?.revision??0)+1, state:structuredClone(sets.state),acknowledgedSequence:0 });
          committed.add(migrationKey);
        }
        if (heldCommit) { const held = heldCommit; heldCommit = null; await held; }
        if (loseCommit) { loseCommit = false; throw new APIError("Response lost", "network_error", 0); }
        return { documents: [structuredClone(documents.get(id)!)] };
      },
    } as unknown as AccountClient;
  }
  const fetcher: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers), key = headers.get("X-Pokedex-Key")!, clientId = headers.get("X-Pokedex-Client")!;
    const row = legacy.get(key);
    if (!row) return Response.json({ error: { code: "binder_not_found" } }, { status: 404 });
    if (row.revoked) return Response.json({ error: { code: "binder_revoked" } }, { status: 410 });
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (init?.method === "PATCH") {
      if ((row.acks.get(clientId) ?? 0) < body.mutationSequence) { row.state = cloneState(body.state); row.revision++; row.acks.set(clientId, body.mutationSequence); }
      if (loseLegacyPatch) { loseLegacyPatch = false; throw new TypeError("Lost legacy response"); }
    }
    return Response.json({ schemaVersion: 1, revision: row.revision, state: row.state, acknowledgedSequence: row.acks.get(clientId) ?? 0 });
  };
  return {
    documents, calls, snapshots, legacy, fetcher,
    accounts: { getSession: async () => session, subscribeSession(listener: (session: AccountSession) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, client },
    setUser(id: string | null) { session = { ...session, user: id ? { id, email: `${id}@example.test` } : null }; listeners.forEach(listener => listener(session)); },
    loseNextCommit() { loseCommit = true; }, loseNextLegacyPatch() { loseLegacyPatch = true; },
    holdCommit() { let release!: () => void; heldCommit = new Promise<void>(resolve => { release = resolve; }); return release; },
    holdWrite() { let release!: () => void; heldWrite = new Promise<void>(resolve => { release = resolve; }); return release; },
  };
}
async function controller(api: ReturnType<typeof service>, indexedDB = new IDBFactory()) {
  const app = createUnifiedBinderController({ species, indexedDB, broadcast: false, autoSync: false, accounts: api.accounts, fetch: api.fetcher });
  controllers.push(app); await app.start(); return app;
}
async function migrate(app: Awaited<ReturnType<typeof controller>>, layout: "device" | "account" = "device") {
  const preview = await app.previewMigration();
  await app.migrate(preview, combineMigrationSources(preview, layout));
}
async function tick() { await new Promise(resolve => setTimeout(resolve, 10)); }

describe("optional Binder accounts and non-destructive migration", () => {
  it("does not replace or upload a guest collection merely because the user is signed in", async () => {
    const api = service(state([25])), app = await controller(api);
    await app.setOwned(1, true); await app.sync();
    expect(app.accountState().mode).toBe("guest");
    expect(app.snapshot().state.ownedDexIds).toEqual([1]);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([25]);
    expect(api.calls).toEqual([]);
  });
  it("previews layout differences and unions unrelated collections without treating absence as deletion", async () => {
    const api = service(state([25], 3)), indexedDB = new IDBFactory(), app = await controller(api, indexedDB);
    await app.setOwned(1, true);
    const preview = await app.previewMigration();
    expect(preview.layoutConflict).toBe(true);
    const selected = combineMigrationSources(preview, "account");
    expect(selected).toEqual(state([1, 25], 3));
    await app.migrate(preview, selected);
    expect(app.accountState().mode).toBe("account");
    expect(app.snapshot().state).toEqual(selected);
    const original = new BinderStore({ species, indexedDB, broadcast: false }); await original.open();
    expect(original.read().state.ownedDexIds).toEqual([1]); original.close();
    expect(api.snapshots).toContainEqual(state([1]));
    expect(api.snapshots).toContainEqual(state([25], 3));
    expect(await app.recoveryBackups()).not.toContain("pdx_");
  });
  it("rebases guest set edits made during adoption without discarding exact finishes", async () => {
    const api=service(), app=await controller(api);
    const { newBinder }=await import("../../src/utilities/pokedex-binder/lib/master");
    const b=newBinder("sv03.5","151");
    await app.masters.update("guest",s=>s.state.binders.push(b));
    const preview=await app.previewMigration(),release=api.holdCommit();
    const pending=app.migrate(preview,combineMigrationSources(preview,"device"));
    while(!api.calls.some(c=>c.operation==="commit"))await tick();
    await app.masters.update("guest",s=>{s.state.binders[0].owned=["001:reverse"];});
    release();await pending;
    const account=await app.masters.read("account-a");
    expect(account.state.binders[0].owned).toEqual(["001:reverse"]);
    expect(account.baseline.binders[0].owned).toEqual([]);
  });
  it("retains unsynced local marks when upgrading a device with a retired key", async () => {
    const api = service(), indexedDB = new IDBFactory();
    const old = new BinderStore({species,indexedDB,broadcast:false}); await old.open();
    await old.update(doc=>{doc.state=state([7]);doc.session={key:generateSyncKey(),revision:1,baseline:state([]),creating:false,nextSequence:1,inFlight:null};return doc;});old.close();
    const app=await controller(api,indexedDB);
    expect(app.snapshot().state.ownedDexIds).toEqual([7]); expect(app.snapshot().connected).toBe(false);
    await migrate(app);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([7]);
  });
  it("resumes the same committed migration after its response is lost without overwriting copies", async () => {
    const api = service(state([25])), app = await controller(api);
    await app.setOwned(1, true); const preview = await app.previewMigration();
    api.loseNextCommit();
    await expect(app.migrate(preview, combineMigrationSources(preview, "device"))).rejects.toThrow(/lost/);
    expect(app.accountState().mode).toBe("guest");
    expect(app.snapshot().state.ownedDexIds).toEqual([1]);
    await app.resumeMigration();
    expect(app.snapshot().state.ownedDexIds).toEqual([1, 25]);
    expect(api.snapshots).toHaveLength(2);
    const commits = api.calls.filter(call => call.operation === "commit").map(call => (call.body as MigrationCommit).migrationId);
    expect(new Set(commits).size).toBe(1);
  });
  it("rebases edits made while the migration response is in flight", async () => {
    const api = service(state([25])), app = await controller(api);
    await app.setOwned(1, true); const preview = await app.previewMigration(), release = api.holdCommit();
    const pending = app.migrate(preview, combineMigrationSources(preview, "device"));
    while (!api.calls.some(call => call.operation === "commit")) await tick();
    await app.setOwned(2, true); await app.setOwned(1, false); release(); await pending;
    expect(app.snapshot().state.ownedDexIds).toEqual([2, 25]);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([2, 25]);
  });
  it("rejects a stale preview and leaves both source collections untouched", async () => {
    const api = service(state([25])), app = await controller(api);
    await app.setOwned(1, true); const preview = await app.previewMigration(); await app.setOwned(2, true);
    await expect(app.migrate(preview, combineMigrationSources(preview, "device"))).rejects.toThrow(/changed/);
    expect(app.snapshot().state.ownedDexIds).toEqual([1, 2]);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([25]);
    expect(api.calls.some(call => call.operation === "commit")).toBe(false);
  });
  it("preserves a rejected concurrent migration and allows reviewing the newer account copy", async () => {
    const api = service(state([25])), app = await controller(api);
    await app.setOwned(1, true); const preview = await app.previewMigration();
    api.documents.get("account-a")!.revision++; api.documents.get("account-a")!.state = state([25, 26]);
    await expect(app.migrate(preview, combineMigrationSources(preview, "device"))).rejects.toThrow(/changed/);
    expect(app.accountState().pendingMigration).toBe(false);
    expect(app.snapshot().state.ownedDexIds).toEqual([1]);
    const next = await app.previewMigration();
    await app.migrate(next, combineMigrationSources(next, "device"));
    expect(app.snapshot().state.ownedDexIds).toEqual([1, 25, 26]);
    const recovery = JSON.parse(await app.recoveryBackups());
    expect(recovery.backups.some((item: { phase: string }) => item.phase === "review")).toBe(true);
  });
  it("fences delayed write responses after logout and preserves the original account outbox", async () => {
    const api = service(), indexedDB = new IDBFactory(), app = await controller(api, indexedDB);
    await migrate(app); await app.setOwned(7, true); const release = api.holdWrite();
    const pending = app.sync();
    while (!api.calls.some(call => call.operation === "write")) await tick();
    api.setUser("account-b"); await tick(); release(); await pending;
    expect(app.accountState().mode).toBe("guest");
    expect(app.snapshot().state.ownedDexIds).toEqual([]);
    expect(api.documents.has("account-b")).toBe(false);
    const original = new BinderStore({ species, indexedDB, name: `${STORAGE_NAME}.account.account-a`, broadcast: false }); await original.open();
    expect(original.read().state.ownedDexIds).toEqual([7]);
    expect(original.read().session?.inFlight?.state.ownedDexIds).toEqual([7]); original.close();
    api.setUser("account-a"); await tick(); await app.sync();
    expect(app.accountState().mode).toBe("account");
    expect(app.snapshot().state.ownedDexIds).toEqual([7]);
    expect(app.snapshot().status).toBe("synced");
  });
  it("keeps independent account identities in separate local stores", async () => {
    const api = service(), app = await controller(api);
    await app.setOwned(1, true); await migrate(app);
    api.setUser("account-b"); await tick();
    expect(app.accountState().mode).toBe("guest");
    expect(api.calls.some(call => call.account === "account-b")).toBe(false);
    await app.setOwned(2, true); await migrate(app);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([1]);
    expect(api.documents.get("account-b")!.state.ownedDexIds).toEqual([1, 2]);
    const recovery = JSON.parse(await app.recoveryBackups());
    expect(recovery.backups.every((item: { device: BinderState }) => item.device.ownedDexIds.includes(2))).toBe(true);
  });
  it("reopens an explicitly connected account offline and queues edits without authorizing uploads", async () => {
    const api = service(), indexedDB = new IDBFactory(), first = await controller(api, indexedDB);
    await first.setOwned(7, true); await migrate(first); first.stop();
    const offline = createUnifiedBinderController({ species, indexedDB, broadcast: false, autoSync: false, accounts: { ...api.accounts, getSession: async () => { throw new TypeError("Offline"); } } });
    controllers.push(offline); const before = api.calls.length; await offline.start();
    expect(offline.accountState()).toMatchObject({ mode: "account", offline: true, user: { id: "account-a" } });
    expect(offline.snapshot().state.ownedDexIds).toEqual([7]);
    await offline.setOwned(8, true); await offline.sync();
    expect(api.calls).toHaveLength(before);
    expect(offline.snapshot().state.ownedDexIds).toEqual([7, 8]);
    api.setUser("account-a"); await tick(); await offline.sync();
    expect(offline.accountState().offline).toBe(false);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([7, 8]);
  });
  it.each([null, "account-b"])("pins an exportable account visit after quota failure and session change to %s", async (nextUser) => {
    const api = service(), indexedDB = new IDBFactory(), app = await controller(api, indexedDB);
    await app.setOwned(1, true); await migrate(app);
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await app.setOwned(7, true);
    expect(app.snapshot().storageWarning).toContain("could not save");
    const requests = api.calls.length;
    api.setUser(nextUser); await tick(); await app.sync();
    expect(app.accountState()).toMatchObject({ mode: "account", storageNeedsRecovery: true, retainedAccount: { id: "account-a" } });
    expect(app.snapshot().state.ownedDexIds).toEqual([1, 7]);
    expect(api.calls).toHaveLength(requests);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([1]);
    await app.recheckConnection();
    expect(app.accountState().mode).toBe("guest");
    expect(app.snapshot().state.ownedDexIds).toEqual([1]);
    api.setUser("account-a"); await tick(); await app.sync();
    expect(app.snapshot().state.ownedDexIds).toEqual([1, 7]);
    expect(api.documents.get("account-a")!.state.ownedDexIds).toEqual([1, 7]);
  });
  it("refuses a quota-recovery retry when another window changed the saved account copy", async () => {
    const api = service(), indexedDB = new IDBFactory(), app = await controller(api, indexedDB);
    await app.setOwned(1, true); await migrate(app);
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await app.setOwned(7, true); api.setUser("account-b"); await tick();
    const other = new BinderStore({ species, indexedDB, broadcast: false, name: `${STORAGE_NAME}.account.account-a` }); await other.open();
    await other.update(doc => { doc.state.ownedDexIds = [1, 9]; return doc; });
    await expect(app.recheckConnection()).rejects.toThrow(/Another window/);
    expect(app.snapshot().state.ownedDexIds).toEqual([1, 7]);
    expect(app.accountState().retainedAccount?.id).toBe("account-a");
    await other.refresh(); expect(other.read().state.ownedDexIds).toEqual([1, 9]); other.close();
  });
});
