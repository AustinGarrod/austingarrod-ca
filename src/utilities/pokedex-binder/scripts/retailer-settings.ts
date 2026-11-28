import { enabledRetailers, retailerChoices, type RetailerPreferences, type RetailerSettings } from "../lib/retailer-preferences";

export function retailerSettingsForm(saveChoices: (value: RetailerPreferences) => Promise<void>, syncChoices: () => Promise<void>) {
  const form = document.querySelector<HTMLFormElement>("#retailer-settings-form")!;
  const fields = form.querySelector<HTMLFieldSetElement>("#retailer-settings-controls")!;
  const stores = form.querySelector<HTMLFieldSetElement>("#retailer-settings-stores")!;
  const shops = [...stores.querySelectorAll<HTMLInputElement>('input[name="retailer"]')];
  const modes = [...fields.querySelectorAll<HTMLInputElement>('input[name="retailer-mode"]')];
  const save = form.querySelector<HTMLButtonElement>("#retailer-settings-save")!;
  const copy = form.querySelector<HTMLButtonElement>("#retailer-settings-copy")!;
  const keep = form.querySelector<HTMLButtonElement>("#retailer-settings-keep")!;
  const retry = form.querySelector<HTMLButtonElement>("#retailer-settings-retry")!;
  const status = form.querySelector<HTMLElement>("#retailer-settings-status")!;
  let state: RetailerSettings = { scope: undefined, status: "loading" };
  let edited = false, busy = false;

  function draft() {
    return retailerChoices(modes[1].checked ? "selected" : "all", shops.filter(shop => shop.checked).map(shop => shop.value));
  }

  function refreshControls() {
    fields.disabled = busy || !state.value;
    stores.hidden = stores.disabled = !modes[1].checked;
    save.disabled = fields.disabled;
    save.textContent = state.draft ? "Save my choices" : "Save retailer choices";
    copy.hidden = !state.guest;
    keep.hidden = !state.draft;
    retry.hidden = state.status !== "error" || state.scope === "guest";
    copy.disabled = keep.disabled = retry.disabled = busy;
  }

  async function submit(value?: RetailerPreferences) {
    if (busy || !value) return;
    busy = true;
    refreshControls();
    try {
      await saveChoices(value);
    } finally {
      busy = false;
      refreshControls();
    }
  }

  form.addEventListener("change", () => { edited = true; refreshControls(); });
  form.addEventListener("submit", event => { event.preventDefault(); void submit(draft()); });
  copy.addEventListener("click", () => { edited = false; void submit(state.guest); });
  keep.addEventListener("click", () => { edited = false; void submit(state.value); });
  retry.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    refreshControls();
    try { await syncChoices(); }
    finally { busy = false; refreshControls(); }
  });

  return (next: RetailerSettings) => {
    const value = next.draft ?? next.value;
    if (next.scope !== state.scope || JSON.stringify(value) === JSON.stringify(draft())) edited = false;
    state = next;
    if (!edited && value) {
      for (const mode of modes) mode.checked = mode.value === value.mode;
      const enabled = enabledRetailers(value);
      for (const shop of shops) shop.checked = enabled.some(store => store === shop.value);
    }
    refreshControls();
    status.textContent = next.status === "error"
      ? next.scope === "guest" ? "Couldn’t save retailer choices on this device."
        : next.value ? "Can’t reach synced retailer choices. If you made changes, they’ll sync when the account is available."
        : "Couldn’t load your synced retailer choices."
      : next.status === "conflict" ? "Retailer choices changed on another device. The synced choices are active. Review your draft and choose which to keep."
      : next.status === "pending" ? "Saved on this device · Waiting to sync"
      : next.status === "local" ? "Retailer choices are saved on this device."
      : next.status === "synced" ? "Retailer choices sync with your binder account."
      : "Loading retailer choices…";
  };
}
