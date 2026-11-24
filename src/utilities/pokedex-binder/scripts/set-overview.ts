export type OverviewProgress =
  | { status: "ready"; owned: number; ordered: number; required: number }
  | { status: "loading" | "error" };

export interface OverviewBinder {
  id: string;
  name: string;
  setName: string;
  code?: string | null;
  symbol?: string;
  goal: "numbers" | "variants";
  progress: OverviewProgress;
}

const counts = new Intl.NumberFormat("en-CA");
const percentages = new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 });

function showProgress(container: HTMLElement, progress: OverviewProgress) {
  const ready = progress.status === "ready";
  container.querySelector<HTMLElement>(".set-overview-counts")!.hidden = !ready;
  container.querySelector<HTMLElement>(".set-overview-completion")!.hidden = !ready;
  if (!ready) return;
  const { owned, ordered, required } = progress;
  container.querySelector("[data-owned-count]")!.textContent = counts.format(owned);
  container.querySelector("[data-ordered-count]")!.textContent = counts.format(ordered);
  container.querySelector("[data-needed-count]")!.textContent = counts.format(required - owned - ordered);
  container.querySelector("[data-required-count]")!.textContent = counts.format(required);
  container.querySelector("[data-percent]")!.textContent = percentages.format(required ? owned / required : 0);
  const bar = container.querySelector("progress")!;
  bar.max = required || 1;
  bar.value = owned;
  bar.setAttribute("aria-valuetext", `${counts.format(owned)} of ${counts.format(required)} required cards owned`);
}

function overallProgress(rows: readonly OverviewBinder[]): OverviewProgress {
  let owned = 0;
  let ordered = 0;
  let required = 0;
  let loading = false;
  for (const { progress } of rows) {
    if (progress.status === "error") return { status: "error" };
    if (progress.status === "ready") {
      owned += progress.owned;
      ordered += progress.ordered;
      required += progress.required;
    } else loading = true;
  }
  return loading ? { status: "loading" } : { status: "ready", owned, ordered, required };
}

export function renderSetOverview(rows: readonly OverviewBinder[]) {
  const totals = document.getElementById("set-overview-totals")!;
  totals.hidden = !rows.length;
  document.getElementById("set-overview-empty")!.hidden = !!rows.length;
  document.getElementById("set-overview-binder-count")!.textContent =
    `${counts.format(rows.length)} ${rows.length === 1 ? "set binder" : "set binders"}`;
  const total = overallProgress(rows);
  showProgress(totals, total);

  const feedback = totals.querySelector<HTMLElement>(".set-overview-feedback")!;
  const status = document.getElementById("set-overview-status")!;
  const message = total.status === "error" ? "Overall progress is unavailable until every set checklist loads."
    : total.status === "loading" ? "Loading set checklists for overall progress…" : "";
  if (status.textContent !== message) status.textContent = message;
  feedback.hidden = !message;
  document.getElementById("set-overview-retry")!.hidden = total.status !== "error";

  const list = document.getElementById("set-overview-list")!;
  const template = document.getElementById("set-overview-card") as HTMLTemplateElement;
  const existing = new Map(Array.from(list.querySelectorAll<HTMLElement>("article"), card => [card.dataset.binderId!, card]));
  rows.forEach((row, index) => {
    const card = existing.get(row.id) ?? (template.content.firstElementChild!.cloneNode(true) as HTMLElement);
    existing.delete(row.id);
    card.dataset.binderId = row.id;
    card.querySelector("h3")!.textContent = row.name;
    card.querySelector(".set-overview-goal")!.textContent =
      row.goal === "numbers" ? "One per card number" : "Every selected finish";
    const set = card.querySelector<HTMLElement>("[data-set-name]")!;
    set.textContent = row.setName;
    set.hidden = row.setName === row.name;
    const code = card.querySelector<HTMLElement>("[data-set-code]")!;
    code.textContent = row.code ?? "";
    code.hidden = !row.code;
    card.querySelector<HTMLElement>(".set-overview-set")!.hidden = set.hidden && code.hidden;
    const symbol = card.querySelector<HTMLImageElement>(".set-overview-symbol")!;
    if (symbol.getAttribute("src") !== (row.symbol ?? null)) {
      symbol.hidden = !row.symbol;
      if (row.symbol) {
        symbol.onerror = () => { symbol.hidden = true; };
        symbol.src = row.symbol;
      } else symbol.removeAttribute("src");
    }
    const open = card.querySelector<HTMLButtonElement>("[data-overview-binder]")!;
    open.dataset.overviewBinder = row.id;
    open.setAttribute("aria-label", "Open binder " + row.name);
    card.querySelector("progress")!.setAttribute("aria-label", row.name + " completion");
    showProgress(card, row.progress);
    const cardStatus = card.querySelector<HTMLElement>(".set-overview-card-status")!;
    cardStatus.hidden = row.progress.status === "ready";
    cardStatus.textContent = row.progress.status === "error" ? "Set checklist could not load."
      : row.progress.status === "loading" ? "Loading set checklist…" : "";
    if (list.children[index] !== card) list.insertBefore(card, list.children[index] ?? null);
  });
  for (const removed of existing.values()) removed.remove();
}
