import { APIError, beginLogin, createAccountClient, refreshSession, requestEmailCode, safeReturnTo, signOut, startGoogle, subscribeSession, verifyEmailCode, type AccountSession, type RecoverySnapshot } from "../../../packages/accounts/client";

import { assistantRequest, type AssistantConnection } from "./assistant-client";

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element("account-status");
const recoveryStatus = element("account-recovery-status");
const recoveryList = element<HTMLUListElement>("account-recovery-list");
const syncHistoryPanel = element<HTMLDetailsElement>("account-sync-history");
const syncHistoryList = element<HTMLUListElement>("account-sync-history-list");
const syncHistoryMore = element<HTMLButtonElement>("account-sync-history-more");
const syncHistoryPageSize = 20;
const email = element<HTMLInputElement>("account-email");
const code = element<HTMLInputElement>("account-code");
const params = new URLSearchParams(location.search);
const returnTo = safeReturnTo(params.get("returnTo"));
const returnLink = element<HTMLAnchorElement>("account-return");
returnLink.href = returnTo;
if (returnTo === "/account/admin/") returnLink.lastChild!.textContent = "Back to utility admin";
else if (returnTo !== "/utilities/") returnLink.lastChild!.textContent = "Back to your utility";
let current: AccountSession | null = null;
let challengeId = "";
let busy = false;
let resendAt = 0;
let recoveryGeneration = 0;
let syncHistory: RecoverySnapshot[] = [];
let assistantGeneration = 0;
const clientId = crypto.randomUUID();

function message(value: string, error = false): void {
  status.textContent = value;
  status.classList.toggle("account-error", error);
}
function failure(error: unknown): void {
  message(error instanceof APIError ? error.message : "The request could not finish. Your saved data has not been removed.", true);
}
function setBusy(value: boolean): void {
  busy = value;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".account-layout button")) button.disabled = value;
  updateResend();
}
function updateResend(): void {
  const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
  const button = element<HTMLButtonElement>("account-email-submit");
  button.disabled = busy || wait > 0;
  button.textContent = wait ? `Send another code in ${wait}s` : challengeId ? "Send another code"
    : current?.pendingGoogleEmail ? "Email a verification code" : "Email a sign-in code";
}
window.setInterval(updateResend, 1000);

function appendSyncHistory(accountId: string, count: number): void {
  const start = syncHistoryList.childElementCount;
  const rows = syncHistory.slice(start, start + count).map(snapshot => recoveryRow(snapshot, accountId));
  syncHistoryList.append(...rows);
  syncHistoryMore.hidden = syncHistoryList.childElementCount >= syncHistory.length;
}

syncHistoryMore.addEventListener("click", () => {
  const accountId = current?.user?.id;
  if (busy || !accountId) return;
  const firstOlder = syncHistoryList.childElementCount;
  appendSyncHistory(accountId, syncHistoryPageSize);
  syncHistoryList.children[firstOlder]?.querySelector("button")?.focus();
});

async function loadRecovery(): Promise<void> {
  const user = current?.user;
  if (!user) return;
  const generation = ++recoveryGeneration;
  recoveryStatus.textContent = "Loading recovery copies…";
  try {
    const snapshots = await createAccountClient(user.id).listRecovery();
    if (generation !== recoveryGeneration || current?.user?.id !== user.id) return;
    const copies = snapshots.filter(snapshot => snapshot.label !== "Before sync");
    syncHistory = snapshots.filter(snapshot => snapshot.label === "Before sync");
    recoveryList.replaceChildren(...copies.map(snapshot => recoveryRow(snapshot, user.id)));
    recoveryStatus.textContent = copies.length
      ? `${copies.length} recovery ${copies.length === 1 ? "copy" : "copies"}.`
      : snapshots.length ? "" : "No recovery copies yet.";
    const visible = Math.max(syncHistoryPageSize, syncHistoryList.childElementCount);
    syncHistoryList.replaceChildren();
    syncHistoryPanel.hidden = syncHistory.length === 0;
    element("account-sync-history-summary").textContent = `Sync checkpoints · ${syncHistory.length}`;
    appendSyncHistory(user.id, visible);
  } catch (error) {
    if (generation === recoveryGeneration) recoveryStatus.textContent = error instanceof APIError ? error.message : "Recovery copies could not be loaded. Try again shortly.";
  }
}
function recoveryRow(snapshot: RecoverySnapshot, accountId: string): HTMLLIElement {
  const item = document.createElement("li");
  const heading = document.createElement("h3");
  const app = ({ "pokedex-binder": "Pokémon Binder Tracker", "idle-slayer-companion": "Idle Slayer Companion", "radius-map": "Radius Map" } as Record<string, string>)[snapshot.app] ?? snapshot.app;
  heading.textContent = `${app} · ${snapshot.document}`;
  const note = document.createElement("p");
  const date = new Date(snapshot.createdAt);
  const label = snapshot.label === "Before sync" ? "Daily checkpoint" : snapshot.label;
  note.textContent = `${label} · ${Number.isNaN(date.valueOf()) ? snapshot.createdAt : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
  if (snapshot.revision > 0) note.textContent += ` · Revision ${snapshot.revision}`;
  const actions = document.createElement("div"); actions.className = "account-actions";
  const client = createAccountClient(accountId);
  function action(label: string, run: () => Promise<void>, danger = false): void {
    const button = document.createElement("button");
    button.type = "button"; button.className = danger ? "button compact account-danger" : "button compact"; button.textContent = label;
    button.addEventListener("click", () => {
      if (busy || current?.user?.id !== accountId) return;
      setBusy(true);
      void run().catch(failure).finally(() => setBusy(false));
    });
    actions.append(button);
  }
  action("Download", async () => {
    const copy = await client.getRecovery(snapshot.id);
    if (current?.user?.id !== accountId) return;
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${snapshot.app}-${snapshot.document}-recovery-${snapshot.id}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("Recovery copy downloaded.");
  });
  action("Restore", async () => {
    const latest = await client.getDocument(snapshot.app, snapshot.document, clientId);
    if (current?.user?.id !== accountId || !window.confirm("Restore this recovery copy? The current account version will also be kept in recovery. Open devices may need to review their pending changes.")) return;
    await client.restoreRecovery({ id: snapshot.id, baseRevision: latest?.revision ?? 0, clientId, operationId: crypto.randomUUID() });
    message("Recovery copy restored. Open the utility to review and sync this version.");
    await loadRecovery();
  });
  action("Delete copy", async () => {
    if (!window.confirm("Permanently delete this recovery copy? This does not delete your active utility save.")) return;
    await client.deleteRecovery(snapshot.id);
    message("Recovery copy deleted."); await loadRecovery();
  }, true);
  item.append(heading, note, actions); return item;
}
async function loadAssistants(session: AccountSession): Promise<void> {
  const panel = element("account-assistants");
  const notice = element("account-assistants-status");
  const list = element("account-assistants-list");
  const generation = ++assistantGeneration;
  panel.hidden = true;
  list.replaceChildren();
  try {
    const data = await assistantRequest<{ connections: AssistantConnection[]; available: string[] }>("connections", session);
    if (generation !== assistantGeneration) return;
    for (const connection of data.connections) {
      const item = document.createElement("li");
      const heading = document.createElement("h3");
      heading.textContent = connection.client + " · " + connection.utility;
      const permissions = document.createElement("p");
      permissions.textContent = connection.canWrite ? "Read and write" : "Read only";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button compact account-danger";
      button.textContent = "Revoke access";
      button.setAttribute("aria-label", "Revoke " + connection.client + " access to " + connection.utility);
      button.addEventListener("click", async () => {
        if (generation !== assistantGeneration) return;
        button.disabled = true;
        try {
          await assistantRequest("connections", session, { id: connection.id });
          if (generation !== assistantGeneration) return;
          item.remove();
          notice.textContent = "Assistant access revoked.";
        } catch (error) {
          if (generation === assistantGeneration) notice.textContent = error instanceof Error ? error.message : "Could not revoke access.";
        } finally {
          button.disabled = false;
        }
      });
      item.append(heading, permissions, button);
      list.append(item);
    }
    notice.textContent = data.connections.length ? "" : "No assistants are connected.";
    panel.hidden = data.connections.length === 0 && data.available.length === 0;
  } catch (error) {
    if (generation !== assistantGeneration) return;
    panel.hidden = false;
    notice.textContent = error instanceof Error ? error.message : "Assistant access is temporarily unavailable.";
  }
}

function render(value: AccountSession): void {
  const firstRender = current === null;
  const previousId = current?.user?.id;
  const previousPendingEmail = current?.pendingGoogleEmail;
  const previousBootstrap = current?.requiresBootstrap === true;
  const verifyingGoogle = !!value.pendingGoogleEmail;
  current = value;
  if (previousId !== value.user?.id || previousPendingEmail !== value.pendingGoogleEmail || previousBootstrap !== (value.requiresBootstrap === true)) {
    challengeId = ""; code.value = ""; resendAt = 0;
    element("account-code-form").hidden = true;
  }
  element("account-unavailable").hidden = value.enabled;
  // Linking an external-domain Google identity needs mailbox proof even when
  // the account is already signed in. Keep that proof form accessible.
  element("account-signed-out").hidden = !value.enabled || (!!value.user && !verifyingGoogle);
  element("account-signed-in").hidden = !value.user;
  element("account-recovery").hidden = !value.user;
  element("account-migration-paused").hidden = value.migrationEnabled;
  element("account-google-verification").hidden = !verifyingGoogle;
  element("account-google").hidden = verifyingGoogle;
  element("account-link-google").hidden = verifyingGoogle;
  element("account-sign-in-divider").hidden = verifyingGoogle;
  element("account-sign-in-heading").textContent = verifyingGoogle ? "Verify your email to connect Google" : "Sign in or create an account";
  element("account-code-submit").textContent = verifyingGoogle ? "Verify and connect Google" : "Sign in";
  email.readOnly = verifyingGoogle;
  if (value.pendingGoogleEmail) email.value = value.pendingGoogleEmail;
  updateResend();
  if (previousId !== value.user?.id) {
    ++recoveryGeneration;
    recoveryStatus.textContent = "";
    recoveryList.replaceChildren();
    syncHistory = [];
    syncHistoryList.replaceChildren();
    syncHistoryPanel.open = false;
    syncHistoryPanel.hidden = true;
  }
  if (value.user) {
    element("account-identity").textContent = value.user.email;
    if (previousId !== value.user.id) {
      void loadRecovery();
      void loadAssistants(value);
    }
  } else {
    ++assistantGeneration; element("account-assistants").hidden = true;
    element("account-assistants-list").replaceChildren();
  }
  if (!value.enabled) message("");
  else if (value.requiresBootstrap) message("Your sign-in expired. Request a new email code or continue with Google to sign in again.");
  else if (verifyingGoogle) message("Verify your email address to finish connecting Google.");
  else if (firstRender || previousId !== value.user?.id) message(value.user ? "You’re signed in." : "Choose how to sign in.");
}
subscribeSession(render);
element<HTMLFormElement>("account-email-form").addEventListener("submit", event => {
  event.preventDefault(); if (busy) return;
  setBusy(true);
  void requestEmailCode(email.value.trim(), returnTo).then(result => {
    challengeId = result.challengeId; resendAt = Date.now() + result.retryAfter * 1000;
    element("account-code-form").hidden = false;
    message(current?.pendingGoogleEmail ? "Check your email for a verification code to connect Google." : "Check your email for a sign-in code."); code.focus();
  }).catch(error => {
    if (error instanceof APIError && error.retryAfter) resendAt = Date.now() + error.retryAfter * 1000;
    failure(error);
  }).finally(() => setBusy(false));
});
element<HTMLFormElement>("account-code-form").addEventListener("submit", event => {
  event.preventDefault(); if (busy || !challengeId) return;
  const linkingGoogle = !!current?.pendingGoogleEmail;
  setBusy(true);
  void verifyEmailCode(challengeId, code.value.trim()).then(() => {
    code.value = ""; challengeId = "";
    message(linkingGoogle ? "Google is connected to your account." : "You’re signed in. Open your utility to review its saves.");
    if (params.has("returnTo")) location.assign(returnTo);
  }).catch(failure).finally(() => setBusy(false));
});
function google(link: boolean): void {
  if (busy) return; setBusy(true);
  void startGoogle(returnTo, link).then(url => location.assign(url)).catch(failure).finally(() => setBusy(false));
}
element("account-google").addEventListener("click", () => google(false));
element("account-link-google").addEventListener("click", () => google(true));
function logout(everywhere: boolean): void {
  if (busy || (everywhere && !window.confirm("Sign out all devices and revoke connected assistants? Local saves and pending changes will be retained."))) return;
  setBusy(true);
  void signOut(everywhere).then(() => message(everywhere ? "Signed out everywhere. Local saves are retained." : "Signed out. Local saves are retained."))
    .catch(failure).finally(() => setBusy(false));
}
element("account-logout").addEventListener("click", () => logout(false));
element("account-logout-all").addEventListener("click", () => logout(true));
element("account-recovery-refresh").addEventListener("click", () => { void loadRecovery(); });
async function reload(explicitLoginRetry = false): Promise<void> {
  try {
    render(await (explicitLoginRetry ? beginLogin() : refreshSession()));
    if (params.get("google") === "failed") message("Google sign-in could not finish. Try again or use an emailed code.", true);
    if (params.get("google") === "cancelled") message("Google sign-in was cancelled. You can choose another sign-in method.");
  }
  catch (error) {
    element("account-unavailable").hidden = false;
    // The unavailable panel already says so; a second red line would only repeat it.
    if (error instanceof APIError && error.code === "unavailable") message("");
    else failure(error);
  }
}
element("account-retry").addEventListener("click", () => { void reload(true); });
void reload();
