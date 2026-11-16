export interface ScanAlias { name: string; dexIds: number[] }
export interface ScanIndex { schemaVersion: 1; aliases: ScanAlias[] }
export interface ScanLine { text: string; confidence: number; height?: number }
export interface ScanMatch { dexIds: number[]; certain: boolean; label: string }

export function normalizeCardName(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/♀/g, " female ").replace(/♂/g, " male ").replace(/[^a-z0-9]/g, "");
}
function title(text: string) {
  return text.replace(/[®™].*$/, "").replace(/\b(?:basic|stage\s*[12]|restored|mega|hp\s*\d+|\d+\s*hp)\b/gi, " ")
    .replace(/\bHP\b.*$/i, "").replace(/\s+\d{2,3}\s*$/, "").trim();
}
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    previous = next;
  }
  return previous[b.length];
}
/** Title lines only: never scan attack/evolution paragraphs for species substrings. */
export function matchCardTitle(lines: ScanLine[], aliases: ScanAlias[]): ScanMatch[] {
  const byName = new Map<string, ScanAlias>();
  for (const alias of aliases) {
    const key = normalizeCardName(alias.name), old = byName.get(key);
    byName.set(key, old ? { name: old.name, dexIds: [...new Set([...old.dexIds, ...alias.dexIds])] } : alias);
  }
  const matches: { match: ScanMatch; score: number; height: number }[] = [];
  for (const line of lines) {
    if (line.confidence < 20 || /evolves?\s+from|evolution|\btrainer\b|\benergy\b/i.test(line.text)) continue;
    const key = normalizeCardName(title(line.text));
    if (key.length < 3 || key.length > 65) continue;
    if (key.startsWith("nidoran") && !/female|male/.test(key)) {
      matches.push({ match: { dexIds: [29, 32], certain: false, label: "Nidoran" }, score: 2, height: line.height ?? 1 }); continue;
    }
    const exact = byName.get(key) ?? byName.get(key.replace(/(?:vmax|vstar|gx|ex|lvx|v)$/i, ""));
    if (exact) {
      matches.push({ match: { dexIds: exact.dexIds, certain: line.confidence >= (key.length <= 4 ? 85 : 70), label: exact.name }, score: 2, height: line.height ?? 1 });
      continue;
    }
    for (const [name, alias] of byName) {
      if (Math.abs(name.length - key.length) > 2 || Math.min(name.length, key.length) < 3) continue;
      const distance = editDistance(name, key), similarity = 1 - distance / Math.max(name.length, key.length);
      if (distance <= 2 && similarity >= .76) matches.push({ match: { dexIds: alias.dexIds, certain: false, label: alias.name }, score: similarity, height: line.height ?? 1 });
    }
  }
  matches.sort((a, b) => b.score - a.score || b.height - a.height);
  const exact = matches.filter(item => item.score === 2);
  const best = exact[0];
  // Two plausible title lines must be offered as choices, not guessed.
  const choices = best ? exact.filter(item => item.height >= best.height * .7) : matches;
  const result: ScanMatch[] = [];
  for (const { match } of choices) {
    if (!result.some(item => item.dexIds.join(",") === match.dexIds.join(","))) result.push({ ...match });
    if (result.length === 5) break;
  }
  if (result.length > 1) for (const item of result) item.certain = false;
  return result;
}

export interface Rect { x: number; y: number; width: number; height: number }
/** Convert the visible guide through object-fit:cover into source-video pixels. */
export function videoCrop(videoWidth: number, videoHeight: number, viewport: Rect, guide: Rect): Rect {
  const scale = Math.max(viewport.width / videoWidth, viewport.height / videoHeight);
  const offsetX = (videoWidth * scale - viewport.width) / 2, offsetY = (videoHeight * scale - viewport.height) / 2;
  const x = Math.max(0, (guide.x - viewport.x + offsetX) / scale), y = Math.max(0, (guide.y - viewport.y + offsetY) / scale);
  return { x, y, width: Math.max(1, Math.min(videoWidth - x, guide.width / scale)), height: Math.max(1, Math.min(videoHeight - y, guide.height / scale)) };
}
export function frameDifference(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 1;
  return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length / 255;
}
export function sampleFrame(data: Uint8ClampedArray): { signature: number[]; contrast: number } {
  const signature = [];
  for (let i = 0; i < data.length; i += 4) signature.push(Math.round(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114));
  const average = signature.reduce((a, b) => a + b, 0) / signature.length;
  return { signature, contrast: Math.sqrt(signature.reduce((sum, n) => sum + (n - average) ** 2, 0) / signature.length) };
}

/** No queued work; a held card stays blocked until its image changes or is removed. */
export class CaptureGate {
  private last: number[] = [];
  private stableAt = 0;
  private blocked: number[] | null = null;
  inspect(signature: number[], contrast: number, now: number): "empty" | "moving" | "held" | "ready" {
    const difference = frameDifference(this.last, signature); this.last = signature;
    if (contrast < 16) { this.blocked = null; this.stableAt = now; return "empty"; }
    // Rear-camera handheld footage commonly varies 6–9% between samples even when the title is readable.
    if (difference > .11) { this.stableAt = now; return "moving"; }
    if (this.blocked && frameDifference(this.blocked, signature) < .14) return "held";
    return now - this.stableAt >= 500 ? "ready" : "moving";
  }
  accept(signature: number[]) { this.blocked = [...signature]; this.stableAt = 0; }
  rescan() { this.blocked = null; this.stableAt = 0; this.last = []; }
}
