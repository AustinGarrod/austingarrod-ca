export function createPrintingArtwork(details: HTMLElement, dialog: HTMLDialogElement) {
  const heading = dialog.querySelector<HTMLHeadingElement>("h2")!;
  const frame = dialog.querySelector<HTMLElement>(".dex-artwork-frame")!;
  const status = dialog.querySelector<HTMLElement>("[role=status]")!;
  const original = dialog.querySelector<HTMLAnchorElement>("a")!;
  let opener: HTMLAnchorElement | null = null;
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target as HTMLImageElement;
      observer?.unobserve(image);
      const source = image.dataset.artworkSrc;
      if (!source || !image.isConnected) continue;
      image.src = source;
      delete image.dataset.artworkSrc;
    }
  });

  function observeThumbnails(list?: HTMLElement) {
    observer?.disconnect();
    if (!observer || !list) return;
    // The viewport observer also clips against the scrolling list or the mobile details sheet.
    for (const image of list.querySelectorAll("img[data-artwork-src]")) observer.observe(image);
  }

  details.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-printing-artwork]");
    const image = link?.querySelector("img");
    const source = image?.getAttribute("src") || image?.dataset.artworkSrc;
    if (!link || !image || !source) return;

    event.preventDefault();
    opener = link;
    heading.textContent = link.dataset.artworkTitle ?? image.alt;
    original.href = link.href;
    original.target = link.target;
    original.rel = link.rel;
    const thumbnail = new Image();
    thumbnail.alt = image.alt;
    const hasSharperScan = new URL(source, document.baseURI).href !== link.href;
    status.textContent = hasSharperScan ? "Loading full-size artwork…" : "";
    frame.replaceChildren(thumbnail);
    dialog.showModal();

    thumbnail.addEventListener("error", () => {
      if (!dialog.open || !frame.contains(thumbnail)) return;
      thumbnail.hidden = true;
      if (!hasSharperScan) status.textContent = "Artwork unavailable.";
    }, { once: true });
    thumbnail.src = source;
    if (!hasSharperScan) return;

    const sharp = new Image();
    sharp.alt = image.alt;
    sharp.src = original.href;
    void sharp.decode().then(() => {
      if (!dialog.open || !frame.contains(thumbnail)) return;
      frame.replaceChildren(sharp);
      status.textContent = "";
    }, () => {
      if (!dialog.open || !frame.contains(thumbnail)) return;
      status.textContent = "Full-size artwork unavailable.";
    });
  });

  dialog.addEventListener("close", () => {
    if (dialog.open || !opener) return;
    const link = opener.isConnected ? opener : Array.from(details.querySelectorAll<HTMLAnchorElement>("a[data-printing-artwork]"))
      .find(candidate => candidate.dataset.printingArtwork === opener?.dataset.printingArtwork);
    const target = link?.getClientRects().length ? link : details.querySelector<HTMLElement>("#printing-search");
    target?.focus({ preventScroll: true });
    opener = null;
    frame.replaceChildren();
    status.textContent = "";
  });

  return { canObserve: observer !== null, observeThumbnails };
}
