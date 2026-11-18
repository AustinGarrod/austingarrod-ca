import { createAccountClient, getSession, refreshSession, subscribeSession, type AccountSession } from "../../../../packages/accounts/client";
import { cloneState, mergeStates, sameSettings, sameState, validateState, type BinderState } from "./model";
import { BinderStore, STORAGE_NAME, type BinderStoreOptions, type StoredBinder } from "./store";
import { createBinderController, generateSyncKey, type BinderController, type BinderSnapshot, type RemoteBinder } from "./sync";
import { BinderRecovery } from "./recovery";

const APP = "pokedex-binder", DOCUMENT = "binder";
type AccountClient = ReturnType<typeof createAccountClient>;
type Remote = RemoteBinder & { resourceId: string; app: string; document: string };
export interface MigrationPreview {
  id: string; accountId: string; device: BinderState; legacy: BinderState | null; account: BinderState | null;
  layoutConflict: boolean; accountRevision: number; legacyRevision: number | null;
}
interface MigrationJournal {
  id: string; accountId: string; before: StoredBinder; rawBefore: unknown; device: BinderState;
  selected: BinderState; accountRevision: number; legacyRevision: number | null; legacyKey: string | null;
  phase: "prepared" | "committed" | "complete" | "review";
}
export interface BinderAccountState { user: AccountSession["user"]; enabled: boolean; migrationEnabled: boolean; mode: "guest" | "account"; pendingMigration: boolean; offline: boolean; retainedAccount: { id: string; email: string } | null; storageNeedsRecovery: boolean }
export interface UnifiedBinderOptions extends BinderStoreOptions {
  autoSync?: boolean; fetch?: typeof fetch;
  accounts?: { getSession: typeof getSession; refreshSession?: typeof refreshSession; subscribeSession: typeof subscribeSession; client: (id: string) => AccountClient };
}
export function combineMigrationSources(preview: Pick<MigrationPreview, "device" | "legacy" | "account">, layout: "device" | "legacy" | "account", collection: "combine" | "device" | "account" = "combine"): BinderState {
  const selectedLayout = preview[layout];
  if (!selectedLayout) throw new Error("Choose an available binder layout.");
  const sources = collection === "combine" ? [preview.device, preview.legacy, preview.account] : [preview[collection]];
  if (!sources.some(Boolean)) throw new Error("Choose an available collection.");
  return { schemaVersion: 1, settings: { ...selectedLayout.settings }, ownedDexIds: [...new Set(sources.flatMap(source => source?.ownedDexIds ?? []))].sort((a, b) => a - b) };
}

/** Guest data is only imported by an explicit migration. Account stores never share an outbox. */
export function createUnifiedBinderController(options: UnifiedBinderOptions) {
  const accounts = options.accounts ?? { getSession, refreshSession, subscribeSession, client: createAccountClient };
  const recovery = new BinderRecovery(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
  const guestStore = new BinderStore(options);
  let session: AccountSession | null = null, stopped = false, migrationBusy = false, guestRetired = false, verifiedSession = false;
  let mode: "guest" | "account" = "guest", accountId: string | null = null;
  let retainedAccount: { id: string; email: string } | null = null, activeAccountEmail = "", retryingStorage = false;
  let activeStore = guestStore, accountController: BinderController | null = null;
  const guest = createBinderController({ ...options, store: guestStore, canSync: () => !stopped && mode === "guest" && !migrationBusy && !guestRetired });
  let active = guest, unsubscribeActive: (() => void) | undefined, unsubscribeSession: (() => void) | undefined;
  const listeners = new Set<(value: BinderSnapshot) => void>(), accountListeners = new Set<(value: BinderAccountState) => void>();
  let pendingMigration = false;
  let previewKey: string | null = null, currentPreview: MigrationPreview | null = null;
  let switching: Promise<void> = Promise.resolve();
  const currentUser = () => session?.user?.id ?? null;
  function requireAccount(id = currentUser()): string {
    if (!id || id !== currentUser() || stopped) throw new Error("Sign in again before syncing. Your binder stays on this device.");
    return id;
  }
  function accountState(): BinderAccountState { return { user: session?.user ?? null, enabled: session?.enabled ?? false, migrationEnabled: session?.migrationEnabled ?? false, mode, pendingMigration, offline: mode === "account" && !verifiedSession, retainedAccount, storageNeedsRecovery: mode === "account" && !activeStore.persistent }; }
  function snapshot(): BinderSnapshot {
    const value = active.snapshot();
    return mode === "account" ? { ...value, key: null, connected: true, status: !verifiedSession && value.status === "synced" ? "pending" : value.status } : value;
  }
  function emit(): void { const value = snapshot(); listeners.forEach(listener => listener(value)); accountListeners.forEach(listener => listener(accountState())); }
  function attach(controller: BinderController): void { unsubscribeActive?.(); active = controller; unsubscribeActive = active.subscribe(() => emit()); emit(); }
  function validateRemote(remote: Remote | null): Remote | null {
    if (!remote) return null;
    if (remote.app !== APP || remote.document !== DOCUMENT || !Number.isSafeInteger(remote.revision) || remote.revision < 1) throw new Error("The account returned an unsupported binder. Your local copy is safe.");
    return { ...remote, state: validateState(remote.state, options.species) };
  }
  async function readRemote(client: AccountClient, clientId: string): Promise<Remote | null> {
    try { return validateRemote(await client.getDocument<BinderState>(APP, DOCUMENT, clientId) as Remote | null); }
    catch (error) { if (error && typeof error === "object" && "status" in error && error.status === 404) return null; throw error; }
  }
  async function openAccount(id: string, remote?: Remote, localBase?: BinderState): Promise<void> {
    requireAccount(id);
    const store = new BinderStore({ ...options, name: `${STORAGE_NAME}.account.${id}` });
    await store.open();
    try {
      requireAccount(id);
      if (!store.persistent) throw new Error("This browser cannot safely save an account binder. Export your collection before continuing.");
      if (remote) {
        // Acknowledgments belong to this account store's client, never the guest identity.
        remote = (await readRemote(accounts.client(id), store.read().clientId)) ?? undefined;
        requireAccount(id);
      }
      if (!store.read().session) {
        if (!remote) remote = (await readRemote(accounts.client(id), store.read().clientId)) ?? undefined;
        requireAccount(id);
        if (!remote) throw new Error("This account has no binder yet. Review and connect your device's binder first.");
        await store.update(doc => {
          const current = localBase ? mergeStates(localBase, guestStore.read().state, remote!.state) : { state: cloneState(remote!.state), layoutConflict: false };
          doc.state = current.state;
          doc.layoutConflict = current.layoutConflict ? { local: { ...current.state.settings }, remote: { ...remote!.state.settings } } : null;
          doc.session = { key: generateSyncKey(), revision: remote!.revision, baseline: cloneState(remote!.state), nextSequence: remote!.acknowledgedSequence + 1, inFlight: null, creating: false };
          return doc;
        });
      } else if (localBase && remote) {
        // A completed migration can be resumed without overwriting a pre-existing account outbox.
        const prior = store.read();
        if (prior.session!.inFlight || !sameState(prior.state, prior.session!.baseline)) throw new Error("This device has pending account changes. Sync those changes before finishing migration; both copies are preserved.");
        await store.update(doc => {
          const merged = mergeStates(localBase, guestStore.read().state, remote!.state);
          doc.state = merged.state; doc.layoutConflict = merged.layoutConflict ? { local: { ...merged.state.settings }, remote: { ...remote!.state.settings } } : null;
          doc.session!.baseline = cloneState(remote!.state); doc.session!.revision = remote!.revision;
          doc.session!.nextSequence = remote!.acknowledgedSequence + 1; return doc;
        });
      }
      if (!store.persistent) throw new Error("The account copy was saved, but this browser could not save its connection. Retry migration; your original copy remains available.");
      requireAccount(id);
      const bound = accounts.client(id);
      const controller = createBinderController({ ...options, store, canSync: () => !stopped && verifiedSession && currentUser() === id && mode === "account" && accountId === id && !migrationBusy && !retryingStorage,
        transport: async (method, body, clientId) => {
          requireAccount(id);
          if (method === "GET") {
            const latest = await readRemote(bound, clientId);
            if (!latest) throw new Error("Your account binder is unavailable. Your saved collection has been kept.");
            return latest;
          }
          if (method !== "PATCH" || !body || typeof body !== "object") throw new Error("Manage account data and recovery from your account page.");
          const mutation = body as { baseRevision: number; mutationSequence: number; state: BinderState; operationId: string };
          return await bound.writeDocument<BinderState>({ app: APP, document: DOCUMENT, schemaVersion: 1, clientId, ...mutation }) as Remote;
        } });
      accountController?.stop(); accountController = controller;
      accountId = id; activeAccountEmail = session!.user!.email; retainedAccount = null; mode = "account"; activeStore = store; attach(controller);
      await controller.start();
      if (verifiedSession) await recovery.put("last-account", { id, email: session!.user!.email });
    } catch (error) { store.close(); throw error; }
  }
  async function onSession(next: AccountSession): Promise<void> {
    if (session !== next) return;
    if (accountId && currentUser() !== accountId) {
      if (!activeStore.persistent) {
        // Quota failures keep the latest document only in memory. Pin its exportable view.
        retainedAccount = { id: accountId, email: activeAccountEmail }; emit(); return;
      }
      accountController?.stop(); accountController = null; accountId = null; mode = "guest"; activeStore = guestStore; attach(guest);
    }
    retainedAccount = null;
    emit();
    const id = currentUser();
    if (!id) { try { await recovery.put("last-account", null); } catch { /* Local saves are still available. */ } return; }
    if (mode === "account" || stopped) return;
    try {
      const journal = await recovery.get<MigrationJournal>(`migration:${id}`);
      if (id !== currentUser()) return;
      pendingMigration = !!journal && ["prepared", "committed"].includes(journal.phase);
      const binding = await recovery.get<{ resourceId: string }>(`binding:${id}`);
      if (binding && !pendingMigration) await openAccount(id);
    } catch { /* Guest use and export remain available when account storage is unavailable. */ }
    emit();
  }
  async function start(): Promise<void> {
    attach(guest); await guest.start();
    unsubscribeSession = accounts.subscribeSession(next => {
      session = next; verifiedSession = true; // Fence an in-flight transport immediately, before awaiting storage.
      switching = switching.then(() => onSession(next)).catch(() => undefined);
    });
    try {
      const initial = await accounts.getSession();
      session = initial; verifiedSession = true; switching = switching.then(() => onSession(initial)); await switching;
    } catch {
      // A known account's durable store remains usable offline. Its identity never authorizes a request.
      try {
        const last = await recovery.get<{ id: string; email: string } | null>("last-account");
        if (last && await recovery.get(`binding:${last.id}`)) {
          session = { enabled: true, migrationEnabled: false, user: last, csrfToken: "" }; verifiedSession = false;
          await openAccount(last.id);
        }
      } catch { /* Guest use and export remain available. */ }
      emit();
    }
  }
  async function previewMigration(key?: string): Promise<MigrationPreview> {
    const id = requireAccount();
    if (!session?.migrationEnabled) throw new Error("Account migration is not available yet. Your current binder is unchanged.");
    if (await recovery.get<MigrationJournal>(`migration:${id}`).then(value => value && ["prepared", "committed"].includes(value.phase))) throw new Error("Finish the saved migration first. Its original device and account copies are preserved.");
    if (mode === "account") {
      await active.sync();
      const doc = activeStore.read();
      if (doc.layoutConflict || doc.session?.inFlight || doc.session && !sameState(doc.state, doc.session.baseline)) throw new Error("Finish syncing this account binder before reviewing another device.");
    }
    // Settle a frozen legacy request before using its source revision, including lost acknowledgments.
    await guest.sync();
    requireAccount(id);
    const before = await guestStore.refresh();
    if (!guestStore.persistent) throw new Error("Browser storage needs attention. Export a backup before migrating.");
    if (before.layoutConflict) throw new Error("Choose the legacy binder layout before connecting your account.");
    previewKey = key?.trim() || (guest.snapshot().connected ? before.session?.key ?? null : null);
    if (before.session && guest.snapshot().connected && (before.session.creating || before.session.inFlight || !sameState(before.state, before.session.baseline))) throw new Error("The existing key has unsynced changes. Reconnect and sync it before migrating.");
    let legacy: RemoteBinder | null = null;
    if (previewKey) legacy = await guest.checkKey(previewKey);
    const remote = await readRemote(accounts.client(id), activeStore.read().clientId);
    requireAccount(id);
    const states = [before.state, legacy?.state, remote?.state].filter((value): value is BinderState => !!value);
    currentPreview = { id: crypto.randomUUID(), accountId: id, device: cloneState(before.state), legacy: legacy?.state ?? null, account: remote?.state ?? null,
      accountRevision: remote?.revision ?? 0, legacyRevision: legacy?.revision ?? null, layoutConflict: states.some(state => !sameSettings(state.settings, states[0].settings)) };
    return structuredClone(currentPreview);
  }
  async function finishJournal(journal: MigrationJournal): Promise<void> {
    const id = requireAccount(journal.accountId), client = accounts.client(id);
    migrationBusy = true; pendingMigration = true; emit();
    try {
      if (journal.phase === "prepared") {
        await client.stageMigration({ migrationId: journal.id, app: APP, document: DOCUMENT, variant: "device", schemaVersion: 1, state: journal.device, baseRevision: journal.accountRevision });
        requireAccount(id);
        await client.stageMigration({ migrationId: journal.id, app: APP, document: DOCUMENT, variant: "selected", schemaVersion: 1, state: journal.selected, baseRevision: journal.accountRevision });
        requireAccount(id);
        await client.commitMigration({ migrationId: journal.id, app: APP, clientId: journal.before.clientId,
          documents: [{ document: DOCUMENT, baseRevision: journal.accountRevision }], ...(journal.legacyRevision === null ? {} : { legacy: { revision: journal.legacyRevision } }) }, journal.legacyKey ?? undefined);
        journal.phase = "committed"; await recovery.put(`migration:${id}`, journal);
      }
      requireAccount(id);
      // The committed response may have been lost; always verify the durable account copy.
      const remote = await readRemote(client, guestStore.read().clientId);
      requireAccount(id);
      if (!remote) throw new Error("Migration was saved but its account copy could not be verified. Retry to finish; your device copy is unchanged.");
      if (journal.legacyKey) guestRetired = true;
      await recovery.put(`backup:${journal.id}`, journal);
      await openAccount(id, remote, journal.device);
      await recovery.put(`binding:${id}`, { resourceId: remote.resourceId });
      journal.phase = "complete"; await recovery.put(`migration:${id}`, journal);
      pendingMigration = false; currentPreview = null;
    } catch (error) {
      if (journal.phase === "prepared" && error && typeof error === "object" && "code" in error
        && ["revision_conflict", "legacy_revision_conflict", "legacy_key_revoked", "migration_stage_reused", "migration_preview_changed"].includes(String(error.code))) {
        // These transactional rejections did not commit. Preserve the failed preview and allow a fresh review.
        journal.phase = "review"; await recovery.put(`backup:${journal.id}`, journal); await recovery.put(`migration:${id}`, journal);
        pendingMigration = false; currentPreview = null;
      }
      throw error;
    } finally { migrationBusy = false; emit(); }
    await active.sync();
  }
  async function migrate(preview: MigrationPreview, selected: BinderState): Promise<void> {
    const id = requireAccount(preview.accountId);
    if (currentPreview?.id !== preview.id) throw new Error("Review the device and account copies again before connecting.");
    await guestStore.refresh();
    if (!sameState(guestStore.read().state, preview.device)) throw new Error("The device binder changed while you reviewed it. Review again; no data was replaced.");
    const before = guestStore.read();
    const journal: MigrationJournal = { id: preview.id, accountId: id, before, rawBefore: await guestStore.rawDocument(), device: cloneState(preview.device),
      selected: validateState(selected, options.species), accountRevision: preview.accountRevision, legacyRevision: preview.legacyRevision, legacyKey: previewKey, phase: "prepared" };
    await recovery.put(`migration:${id}`, journal);
    await finishJournal(journal);
  }
  async function resumeMigration(): Promise<void> {
    const id = requireAccount(), journal = await recovery.get<MigrationJournal>(`migration:${id}`);
    if (!journal || !["prepared", "committed"].includes(journal.phase)) throw new Error("No unfinished migration was found on this device.");
    await finishJournal(journal);
  }
  function requireGuest(): void { if (mode !== "guest") throw new Error("This binder syncs through your account. Manage account recovery from your account page."); }
  function editable(): BinderController {
    if (retryingStorage) throw new Error("The open binder is being saved. Retry this edit when saving finishes.");
    return active;
  }
  async function recheckConnection(): Promise<void> {
    if (retryingStorage) return;
    retryingStorage = true;
    try {
      if (mode === "account" && !activeStore.persistent && !await activeStore.retryPersistence()) return;
      const latest = await (accounts.refreshSession?.() ?? accounts.getSession());
      session = latest; verifiedSession = true; await onSession(latest);
    } finally { retryingStorage = false; emit(); }
  }
  return {
    start, snapshot, accountState, previewMigration, migrate, resumeMigration, recheckConnection,
    subscribe(listener: (value: BinderSnapshot) => void) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    subscribeAccount(listener: (value: BinderAccountState) => void) { accountListeners.add(listener); listener(accountState()); return () => accountListeners.delete(listener); },
    setOwned: (id: number, owned: boolean) => editable().setOwned(id, owned), setSettings: (settings: BinderState["settings"]) => editable().setSettings(settings), replaceState: (state: BinderState) => editable().replaceState(state),
    resolveLayout: (choice: "local" | "remote") => active.resolveLayout(choice), sync: () => active.sync(),
    createSync() { requireGuest(); return guest.createSync(); }, checkKey: (key: string) => guest.checkKey(key),
    connect(key: string) { requireGuest(); return guest.connect(key); }, disconnect() { requireGuest(); return guest.disconnect(); }, deleteCloud() { requireGuest(); return guest.deleteCloud(); },
    async recoveryBackups(): Promise<string> {
      // Portable recovery intentionally omits private keys and authentication metadata.
      const id = requireAccount();
      const records = await recovery.all();
      requireAccount(id);
      return JSON.stringify({ utility: APP, recoveryVersion: 1, backups: records.filter(row => (row.key.startsWith("backup:") || row.key.startsWith("migration:")) && (row.value as MigrationJournal).accountId === id).map(row => {
        const value = row.value as MigrationJournal;
        return { migrationId: value.id, device: value.device, selected: value.selected, phase: value.phase };
      }) }, null, 2);
    },
    stop() { stopped = true; unsubscribeSession?.(); unsubscribeActive?.(); accountController?.stop(); guest.stop(); recovery.close(); listeners.clear(); accountListeners.clear(); }
  };
}
