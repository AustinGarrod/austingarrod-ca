import { describe, expect, it } from "vitest";
import { releaseContentHash } from "../../scripts/utility-release-content.mts";

function identity(suffix: string, reporting: string, appCode = "start()", content = "catalog one") {
  const entry = `_astro/entry.${suffix}.js`;
  const shared = `_astro/shared.${suffix}.js`;
  const assets = new Map([
    ["index.html", `<script type="module" src="/${entry}"></script>`],
    [entry, `import './shared.${suffix}.js';${appCode}`],
    [shared, `configure({release:'${reporting}'})`],
    ["catalog.json", content],
  ]);
  return releaseContentHash(assets, assets.keys(), [reporting]);
}

describe("utility release identity", () => {
  it("ignores reporting metadata and the resulting chunk names", () => {
    expect(identity("abc12345", "reporting-a")).toBe(identity("efg67890", "reporting-b"));
  });

  it("versions app code and catalog changes independently of reporting metadata", () => {
    const original = identity("abc12345", "reporting-a");
    expect(identity("efg67890", "reporting-b", "start(42)")).not.toBe(original);
    expect(identity("efg67890", "reporting-b", undefined, "catalog two")).not.toBe(original);
  });
});
