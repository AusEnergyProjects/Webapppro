import { parseImportCsv } from "./trade-data-imports.mjs";
import type { PriceBookImportField, PriceBookImportRow } from "./trade-price-book-import.ts";
export { checkPriceBookWorkbookArchive, PRICE_BOOK_FILE_MAX_BYTES } from "./trade-price-book-workbook-guard.ts";
import { PRICE_BOOK_FILE_MAX_BYTES } from "./trade-price-book-workbook-guard.ts";

export const PRICE_BOOK_FILE_MAX_ROWS = 2000;
export type PriceBookSheet = { name: string; data: (string | number | boolean | Date | null)[][] };
export type PriceBookColumnMapping = Partial<Record<PriceBookImportField, number>>;
export const PRICE_BOOK_IMPORT_COLUMNS: { key: PriceBookImportField; label: string; aliases: string[] }[] = [
  { key: "name", label: "Item name", aliases: ["name", "item", "item name", "product", "product name", "service", "service name"] },
  { key: "sellPrice", label: "Sell price", aliases: ["sell price", "selling price", "sale price", "price", "unit price", "retail", "retail price", "charge", "rate"] },
  { key: "supplierCost", label: "Cost", aliases: ["cost", "supplier cost", "unit cost", "purchase price", "cost price", "buy price"] },
  { key: "itemCode", label: "TLink item code", aliases: ["tlink item code", "tlink code"] },
  { key: "supplierSku", label: "SKU / product code", aliases: ["sku", "supplier sku", "product code", "product sku", "stock code", "item code", "code"] },
  { key: "supplierName", label: "Supplier", aliases: ["supplier", "supplier name", "vendor"] },
  { key: "itemType", label: "Type", aliases: ["type", "item type"] },
  { key: "unitLabel", label: "Charge by", aliases: ["unit", "units", "unit label", "charge by", "uom"] },
  { key: "taxCode", label: "GST", aliases: ["gst", "tax", "tax code", "tax rate", "gst rate"] },
  { key: "description", label: "Description", aliases: ["description", "details", "item description", "product description"] },
  { key: "expectedDurationMinutes", label: "Expected minutes", aliases: ["expected minutes", "expected duration minutes", "duration minutes", "minutes"] },
  { key: "requiredSkill", label: "Required service", aliases: ["required skill", "required service", "required capability", "capability"] },
];

function headerKey(value: unknown) {
  return String(value ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[_()\-]/g, " ")
    .replace(/\b(?:ex|excl|excluding|inc|incl|including|inclusive|exclusive)\.?\s*(?:gst|tax)\b/g, "")
    .replace(/\b(?:gst|tax)\s*(?:inclusive|exclusive)\b/g, "").replace(/\s+/g, " ").trim();
}

export function detectPriceBookColumns(headers: unknown[]): PriceBookColumnMapping {
  const mapping: PriceBookColumnMapping = {};
  for (const column of PRICE_BOOK_IMPORT_COLUMNS) {
    const matches = headers.map((header, index) => column.aliases.includes(headerKey(header)) ? index : -1).filter((index) => index >= 0);
    if (matches.length === 1) mapping[column.key] = matches[0];
  }
  return mapping;
}

export function priceBookHeaderRow(data: PriceBookSheet["data"]) {
  const index = data.slice(0, 20).findIndex((row) => {
    const mapping = detectPriceBookColumns(row);
    return (mapping.name !== undefined || mapping.itemCode !== undefined || mapping.supplierSku !== undefined)
      && (mapping.sellPrice !== undefined || mapping.supplierCost !== undefined);
  });
  return index >= 0 ? index : Math.max(0, data.findIndex((row) => row.some((cell) => cell !== null && String(cell).trim())));
}

export function priceBookHeaderGstBasis(headers: unknown[], mapping: PriceBookColumnMapping): "inclusive" | "exclusive" | "mixed" | "unspecified" {
  const found = new Set<string>();
  for (const key of ["sellPrice", "supplierCost"] as const) {
    const column = mapping[key];
    if (column === undefined) continue;
    const text = String(headers[column] ?? "").toLowerCase().replace(/[_()\-]/g, " ");
    if (/\b(?:inc|incl|including|inclusive)\.?\s*(?:gst|tax)\b|\b(?:gst|tax)\s*inclusive\b/.test(text)) found.add("inclusive");
    if (/\b(?:ex|excl|excluding|exclusive)\.?\s*(?:gst|tax)\b|\b(?:gst|tax)\s*exclusive\b/.test(text)) found.add("exclusive");
  }
  return found.size > 1 ? "mixed" : found.has("inclusive") ? "inclusive" : found.has("exclusive") ? "exclusive" : "unspecified";
}

export function mapPriceBookRows(sheet: PriceBookSheet, headerRow: number, mapping: PriceBookColumnMapping): PriceBookImportRow[] {
  if (![mapping.name, mapping.itemCode, mapping.supplierSku].some((index) => index !== undefined)) throw new Error("Choose an item name, TLink item code or SKU column.");
  if (mapping.sellPrice === undefined && mapping.supplierCost === undefined) throw new Error("Choose a sell price or cost column.");
  const selected = Object.values(mapping);
  if (new Set(selected).size !== selected.length) throw new Error("Use each spreadsheet column once. Check the column choices below.");
  const rows: PriceBookImportRow[] = [];
  for (let index = headerRow + 1; index < sheet.data.length; index += 1) {
    const cells = sheet.data[index];
    const values: PriceBookImportRow["values"] = {};
    for (const { key } of PRICE_BOOK_IMPORT_COLUMNS) {
      const column = mapping[key];
      if (column === undefined) continue;
      const cell = cells[column];
      if (cell === null || cell === undefined || String(cell).trim() === "") continue;
      if (cell instanceof Date) throw new Error(`Row ${index + 1}: a date appears in ${key}. Change the cell to text or a price in Excel.`);
      if (typeof cell === "boolean" && key !== "taxCode") throw new Error(`Row ${index + 1}: use text or a number in ${key}.`);
      const value = String(cell).trim();
      if (value.length > 2000) throw new Error(`Row ${index + 1}: a cell is too long. Keep descriptions under 500 characters.`);
      values[key] = normalisePriceBookCell(key, value);
    }
    if (Object.keys(values).length) rows.push({ rowNumber: index + 1, values });
    if (rows.length > PRICE_BOOK_FILE_MAX_ROWS) throw new Error("Upload up to 2,000 items at a time. Split this catalogue into smaller files.");
  }
  if (!rows.length) throw new Error("Add at least one item below the column headings.");
  return rows;
}

const cellAliases: Partial<Record<PriceBookImportField, Record<string, string>>> = {
  itemType: { labor: "labour", labour: "labour", product: "material", products: "material", materials: "material", material: "material",
    equipment: "equipment", subcontractor: "subcontractor", subcontract: "subcontractor", travel: "travel", callout: "call_out", "call out": "call_out",
    "call out fee": "call_out", disposal: "disposal", certificate: "certificate", rebate: "rebate", discount: "discount", "non billable": "non_billable", "one off": "one_off", "one off work": "one_off" },
  unitLabel: { each: "each", ea: "each", unit: "each", hour: "hour", hours: "hour", hr: "hour", hrs: "hour", day: "day", days: "day", metre: "metre", metres: "metre", meter: "metre", meters: "metre", m: "metre", "square metre": "square_metre", "square metres": "square_metre", sqm: "square_metre", m2: "square_metre", "m²": "square_metre", kilometre: "kilometre", kilometres: "kilometre", km: "kilometre", visit: "visit", visits: "visit", fixed: "fixed", "fixed price": "fixed" },
  taxCode: { gst: "gst", "10%": "gst", "10": "gst", "0.1": "gst", yes: "gst", true: "gst", taxable: "gst", "gst 10%": "gst", none: "none", "0": "none", "0%": "none", no: "none", false: "none", "no gst": "none", "gst free": "none", "tax free": "none" },
};

function normalisePriceBookCell(field: PriceBookImportField, value: string) {
  if (field === "sellPrice" || field === "supplierCost") {
    const currency = value.replace(/^(?:AUD\s*\$?|\$)\s*/i, "");
    const cleaned = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(currency) ? currency.replaceAll(",", "") : currency;
    const exponent = cleaned.match(/^(-?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
    if (!exponent) return cleaned;
    const shift = Number(exponent[4]);
    if (Math.abs(shift) > 12) return cleaned;
    const digits = exponent[2] + (exponent[3] || ""); const decimal = exponent[2].length + shift;
    if (digits.length > 18) return cleaned;
    const expanded = decimal <= 0 ? `0.${"0".repeat(-decimal)}${digits}` : decimal >= digits.length ? digits + "0".repeat(decimal - digits.length) : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
    return exponent[1] + expanded;
  }
  const key = value.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  return cellAliases[field]?.[key] || value;
}

export async function readPriceBookSpreadsheet(file: File): Promise<PriceBookSheet[]> {
  if (!file.size || file.size > PRICE_BOOK_FILE_MAX_BYTES) throw new Error("Choose an Excel or CSV file smaller than 5 MB.");
  if (/\.csv$/i.test(file.name)) {
    const data: PriceBookSheet["data"] = parseImportCsv(await file.text());
    if (data.length > 2020 || data.some((row) => row.length > 100)) throw new Error("Keep the price sheet within 2,000 items and 100 columns.");
    return [{ name: "Price sheet", data }];
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an .xlsx or .csv file. In Excel, save older .xls files as .xlsx first.");
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./trade-price-book-spreadsheet.worker.ts", import.meta.url), { type: "module" });
    const stop = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { stop(); reject(new Error("This workbook took too long to read. Save only the price sheet in a smaller file and try again.")); }, 20_000);
    worker.onmessage = (event: MessageEvent<{ sheets?: PriceBookSheet[]; error?: string }>) => {
      stop();
      if (event.data.sheets) resolve(event.data.sheets);
      else reject(new Error(event.data.error || "The Excel file could not be read. Save it again in Excel and try again."));
    };
    worker.onerror = () => { stop(); reject(new Error("The Excel file could not be read. Save it again in Excel and try again.")); };
    worker.postMessage(buffer, [buffer]);
  });
}

export function priceBookTemplateCsv() {
  return "Item name,SKU,Sell price ex GST,Cost ex GST,GST,Supplier,Description\r\nCall out fee,CALLOUT,200.00,0.00,gst,,Standard call out\r\nElectrician labour per hour,LABOUR,120.00,60.00,gst,,One hour of labour\r\n";
}
