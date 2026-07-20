import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const privacy = read("../src/app/privacy/page.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const upload = read("../src/components/JobInformationUpload.tsx");
const sitemap = read("../src/app/sitemap.ts");

test("the public privacy route covers the operational TLink data boundary", () => {
  assert.match(privacy, /Privacy notice/);
  assert.match(privacy, /Protected leads and direct customers/);
  assert.match(privacy, /Google Calendar, Outlook, Xero, MYOB, QuickBooks, Stripe or Square/);
  assert.match(privacy, /do not sell personal information/i);
  assert.match(privacy, /info@ausenergyassessments\.com/);
});

test("customer evidence and shared navigation resolve to the public privacy route", () => {
  assert.match(upload, /href="\/privacy"/);
  assert.match(chrome, /href="\/privacy">Privacy/);
  assert.match(sitemap, /"\/privacy"/);
});
