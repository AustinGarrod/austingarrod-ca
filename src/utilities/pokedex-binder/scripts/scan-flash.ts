type TorchCapabilities = { torch?: boolean | boolean[] };
type TorchSettings = { torch?: boolean };
type TorchConstraint = MediaTrackConstraintSet & { torch: boolean };

export function bindScanFlash(button: HTMLButtonElement, notice: HTMLElement) {
  let active: MediaStreamTrack | undefined;
  function display(enabled: boolean) {
    button.setAttribute("aria-pressed", String(enabled));
    button.textContent = enabled ? "Flash on" : "Flash off";
  }
  async function apply(enabled: boolean) {
    const track = active;
    if (!track) return;
    button.disabled = true;
    notice.textContent = "";
    try {
      const constraint: TorchConstraint = { torch: enabled };
      await track.applyConstraints({ advanced: [constraint] });
      if (active !== track) return;
      const actual = (track.getSettings() as TorchSettings).torch ?? enabled;
      display(actual);
      if (actual !== enabled) notice.textContent = "The camera could not change the flash.";
    } catch {
      if (active !== track) return;
      const actual = (track.getSettings() as TorchSettings).torch;
      if (actual !== undefined) display(actual);
      notice.textContent = "The camera could not change the flash.";
    } finally {
      if (active === track) button.disabled = false;
    }
  }
  button.onclick = () => { void apply(button.getAttribute("aria-pressed") !== "true"); };
  return (track?: MediaStreamTrack) => {
    active = track;
    const torch = (track?.getCapabilities?.() as TorchCapabilities | undefined)?.torch;
    button.hidden = !(torch === true || (Array.isArray(torch) && torch.includes(true) && torch.includes(false)));
    button.disabled = false;
    notice.textContent = "";
    const enabled = (track?.getSettings() as TorchSettings | undefined)?.torch === true;
    display(enabled);
    if (!button.hidden && enabled) void apply(false);
  };
}
