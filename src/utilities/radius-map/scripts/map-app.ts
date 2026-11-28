import L, { type Circle, type LatLngBounds, type LatLngExpression, type Marker } from "leaflet";
import { reportFailure, reportState } from "../../../reporting/browser";
import { peekSession } from "../../../../packages/accounts/client";
import { mountAccountReminder } from "../../../../packages/accounts/reminder";
import { bindRadiusAccountControls } from "./account-controls";
import { toSavedMeasurements } from "../lib/account-measurements";
import type { RadiusAccountView } from "../lib/account-library";
import {
  coordinateInputError,
  formatDerived,
  formatMeasurement,
  measurementDetails,
  measurementToRadiusMeters,
  parseCoordinateInput,
  validateMeasurement,
  type Coordinates,
  type DistanceUnit,
  type MeasurementKind,
} from "../lib/distance";
import { forgetDraft, readDraft, writeDraft } from "../lib/draft";
import { initializeUtilityUpdate } from "../../utility-update";
import type { GeocodeResult } from "../lib/geocode";
import {
  type SavedMeasurement,
  type SavedMeasurementInput,
} from "../lib/measurements";
import {
  triangulateBestFit,
  type TriangulationInput,
  type TriangulationResult,
} from "../lib/triangulation";

interface GeocodeResponse {
  results?: GeocodeResult[];
  error?: string;
}

interface AppState {
  center: Coordinates | null;
  centerLabel: string;
  kind: MeasurementKind;
  unit: DistanceUnit;
  saved: SavedMeasurement[];
  editingId: string | null;
  result: TriangulationResult | null;
}

/** What was on the map before an edit started, restored when the edit ends. */
interface DraftSnapshot {
  center: Coordinates | null;
  centerLabel: string;
  value: string;
  kind: MeasurementKind;
  unit: DistanceUnit;
}

interface SavedLayer {
  circle: Circle;
  marker: Marker;
}

interface BestFitInput extends TriangulationInput {
  label: string;
}

type WorkspaceTab = "create" | "saved" | "bestfit";
type SaveDialogMode = "save" | "rename";

const SAVED_COLORS = ["#0d9488", "#0b1c30", "#006a61", "#2563a6", "#7a5a13", "#7b3f72", "#4b6478", "#39715c"];
/** The inhabited world, used for the first view and whenever nothing is drawn. */
const WORLD_VIEW = L.latLngBounds([[-56, -168], [74, 178]]);
/** Web Mercator stops at ±85.05°. Longitude is left open so the map can wrap. */
const MAP_LIMITS = L.latLngBounds([[-85.0511, -540], [85.0511, 540]]);
const UNDO_DURATION = 6_000;
const PHONE_LAYOUT = "(max-width: 599px)";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing required element: ${id}`);
  return found as T;
}

function queryElement<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`Missing required element: ${selector}`);
  return found as T;
}

function shortenLabel(label: string): string {
  const [first, second] = label.split(",").map((part) => part.trim());
  return second ? `${first}, ${second}` : first;
}

/** A short place name for the chip and the centre row: the coordinates for a typed or dropped pin. */
function displayPlace(label: string): string {
  const match = label.match(/^(Coordinates|Dropped pin|Your location|Best-fit point) · (.+)$/);
  if (!match) return shortenLabel(label);
  if (match[1] !== "Coordinates" && match[1] !== "Dropped pin") return match[1];
  return match[2].split(",").map((part) => Number(part).toFixed(4)).join(", ");
}

function readableCoordinates(coordinates: Coordinates): string {
  return `${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}`;
}

function colorIndex(id: string): number {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % SAVED_COLORS.length;
}

/** Plain words for a failed place search. The technical detail goes to the error report only. */
function searchFailureMessage(status: number | null, serverMessage: string | undefined): string {
  if (status === 429) return "Too many searches. Wait a minute and try again.";
  if (status === 400) return serverMessage || "Enter a place, address or postal code.";
  if (status === null && !navigator.onLine) return "You appear to be offline. Tap the map or enter coordinates instead.";
  return "Search is unavailable right now. Tap the map or enter coordinates instead.";
}

/** Two significant figures: an estimate's error is not precise to the metre. */
function roughly(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return formatDerived(Number(value.toPrecision(2)));
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function initializeRadiusMap(): void {
  if (document.documentElement.dataset.radiusMapReady === "true") return;
  document.documentElement.dataset.radiusMapReady = "true";

  const locationForm = element<HTMLFormElement>("location-form");
  const searchInput = element<HTMLInputElement>("location-search");
  const searchButton = element<HTMLButtonElement>("search-button");
  const searchResults = element<HTMLUListElement>("search-results");
  const locationPicker = element<HTMLDivElement>("location-picker");
  const locationError = element<HTMLParagraphElement>("location-error");
  const locationChosen = element<HTMLDivElement>("location-chosen");
  const locationChosenLabel = element<HTMLParagraphElement>("location-chosen-label");
  const locationChange = element<HTMLButtonElement>("location-change");
  const locationClear = element<HTMLButtonElement>("location-clear");
  const locateButton = element<HTMLButtonElement>("locate-button");
  const locateLabel = queryElement<HTMLElement>(".sr-only", locateButton);
  const measurementInput = element<HTMLInputElement>("measurement-value");
  const measurementError = element<HTMLParagraphElement>("measurement-error");
  const summaryValue = element<HTMLParagraphElement>("summary-value");
  const summaryDetail = element<HTMLParagraphElement>("summary-detail");
  const summaryCenter = element<HTMLParagraphElement>("summary-centre");
  const copySummaryButton = element<HTMLButtonElement>("copy-summary-button");
  const appStatus = element<HTMLParagraphElement>("app-status");
  const statusUndo = element<HTMLButtonElement>("status-undo");
  const mapHint = element<HTMLDivElement>("map-hint");
  const mapHintText = element<HTMLSpanElement>("map-hint-text");
  const centerChip = element<HTMLDivElement>("centre-chip");
  const centerChipLabel = element<HTMLElement>("centre-chip-label");
  const centerChipClear = element<HTMLButtonElement>("centre-chip-clear");
  const appShell = queryElement<HTMLElement>(".app-shell");
  const utilityHeader = queryElement<HTMLElement>(".utility-header", appShell);
  const controlPanel = element<HTMLElement>("radius-panel");
  const panelContent = element<HTMLDivElement>("panel-content");
  const panelToggle = element<HTMLButtonElement>("panel-toggle");
  const panelToggleLabel = queryElement<HTMLElement>(".panel-toggle-label", panelToggle);
  const tabList = queryElement<HTMLElement>(".workspace-tabs", controlPanel);
  const tabs: Record<WorkspaceTab, { tab: HTMLButtonElement; panel: HTMLDivElement }> = {
    create: { tab: element("create-tab"), panel: element("create-panel") },
    saved: { tab: element("saved-tab"), panel: element("saved-panel") },
    bestfit: { tab: element("bestfit-tab"), panel: element("bestfit-panel") },
  };
  const tabOrder: WorkspaceTab[] = ["create", "saved", "bestfit"];
  const savedCount = element<HTMLSpanElement>("saved-count");
  const editBanner = element<HTMLDivElement>("edit-banner");
  const editBannerName = element<HTMLElement>("edit-banner-name");
  const saveMeasurementButton = element<HTMLButtonElement>("save-measurement-button");
  const peekSaveButton = element<HTMLButtonElement>("peek-save-button");
  const cancelEditButton = element<HTMLButtonElement>("cancel-edit-button");
  const librarySearch = element<HTMLInputElement>("library-search");
  const librarySearchField = queryElement<HTMLLabelElement>(".library-search");
  const libraryEmpty = element<HTMLDivElement>("library-empty");
  const libraryNoResults = element<HTMLDivElement>("library-no-results");
  const savedList = element<HTMLDivElement>("saved-list");
  const triangulateButton = element<HTMLButtonElement>("triangulate-button");
  const triangulationHint = element<HTMLParagraphElement>("triangulation-hint");
  const triangulationInputs = element<HTMLOListElement>("triangulation-inputs");
  const triangulationCircles = element<HTMLDivElement>("triangulation-circles");
  const bestFitSignIn = element<HTMLAnchorElement>("bestfit-sign-in");
  const triangulationResult = element<HTMLDivElement>("triangulation-result");
  const triangulationStatus = element<HTMLParagraphElement>("triangulation-status");
  const resultCoordinates = element<HTMLParagraphElement>("result-coordinates");
  const resultInputCount = element<HTMLElement>("result-input-count");
  const resultError = element<HTMLElement>("result-error");
  const copyResultButton = element<HTMLButtonElement>("copy-result-button");
  const useResultButton = element<HTMLButtonElement>("use-result-button");
  const saveDialog = element<HTMLDialogElement>("save-dialog");
  const saveForm = element<HTMLFormElement>("save-form");
  const saveDialogTitle = element<HTMLHeadingElement>("save-dialog-title");
  const measurementName = element<HTMLInputElement>("measurement-name");
  const saveDialogSummary = element<HTMLParagraphElement>("save-dialog-summary");
  const saveDialogError = element<HTMLParagraphElement>("save-dialog-error");
  const saveDialogCancel = element<HTMLButtonElement>("save-dialog-cancel");
  const saveDialogSubmit = element<HTMLButtonElement>("save-dialog-submit");
  const signInDialog = element<HTMLDialogElement>("sign-in-dialog");
  const signInDialogCopy = element<HTMLParagraphElement>("sign-in-dialog-copy");
  const signInDialogCancel = element<HTMLButtonElement>("sign-in-dialog-cancel");
  const signInToSave = element<HTMLAnchorElement>("radius-sign-in-to-save");
  const deleteDialog = element<HTMLDialogElement>("delete-dialog");
  const deleteForm = element<HTMLFormElement>("delete-form");
  const deleteDialogCopy = element<HTMLParagraphElement>("delete-dialog-copy");
  const deleteDialogError = element<HTMLParagraphElement>("delete-dialog-error");
  const deleteDialogCancel = element<HTMLButtonElement>("delete-dialog-cancel");
  const deleteDialogSubmit = element<HTMLButtonElement>("delete-dialog-submit");

  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const phoneLayout = window.matchMedia(PHONE_LAYOUT);

  const state: AppState = {
    center: null,
    centerLabel: "",
    kind: "radius",
    unit: "km",
    saved: [],
    editingId: null,
    result: null,
  };

  const map = L.map("map", {
    center: [20, 0],
    zoom: 2,
    zoomControl: false,
    worldCopyJump: true,
    maxBounds: MAP_LIMITS,
    maxBoundsViscosity: 1,
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  let tileFailures = 0;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 19,
  }).on("tileerror", () => {
    tileFailures += 1;
    reportState("map.tiles", { failures: tileFailures, zoom: map.getZoom(), online: navigator.onLine });
    if (tileFailures === 1) reportFailure(new Error("Map tiles failed to load"), "map.tiles", { zoom: map.getZoom() });
  }).addTo(map);

  const draftIcon = L.divIcon({
    className: "radius-map-marker",
    html: '<span class="map-pin-marker" aria-hidden="true"></span>',
    iconSize: [30, 34],
    iconAnchor: [15, 30],
  });
  const resultIcon = L.divIcon({
    className: "radius-map-result-marker",
    html: '<span class="best-fit-marker" aria-hidden="true"><span></span></span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

  let draftMarker: Marker | null = null;
  let draftCircle: Circle | null = null;
  let resultMarker: Marker | null = null;
  const savedLayers = new Map<string, SavedLayer>();
  let activeTab: WorkspaceTab = "create";
  let sheetExpanded = true;
  let changingCenter = false;
  let saveDialogMode: SaveDialogMode = "save";
  let editOriginal: SavedMeasurement | undefined;
  let preEditDraft: DraftSnapshot | null = null;
  let dialogOriginal: SavedMeasurement | undefined;
  let deleteOriginal: SavedMeasurement | undefined;
  let accountId: string | null = null;
  let accountView: RadiusAccountView | null = null;
  let accountSnapshot = "";
  let pendingSave = false;
  let pendingWrites = 0;
  let draftTracking = false;
  let draftCanContinue = false;
  let committedCircle = "";
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  let undoAction: (() => void) | null = null;
  let fitTimer: ReturnType<typeof setTimeout> | undefined;

  const reminder = mountAccountReminder(element("radius-account-reminder"), {
    title: "Save this measurement",
    description: "Use a free account to save this circle.",
    returnTo: "/utilities/radius-map/",
    offered: () => {
      const session = peekSession();
      return !!session?.enabled && !session.user && !!accountView?.canSignIn && !!currentDraftInput()
        && draftCanContinue && !state.editingId && activeTab === "create";
    },
    beforeContinue: prepareDraftSignIn,
    onVisibilityChange: () => {
      if (isMobileLayout() && state.center) requestAnimationFrame(fitDraftCircle);
    },
    fallbackFocus: () => controlPanel,
  });

  const accounts = bindRadiusAccountControls(view => {
    const previousAccount = accountId;
    const switched = view.accountId !== previousAccount;
    accountId = view.accountId;
    accountView = view;
    reminder.refresh();
    if (switched && previousAccount) {
      state.saved = [];
      editOriginal = dialogOriginal = deleteOriginal = undefined;
      saveDialog.close();
      deleteDialog.close();
      saveDialogSummary.textContent = deleteDialogCopy.textContent = measurementName.value = "";
      saveDialogError.hidden = deleteDialogError.hidden = true;
      librarySearch.value = "";
      clearDraft("");
      closeSearchResults();
      fitWorld();
    }
    if (!view.library) {
      accountSnapshot = "";
      renderLibrary();
      updateTriangulationAvailability();
      return;
    }
    if (view.accountId && signInDialog.open) signInDialog.close();
    const snapshot = JSON.stringify(view.library);
    if (!switched && snapshot === accountSnapshot) return;
    accountSnapshot = snapshot;
    state.saved = toSavedMeasurements(view.library);
    clearResult();
    renderLibrary();
    renderSavedLayers();
    if (switched) refreshMeasurement();
    if (switched && state.saved.some(measurement => measurement.visible)) fitVisibleCircles();
    // Back from signing in to save: offer the save straight away.
    if (switched && !previousAccount && pendingSave) {
      pendingSave = false;
      persistDraft();
      if (currentDraftInput()) openSaveDialog();
    }
  });

  async function changeMeasurement(...args: Parameters<typeof accounts.change>): Promise<void> {
    pendingWrites++;
    try { await accounts.change(...args); }
    finally { pendingWrites--; }
  }

  // Status

  function setStatus(message: string, tone: "info" | "error" = "info"): void {
    appStatus.textContent = message;
    appStatus.classList.toggle("is-error", tone === "error");
    clearTimeout(undoTimer);
    undoAction = null;
    statusUndo.hidden = true;
  }

  function offerUndo(message: string, action: () => void): void {
    setStatus(message);
    undoAction = action;
    statusUndo.hidden = false;
    undoTimer = setTimeout(() => {
      undoAction = null;
      statusUndo.hidden = true;
    }, UNDO_DURATION);
  }

  function showLocationError(message: string): void {
    locationError.textContent = message;
    locationError.hidden = false;
    searchInput.setAttribute("aria-invalid", "true");
    setStatus(message, "error");
  }

  function clearLocationError(): void {
    locationError.textContent = "";
    locationError.hidden = true;
    searchInput.removeAttribute("aria-invalid");
  }

  /** Keyboard and mouse users continue at the next control; on touch screens focus stays in the panel so no keyboard pops up over the map. */
  function focusNext(target: HTMLElement): void {
    if (finePointer.matches) target.focus();
    else controlPanel.focus({ preventScroll: true });
  }

  function persistDraft(): boolean {
    // An edit belongs to a saved measurement; the draft kept is the one from before it.
    if (!draftTracking || state.editingId) return false;
    draftCanContinue = writeDraft({
      center: state.center,
      centerLabel: state.centerLabel,
      value: measurementInput.value,
      kind: state.kind,
      unit: state.unit,
      pendingSave,
    });
    return draftCanContinue;
  }

  function prepareDraftSignIn(): boolean {
    pendingSave = true;
    if (persistDraft()) return true;
    pendingSave = false;
    reminder.refresh();
    const message = "Your draft could not be kept for sign-in. Keep this map open and try again.";
    if (signInDialog.open) signInDialogCopy.textContent = message;
    else setStatus(message, "error");
    return false;
  }

  function draftCircleKey(): string {
    const draft = currentDraftInput();
    return draft ? JSON.stringify([draft.center.lat, draft.center.lng, draft.value, draft.kind, draft.unit]) : "";
  }

  function commitDraftChange(): void {
    if (!draftCanContinue || state.editingId || accountView?.signedInId || peekSession()?.user) return;
    const key = draftCircleKey();
    if (key && key !== committedCircle) {
      committedCircle = key;
      reminder.recordChange();
    }
  }

  // Layout

  function isMobileLayout(): boolean {
    return phoneLayout.matches;
  }

  function updateSheetInset(): void {
    if (!isMobileLayout()) {
      appShell.style.removeProperty("--sheet-height");
      return;
    }
    appShell.style.setProperty("--sheet-height", `${Math.ceil(controlPanel.getBoundingClientRect().height)}px`);
  }

  /** Phones show the panel as a bottom sheet: a peek with the distance, or expanded with every tab. */
  function setSheetExpanded(expanded: boolean, options: { fit?: boolean } = {}): void {
    sheetExpanded = expanded;
    const peek = isMobileLayout() && !expanded;
    controlPanel.classList.toggle("is-peek", peek);
    panelToggle.setAttribute("aria-expanded", String(!peek));
    panelToggleLabel.textContent = peek ? "Expand" : "Collapse";
    panelToggle.setAttribute("aria-label", peek ? "Expand controls" : "Collapse controls");
    if (peek) panelContent.scrollTop = 0;
    updateSheetInset();
    if (options.fit !== false) requestAnimationFrame(fitCurrentView);
  }

  function updateMapOverlays(): void {
    mapHint.hidden = !!state.center || savedLayers.size > 0;
    mapHintText.textContent = `${finePointer.matches ? "Click" : "Tap"} the map to place your centre`;
    centerChip.hidden = !state.center;
  }

  function mapPadding(): { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] } {
    let top = utilityHeader.getBoundingClientRect().bottom;
    for (const overlay of [centerChip, mapHint]) {
      if (!overlay.hidden) top = Math.max(top, overlay.getBoundingClientRect().bottom);
    }
    top = Math.ceil(top) + 16;
    if (isMobileLayout()) {
      return { paddingTopLeft: [16, top], paddingBottomRight: [16, Math.ceil(controlPanel.getBoundingClientRect().height) + 16] };
    }
    return { paddingTopLeft: [Math.ceil(controlPanel.getBoundingClientRect().right) + 24, top], paddingBottomRight: [24, 24] };
  }

  /** The lowest zoom at which one copy of the world is at least as tall as the map, so no grey shows. */
  function updateMinimumZoom(): void {
    const height = map.getSize().y || window.innerHeight;
    map.setMinZoom(Math.max(1, Math.ceil(Math.log2(height / 256))));
  }

  function fitWorld(): void {
    map.fitBounds(WORLD_VIEW, { animate: false, ...mapPadding() });
  }

  function fitBounds(bounds: LatLngBounds, maxZoom = 14): void {
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, { animate: false, maxZoom, ...mapPadding() });
  }

  function fitDraftCircle(): void {
    if (draftCircle) fitBounds(draftCircle.getBounds());
  }

  function fitVisibleCircles(): void {
    const bounds = L.latLngBounds([]);
    for (const layer of savedLayers.values()) bounds.extend(layer.circle.getBounds());
    if (draftCircle) bounds.extend(draftCircle.getBounds());
    if (state.result) bounds.extend(state.result.center as LatLngExpression);
    fitBounds(bounds);
  }

  function fitCurrentView(): void {
    if (state.result || draftCircle || savedLayers.size > 0) fitVisibleCircles();
    else if (!state.center) fitWorld();
  }

  // Draft

  function currentMeasurement(): number {
    return Number(measurementInput.value);
  }

  function describeMeasurement(value: number, kind: MeasurementKind, unit: DistanceUnit): string {
    return `${formatMeasurement(value)} ${unit} ${kind}`;
  }

  function defaultMeasurementName(): string {
    const location = state.centerLabel ? shortenLabel(state.centerLabel) : "Saved measurement";
    return `${location} — ${describeMeasurement(currentMeasurement(), state.kind, state.unit)}`.slice(0, 80);
  }

  function currentDraftInput(name = defaultMeasurementName()): SavedMeasurementInput | null {
    if (!state.center) return null;
    const value = currentMeasurement();
    if (validateMeasurement(value, state.kind, state.unit)) return null;
    return {
      name,
      locationLabel: state.centerLabel,
      center: state.center,
      value,
      kind: state.kind,
      unit: state.unit,
      visible: state.editingId
        ? (state.saved.find((measurement) => measurement.id === state.editingId)?.visible ?? true)
        : true,
    };
  }

  function updateSummary(value: number | null): void {
    summaryCenter.textContent = state.center ? state.centerLabel : "Choose a centre to draw the circle";
    const place = state.center ? displayPlace(state.centerLabel) : "";
    copySummaryButton.disabled = value === null || !state.center;
    if (value === null) {
      summaryValue.textContent = "—";
      summaryDetail.textContent = "Enter a distance";
      centerChipLabel.textContent = place;
      return;
    }
    const details = measurementDetails(value, state.kind, state.unit);
    const summary = describeMeasurement(value, state.kind, state.unit);
    summaryValue.textContent = summary;
    // Each part stays whole; the line wraps between them.
    summaryDetail.replaceChildren(...[
      `${formatDerived(details.converted.value)} ${details.converted.unit}`,
      `${formatDerived(details.counterpart.value)} ${state.unit} ${details.counterpart.kind}`,
      `${formatDerived(details.area)} ${state.unit}² area`,
    ].flatMap((part, index) => {
      const span = document.createElement("span");
      span.textContent = part;
      return index === 0 ? [span] : [document.createTextNode(" · "), span];
    }));
    centerChipLabel.textContent = place ? `${summary} · ${place}` : summary;
  }

  function removeDraftCircle(): void {
    if (!draftCircle) return;
    draftCircle.removeFrom(map);
    draftCircle = null;
  }

  function refreshMeasurement(options: { fit?: boolean; announce?: boolean } = {}): boolean {
    const value = currentMeasurement();
    const error = validateMeasurement(value, state.kind, state.unit);
    measurementError.hidden = !error;
    measurementError.textContent = error ?? "";
    measurementInput.setAttribute("aria-invalid", error ? "true" : "false");
    persistDraft();
    reminder.refresh();

    if (error) {
      updateSummary(null);
      removeDraftCircle();
      saveMeasurementButton.disabled = peekSaveButton.disabled = true;
      if (options.announce) setStatus(error, "error");
      updateTriangulationAvailability();
      updateMapOverlays();
      return false;
    }

    updateSummary(value);
    if (state.center) {
      const radiusMeters = measurementToRadiusMeters(value, state.kind, state.unit);
      if (!draftCircle) {
        draftCircle = L.circle(state.center as LatLngExpression, {
          radius: radiusMeters,
          color: "#006a61",
          fillColor: "#0d9488",
          fillOpacity: 0.16,
          opacity: 0.95,
          weight: 3,
          dashArray: state.editingId ? "7 6" : undefined,
        }).addTo(map);
      } else {
        draftCircle.setLatLng(state.center as LatLngExpression).setRadius(radiusMeters);
      }
      if (options.fit) fitDraftCircle();
    }
    saveMeasurementButton.disabled = peekSaveButton.disabled = !state.center;
    updateTriangulationAvailability();
    updateMapOverlays();
    return true;
  }

  function clearResult(): void {
    state.result = null;
    triangulationResult.hidden = true;
    triangulationStatus.hidden = true;
    triangulationStatus.textContent = "";
    if (resultMarker) {
      resultMarker.removeFrom(map);
      resultMarker = null;
    }
  }

  /** Once a centre is chosen the first step shrinks to one row with Change and Clear. */
  function updateLocationStep(): void {
    const collapsed = !!state.center && !changingCenter;
    controlPanel.classList.toggle("has-centre", !!state.center);
    locationPicker.hidden = collapsed;
    locationChosen.hidden = !state.center || changingCenter;
    locationChosenLabel.textContent = state.center ? displayPlace(state.centerLabel) : "";
  }

  function setCenter(coordinates: Coordinates, label: string, statusMessage: string, committed = false): void {
    clearResult();
    clearLocationError();
    changingCenter = false;
    state.center = coordinates;
    state.centerLabel = label.slice(0, 240);
    if (!draftMarker) {
      draftMarker = L.marker(coordinates as LatLngExpression, {
        draggable: true,
        icon: draftIcon,
        keyboard: true,
        title: "Drag to move the circle centre",
        alt: "Current circle centre",
      }).addTo(map);
      draftMarker.on("dragend", () => {
        if (!draftMarker) return;
        const point = map.wrapLatLng(draftMarker.getLatLng());
        const moved = { lat: point.lat, lng: point.lng };
        searchInput.value = "";
        setCenter(moved, `Dropped pin · ${readableCoordinates(moved)}`, "Centre moved. The circle has been updated.", true);
        window.umami?.track("radius-map-centre-selected", { method: "drag" });
      });
    } else {
      draftMarker.setLatLng(coordinates as LatLngExpression);
    }

    updateLocationStep();
    updateMapOverlays();
    // On phones the sheet drops to its peek so the circle and the distance are both in view.
    // An edit keeps it open so Update and Cancel stay at hand.
    if (isMobileLayout() && activeTab === "create" && !state.editingId) setSheetExpanded(false, { fit: false });
    const circleWasDrawn = refreshMeasurement({ fit: true });
    setStatus(circleWasDrawn ? statusMessage : "Centre selected. Enter a valid distance to draw the circle.");
    if (committed) commitDraftChange();
  }

  function hideEditState(): void {
    state.editingId = null;
    editOriginal = undefined;
    editBanner.hidden = true;
    editBannerName.textContent = "";
    saveMeasurementButton.textContent = "Save measurement";
  }

  function clearDraft(message = "Choose a centre for your next measurement."): void {
    committedCircle = "";
    draftCanContinue = false;
    reminder.refresh();
    if (draftMarker) draftMarker.removeFrom(map);
    removeDraftCircle();
    draftMarker = null;
    state.center = null;
    state.centerLabel = "";
    changingCenter = false;
    preEditDraft = null;
    pendingSave = false;
    hideEditState();
    searchInput.value = "";
    clearLocationError();
    updateLocationStep();
    updateSummary(validateMeasurement(currentMeasurement(), state.kind, state.unit) ? null : currentMeasurement());
    saveMeasurementButton.disabled = peekSaveButton.disabled = true;
    setStatus(message);
    clearResult();
    renderSavedLayers();
    updateMapOverlays();
    forgetDraft();
  }

  /** Leave edit mode and put back whatever was on the map before it started. */
  function finishEdit(message: string): void {
    const previous = preEditDraft;
    preEditDraft = null;
    const wasEditing = state.editingId !== null;
    hideEditState();
    removeDraftCircle();
    renderSavedLayers();
    if (!previous) {
      if (wasEditing) clearDraft(message);
      return;
    }
    setMeasurementControls(previous.kind, previous.unit, previous.value);
    if (previous.center) {
      searchInput.value = "";
      setCenter(previous.center, previous.centerLabel, message);
    } else {
      clearDraft(message);
    }
  }

  function clearCircle(): void {
    if (state.editingId) {
      finishEdit("Editing cancelled.");
      window.umami?.track("radius-map-edit-cancel");
      return;
    }
    clearDraft(`Circle cleared. Search, use your location or ${finePointer.matches ? "click" : "tap"} the map to choose a new centre.`);
    requestAnimationFrame(fitCurrentView);
    focusNext(searchInput);
  }

  // Saved measurements

  function savedMarkerIcon(measurement: SavedMeasurement, index: number): L.DivIcon {
    const color = SAVED_COLORS[colorIndex(measurement.id)];
    return L.divIcon({
      className: "saved-measurement-marker",
      html: `<span class="saved-map-pin" style="--saved-color:${color}" aria-hidden="true"><b>${index + 1}</b></span>`,
      iconSize: [30, 34],
      iconAnchor: [15, 30],
    });
  }

  function focusSavedMeasurement(id: string): void {
    const measurement = state.saved.find((item) => item.id === id);
    const layer = savedLayers.get(id);
    if (!measurement || !measurement.visible || !layer) {
      setStatus("Show that measurement to focus it on the map.");
      return;
    }
    fitBounds(layer.circle.getBounds());
    setStatus(`Showing ${measurement.name}.`);
    window.umami?.track("radius-map-saved-focus");
  }

  function renderSavedLayers(): void {
    for (const layer of savedLayers.values()) {
      layer.circle.removeFrom(map);
      layer.marker.removeFrom(map);
    }
    savedLayers.clear();

    state.saved.forEach((measurement, index) => {
      if (!measurement.visible || measurement.id === state.editingId) return;
      const color = SAVED_COLORS[colorIndex(measurement.id)];
      const circle = L.circle(measurement.center as LatLngExpression, {
        radius: measurement.radiusMeters,
        color,
        fillColor: color,
        fillOpacity: 0.09,
        opacity: 0.88,
        weight: 2.5,
      }).addTo(map);
      const marker = L.marker(measurement.center as LatLngExpression, {
        icon: savedMarkerIcon(measurement, index),
        keyboard: true,
        title: measurement.name,
        alt: `${measurement.name} centre`,
      }).addTo(map);
      marker.on("click", () => {
        activateTab("saved");
        if (isMobileLayout()) setSheetExpanded(true, { fit: false });
        rowFor(measurement.id)?.scrollIntoView({ block: "nearest" });
        setStatus(`${measurement.name}: ${describeMeasurement(measurement.value, measurement.kind, measurement.unit)}.`);
      });
      savedLayers.set(measurement.id, { circle, marker });
    });
    updateTriangulationAvailability();
    updateMapOverlays();
  }

  function rowFor(id: string): HTMLElement | null {
    return savedList.querySelector<HTMLElement>(`[data-measurement-id="${CSS.escape(id)}"]`);
  }

  function closeRowMenus(except?: HTMLElement): void {
    savedList.querySelectorAll<HTMLButtonElement>(".row-more[aria-expanded='true']").forEach((button) => {
      if (button === except) return;
      button.setAttribute("aria-expanded", "false");
      const actions = button.closest(".saved-item")?.querySelector<HTMLElement>(".saved-item-actions");
      if (actions) actions.hidden = true;
    });
  }

  function renderLibrary(): void {
    savedCount.textContent = String(state.saved.length);
    savedList.replaceChildren();
    const query = librarySearch.value.trim().toLowerCase();
    const matches = state.saved.filter((measurement) =>
      measurement.name.toLowerCase().includes(query) || measurement.locationLabel.toLowerCase().includes(query),
    );
    librarySearchField.hidden = !accountId || state.saved.length === 0;
    libraryEmpty.hidden = !accountId || state.saved.length !== 0;
    libraryNoResults.hidden = !accountId || query.length === 0 || matches.length !== 0;

    matches.forEach((measurement) => {
      const index = state.saved.findIndex((item) => item.id === measurement.id);
      const color = SAVED_COLORS[colorIndex(measurement.id)];
      const item = document.createElement("article");
      item.className = "saved-item";
      item.dataset.measurementId = measurement.id;
      item.style.setProperty("--item-color", color);
      if (!measurement.visible) item.classList.add("is-hidden-measurement");

      const focusButton = document.createElement("button");
      focusButton.className = "saved-item-main";
      focusButton.type = "button";
      focusButton.innerHTML = '<span class="saved-number" aria-hidden="true"></span><span class="saved-item-copy"><strong></strong><span></span></span>';
      queryElement<HTMLElement>(".saved-number", focusButton).textContent = String(index + 1);
      queryElement<HTMLElement>("strong", focusButton).textContent = measurement.name;
      queryElement<HTMLElement>(".saved-item-copy > span", focusButton).textContent =
        `${describeMeasurement(measurement.value, measurement.kind, measurement.unit)} · ${shortenLabel(measurement.locationLabel)}`;
      focusButton.setAttribute("aria-label", `Focus ${measurement.name} on the map`);
      focusButton.addEventListener("click", () => focusSavedMeasurement(measurement.id));

      const visibilityLabel = document.createElement("label");
      visibilityLabel.className = "visibility-switch";
      const visibilityInput = document.createElement("input");
      visibilityInput.type = "checkbox";
      visibilityInput.checked = measurement.visible;
      visibilityInput.setAttribute("aria-label", `${measurement.visible ? "Hide" : "Show"} ${measurement.name}`);
      const visibilityTrack = document.createElement("span");
      visibilityTrack.setAttribute("aria-hidden", "true");
      visibilityLabel.append(visibilityInput, visibilityTrack);
      visibilityInput.addEventListener("change", () => void updateVisibility(measurement, visibilityInput.checked));

      const actionsId = `saved-actions-${index}`;
      const moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "row-more";
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.setAttribute("aria-controls", actionsId);
      moreButton.setAttribute("aria-label", `More actions for ${measurement.name}`);
      moreButton.innerHTML = '<span aria-hidden="true">⋯</span>';

      const actions = document.createElement("div");
      actions.className = "saved-item-actions";
      actions.id = actionsId;
      actions.hidden = true;
      const action = (label: string, run: () => void, className = "uk-button uk-button-quiet") => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        button.addEventListener("click", run);
        return button;
      };
      actions.append(
        action("Edit", () => beginEdit(measurement)),
        action("Rename", () => openRenameDialog(measurement)),
        action("Delete", () => openDeleteDialog(measurement), "uk-button uk-button-quiet delete-action"),
      );
      moreButton.addEventListener("click", () => {
        const open = moreButton.getAttribute("aria-expanded") !== "true";
        closeRowMenus(moreButton);
        moreButton.setAttribute("aria-expanded", String(open));
        actions.hidden = !open;
      });
      actions.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeRowMenus();
        moreButton.focus();
      });
      item.append(focusButton, visibilityLabel, moreButton, actions);
      savedList.append(item);
    });
  }

  async function updateVisibility(measurement: SavedMeasurement, visible: boolean): Promise<void> {
    const namespace = accountId;
    try {
      await changeMeasurement({ ...measurement, visible }, measurement);
      if (namespace !== accountId) return;
      clearResult();
      if (visible) fitVisibleCircles();
      setStatus(`${measurement.name} is now ${visible ? "shown" : "hidden"}.`);
      window.umami?.track("radius-map-visibility-result", { outcome: "success", visibility: visible ? "shown" : "hidden" });
    } catch (error) {
      if (namespace !== accountId) return;
      reportMeasurementFailure("visibility");
      renderLibrary();
      setStatus(error instanceof Error ? error.message : "Visibility could not be updated.", "error");
      window.umami?.track("radius-map-visibility-result", { outcome: "error" });
    }
    // The list was redrawn; keep focus on the same switch.
    rowFor(measurement.id)?.querySelector<HTMLInputElement>("input[type='checkbox']")?.focus();
  }

  // Tabs

  function activateTab(tab: WorkspaceTab, options: { focus?: boolean } = {}): void {
    const changed = tab !== activeTab;
    activeTab = tab;
    reminder.refresh();
    for (const name of tabOrder) {
      const selected = name === tab;
      tabs[name].tab.setAttribute("aria-selected", String(selected));
      tabs[name].tab.tabIndex = selected ? 0 : -1;
      tabs[name].tab.classList.toggle("is-active", selected);
      tabs[name].panel.hidden = !selected;
    }
    if (changed) panelContent.scrollTop = 0;
    if (options.focus) tabs[tab].tab.focus();
    requestAnimationFrame(updateSheetInset);
  }

  function setMeasurementControls(kind: MeasurementKind, unit: DistanceUnit, value: number | string): void {
    state.kind = kind;
    state.unit = unit;
    measurementInput.value = typeof value === "number" ? formatMeasurement(value) : value;
    const kindInput = document.querySelector<HTMLInputElement>(`input[name="measurement-kind"][value="${kind}"]`);
    const unitInput = document.querySelector<HTMLInputElement>(`input[name="distance-unit"][value="${unit}"]`);
    if (kindInput) kindInput.checked = true;
    if (unitInput) unitInput.checked = true;
  }

  function snapshotDraft(): DraftSnapshot {
    return { center: state.center, centerLabel: state.centerLabel, value: measurementInput.value, kind: state.kind, unit: state.unit };
  }

  function beginEdit(measurement: SavedMeasurement): void {
    if (!state.editingId) preEditDraft = snapshotDraft();
    state.editingId = measurement.id;
    editOriginal = measurement;
    setMeasurementControls(measurement.kind, measurement.unit, measurement.value);
    // Redraw so the circle being edited is always dashed.
    removeDraftCircle();
    renderSavedLayers();
    activateTab("create");
    searchInput.value = shortenLabel(measurement.locationLabel);
    setCenter(measurement.center, measurement.locationLabel, "Change the centre or distance, then update the measurement.");
    editBannerName.textContent = measurement.name;
    editBanner.hidden = false;
    saveMeasurementButton.textContent = "Update measurement";
    focusNext(measurementInput);
    window.umami?.track("radius-map-edit-start");
  }

  // Dialogs

  function openDialog(dialog: HTMLDialogElement): void {
    if (!dialog.open) dialog.showModal();
  }

  function openSignInDialog(): void {
    const canSignIn = accountView?.canSignIn ?? false;
    signInDialogCopy.textContent = canSignIn
      ? "Your circle will be kept while you sign in, and saving opens when you come back."
      : navigator.onLine
        ? "Accounts are unavailable right now. Your circle stays on this page."
        : "Go online to sign in. Your circle stays on this page.";
    openDialog(signInDialog);
  }

  function openSaveDialog(): void {
    const draft = currentDraftInput();
    if (!draft) {
      setStatus("Choose a centre and valid distance before saving.", "error");
      return;
    }
    if (!accountId) {
      if (accountView?.signedInId) setStatus("Your account library is still opening. Try again in a moment.");
      else openSignInDialog();
      return;
    }
    saveDialogMode = "save";
    const editing = state.editingId ? state.saved.find((item) => item.id === state.editingId) : null;
    dialogOriginal = editOriginal;
    saveDialogTitle.textContent = editing ? "Update measurement" : "Save measurement";
    saveDialogSubmit.textContent = editing ? "Update" : "Save";
    measurementName.value = editing?.name ?? draft.name;
    saveDialogSummary.textContent = `${describeMeasurement(draft.value, draft.kind, draft.unit)} · ${shortenLabel(draft.locationLabel)}`;
    saveDialogError.hidden = true;
    openDialog(saveDialog);
    requestAnimationFrame(() => measurementName.select());
  }

  function openRenameDialog(measurement: SavedMeasurement): void {
    saveDialogMode = "rename";
    dialogOriginal = measurement;
    saveDialogTitle.textContent = "Rename measurement";
    saveDialogSubmit.textContent = "Rename";
    measurementName.value = measurement.name;
    saveDialogSummary.textContent = `${describeMeasurement(measurement.value, measurement.kind, measurement.unit)} · ${shortenLabel(measurement.locationLabel)}`;
    saveDialogError.hidden = true;
    openDialog(saveDialog);
    requestAnimationFrame(() => measurementName.select());
  }

  async function submitSaveDialog(): Promise<void> {
    const namespace = accountId;
    const operation = saveDialogMode === "rename" ? "rename" : state.editingId ? "update" : "create";
    const name = measurementName.value.trim();
    if (name.length === 0 || name.length > 80) {
      saveDialogError.textContent = "Name the measurement using 80 characters or fewer.";
      saveDialogError.hidden = false;
      window.umami?.track("radius-map-save-result", { operation, outcome: "invalid" });
      return;
    }
    saveDialogSubmit.disabled = true;
    saveDialogError.hidden = true;
    try {
      const tracked = { kind: state.kind, unit: state.unit };
      if (saveDialogMode === "rename") {
        if (!dialogOriginal) throw new Error("Measurement not found.");
        const renamedId = dialogOriginal.id;
        await changeMeasurement({ ...dialogOriginal, name }, dialogOriginal);
        if (namespace !== accountId) return;
        saveDialog.close();
        setStatus(`Renamed to ${name}.`);
        rowFor(renamedId)?.querySelector<HTMLButtonElement>(".row-more")?.focus();
      } else {
        const draft = currentDraftInput(name);
        if (!draft) throw new Error("Choose a centre and valid distance before saving.");
        await changeMeasurement(draft, dialogOriginal);
        if (namespace !== accountId) return;
        saveDialog.close();
        if (operation === "update") finishEdit(`${name} updated.`);
        else clearDraft(`${name} saved. Choose a centre to add another measurement.`);
        // On phones drop to the peek so the newly saved circle is in view.
        if (isMobileLayout()) setSheetExpanded(false);
        focusNext(state.center ? measurementInput : searchInput);
      }
      window.umami?.track("radius-map-save-result", {
        operation,
        outcome: "success",
        ...(operation === "rename" ? {} : tracked),
      });
    } catch (error) {
      if (namespace !== accountId) return;
      saveDialogError.textContent = error instanceof Error ? error.message : "Measurement could not be saved.";
      reportMeasurementFailure(operation);
      saveDialogError.hidden = false;
      window.umami?.track("radius-map-save-result", { operation, outcome: "error" });
    } finally {
      saveDialogSubmit.disabled = false;
    }
  }

  function openDeleteDialog(measurement: SavedMeasurement): void {
    deleteOriginal = measurement;
    deleteDialogCopy.textContent = `“${measurement.name}” will be deleted from your account library when it syncs. You can undo this for a few seconds.`;
    deleteDialogError.hidden = true;
    openDialog(deleteDialog);
  }

  async function restoreDeleted(measurement: SavedMeasurement): Promise<void> {
    const namespace = accountId;
    const { id, createdAt, radiusMeters: _radius, updatedAt: _updated, ...input } = measurement;
    try {
      await changeMeasurement(input, undefined, { id, createdAt });
      if (namespace !== accountId) return;
      setStatus(`Restored ${measurement.name}.`);
      rowFor(id)?.querySelector<HTMLButtonElement>(".saved-item-main")?.focus();
      window.umami?.track("radius-map-delete-result", { outcome: "undone" });
    } catch (error) {
      if (namespace !== accountId) return;
      reportMeasurementFailure("restore");
      setStatus(error instanceof Error ? error.message : "The measurement could not be restored.", "error");
    }
  }

  async function submitDeleteDialog(): Promise<void> {
    const namespace = accountId;
    const measurement = deleteOriginal;
    if (!measurement) return;
    // Focus moves to the row that takes this one's place.
    const rows = [...savedList.querySelectorAll<HTMLElement>(".saved-item")];
    const position = rows.findIndex((row) => row.dataset.measurementId === measurement.id);
    deleteDialogSubmit.disabled = true;
    deleteDialogError.hidden = true;
    try {
      await changeMeasurement(null, measurement);
      if (namespace !== accountId) return;
      if (state.editingId === measurement.id) finishEdit("");
      clearResult();
      deleteDialog.close();
      offerUndo(`Deleted ${measurement.name}.`, () => void restoreDeleted(measurement));
      const remaining = savedList.querySelectorAll<HTMLElement>(".saved-item .saved-item-main");
      const next = remaining[Math.min(Math.max(position, 0), remaining.length - 1)];
      (next ?? statusUndo).focus();
      window.umami?.track("radius-map-delete-result", { outcome: "success" });
    } catch (error) {
      if (namespace !== accountId) return;
      deleteDialogError.textContent = error instanceof Error ? error.message : "Measurement could not be deleted.";
      reportMeasurementFailure("delete");
      deleteDialogError.hidden = false;
      window.umami?.track("radius-map-delete-result", { outcome: "error" });
    } finally {
      deleteDialogSubmit.disabled = false;
    }
  }

  // Best fit

  function bestFitInputs(): BestFitInput[] {
    const inputs: BestFitInput[] = state.saved
      .filter((measurement) => measurement.visible && measurement.id !== state.editingId)
      .map((measurement) => ({ id: measurement.id, label: measurement.name, center: measurement.center, radiusMeters: measurement.radiusMeters }));
    const draft = currentDraftInput();
    if (draft && draftCircle) {
      inputs.push({
        id: state.editingId ? `editing-${state.editingId}` : "current-draft",
        label: state.editingId ? `${editOriginal?.name ?? "Measurement"} (being edited)` : "Current circle (not saved)",
        center: draft.center,
        radiusMeters: measurementToRadiusMeters(draft.value, draft.kind, draft.unit),
      });
    }
    return inputs;
  }

  function updateTriangulationAvailability(): void {
    const inputs = bestFitInputs();
    const count = inputs.length;
    const missing = Math.max(0, 3 - count);
    triangulateButton.disabled = count < 3;
    const signedOut = !accountView?.signedInId;
    bestFitSignIn.hidden = !(signedOut && accountView?.canSignIn && count < 3);
    if (signedOut && count < 3) {
      triangulationHint.textContent = "Best fit needs 3 saved circles. Sign in to save them.";
    } else if (count < 3) {
      triangulationHint.textContent = `Show ${missing} more ${missing === 1 ? "circle" : "circles"} to calculate a point. Saved circles count when they are shown.`;
    } else {
      triangulationHint.textContent = `All ${count} circles above will be used.`;
    }
    triangulationInputs.replaceChildren(...inputs.map((input) => {
      const item = document.createElement("li");
      item.textContent = input.label;
      return item;
    }));
    triangulationCircles.hidden = count === 0;
  }

  function calculateBestFit(): void {
    clearResult();
    const result = triangulateBestFit(bestFitInputs());
    if (!result) {
      triangulationStatus.textContent = "Use at least 3 circles with different centres to calculate a reliable point.";
      triangulationStatus.hidden = false;
      window.umami?.track("radius-map-triangulation-result", { outcome: "insufficient-data" });
      return;
    }
    state.result = result;
    resultMarker = L.marker(result.center as LatLngExpression, {
      icon: resultIcon,
      keyboard: true,
      title: "Estimated best-fit point",
      alt: "Estimated best-fit point",
      zIndexOffset: 1000,
    }).addTo(map);
    const metres = result.rmsErrorMeters;
    const errorValue = state.unit === "km" ? metres / 1_000 : metres / 1_609.344;
    resultCoordinates.textContent = readableCoordinates(result.center);
    resultInputCount.textContent = String(result.inputCount);
    resultError.textContent = `${roughly(errorValue)} ${state.unit}`;
    triangulationResult.hidden = false;
    triangulationStatus.hidden = true;
    fitVisibleCircles();
    setStatus(`Best-fit point found at ${readableCoordinates(result.center)}.`);
    triangulationResult.scrollIntoView({ block: "nearest" });
    triangulationResult.focus({ preventScroll: true });
    window.umami?.track("radius-map-triangulation-result", { outcome: "success" });
  }

  function useBestFitResult(): void {
    if (!state.result) return;
    const coordinates = state.result.center;
    clearResult();
    activateTab("create");
    searchInput.value = "";
    setCenter(coordinates, `Best-fit point · ${readableCoordinates(coordinates)}`, "Best-fit point loaded as the current centre.");
    focusNext(measurementInput);
    window.umami?.track("radius-map-centre-selected", { method: "best-fit" });
  }

  function reportMeasurementFailure(operation: string): void {
    reportFailure(new Error("Account measurement change could not be saved"), `measurement.${operation}`);
  }

  // Place search

  function closeSearchResults(): void {
    searchResults.replaceChildren();
    searchResults.hidden = true;
  }

  function renderSearchResults(results: GeocodeResult[]): void {
    closeSearchResults();
    if (results.length === 0) {
      showLocationError("No matching places found. Try a broader search or enter coordinates.");
      return;
    }
    results.forEach((result, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const number = document.createElement("span");
      const label = document.createElement("span");
      button.type = "button";
      button.className = "search-result-button";
      number.className = "result-index";
      number.setAttribute("aria-hidden", "true");
      number.textContent = String(index + 1);
      label.textContent = result.label;
      button.append(number, label);
      button.addEventListener("click", () => {
        searchInput.value = shortenLabel(result.label);
        closeSearchResults();
        setCenter({ lat: result.lat, lng: result.lng }, result.label, `Circle centred on ${shortenLabel(result.label)}.`, true);
        focusNext(measurementInput);
        window.umami?.track("radius-map-centre-selected", { method: "search" });
      });
      item.append(button);
      searchResults.append(item);
    });
    searchResults.hidden = false;
    setStatus(`${results.length} location ${results.length === 1 ? "match" : "matches"} found.`);
  }

  async function searchForLocation(query: string): Promise<void> {
    let requestId: string | null = null;
    let status: number | null = null;
    let payload: GeocodeResponse | null = null;
    searchButton.disabled = true;
    searchButton.textContent = "Finding…";
    closeSearchResults();
    clearLocationError();
    setStatus("Searching for that location…");
    try {
      const response = await fetch(`/utilities/radius-map/api/geocode.php?q=${encodeURIComponent(query)}`, { headers: { accept: "application/json" } });
      requestId = response.headers.get("x-request-id");
      status = response.status;
      payload = await response.json() as GeocodeResponse;
      if (!response.ok) throw new Error(`Geocode HTTP ${response.status}: ${payload.error ?? "Location search failed."}`);
      renderSearchResults(payload.results ?? []);
      window.umami?.track("radius-map-search-result", { outcome: payload.results?.length ? "matches" : "empty" });
    } catch (error) {
      showLocationError(searchFailureMessage(status, status === 400 ? payload?.error : undefined));
      // A 400 is the visitor's own input; everything else is worth a report.
      if (status !== 400) reportFailure(error, "geocode.search", { queryLength: query.length, requestId, status });
      window.umami?.track("radius-map-search-result", { outcome: "error" });
    } finally {
      searchButton.disabled = false;
      searchButton.textContent = "Find";
    }
  }

  locationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) {
      showLocationError("Enter a place, address, postal code, or latitude and longitude.");
      searchInput.focus();
      window.umami?.track("radius-map-search-result", { outcome: "invalid" });
      return;
    }
    const coordinates = parseCoordinateInput(query);
    if (coordinates) {
      closeSearchResults();
      setCenter(coordinates, `Coordinates · ${readableCoordinates(coordinates)}`, "Circle centred on the entered coordinates.", true);
      focusNext(measurementInput);
      window.umami?.track("radius-map-centre-selected", { method: "coordinates" });
      return;
    }
    const coordinateError = coordinateInputError(query);
    if (coordinateError) {
      closeSearchResults();
      showLocationError(coordinateError);
      searchInput.focus();
      window.umami?.track("radius-map-search-result", { outcome: "invalid" });
      return;
    }
    void searchForLocation(query);
  });

  searchInput.addEventListener("keydown", (event) => {
    // Escape abandons a change of centre and keeps the one already chosen.
    if (event.key !== "Escape" || !state.center || !changingCenter) return;
    event.preventDefault();
    changingCenter = false;
    closeSearchResults();
    clearLocationError();
    updateLocationStep();
    locationChange.focus();
  });

  locateButton.addEventListener("click", () => {
    clearLocationError();
    if (!navigator.geolocation) {
      showLocationError("This browser does not support location access. Search or tap the map instead.");
      window.umami?.track("radius-map-geolocation-result", { outcome: "unsupported" });
      return;
    }
    locateButton.disabled = true;
    locateButton.setAttribute("aria-busy", "true");
    locateLabel.textContent = "Locating…";
    setStatus("Waiting for your browser's location permission…");
    const done = () => {
      locateButton.disabled = false;
      locateButton.removeAttribute("aria-busy");
      locateLabel.textContent = "Use my location";
    };
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        done();
        closeSearchResults();
        searchInput.value = "";
        setCenter(coordinates, `Your location · ${readableCoordinates(coordinates)}`, "Circle centred on your current location.", true);
        focusNext(measurementInput);
        window.umami?.track("radius-map-geolocation-result", { outcome: "success" });
        window.umami?.track("radius-map-centre-selected", { method: "geolocation" });
      },
      (error) => {
        done();
        const messages: Record<number, string> = {
          1: "Location permission was not granted. Search or tap the map instead.",
          2: "Your location could not be determined. Try again or use the map.",
          3: "Location lookup timed out. Try again or use the map.",
        };
        showLocationError(messages[error.code] ?? "Your location could not be determined.");
        locateButton.focus();
        const outcome = error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
        reportState("geolocation", { outcome, code: error.code });
        window.umami?.track("radius-map-geolocation-result", { outcome });
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });

  map.on("click", (event) => {
    const point = map.wrapLatLng(event.latlng);
    const coordinates = { lat: point.lat, lng: point.lng };
    closeSearchResults();
    searchInput.value = "";
    if (activeTab !== "create") activateTab("create");
    setCenter(coordinates, `Dropped pin · ${readableCoordinates(coordinates)}`, "Circle centred on the dropped pin. Drag it to fine-tune the centre.", true);
    window.umami?.track("radius-map-centre-selected", { method: "map" });
  });

  // Distance

  measurementInput.addEventListener("input", () => {
    clearResult();
    clearTimeout(fitTimer);
    // Re-frame shortly after typing stops, so a much larger or smaller circle stays in view.
    if (refreshMeasurement()) fitTimer = setTimeout(fitDraftCircle, 300);
  });
  measurementInput.addEventListener("change", () => {
    clearTimeout(fitTimer);
    const valid = refreshMeasurement({ fit: true, announce: true });
    if (valid) commitDraftChange();
    window.umami?.track("radius-map-measurement-change", { control: "distance", outcome: valid ? "valid" : "invalid" });
  });
  measurementInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(fitTimer);
      if (refreshMeasurement({ fit: true, announce: true })) commitDraftChange();
    }
  });

  document.querySelectorAll<HTMLInputElement>('input[name="measurement-kind"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      clearResult();
      state.kind = input.value as MeasurementKind;
      const valid = refreshMeasurement({ fit: true, announce: true });
      if (valid) commitDraftChange();
      window.umami?.track("radius-map-measurement-change", { control: "kind", kind: state.kind, outcome: valid ? "valid" : "invalid" });
      if (valid) setStatus(state.kind === "radius"
        ? "Using radius. The distance runs from the centre to the circle edge."
        : "Using diameter. The distance runs across the full circle.");
    });
  });

  // The unit names what was typed: 25 stays 25 and the circle is redrawn in the new unit.
  document.querySelectorAll<HTMLInputElement>('input[name="distance-unit"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      clearResult();
      state.unit = input.value as DistanceUnit;
      const valid = refreshMeasurement({ fit: true, announce: true });
      if (valid) commitDraftChange();
      window.umami?.track("radius-map-measurement-change", { control: "unit", unit: state.unit, outcome: valid ? "valid" : "invalid" });
      if (valid) setStatus(`Distance in ${state.unit === "km" ? "kilometres" : "miles"}.`);
    });
  });

  copySummaryButton.addEventListener("click", () => {
    if (!state.center) return;
    const text = `${summaryValue.textContent} around ${shortenLabel(state.centerLabel)} (${readableCoordinates(state.center)})`;
    void copyText(text).then((copied) => setStatus(copied ? "Measurement copied." : `Copy did not work. ${text}`));
  });

  // Tabs: one tab stop, arrow keys move between them.

  for (const name of tabOrder) {
    tabs[name].tab.addEventListener("click", () => {
      activateTab(name);
      window.umami?.track("radius-map-workspace-change", { workspace: name });
    });
  }
  tabList.addEventListener("keydown", (event) => {
    const current = tabOrder.indexOf(activeTab);
    const next = event.key === "ArrowRight" ? (current + 1) % tabOrder.length
      : event.key === "ArrowLeft" ? (current + tabOrder.length - 1) % tabOrder.length
        : event.key === "Home" ? 0
          : event.key === "End" ? tabOrder.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    activateTab(tabOrder[next], { focus: true });
    window.umami?.track("radius-map-workspace-change", { workspace: tabOrder[next] });
  });

  librarySearch.addEventListener("input", renderLibrary);
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".saved-item")) closeRowMenus();
  });
  triangulateButton.addEventListener("click", calculateBestFit);
  useResultButton.addEventListener("click", useBestFitResult);
  copyResultButton.addEventListener("click", () => {
    if (!state.result) return;
    const text = readableCoordinates(state.result.center);
    void copyText(text).then((copied) => setStatus(copied ? `Coordinates copied: ${text}.` : `Copy did not work. The coordinates are ${text}.`));
  });
  cancelEditButton.addEventListener("click", () => {
    finishEdit("Editing cancelled.");
    focusNext(saveMeasurementButton.disabled ? searchInput : measurementInput);
    window.umami?.track("radius-map-edit-cancel");
  });
  locationChange.addEventListener("click", () => {
    changingCenter = true;
    updateLocationStep();
    searchInput.focus();
    searchInput.select();
  });
  locationClear.addEventListener("click", clearCircle);
  centerChipClear.addEventListener("click", clearCircle);
  statusUndo.addEventListener("click", () => {
    const action = undoAction;
    setStatus("Restoring…");
    action?.();
  });
  saveMeasurementButton.addEventListener("click", openSaveDialog);
  peekSaveButton.addEventListener("click", openSaveDialog);
  saveForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitSaveDialog();
  });
  saveDialogCancel.addEventListener("click", () => saveDialog.close());
  saveDialog.addEventListener("click", (event) => {
    if (event.target === saveDialog) saveDialog.close();
  });
  signInDialogCancel.addEventListener("click", () => signInDialog.close());
  signInDialog.addEventListener("click", (event) => {
    if (event.target === signInDialog) signInDialog.close();
  });
  signInToSave.addEventListener("click", (event) => {
    if (!prepareDraftSignIn()) event.preventDefault();
  });
  deleteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitDeleteDialog();
  });
  deleteDialogCancel.addEventListener("click", () => deleteDialog.close());
  deleteDialog.addEventListener("click", (event) => {
    if (event.target === deleteDialog) deleteDialog.close();
  });

  panelToggle.addEventListener("click", () => {
    if (!isMobileLayout()) return;
    setSheetExpanded(!sheetExpanded);
    window.umami?.track("radius-map-controls-toggle", { state: sheetExpanded ? "expanded" : "collapsed" });
  });

  if ("ResizeObserver" in window) new ResizeObserver(updateSheetInset).observe(controlPanel);

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setSheetExpanded(sheetExpanded, { fit: false });
      map.invalidateSize();
      updateMinimumZoom();
      fitCurrentView();
    }, 120);
  });

  function restoreDraft(): void {
    const draft = readDraft();
    if (!draft) return;
    draftCanContinue = true;
    pendingSave = draft.pendingSave;
    setMeasurementControls(draft.kind, draft.unit, draft.value);
    if (draft.center) {
      setCenter(draft.center, draft.centerLabel || `Dropped pin · ${readableCoordinates(draft.center)}`, pendingSave
        ? "Your circle was kept. Saving opens as soon as your account library is ready."
        : "Your circle was kept.");
    }
  }

  setStatus(`Search, use your location or ${finePointer.matches ? "click" : "tap"} the map to choose a centre.`);
  activateTab("create");
  // Phones open on the peek: the search row with most of the map in view.
  setSheetExpanded(false, { fit: false });
  updateMinimumZoom();
  renderLibrary();
  refreshMeasurement();
  updateLocationStep();
  fitWorld();
  restoreDraft();
  committedCircle = draftCircleKey();
  draftTracking = true;
  initializeUtilityUpdate(() => {
    if (state.editingId || document.querySelector("dialog[open]")) return "Finish or cancel your measurement edit before updating.";
    if (pendingWrites) return "Wait for Radius Map to finish saving before updating.";
    if (measurementInput.validity.badInput) return "Finish entering the distance before updating.";
    if ((state.center || measurementInput.value) && !persistDraft()) return "Your draft couldn’t be saved. Finish it before updating.";
    return null;
  });
  accounts.start();
}
