import { locationFor, searchSpecies, type Species } from "../lib/model";
import { CaptureGate, sampleFrame, videoCrop, type ScanMatch } from "../lib/scan-model";
import type { BinderSnapshot } from "../lib/sync";
import { createCardRecognizer, type CardRecognizer } from "./scan-ocr";

interface ScannerOptions { species: Species[]; getSnapshot(): BinderSnapshot; markOwned(id: number): Promise<void> }
export interface CardScanner { open(): void; close(): void; refresh(): void }
type Phase = "closed" | "starting" | "scanning" | "recognizing" | "result" | "paused" | "error";
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createCardScanner(options: ScannerOptions, factory = createCardRecognizer): CardScanner {
  const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = node<HTMLDialogElement>("scan-dialog"), video = node<HTMLVideoElement>("scan-video");
  const guide = node("scan-guide"), frame = document.createElement("canvas"), sample = document.createElement("canvas");
  sample.width = 32; sample.height = 44;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true })!;
  let phase: Phase = "closed", generation = 0, timer: ReturnType<typeof setTimeout> | null = null;
  let stream: MediaStream | null = null, recognizer: CardRecognizer | null = null, gate = new CaptureGate();
  let selected: number | null = null, saving = false, signature: number[] = [], failures = 0;
  let lastAttempt = 0, resultNotice = "";
  const say = (text: string) => { if (node("scan-status").textContent !== text) node("scan-status").textContent = text; };
  function setPhase(next: Phase) {
    if (next !== "result") resultNotice = "";
    phase = next; dialog.dataset.phase = next;
    node("scan-title-label").textContent = next === "result" ? "Scan result" : "Scan cards";
    node("scan-camera").hidden = !["starting", "scanning", "recognizing"].includes(next);
    node("scan-result").hidden = next !== "result";
    node("scan-recovery").hidden = !["paused", "error"].includes(next);
    node("scan-camera-actions").hidden = !["starting", "scanning", "recognizing"].includes(next);
    node<HTMLButtonElement>("scan-capture").disabled = next !== "scanning";
    node<HTMLButtonElement>("scan-rescan").disabled = next !== "scanning";
    node<HTMLButtonElement>("scan-manual").disabled = next === "starting" || next === "recognizing";
  }
  function releaseImages() {
    frame.width = frame.height = 0;
    const preview = node<HTMLCanvasElement>("scan-preview"); preview.width = preview.height = 0; preview.hidden = true;
  }
  function stopResources() {
    generation++;
    if (timer) clearTimeout(timer); timer = null;
    const old = stream; stream = null; old?.getTracks().forEach(track => track.stop()); video.srcObject = null;
    const engine = recognizer; recognizer = null; if (engine) void engine.terminate().catch(() => {});
    sampleContext.clearRect(0, 0, sample.width, sample.height); signature = []; gate = new CaptureGate();
    releaseImages(); saving = false;
  }
  function close() { setPhase("closed"); stopResources(); gate = new CaptureGate(); selected = null; if (dialog.open) dialog.close(); }
  function pause(message: string) { stopResources(); setPhase("paused"); say(message); node("scan-recovery-text").textContent = message; }
  function fail(message: string) { stopResources(); setPhase("error"); say(message); node("scan-recovery-text").textContent = message; }
  function resizeGuide() {
    const bounds = video.getBoundingClientRect();
    guide.style.width = `${Math.max(80, Math.min(bounds.width * .84, (bounds.height - 28) * 63 / 88, 380))}px`;
  }
  const resizeObserver = new ResizeObserver(resizeGuide);
  resizeObserver.observe(node("scan-camera"));
  async function start() {
    stopResources(); const token = generation; gate = new CaptureGate(); selected = null; failures = 0;
    setPhase("starting"); say("Preparing scanner…"); node("scan-notice").textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) { fail("Camera access needs HTTPS and a supported browser. You can still search manually."); return; }
    // Both operations have late-result cleanup when closing/pausing during a prompt or download.
    const camera = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }).then(async media => {
      if (token !== generation) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media; video.srcObject = media;
      for (const track of media.getVideoTracks()) track.addEventListener("ended", () => { if (stream === media) pause("Camera disconnected. Resume the camera to continue."); });
      await video.play(); resizeGuide();
    });
    const engine = factory(message => { if (token === generation && phase === "starting") say(message); }).then(async instance => {
      if (token !== generation) { await instance.terminate(); return; } recognizer = instance;
    });
    try {
      await Promise.all([camera, engine]);
      if (token !== generation) return;
      setPhase("scanning"); say("Hold one card upright inside the guide."); schedule(token);
    } catch (error) {
      if (token !== generation) return;
      const denied = error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
      fail(denied ? "Camera permission was denied. Allow camera access in your browser, then try again—or search manually."
        : "The camera or scanner could not start. Check your connection and camera access, then try again—or search manually.");
    }
  }
  function captureFrame(): boolean {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
    const bounds = video.getBoundingClientRect(), guideBounds = guide.getBoundingClientRect();
    if (bounds.width <= 0 || guideBounds.width <= 0) return false;
    const crop = videoCrop(video.videoWidth, video.videoHeight, bounds, guideBounds);
    frame.width = Math.min(1200, Math.round(crop.width)); frame.height = Math.round(frame.width * crop.height / crop.width);
    frame.getContext("2d")!.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, frame.width, frame.height);
    return true;
  }
  function schedule(token = generation) {
    if (token === generation && phase === "scanning") timer = setTimeout(() => { void tick(token); }, 250);
  }
  async function tick(token: number) {
    if (token !== generation || phase !== "scanning") return;
    if (!captureFrame()) { schedule(token); return; }
    sampleContext.drawImage(frame, 0, 0, sample.width, sample.height);
    const values = sampleFrame(sampleContext.getImageData(0, 0, sample.width, sample.height).data); signature = values.signature;
    const state = gate.inspect(signature, values.contrast, performance.now());
    guide.dataset.ready = String(state === "ready");
    if (state === "held") say("Remove or replace the last card. Use Rescan same card if needed.");
    else if (state === "empty") say("Hold one card upright inside the guide.");
    else if (state === "moving") say("Hold steady…");
    if (state === "ready" && performance.now() - lastAttempt > 1200) { await recognize(false, token); }
    schedule(token);
  }
  async function recognize(manual: boolean, token = generation) {
    if (phase !== "scanning" || !recognizer || !captureFrame()) return;
    if (timer) clearTimeout(timer); timer = null;
    setPhase("recognizing"); say("Reading card…"); lastAttempt = performance.now();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const matches = await Promise.race([recognizer.recognize(frame), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("scan timeout")), 15000); })]);
      if (token !== generation) return;
      if (matches.length || manual) { gate.accept(signature); showResult(matches, true); }
      else {
        failures++; setPhase("scanning"); say(failures >= 3 ? "Could not read the name. Reduce glare, adjust the card, or use Capture now / Search manually." : "Adjust the card so its name is clear. Scanning automatically…");
      }
    } catch { if (token === generation) fail("The scanner could not read this card. Try again, or search manually."); }
    finally { if (deadline) clearTimeout(deadline); }
    if (manual) schedule(token);
  }
  function showResult(matches: ScanMatch[], hasPhoto: boolean) {
    setPhase("result"); saving = false; resultNotice = "";
    const ids = [...new Set(matches.flatMap(match => match.dexIds))].filter(id => options.species.some(item => item.id === id));
    selected = ids.length === 1 && matches.length === 1 && matches[0].certain ? ids[0] : null;
    const preview = node<HTMLCanvasElement>("scan-preview");
    if (hasPhoto && frame.width) {
      preview.width = 220; preview.height = Math.round(220 * frame.height / frame.width); preview.getContext("2d")!.drawImage(frame, 0, 0, preview.width, preview.height); preview.hidden = false;
    } else preview.hidden = true;
    dialog.dataset.hasPhoto = String(!preview.hidden);
    frame.width = frame.height = 0;
    node("scan-candidates").innerHTML = ids.map(id => {
      const item = options.species.find(item => item.id === id)!;
      return `<button type="button" data-scan-species="${id}" aria-pressed="${id === selected}"><strong>${escape(item.name)}</strong><span class="scan-choice-owned"></span><small class="scan-choice-location"></small></button>`;
    }).join("");
    node("scan-choice-help").textContent = ids.length > 1 ? "Choose one Pokémon’s binder slot. Only that slot will be marked."
      : selected ? "Check the Pokémon before marking it collected." : ids.length ? "Confirm the Pokémon below, or search for the correct name." : "No clear match. Search for the Pokémon, or scan again.";
    node("scan-search-panel").hidden = ids.length > 0; node<HTMLInputElement>("scan-search").value = ""; renderSearch();
    say(selected ? "Card identified." : "Choose the Pokémon."); refresh();
    if (!ids.length) node<HTMLInputElement>("scan-search").focus();
    else (selected ? node("scan-mark").hidden ? node("scan-next") : node("scan-mark")
      : node("scan-candidates").querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
  }
  function refresh() {
    if (!dialog.open) return;
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
    mark.hidden = !item || snapshot.state.ownedDexIds.includes(item.id); mark.disabled = saving;
    next.disabled = saving; next.classList.toggle("dex-primary", mark.hidden);
    for (const button of node("scan-candidates").querySelectorAll<HTMLElement>("[data-scan-species]")) {
      const id = Number(button.dataset.scanSpecies), loc = locationFor(id, snapshot.state.settings, options.species);
      button.setAttribute("aria-pressed", String(id === selected));
      button.querySelector(".scan-choice-owned")!.textContent = snapshot.state.ownedDexIds.includes(id) ? "Already collected" : "Missing";
      button.querySelector(".scan-choice-location")!.textContent = `Page ${loc.page} · Row ${loc.row} · Column ${loc.column}`;
    }
    if (!item) return;
    const owned = snapshot.state.ownedDexIds.includes(item.id), loc = locationFor(item.id, snapshot.state.settings, options.species);
    const text = (id: string, value: string) => { if (node(id).textContent !== value) node(id).textContent = value; };
    text("scan-pokemon-name", item.name); text("scan-dex-number", `#${String(item.id).padStart(4, "0")}`);
    text("scan-owned-status", owned ? "Already collected" : "Missing"); node("scan-owned-status").dataset.owned = String(owned);
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
  function nextCard() { releaseImages(); selected = null; failures = 0; setPhase("scanning"); say("Show the next card. Scanning automatically…"); schedule(); }
  async function markCollected() {
    if (!selected || saving) return;
    const id = selected, token = generation; saving = true; refresh();
    try {
      await options.markOwned(id);
      if (token !== generation || phase !== "result") return;
      saving = false;
      if (options.getSnapshot().storageWarning) { resultNotice = "Marked in this page only. Download a backup before leaving. Choose Scan next to continue."; refresh(); say(resultNotice); return; }
      if (stream && recognizer) nextCard(); else { setPhase("paused"); say("Marked collected. Resume the camera to scan another card."); node("scan-recovery-text").textContent = "Marked collected. Resume the camera to scan another card."; }
    } catch { if (token === generation) { saving = false; resultNotice = "Could not save this mark. Try again; this result is still here."; refresh(); say(resultNotice); } }
  }
  node("scan-close").addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  node("scan-resume").addEventListener("click", () => { void start(); });
  node("scan-capture").addEventListener("click", () => { void recognize(true); });
  node("scan-next").addEventListener("click", () => { if (stream && recognizer) nextCard(); else void start(); });
  node("scan-mark").addEventListener("click", () => { void markCollected(); });
  node("scan-rescan").addEventListener("click", () => { gate.rescan(); say("Ready to scan this card again."); });
  const searchManually = () => { if (timer) clearTimeout(timer); showResult([], false); };
  node("scan-manual").addEventListener("click", searchManually); node("scan-recovery-search").addEventListener("click", searchManually);
  node("scan-correct").addEventListener("click", () => { node("scan-search-panel").hidden = false; node("scan-candidates").hidden = false; node<HTMLInputElement>("scan-search").focus(); });
  node("scan-search").addEventListener("input", renderSearch);
  node("scan-result").addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-scan-species]");
    if (!button || saving) return;
    const id = Number(button.dataset.scanSpecies); if (!options.species.some(item => item.id === id)) return;
    selected = id; node<HTMLInputElement>("scan-search").blur(); node("scan-search-panel").hidden = true; refresh();
    (node("scan-mark").hidden ? node("scan-next") : node("scan-mark")).focus({ preventScroll: true });
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && dialog.open) pause("Camera paused while the page was in the background. Resume when ready."); });
  window.addEventListener("pagehide", close);
  return { open() { if (!dialog.open) { dialog.showModal(); void start(); } }, close, refresh };
}
