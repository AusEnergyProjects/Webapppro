import { unzipSync } from "fflate";

export const PRICE_BOOK_FILE_MAX_BYTES = 5 * 1024 * 1024;

// Inspect ZIP metadata without expanding its entries before the Excel reader runs.
export function checkPriceBookWorkbookArchive(buffer: ArrayBuffer) {
  if (!buffer.byteLength || buffer.byteLength > PRICE_BOOK_FILE_MAX_BYTES) throw new Error("Choose an Excel file smaller than 5 MB.");
  let expanded = 0; let entries = 0; let worksheets = 0; let workbook = false;
  unzipSync(new Uint8Array(buffer), { filter: (entry) => {
    entries += 1; expanded += entry.originalSize;
    if (entry.name === "xl/workbook.xml") workbook = true;
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name)) worksheets += 1;
    if (entries > 2000 || expanded > 30 * 1024 * 1024 || entry.originalSize > 12 * 1024 * 1024 || worksheets > 20) {
      throw new Error("This workbook is too large to read safely. Save only the price sheet in a smaller Excel file.");
    }
    return false;
  } });
  if (!workbook || !worksheets) throw new Error("This file is not a readable Excel workbook. Save it as .xlsx and try again.");
}
