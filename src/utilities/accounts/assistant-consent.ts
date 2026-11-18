import { accountHref, refreshSession, subscribeSession, type AccountSession } from "../../../packages/accounts/client";
import { assistantRequest, permittedAssistantCallback } from "./assistant-client";

interface Consent {
  utility: string;
  client: string;
  destination: string;
  mayWrite: boolean;
}
const storageKey = "austingarrod.assistant-consent.v1";
const status = document.querySelector<HTMLElement>("#assistant-status")!;
const details = document.querySelector<HTMLElement>("#assistant-permissions")!;
const signIn = document.querySelector<HTMLAnchorElement>("#assistant-sign-in")!;
const buttons = [...details.querySelectorAll<HTMLButtonElement>("button")];
signIn.href = accountHref("/account/assistant-consent/");
let flow = "";
try {
  const fragment = location.hash.slice(1);
  if (/^[A-Za-z0-9_-]{43}$/.test(fragment)) {
    sessionStorage.setItem(storageKey, fragment);
    history.replaceState(null, "", location.pathname);
  }
  flow = sessionStorage.getItem(storageKey) ?? "";
} catch {
  status.textContent = "This browser could not retain your connection request. Start the connection again.";
}

let shownAccount: AccountSession | null = null;
let generation = 0;
let busy = false;
let signedIn = "";
let rendered = false;
async function show(session: AccountSession): Promise<void> {
  const key = session.user?.id ?? "";
  if ((rendered && key === signedIn) || busy) return;
  signedIn = key;
  rendered = true;
  const request = ++generation;
  shownAccount = null;
  details.hidden = true;
  signIn.hidden = true;
  if (!flow) {
    status.textContent = "Start a connection from Codex or Claude to see its permissions here.";
    return;
  }
  if (!session.enabled) {
    status.textContent = "Assistant connections are temporarily unavailable.";
    return;
  }
  if (!session.user) {
    status.textContent = "Sign in with your utility account to review access.";
    signIn.hidden = false;
    return;
  }
  status.textContent = "Loading permissions…";
  try {
    const data = await assistantRequest<Consent>("oauth/consent", session, { flow });
    if (request !== generation) return;
    document.querySelector<HTMLElement>("#assistant-client-name")!.textContent = data.client;
    document.querySelector<HTMLElement>("#assistant-utility-name")!.textContent = data.utility;
    document.querySelector<HTMLElement>("#assistant-account-name")!.textContent = session.user.email;
    document.querySelector<HTMLElement>("#assistant-destination")!.textContent = data.destination;
    document.querySelector<HTMLButtonElement>('#assistant-permissions button[value="write"]')!.hidden = !data.mayWrite;
    document.querySelector<HTMLElement>("#assistant-write-description")!.hidden = !data.mayWrite;
    shownAccount = session;
    status.textContent = "";
    details.hidden = false;
  } catch (error) {
    if (request === generation) status.textContent = error instanceof Error ? error.message : "Start the connection again.";
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    const session = shownAccount;
    if (busy || !session?.user) return;
    busy = true;
    for (const action of buttons) action.disabled = true;
    try {
      const { redirect } = await assistantRequest<{ redirect: string }>("oauth/consent", session, {
        flow, decision: button.value, accountId: session.user.id,
      });
      if (!permittedAssistantCallback(redirect)) throw new Error("The assistant callback is unavailable.");
      sessionStorage.removeItem(storageKey);
      location.replace(redirect);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Start the connection again.";
      details.hidden = true;
    } finally {
      busy = false;
      for (const action of buttons) action.disabled = false;
    }
  });
}
subscribeSession(session => { void show(session); });
void refreshSession().then(show).catch(error => {
  status.textContent = error instanceof Error ? error.message : "Assistant access is temporarily unavailable.";
});
