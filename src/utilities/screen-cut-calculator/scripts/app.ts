import { reportState } from "../../../reporting/browser";
import {
  calculateFrameCuts,
  convertMeasurement,
  cutListText,
  formatLength,
  formatMeasurement,
  type CalculationError,
  type CalculationResult,
  type CalculatorField,
  type DimensionPair,
  type FrameCutCalculation,
  type MeasurementUnit,
  type RoundingIncrementMm,
} from "../lib/calculator";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  type ScreenCutSettings,
} from "../lib/settings";

/** Wait this long after the last keystroke before recalculating. */
const RECALCULATE_DELAY_MS = 400;
/** Below this width the form and the cut list stack, so the page adds the cut bar and Show cut list. */
const STACKED_LAYOUT_QUERY = "(max-width: 899.98px)";
const EMPTY = "—";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Screen Cut Calculator is missing ${selector}.`);
  return element;
}

function parseInput(input: HTMLInputElement): number {
  return input.value.trim() === "" ? Number.NaN : input.valueAsNumber;
}

function measurement(valueMm: number): string {
  return `${formatMeasurement(valueMm)} mm`;
}

function pair(valueMm: DimensionPair, unit: MeasurementUnit): string {
  return `${formatMeasurement(convertMeasurement(valueMm.width, "mm", unit))} × ${formatLength(valueMm.height, unit)}`;
}

function readStoredSettings(): ScreenCutSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return parseSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStoredSettings(settings: ScreenCutSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage is unavailable (private mode, blocked): settings last for this visit only.
  }
}

export function initializeScreenCutCalculator(): void {
  const form = requiredElement<HTMLFormElement>("#screen-cut-form");
  const widthInput = requiredElement<HTMLInputElement>("#opening-width");
  const heightInput = requiredElement<HTMLInputElement>("#opening-height");
  const unitInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="opening-unit"]'));
  const unitHint = requiredElement<HTMLElement>("#unit-hint");
  const unitHintSwitch = requiredElement<HTMLButtonElement>("#unit-hint-switch");
  const clearanceSelect = requiredElement<HTMLSelectElement>("#clearance-select");
  const customClearanceField = requiredElement<HTMLElement>("#custom-clearance-field");
  const customClearanceInput = requiredElement<HTMLInputElement>("#custom-clearance");
  const roundingSelect = requiredElement<HTMLSelectElement>("#rounding-select");
  const advancedSettings = requiredElement<HTMLDetailsElement>("#advanced-settings");
  const cornerExtensionInput = requiredElement<HTMLInputElement>("#corner-extension");
  const cornerAllowanceLabels = [
    requiredElement<HTMLElement>("#total-corner-allowance"),
    requiredElement<HTMLElement>("#advanced-corner-allowance"),
  ];
  const restoreButton = requiredElement<HTMLButtonElement>("#restore-defaults");
  const settingsStatus = requiredElement<HTMLElement>("#settings-status");
  const clearButton = requiredElement<HTMLButtonElement>("#reset-calculator");
  const errorSummary = requiredElement<HTMLElement>("#form-error-summary");
  const errorSummaryText = requiredElement<HTMLElement>("#form-error-summary-text");
  const errorSummaryOpen = requiredElement<HTMLButtonElement>("#form-error-summary-open");
  const resultsPanel = requiredElement<HTMLElement>("#results-panel");
  const resultEmpty = requiredElement<HTMLElement>("#result-empty");
  const resultHeading = requiredElement<HTMLElement>("#cut-list-heading");
  const cutRows = requiredElement<HTMLElement>(".cut-list");
  const calculationStatus = requiredElement<HTMLElement>("#calculation-status");
  const copyButton = requiredElement<HTMLButtonElement>("#copy-cut-list");
  const copyStatus = requiredElement<HTMLElement>("#copy-status");
  const cutBar = requiredElement<HTMLButtonElement>("#cut-bar");
  const cutBarHorizontal = requiredElement<HTMLElement>("#cut-bar-horizontal");
  const cutBarVertical = requiredElement<HTMLElement>("#cut-bar-vertical");
  const openingUnitLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-opening-unit]"));
  const resultUnitLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-result-unit]"));
  const stackedLayout = window.matchMedia(STACKED_LAYOUT_QUERY);

  const errorElements: Record<CalculatorField, HTMLElement> = {
    openingWidth: requiredElement<HTMLElement>("#opening-width-error"),
    openingHeight: requiredElement<HTMLElement>("#opening-height-error"),
    clearanceMm: requiredElement<HTMLElement>("#clearance-error"),
    cornerExtensionPerEndMm: requiredElement<HTMLElement>("#corner-error"),
    roundingIncrementMm: requiredElement<HTMLElement>("#rounding-error"),
  };

  const fieldControls: Record<CalculatorField, HTMLInputElement | HTMLSelectElement> = {
    openingWidth: widthInput,
    openingHeight: heightInput,
    clearanceMm: clearanceSelect,
    cornerExtensionPerEndMm: cornerExtensionInput,
    roundingIncrementMm: roundingSelect,
  };
  const allControls = [...Object.values(fieldControls), customClearanceInput];

  let currentUnit: MeasurementUnit = "mm";
  let storedSettings = readStoredSettings();
  /** After Show cut list (or Enter), every error shows until the next valid result. */
  let submitted = false;
  let shownErrorFields = new Set<CalculatorField>();
  let pendingUpdate: number | undefined;
  let lastAnnouncement = "";
  let lastResult: FrameCutCalculation | null = null;

  function controlFor(field: CalculatorField): HTMLInputElement | HTMLSelectElement {
    if (field === "clearanceMm" && clearanceSelect.value === "custom") return customClearanceInput;
    return fieldControls[field];
  }

  function focusedField(): CalculatorField | null {
    const active = document.activeElement;
    if (active === customClearanceInput) return "clearanceMm";
    const entry = (Object.entries(fieldControls) as [CalculatorField, Element][])
      .find(([, control]) => control === active);
    return entry ? entry[0] : null;
  }

  /** An opening dimension not entered yet. Settings have defaults, so an emptied setting is an error. */
  function isOpeningNotEntered(field: CalculatorField): boolean {
    if (field !== "openingWidth" && field !== "openingHeight") return false;
    const control = fieldControls[field] as HTMLInputElement;
    return control.value.trim() === "" && !control.validity.badInput;
  }

  /**
   * Errors wait for the user: a dimension not entered yet is only reported
   * after Show cut list, and an error caused by the field being typed in waits
   * until it loses focus, unless that error is already showing.
   */
  function visibleErrors(errors: CalculationError[]): CalculationError[] {
    if (submitted) return errors;
    const focused = focusedField();
    return errors.filter((error) => {
      if (isOpeningNotEntered(error.field)) return false;
      const beingEdited = focused !== null && (error.field === focused || Boolean(error.relatedFields?.includes(focused)));
      return !beingEdited || shownErrorFields.has(error.field);
    });
  }

  function renderErrors(errors: CalculationError[]): void {
    const grouped = new Map<CalculatorField, string[]>();
    errors.forEach((error) => grouped.set(error.field, [...(grouped.get(error.field) ?? []), error.message]));

    (Object.entries(errorElements) as [CalculatorField, HTMLElement][]).forEach(([field, element]) => {
      const messages = grouped.get(field);
      element.textContent = messages ? messages.join(" ") : "";
      element.hidden = !messages;
    });
    allControls.forEach((control) => control.removeAttribute("aria-invalid"));
    grouped.forEach((_, field) => controlFor(field).setAttribute("aria-invalid", "true"));
    shownErrorFields = new Set(grouped.keys());

    // Errors print once, under their field. The only exception is a field
    // hidden inside the closed Advanced section.
    const advancedMessages = grouped.get("cornerExtensionPerEndMm");
    const summarize = Boolean(advancedMessages) && !advancedSettings.open;
    errorSummary.hidden = !summarize;
    errorSummaryText.textContent = summarize && advancedMessages ? `Advanced: ${advancedMessages.join(" ")}` : "";
  }

  function announce(message: string): void {
    if (message === lastAnnouncement) return;
    lastAnnouncement = message;
    calculationStatus.textContent = message;
  }

  function setText(selector: string, value: string): void {
    requiredElement<HTMLElement>(selector).textContent = value;
  }

  function renderCut(prefix: "horizontal" | "vertical", exactMm: number, practicalMm: number): void {
    const otherUnit: MeasurementUnit = currentUnit === "mm" ? "cm" : "mm";
    setText(`#${prefix}-cut`, formatMeasurement(convertMeasurement(practicalMm, "mm", currentUnit)));
    const secondary = requiredElement<HTMLElement>(`#${prefix}-secondary`);
    secondary.textContent = formatLength(practicalMm, otherUnit);
    secondary.hidden = false;
    const exact = requiredElement<HTMLElement>(`#${prefix}-exact`);
    const wasRounded = exactMm !== practicalMm;
    exact.textContent = wasRounded ? `Rounded from ${formatLength(exactMm, currentUnit)}` : "";
    exact.hidden = !wasRounded;
  }

  const breakdownIds = [
    "opening-width", "width-clearance", "finished-width", "width-corner", "horizontal-exact", "horizontal-rounded",
    "opening-height", "height-clearance", "finished-height", "height-corner", "vertical-exact", "vertical-rounded",
  ];

  function renderBreakdown(result: FrameCutCalculation | null): void {
    if (!result) {
      breakdownIds.forEach((id) => setText(`#breakdown-${id}`, EMPTY));
      return;
    }
    setText("#breakdown-opening-width", measurement(result.openingMm.width));
    setText("#breakdown-width-clearance", `− ${measurement(result.clearanceMm)}`);
    setText("#breakdown-finished-width", measurement(result.finishedMm.width));
    setText("#breakdown-width-corner", `− ${measurement(result.totalCornerAllowanceMm)}`);
    setText("#breakdown-horizontal-exact", measurement(result.horizontal.exactMm));
    setText("#breakdown-horizontal-rounded", measurement(result.horizontal.practicalMm));

    setText("#breakdown-opening-height", measurement(result.openingMm.height));
    setText("#breakdown-height-clearance", `− ${measurement(result.clearanceMm)}`);
    setText("#breakdown-finished-height", measurement(result.finishedMm.height));
    setText("#breakdown-height-corner", `− ${measurement(result.totalCornerAllowanceMm)}`);
    setText("#breakdown-vertical-exact", measurement(result.vertical.exactMm));
    setText("#breakdown-vertical-rounded", measurement(result.vertical.practicalMm));

    requiredElement<HTMLElement>("#breakdown-horizontal-rounded-row").hidden =
      result.horizontal.exactMm === result.horizontal.practicalMm;
    requiredElement<HTMLElement>("#breakdown-vertical-rounded-row").hidden =
      result.vertical.exactMm === result.vertical.practicalMm;
  }

  function renderResult(result: FrameCutCalculation): void {
    if (!lastResult || cutListText(lastResult, currentUnit) !== cutListText(result, currentUnit)) {
      copyStatus.textContent = "";
    }
    lastResult = result;
    resultEmpty.hidden = true;
    resultUnitLabels.forEach((label) => { label.textContent = currentUnit; });
    renderCut("horizontal", result.horizontal.exactMm, result.horizontal.practicalMm);
    renderCut("vertical", result.vertical.exactMm, result.vertical.practicalMm);

    setText("#finished-frame-size", pair(result.builtFrameMm, currentUnit));
    const frameNote = requiredElement<HTMLElement>("#finished-frame-note");
    const frameRounded = result.builtFrameMm.width !== result.finishedMm.width
      || result.builtFrameMm.height !== result.finishedMm.height;
    frameNote.textContent = frameRounded ? `From the rounded cuts. Before rounding: ${pair(result.finishedMm, currentUnit)}.` : "";
    frameNote.hidden = !frameRounded;

    renderBreakdown(result);
    copyButton.disabled = false;

    cutBarHorizontal.textContent = `2 × ${formatLength(result.horizontal.practicalMm, currentUnit)}`;
    cutBarVertical.textContent = `2 × ${formatLength(result.vertical.practicalMm, currentUnit)}`;
    cutBar.hidden = false;
    document.body.classList.add("has-cut-bar");
  }

  function hideResults(): void {
    lastResult = null;
    resultEmpty.hidden = false;
    resultUnitLabels.forEach((label) => { label.textContent = currentUnit; });
    ["horizontal", "vertical"].forEach((prefix) => {
      setText(`#${prefix}-cut`, EMPTY);
      requiredElement<HTMLElement>(`#${prefix}-secondary`).hidden = true;
      requiredElement<HTMLElement>(`#${prefix}-exact`).hidden = true;
    });
    setText("#finished-frame-size", EMPTY);
    requiredElement<HTMLElement>("#finished-frame-note").hidden = true;
    renderBreakdown(null);
    copyButton.disabled = true;
    copyStatus.textContent = "";
    cutBar.hidden = true;
    document.body.classList.remove("has-cut-bar");
  }

  function resultAnnouncement(result: FrameCutCalculation): string {
    const word = currentUnit === "cm" ? "centimetres" : "millimetres";
    const length = (valueMm: number) => formatMeasurement(convertMeasurement(valueMm, "mm", currentUnit));
    return `Cut list: top and bottom, 2 pieces at ${length(result.horizontal.practicalMm)} ${word}. `
      + `Left and right, 2 pieces at ${length(result.vertical.practicalMm)} ${word}.`;
  }

  function updateCornerAllowance(): void {
    const extension = parseInput(cornerExtensionInput);
    const text = Number.isFinite(extension) && extension >= 0 ? measurement(extension * 2) : EMPTY;
    cornerAllowanceLabels.forEach((label) => { label.textContent = text; });
  }

  function updateUnitHint(): void {
    const looksLikeCentimetres = currentUnit === "mm" && [widthInput, heightInput].some((input) => {
      const value = parseInput(input);
      return Number.isFinite(value) && value > 0 && value < 100;
    });
    unitHint.hidden = !looksLikeCentimetres;
  }

  function currentSettings(): ScreenCutSettings {
    const customClearance = parseInput(customClearanceInput);
    const cornerExtension = parseInput(cornerExtensionInput);
    return {
      unit: currentUnit,
      clearance: clearanceSelect.value,
      customClearanceMm: Number.isFinite(customClearance) && customClearance >= 0
        ? customClearance
        : storedSettings.customClearanceMm,
      rounding: roundingSelect.value,
      cornerExtensionPerEndMm: Number.isFinite(cornerExtension) && cornerExtension >= 0
        ? cornerExtension
        : storedSettings.cornerExtensionPerEndMm,
    };
  }

  function saveSettings(): void {
    const settings = currentSettings();
    if (JSON.stringify(settings) === JSON.stringify(storedSettings)) return;
    storedSettings = settings;
    writeStoredSettings(settings);
  }

  function setUnit(unit: MeasurementUnit): void {
    currentUnit = unit;
    unitInputs.forEach((input) => { input.checked = input.value === unit; });
    openingUnitLabels.forEach((label) => { label.textContent = unit; });
  }

  function showCustomClearance(): void {
    const isCustom = clearanceSelect.value === "custom";
    customClearanceField.hidden = !isCustom;
    customClearanceInput.disabled = !isCustom;
  }

  function applySettings(settings: ScreenCutSettings): void {
    setUnit(settings.unit);
    clearanceSelect.value = settings.clearance;
    customClearanceInput.value = String(settings.customClearanceMm);
    roundingSelect.value = settings.rounding;
    cornerExtensionInput.value = String(settings.cornerExtensionPerEndMm);
    showCustomClearance();
    updateCornerAllowance();
  }

  function trackResult(outcome: "success" | "invalid"): void {
    reportState("screen-cut.calculate", {
      unit: currentUnit,
      width: parseInput(widthInput),
      height: parseInput(heightInput),
      clearance: clearanceSelect.value === "custom" ? parseInput(customClearanceInput) : Number(clearanceSelect.value),
      rounding: roundingSelect.value,
    });
    window.umami?.track("screen-cut-calculation-result", outcome === "success"
      ? {
        outcome,
        unit: currentUnit,
        clearance: clearanceSelect.value === "custom" ? "custom" : "preset",
        rounding: roundingSelect.value === "0" ? "exact" : "rounded",
      }
      : { outcome, unit: currentUnit });
  }

  function update(submit = false): CalculationResult {
    window.clearTimeout(pendingUpdate);
    pendingUpdate = undefined;
    updateCornerAllowance();
    updateUnitHint();
    saveSettings();
    if (submit) submitted = true;

    const hadResult = lastResult !== null;
    const result = calculateFrameCuts({
      openingWidth: parseInput(widthInput),
      openingHeight: parseInput(heightInput),
      unit: currentUnit,
      clearanceMm: clearanceSelect.value === "custom" ? parseInput(customClearanceInput) : Number(clearanceSelect.value),
      cornerExtensionPerEndMm: parseInput(cornerExtensionInput),
      roundingIncrementMm: Number(roundingSelect.value) as RoundingIncrementMm,
    });

    if (!result.ok) {
      hideResults();
      const shown = visibleErrors(result.errors);
      renderErrors(shown);
      resultEmpty.textContent = shown.length > 0
        ? "Correct the field marked in red to see the cuts."
        : "Enter the opening width and height to see the cuts.";
      announce(shown.map((error) => error.message).join(" "));
      if (submit) trackResult("invalid");
      return result;
    }

    submitted = false;
    renderErrors([]);
    renderResult(result.value);
    announce(resultAnnouncement(result.value));
    if (!hadResult) trackResult("success");
    return result;
  }

  function scheduleUpdate(): void {
    window.clearTimeout(pendingUpdate);
    pendingUpdate = window.setTimeout(() => update(), RECALCULATE_DELAY_MS);
  }

  function showCutList(): void {
    resultsPanel.scrollIntoView({ block: "start" });
    resultHeading.focus({ preventScroll: true });
  }

  [widthInput, heightInput, customClearanceInput, cornerExtensionInput].forEach((input) => {
    input.addEventListener("input", () => {
      if (input === cornerExtensionInput) updateCornerAllowance();
      scheduleUpdate();
    });
  });

  // Leaving a field shows its errors. Wait for focus to land so the field
  // being entered next is known and its own errors stay held back.
  form.addEventListener("focusout", () => {
    window.setTimeout(() => update(), 0);
  });

  clearanceSelect.addEventListener("change", () => {
    showCustomClearance();
    if (clearanceSelect.value === "custom") customClearanceInput.focus();
    settingsStatus.textContent = "";
    update();
    window.umami?.track("screen-cut-setting-change", {
      setting: "clearance",
      choice: clearanceSelect.value === "custom" ? "custom" : "preset",
    });
  });

  roundingSelect.addEventListener("change", () => {
    settingsStatus.textContent = "";
    update();
    window.umami?.track("screen-cut-setting-change", {
      setting: "rounding",
      choice: roundingSelect.value === "0" ? "exact" : "rounded",
    });
  });

  // Switching units keeps the typed digits and reads them in the new unit.
  unitInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      setUnit(input.value as MeasurementUnit);
      update();
      window.umami?.track("screen-cut-setting-change", { setting: "unit", choice: currentUnit });
    });
  });

  unitHintSwitch.addEventListener("click", () => {
    setUnit("cm");
    update();
    requiredElement<HTMLInputElement>("#opening-unit-cm").focus();
    window.umami?.track("screen-cut-setting-change", { setting: "unit", choice: "cm" });
  });

  // The summary line stands in for an Advanced error only while Advanced is closed.
  advancedSettings.addEventListener("toggle", () => update());

  errorSummaryOpen.addEventListener("click", () => {
    advancedSettings.open = true;
    cornerExtensionInput.focus();
  });

  restoreButton.addEventListener("click", () => {
    applySettings({ ...DEFAULT_SETTINGS, unit: currentUnit });
    update();
    settingsStatus.textContent = "Clearance, rounding and corner extension are back to the defaults.";
    window.umami?.track("screen-cut-setting-change", { setting: "defaults", choice: "restore" });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = update(true);
    if (!result.ok) {
      const first = result.errors[0];
      if (first.field === "cornerExtensionPerEndMm") advancedSettings.open = true;
      controlFor(first.field).focus();
      return;
    }
    if (stackedLayout.matches) showCutList();
  });

  clearButton.addEventListener("click", () => {
    widthInput.value = "";
    heightInput.value = "";
    submitted = false;
    update();
    widthInput.focus();
    window.umami?.track("screen-cut-reset");
  });

  cutBar.addEventListener("click", showCutList);

  copyButton.addEventListener("click", async () => {
    if (!lastResult) return;
    try {
      await navigator.clipboard.writeText(cutListText(lastResult, currentUnit));
      copyStatus.textContent = "Cut list copied.";
      window.umami?.track("screen-cut-copy");
    } catch {
      copyStatus.textContent = "Copying is not available in this browser. Select the cut list and copy it.";
    }
  });

  // Hide the bar while the cut list itself is fully on screen above it.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      cutBar.classList.toggle("is-covered", entry.isIntersecting && entry.intersectionRatio >= 0.98);
    }, { rootMargin: "0px 0px -96px 0px", threshold: [0, 0.98, 1] }).observe(cutRows);
  }

  applySettings(storedSettings);
  update();
}
