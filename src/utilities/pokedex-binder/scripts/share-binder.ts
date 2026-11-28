import { accountHref, createAccountClient, type BinderShareStatus } from "../../../../packages/accounts/client";
import type { BinderAccountState } from "../lib/accounts";
import { binderSharePath } from "../lib/binder-share";

interface ShareOptions {
  binder(): { key: string; name: string } | null;
  account(): BinderAccountState;
  reconnect(): Promise<void>;
  sync(accountId: string, binder: string): Promise<number>;
}

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById("binder-share-" + id) as T;

export function createBinderSharing(options: ShareOptions) {
  const dialog = element<HTMLDialogElement>("dialog");
  const title = element("title");
  const signIn = element<HTMLAnchorElement>("sign-in");
  const connect = element<HTMLButtonElement>("connect");
  const retry = element<HTMLButtonElement>("retry");
  const publish = element<HTMLButtonElement>("publish");
  const copy = element<HTMLButtonElement>("copy");
  const stop = element<HTMLButtonElement>("stop");
  const preview = element<HTMLAnchorElement>("preview");
  const link = element<HTMLInputElement>("link");
  const error = element("error");
  const message = element("message");
  const buttons = [signIn, connect, retry, publish, copy, preview];
  let visit: { binder: string; account: string | undefined; boundAccount: string | null; retainedAccount: string | undefined } | null = null;
  let status: BinderShareStatus | null = null;
  const pendingChanges = new Map<string, Promise<BinderShareStatus | null>>();
  const scope = (candidate: NonNullable<typeof visit>) => candidate.account + ":" + candidate.binder;

  signIn.href = accountHref("/utilities/pokemon-binder/");
  function reset() {
    visit = null;
    status = null;
    link.value = "";
    preview.removeAttribute("href");
  }
  function close() {
    reset();
    dialog.close();
  }
  function isCurrent(candidate: typeof visit) {
    const account = options.account();
    return !!candidate && dialog.open && candidate === visit &&
      candidate.binder === options.binder()?.key && candidate.account === account.user?.id &&
      candidate.boundAccount === account.boundAccountId && candidate.retainedAccount === account.retainedAccount?.id;
  }
  function actions(visible: HTMLElement[], publicLink = false) {
    buttons.forEach(button => { button.hidden = !visible.includes(button); });
    element("actions").hidden = !visible.length;
    element("link-panel").hidden = !publicLink;
    element("stop-panel").hidden = !publicLink;
  }
  function showError(text = "") {
    error.textContent = text;
    error.hidden = !text;
  }
  function show(value: BinderShareStatus) {
    status = value;
    if (value.token) {
      link.value = new URL(binderSharePath + "#" + value.token, location.origin).href;
      preview.href = link.value;
      message.textContent = "Anyone with the link can view this binder. Changes appear after they sync to your account.";
      actions([preview, copy], true);
    } else {
      link.value = "";
      preview.removeAttribute("href");
      message.textContent = "Anyone with the link will be able to see this binder’s name, layout, and collection status.";
      actions([publish]);
    }
  }
  async function load() {
    const candidate = visit;
    if (!isCurrent(candidate) || !candidate) return;
    const a = options.account();
    showError();
    if (!navigator.onLine || a.offline || !a.enabled) {
      message.textContent = a.enabled ? "Reconnect to the internet to manage sharing." : "The account service is unavailable.";
      actions([retry]);
      return;
    }
    if (!candidate.account) {
      message.textContent = "Sign in to share a binder from your account.";
      actions([signIn]);
      return;
    }
    if (a.mode !== "account" || a.boundAccountId !== candidate.account || a.pendingMigration || a.retainedAccount) {
      message.textContent = "Connect this binder to your account using Sync and backup.";
      actions([connect]);
      return;
    }
    message.textContent = "Checking sharing…";
    actions([]);
    try {
      await pendingChanges.get(scope(candidate))?.catch(() => null);
      if (!isCurrent(candidate)) return;
      const value = await createAccountClient(candidate.account).getBinderShare(candidate.binder);
      if (isCurrent(candidate)) show(value);
    } catch {
      if (!isCurrent(candidate)) return;
      message.textContent = "";
      showError("Sharing status couldn’t load. Try again.");
      actions([retry]);
    }
  }
  function open() {
    const binder = options.binder();
    if (!binder) return;
    const account = options.account();
    visit = { binder: binder.key, account: account.user?.id, boundAccount: account.boundAccountId,
      retainedAccount: account.retainedAccount?.id };
    status = null;
    publish.disabled = stop.disabled = false;
    element("name").textContent = binder.name;
    dialog.showModal();
    title.focus();
    void load();
  }
  async function change(action: "publish" | "revoke") {
    const candidate = visit;
    const version = status?.version;
    const account = candidate?.account;
    if (!candidate || !account || version === undefined || !isCurrent(candidate)) return;
    const key = scope(candidate);
    if (pendingChanges.has(key)) return;
    const control = action === "publish" ? publish : stop;
    control.disabled = true;
    showError();
    const pending = (async () => {
      const client = createAccountClient(account);
      let revision = 0;
      if (action === "publish") {
        message.textContent = "Syncing this binder…";
        revision = await options.sync(account, candidate.binder);
        if (!isCurrent(candidate)) return null;
        if (!revision) throw new Error("Finish syncing this binder before making it public.");
      }
      return client.changeBinderShare(candidate.binder, version,
        action === "publish" ? { action, documentRevision: revision } : { action });
    })();
    pendingChanges.set(key, pending);
    try {
      const value = await pending;
      if (!value || !isCurrent(candidate)) return;
      show(value);
      if (action === "revoke") message.textContent = "Sharing stopped. The old link can no longer open this binder.";
      (value.token ? copy : publish).focus();
    } catch (failure) {
      if (!isCurrent(candidate)) return;
      await load();
      if (isCurrent(candidate)) showError(failure instanceof Error ? failure.message : "Sharing couldn’t be updated. Try again.");
    } finally {
      pendingChanges.delete(key);
      if (isCurrent(candidate)) control.disabled = false;
    }
  }
  element("open").addEventListener("click", open);
  element("menu").addEventListener("click", open);
  dialog.addEventListener("close", () => { if (!dialog.open) reset(); });
  retry.addEventListener("click", async () => {
    const candidate = visit;
    const a = options.account();
    if (navigator.onLine && (a.offline || !a.enabled)) {
      message.textContent = "Checking your account…";
      actions([]);
      try { await options.reconnect(); } catch { /* Refresh the dialog with the current connection state. */ }
    }
    if (isCurrent(candidate)) void load();
  });
  publish.addEventListener("click", () => void change("publish"));
  stop.addEventListener("click", () => void change("revoke"));
  connect.addEventListener("click", () => {
    close();
    document.getElementById("sync-open")?.click();
  });
  copy.addEventListener("click", async () => {
    const candidate = visit;
    try {
      await navigator.clipboard.writeText(link.value);
      if (isCurrent(candidate)) message.textContent = "Link copied. Anyone with the link can view this binder.";
    } catch {
      if (!isCurrent(candidate)) return;
      link.focus();
      link.select();
      message.textContent = "Link selected. Copy it using your browser or keyboard.";
    }
  });
  return {
    hasPendingChanges: () => pendingChanges.size > 0,
    contextChanged() { if (dialog.open && !isCurrent(visit)) close(); },
  };
}
