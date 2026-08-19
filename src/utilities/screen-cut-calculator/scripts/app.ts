import {
  calculateFrameCuts,
  convertMeasurement,
  formatMeasurement,
  type CalculationError,
  type FrameCutCalculation,
  type MeasurementUnit,
  type RoundingIncrementMm,
} from "../lib/calculator";

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

export function initializeScreenCutCalculator(): void {
  const form = requiredElement<HTMLFormElement>("#screen-cut-form");
  const widthInput = requiredElement<HTMLInputElement>("#opening-width");
  const heightInput = requiredElement<HTMLInputElement>("#opening-height");
  const unitInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="opening-unit"]'));
  const clearanceSelect = requiredElement<HTMLSelectElement>("#clearance-select");
  const customClearanceField = requiredElement<HTMLElement>("#custom-clearance-field");
  const customClearanceInput = requiredElement<HTMLInputElement>("#custom-clearance");
  const roundingSelect = requiredElement<HTMLSelectElement>("#rounding-select");
  const advancedSettings = requiredElement<HTMLDetailsElement>("#advanced-settings");
  const cornerExtensionInput = requiredElement<HTMLInputElement>("#corner-extension");
  const totalCornerAllowance = requiredElement<HTMLElement>("#total-corner-allowance");
  const resetButton = requiredElement<HTMLButtonElement>("#reset-calculator");
  const errorSummary = requiredElement<HTMLElement>("#form-error-summary");
  const resultEmpty = requiredElement<HTMLElement>("#result-empty");
  const resultContent = requiredElement<HTMLElement>("#result-content");
  const resultHeading = requiredElement<HTMLElement>("#cut-list-heading");
  const calculationStatus = requiredElement<HTMLElement>("#calculation-status");
  const openingUnitLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-opening-unit]"));

  const errorElements = {
    openingWidth: requiredElement<HTMLElement>("#opening-width-error"),
    openingHeight: requiredElement<HTMLElement>("#opening-height-error"),
    clearanceMm: requiredElement<HTMLElement>("#clearance-error"),
    cornerExtensionPerEndMm: requiredElement<HTMLElement>("#corner-error"),
    roundingIncrementMm: requiredElement<HTMLElement>("#rounding-error"),
  };

  const fieldControls = {
    openingWidth: widthInput,
    openingHeight: heightInput,
    clearanceMm: clearanceSelect,
    cornerExtensionPerEndMm: cornerExtensionInput,
    roundingIncrementMm: roundingSelect,
  };

  let currentUnit: MeasurementUnit = "mm";

  function selectedUnit(): MeasurementUnit {
    return requiredElement<HTMLInputElement>('input[name="opening-unit"]:checked').value as MeasurementUnit;
  }

  function selectedClearance(): number {
    return clearanceSelect.value === "custom" ? parseInput(customClearanceInput) : Number(clearanceSelect.value);
  }

  function hasBothDimensions(): boolean {
    return widthInput.value.trim() !== "" && heightInput.value.trim() !== "";
  }

  function clearErrors(): void {
    Object.values(errorElements).forEach((element) => {
      element.textContent = "";
      element.hidden = true;
    });
    Object.values(fieldControls).forEach((control) => control.removeAttribute("aria-invalid"));
    customClearanceInput.removeAttribute("aria-invalid");
    errorSummary.textContent = "";
    errorSummary.hidden = true;
  }

  function controlForError(error: CalculationError): HTMLInputElement | HTMLSelectElement {
    if (error.field === "clearanceMm" && clearanceSelect.value === "custom") return customClearanceInput;
    return fieldControls[error.field];
  }

  function renderErrors(errors: CalculationError[]): void {
    clearErrors();
    const grouped = new Map<CalculationError["field"], string[]>();
    errors.forEach((error) => grouped.set(error.field, [...(grouped.get(error.field) ?? []), error.message]));

    grouped.forEach((messages, field) => {
      const errorElement = errorElements[field];
      errorElement.textContent = messages.join(" ");
      errorElement.hidden = false;
      controlForError({ field, message: messages[0] }).setAttribute("aria-invalid", "true");
    });

    const uniqueMessages = [...new Set(errors.map((error) => error.message))];
    errorSummary.textContent = uniqueMessages.join(" ");
    errorSummary.hidden = false;
  }

  function hideResults(): void {
    resultContent.hidden = true;
    resultEmpty.hidden = false;
    calculationStatus.textContent = "";
  }

  function setText(selector: string, value: string): void {
    requiredElement<HTMLElement>(selector).textContent = value;
  }

  function renderSelectedUnitEquivalent(selector: string, valueMm: number, label: string): void {
    const element = requiredElement<HTMLElement>(selector);
    const showCentimetres = currentUnit === "cm";
    element.hidden = !showCentimetres;
    element.textContent = showCentimetres ? `${label}: ${formatMeasurement(valueMm / 10)} cm` : "";
  }

  function renderExactCut(selector: string, exactMm: number, practicalMm: number): void {
    const element = requiredElement<HTMLElement>(selector);
    const wasRounded = exactMm !== practicalMm;
    element.hidden = !wasRounded;
    element.textContent = wasRounded ? `Calculated: ${measurement(exactMm)}` : "";
  }

  function renderBreakdown(result: FrameCutCalculation): void {
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
    clearErrors();
    resultEmpty.hidden = true;
    resultContent.hidden = false;

    setText("#horizontal-cut", formatMeasurement(result.horizontal.practicalMm));
    setText("#vertical-cut", formatMeasurement(result.vertical.practicalMm));
    setText(
      "#finished-frame-size",
      `${formatMeasurement(result.finishedMm.width)} × ${formatMeasurement(result.finishedMm.height)} mm`,
    );

    renderSelectedUnitEquivalent(
      "#horizontal-selected-unit",
      result.horizontal.practicalMm,
      "Selected unit",
    );
    renderSelectedUnitEquivalent("#vertical-selected-unit", result.vertical.practicalMm, "Selected unit");
    const finishedSelectedUnit = requiredElement<HTMLElement>("#finished-frame-selected-unit");
    finishedSelectedUnit.hidden = currentUnit !== "cm";
    finishedSelectedUnit.textContent = currentUnit === "cm"
      ? `Selected unit: ${formatMeasurement(result.finishedMm.width / 10)} × ${formatMeasurement(result.finishedMm.height / 10)} cm`
      : "";

    renderExactCut("#horizontal-exact", result.horizontal.exactMm, result.horizontal.practicalMm);
    renderExactCut("#vertical-exact", result.vertical.exactMm, result.vertical.practicalMm);
    renderBreakdown(result);

    calculationStatus.textContent = `Cut list updated. Cut 2 horizontal pieces at ${formatMeasurement(result.horizontal.practicalMm)} millimetres and 2 vertical pieces at ${formatMeasurement(result.vertical.practicalMm)} millimetres.`;
  }

  function calculate(forceValidation = false, focusResult = false): void {
    const result = calculateFrameCuts({
      openingWidth: parseInput(widthInput),
      openingHeight: parseInput(heightInput),
      unit: currentUnit,
      clearanceMm: selectedClearance(),
      cornerExtensionPerEndMm: parseInput(cornerExtensionInput),
      roundingIncrementMm: Number(roundingSelect.value) as RoundingIncrementMm,
    });

    if (!result.ok) {
      hideResults();
      if (forceValidation || hasBothDimensions()) renderErrors(result.errors);
      else clearErrors();

      if (forceValidation) {
        if (result.errors[0].field === "cornerExtensionPerEndMm") advancedSettings.open = true;
        controlForError(result.errors[0]).focus();
      }
      return;
    }

    renderResult(result.value);
    if (focusResult) resultHeading.focus();
  }

  function updateCornerAllowance(): void {
    const extension = parseInput(cornerExtensionInput);
    totalCornerAllowance.textContent = Number.isFinite(extension) && extension >= 0
      ? `${formatMeasurement(extension * 2)} mm`
      : "—";
  }

  function updateCustomClearance(): void {
    const isCustom = clearanceSelect.value === "custom";
    customClearanceField.hidden = !isCustom;
    customClearanceInput.disabled = !isCustom;
    if (isCustom) customClearanceInput.focus();
  }

  function updateOpeningUnit(nextUnit: MeasurementUnit): void {
    if (nextUnit === currentUnit) return;

    [widthInput, heightInput].forEach((input) => {
      const value = parseInput(input);
      if (Number.isFinite(value)) input.value = formatMeasurement(convertMeasurement(value, currentUnit, nextUnit));
    });

    currentUnit = nextUnit;
    openingUnitLabels.forEach((label) => { label.textContent = nextUnit; });
    if (hasBothDimensions()) calculate();
  }

  [widthInput, heightInput, customClearanceInput, cornerExtensionInput].forEach((input) => {
    input.addEventListener("input", () => {
      if (input === cornerExtensionInput) updateCornerAllowance();
      if (hasBothDimensions()) calculate();
      else {
        clearErrors();
        hideResults();
      }
    });
  });

  [clearanceSelect, roundingSelect].forEach((select) => {
    select.addEventListener("change", () => {
      if (select === clearanceSelect) updateCustomClearance();
      if (hasBothDimensions()) calculate();
    });
  });

  unitInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) updateOpeningUnit(input.value as MeasurementUnit);
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate(true, true);
  });

  resetButton.addEventListener("click", () => {
    window.requestAnimationFrame(() => {
      currentUnit = selectedUnit();
      advancedSettings.open = false;
      updateCustomClearance();
      updateCornerAllowance();
      openingUnitLabels.forEach((label) => { label.textContent = currentUnit; });
      clearErrors();
      hideResults();
      widthInput.focus();
    });
  });

  updateCustomClearance();
  updateCornerAllowance();
  hideResults();
}
