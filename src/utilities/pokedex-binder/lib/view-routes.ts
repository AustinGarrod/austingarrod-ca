export const buyCardsSlug = "buy-cards";
export const settingsSlug = "settings";

const bindersPath = "/utilities/pokemon-binder/";
export const binderViewPaths = {
  binders: bindersPath,
  "buy-cards": `${bindersPath}${buyCardsSlug}/`,
  settings: `${bindersPath}${settingsSlug}/`,
} as const;

export type BinderView = keyof typeof binderViewPaths;

function directoryPath(pathname: string) {
  const path = pathname.replace(/\/index\.html$/, "/");
  return path.endsWith("/") ? path : path + "/";
}

export function legacyBinderView(url: URL) {
  if (directoryPath(url.pathname) !== binderViewPaths.binders) return;
  const view = url.searchParams.get("view");
  return view === buyCardsSlug || view === settingsSlug ? view : undefined;
}

export function binderViewForUrl(url: URL): BinderView {
  const path = directoryPath(url.pathname);
  if (path === binderViewPaths.settings) return "settings";
  if (path === binderViewPaths["buy-cards"]) return "buy-cards";
  return legacyBinderView(url) ?? "binders";
}
