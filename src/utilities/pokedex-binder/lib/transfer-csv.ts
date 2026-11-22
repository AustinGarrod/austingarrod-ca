import { identityText } from "./transfer-identity";

export const transferFields = {
  set: "Set name or code", name: "Card name", number: "Collector number", finish: "Finish",
  variantId: "Catalog variant ID", quantity: "Quantity", language: "Language", game: "Game",
  region: "TCG region", productId: "TCGplayer Product ID", watchlist: "Watchlist",
} as const;
export type TransferField = keyof typeof transferFields;
export type ColumnMap = Partial<Record<TransferField, number>>;
export type TransferRow = Partial<Record<TransferField, string>> & { line: number };
export type TransferFormat = "auto" | "tcgcollector" | "collectr" | "tcgplayer" | "custom";

export const csvByteLimit = 8 * 1024 * 1024;
const rowLimit = 50000;

function delimiterFor(text: string) {
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && /[\r\n]/.test(char)) break;
    if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseTransferCsv(source: string) {
  const original = source.replace(/^\uFEFF/, "");
  const leadingLines = original.match(/^(?:[ \t]*(?:\r\n|\r|\n))+/)?.[0] ?? "";
  const text = original.slice(leadingLines.length), delimiter = delimiterFor(text);
  const records: { line: number; cells: string[] }[] = [];
  let line = 1 + (leadingLines.match(/\r\n|\r|\n/g)?.length ?? 0), start = line, cells: string[] = [], field = "";
  let quoted = false, closed = false;
  function endField() {
    cells.push(field);
    field = "";
    closed = false;
  }
  function endRecord() {
    endField();
    if (cells.some(value => value.trim())) records.push({ line: start, cells });
    if (records.length > rowLimit + 1) throw new Error("Choose a CSV with at most 50,000 rows.");
    cells = [];
    start = line;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else {
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
        field += char;
      }
    } else if (char === delimiter) {
      endField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      line++;
      endRecord();
    } else if (char === '"' && !field && !closed) {
      quoted = true;
    } else if (char === '"' || closed) {
      throw new Error(`Check the CSV quoting on line ${line}.`);
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error(`A CSV field starting on line ${start} has an unclosed quote.`);
  if (field || cells.length || closed) endRecord();
  const headers = records.shift()?.cells.map(value => value.trim());
  if (!headers?.length || !records.length) throw new Error("Choose a CSV with a header and at least one card row.");
  if (headers.length > 100) throw new Error("Choose a CSV with at most 100 columns.");
  return { headers, records };
}

const commonHeaders: Record<TransferField, string[]> = {
  set: ["Set ID", "Set code", "Set", "Set name", "Expansion", "Edition code"],
  name: ["Card name", "Product name", "Name", "Card"],
  number: ["Collector number", "Card number", "Number", "Card #"],
  finish: ["Finish", "Card variant", "Printing", "Variance", "Variant", "Foil"],
  variantId: ["Variant ID"], quantity: ["Quantity", "Total quantity", "Qty", "Copies", "Count"],
  language: ["Language", "Card language"], game: ["Game", "Product line", "Category"],
  region: ["TCG region"], productId: ["Product ID"], watchlist: ["Watchlist"],
};

export function mapTransferHeaders(headers: string[], requested: TransferFormat) {
  const keys = headers.map(identityText);
  const has = (...values: string[]) => values.every(value => keys.includes(identityText(value)));
  const inferred = has("TCG region", "Expansion", "Card number") ? "tcgcollector"
    : has("Portfolio Name", "Product Name", "Variance") ? "collectr"
    : has("Product ID") && (has("Condition") || has("Product Line")) ? "tcgplayer" : "custom";
  const format = requested === "auto" ? inferred : requested;
  if (format === "tcgcollector" && !has("Quantity")) throw new Error("Choose the TCG Collector collection export. It includes quantity.");
  const configured = { ...commonHeaders };
  if (format === "tcgplayer") configured.quantity = ["Total quantity", "Quantity", "Qty"];
  if (format === "collectr") configured.game = ["Category"];
  const mapping: ColumnMap = {};
  for (const field of Object.keys(transferFields) as TransferField[]) {
    for (const alias of configured[field]) {
      const key = identityText(alias), first = keys.indexOf(key);
      if (first < 0 || first !== keys.lastIndexOf(key)) continue;
      mapping[field] = first;
      break;
    }
  }
  if (format !== "custom" || !has("Set ID", "Variant ID")) delete mapping.variantId;
  return { format, mapping };
}

export function transferRows(csv: ReturnType<typeof parseTransferCsv>, mapping: ColumnMap) {
  if (mapping.productId === undefined && (mapping.set === undefined || (mapping.number === undefined && mapping.name === undefined))) {
    throw new Error("Map a set and a collector number or card name. TCGplayer files can also use Product ID.");
  }
  if (new Set(Object.values(mapping)).size !== Object.keys(mapping).length) throw new Error("Use each CSV column for only one field.");
  const rows: TransferRow[] = [];
  const invalid: number[] = [];
  for (const record of csv.records) {
    if (record.cells.length !== csv.headers.length) { invalid.push(record.line); continue; }
    const row: TransferRow = { line: record.line };
    for (const field of Object.keys(mapping) as TransferField[]) row[field] = record.cells[mapping[field]!]?.trim() ?? "";
    rows.push(row);
  }
  return { rows, invalid };
}
