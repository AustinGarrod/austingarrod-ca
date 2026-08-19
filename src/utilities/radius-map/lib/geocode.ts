export interface GeocodeResult {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface GeocoderEnvironment {
  GEOCODER_BASE_URL?: string;
}

interface NominatimResult {
  place_id?: number | string;
  display_name?: string;
  lat?: string;
  lon?: string;
}

interface RequestDependencies {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

interface CachedSearch {
  expiresAt: number;
  results: GeocodeResult[];
}

const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const MIN_UPSTREAM_INTERVAL_MS = 1_000;

let requestQueue = Promise.resolve();
let lastUpstreamRequestAt = 0;
const responseCache = new Map<string, CachedSearch>();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function normalizeNominatimResults(rows: NominatimResult[]): GeocodeResult[] {
  const results: GeocodeResult[] = [];

  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    const label = row.display_name?.trim();

    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      continue;
    }

    results.push({
      id: String(row.place_id ?? `${lat},${lng}`),
      label,
      lat,
      lng,
    });

    if (results.length === 5) {
      break;
    }
  }

  return results;
}

async function waitForUpstreamSlot(
  sleep: (milliseconds: number) => Promise<void>,
  now: () => number,
): Promise<void> {
  let releaseQueue!: () => void;
  const previousRequest = requestQueue;
  requestQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousRequest;
  try {
    const waitTime = Math.max(0, MIN_UPSTREAM_INTERVAL_MS - (now() - lastUpstreamRequestAt));
    if (waitTime > 0) {
      await sleep(waitTime);
    }
    lastUpstreamRequestAt = now();
  } finally {
    releaseQueue();
  }
}

export async function handleGeocodeRequest(
  request: Request,
  environment: GeocoderEnvironment,
  dependencies: RequestDependencies = {},
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET" } });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");

  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return jsonResponse(
      { error: `Search must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const now = dependencies.now ?? Date.now;
  const cacheKey = query.toLocaleLowerCase("en");
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > now()) {
    return jsonResponse(
      { results: cached.results },
      { headers: { "cache-control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  }
  if (cached) {
    responseCache.delete(cacheKey);
  }

  const providerUrl = new URL(environment.GEOCODER_BASE_URL ?? DEFAULT_GEOCODER_URL);
  providerUrl.searchParams.set("q", query);
  providerUrl.searchParams.set("format", "jsonv2");
  providerUrl.searchParams.set("limit", "5");
  providerUrl.searchParams.set("addressdetails", "0");

  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  await waitForUpstreamSlot(sleep, now);

  try {
    const response = await (dependencies.fetchImpl ?? fetch)(providerUrl, {
      headers: {
        accept: "application/json",
        "accept-language": request.headers.get("accept-language") ?? "en",
        "user-agent": `RadiusMap/1.0 (+${url.origin})`,
      },
    });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      return jsonResponse(
        { error: response.status === 429 ? "Search is busy. Please wait a moment and try again." : "Location search is temporarily unavailable." },
        { status: response.status === 429 ? 429 : 502, headers: retryAfter ? { "retry-after": retryAfter } : undefined },
      );
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return jsonResponse({ error: "Location search returned an unexpected response." }, { status: 502 });
    }

    const normalized = normalizeNominatimResults(payload as NominatimResult[]);
    const result = jsonResponse(
      { results: normalized },
      {
        headers: {
          "cache-control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );

    responseCache.set(cacheKey, { results: normalized, expiresAt: now() + 86_400_000 });
    if (responseCache.size > 100) {
      const oldestKey = responseCache.keys().next().value;
      if (oldestKey) {
        responseCache.delete(oldestKey);
      }
    }

    return result;
  } catch {
    return jsonResponse({ error: "Location search is temporarily unavailable." }, { status: 502 });
  }
}
