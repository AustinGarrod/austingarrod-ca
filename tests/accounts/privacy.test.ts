import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redactReporting } from "../../src/reporting/privacy";

describe("account privacy boundaries", () => {
  it("removes credentials, email addresses and document bodies from API diagnostics", () => {
    const input = { request: { url: "https://austingarrod.ca/api/v1/auth.php?action=email-verify&code=123456", headers: { "X-CSRF-Token": "csrf-private", "X-Account-ID": "account-private" }, data: { email: "private@example.test", code: "123456", state: { progress: "private-progress" } } } };
    const output = JSON.stringify(redactReporting(input));
    for (const secret of ["123456", "csrf-private", "account-private", "private@example.test", "private-progress"]) expect(output).not.toContain(secret);
    expect(output).toContain("/api/v1/auth.php");
  });
  it("removes email and serialized authentication objects from messages", () => {
    expect(redactReporting("User private@example.test failed")).not.toContain("private@example.test");
    expect(redactReporting('{"challengeId":"private-challenge","code":"123456"}')).toBe("[private account data]");
  });
  it("excludes login and recovery pages from analytics and browser diagnostics", () => {
    const page = readFileSync(new URL("../../src/pages/account/index.astro", import.meta.url), "utf8");
    expect(page).toContain("noIndex privatePage");
    expect(page).toContain("data-analytics-private");
    const browser = readFileSync(new URL("../../src/reporting/browser.ts", import.meta.url), "utf8");
    expect(browser).toContain('!location.pathname.startsWith("/account/")');
  });
});
