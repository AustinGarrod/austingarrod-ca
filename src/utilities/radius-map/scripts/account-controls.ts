import { createRadiusAccountLibrary, type RadiusAccountView } from "../lib/account-library";
import { mergeLibraries, type AccountMeasurement, type MeasurementChoice } from "../lib/account-measurements";

function field<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function describe(measurement: AccountMeasurement | undefined): string {
  if (!measurement) return "Deleted";
  const { name, locationLabel, center, value, unit, kind, visible } = measurement;
  return `${name} · ${locationLabel} (${center.lat}, ${center.lng}) · ${value} ${unit} ${kind} · ${visible ? "Shown" : "Hidden"}`;
}

function paragraph(copy: string): HTMLParagraphElement {
  const text = document.createElement("p");
  text.textContent = copy;
  return text;
}

function fieldset(legendText: string): HTMLFieldSetElement {
  const group = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = legendText;
  group.append(legend);
  return group;
}

function radio(group: HTMLFieldSetElement, name: string, value: string, copy: string): void {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.required = true;
  label.append(input, document.createTextNode(copy));
  group.append(label);
}

// An installed copy can briefly have the previous worker controlling the new
// page during rollout. Only start account requests once that worker is gone.
function startAfterCacheUpgrade(start: () => void, status: HTMLElement): void {
  const workers = navigator.serviceWorker;
  if (!workers?.controller) { start(); return; }
  let started = false;
  function checkController() {
    if (started) return;
    const controller = workers.controller;
    if (!controller) { ready(); return; }
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => channel.port1.close(), 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data === "public-shell-only" && controller === workers.controller) ready();
    };
    controller.postMessage("radius-map-account-cache-policy", [channel.port2]);
  }
  function ready() {
    started = true;
    workers.removeEventListener("controllerchange", checkController);
    window.removeEventListener("focus", checkController);
    start();
  }
  status.textContent = "Updating offline support before connecting an account…";
  workers.addEventListener("controllerchange", checkController);
  window.addEventListener("focus", checkController);
  checkController();
}

export function bindRadiusAccountControls(renderLibrary: (view: RadiusAccountView) => void) {
  const signIn = field<HTMLAnchorElement>("radius-sign-in");
  const signInToSave = field<HTMLAnchorElement>("radius-sign-in-to-save");
  const manage = field<HTMLAnchorElement>("radius-manage-account");
  const reviewButton = field<HTMLButtonElement>("radius-review");
  const syncNow = field<HTMLButtonElement>("radius-sync-now");
  const status = field<HTMLParagraphElement>("radius-sync-status");
  const location = field<HTMLParagraphElement>("radius-library-location");
  const dialog = field<HTMLDialogElement>("radius-review-dialog");
  const form = field<HTMLFormElement>("radius-review-form");
  const choices = field<HTMLDivElement>("radius-review-choices");
  const feedback = field<HTMLParagraphElement>("radius-review-status");
  const apply = field<HTMLButtonElement>("radius-review-apply");
  let view: RadiusAccountView;
  let confirm: ((formData: FormData) => Promise<boolean | undefined>) | null = null;

  const library = createRadiusAccountLibrary(next => {
    if (view && next.signedInId !== view.signedInId) dialog.close();
    view = next;
    // The save button stays visible signed out: it explains that saving needs an account.
    signIn.hidden = signInToSave.hidden = !view.canSignIn;
    manage.hidden = !view.signedInId;
    reviewButton.hidden = !(view.canSync && (view.conflict || view.prepared));
    reviewButton.disabled = view.inProgress;
    reviewButton.textContent = view.prepared ? "Finish saved review" : "Review sync changes";
    syncNow.hidden = !view.signedInId;
    syncNow.disabled = !view.canSync || view.inProgress || view.prepared;
    location.textContent = view.signedInId ? "Account library" : "Sign in to save";
    status.textContent = view.status;
    renderLibrary(view);
  });

  async function showReview(): Promise<void> {
    if (view.prepared) { await library.resume(); return; }
    const review = view.conflict;
    if (!review) return;
    const { conflicts } = mergeLibraries(review.base, review.working, review.baseline.state);
    if (!conflicts.length) { await library.sync(); return; }
    choices.replaceChildren(paragraph("Choose which version to keep for each measurement. Independent changes will be combined."));
    conflicts.forEach((conflict, index) => {
      const group = fieldset(conflict.browser?.name ?? conflict.account?.name ?? "Measurement");
      radio(group, `measurement-${index}`, "browser", `This browser · ${describe(conflict.browser)}`);
      radio(group, `measurement-${index}`, "account", `Account · ${describe(conflict.account)}`);
      choices.append(group);
    });
    confirm = data => {
      const selected = new Map<string, MeasurementChoice>();
      conflicts.forEach((conflict, index) => {
        const value = data.get(`measurement-${index}`);
        if (value === "browser" || value === "account") selected.set(conflict.id, value);
      });
      return library.resolve(review, selected);
    };
    feedback.hidden = true;
    dialog.showModal();
  }

  reviewButton.addEventListener("click", () => { void showReview(); });
  syncNow.addEventListener("click", () => { void library.sync(); });
  field("radius-review-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    confirm = null;
    choices.replaceChildren();
    feedback.textContent = "";
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!confirm || apply.disabled) return;
    apply.disabled = true;
    feedback.hidden = true;
    void confirm(new FormData(form)).then(complete => {
      if (!dialog.open) return;
      if (complete || view.prepared) dialog.close();
      else {
        feedback.textContent = view.status;
        feedback.hidden = false;
      }
    }).finally(() => { apply.disabled = false; });
  });
  return { ...library, start: () => startAfterCacheUpgrade(library.start, status) };
}
