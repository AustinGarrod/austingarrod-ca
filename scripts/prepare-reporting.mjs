import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const revision = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const release = process.env.PUBLIC_REPORTING_RELEASE || `austingarrod-ca@${revision}`;
const environment = process.env.PUBLIC_REPORTING_ENVIRONMENT || "production";
if (!/^[\w.@+/-]+$/.test(release) || !/^[\w-]+$/.test(environment)) throw new Error("Invalid reporting build identity");
// Generated before Astro copies public/; no runtime Node or environment configuration required.
mkdirSync("public/reporting", { recursive: true });
writeFileSync("public/reporting/build.php", `<?php\nreturn ['release' => '${release}', 'environment' => '${environment}'];\n`);
writeFileSync("src/reporting/build.json", JSON.stringify({ release, environment }));
console.log(`Reporting release: ${release} (${environment})`);
