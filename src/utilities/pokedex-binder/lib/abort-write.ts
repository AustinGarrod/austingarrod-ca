/** Let a scanner deadline abort a queued write without discarding a committed one. */
export function abortWriteOnSignal(transaction: IDBTransaction, signal?: AbortSignal): void {
  if (!signal) return;
  const abort = () => {
    try { transaction.abort(); }
    catch (error) {
      // A transaction that already finished will still deliver its completion event.
      if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
    }
  };
  const remove = () => signal.removeEventListener("abort", abort);
  transaction.addEventListener("complete", remove, { once: true });
  transaction.addEventListener("abort", remove, { once: true });
  signal.addEventListener("abort", abort, { once: true });
}
