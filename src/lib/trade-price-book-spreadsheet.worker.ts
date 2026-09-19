import { checkPriceBookWorkbookArchive } from "./trade-price-book-workbook-guard";

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    checkPriceBookWorkbookArchive(event.data);
    const { default: readWorkbook } = await import("read-excel-file/web-worker");
    const sheets = await readWorkbook(event.data, { parseNumber: (value) => value });
    if (sheets.some(({ data }) => data.length > 2020 || data.some((row) => row.length > 100))) {
      throw new Error("Keep the price sheet within 2,000 items and 100 columns. Save only the price sheet in a smaller workbook.");
    }
    self.postMessage({ sheets: sheets.map(({ sheet, data }) => ({ name: sheet, data })) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "The Excel file could not be read." });
  }
};
