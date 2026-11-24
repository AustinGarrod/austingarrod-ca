const PRIVATE_TOKEN = /pdx_[A-Za-z0-9_-]{43}/g;
const PRIVATE_FIELDS = new Set(["x-pokedex-key", "authorization", "cookie", "set-cookie", "x-csrf-token", "x-account-id"]);
const COLLECTION_FIELDS = new Set(["body", "data", "request_body", "response_body", "ownedDexIds", "orderedDexIds", "owned", "ordered", "settings", "state", "baseline", "key", "image", "frame", "preview", "ocrText", "rawText", "scanResult", "signature", "email", "code", "csrfToken", "challengeId", "token", "idToken", "accessToken", "refreshToken", "nonce", "accountId", "documents", "snapshots", "snapshot", "user", "measurements", "locationLabel", "center"]);

/** Keep operation/status diagnostics while excluding access keys and collection payloads. */
export function redactReporting<T>(value: T, binderPage = false): T {
  if (typeof value === "string") {
    if (/data:image\//i.test(value) || (binderPage && /blob:/.test(value))) return "[private scanner image]" as T;
    if (value.includes('"ownedDexIds"') || value.includes('"orderedDexIds"') || value.includes('"X-Pokedex-Key"')) return "[private binder data]" as T;
    if (value.includes('"csrfToken"') || value.includes('"challengeId"') || value.includes('"mutationSequence"')) return "[private account data]" as T;
    if (value.includes('"measurements"') || value.includes('"locationLabel"')) return "[private measurement data]" as T;
    return value.replace(PRIVATE_TOKEN, "[private sync key]")
      .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[private email]")
      .replace(/(\/api\/v1\/[^?\s"']*)\?[^\s"']*/g, "$1")
      .replace(/(https?:\/\/tile\.openstreetmap\.org)\/[^\s"']*/g, "$1")
      .replace(/(\/utilities\/radius-map\/api\/geocode\.php)\?[^\s"']*/g, "$1")
      .replace(/(\/utilities\/pokedex-binder\/api\/[^?\s"']*)\?[^\s"']*/g, "$1") as T;
  }
  if (Array.isArray(value)) return value.map(item => redactReporting(item, binderPage)) as T;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const privateRequest = binderPage || Object.values(object).some(item => typeof item === "string" && (item.includes("/utilities/pokedex-binder/api/") || item.includes("/api/v1/")));
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key,
      PRIVATE_FIELDS.has(key.toLowerCase()) || (privateRequest && COLLECTION_FIELDS.has(key)) ? "[private]" : redactReporting(item, privateRequest),
    ])) as T;
  }
  return value;
}
