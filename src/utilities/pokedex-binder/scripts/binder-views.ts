import { binderViewForUrl, binderViewPaths, isLegacyBuyCardsUrl, type BinderView } from "../lib/view-routes";

type ViewListener = (view: BinderView, fromBinders: boolean) => void;

function viewFromHistory(): BinderView {
  const url = new URL(location.href);
  if (isLegacyBuyCardsUrl(url)) {
    url.pathname = binderViewPaths["buy-cards"];
    url.searchParams.delete("view");
    history.replaceState(history.state, "", url);
  }
  return binderViewForUrl(url);
}

export function binderViews() {
  // The page has one h1. It moves to the open view's header, and data-view shows its part for that
  // view: in Binders the home title or the open binder's name (kept by master-ui), else "Buy cards".
  const heading = document.getElementById("binder-view-title")!;
  const views = {
    binders: {
      workspace: document.getElementById("binders-workspace")!,
      header: document.querySelector<HTMLElement>("#binder-bar .dex-appbar-title")!,
      link: document.getElementById("binders-open")!,
    },
    "buy-cards": {
      workspace: document.getElementById("buy-cards-workspace")!,
      header: document.getElementById("buy-cards-heading")!,
      link: document.getElementById("buy-cards-open")!,
    },
  };
  const positions = new Map<BinderView, { scroll: number; focus?: HTMLElement }>();
  const binderTitle = document.getElementById("dex-app")!.dataset.bindersTitle!;
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')!;
  const openGraphUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]')!;
  const shareTitles = document.head.querySelectorAll<HTMLMetaElement>('meta[property="og:title"], meta[name="twitter:title"]');
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
    canonical.href = new URL(binderViewPaths[view], canonical.href).href;
    openGraphUrl.content = canonical.href;
    for (const title of shareTitles) title.content = document.title;
    heading.dataset.view = view;
    if (heading.parentElement !== views[view].header) {
      // In Binders the h1 follows the set label; in Buy cards it leads the header.
      if (view === "binders") document.getElementById("master-set-label")!.after(heading);
      else views[view].header.prepend(heading);
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
  show(viewFromHistory());
  window.addEventListener("popstate", () => show(viewFromHistory()));
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
