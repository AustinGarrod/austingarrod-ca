import { describe, expect, it } from "vitest";
import { redactReporting } from "../../src/reporting/privacy";

describe("binder reporting privacy", () => {
  const key = "pdx_" + "A".repeat(43);
  it("redacts credentials in headers, nested errors, and strings", () => {
    const result = redactReporting({ request: { headers: { "X-Pokedex-Key": key, Cookie: "private-cookie" } }, exception: { values: [{ value: `Request failed ${key}` }] } });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(result.request.headers.Cookie).toBe("[private]");
    expect(result.exception.values[0].value).toContain("[private sync key]");
  });
  it("excludes binder bodies and collection state while retaining status diagnostics", () => {
    const result = redactReporting({ request: { url: "/utilities/pokedex-binder/api/binder.php?bad=private", data: { ownedDexIds: [1, 25] } }, status: 503, operation: "sync", state: { ownedDexIds: [99] } }, true);
    expect(result.request.data).toBe("[private]");
    expect(result.state).toBe("[private]");
    expect(result.request.url).not.toContain("?");
    expect(result.status).toBe(503);
  });
  it("does not expose serialized collection payloads in log text", () => {
    expect(redactReporting(JSON.stringify({ ownedDexIds: [25], settings: { rows: 4 } }))).toBe("[private binder data]");
  });
  it("preserves the existing geocoder query privacy boundary", () => {
    expect(redactReporting({ url: "/utilities/radius-map/api/geocode.php?q=private-place", status: 429 })).toEqual({ url: "/utilities/radius-map/api/geocode.php", status: 429 });
  });
});
