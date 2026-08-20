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

test("the public privacy route covers the operational data boundary", () => {
  assert.match(privacy, /Privacy notice/);
  assert.match(privacy, /Protected leads and direct customers/);
  assert.match(privacy, /Surge conversations/);
  assert.match(privacy, /Up to 40 recent messages and a small conversation summary/);
  assert.match(privacy, /kept in that browser for up to 30 days/);
  assert.match(privacy, /stateless guide endpoint/);
  assert.match(privacy, /bounded set of recent user turns/);
  assert.match(privacy, /relevant maintained energy guidance to OpenAI/);
  assert.match(privacy, /provider-side response storage disabled/);
  assert.match(privacy, /does not create or read a server-side conversation record/);
  assert.match(privacy, /conversation text is not placed in analytics/);
  assert.match(privacy, /random first-party security cookie and short-lived, one-way security counters/);
  assert.match(privacy, /do not contain conversation text, a raw network address or a cross-device identity/);
  assert.match(privacy, /No third-party tracking cookie or fingerprint/);
  assert.doesNotMatch(privacy, /No customer question or conversation content is sent to a paid external AI service/);
  assert.match(privacy, /Optional Energy Guide contact requests/);
  assert.match(privacy, /Marketing consent is separate and off/);
  assert.match(privacy, /does not attach the raw conversation/);
  assert.match(privacy, /separately chooses trade sharing/);
  assert.match(privacy, /bytes and extracted text are not uploaded or stored/);
  assert.match(privacy, /Google Calendar, Outlook, Xero, MYOB or QuickBooks/);
  assert.match(privacy, /does not offer payment-provider connections or initiate customer payments/);
  assert.match(privacy, /do not sell personal information/i);
  assert.match(privacy, /info@ausenergyassessments\.com/);
  assert.doesNotMatch(privacy, /\b(?:TLink|Creditex)\b/);
  assert.match(privacy, /Open trade workspace/);
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
