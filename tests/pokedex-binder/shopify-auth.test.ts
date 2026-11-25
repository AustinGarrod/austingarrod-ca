import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const php = process.env.PHP_BINARY || "php";
const phpVersion = spawnSync(php, ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8" });

function runPhp(code: string, input?: unknown) {
  const program = [
    "require 'public/utilities/pokemon-binder/api/_shopify-auth.php';",
    "$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);",
    code,
  ].join("\n");
  return JSON.parse(execFileSync(php, ["-r", program], { input: JSON.stringify(input ?? null), encoding: "utf8" }));
}

function temporarySite(run: (webroot: string, config: string, cache: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "binder-shopify-auth-"));
  const webroot = join(directory, "public_html"), privateDir = join(directory, "private");
  const config = join(privateDir, "shopify-catalog.json"), cache = join(privateDir, "shopify-catalog-token.json");
  mkdirSync(webroot);
  mkdirSync(privateDir, { mode: 0o700 });
  try { run(webroot, config, cache); }
  finally {
    rmSync(config, { force: true });
    rmSync(cache, { force: true });
    rmdirSync(privateDir);
    rmdirSync(webroot);
    rmdirSync(directory);
  }
}

const now = 1_800_000_000;

function exampleJwt(expiry: number) {
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: expiry })).toString("base64url")}.fixtureSignature`;
}

describe.skipIf(Number(phpVersion.stdout || 0) < 80400)("Shopify Catalog authentication", () => {
  it("uses only the canonical public address observed by the web server", () => {
    const cases = [
      { REMOTE_ADDR: "8.8.8.8", HTTP_X_FORWARDED_FOR: "1.1.1.1" },
      { REMOTE_ADDR: "::ffff:8.8.8.8" },
      { REMOTE_ADDR: "2001:4860:4860:0:0:0:0:8888" },
      { HTTP_CF_CONNECTING_IP: "8.8.8.8" },
      { REMOTE_ADDR: "127.0.0.1", HTTP_X_REAL_IP: "8.8.8.8" },
      { REMOTE_ADDR: "100.64.0.1" },
      { REMOTE_ADDR: "::ffff:192.168.1.1" },
      { REMOTE_ADDR: "239.0.0.1" },
      { REMOTE_ADDR: "ff02::1" },
      { REMOTE_ADDR: "8.8.8.8\r\nInjected: header" },
    ];
    expect(runPhp("echo json_encode(array_map('binder_shopify_buyer_ip', $input));", cases)).toEqual([
      "8.8.8.8", "8.8.8.8", "2001:4860:4860::8888", null, null, null, null, null, null, null,
    ]);
  });

  it("uses the earliest token expiry and rejects malformed bearer responses", () => {
    const accessToken = exampleJwt(now + 300);
    const cases = [
      { access_token: accessToken },
      { access_token: accessToken, expires_in: 45 },
      { access_token: exampleJwt(now + 7200), expires_in: 7200 },
      { access_token: exampleJwt(now - 1) },
      { access_token: "unsafe\r\ninjected" },
      { access_token: "malformed.jwt.fixture" },
      { access_token: accessToken, expires_in: 0 },
      { error: "invalid_client" },
    ];
    expect(runPhp("echo json_encode(array_map(static fn($body) => binder_shopify_token_response(json_encode($body), $input['now'])['expiresAt'] ?? null, $input['cases']));", { now, cases }))
      .toEqual([now + 300, now + 45, now + 3600, null, null, null, null, null]);
  });

  it("loads validated credentials only from the protected sibling directory", () => temporarySite((webroot, config) => {
    const enabled = "echo json_encode(binder_shopify_config($input) !== null);";
    expect(runPhp(enabled, webroot)).toBe(false);
    writeFileSync(config, JSON.stringify({ client_id: "fixtureClient", client_secret: "fixtureSecret" }), { mode: 0o600 });
    expect(runPhp(enabled, webroot)).toBe(true);
    const actual = runPhp("echo json_encode(basename(binder_shopify_config($input)['cache']));", webroot);
    expect(actual).toBe("shopify-catalog-token.json");
    if (process.platform !== "win32") {
      chmodSync(config, 0o644);
      expect(runPhp(enabled, webroot)).toBe(false);
      chmodSync(config, 0o600);
    }
    writeFileSync(config, JSON.stringify({ client_id: "fixture", client_secret: "invalid secret" }));
    expect(runPhp(enabled, webroot)).toBe(false);
  }));

  it("reuses synchronized tokens, refreshes rejections and backs off a failed exchange", () => temporarySite((_webroot, _config, cache) => {
    const lifecycle = `
      $issued = 0;
      $successful = static function () use (&$issued): array {
          return ['bearer' => 'fixtureToken' . ++$issued, 'expiresAt' => time() + 600];
      };
      $failed = static function () use (&$issued): ?array { $issued++; return null; };
      $first = binder_shopify_cached_token($input, 'credential-a', null, $successful);
      $reused = binder_shopify_cached_token($input, 'credential-a', null, $successful);
      $replacement = binder_shopify_cached_token($input, 'credential-a', $first, $successful);
      $concurrent = binder_shopify_cached_token($input, 'credential-a', $first, $successful);
      $unavailable = binder_shopify_cached_token($input, 'credential-a', $replacement, $failed);
      $backoff = binder_shopify_cached_token($input, 'credential-a', null, $successful);
      $rotated = binder_shopify_cached_token($input, 'credential-b', null, $successful);
      echo json_encode([
          $first === $reused, $first !== $replacement, $replacement === $concurrent,
          $unavailable, $backoff, $rotated !== $replacement, $issued,
      ]);`;
    expect(runPhp(lifecycle, cache)).toEqual([true, true, true, null, null, true, 4]);
  }));

  it("refreshes ahead of expiry, preserving a still valid token during an exchange outage", () => temporarySite((_webroot, _config, cache) => {
    const lifecycle = `
      $seed = static function (): array { return ['bearer' => 'fixtureExpiring', 'expiresAt' => time() + 30]; };
      $next = static function (): array { return ['bearer' => 'fixtureRenewed', 'expiresAt' => time() + 600]; };
      $first = binder_shopify_cached_token($input, 'credential-a', null, $seed);
      $preserved = binder_shopify_cached_token($input, 'credential-a', null, static fn() => null);
      $recovery = json_decode(file_get_contents($input), true);
      $recovery['retryAt'] = time() - 1;
      file_put_contents($input, json_encode($recovery));
      $refreshed = binder_shopify_cached_token($input, 'credential-a', null, $next);
      echo json_encode([$first === $preserved, $refreshed === 'fixtureRenewed']);`;
    expect(runPhp(lifecycle, cache)).toEqual([true, true]);
  }));
});
