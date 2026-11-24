type BinderView = "binders" | "buy-cards";
type ViewListener = (view: BinderView, fromBinders: boolean) => void;

function currentView(): BinderView {
  return new URLSearchParams(location.search).get("view") === "buy-cards" ? "buy-cards" : "binders";
}

export function binderViews() {
  const heading = document.getElementById("binder-view-title")!;
  const binderHeading = [...heading.childNodes];
  const buyingHeading = document.createTextNode("Buy Cards");
  const views = {
    binders: {
      workspace: document.getElementById("binders-workspace")!,
      header: heading.parentElement!,
      link: document.getElementById("binders-open")!,
    },
    "buy-cards": {
      workspace: document.getElementById("buy-cards-workspace")!,
      header: document.getElementById("buy-cards-heading")!,
      link: document.getElementById("buy-cards-open")!,
    },
  };
  const positions = new Map<BinderView, { scroll: number; focus?: HTMLElement }>();
  const binderTitle = document.title;
  let selected: BinderView | undefined;
  let fromBinders = false;
  let listener: ViewListener | undefined;

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
    document.title = view === "buy-cards" ? "Buy Cards | " + binderTitle : binderTitle;
    if (heading.parentElement !== views[view].header) {
      heading.replaceChildren(...(view === "binders" ? binderHeading : [buyingHeading]));
      views[view].header.prepend(heading);
    }
    for (const [id, { workspace, link }] of Object.entries(views)) {
      workspace.hidden = id !== view;
      if (id === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    listener?.(view, fromBinders);
    if (prior) {
      const position = positions.get(view);
      const focus = position?.focus;
      (focus?.isConnected && focus.getClientRects().length ? focus : heading).focus({ preventScroll: true });
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
    if (view === selected) return;
    history.pushState(null, "", link.href);
    show(view);
  });
  return {
    subscribe(callback: ViewListener) {
      listener = callback;
      callback(selected!, fromBinders);
    },
  };
}
