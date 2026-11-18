# Local production browser checks on Windows

Run browser checks against a freshly built local production bundle. `yarn test:e2e` first validates that build and prepares the local compatibility-site artifact used by migration tests. Vite serves the same `/idle-slayer-companion/` base path used by GitHub Pages. Automated browser checks accept only local HTTP URLs; keep production inspection manual.

The default `yarn test:e2e` starts a strict-port preview on `127.0.0.1:4173`. Outside CI, Playwright may reuse an existing server there, which may belong to another checkout or serve an older build. An explicit preview on a free port makes the build being tested clear.

In the first PowerShell terminal, from the checkout you want to test:

```powershell
yarn build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; do not start the preview.' }
Get-NetTCPConnection -State Listen -LocalPort 4199 -ErrorAction SilentlyContinue
```

If the port check prints a listener, choose another port and use it in both terminals below. Leave other processes running. With a free port, start your preview:

```powershell
yarn preview --host 127.0.0.1 --port 4199 --strictPort
```

Keep this terminal running. Open `http://127.0.0.1:4199/idle-slayer-companion/` for manual local inspection. `--strictPort` fails if another process takes the port instead of silently switching ports.

In a second PowerShell terminal, change to the **same checkout**. Install Chromium once with `yarn playwright install chromium`, then run:

```powershell
$browserChecksHadBase = Test-Path Env:PLAYWRIGHT_BASE_URL
$browserChecksPreviousBase = $env:PLAYWRIGHT_BASE_URL
try {
    $env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:4199/idle-slayer-companion/'
    yarn test:e2e
    if ($LASTEXITCODE -ne 0) { throw 'Browser checks failed; inspect their output.' }
} finally {
    if ($browserChecksHadBase) {
        $env:PLAYWRIGHT_BASE_URL = $browserChecksPreviousBase
    } else {
        Remove-Item Env:PLAYWRIGHT_BASE_URL -ErrorAction SilentlyContinue
    }
}
```

Setting `PLAYWRIGHT_BASE_URL` tells Playwright to use your running preview; it does not start another server. The `finally` block restores the terminal's previous setting even when the checks fail. Stop **your preview** with Ctrl+C in the first terminal when finished. After changing application code, stop it, rebuild successfully, and restart before testing again.

For a scoped run, pass a test file or Playwright filter after `yarn test:e2e`, for example `yarn test:e2e tests/browser/profile-sync.spec.ts`. Keep the same local URL and cleanup block. If no Yarn launcher is installed, replace each `yarn` invocation with `node .yarn/releases/yarn-4.13.0.cjs`, as described in the [Windows setup instructions](../README.md#run-locally-on-windows).

The configuration and local-only URL guard are in [playwright.config.ts](../playwright.config.ts). The full repository check sequence remains in the [README](../README.md#verify-a-change).
