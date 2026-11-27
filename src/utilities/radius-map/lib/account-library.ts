import {
  ACCOUNT_SESSION_IDENTITY_KEY, APIError, createAccountClient, refreshSession, subscribeSession,
  type AccountSession, type DocumentWrite, type RemoteDocument,
} from "../../../../packages/accounts/client";
import { createAccountRepository } from "../../../../packages/accounts/repository";
import {
  mergeLibraries, readMeasurementsDocument, requireDocumentFits, sameLibrary, sameMeasurement,
  toMeasurementsDocument, toSavedMeasurements, RADIUS_ACCOUNT_APP as app, RADIUS_ACCOUNT_DOCUMENT as documentName,
  type MeasurementChoice, type MeasurementsDocument,
} from "./account-measurements";
import { saveMeasurement, type SavedMeasurement, type SavedMeasurementInput } from "./measurements";

type Remote = RemoteDocument<MeasurementsDocument>;
type Write = DocumentWrite<MeasurementsDocument>;
interface Library {
  clientId: string;
  baseline: Remote | null;
  working: MeasurementsDocument;
  pending: Write | null;
  conflictBase: MeasurementsDocument | null;
}
interface Journal {
  id: string;
  clientId: string;
  revision: number;
  resourceId: string;
  browser: MeasurementsDocument;
  selected: MeasurementsDocument;
}
export interface ConflictReview {
  baseline: Remote;
  working: MeasurementsDocument;
  base: MeasurementsDocument;
}
export interface RadiusAccountView {
  signedInId: string | null;
  accountId: string | null;
  library: MeasurementsDocument | null;
  canSignIn: boolean;
  canSync: boolean;
  inProgress: boolean;
  prepared: boolean;
  conflict: ConflictReview | null;
  status: string;
}

const database = "austingarrod.radius-map.accounts.v1";
const empty: MeasurementsDocument = { version: 1, measurements: [] };
const signedOutStatus = "Sign in to save and sync measurements.";
/** Statuses that mean nothing is waiting, so Sync now can step back. */
export const SETTLED_STATUSES: readonly string[] = ["Account library synced.", "Account library available offline."];
const reviewChanged = "The library changed during review. Open the latest review before applying your choices.";
const authErrors = ["login_required", "csrf_failed", "account_changed", "session_changed"];

function checkedRemote(value: Remote | null): Remote {
  if (!value || value.app !== app || value.document !== documentName || value.schemaVersion !== 1
    || typeof value.resourceId !== "string" || !value.resourceId
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.acknowledgedSequence) || value.acknowledgedSequence < 0) {
    throw new Error("The account library could not be verified. Your local measurements were kept.");
  }
  return { ...value, state: readMeasurementsDocument(value.state) };
}

function publishedIdentity(): string | null {
  try { return window.localStorage.getItem(ACCOUNT_SESSION_IDENTITY_KEY); }
  catch { return null; }
}

export function createRadiusAccountLibrary(render: (view: RadiusAccountView) => void) {
  const repository = createAccountRepository({ name: database });
  let session: AccountSession | null = null;
  let identity: string | null = null;
  let generation = 0;
  let active: Library | null = null;
  let journal: Journal | null = null;
  let busy = false;
  let status = signedOutStatus;
  let timer: ReturnType<typeof setTimeout>;
  let retryAt = 0;

  const verified = () => !!identity && session?.enabled === true && session.user?.id === identity;
  const online = () => verified() && navigator.onLine;
  const libraryKey = (id: string) => `library:${id}`;
  const journalKey = (id: string) => `journal:${id}`;

  function publish(): void {
    render({
      signedInId: identity,
      accountId: active ? identity : null,
      library: active?.working ?? null,
      canSignIn: !!navigator.locks && !identity && session?.enabled !== false && navigator.onLine,
      canSync: online(),
      inProgress: busy,
      prepared: !!journal,
      conflict: active?.conflictBase && active.baseline
        ? { base: active.conflictBase, baseline: active.baseline, working: active.working } : null,
      status,
    });
  }

  function assertIdentity(id: string, ticket: number, requireSession = false): void {
    if (identity !== id || generation !== ticket || (requireSession && !verified())) {
      throw new Error("The active account changed. Your measurements were kept.");
    }
  }

  function readRecord<T>(key: string): T | null {
    const value = repository.getItem(key);
    if (value === null) return null;
    const record: unknown = JSON.parse(value);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Saved account data needs recovery. The original record was kept.");
    }
    return record as T;
  }

  async function locked<T>(id: string, ticket: number, action: () => Promise<T> | T): Promise<T> {
    return navigator.locks.request(`${database}:storage:${id}`, async () => {
      assertIdentity(id, ticket);
      await repository.reload(libraryKey(id));
      await repository.reload(journalKey(id));
      assertIdentity(id, ticket);
      return action();
    });
  }

  function libraryStatus(): string {
    if (journal) return "A saved sync review is ready to finish.";
    if (!active) {
      if (session?.enabled === false) return "Account sync is temporarily unavailable.";
      if (!identity) return signedOutStatus;
      return online() ? "Opening your account library…" : "Go online to open your account library.";
    }
    if (active.conflictBase) return "Changes on another device need review.";
    if (active.pending || !sameLibrary(active.working, active.baseline?.state ?? empty)) return "Saved on this device. Waiting to sync.";
    return online() ? SETTLED_STATUSES[0] : SETTLED_STATUSES[1];
  }

  function readView(id: string): void {
    active = readRecord<Library>(libraryKey(id));
    journal = readRecord<Journal>(journalKey(id));
    status = libraryStatus();
    publish();
  }

  async function updateIdentity(id: string | null): Promise<void> {
    if (identity !== id) {
      identity = id;
      generation++;
      active = null;
      journal = null;
      busy = false;
      retryAt = 0;
    }
    status = libraryStatus();
    publish();
    if (!id) return;
    const ticket = generation;
    try {
      await locked(id, ticket, () => readView(id));
      if (online()) schedule();
    } catch {
      if (generation === ticket) {
        status = "Account storage could not be opened. Your original measurements were kept.";
        publish();
      }
    }
  }

  async function run<T>(action: (id: string, ticket: number) => Promise<T>): Promise<T | undefined> {
    const id = identity, ticket = generation;
    if (!id || !online() || busy) return;
    busy = true;
    publish();
    try {
      return await navigator.locks.request(`${database}:sync:${id}`, async () => {
        assertIdentity(id, ticket, true);
        return action(id, ticket);
      });
    } catch (error) {
      if (generation === ticket) {
        if (error instanceof APIError) {
          if (error.status === 429) retryAt = Date.now() + 1000 * (error.retryAfter ?? 60);
          if (authErrors.includes(error.code) || error.status === 401) {
            void refreshSession().catch(() => undefined);
          }
        }
        status = error instanceof Error ? error.message : "Sync could not finish. Your local measurements were kept.";
      }
      return undefined;
    } finally {
      if (generation === ticket) {
        busy = false;
        publish();
      }
    }
  }

  function integrate(library: Library, remote: Remote, acceptedWrite: Write | null): Library {
    const prior = library.baseline;
    if ((prior && (remote.resourceId !== prior.resourceId || remote.revision < prior.revision
      || (remote.revision === prior.revision && !sameLibrary(remote.state, prior.state))
      || remote.acknowledgedSequence < prior.acknowledgedSequence))
      || (acceptedWrite && remote.acknowledgedSequence < acceptedWrite.mutationSequence)) {
      throw new Error("An unexpected account revision was ignored. Your local measurements were kept.");
    }
    // A lost acknowledgement can be replayed after another device has advanced the document.
    const base = acceptedWrite?.state ?? library.conflictBase ?? prior?.state ?? empty;
    const merged = mergeLibraries(base, library.working, remote.state);
    return {
      ...library, baseline: remote, pending: null,
      working: merged.conflicts.length ? library.working : merged.document,
      conflictBase: merged.conflicts.length ? base : null,
    };
  }

  async function sync(): Promise<void> {
    if (Date.now() < retryAt) return;
    await run(async (id, ticket) => {
      const library = await locked(id, ticket, async () => {
        const next = readRecord<Library>(libraryKey(id));
        if (readRecord<Journal>(journalKey(id))) return undefined;
        if (!next) return null;
        if (!next.pending && !next.conflictBase && !sameLibrary(next.working, next.baseline?.state ?? empty)) {
          requireDocumentFits(next.working);
          next.pending = {
            app, document: documentName, schemaVersion: 1, state: next.working,
            clientId: next.clientId, baseRevision: next.baseline?.revision ?? 0,
            mutationSequence: (next.baseline?.acknowledgedSequence ?? 0) + 1, operationId: crypto.randomUUID(),
          };
          await repository.setItem(libraryKey(id), JSON.stringify(next));
        }
        return next;
      });
      if (library === undefined) return;
      assertIdentity(id, ticket, true);
      const client = createAccountClient(id);
      if (!library) {
        const clientId = crypto.randomUUID();
        const result = await client.getDocument<MeasurementsDocument>(app, documentName, clientId);
        const baseline = result === null ? null : checkedRemote(result);
        await locked(id, ticket, async () => {
          assertIdentity(id, ticket, true);
          await repository.setItem(libraryKey(id), JSON.stringify(newLibrary(clientId, baseline)));
          assertIdentity(id, ticket);
          readView(id);
        });
        return;
      }
      let remote: Remote;
      let accepted = library.pending;
      try {
        const result = library.pending
          ? await client.writeDocument(library.pending)
          : await client.getDocument<MeasurementsDocument>(app, documentName, library.clientId);
        if (result === null && !library.pending && !library.baseline) return;
        remote = checkedRemote(result);
      } catch (error) {
        if (!(error instanceof APIError) || error.code !== "revision_conflict" || !library.pending) throw error;
        remote = checkedRemote(error.remote as Remote | null);
        accepted = null;
      }
      await locked(id, ticket, async () => {
        assertIdentity(id, ticket, true);
        const current = readRecord<Library>(libraryKey(id));
        if (!current || current.pending?.operationId !== library.pending?.operationId) return;
        const next = integrate(current, remote, accepted);
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          await repository.setItem(libraryKey(id), JSON.stringify(next));
        }
        assertIdentity(id, ticket);
        readView(id);
        if (!next.conflictBase && !sameLibrary(next.working, remote.state)) schedule();
      });
    });
  }

  function schedule(): void {
    clearTimeout(timer);
    if (online()) timer = setTimeout(() => { void sync(); }, 300);
  }

  /**
   * Create, update or delete one measurement. `restore` brings a deleted
   * measurement back under its original id and creation time (undo).
   */
  async function change(
    input: SavedMeasurementInput | null,
    original?: SavedMeasurement,
    restore?: { id: string; createdAt: string },
  ): Promise<void> {
    const id = identity, ticket = generation;
    if (!id || !active) throw new Error("The active library changed. Open the measurement again.");
    await locked(id, ticket, async () => {
      const library = readRecord<Library>(libraryKey(id));
      if (!library || readRecord<Journal>(journalKey(id))) throw new Error("Finish the saved review before editing this account library.");
      const measurements = toSavedMeasurements(library.working);
      const existing = original && measurements.find(item => item.id === original.id);
      if (original && (!existing || !sameMeasurement(original, existing) || original.updatedAt !== existing.updatedAt)) {
        throw new Error("This measurement changed. Open it again to edit the latest version.");
      }
      if (!original && restore && measurements.some(item => item.id === restore.id)) {
        throw new Error("That measurement is already in your library.");
      }
      const remaining = measurements.filter(item => item.id !== original?.id);
      const measurementId = original?.id ?? restore?.id ?? crypto.randomUUID();
      if (input) remaining.push(saveMeasurement(input, measurementId, new Date().toISOString(), original?.createdAt ?? restore?.createdAt));
      library.working = toMeasurementsDocument(remaining);
      // Deletions must remain available if a merge combined two libraries over the limit.
      if (input) requireDocumentFits(library.working);
      assertIdentity(id, ticket);
      await repository.setItem(libraryKey(id), JSON.stringify(library));
      assertIdentity(id, ticket);
      readView(id);
      schedule();
    });
  }

  function newLibrary(clientId: string, baseline: Remote | null): Library {
    return { clientId, baseline, working: baseline?.state ?? empty, pending: null, conflictBase: null };
  }

  async function finishJournal(id: string, ticket: number, entry: Journal): Promise<boolean> {
    const client = createAccountClient(id);
    const stage = { migrationId: entry.id, app, document: documentName, schemaVersion: 1, baseRevision: entry.revision };
    try {
      for (const variant of ["device", "selected"] as const) {
        assertIdentity(id, ticket, true);
        await client.stageMigration({ ...stage, variant, state: variant === "device" ? entry.browser : entry.selected });
      }
      assertIdentity(id, ticket, true);
      const committed = await client.commitMigration({
        app, migrationId: entry.id, clientId: entry.clientId,
        documents: [{ document: documentName, baseRevision: entry.revision }],
        purpose: "conflict",
      });
      const receipt = checkedRemote(committed.documents[0] as Remote);
      assertIdentity(id, ticket, true);
      const remote = checkedRemote(await client.getDocument<MeasurementsDocument>(app, documentName, entry.clientId));
      if (remote.resourceId !== receipt.resourceId || remote.resourceId !== entry.resourceId
        || receipt.revision <= entry.revision || remote.revision < receipt.revision
        || (remote.revision === entry.revision + 1 && !sameLibrary(remote.state, entry.selected))) {
        throw new Error("The completed review could not be verified. Both original copies were kept.");
      }
      return await locked(id, ticket, async () => {
        assertIdentity(id, ticket, true);
        await repository.setItem(libraryKey(id), JSON.stringify(newLibrary(entry.clientId, remote)));
        await repository.removeItem(journalKey(id));
        assertIdentity(id, ticket);
        readView(id);
        return true;
      });
    } catch (error) {
      if (error instanceof APIError && error.code === "revision_conflict") {
        await locked(id, ticket, async () => {
          await repository.removeItem(journalKey(id));
          readView(id);
        });
        if (active) schedule();
        throw new Error(reviewChanged);
      }
      throw error;
    }
  }

  async function resolve(review: ConflictReview, choices: ReadonlyMap<string, MeasurementChoice>): Promise<boolean | undefined> {
    return run(async (id, ticket) => {
      const entry = await locked(id, ticket, async () => {
        const library = readRecord<Library>(libraryKey(id));
        if (readRecord<Journal>(journalKey(id)) || !library?.conflictBase || !library.baseline
          || library.baseline.resourceId !== review.baseline.resourceId
          || library.baseline.revision !== review.baseline.revision
          || !sameLibrary(review.working, library.working)) throw new Error(reviewChanged);
        if (!session?.migrationEnabled) throw new Error("Account conflict resolution is temporarily paused.");
        const merged = mergeLibraries(library.conflictBase, library.working, library.baseline.state, choices);
        if (merged.conflicts.length) throw new Error("Choose a version for every conflicting measurement.");
        requireDocumentFits(merged.document);
        const prepared: Journal = {
          id: crypto.randomUUID(), clientId: library.clientId,
          revision: library.baseline.revision, resourceId: library.baseline.resourceId,
          browser: library.working, selected: merged.document,
        };
        await repository.setItem(journalKey(id), JSON.stringify(prepared));
        assertIdentity(id, ticket);
        readView(id);
        return prepared;
      });
      return finishJournal(id, ticket, entry);
    });
  }

  function resume(): Promise<boolean | undefined> {
    return run(async (id, ticket) => {
      const entry = await locked(id, ticket, () => readRecord<Journal>(journalKey(id)));
      return entry ? finishJournal(id, ticket, entry) : undefined;
    });
  }

  function start(): void {
    publish();
    if (!navigator.locks) return;
    subscribeSession(next => {
      const wasOnline = online();
      session = next;
      const id = next.enabled ? next.user?.id ?? null : null;
      if (id !== identity || !wasOnline || !active) void updateIdentity(id);
    });
    window.addEventListener("storage", event => {
      if (event.key !== ACCOUNT_SESSION_IDENTITY_KEY && event.key !== null) return;
      if (event.newValue === identity) return;
      session = null;
      void updateIdentity(null);
      if (navigator.onLine) void refreshSession().catch(() => undefined);
    });
    repository.subscribe(() => {
      const id = identity, ticket = generation;
      if (id) void locked(id, ticket, () => readView(id)).catch(() => undefined);
    });
    const refresh = () => {
      void refreshSession().then(() => sync()).catch(() => publish());
    };
    window.addEventListener("online", refresh);
    window.addEventListener("offline", () => { status = libraryStatus(); publish(); });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh();
    });
    setInterval(() => {
      if (!identity || document.visibilityState !== "visible" || !navigator.onLine) return;
      if (verified()) void sync();
      else refresh();
    }, 30_000);
    if (!navigator.onLine) void updateIdentity(publishedIdentity());
    else void refreshSession().catch(() => { if (!session) void updateIdentity(publishedIdentity()); });
  }

  return { start, sync, change, resolve, resume };
}
