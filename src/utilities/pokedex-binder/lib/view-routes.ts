export const buyCardsSlug = "buy-cards";

const bindersPath = "/utilities/pokemon-binder/";
export const binderViewPaths = {
  binders: bindersPath,
  "buy-cards": `${bindersPath}${buyCardsSlug}/`,
} as const;

export type BinderView = keyof typeof binderViewPaths;

function directoryPath(pathname: string) {
  const path = pathname.replace(/\/index\.html$/, "/");
  return path.endsWith("/") ? path : path + "/";
}

export function isLegacyBuyCardsUrl(url: URL) {
  return directoryPath(url.pathname) === binderViewPaths.binders
    && url.searchParams.get("view") === buyCardsSlug;
}

export function binderViewForUrl(url: URL): BinderView {
  return directoryPath(url.pathname) === binderViewPaths["buy-cards"] || isLegacyBuyCardsUrl(url)
    ? "buy-cards"
    : "binders";
}
