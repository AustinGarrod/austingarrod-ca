type BinderView = "binders" | "buy-cards";
type ViewListener = (view: BinderView, fromBinders: boolean) => void;

function currentView(): BinderView {
  return new URLSearchParams(location.search).get("view") === "buy-cards" ? "buy-cards" : "binders";
}

export function binderViews() {
  // Each view has its own h1. In Binders it is the home title or the open binder's name.
  const visibleHeading = (workspace: HTMLElement) =>
    [...workspace.querySelectorAll<HTMLElement>("h1")].find(heading => heading.getClientRects().length);
  const views = {
    binders: {
      workspace: document.getElementById("binders-workspace")!,
      link: document.getElementById("binders-open")!,
    },
    "buy-cards": {
      workspace: document.getElementById("buy-cards-workspace")!,
      link: document.getElementById("buy-cards-open")!,
    },
  };
  const positions = new Map<BinderView, { scroll: number; focus?: HTMLElement }>();
  const binderTitle = document.title;
  let selected: BinderView | undefined;
  let fromBinders = false;
  let listener: ViewListener | undefined;
  let home: (() => void) | undefined;

  function show(view: BinderView) {
    if (view === selected) return;
    const prior = selected;
    if (prior) {
      const active = document.activeElement;
      const focus = active instanceof HTMLElement && views[prior].workspace.contains(active) ? active : undefined;
      positions.set(prior, { scroll: window.scrollY, focus });
    }
    selected = view;
    fromBinders = prior === "binders";
    document.title = view === "buy-cards" ? "Buy cards | " + binderTitle : binderTitle;
    for (const [id, { workspace, link }] of Object.entries(views)) {
      workspace.hidden = id !== view;
      if (id === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    listener?.(view, fromBinders);
    if (prior) {
      const position = positions.get(view);
      const focus = position?.focus;
      (focus?.isConnected && focus.getClientRects().length ? focus : visibleHeading(views[view].workspace))?.focus({ preventScroll: true });
      window.scrollTo({ top: position?.scroll ?? 0, behavior: "instant" });
    }
  }

  history.scrollRestoration = "manual";
  show(currentView());
  window.addEventListener("popstate", () => show(currentView()));
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-binder-view]");
    const view = link?.dataset.binderView;
    if (!link || (view !== "binders" && view !== "buy-cards")) return;
    event.preventDefault();
    if (view === selected) {
      if (view === "binders") home?.();
      return;
    }
    history.pushState(null, "", link.href);
    show(view);
  });

  return {
    subscribe(callback: ViewListener) {
      listener = callback;
      callback(selected!, fromBinders);
    },
    onHome(callback: () => void) {
      home = callback;
    },
  };
}
