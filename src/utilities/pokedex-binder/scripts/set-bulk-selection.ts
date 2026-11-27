interface CardChoice {
  key: string;
  label: string;
}

interface Review {
  apply: (keys: string[]) => Promise<string | undefined>;
  boxes: HTMLInputElement[];
  saving: boolean;
  restoreFocus?: () => void;
}

export function setBulkSelection(dialog: HTMLDialogElement, status: HTMLElement) {
  const title = dialog.querySelector<HTMLElement>("#master-bulk-title")!;
  const scope = dialog.querySelector<HTMLElement>("#master-bulk-scope")!;
  const selection = dialog.querySelector<HTMLFieldSetElement>("#master-bulk-selection")!;
  const all = dialog.querySelector<HTMLInputElement>("#master-bulk-all")!;
  const list = dialog.querySelector<HTMLElement>("#master-bulk-cards")!;
  const count = dialog.querySelector<HTMLElement>("#master-bulk-count")!;
  const error = dialog.querySelector<HTMLElement>("#master-bulk-error")!;
  const submit = dialog.querySelector<HTMLButtonElement>("#master-bulk-apply")!;
  const closeButtons = dialog.querySelectorAll<HTMLButtonElement>("[data-close-dialog]");
  let review: Review | null = null;

  function updateControls(current: Review) {
    const selected = current.boxes.filter(box => box.checked).length;
    all.checked = selected === current.boxes.length;
    all.indeterminate = selected > 0 && !all.checked;
    count.textContent = `${selected} of ${current.boxes.length} selected`;
    submit.textContent = current.saving ? "Saving…" : `Mark ${selected} collected`;
    submit.disabled = current.saving || !selected;
    selection.disabled = current.saving;
    for (const button of closeButtons) button.disabled = current.saving;
  }

  selection.addEventListener("change", event => {
    if (!review) return;
    if (event.target === all) for (const box of review.boxes) box.checked = all.checked;
    updateControls(review);
  });
  dialog.addEventListener("cancel", event => {
    if (review?.saving) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    const restoreFocus = review?.restoreFocus;
    review = null;
    list.replaceChildren();
    restoreFocus?.();
  });
  dialog.querySelector("form")!.addEventListener("submit", async event => {
    event.preventDefault();
    const current = review;
    if (!current || current.saving) return;
    const keys = current.boxes.filter(box => box.checked).map(box => box.value);
    if (!keys.length) return;
    current.saving = true;
    error.textContent = "";
    updateControls(current);
    try {
      const message = await current.apply(keys);
      if (current === review && dialog.open) {
        dialog.close();
        if (message) status.textContent = message;
      }
    } catch (cause) {
      if (current === review && dialog.open) {
        current.saving = false;
        error.textContent = cause instanceof Error ? cause.message : "The selection could not be saved. Try again.";
        updateControls(current);
        submit.focus();
      }
    }
  });

  return {
    open(description: string, cards: CardChoice[], apply: Review["apply"], restoreFocus?: () => void) {
      if (dialog.open || !cards.length) return;
      const rows = document.createDocumentFragment();
      const boxes = cards.map(card => {
        const row = document.createElement("label");
        row.className = "dex-dialog-checkbox";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = card.key;
        box.checked = true;
        row.append(box, document.createTextNode(card.label));
        rows.append(row);
        return box;
      });
      list.replaceChildren(rows);
      scope.textContent = description;
      error.textContent = "";
      review = { apply, boxes, saving: false, restoreFocus };
      updateControls(review);
      dialog.showModal();
      list.scrollTop = 0;
      dialog.scrollTop = 0;
      title.focus({ preventScroll: true });
    },
    close() { dialog.close(); },
  };
}
