import { randomUUID } from "node:crypto";
const steps = JSON.parse(process.env.REPORTING_STEPS || "{}");
const failed = Object.entries(steps).filter(([, value]) => value.outcome === "failure").map(([key]) => key);
const response = await fetch("https://reports.garrod.house/api/8/store/?sentry_version=7&sentry_key=8b561c6564244066bd2960053ed220cd", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    event_id: randomUUID().replaceAll("-", ""), timestamp: Date.now()/1000, platform: "other", level: "error",
    message: `HostPapa deployment failed: ${failed.join(", ") || "workflow setup"}`,
    release: `austingarrod-ca@${process.env.GITHUB_SHA}`, environment: "deployment",
    tags: { service: "github-actions", workflow: process.env.GITHUB_WORKFLOW, ref: process.env.GITHUB_REF, failed_step: failed.join(",") },
    contexts: { deployment: { run_url: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, attempt: process.env.GITHUB_RUN_ATTEMPT, steps } },
  }),
  signal: AbortSignal.timeout(10000),
});
if (!response.ok) throw new Error(`Deployment failure reporting returned ${response.status}`);
console.log("Deployment failure recorded in GlitchTip.");
