import { strFromU8, unzipSync } from "fflate";

function decodeXml(value: string) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() || "A";
  return letters.split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xmlValues(xml: string) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join(""),
  );
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function dateStyleIndexes(stylesXml: string) {
  const customDates = new Set<number>();
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]+)"/g)) {
    if (/[dmy]/i.test(decodeXml(match[2]).replace(/\[[^\]]+\]/g, ""))) customDates.add(Number(match[1]));
  }
  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "";
  return new Set([...cellXfs.matchAll(/<xf\b([^>]*)\/?>(?:<\/xf>)?/g)].flatMap((match, index) => {
    const numFmtId = Number(match[1].match(/\bnumFmtId="(\d+)"/)?.[1] || 0);
    return (numFmtId >= 14 && numFmtId <= 22) || (numFmtId >= 45 && numFmtId <= 47) || customDates.has(numFmtId) ? [index] : [];
  }));
}

function excelDate(value: string) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 0) return value;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

export async function workbookToCsv(file: File) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const shared = archive["xl/sharedStrings.xml"] ? xmlValues(strFromU8(archive["xl/sharedStrings.xml"])) : [];
  const dateStyles = archive["xl/styles.xml"] ? dateStyleIndexes(strFromU8(archive["xl/styles.xml"])) : new Set<number>();
  const workbook = archive["xl/workbook.xml"] ? strFromU8(archive["xl/workbook.xml"]) : "";
  const relationshipId = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1] || "rId1";
  const relationships = archive["xl/_rels/workbook.xml.rels"] ? strFromU8(archive["xl/_rels/workbook.xml.rels"]) : "";
  const target = relationships.match(new RegExp(`<Relationship\\b[^>]*Id="${relationshipId}"[^>]*Target="([^"]+)"`))?.[1] || "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const bytes = archive[sheetPath] || archive["xl/worksheets/sheet1.xml"];
  if (!bytes) throw new Error("The Excel workbook does not contain a readable worksheet.");
  const sheet = strFromU8(bytes);
  const rows = [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const values: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cell[1].match(/\br="([^"]+)"/)?.[1] || "A1";
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1] || "";
      const style = Number(cell[1].match(/\bs="(\d+)"/)?.[1] || 0);
      const raw = cell[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? cell[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      values[columnIndex(reference)] = type === "s" ? shared[Number(raw)] || "" : dateStyles.has(style) ? excelDate(raw) : decodeXml(raw);
    }
    return values;
  }).filter((row) => row.some(Boolean));
  if (rows.length < 2) throw new Error("The Excel worksheet needs a header row and at least one data row.");
  return `${rows.map((row) => row.map((value) => csvCell(value || "")).join(",")).join("\n")}\n`;
}
