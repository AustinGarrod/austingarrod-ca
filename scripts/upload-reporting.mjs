import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
const { release } = JSON.parse(readFileSync("src/reporting/build.json", "utf8"));
if (!process.env.SENTRY_AUTH_TOKEN) throw new Error("SENTRY_AUTH_TOKEN is required before deploying symbolicated reporting.");
const cli = "node_modules/@sentry/cli/bin/sentry-cli";
const env = { ...process.env, SENTRY_URL: "https://reports.garrod.house", SENTRY_ORG: "garrod-house", SENTRY_PROJECT: "austingarrodca" };
delete env.SENTRY_DSN;
execFileSync(process.execPath, [cli, "sourcemaps", "upload", "--release", release, "--url-prefix", "~/_astro", "dist/_astro"], { env, stdio: "inherit", timeout: 120000 });
// Upload must succeed first. Maps stay local until then and never go to FTPS.
for (const name of readdirSync("dist/_astro")) if (name.endsWith(".map")) unlinkSync(join("dist/_astro", name));
