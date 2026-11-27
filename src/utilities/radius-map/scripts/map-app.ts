import L, { type Circle, type LatLngBounds, type LatLngExpression, type Marker } from "leaflet";
import { reportFailure, reportState } from "../../../reporting/browser";
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

type WorkspaceTab = "create" | "saved";
type SaveDialogMode = "save" | "rename";

const SAVED_COLORS = ["#0d9488", "#0b1c30", "#006a61", "#2563a6", "#7a5a13", "#7b3f72", "#4b6478", "#39715c"];
/** The inhabited world, used for the first view and whenever nothing is drawn. */
const WORLD_VIEW = L.latLngBounds([[-56, -168], [74, 178]]);
/** Web Mercator stops at ±85.05°. Longitude is left open so the map can wrap. */
const MAP_LIMITS = L.latLngBounds([[-85.0511, -540], [85.0511, 540]]);
const UNDO_DURATION = 6_000;

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

export function initializeRadiusMap(): void {
  if (document.documentElement.dataset.radiusMapReady === "true") return;
  document.documentElement.dataset.radiusMapReady = "true";

  const locationForm = element<HTMLFormElement>("location-form");
  const searchInput = element<HTMLInputElement>("location-search");
  const searchButton = element<HTMLButtonElement>("search-button");
  const searchResults = element<HTMLUListElement>("search-results");
  const locationError = element<HTMLParagraphElement>("location-error");
  const locationClear = element<HTMLButtonElement>("location-clear");
  const locateButton = element<HTMLButtonElement>("locate-button");
  const measurementInput = element<HTMLInputElement>("measurement-value");
  const measurementLabel = element<HTMLLabelElement>("measurement-label");
  const measurementError = element<HTMLParagraphElement>("measurement-error");
  const summaryValue = element<HTMLParagraphElement>("summary-value");
  const summaryDetail = element<HTMLSpanElement>("summary-detail");
  const summaryCenter = element<HTMLSpanElement>("summary-centre");
  const appStatus = element<HTMLParagraphElement>("app-status");
  const statusUndo = element<HTMLButtonElement>("status-undo");
  const mapHint = element<HTMLDivElement>("map-hint");
  const centerChip = element<HTMLDivElement>("centre-chip");
  const centerChipLabel = element<HTMLElement>("centre-chip-label");
  const centerChipClear = element<HTMLButtonElement>("centre-chip-clear");
  const appShell = queryElement<HTMLElement>(".app-shell");
  const controlPanel = queryElement<HTMLElement>(".control-panel");
  const panelContent = element<HTMLDivElement>("panel-content");
  const panelToggle = element<HTMLButtonElement>("panel-toggle");
  const panelToggleLabel = queryElement<HTMLElement>(".panel-toggle-label", panelToggle);
  const createTab = element<HTMLButtonElement>("create-tab");
  const savedTab = element<HTMLButtonElement>("saved-tab");
  const createPanel = element<HTMLDivElement>("create-panel");
  const savedPanel = element<HTMLDivElement>("saved-panel");
  const savedCount = element<HTMLSpanElement>("saved-count");
  const editBanner = element<HTMLDivElement>("edit-banner");
  const editBannerName = element<HTMLElement>("edit-banner-name");
  const saveMeasurementButton = element<HTMLButtonElement>("save-measurement-button");
  const cancelEditButton = element<HTMLButtonElement>("cancel-edit-button");
  const librarySearch = element<HTMLInputElement>("library-search");
  const libraryEmpty = element<HTMLDivElement>("library-empty");
  const libraryNoResults = element<HTMLDivElement>("library-no-results");
  const savedList = element<HTMLDivElement>("saved-list");
  const triangulateButton = element<HTMLButtonElement>("triangulate-button");
  const triangulationHint = element<HTMLParagraphElement>("triangulation-hint");
  const triangulationResult = element<HTMLDivElement>("triangulation-result");
  const triangulationStatus = element<HTMLParagraphElement>("triangulation-status");
  const resultCoordinates = element<HTMLSpanElement>("result-coordinates");
  const resultInputCount = element<HTMLElement>("result-input-count");
  const resultError = element<HTMLElement>("result-error");
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
  L.control.zoom({ position: "topright" }).addTo(map);
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
  let saveDialogMode: SaveDialogMode = "save";
  let editOriginal: SavedMeasurement | undefined;
  let preEditDraft: DraftSnapshot | null = null;
  let dialogOriginal: SavedMeasurement | undefined;
  let deleteOriginal: SavedMeasurement | undefined;
  let accountId: string | null = null;
  let accountView: RadiusAccountView | null = null;
  let accountSnapshot = "";
  let pendingSave = false;
  let draftTracking = false;
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  let undoAction: (() => void) | null = null;
  let fitTimer: ReturnType<typeof setTimeout> | undefined;

  const accounts = bindRadiusAccountControls(view => {
    const previousAccount = accountId;
    const switched = view.accountId !== previousAccount;
    accountId = view.accountId;
    accountView = view;
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

  function setStatus(message: string): void {
    appStatus.textContent = message;
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
    setStatus(message);
  }

  function clearLocationError(): void {
    locationError.textContent = "";
    locationError.hidden = true;
    searchInput.removeAttribute("aria-invalid");
  }

  function persistDraft(): void {
    // An edit belongs to a saved measurement; the draft kept is the one from before it.
    if (!draftTracking || state.editingId) return;
    writeDraft({
      center: state.center,
      centerLabel: state.centerLabel,
      value: measurementInput.value,
      kind: state.kind,
      unit: state.unit,
      pendingSave,
    });
  }

  function isMobileLayout(): boolean {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function updateMobilePanelInset(): void {
    if (!isMobileLayout()) {
      appShell.style.removeProperty("--mobile-panel-height");
      return;
    }
    appShell.style.setProperty("--mobile-panel-height", `${Math.ceil(controlPanel.getBoundingClientRect().height)}px`);
  }

  function setControlsCollapsed(collapsed: boolean): void {
    controlPanel.classList.toggle("is-collapsed", collapsed);
    panelContent.hidden = collapsed;
    panelToggle.setAttribute("aria-expanded", String(!collapsed));
    panelToggle.setAttribute("aria-label", collapsed ? "Show controls" : "Hide controls");
    panelToggleLabel.textContent = collapsed ? "Show controls" : "Hide controls";
    requestAnimationFrame(() => {
      updateMobilePanelInset();
      fitCurrentView();
    });
  }

  function mapPadding(): { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] } {
    if (!isMobileLayout()) return { paddingTopLeft: [430, 30], paddingBottomRight: [30, 30] };
    return {
      paddingTopLeft: [24, 52],
      paddingBottomRight: [24, Math.ceil(controlPanel.getBoundingClientRect().height + 24)],
    };
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

  function currentMeasurement(): number {
    return Number(measurementInput.value);
  }

  function defaultMeasurementName(): string {
    const location = state.centerLabel ? shortenLabel(state.centerLabel) : "Saved measurement";
    const suffix = `${formatMeasurement(currentMeasurement())} ${state.unit} ${state.kind}`;
    return `${location} — ${suffix}`.slice(0, 80);
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
    if (value === null) {
      summaryValue.textContent = "—";
      summaryDetail.textContent = "Enter a distance";
      return;
    }
    const details = measurementDetails(value, state.kind, state.unit);
    summaryValue.textContent = `${formatMeasurement(value)} ${state.unit} ${state.kind}`;
    summaryDetail.textContent = [
      `${formatDerived(details.converted.value)} ${details.converted.unit}`,
      `${formatDerived(details.counterpart.value)} ${state.unit} ${details.counterpart.kind}`,
      `${formatDerived(details.area)} ${state.unit}² area`,
    ].join(" · ");
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

    if (error) {
      updateSummary(null);
      removeDraftCircle();
      saveMeasurementButton.disabled = true;
      if (options.announce) setStatus(error);
      updateTriangulationAvailability();
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
    saveMeasurementButton.disabled = !state.center;
    updateTriangulationAvailability();
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

  function setCenter(coordinates: Coordinates, label: string, statusMessage: string): void {
    clearResult();
    clearLocationError();
    state.center = coordinates;
    state.centerLabel = label;
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
        const point = draftMarker.getLatLng();
        const moved = { lat: point.lat, lng: point.lng };
        searchInput.value = "";
        setCenter(moved, `Dropped pin · ${readableCoordinates(moved)}`, "Centre moved. The circle has been updated.");
        window.umami?.track("radius-map-centre-selected", { method: "drag" });
      });
    } else {
      draftMarker.setLatLng(coordinates as LatLngExpression);
    }

    mapHint.classList.add("is-hidden");
    centerChip.hidden = false;
    locationClear.hidden = false;
    centerChipLabel.textContent = shortenLabel(label);
    const circleWasDrawn = refreshMeasurement({ fit: true });
    setStatus(circleWasDrawn ? statusMessage : "Centre selected. Enter a valid measurement to draw the circle.");
  }

  function hideEditState(): void {
    state.editingId = null;
    editOriginal = undefined;
    editBanner.hidden = true;
    editBannerName.textContent = "";
    saveMeasurementButton.textContent = "Save measurement";
    cancelEditButton.hidden = true;
  }

  function clearDraft(message = "Choose a centre for your next measurement."): void {
    if (draftMarker) draftMarker.removeFrom(map);
    removeDraftCircle();
    draftMarker = null;
    state.center = null;
    state.centerLabel = "";
    preEditDraft = null;
    pendingSave = false;
    hideEditState();
    centerChip.hidden = true;
    locationClear.hidden = true;
    mapHint.classList.remove("is-hidden");
    searchInput.value = "";
    clearLocationError();
    updateSummary(validateMeasurement(currentMeasurement(), state.kind, state.unit) ? null : currentMeasurement());
    saveMeasurementButton.disabled = true;
    setStatus(message);
    clearResult();
    renderSavedLayers();
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
    clearDraft("Circle cleared. Search, use your location or tap the map to choose a new centre.");
    fitCurrentView();
  }

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
        document.querySelector<HTMLElement>(`[data-measurement-id="${measurement.id}"]`)?.scrollIntoView({ block: "nearest" });
        setStatus(`${measurement.name}: ${formatMeasurement(measurement.value)} ${measurement.unit} ${measurement.kind}.`);
      });
      savedLayers.set(measurement.id, { circle, marker });
    });
    updateTriangulationAvailability();
  }

  function measurementSummary(measurement: SavedMeasurement): string {
    return `${formatMeasurement(measurement.value)} ${measurement.unit} ${measurement.kind}`;
  }

  function renderLibrary(): void {
    savedCount.textContent = String(state.saved.length);
    savedList.replaceChildren();
    const query = librarySearch.value.trim().toLowerCase();
    const matches = state.saved.filter((measurement) =>
      measurement.name.toLowerCase().includes(query) || measurement.locationLabel.toLowerCase().includes(query),
    );
    librarySearch.disabled = !accountId;
    libraryEmpty.hidden = !accountId || state.saved.length !== 0;
    libraryNoResults.hidden = !accountId || query.length === 0 || matches.length !== 0;

    matches.forEach((measurement) => {
      const index = state.saved.findIndex((item) => item.id === measurement.id);
      const color = SAVED_COLORS[colorIndex(measurement.id)];
      const item = document.createElement("article");
      item.className = "saved-item";
      item.dataset.measurementId = measurement.id;
      item.style.setProperty("--item-color", color);

      const focusButton = document.createElement("button");
      focusButton.className = "saved-item-main";
      focusButton.type = "button";
      focusButton.innerHTML = `<span class="saved-number" aria-hidden="true">${index + 1}</span><span class="saved-item-copy"><strong></strong><span></span><small></small></span>`;
      queryElement<HTMLElement>("strong", focusButton).textContent = measurement.name;
      queryElement<HTMLElement>(".saved-item-copy > span", focusButton).textContent = measurementSummary(measurement);
      queryElement<HTMLElement>("small", focusButton).textContent = shortenLabel(measurement.locationLabel);
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

      const actions = document.createElement("div");
      actions.className = "saved-item-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => beginEdit(measurement));
      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.textContent = "Rename";
      renameButton.addEventListener("click", () => openRenameDialog(measurement));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.className = "delete-text-action";
      deleteButton.addEventListener("click", () => openDeleteDialog(measurement));
      actions.append(editButton, renameButton, deleteButton);
      item.append(focusButton, visibilityLabel, actions);
      savedList.append(item);
    });
  }

  async function updateVisibility(measurement: SavedMeasurement, visible: boolean): Promise<void> {
    const namespace = accountId;
    try {
      await accounts.change({ ...measurement, visible }, measurement);
      if (namespace !== accountId) return;
      clearResult();
      if (visible) fitVisibleCircles();
      setStatus(`${measurement.name} is now ${visible ? "shown" : "hidden"}.`);
      window.umami?.track("radius-map-visibility-result", { outcome: "success", visibility: visible ? "shown" : "hidden" });
    } catch (error) {
      if (namespace !== accountId) return;
      reportMeasurementFailure("visibility");
      renderLibrary();
      setStatus(error instanceof Error ? error.message : "Visibility could not be updated.");
      window.umami?.track("radius-map-visibility-result", { outcome: "error" });
    }
  }

  function activateTab(tab: WorkspaceTab): void {
    const createActive = tab === "create";
    const changed = createPanel.hidden === createActive;
    createTab.classList.toggle("is-active", createActive);
    savedTab.classList.toggle("is-active", !createActive);
    createTab.setAttribute("aria-selected", String(createActive));
    savedTab.setAttribute("aria-selected", String(!createActive));
    createPanel.hidden = !createActive;
    savedPanel.hidden = createActive;
    if (changed) panelContent.scrollTop = 0;
    requestAnimationFrame(updateMobilePanelInset);
  }

  function setMeasurementControls(kind: MeasurementKind, unit: DistanceUnit, value: number | string): void {
    state.kind = kind;
    state.unit = unit;
    measurementInput.value = typeof value === "number" ? formatMeasurement(value) : value;
    measurementLabel.textContent = kind === "radius" ? "Radius" : "Diameter";
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
    searchInput.value = shortenLabel(measurement.locationLabel);
    setCenter(measurement.center, measurement.locationLabel, `Editing ${measurement.name}.`);
    editBannerName.textContent = measurement.name;
    editBanner.hidden = false;
    saveMeasurementButton.textContent = "Update measurement";
    cancelEditButton.hidden = false;
    activateTab("create");
    window.umami?.track("radius-map-edit-start");
  }

  function openDialog(dialog: HTMLDialogElement): void {
    if (!dialog.open) dialog.showModal();
  }

  function openSignInDialog(): void {
    const canSignIn = accountView?.canSignIn ?? false;
    signInDialogCopy.textContent = canSignIn
      ? "Saving needs a free account. Your circle will be kept while you sign in."
      : navigator.onLine
        ? "Saving needs an account, and accounts are unavailable right now. Your circle stays on this page."
        : "Saving needs an account. Go online to sign in; your circle stays on this page.";
    openDialog(signInDialog);
  }

  function openSaveDialog(): void {
    const draft = currentDraftInput();
    if (!draft) {
      setStatus("Choose a centre and valid measurement before saving.");
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
    saveDialogSummary.textContent = `${measurementSummary({ ...draft, id: "", radiusMeters: 0, createdAt: "", updatedAt: "" })} · ${shortenLabel(draft.locationLabel)}`;
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
    saveDialogSummary.textContent = `${measurementSummary(measurement)} · ${shortenLabel(measurement.locationLabel)}`;
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
        await accounts.change({ ...dialogOriginal, name }, dialogOriginal);
        if (namespace !== accountId) return;
        setStatus(`Renamed to ${name}.`);
      } else {
        const draft = currentDraftInput(name);
        if (!draft) throw new Error("Choose a centre and valid measurement before saving.");
        await accounts.change(draft, dialogOriginal);
        if (namespace !== accountId) return;
        if (operation === "update") finishEdit(`${name} updated.`);
        else clearDraft(`${name} saved. Choose a centre to add another measurement.`);
      }
      saveDialog.close();
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
    deleteDialogCopy.textContent = `“${measurement.name}” will be deleted from your account library when it syncs.`;
    deleteDialogError.hidden = true;
    openDialog(deleteDialog);
  }

  async function restoreDeleted(measurement: SavedMeasurement): Promise<void> {
    const namespace = accountId;
    const { id, createdAt, radiusMeters: _radius, updatedAt: _updated, ...input } = measurement;
    try {
      await accounts.change(input, undefined, { id, createdAt });
      if (namespace !== accountId) return;
      setStatus(`Restored ${measurement.name}.`);
      window.umami?.track("radius-map-delete-result", { outcome: "undone" });
    } catch (error) {
      if (namespace !== accountId) return;
      reportMeasurementFailure("restore");
      setStatus(error instanceof Error ? error.message : "The measurement could not be restored.");
    }
  }

  async function submitDeleteDialog(): Promise<void> {
    const namespace = accountId;
    const measurement = deleteOriginal;
    if (!measurement) return;
    deleteDialogSubmit.disabled = true;
    deleteDialogError.hidden = true;
    try {
      await accounts.change(null, measurement);
      if (namespace !== accountId) return;
      if (state.editingId === measurement.id) clearDraft();
      clearResult();
      deleteDialog.close();
      offerUndo(`Deleted ${measurement.name}.`, () => void restoreDeleted(measurement));
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

  function visibleTriangulationInputs(): TriangulationInput[] {
    const inputs: TriangulationInput[] = state.saved
      .filter((measurement) => measurement.visible && measurement.id !== state.editingId)
      .map((measurement) => ({ id: measurement.id, center: measurement.center, radiusMeters: measurement.radiusMeters }));
    const draft = currentDraftInput();
    if (draft && draftCircle) {
      inputs.push({
        id: state.editingId ? `editing-${state.editingId}` : "current-draft",
        center: draft.center,
        radiusMeters: measurementToRadiusMeters(draft.value, draft.kind, draft.unit),
      });
    }
    return inputs;
  }

  function updateTriangulationAvailability(): void {
    const count = visibleTriangulationInputs().length;
    triangulateButton.disabled = count < 3;
    triangulationHint.textContent = count < 3
      ? `Show ${3 - count} more ${3 - count === 1 ? "circle" : "circles"} to calculate a centre.`
      : `${count} visible circles will be used${draftCircle ? ", including the current draft" : ""}.`;
  }

  function formatErrorDistance(meters: number): string {
    const value = state.unit === "km" ? meters / 1_000 : meters / 1_609.344;
    return `${formatMeasurement(Math.max(value, 0.00001))} ${state.unit}`;
  }

  function calculateBestFit(): void {
    clearResult();
    const result = triangulateBestFit(visibleTriangulationInputs());
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
    resultCoordinates.textContent = readableCoordinates(result.center);
    resultInputCount.textContent = String(result.inputCount);
    resultError.textContent = formatErrorDistance(result.rmsErrorMeters);
    triangulationResult.hidden = false;
    triangulationStatus.hidden = true;
    fitVisibleCircles();
    window.umami?.track("radius-map-triangulation-result", { outcome: "success" });
  }

  function useBestFitResult(): void {
    if (!state.result) return;
    const coordinates = state.result.center;
    clearResult();
    activateTab("create");
    searchInput.value = "";
    setCenter(coordinates, `Best-fit point · ${readableCoordinates(coordinates)}`, "Best-fit point loaded as the current centre.");
    window.umami?.track("radius-map-centre-selected", { method: "best-fit" });
  }

  function reportMeasurementFailure(operation: string): void {
    reportFailure(new Error("Account measurement change could not be saved"), `measurement.${operation}`);
  }

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
        setCenter({ lat: result.lat, lng: result.lng }, result.label, `Circle centred on ${shortenLabel(result.label)}.`);
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
      setCenter(coordinates, `Coordinates · ${readableCoordinates(coordinates)}`, "Circle centred on the entered coordinates.");
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

  locateButton.addEventListener("click", () => {
    clearLocationError();
    if (!navigator.geolocation) {
      showLocationError("This browser does not support location access. Search or tap the map instead.");
      window.umami?.track("radius-map-geolocation-result", { outcome: "unsupported" });
      return;
    }
    locateButton.disabled = true;
    queryElement<HTMLElement>("span:last-child", locateButton).textContent = "Locating…";
    setStatus("Waiting for your browser's location permission…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        closeSearchResults();
        searchInput.value = "";
        setCenter(coordinates, `Your location · ${readableCoordinates(coordinates)}`, "Circle centred on your current location.");
        window.umami?.track("radius-map-geolocation-result", { outcome: "success" });
        window.umami?.track("radius-map-centre-selected", { method: "geolocation" });
        locateButton.disabled = false;
        queryElement<HTMLElement>("span:last-child", locateButton).textContent = "Use my location";
      },
      (error) => {
        const messages: Record<number, string> = {
          1: "Location permission was not granted. Search or tap the map instead.",
          2: "Your location could not be determined. Try again or use the map.",
          3: "Location lookup timed out. Try again or use the map.",
        };
        showLocationError(messages[error.code] ?? "Your location could not be determined.");
        const outcome = error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
        reportState("geolocation", { outcome, code: error.code });
        window.umami?.track("radius-map-geolocation-result", { outcome });
        locateButton.disabled = false;
        queryElement<HTMLElement>("span:last-child", locateButton).textContent = "Use my location";
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });

  map.on("click", (event) => {
    const coordinates = { lat: event.latlng.lat, lng: event.latlng.lng };
    closeSearchResults();
    searchInput.value = "";
    setCenter(coordinates, `Dropped pin · ${readableCoordinates(coordinates)}`, "Circle centred on the dropped pin. Drag it to fine-tune the centre.");
    window.umami?.track("radius-map-centre-selected", { method: "map" });
  });

  measurementInput.addEventListener("input", () => {
    clearResult();
    clearTimeout(fitTimer);
    // Re-frame shortly after typing stops, so a much larger or smaller circle stays in view.
    if (refreshMeasurement()) fitTimer = setTimeout(fitDraftCircle, 300);
  });
  measurementInput.addEventListener("change", () => {
    clearTimeout(fitTimer);
    const valid = refreshMeasurement({ fit: true, announce: true });
    window.umami?.track("radius-map-measurement-change", { control: "distance", outcome: valid ? "valid" : "invalid" });
  });
  measurementInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(fitTimer);
      refreshMeasurement({ fit: true, announce: true });
    }
  });

  document.querySelectorAll<HTMLInputElement>('input[name="measurement-kind"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      clearResult();
      state.kind = input.value as MeasurementKind;
      measurementLabel.textContent = state.kind === "radius" ? "Radius" : "Diameter";
      const valid = refreshMeasurement({ fit: true, announce: true });
      window.umami?.track("radius-map-measurement-change", { control: "kind", kind: state.kind, outcome: valid ? "valid" : "invalid" });
      if (valid) setStatus(state.kind === "radius"
        ? "Using radius. The entered distance runs from the centre to the circle edge."
        : "Using diameter. The entered distance runs across the full circle.");
    });
  });

  // The unit names what was typed: 25 stays 25 and the circle is redrawn in the new unit.
  document.querySelectorAll<HTMLInputElement>('input[name="distance-unit"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      clearResult();
      state.unit = input.value as DistanceUnit;
      const valid = refreshMeasurement({ fit: true, announce: true });
      window.umami?.track("radius-map-measurement-change", { control: "unit", unit: state.unit, outcome: valid ? "valid" : "invalid" });
      if (valid) setStatus(`Distance in ${state.unit === "km" ? "kilometres" : "miles"}.`);
    });
  });

  createTab.addEventListener("click", () => {
    activateTab("create");
    window.umami?.track("radius-map-workspace-change", { workspace: "create" });
  });
  savedTab.addEventListener("click", () => {
    activateTab("saved");
    window.umami?.track("radius-map-workspace-change", { workspace: "saved" });
  });
  librarySearch.addEventListener("input", renderLibrary);
  triangulateButton.addEventListener("click", calculateBestFit);
  useResultButton.addEventListener("click", useBestFitResult);
  cancelEditButton.addEventListener("click", () => {
    finishEdit("Editing cancelled.");
    window.umami?.track("radius-map-edit-cancel");
  });
  locationClear.addEventListener("click", clearCircle);
  centerChipClear.addEventListener("click", clearCircle);
  statusUndo.addEventListener("click", () => {
    const action = undoAction;
    setStatus("Restoring…");
    action?.();
  });
  saveMeasurementButton.addEventListener("click", openSaveDialog);
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
  signInToSave.addEventListener("click", () => {
    pendingSave = true;
    persistDraft();
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
    if (isMobileLayout()) {
      const collapsed = !controlPanel.classList.contains("is-collapsed");
      setControlsCollapsed(collapsed);
      window.umami?.track("radius-map-controls-toggle", { state: collapsed ? "collapsed" : "expanded" });
    }
  });
  controlPanel.addEventListener("transitionend", (event) => {
    if (event.propertyName !== "max-height") return;
    updateMobilePanelInset();
    fitCurrentView();
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMobileLayout() && panelContent.hidden) setControlsCollapsed(false);
      else updateMobilePanelInset();
      map.invalidateSize();
      updateMinimumZoom();
      fitCurrentView();
    }, 120);
  });

  function restoreDraft(): void {
    const draft = readDraft();
    if (!draft) return;
    pendingSave = draft.pendingSave;
    setMeasurementControls(draft.kind, draft.unit, draft.value);
    if (draft.center) {
      setCenter(draft.center, draft.centerLabel || `Dropped pin · ${readableCoordinates(draft.center)}`, pendingSave
        ? "Your circle was kept. Saving opens as soon as your account library is ready."
        : "Your circle was kept.");
    }
  }

  updateMobilePanelInset();
  updateMinimumZoom();
  fitWorld();
  renderLibrary();
  refreshMeasurement();
  restoreDraft();
  draftTracking = true;
  accounts.start();
}
