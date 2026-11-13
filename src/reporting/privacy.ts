const PRIVATE_TOKEN = /pdx_[A-Za-z0-9_-]{43}/g;
const PRIVATE_FIELDS = new Set(["x-pokedex-key", "authorization", "cookie", "set-cookie"]);
const COLLECTION_FIELDS = new Set(["body", "data", "request_body", "response_body", "ownedDexIds", "settings", "state", "baseline", "key"]);

/** Keep operation/status diagnostics while excluding access keys and collection payloads. */
export function redactReporting<T>(value: T, binderPage = false): T {
  if (typeof value === "string") {
    if (value.includes('"ownedDexIds"') || value.includes('"X-Pokedex-Key"')) return "[private binder data]" as T;
    return value.replace(PRIVATE_TOKEN, "[private sync key]")
      .replace(/(\/utilities\/radius-map\/api\/geocode\.php)\?[^\s"']*/g, "$1")
      .replace(/(\/utilities\/pokedex-binder\/api\/[^?\s"']*)\?[^\s"']*/g, "$1") as T;
  }
  if (Array.isArray(value)) return value.map(item => redactReporting(item, binderPage)) as T;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const privateRequest = binderPage || Object.values(object).some(item => typeof item === "string" && item.includes("/utilities/pokedex-binder/api/"));
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key,
      PRIVATE_FIELDS.has(key.toLowerCase()) || (privateRequest && COLLECTION_FIELDS.has(key)) ? "[private]" : redactReporting(item, privateRequest),
    ])) as T;
  }
  return value;
}
