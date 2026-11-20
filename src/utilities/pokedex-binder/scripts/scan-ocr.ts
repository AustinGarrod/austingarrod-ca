import type { Worker } from "tesseract.js";
import { indexScanAliases, matchCardTitle, type ScanIndex, type ScanLine, type ScanMatch } from "../lib/scan-model";
import { matchSetCard } from "../lib/scan-set";
import type { Slot } from "../lib/master";

export interface CardRecognizer {
  recognize(frame: HTMLCanvasElement): Promise<ScanMatch[]>;
  readSet(frame: HTMLCanvasElement, slots: Slot[], printedTotal: number | null): Promise<string[]>;
  terminate(): Promise<void>;
}
const assets = "/utilities/pokedex-binder/scanner-assets/v1";
async function loadAliases() {
  const response = await fetch("/utilities/pokedex-binder/catalog/scan-index.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Scanner names could not load.");
  const index = await response.json() as ScanIndex;
  if (index.schemaVersion !== 1 || !Array.isArray(index.aliases)) throw new Error("Scanner names need updating.");
  return indexScanAliases(index.aliases);
}
export async function createCardRecognizer(progress: (message: string) => void, mode: "species" | "set"): Promise<CardRecognizer> {
  const [{ createWorker, PSM }, aliases] = await Promise.all([import("tesseract.js"), mode === "species" ? loadAliases() : null]);
  let worker: Worker | null = null;
  try {
    worker = await createWorker("eng", 1, { workerPath: `${assets}/worker.min.js`, corePath: assets, langPath: assets,
      workerBlobURL: false, cachePath: "pokedex-scanner-eng-v1", errorHandler: () => {},
      logger: event => {
        // Never forward OCR data, worker error text, or image buffers to telemetry.
        if (event.status === "loading language traineddata") progress(`Downloading scanner… ${Math.round(event.progress * 100)}%`);
        else if (["loading tesseract core", "initializing tesseract", "initializing api"].includes(event.status)) progress("Preparing scanner…");
      } });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, user_defined_dpi: "300" });
  } catch { if (worker) await worker.terminate(); throw new Error("Scanner could not start. Check your connection and try again."); }
  const engine = worker;
  let closed = false;
  function textCrop(frame: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
    const crop = document.createElement("canvas"); crop.width = 1400; crop.height = Math.round(frame.height * height / (frame.width * width) * crop.width);
    const context = crop.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(frame, frame.width * x, frame.height * y, frame.width * width, frame.height * height, 0, 0, crop.width, crop.height);
    const image = context.getImageData(0, 0, crop.width, crop.height);
    let minimum = 255, maximum = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const gray = Math.round(image.data[i] * .299 + image.data[i + 1] * .587 + image.data[i + 2] * .114);
      minimum = Math.min(minimum, gray); maximum = Math.max(maximum, gray);
      image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
    }
    const range = maximum - minimum || 1;
    for (let i = 0; i < image.data.length; i += 4) image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.round((image.data[i] - minimum) * 255 / range);
    context.putImageData(image, 0, 0);
    return crop;
  }
  return {
    async readSet(frame, slots, printedTotal) {
      await engine.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      async function read(x: number, y: number, width: number, height: number, blocks = false) {
        if (closed) return null;
        const crop = textCrop(frame, x, y, width, height);
        try { return (await engine.recognize(crop, {}, { text: true, blocks })).data; }
        finally { crop.width = crop.height = 0; }
      }
      const footer = await read(0, .85, 1, .15, true);
      const lines = (footer?.blocks ?? []).flatMap(block => block.paragraphs.flatMap(p => p.lines));
      return matchSetCard(slots, printedTotal, lines, async () => (await read(.10, .015, .76, .20))?.text ?? "");
    },
    async recognize(frame) {
      if (!aliases) throw new Error("Species names were not loaded.");
      const crops = [
        { x: .16, y: .026, width: .60, height: .068, mode: PSM.SINGLE_LINE },
        { x: .10, y: .015, width: .76, height: .22, mode: PSM.SPARSE_TEXT },
      ];
      let fallback: ScanMatch[] = [];
      for (const { x, y, width, height, mode } of crops) {
        if (closed) return [];
        const crop = textCrop(frame, x, y, width, height);
        await engine.setParameters({ tessedit_pageseg_mode: mode });
        const { data } = await engine.recognize(crop, {}, { text: true, blocks: true });
        crop.width = crop.height = 0;
        if (closed) return [];
        const lines: ScanLine[] = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({ text: line.text, confidence: line.confidence, height: line.bbox.y1 - line.bbox.y0 }))));
        const matches = matchCardTitle(lines, aliases);
        if (matches.length === 1 && matches[0].certain) return matches;
        if (matches.length && (!fallback.length || matches[0].dexIds.length > 1)) fallback = matches;
      }
      return fallback;
    },
    async terminate() { if (!closed) { closed = true; await engine.terminate(); } },
  };
}
