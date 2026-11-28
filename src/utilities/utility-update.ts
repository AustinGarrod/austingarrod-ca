const CHECK_INTERVAL = 5 * 60_000;
const RESUME_INTERVAL = 30_000;
const REQUEST_TIMEOUT = 10_000;
const VERSION = /^[a-f0-9]{64}$/;
const SHELL_ASSET = /^\/(?:_astro|fonts)\/[\w.-]+\.(?:m?js|css|woff2?|png|svg|webp)$/;
const UPDATE_UNAVAILABLE = "The update isn’t ready on this page yet. Try again shortly.";

interface UtilityRelease {
  version: string;
  assets: string[];
}

async function request(path: string, method: "GET" | "HEAD" = "GET"): Promise<Response> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "omit",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new Error("Utility release unavailable");
  return response;
}

/** Return a user-facing reason to keep this tab open, or null once it is safe to reload. */
export function initializeUtilityUpdate(beforeReload: () => string | null): void {
  const root = document.querySelector<HTMLElement>("[data-utility-release]");
  const releasePath = root?.dataset.utilityRelease ?? "";
  const current = root?.dataset.utilityVersion;
  if (!root || !releasePath || !current || !VERSION.test(current)) return;

  const notice = root;
  const marker = `data-utility-release="${releasePath}"`;
  const update = notice.querySelector<HTMLButtonElement>("[data-utility-update-now]")!;
  const later = notice.querySelector<HTMLButtonElement>("[data-utility-update-later]")!;
  const message = notice.querySelector<HTMLElement>("[data-utility-update-message]")!;
  const announcement = document.querySelector<HTMLElement>("[data-utility-update-announcement]")!;
  const dismissFocus = document.querySelector<HTMLElement>(".utility-header-brand");
  let available: string | null = null;
  const dismissed = new Set<string>();
  let checking = false;
  let applying = false;
  let checkedAt = -Infinity;

  function announce(text: string): void {
    announcement.textContent = text;
  }

  function showMessage(text: string): void {
    message.textContent = text;
    announce(text);
  }

  function hideNotice(restoreFocus = true): void {
    if (restoreFocus && notice.contains(document.activeElement)) dismissFocus?.focus();
    notice.hidden = true;
    announce("");
  }

  async function readRelease(): Promise<UtilityRelease> {
    const release = await (await request(releasePath)).json() as { version?: unknown; assets?: unknown };
    if (typeof release?.version !== "string" || !VERSION.test(release.version)
      || !Array.isArray(release.assets) || !release.assets.length
      || !release.assets.every((asset) => typeof asset === "string" && SHELL_ASSET.test(asset))) {
      throw new Error("Invalid utility release");
    }
    return { version: release.version, assets: release.assets };
  }

  function showRelease(version: string): void {
    if (version === current || dismissed.has(version)) {
      available = null;
      hideNotice();
    } else if (version !== available) {
      available = version;
      message.textContent = "";
      notice.hidden = false;
      announce("Update available");
    }
  }

  async function check(minimumInterval: number): Promise<void> {
    if (checking || applying || document.hidden || !navigator.onLine || Date.now() - checkedAt < minimumInterval) return;
    checking = true;
    checkedAt = Date.now();
    try {
      const release = await readRelease();
      if (!applying) showRelease(release.version);
    }
    catch { /* Keep the utility usable when the release file cannot be reached. */ }
    finally { checking = false; }
  }

  later.addEventListener("click", (event) => {
    if (!available) return;
    dismissed.add(available);
    available = null;
    hideNotice(event.detail === 0);
  });

  update.addEventListener("click", async () => {
    if (!available || applying) return;
    const version = available;
    applying = true;
    later.disabled = true;
    update.setAttribute("aria-disabled", "true");
    try {
      if (!navigator.onLine) { showMessage("Reconnect to update."); return; }
      showMessage("Checking update…");
      const path = location.pathname;
      const release = await readRelease();
      if (release.version !== version) {
        showRelease(release.version);
        return;
      }
      const html = await (await request(path)).text();
      if (!html.includes(marker) || !html.includes(`data-utility-version="${version}"`)) {
        showMessage(UPDATE_UNAVAILABLE);
        return;
      }
      const assets = await Promise.allSettled(release.assets.map((asset) => request(asset, "HEAD")));
      if (location.pathname !== path || assets.some((asset) => asset.status === "rejected")) {
        showMessage(UPDATE_UNAVAILABLE);
        return;
      }
      const blocker = beforeReload();
      if (blocker) { showMessage(blocker); return; }
      location.reload();
    } catch {
      showMessage("Couldn’t load the update. Try again when you’re online.");
    } finally {
      applying = false;
      later.disabled = false;
      update.removeAttribute("aria-disabled");
    }
  });

  if (notice.classList.contains("utility-update-overlay") && "ResizeObserver" in window) {
    const shell = notice.parentElement;
    new ResizeObserver(() => shell?.style.setProperty("--rm-update-height", `${notice.getBoundingClientRect().height}px`)).observe(notice);
  }

  window.setInterval(() => { void check(RESUME_INTERVAL); }, CHECK_INTERVAL);
  document.addEventListener("visibilitychange", () => { void check(RESUME_INTERVAL); });
  window.addEventListener("pageshow", () => { void check(RESUME_INTERVAL); });
  window.addEventListener("online", () => { void check(0); });
  void check(0);
}
