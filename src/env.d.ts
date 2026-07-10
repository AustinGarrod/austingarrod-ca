/// <reference types="astro/client" />

interface UmamiTracker {
  track(eventName: string, data?: Record<string, unknown>): void;
}

interface Window {
  umami?: UmamiTracker;
}
