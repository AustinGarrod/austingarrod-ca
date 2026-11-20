import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CaptureGate, frameDifference, indexScanAliases, matchCardTitle, videoCrop, type ScanAlias } from "../../src/utilities/pokedex-binder/lib/scan-model";
import { buildScanIndex } from "../../scripts/pokedex-scan-index.mjs";
import { matchSetCard } from "../../src/utilities/pokedex-binder/lib/scan-set";
import type { Slot } from "../../src/utilities/pokedex-binder/lib/master";
const aliases = indexScanAliases([
  { name: "Mew", dexIds: [151] }, { name: "Mewtwo", dexIds: [150] },
  { name: "Charmeleon", dexIds: [5] }, { name: "Charmander", dexIds: [4] },
  { name: "Alolan Rattata", dexIds: [19] }, { name: "Mr. Mime", dexIds: [122] },
  { name: "Pikachu & Zekrom GX", dexIds: [25, 644] },
  { name: "Nidoran♀", dexIds: [29] }, { name: "Nidoran♂", dexIds: [32] }, { name: "Nidorino", dexIds: [33] },
]);
const line = (text: string, confidence = 95, height = 30) => ({ text, confidence, height });
describe("card title matching", () => {
  it("never treats substrings/evolution instructions as the current Pokémon", () => {
    expect(matchCardTitle([line("Mewtwo")], aliases)).toEqual([{ dexIds: [150], certain: true, label: "Mewtwo" }]);
    expect(matchCardTitle([line("Evolves from Charmander"), line("STAGE 1 Charmeleon HP 100")], aliases)[0].dexIds).toEqual([5]);
    expect(matchCardTitle([line("Trainer"), line("Energy")], aliases)).toEqual([]);
  });
  it("retains forms and multi-species aliases, and asks for ambiguous/uncertain results", () => {
    expect(matchCardTitle([line("Alolan Rattata")], aliases)[0]).toMatchObject({ dexIds: [19], certain: true });
    expect(matchCardTitle([line("Pikachu & Zekrom GX")], aliases)[0].dexIds).toEqual([25, 644]);
    expect(matchCardTitle([line("Nidoran do'", 57)], aliases)[0]).toMatchObject({ dexIds: [29, 32], certain: false });
    expect(matchCardTitle([line("Nidoran$", 26)], aliases)[0].certain).toBe(false);
    expect(matchCardTitle([line("Mew®Y", 26)], aliases)[0]).toMatchObject({ dexIds: [151], certain: false });
    expect(matchCardTitle([line("Mr Mime", 55)], aliases)[0].certain).toBe(false);
    expect(matchCardTitle([line("Mew"), line("Mewtwo")], aliases).every(match => !match.certain)).toBe(true);
  });
  it("keeps OCR spelling corrections as choices rather than confident matches", () => {
    expect(matchCardTitle([line("Charmandcr")], aliases)[0]).toMatchObject({ dexIds: [4], certain: false });
    expect(matchCardTitle([line("unreadable shiny card")], aliases)).toEqual([]);
  });
});
describe("set card recognition", () => {
  const slot = (number: string, name: string, finish = "normal"): Slot => ({
    key: number + ":" + finish, number, name, finish, required: true, owned: false, category: "Pokemon",
  });
  const slots = [slot("001", "Mew"), slot("001", "Mew", "reverse"), slot("007", "Mewtwo"), slot("TG05", "Mewtwo")];
  const skipTitle = async (): Promise<string> => { throw Error("Unnecessary title OCR"); };
  it("opens all finishes for one clear collector number without reading the title", async () => {
    expect(await matchSetCard(slots, 165, [line("1/165")], skipTitle)).toEqual(["001"]);
    expect(await matchSetCard(slots, 165, [line("TG5/TG30")], skipTitle)).toEqual(["TG05"]);
    expect(await matchSetCard(slots, 165, [line("001/100")], skipTitle)).toEqual([]);
  });
  it("uses the title when a number is missing, ambiguous or poorly recognized", async () => {
    expect(await matchSetCard(slots, 165, [], async () => "BASIC Mewtwo 110HP")).toEqual(["007", "TG05"]);
    expect(await matchSetCard(slots, 165, [line("001/165 007/165")], async () => "Mewtwo")).toEqual(["007"]);
    expect(await matchSetCard(slots, 165, [line("001/165", 40)], async () => "Mewtwo")).toEqual(["007", "TG05"]);
    expect(await matchSetCard(slots, 165, [line("001/165", 40)], async () => "")).toEqual([]);
    expect(await matchSetCard(slots, 165, [], async () => "Evolves from Mew")).toEqual([]);
  });
});
describe("camera capture gating and coordinates", () => {
  it("waits for stability, blocks a held card, and rearms after removal or explicit rescan", () => {
    const gate = new CaptureGate(), card = [0, 255, 30, 210];
    expect(gate.inspect(card, 50, 100)).toBe("moving");
    expect(gate.inspect(card, 50, 800)).toBe("ready");
    gate.accept(card);
    expect(gate.inspect([1, 254, 31, 211], 50, 1000)).toBe("held");
    expect(gate.inspect([130, 130, 130, 130], 0, 1500)).toBe("empty");
    expect(gate.inspect(card, 50, 2000)).toBe("moving");
    expect(gate.inspect(card, 50, 2700)).toBe("ready");
    gate.accept(card); gate.rescan();
    gate.inspect(card, 50, 3000); expect(gate.inspect(card, 50, 3700)).toBe("ready");
    expect(frameDifference(card, card)).toBe(0);
  });
  it("allows the measured handheld variation while still rejecting a large scene movement", () => {
    const gate = new CaptureGate(); gate.inspect([30, 200, 40, 180], 50, 100);
    expect(gate.inspect([50, 220, 60, 200], 50, 350)).toBe("moving");
    expect(gate.inspect([30, 200, 40, 180], 50, 650)).toBe("ready");
    expect(gate.inspect([150, 20, 150, 20], 50, 800)).toBe("moving");
  });
  it("maps object-fit cover correctly through portrait and landscape layouts", () => {
    const crop = videoCrop(1920, 1080, { x: 0, y: 0, width: 360, height: 640 }, { x: 30, y: 100, width: 300, height: 440 });
    expect(crop.x).toBeCloseTo(706.875); expect(crop.y).toBeCloseTo(168.75);
    expect(crop.width).toBeCloseTo(506.25); expect(crop.height).toBeCloseTo(742.5);
    expect(videoCrop(1000, 1400, { x: 20, y: 10, width: 500, height: 700 }, { x: 20, y: 10, width: 500, height: 700 }))
      .toEqual({ x: 0, y: 0, width: 1000, height: 1400 });
  });
});
it("ships a scan index derived from explicit committed printing mappings", async () => {
  const root = new URL("../../public/utilities/pokedex-binder/catalog/", import.meta.url);
  const catalog = JSON.parse(await readFile(new URL("index.json", root), "utf8"));
  const entries = await Promise.all(catalog.species.map(async (item: {id:number}) => [item.id, JSON.parse(await readFile(new URL(`printings/${item.id}.json`, root), "utf8"))]));
  const index = JSON.parse(await readFile(new URL("scan-index.json", root), "utf8"));
  expect(index).toEqual(buildScanIndex(catalog.species, new Map(entries)));
  expect(index.aliases.find((alias: ScanAlias) => alias.name === "Pikachu & Zekrom GX").dexIds).toEqual([25, 644]);
}, 30000);
