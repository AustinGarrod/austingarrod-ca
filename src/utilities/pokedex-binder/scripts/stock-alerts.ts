import { AccountApiError, createAccountClient, type BinderStockAlerts } from "../../../../packages/accounts/client";
import type { BinderAccountState } from "../lib/accounts";
import { buyingStores } from "../lib/buying-offers";

const element = <T extends HTMLElement = HTMLElement>(name: string) => document.getElementById("stock-alerts-" + name) as T;
const date = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" });

export function createStockAlerts(reconnect: () => Promise<void>) {
  const panel = element("panel"), toggle = element<HTMLButtonElement>("toggle");
  const form = element<HTMLFormElement>("form"), fields = element<HTMLFieldSetElement>("fields");
  const guest = element("guest"), email = element("email"), status = element("status");
  const noBinders = element("no-binders");
  const save = element<HTMLButtonElement>("save"), retry = element("retry");
  const rows = buyingStores.map(store => {
    const row = fields.querySelector<HTMLElement>(`[data-alert-store="${store}"]`)!;
    const enabled = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const minimum = row.querySelector<HTMLInputElement>('input[type="number"]')!;
    enabled.addEventListener("change", () => { minimum.disabled = !enabled.checked; });
    return { store, enabled, minimum, status: row.querySelector("[data-alert-status]")! };
  });
  let account: BinderAccountState | undefined, active = false, generation = 0;
  let settings: BinderStockAlerts | undefined;
  let pendingSaves = 0;

  function show(value: BinderStockAlerts) {
    settings = value;
    for (const row of rows) {
      const alert = value.alerts.find(item => item.store === row.store);
      row.enabled.checked = Boolean(alert);
      row.minimum.disabled = !alert;
      row.minimum.value = String(alert?.minimum ?? 1);
      row.status.textContent = alert?.lastCheckedAt ? `Last checked ${date.format(new Date(alert.lastCheckedAt))}`
        : alert ? "Waiting for the first check" : "";
    }
    const address = account?.user?.email ?? "";
    email.textContent = `Emails go to ${address}, at most once a day per store. Store checks run periodically.`;
    noBinders.hidden = value.hasSyncedBinders;
    form.hidden = false;
  }

  async function load() {
    if (!active || panel.hidden) return;
    const ticket = ++generation;
    settings = undefined;
    form.hidden = guest.hidden = retry.hidden = true;
    fields.disabled = save.disabled = false;
    status.textContent = "";
    if (!account) {
      status.textContent = "Checking account status…";
      return;
    }
    if (account.offline || !account.enabled) {
      status.textContent = "The account service is unavailable. Reconnect to manage alerts.";
      retry.hidden = false;
      return;
    }
    if (!account.user) {
      guest.hidden = false;
      return;
    }
    status.textContent = "Loading stock alerts…";
    try {
      const value = await createAccountClient(account.user.id).getBinderStockAlerts();
      if (ticket !== generation) return;
      show(value);
      status.textContent = "";
    } catch {
      if (ticket !== generation) return;
      status.textContent = "Couldn’t load stock alerts.";
      retry.hidden = false;
    }
  }

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden && !settings) void load();
  });
  retry.addEventListener("click", async () => {
    if (account?.enabled && !account.offline) {
      void load();
      return;
    }
    const ticket = generation;
    retry.hidden = true;
    status.textContent = "Checking account status…";
    try {
      await reconnect();
    } catch {
      // load() renders the current unavailable state with a retry action.
    }
    if (ticket === generation) void load();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!account?.user || !settings || save.disabled) return;
    const ticket = generation;
    const alerts = rows.filter(row => row.enabled.checked).map(row => ({ store: row.store, minimum: row.minimum.valueAsNumber }));
    fields.disabled = save.disabled = true;
    pendingSaves++;
    status.textContent = "Saving stock alerts…";
    try {
      const value = await createAccountClient(account.user.id).saveBinderStockAlerts(settings.revision, alerts);
      if (ticket !== generation) return;
      show(value);
      status.textContent = "Stock alerts saved.";
    } catch (error) {
      if (ticket !== generation) return;
      if (error instanceof AccountApiError && error.code === "alerts_changed") {
        await load();
        if (ticket + 1 === generation && settings) status.textContent = "Alerts changed on another device. Review the latest settings and try again.";
      } else {
        status.textContent = "Couldn’t save stock alerts. Try again.";
      }
    } finally {
      pendingSaves--;
      if (ticket === generation) fields.disabled = save.disabled = false;
    }
  });

  return {
    updateBlocker() {
      if (pendingSaves) return "Wait for stock alerts to finish saving before updating.";
      if (!active || !settings || form.hidden) return null;
      const saved = settings.alerts;
      const changed = rows.some((row) => {
        const alert = saved.find((item) => item.store === row.store);
        return row.enabled.checked !== Boolean(alert) || (alert && row.minimum.valueAsNumber !== alert.minimum);
      });
      return changed ? "Save your stock alert changes before updating." : null;
    },
    enter() {
      active = true;
      if (new URLSearchParams(location.search).get("alerts") === "1") {
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
      }
      void load();
    },
    leave() { active = false; generation++; },
    account(value: BinderAccountState) {
      const changed = !account || account.user?.id !== value.user?.id || account.enabled !== value.enabled || account.offline !== value.offline;
      account = value;
      if (changed) void load();
    },
  };
}
