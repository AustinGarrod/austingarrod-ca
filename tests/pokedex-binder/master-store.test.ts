import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { APIError, type AccountClient, type DocumentWrite, type RemoteDocument } from "../../packages/accounts/client";
import { BinderRecovery } from "../../src/utilities/pokedex-binder/lib/recovery";
import { emptyMaster, newBinder, type MasterState } from "../../src/utilities/pokedex-binder/lib/master";
import { MasterStore, app, conflictInvolvesDelete, documentName } from "../../src/utilities/pokedex-binder/lib/master-store";

afterEach(() => vi.unstubAllGlobals());
describe("set binder account sync", () => {
  it("replays a lost acknowledgment exactly and keeps disjoint edits from two devices", async () => {
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, fn: () => unknown) => fn() } });
    const first = new MasterStore(new BinderRecovery(new IDBFactory())),
      second = new MasterStore(new BinderRecovery(new IDBFactory()));
    const master = newBinder("sv03.5", "Master"),
      trade = newBinder("sv03.5", "Trade");
    let state = emptyMaster(),
      revision = 0,
      lose = false;
    const sequences = new Map<string, number>(),
      seen = new Map<string, string>();
    const remote = (id: string): RemoteDocument<MasterState> => ({
      app,
      document: documentName,
      resourceId: "resource",
      schemaVersion: 1,
      revision,
      acknowledgedSequence: sequences.get(id) ?? 0,
      state: structuredClone(state),
    });
    const client = {
      getDocument: async (_app: string, _doc: string, id: string) => (revision ? remote(id) : null),
      writeDocument: async (f: DocumentWrite<MasterState>) => {
        if (seen.has(f.operationId)) {
          expect(seen.get(f.operationId)).toBe(JSON.stringify(f));
          return remote(f.clientId);
        }
        if (f.baseRevision !== revision)
          throw new APIError("Changed", "revision_conflict", 409, { remote: remote(f.clientId) });
        state = structuredClone(f.state);
        revision++;
        sequences.set(f.clientId, f.mutationSequence);
        seen.set(f.operationId, JSON.stringify(f));
        if (lose) {
          lose = false;
          throw new Error("Response lost");
        }
        return remote(f.clientId);
      },
    } as AccountClient;
    const sync = (store: MasterStore) => store.sync("account", client, () => true);
    await first.update("account", (s) => s.state.binders.push(master, trade));
    await sync(first);
    await sync(second);
    await first.update("account", (s) => (s.state.binders[0].owned = ["001:reverse"]));
    lose = true;
    await expect(sync(first)).rejects.toThrow("Response lost");
    expect((await first.read("account")).flight).toBeTruthy();
    await sync(first);
    await second.update("account", (s) => {
      s.state.binders[0].owned = ["002:normal"];
      s.state.binders[1].name = "Trades";
    });
    await sync(second);
    await sync(second);
    expect(state.binders.find((b) => b.id === trade.id)?.name).toBe("Trades");
    expect(state.binders.find((b) => b.id === master.id)?.owned).toEqual(["001:reverse", "002:normal"]);
    await sync(first);
    await first.update("account", (s) => {
      s.state.binders[0].name = "First";
    });
    await sync(first);
    await second.update("account", (s) => {
      s.state.binders[0].name = "Second";
    });
    await sync(second);
    expect((await second.read("account")).conflict).toBeTruthy();
    await second.resolve("account");
    await sync(second);
    expect(state.binders.map((b) => b.name)).toEqual(expect.arrayContaining(["First", "Second (device)"]));
    expect((await second.read("guest")).state).toEqual(emptyMaster());
  });
});

describe("deleting a set binder", () => {
  function server() {
    let state = emptyMaster(), revision = 0;
    const sequences = new Map<string, number>(), writes: DocumentWrite<MasterState>[] = [];
    const remote = (id: string): RemoteDocument<MasterState> => ({
      app, document: documentName, resourceId: "resource", schemaVersion: 1, revision,
      acknowledgedSequence: sequences.get(id) ?? 0, state: structuredClone(state),
    });
    const client = {
      getDocument: async (_app: string, _doc: string, id: string) => (revision ? remote(id) : null),
      writeDocument: async (f: DocumentWrite<MasterState>) => {
        writes.push(structuredClone(f));
        if (f.baseRevision !== revision) throw new APIError("Changed", "revision_conflict", 409, { remote: remote(f.clientId) });
        state = structuredClone(f.state);
        revision++;
        sequences.set(f.clientId, f.mutationSequence);
        return remote(f.clientId);
      },
    } as AccountClient;
    return { client, writes, state: () => state };
  }
  async function devices() {
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, fn: () => unknown) => fn() } });
    const remote = server();
    const first = new MasterStore(new BinderRecovery(new IDBFactory())),
      second = new MasterStore(new BinderRecovery(new IDBFactory()));
    const sync = (store: MasterStore) => store.sync("account", remote.client, () => true);
    const keep = newBinder("sv03.5", "Keep"), doomed = newBinder("sv03.5", "Doomed");
    await first.update("account", (s) => s.state.binders.push(keep, doomed));
    await sync(first);
    await sync(second);
    return { remote, first, second, sync, keep, doomed };
  }

  it("removes the binder everywhere and asks the account to keep the previous version", async () => {
    const { remote, first, second, sync, keep, doomed } = await devices();
    await first.remove("account", doomed.id);
    expect((await first.read("account")).preservePrevious).toBe(true);
    await sync(first);
    expect(remote.writes.at(-1)?.preservePrevious).toBe(true);
    expect((await first.read("account")).preservePrevious).toBeUndefined();
    expect(remote.state().binders.map((b) => b.id)).toEqual([keep.id]);
    await sync(second);
    expect((await second.read("account")).state.binders.map((b) => b.id)).toEqual([keep.id]);
    await expect(first.remove("account", doomed.id)).rejects.toThrow("already deleted");
  });

  it("does not ask a device-only library to keep a recovery copy", async () => {
    const store = new MasterStore(new BinderRecovery(new IDBFactory()));
    const binder = newBinder("sv03.5", "Guest");
    await store.update("guest", (s) => s.state.binders.push(binder));
    await store.remove("guest", binder.id);
    const saved = await store.read("guest");
    expect(saved.state.binders).toEqual([]);
    expect(saved.preservePrevious).toBeUndefined();
  });

  it("keeps an edit made elsewhere to a binder deleted on this device", async () => {
    const { remote, first, second, sync, doomed } = await devices();
    await second.update("account", (s) => { s.state.binders.find((b) => b.id === doomed.id)!.owned = ["001:normal"]; });
    await sync(second);
    await first.remove("account", doomed.id);
    await sync(first);
    const saved = await first.read("account");
    expect(saved.conflict).toBeTruthy();
    expect(conflictInvolvesDelete(saved)).toBe(true);
    await first.resolve("account");
    await sync(first);
    expect(remote.state().binders.find((b) => b.id === doomed.id)?.owned).toEqual(["001:normal"]);
  });

  it("keeps a copy of an edit made here to a binder deleted elsewhere", async () => {
    const { remote, first, second, sync, keep, doomed } = await devices();
    await first.remove("account", doomed.id);
    await sync(first);
    await second.update("account", (s) => { s.state.binders.find((b) => b.id === doomed.id)!.name = "Renamed"; });
    await sync(second);
    const saved = await second.read("account");
    expect(saved.conflict).toBeTruthy();
    expect(conflictInvolvesDelete(saved)).toBe(true);
    await second.resolve("account");
    await sync(second);
    expect(remote.state().binders.map((b) => b.name)).toEqual(["Keep", "Renamed (device)"]);
    expect(remote.state().binders.some((b) => b.id === doomed.id)).toBe(false);
    expect(remote.state().binders[0].id).toBe(keep.id);
  });

  it("merges a delete with an untouched or already deleted binder without a conflict", async () => {
    const { remote, first, second, sync, keep, doomed } = await devices();
    await second.update("account", (s) => { s.state.binders.find((b) => b.id === keep.id)!.owned = ["002:normal"]; });
    await first.remove("account", doomed.id);
    await sync(first);
    await second.remove("account", doomed.id);
    // The first write is rejected and merged; the second writes the merged library.
    await sync(second);
    await sync(second);
    const saved = await second.read("account");
    expect(saved.conflict).toBeNull();
    expect(conflictInvolvesDelete(saved)).toBe(false);
    expect(remote.state().binders.map((b) => [b.id, b.owned])).toEqual([[keep.id, ["002:normal"]]]);
  });

  it("describes an ordinary edit conflict as not involving a delete", async () => {
    const { first, second, sync, doomed } = await devices();
    await first.update("account", (s) => { s.state.binders.find((b) => b.id === doomed.id)!.name = "First"; });
    await sync(first);
    await second.update("account", (s) => { s.state.binders.find((b) => b.id === doomed.id)!.name = "Second"; });
    await sync(second);
    const saved = await second.read("account");
    expect(saved.conflict).toBeTruthy();
    expect(conflictInvolvesDelete(saved)).toBe(false);
  });
});
