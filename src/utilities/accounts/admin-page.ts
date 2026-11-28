import { APIError, refreshSession, requestUtilityAdmin, subscribeSession, type AccountSession } from "../../../packages/accounts/client";
import { item } from "./admin-save-table";
import { retailerFields, savedDataView, type BinderShare, type SavedVersion } from "./admin-save-view";

interface Account {
  id: string;
  email: string;
  createdAt: string;
}
interface DirectoryAccount extends Account { saves: number; lastSavedAt: string | null }
interface Directory { users: DirectoryAccount[]; next: string | null }
interface PricingSnapshot { status: "available" | "empty" | "unavailable"; asOf: string | null }
interface Overview {
  accounts: number;
  newAccounts: number;
  signedIn: number;
  saves: number;
  apps: Record<string, { accounts: number; saves: number; recentlySynced: number }>;
  pricing: Record<"tcgplayer" | "cardmarket", PricingSnapshot>;
}
interface StockAlert {
  store: string;
  minimum: number;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastSendAttemptAt: string | null;
}
interface AccountDetails {
  account: Account;
  providers: string[];
  lastSessionAt: string | null;
  activeSessions: number;
  stockAlerts: StockAlert[];
  binderShares: BinderShare[] | null;
  retailerPreferences: { mode: "all" | "selected"; stores: string[] } | null;
  saves: Array<SavedVersion & { clients: number }>;
  recoveryCount: number;
}
interface RecoveryPage { snapshots: SavedVersion[]; more: boolean }
interface SavedData { save: SavedVersion; json: string }

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(`admin-${id}`) as T;
const gate = element("gate");
const dashboard = element("dashboard");
const detail = element("detail");
const users = element("users");
const documents = element("documents");
const recovery = element("recovery");
const inspector = element("inspector");
const inspectorContent = element("inspector-content");
const download = element<HTMLButtonElement>("download");
const search = element<HTMLInputElement>("search");
const appFilter = element<HTMLSelectElement>("app-filter");
const previous = element<HTMLButtonElement>("previous");
const next = element<HTMLButtonElement>("next");
const moreCopies = element<HTMLButtonElement>("recovery-more");
const refresh = element<HTMLButtonElement>("refresh");
const detailRefresh = element<HTMLButtonElement>("detail-refresh");
const appCards = [...document.querySelectorAll<HTMLElement>("[data-admin-app]")];
const appNames = new Map(appCards.map(card => [card.dataset.adminApp!, card.dataset.title!]));
const documentNames: Record<string, string> = {
  binder: "National Dex binder", "master-sets": "Named set binders", preferences: "Retailer preferences", progress: "Progress",
  intentions: "Intentions", checkpoints: "Checkpoints", comparison: "Saved comparison", measurements: "Measurements",
};
const number = new Intl.NumberFormat();
const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

let viewer: AccountSession | null = null;
let overviewGeneration = 0;
let directoryGeneration = 0;
let detailGeneration = 0;
let recoveryGeneration = 0;
let inspectorGeneration = 0;
let filters = { search: "", app: "" };
let cursors = [""];
let nextCursor: string | null = null;
let selectedAccount: Account | null = null;
let recoveryCursor: SavedVersion | null = null;
let recoveryCount = 0;
let inspectedData: SavedData | null = null;
let directoryTrigger: HTMLButtonElement | null = null;
let inspectorTrigger: HTMLButtonElement | null = null;
let accountScroll = 0;
let inspectorRequest: AbortController | null = null;
let inspectorBack: (() => void) | undefined;
let binderShares: BinderShare[] | null = null;

function dateLabel(value: string | null, formatter = day): HTMLElement {
  if (!value) return item("span", "—");
  const node = item("time", formatter.format(new Date(value)));
  node.dateTime = value;
  node.title = value;
  return node;
}

function setMessage(id: string, message: string): void {
  const node = element(id);
  node.textContent = message;
  node.hidden = message === "";
}

function messageFor(error: unknown): string {
  return error instanceof APIError && error.status > 0
    ? error.message : "Utility admin could not be reached. Try again.";
}

function closeInspector(): void {
  ++inspectorGeneration;
  inspectorRequest?.abort();
  inspectorRequest = null;
  inspectorBack = undefined;
  inspectorTrigger = null;
  inspectedData = null;
  inspectorContent.replaceChildren();
  download.hidden = true;
  element("inspector-title").textContent = "Saved data";
  element("inspector-back-label").textContent = "Back to account";
  element("inspector-context").textContent = "";
  element("inspector-account").textContent = "";
  element("inspector-meta").textContent = "";
  setMessage("inspector-status", "");
  inspector.hidden = true;
}

function clearDetail(): void {
  ++detailGeneration;
  ++recoveryGeneration;
  detail.hidden = true;
  selectedAccount = null;
  recoveryCursor = null;
  recoveryCount = 0;
  binderShares = null;
  closeInspector();
  for (const id of ["user-email", "user-id", "user-created", "user-providers", "user-seen", "user-sessions"]) element(id).replaceChildren();
  setMessage("detail-status", "");
  setMessage("recovery-status", "");
  documents.replaceChildren();
  element("binder-settings").hidden = true;
  for (const id of ["retailers", "shares", "sharing-status"]) element(id).replaceChildren();
  element("stock-alert-list").replaceChildren();
  element("stock-alerts").hidden = true;
  recovery.replaceChildren();
}

function showGate(message: string, action?: "sign-in" | "retry" | "switch"): void {
  viewer = null;
  ++overviewGeneration;
  ++directoryGeneration;
  clearDetail();
  directoryTrigger = null;
  filters = { search: "", app: "" };
  cursors = [""];
  nextCursor = null;
  search.value = "";
  appFilter.value = "";
  users.replaceChildren();
  for (const id of ["total", "new", "active", "saves"]) element(id).textContent = "—";
  for (const card of appCards) for (const node of card.querySelectorAll("[data-accounts], [data-saves], [data-recent]")) node.textContent = "—";
  setMessage("error", "");
  setMessage("users-status", "");
  dashboard.hidden = true;
  gate.hidden = false;
  setMessage("gate-status", message);
  for (const id of ["sign-in", "retry", "switch"]) element(id).hidden = action !== id;
}

function handleAccess(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  if (error.status === 401 || ["session_changed", "account_changed", "csrf_failed"].includes(error.code)) {
    showGate("Your sign-in changed. Sign in with your operator account to continue.", "sign-in");
  } else if (error.code === "admin_required") {
    showGate("This account does not have utility admin access.", "switch");
  } else if (error.code === "admin_unavailable" || error.code === "audit_unavailable") {
    showGate(error.message, "retry");
  } else {
    return false;
  }
  return true;
}

async function loadOverview(session: AccountSession, initial = false): Promise<void> {
  const generation = ++overviewGeneration;
  refresh.disabled = true;
  setMessage("error", "");
  try {
    const result = await requestUtilityAdmin<Overview>(session.user!.id, "overview");
    if (generation !== overviewGeneration) return;
    element("total").textContent = number.format(result.accounts);
    element("new").textContent = number.format(result.newAccounts);
    element("active").textContent = number.format(result.signedIn);
    element("saves").textContent = number.format(result.saves);
    for (const source of ["tcgplayer", "cardmarket"] as const) {
      const snapshot = result.pricing?.[source];
      element(`pricing-${source}`).replaceChildren(snapshot?.status === "available" && snapshot.asOf && Number.isFinite(Date.parse(snapshot.asOf))
        ? dateLabel(snapshot.asOf, time) : snapshot?.status === "empty" ? "No snapshot published" : "Snapshot unavailable");
    }
    for (const card of appCards) {
      const app = result.apps[card.dataset.adminApp!];
      card.querySelector("[data-accounts]")!.textContent = number.format(app.accounts);
      card.querySelector("[data-saves]")!.textContent = number.format(app.saves);
      card.querySelector("[data-recent]")!.textContent = number.format(app.recentlySynced);
    }
    gate.hidden = true;
    dashboard.hidden = selectedAccount !== null;
    await loadDirectory();
  } catch (error) {
    if (generation !== overviewGeneration || handleAccess(error)) return;
    if (initial) showGate(messageFor(error), "retry");
    else setMessage("error", messageFor(error));
  } finally {
    if (generation === overviewGeneration) refresh.disabled = false;
  }
}

function directoryCell(label: string, value: HTMLElement | string): HTMLElement {
  const cell = item("span");
  cell.append(item("span", label, "admin-mobile-label sr-only"), value);
  return cell;
}

function directoryRow(account: DirectoryAccount): HTMLElement {
  const row = item("li");
  const open = item("button", "Open", "admin-link");
  open.type = "button";
  open.setAttribute("aria-label", `Open ${account.email}`);
  open.addEventListener("click", () => {
    directoryTrigger = open;
    void openAccount(account);
  });
  row.append(item("strong", account.email), directoryCell("Created", dateLabel(account.createdAt)),
    directoryCell("Saves", number.format(account.saves)), directoryCell("Last saved", dateLabel(account.lastSavedAt)), open);
  return row;
}

async function loadDirectory(focus = false): Promise<void> {
  const session = viewer;
  if (!session?.user) return;
  const generation = ++directoryGeneration;
  nextCursor = null;
  users.replaceChildren();
  previous.hidden = true;
  next.hidden = true;
  setMessage("users-status", "Loading accounts…");
  try {
    const result = await requestUtilityAdmin<Directory>(session.user.id, "users", { ...filters, after: cursors.at(-1) });
    if (generation !== directoryGeneration) return;
    users.replaceChildren(...result.users.map(directoryRow));
    nextCursor = result.next;
    next.hidden = !nextCursor;
    setMessage("users-status", result.users.length
      ? `Page ${cursors.length} · ${number.format(result.users.length)} ${result.users.length === 1 ? "account" : "accounts"}`
      : "No accounts match these filters.");
  } catch (error) {
    if (generation !== directoryGeneration || handleAccess(error)) return;
    setMessage("users-status", messageFor(error));
  }
  if (generation === directoryGeneration) {
    previous.hidden = cursors.length === 1;
    if (focus) element("users-heading").focus();
  }
}

function applyFilters(focus = false): void {
  filters = { search: search.value.trim(), app: appFilter.value };
  cursors = [""];
  void loadDirectory();
  if (focus) element("users-heading").focus();
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${number.format(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function recordName(version: SavedVersion): string {
  return documentNames[version.document] ?? version.document;
}

function copyLabel(label: string): string {
  return label === "Before sync" ? "Sync checkpoint" : label;
}

function recordRow(account: Account, version: SavedVersion & { clients?: number }): HTMLElement {
  const row = item("li");
  const content = item("div");
  const app = appNames.get(version.app) ?? version.app;
  const title = version.label ? `${app} · ${recordName(version)}` : recordName(version);
  const description = item("p", "", "admin-record-meta");
  const kind = version.label ? `${copyLabel(version.label)} · ` : "";
  description.append(`${kind}Revision ${number.format(version.revision)} · `, dateLabel(version.date, time), ` · ${bytesLabel(version.bytes)}`);
  if (version.clients !== undefined) description.append(` · ${number.format(version.clients)} sync ${version.clients === 1 ? "client" : "clients"}`);
  content.append(item("strong", title), description);
  const open = item("button", version.label ? "View copy" : "View save", "button secondary");
  open.type = "button";
  open.setAttribute("aria-label", `View ${title}${version.label ? ` recovery copy, revision ${version.revision}` : " save"}`);
  open.addEventListener("click", () => void inspect(account, version, open));
  row.append(content, open);
  return row;
}

function renderDocuments(account: Account, saves: AccountDetails["saves"]): void {
  documents.replaceChildren();
  const groups = new Map<string, AccountDetails["saves"]>();
  for (const save of saves) {
    const group = groups.get(save.app) ?? [];
    group.push(save);
    groups.set(save.app, group);
  }
  const appOrder = new Set([...appNames.keys(), ...groups.keys()]);
  for (const app of appOrder) {
    const records = groups.get(app);
    if (!records) continue;
    const section = item("section", "", "admin-document-group");
    const heading = item("h3", appNames.get(app) ?? app);
    const icon = appCards.find(card => card.dataset.adminApp === app)?.querySelector("svg");
    if (icon) heading.prepend(icon.cloneNode(true));
    const list = item("ul", "", "admin-records");
    list.append(...records.map(save => recordRow(account, save)));
    section.append(heading, list);
    documents.append(section);
  }
  if (!saves.length) documents.append(item("p", "This account has no synced utility saves."));
}

function renderStockAlerts(alerts: StockAlert[]): void {
  const rows = alerts.map(alert => {
    const row = item("li");
    const metadata = item("p", "", "admin-record-meta");
    metadata.append(`${alert.enabled ? "Enabled" : "Off"} · Minimum ${alert.minimum} ${alert.minimum === 1 ? "card" : "cards"} · Last checked `,
      dateLabel(alert.lastCheckedAt, time), " · Last send attempt ", dateLabel(alert.lastSendAttemptAt, time));
    row.append(item("strong", alert.store), metadata);
    return row;
  });
  element("stock-alert-list").replaceChildren(...rows);
  element("stock-alerts").hidden = !rows.length;
}

function renderBinderSettings(result: AccountDetails): void {
  binderShares = result.binderShares ?? null;
  const hasBinder = result.saves.some(save => save.app === "pokedex-binder") || result.stockAlerts.length || binderShares?.length;
  const panel = element("binder-settings");
  panel.hidden = !hasBinder;
  if (!hasBinder) return;
  const preferences = result.retailerPreferences;
  const retailer = element("retailers");
  retailer.replaceChildren(item("h3", "Retailer lookup settings"));
  retailer.append(preferences ? retailerFields(preferences.mode, preferences.stores)
    : item("p", "Account default · All supported retailers"));
  const shares = element("shares");
  for (const share of binderShares ?? []) {
    const row = item("li");
    const name = share.name ?? (share.binderKey === "national" ? "National Dex binder" : "Removed or unavailable binder");
    const status = item("span", share.active ? "Link active" : "Revoked");
    const label = item("div");
    label.append(item("strong", name));
    if (!share.name && share.binderKey !== "national") label.append(item("p", share.binderKey, "admin-record-meta"));
    row.append(label, status);
    shares.append(row);
  }
  setMessage("sharing-status", binderShares === null ? "Sharing status is unavailable."
    : binderShares.length ? "" : "No public links have been created.");
}

async function loadRecovery(account: Account): Promise<void> {
  const session = viewer;
  if (!session?.user) return;
  const generation = ++recoveryGeneration;
  moreCopies.disabled = true;
  setMessage("recovery-status", "Loading recovery copies…");
  try {
    const result = await requestUtilityAdmin<RecoveryPage>(session.user.id, "recovery", {
      userId: account.id, beforeId: recoveryCursor?.id, beforeDate: recoveryCursor?.date,
    });
    if (generation !== recoveryGeneration) return;
    recovery.append(...result.snapshots.map(version => recordRow(account, version)));
    recoveryCursor = result.snapshots.at(-1) ?? recoveryCursor;
    moreCopies.hidden = !result.more;
    const shown = recovery.childElementCount;
    setMessage("recovery-status", shown
      ? result.more && shown < recoveryCount
        ? `Showing ${number.format(shown)} of ${number.format(recoveryCount)} copies`
        : `${number.format(shown)} ${shown === 1 ? "recovery copy" : "recovery copies"}`
      : "This account has no recovery copies.");
  } catch (error) {
    if (generation !== recoveryGeneration || handleAccess(error)) return;
    moreCopies.hidden = false;
    setMessage("recovery-status", messageFor(error));
  } finally {
    if (generation === recoveryGeneration) moreCopies.disabled = false;
  }
}

async function openAccount(account: Account, focus = true): Promise<void> {
  const session = viewer;
  if (!session?.user) return;
  clearDetail();
  selectedAccount = account;
  const generation = detailGeneration;
  dashboard.hidden = true;
  detail.hidden = false;
  detailRefresh.disabled = true;
  element("detail-content").hidden = true;
  element("user-email").textContent = account.email;
  element("user-id").textContent = account.id;
  setMessage("detail-status", "Loading account details…");
  if (focus) element("user-email").focus();
  try {
    const result = await requestUtilityAdmin<AccountDetails>(session.user.id, "account", { userId: account.id });
    if (generation !== detailGeneration) return;
    element("user-created").replaceChildren(dateLabel(result.account.createdAt, time));
    element("user-providers").textContent = ["Email code", ...result.providers.map(provider => provider === "google" ? "Google" : provider)].join(", ");
    element("user-seen").replaceChildren(dateLabel(result.lastSessionAt, time));
    element("user-sessions").textContent = number.format(result.activeSessions);
    recoveryCount = result.recoveryCount;
    renderDocuments(result.account, result.saves);
    renderBinderSettings(result);
    renderStockAlerts(result.stockAlerts);
    setMessage("detail-status", "");
    element("detail-content").hidden = false;
    moreCopies.hidden = true;
    if (result.recoveryCount) void loadRecovery(account);
    else setMessage("recovery-status", "This account has no recovery copies.");
  } catch (error) {
    if (generation === detailGeneration && !handleAccess(error)) setMessage("detail-status", messageFor(error));
  } finally {
    if (generation === detailGeneration) detailRefresh.disabled = false;
  }
}

async function inspect(account: Account, version: SavedVersion, trigger: HTMLButtonElement): Promise<void> {
  const session = viewer;
  if (!session?.user) return;
  closeInspector();
  const generation = inspectorGeneration;
  const request = new AbortController();
  inspectorRequest = request;
  inspectorTrigger = trigger;
  accountScroll = window.scrollY;
  element("inspector-title").textContent = recordName(version);
  element("inspector-context").textContent = `${appNames.get(version.app) ?? version.app} · ${version.label ? copyLabel(version.label) : "Current save"}`;
  element("inspector-account").textContent = account.email;
  setMessage("inspector-status", "Loading saved data…");
  detail.hidden = true;
  inspector.hidden = false;
  element("inspector-title").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
  try {
    const result = await requestUtilityAdmin<SavedData>(session.user.id, version.label ? "snapshot" : "save", { userId: account.id, id: version.id });
    if (generation !== inspectorGeneration) return;
    const { save, json } = result;
    element("inspector-meta").replaceChildren(`Revision ${number.format(save.revision)} · Schema ${save.schemaVersion} · ${bytesLabel(save.bytes)} · `, dateLabel(save.date, time));
    inspectedData = result;
    download.hidden = false;
    const content = await savedDataView(save, json, {
      signal: request.signal, shares: binderShares, historical: save.label !== null,
      selectBinder(name, back) {
        inspectorBack = back;
        const title = element("inspector-title");
        title.textContent = name ?? recordName(version);
        element("inspector-back-label").textContent = back ? "Back to named binders" : "Back to account";
        if (name !== null) {
          title.focus({ preventScroll: true });
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      },
    }).catch(() => null);
    if (generation !== inspectorGeneration) return;
    setMessage("inspector-status", content ? "" : "This saved format cannot be displayed. Download the original JSON to access the stored data.");
    if (content) inspectorContent.replaceChildren(...content);
  } catch (error) {
    if (generation === inspectorGeneration && !handleAccess(error)) setMessage("inspector-status", messageFor(error));
  }
}

function saveDownload(): void {
  if (!inspectedData || inspector.hidden) return;
  const { json, save } = inspectedData;
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = item("a");
  link.href = url;
  link.download = `${save.app}-${save.document}-r${save.revision}${save.label ? "-recovery" : ""}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function acceptSession(session: AccountSession): void {
  if (!session.enabled) {
    showGate("Utility accounts are temporarily unavailable.", "retry");
  } else if (!session.user) {
    showGate("Sign in with your operator account to view utility activity and saves.", "sign-in");
  } else if (viewer?.user?.id !== session.user.id || viewer.csrfToken !== session.csrfToken) {
    showGate("Checking admin access…");
    viewer = session;
    void loadOverview(session, true);
  }
}

function connect(): void {
  showGate("Checking admin access…");
  void refreshSession().catch(error => showGate(messageFor(error), "retry"));
}

element("search-form").addEventListener("submit", event => { event.preventDefault(); applyFilters(); });
appFilter.addEventListener("change", () => applyFilters());
document.querySelectorAll<HTMLButtonElement>("[data-filter-app]").forEach(button => button.addEventListener("click", () => {
  search.value = "";
  appFilter.value = button.dataset.filterApp!;
  applyFilters(true);
}));
previous.addEventListener("click", () => { if (cursors.length > 1) { cursors.pop(); void loadDirectory(true); } });
next.addEventListener("click", () => { if (nextCursor !== null) { cursors.push(nextCursor); void loadDirectory(true); } });
refresh.addEventListener("click", () => { if (viewer) void loadOverview(viewer); });
detailRefresh.addEventListener("click", () => { if (selectedAccount) void openAccount(selectedAccount, false); });
moreCopies.addEventListener("click", () => { if (selectedAccount) void loadRecovery(selectedAccount); });
element("back").addEventListener("click", () => {
  clearDetail();
  dashboard.hidden = false;
  (directoryTrigger?.isConnected ? directoryTrigger : element("users-heading")).focus();
  directoryTrigger = null;
});
element("retry").addEventListener("click", connect);
element("inspector-close").addEventListener("click", () => {
  if (inspectorBack) {
    inspectorBack();
    return;
  }
  const trigger = inspectorTrigger;
  closeInspector();
  detail.hidden = false;
  (trigger?.isConnected ? trigger : element("user-email")).focus({ preventScroll: true });
  window.scrollTo({ top: accountScroll, behavior: "instant" });
});
download.addEventListener("click", saveDownload);
window.addEventListener("pagehide", () => showGate("Checking admin access…"));
window.addEventListener("pageshow", event => { if (event.persisted) connect(); });
subscribeSession(acceptSession);
connect();
