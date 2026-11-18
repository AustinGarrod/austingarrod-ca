import type { Slot } from "../lib/master";
import { normalizeSearch } from "../lib/model";

export function createSetScanner() {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = el<HTMLDialogElement>("master-scanner"),
    video = el<HTMLVideoElement>("master-video");
  const query = el<HTMLInputElement>("master-scan-search"),
    result = el<HTMLSelectElement>("master-candidates");
  const status = el("master-scan-status"),
    capture = el<HTMLButtonElement>("master-capture"),
    confirm = el<HTMLButtonElement>("master-confirm-scan");
  let stream: MediaStream | null = null,
    generation = 0,
    slots: Slot[] = [],
    mark: (key: string) => Promise<void>;
  function stop() {
    generation++;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    capture.hidden = true;
  }
  function candidates(items: Slot[]) {
    result.replaceChildren(
      new Option("Choose card number and finish", ""),
      ...items.map((s) => new Option("#" + s.number + " " + s.name + " · " + s.finish, s.key)),
    );
    confirm.disabled = true;
  }
  function search() {
    const text = query.value.trim().toLowerCase().replace(/^#/, "");
    candidates(slots.filter((s) => s.name.toLowerCase().includes(text) || s.number.toLowerCase().includes(text)));
  }
  async function recognize(source: CanvasImageSource, width: number, height: number) {
    if (!width || !height) throw new Error("Wait for the camera to focus, then capture again.");
    const current = ++generation;
    const frame = document.createElement("canvas");
    const ratio = Math.min(1, 1800 / Math.max(width, height));
    frame.width = Math.round(width * ratio);
    frame.height = Math.round(height * ratio);
    frame.getContext("2d")!.drawImage(source, 0, 0, frame.width, frame.height);
    candidates([]);
    status.textContent = "Reading card on this device…";
    const { createWorker, PSM } = await import("tesseract.js");
    const assets = "/utilities/pokedex-binder/scanner-assets/v1";
    const worker = await createWorker("eng", 1, {
      workerPath: assets + "/worker.min.js",
      corePath: assets,
      langPath: assets,
      workerBlobURL: false,
      errorHandler: () => {},
    });
    try {
      if (current !== generation) return;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const { data } = await worker.recognize(frame);
      if (current !== generation || !panel.open) return;
      const lines = data.text.split("\n").map(normalizeSearch);
      const numbers = [...data.text.matchAll(/\b([a-z]{0,4}\d+[a-z]?)\s*\/\s*[a-z]*\d+/gi)].map((m) =>
        m[1].toLowerCase().replace(/^0+(?=\d)/, ""),
      );
      const byNumber = slots.filter((s) => numbers.includes(s.number.toLowerCase().replace(/^0+(?=\d)/, "")));
      const items = byNumber.length
        ? byNumber
        : slots.filter((s) => lines.some((line) => line.includes(normalizeSearch(s.name))));
      candidates(items.length ? items : slots);
      status.textContent = items.length
        ? "Confirm the printed number and finish."
        : "No clear match. Search by name or number.";
    } finally {
      frame.width = frame.height = 0;
      await worker.terminate();
    }
  }
  const fail = (e: unknown) => {
    if (panel.open) status.textContent = e instanceof Error ? e.message : "Camera unavailable. Search manually.";
  };
  query.oninput = search;
  result.onchange = () => {
    confirm.disabled = !result.value;
  };
  confirm.onclick = async () => {
    if (!result.value) return;
    confirm.disabled = true;
    try {
      await mark(result.value);
      panel.close();
    } catch (e) {
      fail(e);
      confirm.disabled = false;
    }
  };
  el("master-camera").onclick = async () => {
    const ticket = generation;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (ticket !== generation || !panel.open) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stop();
      stream = media;
      video.srcObject = media;
      video.hidden = false;
      await video.play();
      capture.hidden = false;
    } catch (e) {
      fail(e);
    }
  };
  capture.onclick = () => void recognize(video, video.videoWidth, video.videoHeight).catch(fail);
  el<HTMLInputElement>("master-photo").onchange = async (event) => {
    const control = event.currentTarget as HTMLInputElement,
      file = control.files?.[0],
      ticket = generation;
    if (!file) return;
    try {
      const photo = await createImageBitmap(file);
      try {
        if (ticket === generation) await recognize(photo, photo.width, photo.height);
      } finally {
        photo.close();
      }
    } catch (e) {
      fail(e);
    } finally {
      control.value = "";
    }
  };
  panel.addEventListener("close", stop);
  window.addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  return {
    open(items: Slot[], onMark: typeof mark) {
      slots = items;
      mark = onMark;
      query.value = "";
      status.textContent = "";
      search();
      panel.showModal();
    },
    close() {
      if (panel.open) panel.close();
      stop();
    },
  };
}
