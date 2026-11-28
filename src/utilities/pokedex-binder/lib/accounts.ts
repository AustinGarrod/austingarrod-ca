import { adoptSets, emptyMaster, sameSave, validateMaster, type MasterState } from "./master";
import { MasterStore, documentName } from "./master-store";
import { createAccountClient, getSession, refreshSession, subscribeSession, type AccountSession } from "../../../../packages/accounts/client";
import { cloneState, hasNationalData, mergeStates, nationalEnabled, sameSettings, sameState, validateState, type BinderState, type CardStatus } from "./model";
import { BinderStore, STORAGE_NAME, type BinderStoreOptions, type StoredBinder } from "./store";
import { createBinderController, generateSyncKey, type BinderController, type BinderSnapshot, type RemoteBinder } from "./sync";
import { BinderRecovery } from "./recovery";

const APP = "pokedex-binder", DOCUMENT = "binder";
type AccountClient = ReturnType<typeof createAccountClient>;
type Remote = RemoteBinder & { resourceId: string; app: string; document: string };
export interface MigrationPreview {
  id: string; accountId: string; device: BinderState; legacy: BinderState | null; account: BinderState | null;
  sets?: {device: MasterState; account: MasterState; revision: number};
  layoutConflict: boolean; accountRevision: number; legacyRevision: number | null;
}
interface MigrationJournal {
  id: string; accountId: string; before: StoredBinder; rawBefore: unknown; device: BinderState;
  selected: BinderState; accountRevision: number; legacyRevision: number | null; legacyKey: string | null;
  sets?: {device: MasterState; selected: MasterState; revision: number};
  phase: "prepared" | "committed" | "complete" | "review";
}
interface RestoreJournal {
  id: string; scope: string; previous: BinderState; previousSets: MasterState; next: BinderState; nextSets: MasterState;
}
export interface BinderAccountState { boundAccountId: string | null; user: AccountSession["user"]; enabled: boolean; migrationEnabled: boolean; mode: "guest" | "account"; pendingMigration: boolean; offline: boolean; retainedAccount: { id: string; email: string } | null; storageNeedsRecovery: boolean }
export interface UnifiedBinderOptions extends BinderStoreOptions {
  autoSync?: boolean; fetch?: typeof fetch;
  accounts?: { getSession: typeof getSession; refreshSession?: typeof refreshSession; subscribeSession: typeof subscribeSession; client: (id: string) => AccountClient };
}
export function combineMigrationSources(preview: Pick<MigrationPreview, "device" | "legacy" | "account">, layout: "device" | "legacy" | "account", collection: "combine" | "device" | "account" = "combine"): BinderState {
  const selectedLayout = preview[layout];
  if (!selectedLayout) throw new Error("Choose an available binder layout.");
  const sources = collection === "combine" ? [preview.device, preview.legacy, preview.account] : [preview[collection]];
  if (!sources.some(Boolean)) throw new Error("Choose an available collection.");
  const owned = new Set(sources.flatMap(source => source?.ownedDexIds ?? []));
  const ordered = new Set(sources.flatMap(source => source?.orderedDexIds ?? []).filter(id => !owned.has(id)));
  const combined: BinderState = { schemaVersion: 1, settings: { ...selectedLayout.settings }, ownedDexIds: [...owned].sort((a, b) => a - b),
    ...(ordered.size ? { orderedDexIds: [...ordered].sort((a, b) => a - b) } : {}) };
  const enabled = sources.some(source => source !== null && nationalEnabled(source));
  if (sources.some(source => source?.enabled !== undefined) || nationalEnabled(combined) !== enabled) combined.enabled = enabled;
  return combined;
}

/** Guest data is only imported by an explicit migration. Account stores never share an outbox. */
export function createUnifiedBinderController(options: UnifiedBinderOptions) {
  const accounts = options.accounts ?? { getSession, refreshSession, subscribeSession, client: createAccountClient };
  const recovery = new BinderRecovery(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
  const masters = new MasterStore(recovery);
  const guestStore = new BinderStore(options);
  let session: AccountSession | null = null, stopped = false, migrationBusy = false, verifiedSession = false;
  let mode: "guest" | "account" = "guest", accountId: string | null = null;
  let retainedAccount: { id: string; email: string } | null = null, activeAccountEmail = "", retryingStorage = false;
  let activeStore = guestStore, accountController: BinderController | null = null;
  const guest = createBinderController({ ...options, store: guestStore, canSync: () => false, autoSync: false, optionalDex: true });
  let active = guest, unsubscribeActive: (() => void) | undefined, unsubscribeSession: (() => void) | undefined;
  const listeners = new Set<(value: BinderSnapshot) => void>(), accountListeners = new Set<(value: BinderAccountState) => void>();
  let pendingMigration = false;
  let currentPreview: MigrationPreview | null = null;
  let switching: Promise<void> = Promise.resolve();
  const currentUser = () => session?.user?.id ?? null;
  function requireAccount(id = currentUser()): string {
    if (!id || id !== currentUser() || stopped) throw new Error("Sign in again before syncing. Your binder stays on this device.");
    return id;
  }
  function accountState(): BinderAccountState { return { boundAccountId: accountId, user: session?.user ?? null, enabled: session?.enabled ?? false, migrationEnabled: session?.migrationEnabled ?? false, mode, pendingMigration, offline: mode === "account" && !verifiedSession, retainedAccount, storageNeedsRecovery: mode === "account" && !activeStore.persistent }; }
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
      const controller = createBinderController({ ...options, store, optionalDex: true, canSync: () => !stopped && verifiedSession && currentUser() === id && mode === "account" && accountId === id && !migrationBusy && !retryingStorage,
        transport: async (method, body, clientId) => {
          requireAccount(id);
          if (method === "GET") {
            const latest = await readRemote(bound, clientId);
            if (!latest) throw new Error("Your account binder is unavailable. Your saved collection has been kept.");
            return latest;
          }
          if (method !== "PATCH" || !body || typeof body !== "object") throw new Error("Manage account data and recovery from your account page.");
          const mutation = body as { baseRevision: number; mutationSequence: number; state: BinderState; operationId: string; preservePrevious?: true };
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
    if (guestStore.read().session) await guest.disconnect();
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
    if (key?.trim()) throw new Error("Private-key sync has retired.");
    const before = await guestStore.refresh();
    if (!guestStore.persistent) throw new Error("Export a backup before connecting an account on this device.");
    const deviceSets = (await masters.read("guest")).state;
    const accountSets = await accounts.client(id).getDocument<MasterState>(APP, documentName, before.clientId);
    const remote = await readRemote(accounts.client(id), activeStore.read().clientId);
    requireAccount(id);
    const states = [before.state, remote?.state].filter((value): value is BinderState => !!value);
    currentPreview = { id: crypto.randomUUID(), accountId: id, device: cloneState(before.state), legacy: null, account: remote?.state ?? null,
      accountRevision: remote?.revision ?? 0, legacyRevision: null, sets: {device: deviceSets, account: accountSets ? validateMaster(accountSets.state) : emptyMaster(), revision: accountSets?.revision ?? 0}, layoutConflict: states.some(state => !sameSettings(state.settings, states[0].settings)) };
    return structuredClone(currentPreview);
  }
  async function accountHasBinders(): Promise<boolean> {
    const id = requireAccount(), client = accounts.client(id), clientId = guestStore.read().clientId;
    const [national, sets] = await Promise.all([
      readRemote(client, clientId), client.getDocument<MasterState>(APP, documentName, clientId),
    ]);
    requireAccount(id);
    return !!(national && (nationalEnabled(national.state) || hasNationalData(national.state))) || !!(sets && validateMaster(sets.state).binders.length);
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
        const documents = [{ document: DOCUMENT, baseRevision: journal.accountRevision }];
        if (journal.sets) {
          for (const variant of ["device","selected"] as const) {
            await client.stageMigration({migrationId:journal.id, app:APP, document:documentName, variant, schemaVersion:1, state:journal.sets[variant], baseRevision:journal.sets.revision});
            requireAccount(id);
          }
          documents.push({document:documentName,baseRevision:journal.sets.revision});
        }
        if (journal.legacyKey) {
          journal.phase = "review";
          await recovery.put(`backup:${journal.id}`,journal);
          await recovery.put(`migration:${id}`,journal);
          pendingMigration=false;
          throw new Error("Private-key sync has retired. Review your device and account copies again.");
        }
        await client.commitMigration({migrationId:journal.id, app:APP, clientId:journal.before.clientId, documents});
        journal.phase = "committed"; await recovery.put(`migration:${id}`, journal);
      }
      requireAccount(id);
      // The committed response may have been lost; always verify the durable account copy.
      const remote = await readRemote(client, guestStore.read().clientId);
      requireAccount(id);
      if (!remote) throw new Error("Migration was saved but its account copy could not be verified. Retry to finish; your device copy is unchanged.");
      if (journal.sets) {
        const local = await masters.read(id);
        const saved = await client.getDocument<MasterState>(APP, documentName, local.clientId);
        requireAccount(id);
        if (!saved || saved.app !== APP || saved.document !== documentName || saved.revision <= journal.sets.revision) throw new Error("Set binder adoption needs account readback.");
        const confirmed = validateMaster(saved.state);
        if (saved.revision === journal.sets.revision+1 && !sameSave(confirmed,journal.sets.selected)) throw new Error("The saved set binders differ from the reviewed collection.");
        await masters.adopt(id,saved,local.clientId,journal.sets.device);
      }
      await recovery.put(`backup:${journal.id}`, journal);
      await openAccount(id, remote, journal.device);
      await recovery.put(`binding:${id}`, { resourceId: remote.resourceId });
      journal.phase = "complete"; await recovery.put(`migration:${id}`, journal);
      pendingMigration = false; currentPreview = null;
    } catch (error) {
      if (journal.phase === "prepared" && error && typeof error === "object" && "code" in error
        && ["revision_conflict", "legacy_revision_conflict", "legacy_key_revoked", "key_sync_retired", "migration_stage_reused", "migration_preview_changed"].includes(String(error.code))) {
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
    if (preview.sets && !sameSave((await masters.read("guest")).state,preview.sets.device)) throw new Error("Set binders changed. Review the copies again.");
    const before = guestStore.read();
    const journal: MigrationJournal = { id: preview.id, accountId: id, before, rawBefore: await guestStore.rawDocument(), device: cloneState(preview.device),
      selected: validateState(selected, options.species), accountRevision: preview.accountRevision, legacyRevision: preview.legacyRevision, legacyKey: null, sets: preview.sets ? {device:preview.sets.device,selected:adoptSets(preview.sets.device,preview.sets.account),revision:preview.sets.revision} : undefined, phase: "prepared" };
    await recovery.put(`migration:${id}`, journal);
    await finishJournal(journal);
  }
  async function resumeMigration(): Promise<void> {
    const id = requireAccount(), journal = await recovery.get<MigrationJournal>(`migration:${id}`);
    if (!journal || !["prepared", "committed"].includes(journal.phase)) throw new Error("No unfinished migration was found on this device.");
    await finishJournal(journal);
  }
  const restoreScope = () => mode === "account" ? accountId! : "guest";
  async function applyRestore(journal: RestoreJournal): Promise<void> {
    const target = active, scope = journal.scope;
    const checkScope = () => {
      if (scope !== restoreScope() || target !== active || retainedAccount || stopped) throw new Error("Reopen the original binder to finish restoring this backup.");
    };
    checkScope();
    const original = target.snapshot().state;
    if (!sameState(original,journal.previous) && !sameState(original,journal.next)) throw new Error("Your National Dex changed after this restore began. Export the current copy and review the backup again.");
    await masters.update(scope, save => {
      checkScope();
      if (!sameSave(save.state,journal.previousSets) && !sameSave(save.state,journal.nextSets)) throw new Error("Your set binders changed after this restore began. Export the current copy and review the backup again.");
      if (scope !== "guest" && !sameSave(save.state, journal.nextSets)) save.preservePrevious = true;
      save.state=journal.nextSets;
    });
    checkScope();
    if (!sameState(original,journal.next)) await target.replaceState(journal.next);
    checkScope();
    if (!activeStore.persistent || !sameState(target.snapshot().state,journal.next)) throw new Error("Restore is saved for retry. Reopen Sync & backup to finish.");
    await recovery.put("restore-backup:"+journal.id,journal);
    await recovery.put("last-restore:"+scope,journal.id);
    await recovery.put("restore:"+scope,null);
  }
  async function restoreCollections(next: BinderState, nextSets: MasterState, scope: string): Promise<void> {
    if (scope !== restoreScope() || retainedAccount) throw new Error("The active account changed. Review the backup again.");
    const previous=cloneState(active.snapshot().state);
    const previousSets=(await masters.read(scope)).state;
    const journal: RestoreJournal={id:crypto.randomUUID(),scope,previous,previousSets,next:validateState(next,options.species),nextSets:validateMaster(nextSets)};
    const pending=await recovery.get<RestoreJournal>("restore:"+scope);
    if(pending) await recovery.put("restore-backup:"+pending.id,pending);
    await recovery.put("restore:"+scope,journal);
    await applyRestore(journal);
  }
  async function previousRestore() {
    const scope=restoreScope();
    const pending=await recovery.get<RestoreJournal>("restore:"+scope);
    const last=await recovery.get<string>("last-restore:"+scope);
    const saved=pending ?? (last ? await recovery.get<RestoreJournal>("restore-backup:"+last) : null);
    if (!saved || saved.scope!==restoreScope()) return null;
    return {utility:APP,schemaVersion:2,state:saved.previous,masterSets:saved.previousSets};
  }
  async function pendingRestore() { return !!await recovery.get<RestoreJournal>("restore:"+restoreScope()); }
  async function resumeRestore() {
    const journal=await recovery.get<RestoreJournal>("restore:"+restoreScope());
    if(journal) await applyRestore(journal);
  }
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
    masters, restoreScope, restoreCollections, previousRestore, pendingRestore, resumeRestore, start, snapshot, accountState, accountHasBinders, previewMigration, migrate, resumeMigration, recheckConnection,
    subscribe(listener: (value: BinderSnapshot) => void) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    subscribeAccount(listener: (value: BinderAccountState) => void) { accountListeners.add(listener); listener(accountState()); return () => accountListeners.delete(listener); },
    setOwned: (id: number, owned: boolean) => editable().setOwned(id, owned), setSettings: (settings: BinderState["settings"]) => editable().setSettings(settings), replaceState: (state: BinderState) => editable().replaceState(state),
    setStatus: (id: number, status: CardStatus) => editable().setStatus(id, status),
    setEnabled: (enabled: boolean) => editable().setEnabled(enabled),
    importSpecies(ids: readonly number[], expected: BinderState, isCurrent: () => boolean) {
      const target = editable();
      return target.importSpecies(ids, state => {
        if (target !== active || retainedAccount || stopped || migrationBusy || !isCurrent() || !sameState(state, expected)) {
          throw new Error("The collection changed. Review the import again.");
        }
      });
    },
    resolveLayout: (choice: "local" | "remote") => active.resolveLayout(choice), sync: async () => { await switching; return active.sync(); },
    async syncedBinderRevision(id: string): Promise<number> {
      await switching;
      requireAccount(id);
      if (mode !== "account" || id !== accountId || !verifiedSession || retainedAccount || pendingMigration) return 0;
      const store = activeStore;
      await active.sync();
      requireAccount(id);
      const saved = store.read();
      return store === activeStore && verifiedSession && snapshot().status === "synced"
        ? (saved.session?.revision ?? 0) : 0;
    },
    async recoveryBackups(): Promise<string> {
      // Portable recovery intentionally omits private keys and authentication metadata.
      const id = requireAccount();
      const records = await recovery.all();
      requireAccount(id);
      return JSON.stringify({ utility: APP, recoveryVersion: 1, backups: records.filter(row => (row.key.startsWith("backup:") || row.key.startsWith("migration:")) && (row.value as MigrationJournal).accountId === id).map(row => {
        const value = row.value as MigrationJournal;
        return { migrationId: value.id, device: value.device, selected: value.selected, sets:value.sets, phase: value.phase };
      }) }, null, 2);
    },
    stop() { stopped = true; unsubscribeSession?.(); unsubscribeActive?.(); accountController?.stop(); guest.stop(); recovery.close(); listeners.clear(); accountListeners.clear(); }
  };
}
