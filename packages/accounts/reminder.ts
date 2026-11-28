import { accountHref } from "./client";
import "./reminder.css";

const visitKey = "austingarrod.account-reminder.v1";
const blockingSurface = 'dialog[open], [aria-modal="true"]:not([hidden]), .utility-update:not([hidden])';

interface ReminderOptions {
  title: string;
  description: string;
  returnTo: string;
  offered: () => boolean;
  beforeContinue?: () => boolean;
  onVisibilityChange?: () => void;
  fallbackFocus?: () => HTMLElement | null;
}

function visitState(): string | null {
  try { return window.sessionStorage.getItem(visitKey) ?? "0"; }
  catch { return null; }
}

function setVisitState(state: string): boolean {
  try { window.sessionStorage.setItem(visitKey, state); return true; }
  catch { return false; }
}

/** Read the shared state on each change so restored history entries cannot show again. */
export function mountAccountReminder(host: HTMLElement, options: ReminderOptions) {
  host.hidden = true;
  host.classList.add("account-reminder", "rr-block", "telemetry-private");
  host.setAttribute("data-analytics-private", "");
  host.setAttribute("aria-label", "Utility account reminder");

  const copy = document.createElement("div");
  copy.className = "account-reminder-copy";
  const title = document.createElement("strong");
  title.textContent = options.title;
  const description = document.createElement("p");
  description.textContent = options.description;
  copy.append(title, description);

  const actions = document.createElement("div");
  actions.className = "account-reminder-actions";
  const href = accountHref(options.returnTo);
  const continueControl = options.beforeContinue ? document.createElement("button") : document.createElement("a");
  if (continueControl instanceof HTMLAnchorElement) continueControl.href = href;
  else continueControl.type = "button";
  continueControl.className = "account-reminder-primary";
  continueControl.textContent = "Create an account";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Keep working";
  actions.append(continueControl, dismiss);
  host.replaceChildren(copy, actions);

  const announcement = document.createElement("span");
  announcement.className = "account-reminder-announcement";
  announcement.setAttribute("role", "status");
  host.before(announcement);

  let workFocus: HTMLElement | null = null;
  let disposed = false;
  let queued = false;
  const observer = new MutationObserver(requestRefresh);

  function hide() {
    if (!host.hidden) {
      host.hidden = true;
      options.onVisibilityChange?.();
    }
    if (announcement.textContent) announcement.textContent = "";
  }

  function refresh() {
    const offered = options.offered();
    if (!offered) hide();
    if (!offered || visitState() !== "2") { observer.disconnect(); return; }

    const blocked = document.hidden || !navigator.onLine || host.parentElement?.closest("[hidden], [inert]")
      || document.querySelector(blockingSurface);
    if (blocked) {
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "inert", "aria-modal"] });
      return;
    }
    observer.disconnect();
    if (!setVisitState("shown")) return;
    workFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    host.hidden = false;
    options.onVisibilityChange?.();
    announcement.textContent = options.title + ". " + options.description;
  }

  function requestRefresh() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!disposed) refresh(); });
  }

  dismiss.addEventListener("click", () => {
    hide();
    const target = workFocus && workFocus !== document.body && workFocus.getClientRects().length
      ? workFocus : options.fallbackFocus?.();
    target?.focus({ preventScroll: true });
  });
  continueControl.addEventListener("click", event => {
    if (!navigator.onLine || !options.offered()) { event.preventDefault(); return; }
    if (options.beforeContinue?.()) location.assign(href);
  });

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) hide();
    requestRefresh();
  };
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("online", requestRefresh);
  window.addEventListener("offline", requestRefresh);
  document.addEventListener("visibilitychange", requestRefresh);
  requestRefresh();

  return {
    recordChange() {
      const state = visitState();
      if (state === "0") setVisitState("1");
      if (state === "1") setVisitState("2");
      requestRefresh();
    },
    refresh: requestRefresh,
    dispose() {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", requestRefresh);
      window.removeEventListener("offline", requestRefresh);
      document.removeEventListener("visibilitychange", requestRefresh);
      hide();
      announcement.remove();
      host.replaceChildren();
    },
  };
}
