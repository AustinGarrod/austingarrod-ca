import { createAccountClient } from "../../../../packages/accounts/client";
import {
  emptyMaster,
  sameSave,
  markSlot,
  newBinder,
  setCsv,
  setSlots,
  validateMaster,
  type MasterState,
  type SetBinder,
  type SetCard,
  type SetSummary,
} from "../lib/master";
import type { BinderAccountState } from "../lib/accounts";
import type { MasterStore } from "../lib/master-store";
import { validateSettings } from "../lib/model";

const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => node<HTMLInputElement>(id);
const select = (id: string) => node<HTMLSelectElement>(id);
const dialog = (id: string) => node<HTMLDialogElement>(id);
const base = "/utilities/pokedex-binder/catalog/master-sets/";
async function json<T>(file: string): Promise<T> {
  const response = await fetch(base + encodeURIComponent(file) + ".json");
  if (!response.ok) throw new Error("Set catalog could not load. Try again.");
  return response.json();
}
export function createMasterUI(store: MasterStore, download: (text: string, name: string, type: string) => void) {
  let scope = "guest",
    online = false,
    state = emptyMaster(),
    id = "",
    page = 1,
    editing: string | null = null,
    renderVersion = 0,
    started = false;
  let dexProgress = "",
    accountVersion = 0;
  let sets: SetSummary[] = [];
  const cache = new Map<string, SetCard[]>(),
    pending = new Map<string, Promise<SetCard[]>>();
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pokedex-set-binders") : null;
  const active = () => state.binders.find((b) => b.id === id);
  const label = (s: SetSummary) => s.name + " · " + (s.code || s.id) + " (" + s.id + ")";
  function chosenSet() {
    const query = input("master-set").value.trim().toLowerCase();
    if (!query) return;
    const exact = sets.find((s) => label(s).toLowerCase() === query || s.id.toLowerCase() === query);
    if (exact) return exact;
    const matches = sets.filter((s) => s.name.toLowerCase() === query || s.code.toLowerCase() === query);
    return matches.length === 1 ? matches[0] : undefined;
  }
  const report = (error: unknown) => {
    node("master-message").textContent = error instanceof Error ? error.message : "Set binder action failed.";
  };
  const listen = (name: string, event: string, fn: () => unknown) =>
    node(name).addEventListener(event, () => {
      Promise.resolve().then(fn).catch(report);
    });
  function cards(setId: string) {
    if (cache.has(setId)) return Promise.resolve(cache.get(setId)!);
    if (!pending.has(setId))
      pending.set(
        setId,
        json<SetCard[]>(setId)
          .then((items) => {
            cache.set(setId, items);
            return items;
          })
          .finally(() => pending.delete(setId)),
      );
    return pending.get(setId)!;
  }
  let timer: ReturnType<typeof setTimeout>;
  function schedule(delay = 350) {
    clearTimeout(timer);
    if (online) timer = setTimeout(() => void sync().catch(report), delay);
  }
  async function sync() {
    const target = scope,
      version = accountVersion;
    if (!online || scope === "guest") return;
    const current = () => target === scope && version === accountVersion && online;
    await store.sync(target, createAccountClient(target), current);
    if (!current()) return;
    await refresh();
    const saved = await store.read(target);
    if (current() && !saved.conflict && !sameSave(saved.state, saved.baseline)) schedule();
    channel?.postMessage(target);
  }
  let pendingEdits = 0;
  function waitForLocalSave(event: BeforeUnloadEvent) {
    event.preventDefault();
    event.returnValue = true;
  }
  async function change(fn: (doc: MasterState) => void) {
    const target = scope;
    if (++pendingEdits === 1) window.addEventListener("beforeunload", waitForLocalSave);
    try {
      await store.update(target, (save) => fn(save.state));
    } finally {
      if (--pendingEdits === 0) window.removeEventListener("beforeunload", waitForLocalSave);
    }
    if (target === scope) {
      await refresh();
      schedule();
    }
    channel?.postMessage(target);
  }
  function edit(fn: (b: SetBinder) => void) {
    const binderId = id;
    return change((doc) => {
      const b = doc.binders.find((b) => b.id === binderId);
      if (!b) throw new Error("Reopen the set binder.");
      fn(b);
    });
  }
  async function refresh() {
    const ticket = ++renderVersion,
      target = scope,
      save = await store.read(target);
    if (ticket !== renderVersion || target !== scope) return;
    state = save.state;
    node("master-conflict").hidden = !save.conflict;
    node("master-message").textContent =
      target === "guest"
        ? ""
        : !online || save.flight || !sameSave(save.state, save.baseline)
          ? "Set binders saved on this device · Waiting to sync"
          : "Set binders synced";
    if (save.conflict)
      node("master-message").textContent = "Two devices changed the same binder. Review the copies by keeping both.";
    if (!active()) id = "";
    await render();
  }
  function progress(b: SetBinder) {
    const all = setSlots(b, cache.get(b.setId) ?? []),
      required = all.filter((s) => s.required);
    return { all, required, owned: required.filter((s) => s.owned).length };
  }
  async function render() {
    const ticket = ++renderVersion;
    const chooser = select("master-switch");
    const options = state.binders.map((b) => {
      const option = new Option(b.name, b.id);
      const update = () => {
        if (ticket === renderVersion) {
          const p = progress(b);
          option.text = b.name + " · " + p.owned + "/" + p.required.length;
        }
      };
      if (cache.has(b.setId)) update();
      else
        void cards(b.setId)
          .then(update)
          .catch(() => {});
      return option;
    });
    chooser.replaceChildren(new Option("National Pokédex" + dexProgress, ""), ...options);
    chooser.value = id;
    const b = active();
    node("national-workspace").hidden = !!b;
    node("master-workspace").hidden = !b;
    node("layout-open").hidden = !!b;
    node("scan-open").hidden = !!b;
    if (!b) return;
    if (!cache.has(b.setId)) {
      node("master-title").textContent = b.name;
      node("master-slots").replaceChildren();
      node("master-workspace").hidden = true;
      try {
        await cards(b.setId);
      } catch {
        if (ticket === renderVersion) {
          node("master-message").textContent = "Checklist could not load. Choose the binder again to retry.";
          chooser.value = "";
        }
        return;
      }
      if (ticket !== renderVersion) return;
      node("master-workspace").hidden = false;
    }
    const { all, required, owned } = progress(b),
      extras = all.filter((s) => !s.required);
    node("master-title").textContent = b.name + " · " + (sets.find((s) => s.id === b.setId)?.name ?? b.setId);
    node("master-progress").textContent = owned + " / " + required.length;
    node("master-optional").textContent = extras.filter((s) => s.owned).length + " / " + extras.length;
    node("master-percent").textContent =
      (required.length ? ((100 * owned) / required.length).toFixed(1) : "0") + "% complete";
    const bar = node<HTMLProgressElement>("master-bar");
    bar.max = required.length || 1;
    bar.value = owned;
    const missingFinishes =
      b.goal === "variants" ? b.owned.filter((k) => k.endsWith(":*") && !all.some((s) => s.key === k)) : [];
    if (missingFinishes.length)
      node("master-message").textContent =
        "Choose the finish for " +
        missingFinishes.map((k) => "#" + k.slice(0, -2)).join(", ") +
        ". Your earlier number marks are saved.";
    const search = input("master-search").value.trim().toLowerCase().replace(/^#/, ""),
      status = select("master-status").value;
    const pages = select("master-view").value === "pages" && !search && status === "all";
    const count = Math.max(1, all.at(-1)?.page ?? 1);
    page = Math.min(count, Math.max(1, page));
    node("master-paging").hidden = !pages;
    select("master-page").replaceChildren(
      ...Array.from({ length: count }, (_, i) => new Option(String(i + 1), String(i + 1))),
    );
    select("master-page").value = String(page);
    node("master-page-name").textContent =
      "Page " +
      page +
      " · Sheet " +
      (b.settings.useBackSides ? Math.ceil(page / 2) : page) +
      " · " +
      (b.settings.useBackSides && page % 2 === 0 ? "Back" : "Front");
    const grid = node("master-slots");
    grid.className = pages ? "master-pages" : "master-list";
    grid.style.setProperty("--master-columns", String(b.settings.columns));
    const fragment = document.createDocumentFragment();
    const visible = all.filter(
      (s) =>
        (!pages || s.page === page) &&
        (status === "all" || (status === "owned") === s.owned) &&
        (!search || [s.name, s.number, s.finish].some((x) => x.toLowerCase().includes(search))),
    );
    const addBlank = () => {
      const blank = document.createElement("div");
      blank.className = "master-blank";
      blank.setAttribute("aria-label", "Empty pocket");
      fragment.append(blank);
    };
    if (pages) for (let i = 1; i < (visible[0]?.pocket ?? 1); i++) addBlank();
    for (const slot of visible) {
      const row = document.createElement("label");
      row.className = "master-row";
      const control = document.createElement("input");
      control.type = "checkbox";
      control.dataset.key = slot.key;
      control.checked = slot.owned;
      const info = document.createElement("span");
      info.textContent = (slot.number ? "#" + slot.number + " " : "") + slot.name;
      const details = document.createElement("small");
      const place = "Page " + slot.page + ", " + slot.side + ", row " + slot.row + ", column " + slot.column;
      details.textContent = slot.finish + (slot.required ? "" : " · Optional") + (pages ? "" : " · " + place);
      control.setAttribute("aria-label", [slot.name, slot.number, slot.finish, place].join(", "));
      info.append(details);
      row.append(control, info);
      fragment.append(row);
    }
    if (pages) while (fragment.childElementCount < b.settings.rows * b.settings.columns) addBlank();
    if (!pages && !visible.length) fragment.append(document.createTextNode("No matching cards."));
    grid.replaceChildren(fragment);
  }
  async function specialties() {
    const set = chosenSet(),
      region = node("master-specialties");
    region.replaceChildren();
    if (!set) return;
    const all = await cards(set.id);
    if (chosenSet()?.id !== set.id) return;
    const selected = new Set(state.binders.find((b) => b.id === editing)?.specialties);
    const variants = new Map<string, { label: string; cards: SetCard[] }>();
    for (const c of all)
      for (const v of c.variants) {
        if (!v.specialty) continue;
        const group = variants.get(v.id) ?? { label: v.label, cards: [] };
        group.cards.push(c);
        variants.set(v.id, group);
      }
    for (const [key, group] of variants) {
      const section = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = group.label + " (" + group.cards.length + ")";
      section.append(summary);
      const add = (value: string, text: string, checked: boolean) => {
        const row = document.createElement("label"),
          box = document.createElement("input");
        box.type = "checkbox";
        box.value = value;
        box.checked = checked;
        row.append(box, document.createTextNode(text));
        section.append(row);
        return box;
      };
      const bulk = add(key, "All cards with this printing", selected.has(key));
      const children = group.cards.map((c) =>
        add(
          c.number + ":" + key,
          "#" + c.number + " " + c.name,
          selected.has(key) || selected.has(c.number + ":" + key),
        ),
      );
      bulk.onchange = () => {
        for (const child of children) child.checked = bulk.checked;
      };
      const update = () => {
        bulk.checked = children.every((box) => box.checked);
        bulk.indeterminate = !bulk.checked && children.some((box) => box.checked);
      };
      for (const child of children) child.onchange = update;
      update();
      region.append(section);
    }
    if (!variants.size) region.textContent = "No specialty printings are documented for this set.";
  }
  async function openEditor(b?: SetBinder) {
    if (!sets.length) sets = await json("index");
    const options = sets.map((s) => new Option(label(s)));
    node("master-catalog").replaceChildren(...options);
    editing = b?.id ?? null;
    const model = b ?? newBinder("", "");
    node("master-editor-title").textContent = b ? "Binder settings" : "New set binder";
    const set = sets.find((s) => s.id === b?.setId);
    input("master-set").value = set ? label(set) : "";
    input("master-set").disabled = !!b;
    input("master-name").value = model.name;
    select("master-goal").value = model.goal;
    select("master-order").value = model.order;
    input("master-columns").value = String(model.settings.columns);
    input("master-rows").value = String(model.settings.rows);
    input("master-blanks").value = String(model.settings.leadingBlankPockets);
    input("master-backs").checked = model.settings.useBackSides;
    node("master-specialty-section").hidden = model.goal === "numbers";
    node("master-extra-options").hidden = !model.extras.length;
    const extras = node("master-extra-options-list");
    extras.replaceChildren();
    for (const e of model.extras) {
      const label = document.createElement("label"),
        box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.extra = e.id;
      box.checked = e.required;
      label.append(box, document.createTextNode("Count " + e.name + " toward completion"));
      extras.append(label);
    }
    node("master-form-error").textContent = "";
    await specialties();
    dialog("master-editor").showModal();
  }
  async function saveForm() {
    const set = chosenSet();
    if (!set) throw new Error("Choose a set from the catalog list.");
    const binderId = editing ?? crypto.randomUUID(),
      name = input("master-name").value.trim();
    const settings = validateSettings({
      columns: +input("master-columns").value,
      rows: +input("master-rows").value,
      leadingBlankPockets: +input("master-blanks").value,
      useBackSides: input("master-backs").checked,
    });
    const spec = Array.from(node("master-specialties").querySelectorAll("details")).flatMap((group) => {
      const [bulk, ...individual] = group.querySelectorAll<HTMLInputElement>("input");
      return bulk.checked ? [bulk.value] : individual.filter((box) => box.checked).map((box) => box.value);
    });
    const goal = select("master-goal").value as SetBinder["goal"],
      order = select("master-order").value as SetBinder["order"];
    await change((doc) => {
      let b = doc.binders.find((v) => v.id === binderId);
      if (!b) {
        b = { ...newBinder(set.id, name), id: binderId };
        doc.binders.push(b);
      }
      Object.assign(b, { name, settings, goal, order, specialties: spec });
      for (const box of node("master-extra-options-list").querySelectorAll<HTMLInputElement>("input")) {
        const e = b.extras.find((e) => e.id === box.dataset.extra);
        if (e) e.required = box.checked;
      }
    });
    id = binderId;
    page = 1;
    input("master-search").value = "";
    select("master-status").value = "all";
    await render();
    dialog("master-editor").close();
  }
  node("master-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveForm().catch((e) => {
      node("master-form-error").textContent = e.message;
    });
  });
  listen("master-new", "click", () => openEditor());
  listen("master-settings", "click", () => openEditor(active()));
  listen("master-set", "input", specialties);
  listen("master-goal", "change", () => {
    node("master-specialty-section").hidden = select("master-goal").value === "numbers";
  });
  listen("master-switch", "change", () => {
    id = select("master-switch").value;
    page = 1;
    input("master-search").value = "";
    select("master-status").value = "all";
    node("master-message").textContent = "";
    return render();
  });
  for (const [name, event] of [
    ["master-search", "input"],
    ["master-status", "change"],
    ["master-view", "change"],
  ])
    listen(name, event, render);
  listen("master-page", "change", () => {
    page = +select("master-page").value;
    return render();
  });
  node("master-slots").addEventListener("change", (event) => {
    const box = event.target as HTMLInputElement;
    const key = box.dataset.key;
    if (!key) return;
    const checked = box.checked;
    void edit((b) => markSlot(b, key, checked)).catch((e) => {
      box.checked = !checked;
      report(e);
    });
  });
  listen("master-add-extra", "click", () => {
    node<HTMLFormElement>("master-extra-form").reset();
    dialog("master-extra-dialog").showModal();
  });
  node("master-extra-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void edit((b) =>
      b.extras.push({
        id: crypto.randomUUID(),
        name: input("master-extra-name").value.trim(),
        number: input("master-extra-number").value.trim(),
        required: input("master-extra-required").checked,
      }),
    )
      .then(() => dialog("master-extra-dialog").close())
      .catch(report);
  });
  listen("master-csv", "click", () => {
    const b = active()!;
    download(setCsv(progress(b).all), b.name + "-missing.csv", "text/csv;charset=utf-8");
  });
  listen("master-print", "click", () => {
    const b = active()!,
      out = node("print-content"),
      title = document.createElement("h1");
    title.textContent = b.name + " · Missing cards";
    out.replaceChildren(title);
    for (const s of progress(b).all.filter((s) => !s.owned)) {
      const p = document.createElement("p");
      p.textContent = [
        s.number,
        s.name,
        s.finish,
        s.required ? "Required" : "Optional",
        "Page " + s.page,
        s.side,
        "Row " + s.row,
        "Column " + s.column,
      ].join(" · ");
      out.append(p);
    }
    window.print();
  });
  listen("master-conflict", "click", async () => {
    await store.resolve(scope);
    await refresh();
    schedule();
  });
  let scanner: Awaited<ReturnType<(typeof import("./master-scanner"))["createSetScanner"]>> | undefined;
  listen("master-scan", "click", async () => {
    scanner ??= (await import("./master-scanner")).createSetScanner();
    const b = active()!,
      target = scope;
    scanner.open(progress(b).all, (key) => {
      if (id !== b.id || target !== scope) throw new Error("Reopen the scanner for this binder.");
      return edit((current) => {
        if (!setSlots(current, cache.get(current.setId) ?? []).some((s) => s.key === key))
          throw new Error("The binder settings changed. Choose the printing again.");
        markSlot(current, key, true);
      });
    });
  });
  channel?.addEventListener("message", (e) => {
    if (e.data === scope) void refresh().catch(report);
  });
  window.addEventListener("online", () => schedule(0));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule(0);
  });
  return {
    async start() {
      sets = await json("index");
      started = true;
      await refresh();
      schedule(0);
    },
    account(a: BinderAccountState) {
      const next = a.mode === "account" ? (a.boundAccountId ?? "guest") : "guest";
      const available = next !== "guest" && a.user?.id === next && !a.offline && !a.retainedAccount;
      if (scope === next && online === available) return;
      accountVersion++;
      if (scope !== next) {
        scope = next;
        id = "";
        state = emptyMaster();
        scanner?.close();
        for (const name of ["master-editor", "master-extra-dialog"]) dialog(name).close();
        void render().catch(report);
      }
      online = available;
      if (started)
        void refresh()
          .then(() => schedule(0))
          .catch(report);
    },
    dex(owned: number, total: number) {
      dexProgress = " · " + owned + "/" + total;
      const option = select("master-switch").options[0];
      if (option) option.text = "National Pokédex" + dexProgress;
    },
    async backup() {
      return (await store.read(scope)).state;
    },
    async checkBackup(next: MasterState) {
      validateMaster(next);
      const index = sets.length ? sets : await json<SetSummary[]>("index");
      for (const b of next.binders) {
        if (!index.some((s) => s.id === b.setId))
          throw new Error("This backup references a set outside the installed catalog.");
        const entries = await cards(b.setId),
          keys = new Set(b.extras.map((e) => "extra:" + e.id)),
          special = new Set<string>();
        for (const c of entries) {
          keys.add(c.number + ":*");
          for (const v of c.variants) {
            keys.add(c.number + ":" + v.id);
            if (v.specialty) {
              special.add(v.id);
              special.add(c.number + ":" + v.id);
            }
          }
        }
        if (b.owned.some((k) => !keys.has(k)) || b.specialties.some((k) => !special.has(k)))
          throw new Error("This backup contains a printing outside the installed checklist.");
      }
    },
    async restored() {
      await refresh();
      schedule();
      channel?.postMessage(scope);
    },
    sync,
    close() {
      clearTimeout(timer);
      online = false;
      channel?.close();
      scanner?.close();
    },
  };
}
