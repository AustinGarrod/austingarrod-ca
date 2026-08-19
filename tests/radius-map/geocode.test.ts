import { describe, expect, it, vi } from "vitest";
import { handleGeocodeRequest, normalizeNominatimResults } from "../../src/utilities/radius-map/lib/geocode";

describe("Nominatim normalization", () => {
  it("returns only valid results and caps the list at five", () => {
    const rows = [
      { place_id: 1, display_name: "Toronto, Ontario, Canada", lat: "43.6532", lon: "-79.3832" },
      { place_id: 2, display_name: "Invalid", lat: "not-a-number", lon: "0" },
      ...Array.from({ length: 6 }, (_, index) => ({
        place_id: index + 3,
        display_name: `Place ${index + 1}`,
        lat: String(index),
        lon: String(index),
      })),
    ];

    const results = normalizeNominatimResults(rows);
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({
      id: "1",
      label: "Toronto, Ontario, Canada",
      lat: 43.6532,
      lng: -79.3832,
    });
  });
});

describe("geocode request handler", () => {
  it("validates the submitted query", async () => {
    const response = await handleGeocodeRequest(new Request("https://radius.example/api/geocode?q=a"), {});
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/between 2 and 200/i) });
  });

  it("normalizes successful upstream responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([{ place_id: 44, display_name: "Ottawa, Ontario, Canada", lat: "45.4201", lon: "-75.7003" }]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await handleGeocodeRequest(
      new Request("https://radius.example/api/geocode?q=Ottawa", { headers: { "accept-language": "en-CA" } }),
      {},
      { fetchImpl, sleep: async () => undefined, now: () => 10_000 },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
    await expect(response.json()).resolves.toEqual({
      results: [{ id: "44", label: "Ottawa, Ontario, Canada", lat: 45.4201, lng: -75.7003 }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps upstream throttling to a helpful response", async () => {
    const response = await handleGeocodeRequest(
      new Request("https://radius.example/api/geocode?q=Montreal"),
      {},
      {
        fetchImpl: async () => new Response(null, { status: 429, headers: { "retry-after": "2" } }),
        sleep: async () => undefined,
        now: () => 20_000,
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/busy/i) });
  });
});
