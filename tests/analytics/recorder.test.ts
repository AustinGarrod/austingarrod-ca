import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const layout = readFileSync(new URL("../../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
const scripts = [...layout.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

function bootstrap(options: {
  hostname?: string;
  dnt?: string | number;
  legacyDnt?: string | number;
  embedded?: boolean;
  disabled?: string | null;
  storageUnavailable?: boolean;
} = {}) {
  const appended: Array<{ src: string; dataset: Record<string, string> }> = [];
  let onTrackerLoad: (() => void) | undefined;
  const self = {};
  const window = {
    self,
    top: options.embedded ? {} : self,
    location: { hostname: options.hostname ?? "austingarrod.ca" },
    doNotTrack: options.legacyDnt,
    localStorage: {
      getItem: () => {
        if (options.storageUnavailable) throw new Error("Storage unavailable");
        return options.disabled ?? null;
      },
    },
    umamiBeforeSend: undefined as undefined | ((type: string, payload: unknown) => unknown),
  };
  const document = {
    getElementById: () => ({ addEventListener: (_event: string, callback: () => void) => { onTrackerLoad = callback; } }),
    createElement: () => ({ src: "", dataset: {} }),
    head: { appendChild: (script: typeof appended[number]) => appended.push(script) },
  };
  const context = { window, document, navigator: { doNotTrack: options.dnt } };
  scripts.forEach((script) => runInNewContext(script, context));
  return { appended, window, load: () => onTrackerLoad?.() };
}

describe("production recording privacy boundaries", () => {
  it("loads one recorder with the existing website ID only after the tracker loads", () => {
    const app = bootstrap();
    expect(app.appended).toHaveLength(0);
    app.load();
    expect(app.appended).toHaveLength(1);
    expect(app.appended[0].src).toBe("https://analytics.garrod.house/recorder.js");
    expect(app.appended[0].dataset.websiteId).toBe("bad8bf39-f9e4-4e54-865c-f3438804a9b5");
  });

  it.each([
    { hostname: "localhost" },
    { hostname: "preview.austingarrod.ca" },
    { dnt: "1" },
    { dnt: "yes" },
    { legacyDnt: 1 },
    { disabled: "true" },
    { embedded: true },
  ])("does not load the recorder when excluded: %j", (options) => {
    const app = bootstrap(options);
    app.load();
    expect(app.appended).toHaveLength(0);
  });

  it("supports www and storage-restricted browsers", () => {
    const app = bootstrap({ hostname: "www.austingarrod.ca", storageUnavailable: true });
    app.load();
    expect(app.appended).toHaveLength(1);
  });

  it("cancels every tracker payload in embedded previews", () => {
    const app = bootstrap({ embedded: true });
    for (const type of ["event", "performance", "identify"]) {
      expect(app.window.umamiBeforeSend?.(type, { url: "/" })).toBe(false);
    }
    const live = bootstrap();
    const payload = { url: "/" };
    expect(live.window.umamiBeforeSend?.("event", payload)).toBe(payload);
  });
});
