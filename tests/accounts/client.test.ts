import { afterEach, describe, expect, it, vi } from "vitest";

const account = (id = "account-a") => ({ enabled: true, migrationEnabled: true, user: { id, email: "player@example.test" }, csrfToken: "csrf-dummy" });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("shared account client isolation", () => {
  it.each(["verify", "logout"])("serializes a pending discovery with %s before another cookie can arrive", async action => {
    let complete!: (response: Response) => void;
    let discoveries = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("action=session")) {
        if (++discoveries === 1) return json(account());
        return new Promise<Response>(resolve => { complete = resolve; });
      }
      return json(action === "verify" ? account("account-b") : { ...account(), user: null });
    });
    vi.stubGlobal("fetch", fetch);
    const client = await import("../../packages/accounts/client");
    await client.getSession();
    const discovering = client.refreshSession();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const mutating = action === "verify" ? client.verifyEmailCode("dummy", "123456") : client.signOut();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetch).toHaveBeenCalledTimes(2);
    complete(json(account()));
    await discovering; await mutating;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(client.peekSession()?.user?.id ?? null).toBe(action === "verify" ? "account-b" : null);
  });
  it("coalesces session discovery so first load cannot create competing cookies", async () => {
    let complete!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const { getSession, refreshSession } = await import("../../packages/accounts/client");
    const first = getSession(), second = refreshSession();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    complete(json(account()));
    expect((await first).user?.id).toBe("account-a");
    expect(await second).toEqual(await first);
  });
  it("fences reads and writes to the captured account and excludes cached requests", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      calls.push([url, options]);
      return url.includes("auth.php") ? json(account()) : json({ document: null });
    }));
    const { createAccountClient } = await import("../../packages/accounts/client");
    const client = createAccountClient("account-a");
    await client.getDocument("pokedex-binder", "binder", "device-a");
    await client.writeDocument({ app: "pokedex-binder", document: "binder", state: {}, schemaVersion: 1, baseRevision: 0, clientId: "device-a", mutationSequence: 1, operationId: "operation-a" });
    const sync = calls.filter(([url]) => url.includes("sync.php"));
    expect(sync).toHaveLength(2);
    for (const [, options] of sync) {
      expect(options?.headers).toMatchObject({ "X-Account-ID": "account-a" });
      expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin", redirect: "error", referrerPolicy: "no-referrer" });
    }
    expect(sync[1][1]?.headers).toMatchObject({ "X-CSRF-Token": "csrf-dummy" });
  });

  it("never dispatches an account A outbox with account B's session", async () => {
    const fetch = vi.fn(async (_url: string) => json(account("account-b")));
    vi.stubGlobal("fetch", fetch);
    const { createAccountClient } = await import("../../packages/accounts/client");
    await expect(createAccountClient("account-a").stageMigration({ migrationId: "m", app: "pokedex-binder", document: "binder", variant: "device", schemaVersion: 1, state: {}, baseRevision: 0 }))
      .rejects.toMatchObject({ code: "account_changed" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("auth.php");
  });

  it("retains conflict state for app-specific resolution without retrying a mutation", async () => {
    const remote = { resourceId: "r", revision: 4, state: { progress: "other-device" } };
    const fetch = vi.fn(async (url: string) => url.includes("auth.php") ? json(account()) : json({ error: { code: "revision_conflict", message: "Review both saves." }, remote }, 409));
    vi.stubGlobal("fetch", fetch);
    const { createAccountClient } = await import("../../packages/accounts/client");
    await expect(createAccountClient("account-a").writeDocument({ app: "idle-slayer-companion", document: "progress", state: {}, schemaVersion: 1, baseRevision: 3, clientId: "d", mutationSequence: 1, operationId: "o" }))
      .rejects.toMatchObject({ code: "revision_conflict", status: 409, remote });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps credentials out of migration URLs and only sends key proof to commit", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      calls.push([url, options]); return json(url.includes("auth.php") ? account() : { documents: [] });
    }));
    const { createAccountClient } = await import("../../packages/accounts/client");
    await createAccountClient("account-a").commitMigration({ migrationId: "m", app: "pokedex-binder", clientId: "d", documents: [{ document: "binder", baseRevision: 0 }], legacy: { revision: 3 } }, "dummy-private-key");
    expect(calls.every(([url]) => !url.includes("dummy-private-key"))).toBe(true);
    expect(calls.at(-1)?.[1]?.headers).toMatchObject({ "X-Pokedex-Key": "dummy-private-key" });
    expect(calls.at(-1)?.[1]?.body).not.toContain("dummy-private-key");
  });

  it("rejects an unexpected OAuth redirect", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("action=session") ? json(account()) : json({ url: "https://attacker.example/" })));
    const { startGoogle } = await import("../../packages/accounts/client");
    await expect(startGoogle()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("never uses arbitrary return URLs", async () => {
    const { safeReturnTo, accountHref } = await import("../../packages/accounts/client");
    for (const input of ["//example.test/", "https://example.test/", "/\\example.test/", "/utilities/pokedex-binder/?key=secret", "/account/"]) expect(safeReturnTo(input)).toBe("/utilities/");
    expect(safeReturnTo("/utilities/pokedex-binder/")).toBe("/utilities/pokedex-binder/");
    expect(safeReturnTo("/apps/future-app/")).toBe("/apps/future-app/");
    expect(accountHref("/utilities/idle-slayer-companion/")).toContain("returnTo=%2Futilities%2Fidle-slayer-companion%2F");
  });
});
