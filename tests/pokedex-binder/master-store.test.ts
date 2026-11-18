import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { APIError, type AccountClient, type DocumentWrite, type RemoteDocument } from "../../packages/accounts/client";
import { BinderRecovery } from "../../src/utilities/pokedex-binder/lib/recovery";
import { emptyMaster, newBinder, type MasterState } from "../../src/utilities/pokedex-binder/lib/master";
import { MasterStore, app, documentName } from "../../src/utilities/pokedex-binder/lib/master-store";

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
