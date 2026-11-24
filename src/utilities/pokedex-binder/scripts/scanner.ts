import { normalizeSearch, type PocketLocation } from "../lib/model";
import type { Slot } from "../lib/master";
import { locationFor, searchSpecies, type Species } from "../lib/model";
import { CaptureGate, sampleFrame, videoCrop, type ScanMatch } from "../lib/scan-model";
import type { BinderSnapshot } from "../lib/sync";
import { createCardRecognizer, type CardRecognizer } from "./scan-ocr";
import { scanCardId } from "../lib/scan-set";
import { bindScanFlash } from "./scan-flash";
import { reportFailure, reportState } from "../../../reporting/browser";

interface ScannerOptions { species: Species[]; getSnapshot(): BinderSnapshot; markOwned(id: number): Promise<void> }
export interface SetScan {
  printedTotal: number | null;
  slots(): (Slot & PocketLocation)[];
  mark(key: string): Promise<void>;
}
export interface CardScanner { open(set?: SetScan): void; close(): void; refresh(): void; isNational(): boolean }
type Phase = "closed" | "starting" | "scanning" | "recognizing" | "result" | "paused" | "error";
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createCardScanner(options: ScannerOptions, factory = createCardRecognizer): CardScanner {
  const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = node<HTMLDialogElement>("scan-dialog"), video = node<HTMLVideoElement>("scan-video");
  const guide = node("scan-guide"), frame = document.createElement("canvas"), sample = document.createElement("canvas");
  sample.width = 32; sample.height = 44;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true })!;
  const attachFlash = bindScanFlash(node<HTMLButtonElement>("scan-flash"), node("scan-flash-notice"));
  let phase: Phase = "closed", generation = 0, timer: ReturnType<typeof setTimeout> | null = null;
  let stream: MediaStream | null = null, recognizer: CardRecognizer | null = null, gate = new CaptureGate();
  let selected: number | null = null, saving = false, failures = 0;
  let resumeAfterManual = false;
  let set: SetScan | undefined;
  const setQuery = node<HTMLInputElement>("master-scan-search");
  let candidateIds: string[] = [], selectedCard: string | undefined;
  function showSetResult(ids: string[]) {
    setPhase("result");
    node("scan-notice").textContent = "";
    candidateIds = ids;
    selectedCard = ids.length === 1 ? ids[0] : undefined;
    setQuery.value = "";
    refreshSet();
    say(selectedCard ? node("set-scan-name").textContent || "Card identified." : "Choose a card.");
    if (!ids.length) setQuery.focus();
    else (node("set-scan-result").querySelector<HTMLButtonElement>("[data-finish]:enabled, [data-scan-card]") ?? node("set-scan-next")).focus({ preventScroll: true });
  }
  function refreshSet() {
    const slots = set?.slots() ?? [];
    const query = normalizeSearch(setQuery.value);
    const matching = slots.filter(s => query ? [s.name, s.number, s.finish].some(v => normalizeSearch(v).includes(query))
      : !candidateIds.length || candidateIds.includes(scanCardId(s)));
    const cards = new Map(matching.map(s => [scanCardId(s), s]));
    const card = selectedCard ?? (query && cards.size === 1 ? cards.keys().next().value : undefined);
    const finishes = card ? slots.filter(s => scanCardId(s) === card) : [];
    const first = finishes[0];
    const name = first ? [first.number && "#" + first.number, first.name].filter(Boolean).join(" · ") : "";
    node("set-scan-name").textContent = name || (candidateIds.length ? "Choose a card" : "Find a card");
    const buttons = finishes.map(s => {
      const single = finishes.length === 1 && !s.owned;
      return `<button type="button" data-finish="${escape(s.key)}" data-collected="${s.owned}" ${saving || s.owned ? "disabled" : ""} class="${single ? "dex-primary" : ""}">
        <span class="dex-scan-finish-name"><strong>${escape(s.finish)}</strong>${s.ordered ? "<small>Ordered</small>" : ""}</span>
        <small class="dex-scan-finish-location">Page ${s.page} · Row ${s.row} · Column ${s.column}</small>
        <span class="dex-scan-finish-action">${s.owned ? "Already collected" : "Mark collected"}</span></button>`;
    }).join("");
    node("set-scan-finishes").innerHTML = buttons;
    node("set-scan-search-panel").hidden = !!selectedCard && !!first;
    node("set-scan-correct").hidden = !node("set-scan-search-panel").hidden;
    node<HTMLButtonElement>("set-scan-correct").disabled = setQuery.disabled = saving;
    const choices = node("set-scan-choices");
    choices.innerHTML = first ? "" : [...cards.entries()].slice(0, 30).map(([id, slot]) =>
      `<button type="button" data-scan-card="${escape(id)}"><span>${escape(slot.number)}</span> ${escape(slot.name)}</button>`).join("");
    if (!cards.size) choices.textContent = "No matching cards in this binder.";
    else if (!first && cards.size > 30) choices.insertAdjacentHTML("beforeend", "<p>Type to narrow the list.</p>");
    const next = node<HTMLButtonElement>("set-scan-next");
    next.disabled = saving;
    next.classList.toggle("dex-primary", finishes.length > 0 && finishes.every(slot => slot.owned));
  }
  let retryAfter = 0, resultNotice = "";
  const say = (text: string) => { if (node("scan-status").textContent !== text) node("scan-status").textContent = text; };
  function setPhase(next: Phase) {
    if (next !== "result") resultNotice = "";
    phase = next; dialog.dataset.phase = next;
    node("scan-title-label").textContent = next === "result" ? "Scan result" : "Scan cards";
    node("scan-camera").hidden = !["starting", "scanning", "recognizing"].includes(next);
    node("scan-result").hidden = next !== "result" || !!set;
    node("set-scan-result").hidden = next !== "result" || !set;
    const photo = node("set-photo-label");
    const photoControls = node(next === "result" && set ? "set-result-photo" : "set-photo-controls");
    if (photo.parentElement !== photoControls) photoControls.append(photo);
    photo.hidden = !set || next === "closed" || next === "recognizing" || next === "starting";
    node("scan-recovery").hidden = !["paused", "error"].includes(next);
    node("scan-camera-actions").hidden = !["starting", "scanning", "recognizing"].includes(next);
    node<HTMLButtonElement>("scan-capture").disabled = next !== "scanning";
    node<HTMLButtonElement>("scan-rescan").disabled = next !== "scanning";
  }
  function releaseImages() {
    frame.width = frame.height = 0;
    const preview = node<HTMLCanvasElement>("scan-preview"); preview.width = preview.height = 0; preview.hidden = true;
  }
  function stopResources() {
    generation++;
    if (timer) clearTimeout(timer); timer = null;
    attachFlash();
    const old = stream; stream = null; old?.getTracks().forEach(track => track.stop()); video.srcObject = null;
    const engine = recognizer; recognizer = null; if (engine) void engine.terminate().catch(() => {});
    sampleContext.clearRect(0, 0, sample.width, sample.height); gate = new CaptureGate(); retryAfter = 0;
    resumeAfterManual = false;
    releaseImages(); saving = false;
  }
  function close() { setPhase("closed"); stopResources(); gate = new CaptureGate(); selected = null; if (dialog.open) dialog.close(); }
  function pause(message: string) { stopResources(); setPhase("paused"); say(message); }
  function fail(message: string, permissionDenied = false) {
    stopResources();
    dialog.toggleAttribute("data-camera-denied", permissionDenied);
    setPhase("error");
    say(message);
  }
  function resizeGuide() {
    const bounds = video.getBoundingClientRect();
    guide.style.width = `${Math.max(80, Math.min(bounds.width * .84, (bounds.height - 28) * 63 / 88, 380))}px`;
  }
  const resizeObserver = new ResizeObserver(resizeGuide);
  resizeObserver.observe(node("scan-camera"));
  async function start() {
    stopResources(); const token = generation; gate = new CaptureGate(); selected = null; failures = 0;
    const binder = set ? "set" : "national";
    const started = performance.now();
    const logStartup = (outcome: string) => reportState("binder.scanner.start", { binder, outcome, elapsedMs: Math.round(performance.now() - started) });
    setPhase("starting"); say("Preparing scanner…"); node("scan-notice").textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) {
      logStartup("camera_api_unavailable");
      fail("Camera access needs HTTPS and a supported browser. You can still search manually."); return;
    }
    // Both operations have late-result cleanup when closing/pausing during a prompt or download.
    const camera = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }).then(async media => {
      if (token !== generation) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media; video.srcObject = media;
      for (const track of media.getVideoTracks()) track.addEventListener("ended", () => { if (stream === media) pause("Camera disconnected. Resume the camera to continue."); });
      await video.play();
      if (token !== generation) return;
      resizeGuide(); attachFlash(media.getVideoTracks()[0]);
    });
    const engineError = new Error("Scanner recognition engine could not load");
    const engine = factory(message => { if (token === generation && phase === "starting") say(message); }, set ? "set" : "species").catch(() => { throw engineError; }).then(async instance => {
      if (token !== generation) { await instance.terminate(); return; } recognizer = instance;
    });
    try {
      await Promise.all([camera, engine]);
      if (token !== generation) return;
      logStartup("ready");
      setPhase("scanning"); say("Hold one card upright inside the guide."); schedule(token);
    } catch (error) {
      if (token !== generation) return;
      if (error === engineError) {
        logStartup("recognizer_load_failed");
        reportFailure(engineError, "binder.scanner.recognizer_load", { binder });
        fail("Card recognition could not load. Reload the binder or search manually."); return;
      }
      const denied = error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
      logStartup(denied ? "permission_denied" : error instanceof DOMException && error.name === "NotFoundError" ? "no_camera" : "camera_start_failed");
      fail(denied ? "Camera permission was denied. Allow camera access in your browser, then resume the camera or search manually."
        : "The camera or scanner could not start. Check your connection and camera access, then try again—or search manually.", denied);
    }
  }
  function sourceCrop() {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const bounds = video.getBoundingClientRect(), guideBounds = guide.getBoundingClientRect();
    if (bounds.width <= 0 || guideBounds.width <= 0) return null;
    return videoCrop(video.videoWidth, video.videoHeight, bounds, guideBounds);
  }
  function schedule(token = generation) {
    if (token === generation && phase === "scanning") timer = setTimeout(() => { void tick(token); }, 120);
  }
  async function tick(token: number) {
    if (token !== generation || phase !== "scanning") return;
    const crop = sourceCrop();
    if (!crop) { schedule(token); return; }
    sampleContext.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, sample.width, sample.height);
    const values = sampleFrame(sampleContext.getImageData(0, 0, sample.width, sample.height).data);
    const state = gate.inspect(values.signature, values.contrast, performance.now());
    guide.dataset.ready = String(state === "ready");
    if (state === "held") say("Remove or replace the last card. Use Rescan same card if needed.");
    else if (state === "empty") say("Hold one card upright inside the guide.");
    else if (state === "moving") say("Hold steady…");
    if (state === "moving" || state === "empty") retryAfter = 0;
    if (state === "ready" && performance.now() >= retryAfter) { await recognize(false, token); }
    schedule(token);
  }
  async function recognize(manual: boolean, token = generation) {
    const crop = sourceCrop();
    if (phase !== "scanning" || !recognizer || !crop) return;
    if (timer) clearTimeout(timer); timer = null;
    frame.width = Math.min(1200, Math.round(crop.width)); frame.height = Math.round(frame.width * crop.height / crop.width);
    frame.getContext("2d")!.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, frame.width, frame.height);
    sampleContext.drawImage(frame, 0, 0, sample.width, sample.height);
    const { signature } = sampleFrame(sampleContext.getImageData(0, 0, sample.width, sample.height).data);
    setPhase("recognizing"); say("Reading card…");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("scan timeout")), 15000); });
      const result = set
        ? { cards: await Promise.race([recognizer.readSet(frame, set.slots(), set.printedTotal), timeout]) }
        : { species: await Promise.race([recognizer.recognize(frame), timeout]) };
      if (token !== generation) return;
      if (result.cards && (result.cards.length || manual)) {
        gate.accept(signature); showSetResult(result.cards); releaseImages();
      } else if (result.species && (result.species.length || manual)) {
        gate.accept(signature); showResult(result.species, true);
      } else {
        retryAfter = performance.now() + 650;
        failures++; setPhase("scanning"); say(failures >= 3 ? "Could not read the card. Reduce glare, capture now, or search manually." : "Adjust the card so the print is clear.");
      }
    } catch { if (token === generation) fail("The scanner could not read this card. Try again, or search manually."); }
    finally { if (deadline) clearTimeout(deadline); }
    if (manual) schedule(token);
  }
  function showResult(matches: ScanMatch[], hasPhoto: boolean) {
    setPhase("result"); saving = false; resultNotice = "";
    const ids = [...new Set(matches.flatMap(match => match.dexIds))].filter(id => options.species.some(item => item.id === id));
    selected = ids.length === 1 ? ids[0] : null;
    const likely = selected !== null && !matches.some(match => match.certain);
    node("scan-likely").hidden = !likely;
    const preview = node<HTMLCanvasElement>("scan-preview");
    if (hasPhoto && frame.width) {
      preview.width = 220; preview.height = Math.round(220 * frame.height / frame.width); preview.getContext("2d")!.drawImage(frame, 0, 0, preview.width, preview.height); preview.hidden = false;
    } else preview.hidden = true;
    dialog.dataset.hasPhoto = String(!preview.hidden);
    frame.width = frame.height = 0;
    node("scan-candidates").innerHTML = (ids.length > 1 ? ids : []).map(id => {
      const item = options.species.find(item => item.id === id)!;
      return `<button type="button" data-scan-species="${id}" aria-pressed="${id === selected}"><strong>${escape(item.name)}</strong><span class="scan-choice-owned"></span><small class="scan-choice-location"></small></button>`;
    }).join("");
    node("scan-choice-help").textContent = ids.length > 1 ? "Choose one Pokémon’s binder slot. Only that slot will be marked."
      : "No clear match. Search for the Pokémon, or scan again.";
    node("scan-search-panel").hidden = ids.length > 0; node<HTMLInputElement>("scan-search").value = "";
    if (!ids.length) renderSearch();
    say(likely ? "Likely match. Check the Pokémon before marking it." : selected ? "Card identified." : "Choose the Pokémon."); refresh();
    if (!ids.length) node<HTMLInputElement>("scan-search").focus();
    else (selected ? node("scan-mark").hidden ? node("scan-next") : node("scan-mark")
      : node("scan-candidates").querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
  }
  function refresh() {
    if (!dialog.open) return;
    if (set) { if (phase === "result") refreshSet(); return; }
    const snapshot = options.getSnapshot();
    const notice = [snapshot.storageWarning, snapshot.error, resultNotice, snapshot.layoutConflict ? "Layout sync conflict: locations use this device’s current layout." : null].filter(Boolean).join(" ");
    if (node("scan-notice").textContent !== notice) node("scan-notice").textContent = notice;
    if (phase !== "result") return;
    const item = options.species.find(item => item.id === selected);
    node("scan-result-hero").hidden = !item && node("scan-preview").hidden;
    node("scan-result-details").hidden = !item;
    node("scan-placement").hidden = !item;
    node("scan-choice-help").hidden = !!item;
    node("scan-candidates").hidden = !!item;
    const mark = node<HTMLButtonElement>("scan-mark"), next = node<HTMLButtonElement>("scan-next");
    const status = (id: number) => snapshot.state.ownedDexIds.includes(id) ? "Already collected"
      : snapshot.state.orderedDexIds?.includes(id) ? "Ordered" : "Missing";
    mark.hidden = !item || snapshot.state.ownedDexIds.includes(item.id); mark.disabled = saving;
    next.disabled = saving; next.classList.toggle("dex-primary", mark.hidden);
    for (const button of node("scan-candidates").querySelectorAll<HTMLElement>("[data-scan-species]")) {
      const id = Number(button.dataset.scanSpecies), loc = locationFor(id, snapshot.state.settings, options.species);
      button.setAttribute("aria-pressed", String(id === selected));
      button.querySelector(".scan-choice-owned")!.textContent = status(id);
      button.querySelector(".scan-choice-location")!.textContent = `Page ${loc.page} · Row ${loc.row} · Column ${loc.column}`;
    }
    if (!item) return;
    const owned = snapshot.state.ownedDexIds.includes(item.id), loc = locationFor(item.id, snapshot.state.settings, options.species);
    const text = (id: string, value: string) => { if (node(id).textContent !== value) node(id).textContent = value; };
    text("scan-pokemon-name", item.name); text("scan-dex-number", `#${String(item.id).padStart(4, "0")}`);
    text("scan-owned-status", status(item.id)); node("scan-owned-status").dataset.owned = String(owned);
    const image = node<HTMLImageElement>("scan-pokemon-sprite"), source = `/utilities/pokedex-binder/sprites/${item.id}.png`;
    if (image.getAttribute("src") !== source) image.src = source;
    node("scan-location").setAttribute("aria-label", `Page ${loc.page} · Sheet ${loc.sheet} ${loc.side} · Row ${loc.row} · Column ${loc.column}`);
    text("scan-location-page", String(loc.page)); text("scan-location-row", String(loc.row)); text("scan-location-column", String(loc.column));
    text("scan-sheet", `Sheet ${loc.sheet} · ${loc.side === "front" ? "Front" : "Back"}`);
  }
  function renderSearch() {
    const query = node<HTMLInputElement>("scan-search").value;
    const results = searchSpecies(options.species, query).slice(0, 15);
    node("scan-search-results").innerHTML = results.map(item => `<button type="button" data-scan-species="${item.id}"><span>#${String(item.id).padStart(4, "0")}</span> ${escape(item.name)}</button>`).join("") || '<p>No Pokémon match that name or number.</p>';
  }
  function nextCard() { releaseImages(); selected = null; failures = 0; retryAfter = 0; setPhase("scanning"); say("Show the next card. Scanning automatically…"); schedule(); }
  function afterSave() {
    if (stream && recognizer) nextCard();
    else if (resumeAfterManual) void start();
    else pause("Marked collected. Resume the camera to scan another card.");
  }
  async function markCollected() {
    if (!selected || saving) return;
    const id = selected, token = generation; saving = true; refresh();
    try {
      await options.markOwned(id);
      if (token !== generation || phase !== "result") return;
      saving = false;
      if (options.getSnapshot().storageWarning) { resultNotice = "Marked in this page only. Download a backup before leaving. Choose Scan next to continue."; refresh(); say(resultNotice); return; }
      afterSave();
    } catch { if (token === generation) { saving = false; resultNotice = "Could not save this mark. Try again; this result is still here."; refresh(); say(resultNotice); } }
  }
  node("scan-close").addEventListener("click", event => { event.preventDefault(); close(); });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  node("scan-resume").addEventListener("click", () => { void start(); });
  node("scan-capture").addEventListener("click", () => { void recognize(true); });
  node("scan-next").addEventListener("click", () => { if (stream && recognizer) nextCard(); else void start(); });
  node("scan-mark").addEventListener("click", () => { void markCollected(); });
  node("scan-rescan").addEventListener("click", () => { gate.rescan(); retryAfter = 0; say("Ready to scan this card again."); });
  const searchManually = () => {
    if (phase === "starting" || phase === "recognizing") {
      const wasLive = phase === "starting" || !!stream;
      stopResources();
      resumeAfterManual = wasLive;
    }
    if (timer) clearTimeout(timer);
    if (set) showSetResult([]); else showResult([], false);
  };
  node("scan-manual").addEventListener("click", searchManually); node("scan-recovery-search").addEventListener("click", searchManually);
  node("scan-correct").addEventListener("click", () => { node("scan-search-panel").hidden = false; node("scan-candidates").hidden = false; renderSearch(); node<HTMLInputElement>("scan-search").focus(); });
  node("scan-search").addEventListener("input", renderSearch);
  node("scan-result").addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-scan-species]");
    if (!button || saving) return;
    const id = Number(button.dataset.scanSpecies); if (!options.species.some(item => item.id === id)) return;
    selected = id; node("scan-likely").hidden = true; node<HTMLInputElement>("scan-search").blur(); node("scan-search-panel").hidden = true; refresh();
    (node("scan-mark").hidden ? node("scan-next") : node("scan-mark")).focus({ preventScroll: true });
  });
  setQuery.oninput = refreshSet;
  node("set-scan-correct").onclick = () => { showSetResult([]); };
  node("set-scan-next").onclick = () => { if (!saving) { if (stream && recognizer) nextCard(); else void start(); } };
  node("set-scan-result").addEventListener("click", async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || saving || button.disabled) return;
    if (button.dataset.scanCard) {
      selectedCard = button.dataset.scanCard;
      refreshSet();
      (node("set-scan-finishes").querySelector<HTMLButtonElement>("button:enabled") ?? node("set-scan-next")).focus();
      return;
    }
    const target = set, key = button.dataset.finish, token = generation;
    if (!target || !key) return;
    node("scan-notice").textContent = "";
    saving = true; refreshSet();
    try {
      await target.mark(key);
      if (token !== generation || set !== target) return;
      saving = false; afterSave();
    } catch { if (token === generation) node("scan-notice").textContent = "Could not save this mark. Check the binder and try again."; }
    finally { if (token === generation && phase === "result") { saving = false; refreshSet(); } }
  });
  node<HTMLInputElement>("master-photo").onchange = async event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = ""; if (!set || !file || saving) return;
    stopResources(); const token = generation; setPhase("recognizing"); say("Reading card…");
    let engine: CardRecognizer | undefined;
    try {
      const bitmap = await createImageBitmap(file);
      try {
        if (token !== generation) return;
        const scale = Math.min(1,1800 / Math.max(bitmap.width,bitmap.height));
        frame.width = Math.round(bitmap.width*scale); frame.height = Math.round(bitmap.height*scale);
        frame.getContext("2d")!.drawImage(bitmap,0,0,frame.width,frame.height);
      } finally { bitmap.close(); }
      engine = await factory(() => {}, "set"); if (token !== generation) return;
      recognizer = engine; const cards = await engine.readSet(frame, set.slots(), set.printedTotal);
      if (token === generation) showSetResult(cards);
    } catch { if (token === generation) fail("Could not read the photo. Try another photo or search manually."); }
    finally { if (recognizer === engine) recognizer = null; await engine?.terminate(); if (token === generation) releaseImages(); }
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden && dialog.open) pause("Camera paused while the page was in the background. Resume when ready."); });
  window.addEventListener("pagehide", close);
  return {
    open(target) {
      if (dialog.open && phase !== "closed") return;
      set = target;
      const earlyTap = dialog.open && dialog.dataset.phase === "loading";
      if (!dialog.open) dialog.showModal();
      reportState("binder.scanner.open", { binder: set ? "set" : "national", earlyTap });
      void start();
    },
    close, refresh,
    isNational: () => !set,
  };
}
