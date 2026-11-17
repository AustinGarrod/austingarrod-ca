import { APIError, createAccountClient, refreshSession, requestEmailCode, safeReturnTo, signOut, startGoogle, subscribeSession, verifyEmailCode, type AccountSession, type RecoverySnapshot } from "../../../packages/accounts/client";

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element("account-status");
const recoveryStatus = element("account-recovery-status");
const recoveryList = element<HTMLUListElement>("account-recovery-list");
const email = element<HTMLInputElement>("account-email");
const code = element<HTMLInputElement>("account-code");
const params = new URLSearchParams(location.search);
const returnTo = safeReturnTo(params.get("returnTo"));
const returnLink = element<HTMLAnchorElement>("account-return");
returnLink.href = returnTo;
if (returnTo !== "/utilities/") returnLink.lastChild!.textContent = "Back to your utility";
let current: AccountSession | null = null;
let challengeId = "";
let busy = false;
let resendAt = 0;
let recoveryGeneration = 0;
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
  button.textContent = wait ? `Send another code in ${wait}s` : challengeId ? "Send another code" : "Email a sign-in code";
}
window.setInterval(updateResend, 1000);

async function loadRecovery(): Promise<void> {
  const user = current?.user;
  if (!user) return;
  const generation = ++recoveryGeneration;
  recoveryStatus.textContent = "Loading recovery copies…";
  try {
    const snapshots = await createAccountClient(user.id).listRecovery();
    if (generation !== recoveryGeneration || current?.user?.id !== user.id) return;
    recoveryList.replaceChildren();
    recoveryStatus.textContent = snapshots.length ? `${snapshots.length} recovery ${snapshots.length === 1 ? "copy" : "copies"}.` : "No recovery copies yet.";
    for (const snapshot of snapshots) recoveryList.append(recoveryRow(snapshot, user.id));
  } catch (error) {
    if (generation === recoveryGeneration) recoveryStatus.textContent = error instanceof APIError ? error.message : "Recovery copies could not be loaded. Try again shortly.";
  }
}
function recoveryRow(snapshot: RecoverySnapshot, accountId: string): HTMLLIElement {
  const item = document.createElement("li");
  const heading = document.createElement("h3");
  const app = ({ "pokedex-binder": "Pokédex Binder", "idle-slayer-companion": "Idle Slayer Companion" } as Record<string, string>)[snapshot.app] ?? snapshot.app;
  heading.textContent = `${app} · ${snapshot.document}`;
  const note = document.createElement("p");
  const date = new Date(snapshot.createdAt);
  note.textContent = `${snapshot.label} · ${Number.isNaN(date.valueOf()) ? snapshot.createdAt : date.toLocaleString()}`;
  const actions = document.createElement("div"); actions.className = "account-actions";
  const client = createAccountClient(accountId);
  function action(label: string, run: () => Promise<void>): void {
    const button = document.createElement("button");
    button.type = "button"; button.className = "button compact"; button.textContent = label;
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
  });
  item.append(heading, note, actions); return item;
}
function render(value: AccountSession): void {
  const previousId = current?.user?.id;
  current = value;
  element("account-unavailable").hidden = value.enabled;
  element("account-signed-out").hidden = !value.enabled || !!value.user;
  element("account-signed-in").hidden = !value.user;
  element("account-recovery").hidden = !value.user;
  element("account-migration-paused").hidden = value.migrationEnabled;
  element("account-google-verification").hidden = !value.pendingGoogleEmail;
  if (value.pendingGoogleEmail && !value.user) email.value = value.pendingGoogleEmail;
  if (value.user) {
    element("account-identity").textContent = value.user.email;
    if (previousId !== value.user.id) { challengeId = ""; code.value = ""; void loadRecovery(); }
  } else {
    ++recoveryGeneration; recoveryList.replaceChildren();
  }
  if (!value.enabled) message("Account syncing is not available yet. Your local saves are unchanged.");
  else if (previousId !== value.user?.id) message(value.user ? "You’re signed in." : "Choose how to sign in.");
}
subscribeSession(render);
element<HTMLFormElement>("account-email-form").addEventListener("submit", event => {
  event.preventDefault(); if (busy) return;
  setBusy(true);
  void requestEmailCode(email.value.trim(), returnTo).then(result => {
    challengeId = result.challengeId; resendAt = Date.now() + result.retryAfter * 1000;
    element("account-code-form").hidden = false;
    message("Check your email for a sign-in code."); code.focus();
  }).catch(error => {
    if (error instanceof APIError && error.retryAfter) resendAt = Date.now() + error.retryAfter * 1000;
    failure(error);
  }).finally(() => setBusy(false));
});
element<HTMLFormElement>("account-code-form").addEventListener("submit", event => {
  event.preventDefault(); if (busy || !challengeId) return;
  setBusy(true);
  void verifyEmailCode(challengeId, code.value.trim()).then(() => {
    code.value = ""; challengeId = ""; message("You’re signed in. Open your utility to review its saves.");
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
  if (busy || (everywhere && !window.confirm("Sign out all devices? Their local saves and pending changes will be retained."))) return;
  setBusy(true);
  void signOut(everywhere).then(() => message(everywhere ? "Signed out everywhere. Local saves are retained." : "Signed out. Local saves are retained."))
    .catch(failure).finally(() => setBusy(false));
}
element("account-logout").addEventListener("click", () => logout(false));
element("account-logout-all").addEventListener("click", () => logout(true));
element("account-recovery-refresh").addEventListener("click", () => { void loadRecovery(); });
async function reload(): Promise<void> {
  try {
    render(await refreshSession());
    if (params.get("google") === "failed") message("Google sign-in could not finish. Try again or use an emailed code.", true);
    if (params.get("google") === "cancelled") message("Google sign-in was cancelled. You can choose another sign-in method.");
  }
  catch (error) { element("account-unavailable").hidden = false; failure(error); }
}
element("account-retry").addEventListener("click", () => { void reload(); });
void reload();
