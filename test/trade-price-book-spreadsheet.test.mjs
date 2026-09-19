import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import readWorkbook from "read-excel-file/node";
import { checkPriceBookWorkbookArchive, detectPriceBookColumns, mapPriceBookRows, priceBookHeaderGstBasis, priceBookHeaderRow,
  priceBookTemplateCsv, readPriceBookSpreadsheet } from "../src/lib/trade-price-book-spreadsheet.ts";

const sheet = (headers, rows) => ({ name: "Prices", data: [headers, ...rows] });
const parse = (headers, rows) => mapPriceBookRows(sheet(headers, rows), 0, detectPriceBookColumns(headers));

test("common catalogue headings map names, cost, price and supplier identifiers without confusing categories or external codes", () => {
  const headers = ["Product name", "Item code", "Cost ex GST", "Selling price inc. GST", "Category", "TLink item code"];
  const mapping = detectPriceBookColumns(headers);
  assert.deepEqual(mapping, { name: 0, sellPrice: 3, supplierCost: 2, itemCode: 5, supplierSku: 1 });
  assert.equal(priceBookHeaderGstBasis(headers, mapping), "mixed");
  assert.equal(priceBookHeaderGstBasis(["Name", "Price (incl GST)", "Cost inclusive GST"], { name: 0, sellPrice: 1, supplierCost: 2 }), "inclusive");
  assert.equal(priceBookHeaderGstBasis(["Name", "Sell_price_ex_gst"], { name: 0, sellPrice: 1 }), "exclusive");
  assert.equal(priceBookHeaderGstBasis(["Name", "Price"], { name: 0, sellPrice: 1 }), "unspecified");
});

test("title rows are skipped and duplicate headings require an explicit choice", () => {
  assert.equal(priceBookHeaderRow([["My catalogue"], [null], ["Name", "Price"], ["Call out fee", 220]]), 2);
  assert.deepEqual(detectPriceBookColumns(["Name", "Price", "Price"]), { name: 0 });
  assert.throws(() => mapPriceBookRows(sheet(["Name", "Price"], [["Call out", "200"]]), 0, { name: 0, sellPrice: 0 }), /each spreadsheet column once/);
});

test("friendly money, GST, units and types become canonical values without rounding invalid prices", () => {
  const rows = parse(["Name", "Price", "Cost", "Type", "Unit", "GST", "SKU"], [
    ["Call out fee", "$1,200.00", "AUD $200.00", "Call-out", "Visit", "10%", "00123"],
    ["Labour", "2.2e2", "6E1", "Labor", "Hours", true, "LAB"],
    ["Discount", "-10.00", "0", "Discount", "Fixed price", "No GST", "DISC"],
    ["Invalid precision", "1.234", "1,2", "Strange type", "Strange unit", "11%", "BAD"],
  ]);
  assert.deepEqual(rows[0].values, { name: "Call out fee", sellPrice: "1200.00", supplierCost: "200.00", supplierSku: "00123", itemType: "call_out", unitLabel: "visit", taxCode: "gst" });
  assert.equal(rows[1].values.sellPrice, "220"); assert.equal(rows[1].values.supplierCost, "60");
  assert.equal(rows[1].values.itemType, "labour"); assert.equal(rows[1].values.unitLabel, "hour"); assert.equal(rows[1].values.taxCode, "gst");
  assert.equal(rows[2].values.taxCode, "none"); assert.equal(rows[2].values.unitLabel, "fixed");
  assert.equal(rows[3].values.sellPrice, "1.234"); assert.equal(rows[3].values.supplierCost, "1,2");
  assert.equal(rows[3].values.itemType, "Strange type"); assert.equal(rows[3].values.taxCode, "11%");
});

test("blank optional cells are omitted, zero is retained and original sheet row numbers are kept", () => {
  assert.deepEqual(parse(["Name", "Price", "Cost", "Description"], [["Call out fee", "220", 0, ""], [null], ["Labour", "120", null, ""]]), [
    { rowNumber: 2, values: { name: "Call out fee", sellPrice: "220", supplierCost: "0" } },
    { rowNumber: 4, values: { name: "Labour", sellPrice: "120" } },
  ]);
  assert.throws(() => parse(["Name", "Price"], [["Call out", new Date()]]), /date appears/);
  assert.throws(() => parse(["Name", "Price"], [["Call out", true]]), /text or a number/);
  assert.throws(() => parse(["Name", "Price"], Array.from({ length: 2001 }, (_, index) => ["Item " + index, "10"])), /2,000 items/);
});

test("CSV upload handles quoted commas and its downloadable example is directly importable", async () => {
  const [csv] = await readPriceBookSpreadsheet(new File(['\uFEFFProduct name,Price,Description\r\n"Call out, weekend",220,"Includes ""after hours"""\r\n'], "rates.csv"));
  assert.deepEqual(mapPriceBookRows(csv, 0, detectPriceBookColumns(csv.data[0])), [{ rowNumber: 2, values: { name: "Call out, weekend", sellPrice: "220", description: 'Includes "after hours"' } }]);
  const [template] = await readPriceBookSpreadsheet(new File([priceBookTemplateCsv()], "template.csv"));
  const rows = mapPriceBookRows(template, 0, detectPriceBookColumns(template.data[0]));
  assert.equal(rows.length, 2); assert.equal(rows[0].values.itemType, "call_out");
  await assert.rejects(readPriceBookSpreadsheet(new File(["old workbook"], "prices.xls")), /save older .xls/);
});

function workbook(extraEntries = {}) {
  const xml = (value) => strToU8(value);
  return zipSync({
    "[Content_Types].xml": xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
    "xl/workbook.xml": xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/><sheet name="Other prices" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'),
    "xl/sharedStrings.xml": xml('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si><si><t>SKU</t></si><si><t>Price ex GST</t></si><si><r><t>Call out</t></r><r><t xml:space="preserve"> fee</t></r></si><si><t>00123</t></si></sst>'),
    "xl/worksheets/sheet1.xml": xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><f>200+20</f><v>220</v></c></row></sheetData></worksheet>'),
    "xl/worksheets/sheet2.xml": xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Labour</t></is></c><c r="B2"><v>120</v></c></row></sheetData></worksheet>'),
    ...extraEntries,
  });
}

test("real XLSX reader keeps rich text, text SKU zeroes, multiple sheets and cached formula values", async () => {
  const bytes = workbook(); const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  checkPriceBookWorkbookArchive(buffer);
  const sheets = await readWorkbook(Buffer.from(buffer), { parseNumber: (value) => value });
  assert.equal(sheets.length, 2); assert.equal(sheets[1].sheet, "Other prices");
  const first = { name: sheets[0].sheet, data: sheets[0].data };
  assert.deepEqual(mapPriceBookRows(first, 0, detectPriceBookColumns(first.data[0])), [{ rowNumber: 2, values: { name: "Call out fee", sellPrice: "220", supplierSku: "00123" } }]);
});

test("XLSX limits reject expanded archive bombs before extracting entries", () => {
  const tooLarge = workbook({ "xl/sharedStrings.xml": new Uint8Array(13 * 1024 * 1024) });
  assert.ok(tooLarge.byteLength < 5 * 1024 * 1024);
  assert.throws(() => checkPriceBookWorkbookArchive(tooLarge.buffer), /too large to read safely/);
  const notExcel = zipSync({ "some.txt": strToU8("hello") });
  assert.throws(() => checkPriceBookWorkbookArchive(notExcel.buffer), /not a readable Excel/);
});
