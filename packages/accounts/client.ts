/** Same-origin account client shared by Astro and the independently built companion. */
export interface AccountUser { id: string; email: string }
export interface BinderStockAlert { store: string; minimum: number; lastCheckedAt: string | null }
export interface BinderStockAlerts { alerts: BinderStockAlert[]; revision: string; hasSyncedBinders: boolean }
export const binderStockAlertsPath = "/utilities/pokemon-binder/?view=buy-cards&alerts=1";
export interface AccountSession {
  enabled: boolean;
  migrationEnabled: boolean;
  user: AccountUser | null;
  csrfToken: string;
  pendingGoogleEmail?: string;
  /** A retired cookie needs an explicit login action before it can be replaced. */
  requiresBootstrap?: boolean;
}
export interface RemoteDocument<T = unknown> {
  resourceId: string;
  app: string;
  document: string;
  schemaVersion: number;
  revision: number;
  state: T;
  acknowledgedSequence: number;
}
export interface DocumentWrite<T = unknown> {
  app: string; document: string; schemaVersion: number; state: T;
  baseRevision: number; clientId: string; mutationSequence: number; operationId: string;
  preservePrevious?: true;
}
export interface MigrationStage<T = unknown> {
  migrationId: string; app: string; document: string; variant: "selected" | "device";
  schemaVersion: number; state: T; baseRevision: number;
}
export interface MigrationCommit {
  migrationId: string; app: string; clientId: string;
  documents: Array<{ document: string; baseRevision: number }>;
  legacy?: { revision: number };
  purpose?: "conflict";
}
export interface RecoverySnapshot {
  id: string; app: string; document: string; label: string; revision: number; createdAt: string;
}
export interface RecoveryDocument<T = unknown> extends RecoverySnapshot { state: T; schemaVersion: number }

export class APIError extends Error {
  readonly code: string;
  readonly status: number;
  readonly remote?: RemoteDocument | null;
  readonly retryAfter?: number;
  constructor(message: string, code: string, status: number, extra: { remote?: RemoteDocument | null; retryAfter?: number } = {}) {
    super(message); this.name = "AccountAPIError";
    this.code = code; this.status = status; this.remote = extra.remote; this.retryAfter = extra.retryAfter;
  }
}
export { APIError as AccountApiError };

/** An offline UI hint only. The API still requires a verified live session. */
export const ACCOUNT_SESSION_IDENTITY_KEY = "austingarrod.accounts.last-session.v1";

let session: AccountSession | null = null;
let pendingSession: Promise<AccountSession> | null = null;
let sessionGeneration = 0;
let channel: BroadcastChannel | null = null;
let listening = false;
const listeners = new Set<(value: AccountSession) => void>();
let authQueue: Promise<void> = Promise.resolve();

function serializeAuth<T>(operation: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      // Shared by both application bundles and every tab on this origin.
      return navigator.locks.request("austingarrod.accounts.authentication.v1", operation);
    }
    if (typeof window !== "undefined") {
      throw new APIError("This browser cannot safely coordinate account sign-in. You can still use local saves and backups.", "browser_unsupported", 0);
    }
    return operation();
  };
  const result = authQueue.then(run, run);
  authQueue = result.then(() => undefined, () => undefined);
  return result;
}

function publish(value: AccountSession, announce = false): AccountSession {
  session = value;
  if (typeof window !== "undefined") {
    try {
      if (value.enabled && value.user) window.localStorage.setItem(ACCOUNT_SESSION_IDENTITY_KEY, value.user.id);
      else window.localStorage.removeItem(ACCOUNT_SESSION_IDENTITY_KEY);
    } catch { /* Session discovery still works when browser storage is blocked. */ }
  }
  for (const listener of listeners) { try { listener(value); } catch { /* A view cannot interrupt authentication. */ } }
  if (announce) channel?.postMessage("session-changed");
  return value;
}
function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("austingarrod.accounts.session.v1");
    channel.onmessage = () => { void refreshSession().catch(() => undefined); };
  }
  window.addEventListener("focus", () => { void refreshSession().catch(() => undefined); });
  window.addEventListener("pageshow", event => { if (event.persisted) void refreshSession().catch(() => undefined); });
}
function validSession(value: unknown): value is AccountSession {
  if (!value || typeof value !== "object") return false;
  const item = value as AccountSession;
  return typeof item.enabled === "boolean" && typeof item.migrationEnabled === "boolean"
    && typeof item.csrfToken === "string" && (item.requiresBootstrap === undefined || typeof item.requiresBootstrap === "boolean")
    && (!item.requiresBootstrap || (item.user === null && item.csrfToken === "")) && (item.user === null
      || (typeof item.user?.id === "string" && typeof item.user?.email === "string"));
}

async function request<T>(file: "auth" | "sync", action: string, options: {
  body?: unknown; query?: Record<string, string>; accountId?: string; legacyKey?: string;
} = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.accountId) headers["X-Account-ID"] = options.accountId;
  if (options.legacyKey) headers["X-Pokedex-Key"] = options.legacyKey;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    // Bootstrap is an explicit same-origin login action with no live CSRF
    // session yet. It must never be called by discovery or sync recovery.
    if (!(file === "auth" && action === "bootstrap")) {
      const current = await getSession();
      if (options.accountId && current.user?.id !== options.accountId) {
        throw new APIError("Your account changed. These saved changes remain on this device.", "account_changed", 409);
      }
      headers["X-CSRF-Token"] = current.csrfToken;
    }
  }
  const query = new URLSearchParams({ action, ...options.query });
  const send = async (): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`/api/v1/${file}.php?${query}`, {
      method: options.body === undefined ? "GET" : "POST", headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      });
    } catch {
      throw new APIError("Accounts could not be reached. Your saved data remains on this device.", "network_error", 0);
    }
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new APIError("Accounts are temporarily unavailable. Your local saves are still available.", "unavailable", response.status); }
    if (!response.ok) {
      const error = result as { error?: { code?: string; message?: string }; remote?: RemoteDocument | null; retryAfter?: number };
      throw new APIError(error.error?.message || "The request could not finish. Your saved changes are safe.",
        error.error?.code || "request_failed", response.status, { remote: error.remote, retryAfter: error.retryAfter });
    }
    return result as T;
  };
  try {
    return await (file === "auth" ? serializeAuth(send) : send());
  } catch (error) {
    if (file === "auth" && action !== "session" && error instanceof APIError && ["session_changed", "csrf_failed"].includes(error.code)) {
      // The failed queue operation has released its lock. Refreshing here is
      // read-only, makes a login retry available, and cannot replace a cookie.
      await refreshSession().catch(() => undefined);
    }
    throw error;
  }
}

export function peekSession(): AccountSession | null { return session; }
export function getSession(): Promise<AccountSession> {
  listen();
  if (session) return Promise.resolve(session);
  return pendingSession ?? refreshSession();
}
export function refreshSession(): Promise<AccountSession> {
  listen();
  // Two first-load requests could otherwise create competing pre-auth cookies.
  if (pendingSession) return pendingSession;
  const generation = ++sessionGeneration;
  const promise = request<AccountSession>("auth", "session").then(value => {
    if (!validSession(value)) throw new APIError("The account service returned an unsupported response.", "invalid_response", 502);
    if (generation === sessionGeneration) publish(value);
    return generation === sessionGeneration || !session ? value : session;
  });
  pendingSession = promise;
  void promise.finally(() => { if (pendingSession === promise) pendingSession = null; }).catch(() => undefined);
  return promise;
}
export function subscribeSession(listener: (value: AccountSession) => void): () => void {
  listen(); listeners.add(listener); if (session) listener(session);
  return () => { listeners.delete(listener); };
}
async function authenticated(action: string, body: unknown): Promise<AccountSession> {
  const value = await request<AccountSession>("auth", action, { body });
  if (!validSession(value)) throw new APIError("The account service returned an unsupported response.", "invalid_response", 502);
  ++sessionGeneration;
  return publish(value, true);
}
/** Only call in response to a deliberate login/retry action. The server rechecks
 * the actual cookie, so a valid newer session is returned without replacement. */
export async function bootstrapSession(): Promise<AccountSession> {
  const value = await request<AccountSession>("auth", "bootstrap", { body: {} });
  if (!validSession(value) || value.requiresBootstrap || (value.enabled && !value.csrfToken)) {
    throw new APIError("The account service returned an unsupported response.", "invalid_response", 502);
  }
  ++sessionGeneration;
  return publish(value, true);
}
export async function beginLogin(): Promise<AccountSession> {
  // Another device may have revoked a cached session since the page loaded.
  // Discovery itself never bootstraps; this path is used only by user actions.
  const current = await refreshSession();
  return current.requiresBootstrap ? bootstrapSession() : current;
}
export async function requestEmailCode(email: string, returnTo?: string) {
  await beginLogin();
  return request<{ challengeId: string; expiresIn: number; retryAfter: number }>("auth", "email-start", { body: { email, returnTo } });
}
export function verifyEmailCode(challengeId: string, code: string) {
  return authenticated("email-verify", { challengeId, code });
}
export async function startGoogle(returnTo?: string, link = false): Promise<string> {
  await beginLogin();
  const value = await request<{ url: string }>("auth", "google-start", { body: { returnTo, link } });
  const url = new URL(value.url);
  if (url.protocol !== "https:" || url.origin !== "https://accounts.google.com") {
    throw new APIError("Google sign-in returned an unsupported destination.", "invalid_response", 502);
  }
  return url.href;
}
export function signOut(everywhere = false) { return authenticated(everywhere ? "logout-all" : "logout", {}); }

/** Local utility/app entry routes only; new adapters do not need new login logic. */
export function safeReturnTo(value: string | null | undefined): string {
  if (value === "/account/assistant-consent/") return value;
  if (value === binderStockAlertsPath) return value;
  if (value && /^\/(?:utilities|apps)\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(value)) return value;
  return "/utilities/";
}
export function accountHref(returnTo?: string): string {
  return `/account/?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export function createAccountClient(accountId: string) {
  if (!accountId) throw new Error("An account ID is required.");
  return {
    async getDocument<T>(app: string, document: string, clientId: string): Promise<RemoteDocument<T> | null> {
      const result = await request<{ document: RemoteDocument<T> | null }>("sync", "read", { accountId, query: { app, document, clientId } });
      return result.document;
    },
    async writeDocument<T>(body: DocumentWrite<T>): Promise<RemoteDocument<T>> {
      const result = await request<{ document: RemoteDocument<T> }>("sync", "write", { accountId, body });
      return result.document;
    },
    stageMigration<T>(body: MigrationStage<T>): Promise<{ staged: boolean }> {
      return request("sync", "migration-stage", { accountId, body });
    },
    commitMigration(body: MigrationCommit, legacyKey?: string): Promise<{ documents: RemoteDocument[] }> {
      return request("sync", "migration-commit", { accountId, body, legacyKey });
    },
    async listRecovery(app?: string): Promise<RecoverySnapshot[]> {
      const result = await request<{ snapshots: RecoverySnapshot[] }>("sync", "recovery-list", { accountId, query: app ? { app } : undefined });
      return result.snapshots;
    },
    async getRecovery<T = unknown>(id: string): Promise<RecoveryDocument<T>> {
      const result = await request<{ snapshot: RecoveryDocument<T> }>("sync", "recovery-read", { accountId, query: { id } });
      return result.snapshot;
    },
    async restoreRecovery(body: { id: string; baseRevision: number; clientId: string; operationId: string }): Promise<RemoteDocument> {
      const result = await request<{ document: RemoteDocument }>("sync", "recovery-restore", { accountId, body });
      return result.document;
    },
    deleteRecovery(id: string): Promise<{ deleted: boolean }> { return request("sync", "recovery-delete", { accountId, body: { id } }); },
    getBinderStockAlerts(): Promise<BinderStockAlerts> {
      return request("sync", "binder-stock-alerts", { accountId });
    },
    saveBinderStockAlerts(revision: string, alerts: Pick<BinderStockAlert, "store" | "minimum">[]): Promise<BinderStockAlerts> {
      return request("sync", "binder-stock-alerts", { accountId, body: { revision, alerts } });
    },
  };
}
export type AccountClient = ReturnType<typeof createAccountClient>;
