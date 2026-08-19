import L, { type Circle, type LatLngBounds, type LatLngExpression, type Marker } from "leaflet";
import {
  convertDisplayedMeasurement,
  formatMeasurement,
  measurementToRadiusMeters,
  parseCoordinateInput,
  validateMeasurement,
  type Coordinates,
  type DistanceUnit,
  type MeasurementKind,
} from "../lib/distance";
import type { GeocodeResult } from "../lib/geocode";
import {
  type SavedMeasurement,
  type SavedMeasurementInput,
} from "../lib/measurements";
import {
  LocalMeasurementStorageError,
  LocalMeasurementsStore,
} from "../lib/local-measurements-store";
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
  libraryLoaded: boolean;
  editingId: string | null;
  result: TriangulationResult | null;
}

interface SavedLayer {
  circle: Circle;
  marker: Marker;
}

type WorkspaceTab = "create" | "saved";
type SaveDialogMode = "save" | "rename";

const SAVED_COLORS = ["#0d9488", "#0b1c30", "#006a61", "#2563a6", "#7a5a13", "#7b3f72", "#4b6478", "#39715c"];

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

export function initializeRadiusMap(): void {
  if (document.documentElement.dataset.radiusMapReady === "true") return;
  document.documentElement.dataset.radiusMapReady = "true";

  const locationForm = element<HTMLFormElement>("location-form");
  const searchInput = element<HTMLInputElement>("location-search");
  const searchButton = element<HTMLButtonElement>("search-button");
  const searchResults = element<HTMLUListElement>("search-results");
  const locateButton = element<HTMLButtonElement>("locate-button");
  const measurementInput = element<HTMLInputElement>("measurement-value");
  const measurementLabel = element<HTMLLabelElement>("measurement-label");
  const measurementError = element<HTMLParagraphElement>("measurement-error");
  const summaryValue = element<HTMLParagraphElement>("summary-value");
  const summaryCenter = element<HTMLSpanElement>("summary-centre");
  const appStatus = element<HTMLParagraphElement>("app-status");
  const mapHint = element<HTMLDivElement>("map-hint");
  const centerChip = element<HTMLDivElement>("centre-chip");
  const centerChipLabel = element<HTMLElement>("centre-chip-label");
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
  const saveMeasurementButton = element<HTMLButtonElement>("save-measurement-button");
  const cancelEditButton = element<HTMLButtonElement>("cancel-edit-button");
  const librarySearch = element<HTMLInputElement>("library-search");
  const libraryLoading = element<HTMLDivElement>("library-loading");
  const libraryEmpty = element<HTMLDivElement>("library-empty");
  const libraryNoResults = element<HTMLDivElement>("library-no-results");
  const savedList = element<HTMLDivElement>("saved-list");
  const libraryStatus = element<HTMLParagraphElement>("library-status");
  const refreshLibraryButton = element<HTMLButtonElement>("refresh-library-button");
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
    libraryLoaded: false,
    editingId: null,
    result: null,
  };

  const map = L.map("map", {
    center: [25, 0],
    zoom: 2,
    minZoom: 2,
    zoomControl: false,
    worldCopyJump: true,
  });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 19,
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
  let renameTargetId: string | null = null;
  let deleteTargetId: string | null = null;
  let measurementStore: LocalMeasurementsStore | null = null;
  try {
    measurementStore = new LocalMeasurementsStore(window.localStorage);
  } catch {
    measurementStore = null;
  }

  function setStatus(message: string): void {
    appStatus.textContent = message;
  }

  function setLibraryStatus(message: string): void {
    libraryStatus.textContent = message;
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
      if (state.result || draftCircle || savedLayers.size > 0) fitVisibleCircles();
    });
  }

  function mapPadding(): { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] } {
    if (!isMobileLayout()) return { paddingTopLeft: [430, 30], paddingBottomRight: [30, 30] };
    return {
      paddingTopLeft: [24, 52],
      paddingBottomRight: [24, Math.ceil(controlPanel.getBoundingClientRect().height + 24)],
    };
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

  function updateSummary(value: number): void {
    summaryValue.textContent = `${formatMeasurement(value)} ${state.unit} ${state.kind}`;
    summaryCenter.textContent = state.center ? state.centerLabel : "Choose a centre to draw the circle";
  }

  function refreshMeasurement(options: { fit?: boolean; announce?: boolean } = {}): boolean {
    const value = currentMeasurement();
    const error = validateMeasurement(value, state.kind, state.unit);
    measurementError.hidden = !error;
    measurementError.textContent = error ?? "";
    measurementInput.setAttribute("aria-invalid", error ? "true" : "false");

    if (error) {
      summaryCenter.textContent = state.center ? state.centerLabel : "Choose a centre to draw the circle";
      if (draftCircle) {
        draftCircle.removeFrom(map);
        draftCircle = null;
      }
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
        setCenter(moved, `Dropped pin · ${readableCoordinates(moved)}`, "Centre moved. The circle has been updated.");
      });
    } else {
      draftMarker.setLatLng(coordinates as LatLngExpression);
    }

    mapHint.classList.add("is-hidden");
    centerChip.hidden = false;
    centerChipLabel.textContent = shortenLabel(label);
    const circleWasDrawn = refreshMeasurement({ fit: true });
    setStatus(circleWasDrawn ? statusMessage : "Centre selected. Enter a valid measurement to draw the circle.");
  }

  function clearDraft(message = "Choose a centre for your next measurement."): void {
    if (draftMarker) draftMarker.removeFrom(map);
    if (draftCircle) draftCircle.removeFrom(map);
    draftMarker = null;
    draftCircle = null;
    state.center = null;
    state.centerLabel = "";
    state.editingId = null;
    centerChip.hidden = true;
    mapHint.classList.remove("is-hidden");
    searchInput.value = "";
    summaryCenter.textContent = "Choose a centre to draw the circle";
    saveMeasurementButton.disabled = true;
    saveMeasurementButton.textContent = "Save measurement";
    cancelEditButton.hidden = true;
    setStatus(message);
    clearResult();
    renderSavedLayers();
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
      setLibraryStatus("Show that measurement to focus it on the map.");
      return;
    }
    fitBounds(layer.circle.getBounds());
    setLibraryStatus(`Showing ${measurement.name}.`);
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
        setLibraryStatus(`${measurement.name}: ${formatMeasurement(measurement.value)} ${measurement.unit} ${measurement.kind}.`);
      });
      savedLayers.set(measurement.id, { circle, marker });
    });
    updateTriangulationAvailability();
  }

  function sortSaved(): void {
    state.saved.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function replaceSaved(measurement: SavedMeasurement): void {
    const index = state.saved.findIndex((item) => item.id === measurement.id);
    if (index >= 0) state.saved[index] = measurement;
    else state.saved.push(measurement);
    sortSaved();
    renderLibrary();
    renderSavedLayers();
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
    libraryEmpty.hidden = state.saved.length !== 0 || !state.libraryLoaded;
    libraryNoResults.hidden = query.length === 0 || matches.length !== 0;

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

  function requireMeasurementStore(): LocalMeasurementsStore {
    if (!measurementStore) {
      throw new LocalMeasurementStorageError("This browser is blocking access to saved measurements.");
    }
    return measurementStore;
  }

  async function updateVisibility(measurement: SavedMeasurement, visible: boolean): Promise<void> {
    const previous = measurement.visible;
    measurement.visible = visible;
    clearResult();
    renderLibrary();
    renderSavedLayers();
    if (visible) fitVisibleCircles();
    try {
      const updated = requireMeasurementStore().setVisibility(measurement.id, visible);
      if (!updated) throw new Error("Measurement not found.");
      replaceSaved(updated);
      setLibraryStatus(`${measurement.name} is now ${visible ? "shown" : "hidden"}.`);
    } catch (error) {
      measurement.visible = previous;
      renderLibrary();
      renderSavedLayers();
      setLibraryStatus(error instanceof Error ? error.message : "Visibility could not be updated.");
    }
  }

  function activateTab(tab: WorkspaceTab): void {
    const createActive = tab === "create";
    createTab.classList.toggle("is-active", createActive);
    savedTab.classList.toggle("is-active", !createActive);
    createTab.setAttribute("aria-selected", String(createActive));
    savedTab.setAttribute("aria-selected", String(!createActive));
    createPanel.hidden = !createActive;
    savedPanel.hidden = createActive;
    if (!createActive && !state.libraryLoaded) void loadLibrary();
    requestAnimationFrame(updateMobilePanelInset);
  }

  function setMeasurementControls(kind: MeasurementKind, unit: DistanceUnit, value: number): void {
    state.kind = kind;
    state.unit = unit;
    measurementInput.value = formatMeasurement(value);
    measurementLabel.textContent = kind === "radius" ? "Radius" : "Diameter";
    const kindInput = document.querySelector<HTMLInputElement>(`input[name="measurement-kind"][value="${kind}"]`);
    const unitInput = document.querySelector<HTMLInputElement>(`input[name="distance-unit"][value="${unit}"]`);
    if (kindInput) kindInput.checked = true;
    if (unitInput) unitInput.checked = true;
  }

  function beginEdit(measurement: SavedMeasurement): void {
    state.editingId = measurement.id;
    setMeasurementControls(measurement.kind, measurement.unit, measurement.value);
    renderSavedLayers();
    setCenter(measurement.center, measurement.locationLabel, `Editing ${measurement.name}.`);
    saveMeasurementButton.textContent = "Update measurement";
    cancelEditButton.hidden = false;
    activateTab("create");
  }

  function openDialog(dialog: HTMLDialogElement): void {
    if (!dialog.open) dialog.showModal();
  }

  function openSaveDialog(): void {
    const draft = currentDraftInput();
    if (!draft) {
      setStatus("Choose a centre and valid measurement before saving.");
      return;
    }
    saveDialogMode = "save";
    renameTargetId = null;
    const editing = state.editingId ? state.saved.find((item) => item.id === state.editingId) : null;
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
    renameTargetId = measurement.id;
    saveDialogTitle.textContent = "Rename measurement";
    saveDialogSubmit.textContent = "Rename";
    measurementName.value = measurement.name;
    saveDialogSummary.textContent = `${measurementSummary(measurement)} · ${shortenLabel(measurement.locationLabel)}`;
    saveDialogError.hidden = true;
    openDialog(saveDialog);
    requestAnimationFrame(() => measurementName.select());
  }

  async function submitSaveDialog(): Promise<void> {
    const name = measurementName.value.trim();
    if (name.length === 0 || name.length > 80) {
      saveDialogError.textContent = "Name the measurement using 80 characters or fewer.";
      saveDialogError.hidden = false;
      return;
    }
    saveDialogSubmit.disabled = true;
    saveDialogError.hidden = true;
    try {
      if (saveDialogMode === "rename") {
        const measurement = state.saved.find((item) => item.id === renameTargetId);
        if (!measurement) throw new Error("Measurement not found.");
        const updated = requireMeasurementStore().update(measurement.id, { ...measurement, name });
        if (!updated) throw new Error("Measurement not found.");
        replaceSaved(updated);
        setLibraryStatus(`Renamed to ${name}.`);
      } else {
        const draft = currentDraftInput(name);
        if (!draft) throw new Error("Choose a centre and valid measurement before saving.");
        const editingId = state.editingId;
        const saved = editingId
          ? requireMeasurementStore().update(editingId, draft)
          : requireMeasurementStore().create(draft);
        if (!saved) throw new Error("Measurement not found.");
        replaceSaved(saved);
        clearDraft(`${saved.name} saved on this device. Choose a centre to add another measurement.`);
      }
      saveDialog.close();
    } catch (error) {
      saveDialogError.textContent = error instanceof Error ? error.message : "Measurement could not be saved.";
      saveDialogError.hidden = false;
    } finally {
      saveDialogSubmit.disabled = false;
    }
  }

  function openDeleteDialog(measurement: SavedMeasurement): void {
    deleteTargetId = measurement.id;
    deleteDialogCopy.textContent = `“${measurement.name}” will be removed from this browser.`;
    deleteDialogError.hidden = true;
    openDialog(deleteDialog);
  }

  async function submitDeleteDialog(): Promise<void> {
    const measurement = state.saved.find((item) => item.id === deleteTargetId);
    if (!measurement) return;
    deleteDialogSubmit.disabled = true;
    deleteDialogError.hidden = true;
    try {
      const deleted = requireMeasurementStore().delete(measurement.id);
      if (!deleted) throw new Error("Measurement not found.");
      state.saved = state.saved.filter((item) => item.id !== measurement.id);
      if (state.editingId === measurement.id) clearDraft();
      clearResult();
      renderLibrary();
      renderSavedLayers();
      setLibraryStatus(`${measurement.name} deleted.`);
      deleteDialog.close();
    } catch (error) {
      deleteDialogError.textContent = error instanceof Error ? error.message : "Measurement could not be deleted.";
      deleteDialogError.hidden = false;
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
  }

  function useBestFitResult(): void {
    if (!state.result) return;
    const coordinates = state.result.center;
    clearResult();
    activateTab("create");
    setCenter(coordinates, `Best-fit point · ${readableCoordinates(coordinates)}`, "Best-fit point loaded as the current centre.");
  }

  async function loadLibrary(force = false): Promise<void> {
    if (state.libraryLoaded && !force) return;
    libraryLoading.hidden = false;
    refreshLibraryButton.disabled = true;
    setLibraryStatus("");
    try {
      const result = requireMeasurementStore().load();
      state.saved = result.measurements;
      sortSaved();
      state.libraryLoaded = true;
      renderLibrary();
      renderSavedLayers();
      if (state.saved.some((measurement) => measurement.visible)) fitVisibleCircles();
      setLibraryStatus(result.warning ?? (force ? "Saved measurements refreshed from this device." : ""));
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : "Your measurements could not be loaded.");
    } finally {
      libraryLoading.hidden = true;
      refreshLibraryButton.disabled = false;
    }
  }

  function closeSearchResults(): void {
    searchResults.replaceChildren();
    searchResults.hidden = true;
  }

  function renderSearchResults(results: GeocodeResult[]): void {
    closeSearchResults();
    if (results.length === 0) {
      setStatus("No matching places found. Try a broader search or enter coordinates.");
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
      });
      item.append(button);
      searchResults.append(item);
    });
    searchResults.hidden = false;
    setStatus(`${results.length} location ${results.length === 1 ? "match" : "matches"} found.`);
  }

  async function searchForLocation(query: string): Promise<void> {
    searchButton.disabled = true;
    searchButton.textContent = "Finding…";
    closeSearchResults();
    setStatus("Searching for that location…");
    try {
      const response = await fetch(`/utilities/radius-map/api/geocode.php?q=${encodeURIComponent(query)}`, { headers: { accept: "application/json" } });
      const payload = await response.json() as GeocodeResponse;
      if (!response.ok) throw new Error(payload.error ?? "Location search failed.");
      renderSearchResults(payload.results ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Location search is temporarily unavailable.");
    } finally {
      searchButton.disabled = false;
      searchButton.textContent = "Find";
    }
  }

  locationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) {
      setStatus("Enter a place, address, postal code, or latitude and longitude.");
      searchInput.focus();
      return;
    }
    const coordinates = parseCoordinateInput(query);
    if (coordinates) {
      closeSearchResults();
      setCenter(coordinates, `Coordinates · ${readableCoordinates(coordinates)}`, "Circle centred on the entered coordinates.");
      return;
    }
    void searchForLocation(query);
  });

  locateButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("This browser does not support location access. Search or tap the map instead.");
      return;
    }
    locateButton.disabled = true;
    queryElement<HTMLElement>("span:last-child", locateButton).textContent = "Locating…";
    setStatus("Waiting for your browser's location permission…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
        setCenter(coordinates, `Your location · ${readableCoordinates(coordinates)}`, "Circle centred on your current location.");
        locateButton.disabled = false;
        queryElement<HTMLElement>("span:last-child", locateButton).textContent = "Use my location";
      },
      (error) => {
        const messages: Record<number, string> = {
          1: "Location permission was not granted. Search or tap the map instead.",
          2: "Your location could not be determined. Try again or use the map.",
          3: "Location lookup timed out. Try again or use the map.",
        };
        setStatus(messages[error.code] ?? "Your location could not be determined.");
        locateButton.disabled = false;
        queryElement<HTMLElement>("span:last-child", locateButton).textContent = "Use my location";
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });

  map.on("click", (event) => {
    const coordinates = { lat: event.latlng.lat, lng: event.latlng.lng };
    closeSearchResults();
    setCenter(coordinates, `Dropped pin · ${readableCoordinates(coordinates)}`, "Circle centred on the dropped pin. Drag it to fine-tune the centre.");
  });

  measurementInput.addEventListener("input", () => {
    clearResult();
    refreshMeasurement();
  });
  measurementInput.addEventListener("change", () => refreshMeasurement({ fit: true, announce: true }));
  measurementInput.addEventListener("blur", () => refreshMeasurement({ fit: true }));
  measurementInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
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
      if (valid) setStatus(state.kind === "radius"
        ? "Using radius. The entered distance runs from the centre to the circle edge."
        : "Using diameter. The entered distance runs across the full circle.");
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[name="distance-unit"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      clearResult();
      const nextUnit = input.value as DistanceUnit;
      const value = currentMeasurement();
      if (Number.isFinite(value) && value > 0) {
        measurementInput.value = formatMeasurement(convertDisplayedMeasurement(value, state.kind, state.unit, state.kind, nextUnit));
      }
      state.unit = nextUnit;
      refreshMeasurement({ fit: true, announce: true });
    });
  });

  createTab.addEventListener("click", () => activateTab("create"));
  savedTab.addEventListener("click", () => activateTab("saved"));
  librarySearch.addEventListener("input", renderLibrary);
  refreshLibraryButton.addEventListener("click", () => void loadLibrary(true));
  triangulateButton.addEventListener("click", calculateBestFit);
  useResultButton.addEventListener("click", useBestFitResult);
  cancelEditButton.addEventListener("click", () => clearDraft("Editing cancelled."));
  saveMeasurementButton.addEventListener("click", openSaveDialog);
  saveForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitSaveDialog();
  });
  saveDialogCancel.addEventListener("click", () => saveDialog.close());
  saveDialog.addEventListener("click", (event) => {
    if (event.target === saveDialog) saveDialog.close();
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
    if (isMobileLayout()) setControlsCollapsed(!controlPanel.classList.contains("is-collapsed"));
  });
  controlPanel.addEventListener("transitionend", (event) => {
    if (event.propertyName !== "max-height") return;
    updateMobilePanelInset();
    if (draftCircle || savedLayers.size > 0) fitVisibleCircles();
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMobileLayout() && panelContent.hidden) setControlsCollapsed(false);
      else updateMobilePanelInset();
      map.invalidateSize();
      if (draftCircle || savedLayers.size > 0) fitVisibleCircles();
    }, 120);
  });

  updateMobilePanelInset();
  renderLibrary();
  refreshMeasurement();
  void loadLibrary();
}
