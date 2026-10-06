interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export function initializePwa(): void {
  const installCard = document.querySelector<HTMLElement>("#install-app-card");
  const installButton = document.querySelector<HTMLButtonElement>("#install-app-button");
  let installPrompt: BeforeInstallPromptEvent | null = null;

  const isInstalled = (): boolean =>
    window.matchMedia("(display-mode: standalone)").matches
    || (navigator as NavigatorWithStandalone).standalone === true;

  const hideInstallCard = (): void => {
    if (installCard) installCard.hidden = true;
  };

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/utilities/radius-map/sw.js", { scope: "/utilities/radius-map/" }).catch((error: unknown) => {
        console.warn("Radius Map could not register its offline worker.", error);
      });
    });
  }

  if (!installCard || !installButton || isInstalled()) {
    hideInstallCard();
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
    installCard.hidden = false;
    window.umami?.track("radius-map-install-available");
  });

  installButton.addEventListener("click", () => {
    if (!installPrompt) return;

    const prompt = installPrompt;
    installPrompt = null;
    hideInstallCard();
    void prompt.prompt()
      .then(() => prompt.userChoice)
      .then(({ outcome }) => {
        window.umami?.track("radius-map-install-result", { outcome: outcome === "accepted" ? "accepted" : "dismissed" });
      })
      .catch(() => {
        window.umami?.track("radius-map-install-result", { outcome: "error" });
      });
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    hideInstallCard();
    window.umami?.track("radius-map-installed");
  });
}
