import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const privacy = read("../src/app/privacy/page.tsx");
const integrations = read("../src/app/direct-trade/integrations/page.tsx");
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

test("the public integration route explains the TLink OAuth application purpose", () => {
  assert.match(integrations, /Connect your business tools to TLink/);
  assert.match(integrations, /applicationName: "TLink"/);
  assert.match(integrations, /siteName: "TLink"/);
  assert.match(integrations, /canonical: "\/direct-trade\/integrations"/);
  assert.match(integrations, /calendar\.events permission/);
  assert.match(integrations, /does not read Gmail, contacts or unrelated calendar events/);
  assert.match(integrations, /provider&apos;s own website/);
  assert.match(sitemap, /"\/direct-trade\/integrations"/);
});
