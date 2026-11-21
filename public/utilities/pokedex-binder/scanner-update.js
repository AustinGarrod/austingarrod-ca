// The module interface used by older binder tabs. Their HTML belongs to the old scanner.
export function createCardScanner() {
  const dialog = document.createElement("dialog");
  dialog.className = "dex-dialog rr-block";
  dialog.setAttribute("aria-labelledby", "scanner-update-title");
  dialog.innerHTML = `<form method="dialog">
    <h2 id="scanner-update-title">Scanner updated</h2>
    <p>Reload the binder to use the latest scanner.</p>
    <div class="dex-dialog-actions"><button>Close</button><button type="button" class="dex-primary">Reload binder</button></div>
  </form>`;
  dialog.querySelector('[type="button"]').addEventListener("click", () => location.reload());
  document.body.append(dialog);
  return {
    open() { if (!dialog.open) dialog.showModal(); },
    close() { dialog.close(); },
    refresh() {},
  };
}
