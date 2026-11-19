import type { SetScan } from "./scanner";
import { binderPages, blankPocket, cardPocket, escape } from "./binder-pages";
import { createAccountClient } from "../../../../packages/accounts/client";
import {
  emptyMaster,
  isCardPocket,
  sameSave,
  markSlot,
  newBinder,
  setCsv,
  setPockets,
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
export function createMasterUI(store: MasterStore, download: (text: string, name: string, type: string) => void, openScan: (target: SetScan) => Promise<void>, scannerClose: () => void) {
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
  let selectedKey = "", listView = false;
  const drawPages = binderPages("master-", n => { page = n; selectedKey = ""; void render().catch(report); });
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
    const pockets = setPockets(b, cache.get(b.setId) ?? []),
      all = pockets.filter(isCardPocket),
      required = all.filter((s) => s.required);
    return { pockets, all, required, owned: required.filter((s) => s.owned).length };
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
    node("master-settings").hidden = !b;
    node("master-scan").hidden = !b;
    node<HTMLButtonElement>("master-scan").disabled = !!b && !cache.has(b.setId);
    if (!b) return;
    if (!cache.has(b.setId)) {
      node("master-title").textContent = b.name;
      node("master-binder-grid").replaceChildren();
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
      node<HTMLButtonElement>("master-scan").disabled = false;
    }
    const { pockets, all, required, owned } = progress(b),
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
    node("master-owned").textContent = String(owned);
    node("master-missing").textContent = String(required.length - owned);
    const set = sets.find(s => s.id === b.setId);
    const artwork = (slot: typeof all[number]) => {
      const art = set?.artwork;
      return art && slot.category !== "Extra" && !art.missing.includes(slot.number)
        ? "https://assets.tcgdex.net/en/" + [art.series,b.setId,slot.number].map(encodeURIComponent).join("/") + "/low.webp" : null;
    };
    const search = input("master-search").value.trim().toLowerCase().replace(/^#/, "");
    const status = select("master-status").value;
    const matches = (s: typeof all[number]) => (status === "all" || (status === "owned") === s.owned) &&
      [s.name,s.number,s.finish].some(value => value.toLowerCase().includes(search));
    const filtered = all.filter(matches);
    const count = Math.max(1,pockets.at(-1)?.page ?? 1);
    page = Math.min(count, Math.max(1,page));
    const selected = all.find(s => s.key === selectedKey);
    const place = (s: typeof all[number]) => `Page ${s.page} · Row ${s.row} · Column ${s.column}`;
    const identity = (s: typeof all[number]) => [s.number && "#" + s.number,s.name,s.finish].filter(Boolean).join(" · ");
    const jump = (s: typeof all[number]) => `<button data-set-jump="${escape(s.key)}" aria-label="View page for ${escape(identity(s))}">View page</button>`;
    const image = (s: typeof all[number]) => artwork(s) ? `<img loading="lazy" alt="" src="${escape(artwork(s))}">` : "";
    const results = node("master-results");
    results.hidden = listView || !search;
    results.innerHTML = results.hidden ? "" : `<p class="dex-label">${filtered.length} matches</p><div class="set-results">${filtered.map(s =>
      `<div class="dex-result"><strong>${escape(identity(s))}</strong><small>${place(s)}</small>${jump(s)}</div>`).join("")}</div>`;
    node("master-binder-view").hidden = listView;
    node("master-checklist").hidden = !listView;
    node("master-view-checklist").setAttribute("aria-pressed",String(listView));
    node("master-view-binder").setAttribute("aria-pressed",String(!listView));
    const focused = document.activeElement?.id;
    if (listView) {
      node("master-binder-grid").replaceChildren();
      node("master-list-count").textContent = String(filtered.length) + " cards";
      node("master-list").innerHTML = filtered.map(s => `<div class="dex-checklist-row ${s.owned ? "owned" : ""}">
        <input id="set-list-${escape(s.key)}" data-key="${escape(s.key)}" type="checkbox" ${s.owned ? "checked" : ""} aria-label="Own ${escape(identity(s))}">
        <span class="set-checklist-art">${image(s)}</span><div class="dex-checklist-identity"><span class="dex-label">${escape(s.number)}</span><strong>${escape(s.name)}</strong><small>${escape(s.finish)}${s.required ? "" : " · Optional"}</small></div>
        <div class="dex-checklist-location">${place(s)}</div>${jump(s)}</div>`).join("") || "<p>No matching cards.</p>";
    } else {
      node("master-list").replaceChildren();
      const counts = new Map<number,{total:number;owned:number}>();
      for (const slot of required) {
        const data = counts.get(slot.page) ?? {total:0,owned:0};
        data.total++; if (slot.owned) data.owned++; counts.set(slot.page,data);
      }
      const positions = new Map(pockets.filter(p => p.page === page).map(p => [p.pocket,p]));
      const capacity = b.settings.rows * b.settings.columns;
      const cells = Array.from({length:capacity},(_,i) => {
        const p = positions.get(i+1);
        if (!p) return blankPocket(i+1, (page-1)*capacity+i < b.settings.leadingBlankPockets ? "Reserved" : "Empty pocket");
        if (!isCardPocket(p)) return blankPocket(i+1,"Filler after #" + p.number,true);
        return cardPocket({set:true,id:p.key,number:p.number && "#" + p.number,name:p.name,finish:p.finish + (p.required ? "" : " · Optional"),
          owned:p.owned,selected:p.key === selectedKey,dimmed:!matches(p),row:p.row,column:p.column,image:artwork(p)});
      });
      drawPages(page,count,b.settings,counts,cells);
      const optional = extras.filter(s => s.page === page);
      if (optional.length) node("master-page-progress").append(` · Optional extras ${optional.filter(s=>s.owned).length}/${optional.length}`);
    }
    const detail = node("master-pokemon-details");
    detail.hidden = !selected || listView;
    node("master-binder-view").classList.toggle("has-details", !detail.hidden);
    detail.innerHTML = detail.hidden || !selected ? "" : `<div class="dex-detail-hero">${image(selected)}<div><p class="dex-eyebrow">${escape(set?.code || b.setId)} · ${escape(selected.number)}</p><h2>${escape(selected.name)}</h2><p>${escape(selected.finish)}</p></div></div>
      <div class="dex-detail-body"><div class="dex-location">${[["Page",selected.page],["Row",selected.row],["Column",selected.column]].map(([label,value])=>`<div><span class="dex-label">${label}</span><strong>${value}</strong></div>`).join("")}</div><p>Sheet ${selected.sheet} · ${selected.side}</p>
      <label class="dex-owned-label"><input type="checkbox" id="set-detail-owned" data-detail-key="${escape(selected.key)}" ${selected.owned ? "checked" : ""}> I have this printing</label></div>`;
    if (focused && document.activeElement === document.body) document.getElementById(focused)?.focus({preventScroll:true});
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
  function showFillerCutoff() {
    const enabled = input("master-fillers").checked;
    node("master-filler-options").hidden = !enabled;
    input("master-filler-through").disabled = !enabled;
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
    input("master-fillers").checked = model.settings.fillerThrough !== undefined;
    input("master-filler-through").value = String(model.settings.fillerThrough ?? set?.printedTotal ?? "");
    showFillerCutoff();
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
    const settings: SetBinder["settings"] = validateSettings({
      columns: +input("master-columns").value,
      rows: +input("master-rows").value,
      leadingBlankPockets: +input("master-blanks").value,
      useBackSides: input("master-backs").checked,
    });
    if (input("master-fillers").checked) settings.fillerThrough = input("master-filler-through").valueAsNumber;
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
    selectedKey = ""; listView = false; id = binderId;
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
  listen("master-fillers", "change", showFillerCutoff);
  listen("master-set", "input", () => {
    input("master-filler-through").value = String(chosenSet()?.printedTotal ?? "");
    return specialties();
  });
  listen("master-goal", "change", () => {
    node("master-specialty-section").hidden = select("master-goal").value === "numbers";
  });
  listen("master-switch", "change", () => {
    scannerClose(); selectedKey = ""; listView = false;
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

  ])
    listen(name, event, render);
  listen("master-view-checklist", "click", () => { listView = true; return render(); });
  listen("master-view-binder", "click", () => { listView = false; return render(); });
  node("master-workspace").addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement) event.target.hidden = true;
  },true);
  node("master-workspace").addEventListener("click", async event => {
    const btn = (event.target as Element).closest<HTMLElement>("[data-set-open],[data-set-jump]");
    const b = active(); if (!btn || !b) return;
    const slot = progress(b).all.find(s => s.key === (btn.dataset.setOpen ?? btn.dataset.setJump));
    if (!slot) return;
    page = slot.page; selectedKey = slot.key; listView = false;
    await render();
    if(btn.dataset.setJump) document.getElementById("set-open-grid-"+slot.key)?.focus();
    else if(matchMedia("(max-width: 800px)").matches) {
      const detail = node("master-pokemon-details");
      detail.focus({ preventScroll: true });
      detail.scrollIntoView({ block: "start" });
    }
  });
  node("master-workspace").addEventListener("change", (event) => {
    const box = event.target as HTMLInputElement;
    const key = box.dataset.key ?? box.dataset.detailKey;
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
  listen("master-scan", "click", () => {
    const binderId = id, target = scope;
    const current = () => id === binderId && scope === target ? active() : undefined;
    return openScan({
      slots() { const b = current(); return b ? progress(b).all : []; },
      mark(key) {
        if (!current()) throw new Error("Reopen the scanner for this binder.");
        return edit(b => {
          if (!setSlots(b, cache.get(b.setId) ?? []).some(s => s.key === key)) throw new Error("Printing changed.");
          markSlot(b,key,true);
        });
      },
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
        selectedKey = ""; listView = false; scope = next;
        id = "";
        state = emptyMaster();
        scannerClose();
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
      scannerClose();
    },
  };
}
