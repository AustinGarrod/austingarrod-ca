import * as Sentry from "@sentry/browser";
import build from "./build.json";

// Keep the existing geocoder contract without dropping request/status/timing diagnostics.
function withoutGeocodeQuery<T>(value: T): T {
  if (typeof value === "string") return value.replace(/(\/utilities\/radius-map\/api\/geocode\.php)\?[^\s"']*/g, "$1") as T;
  if (Array.isArray(value)) return value.map(withoutGeocodeQuery) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutGeocodeQuery(item)])) as T;
  return value;
}

const enabled = import.meta.env.PROD || import.meta.env.PUBLIC_REPORTING_ENABLED === "true";
if (enabled && !Sentry.getClient()) {
  Sentry.init({
    dsn: "https://8b561c6564244066bd2960053ed220cd@reports.garrod.house/8",
    release: build.release,
    environment: build.environment,
    sampleRate: 1,
    tracesSampleRate: 1,
    enableLogs: true,
    sendDefaultPii: true,
    beforeSend: withoutGeocodeQuery,
    beforeSendTransaction: withoutGeocodeQuery,
    beforeBreadcrumb: withoutGeocodeQuery,
    beforeSendLog: (log) => ({ ...withoutGeocodeQuery(log), attributes: { ...log.attributes, "service.name": "portfolio-browser" } }),
    maxBreadcrumbs: 100,
    attachStacktrace: true,
    normalizeDepth: 6,
    integrations: (defaults) => [...defaults.filter((integration) => integration.name !== "BrowserSession"),
      Sentry.browserTracingIntegration(),
      Sentry.captureConsoleIntegration({ levels: ["warn", "error", "assert"] }),
      Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
      Sentry.httpClientIntegration({ failedRequestStatusCodes: [[500, 599], 429] }),
    ],
    tracePropagationTargets: [/^\/utilities\/radius-map\/api\//, `${location.origin}/utilities/radius-map/api/`],
    initialScope: { tags: { service: "portfolio-browser", architecture: "astro-static-php" } },
  });
  Sentry.setContext("page", { path: location.pathname, online: navigator.onLine, language: navigator.language, standalone: matchMedia("(display-mode: standalone)").matches });

  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement || target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
      const url = target instanceof HTMLLinkElement ? target.href : target.src;
      // Map tile failures are captured by Leaflet with aggregate context.
      if (url.includes("tile.openstreetmap.org")) return;
      reportFailure(new Error(`Resource failed to load: ${url}`), "resource.load", { tag: target.tagName, url });
    }
  }, true);
  window.addEventListener("securitypolicyviolation", (event) => {
    reportFailure(new Error(`CSP blocked ${event.violatedDirective}`), "csp", { blockedURI: event.blockedURI, source: event.sourceFile, line: event.lineNumber });
  });
  for (const name of ["online", "offline"]) window.addEventListener(name, () => Sentry.addBreadcrumb({ category: "connectivity", message: name }));

  document.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement) || !event.target.matches(".contact-form")) return;
    const trace = Sentry.getTraceData()["sentry-trace"];
    if (trace) {
      const input = document.createElement("input");
      input.type = "hidden"; input.name = "reporting_trace"; input.value = trace;
      event.target.append(input);
    }
    Sentry.logger.info("Contact form submitted", { flow: "contact" });
  });
  Sentry.logger.info("Page initialized", { path: location.pathname, "service.name": "portfolio-browser" });
}

export function reportFailure(error: unknown, operation: string, context: Record<string, unknown> = {}): void {
  if (!enabled) return;
  const exception = error instanceof DOMException
    ? new Error(error.message, { cause: error })
    : error instanceof Error ? error : new Error(String(error), { cause: error });
  if (error instanceof DOMException) exception.name = error.name;
  Sentry.withScope((scope) => {
    scope.setTag("operation", operation);
    scope.setContext("operation", { ...context, online: navigator.onLine, path: location.pathname });
    Sentry.captureException(exception);
  });
}

export function reportState(flow: string, context: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.setContext(flow, context);
  Sentry.addBreadcrumb({ category: flow, data: context });
  Sentry.logger.info(flow, context);
}
