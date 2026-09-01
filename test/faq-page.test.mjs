import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const faq = read("../src/app/faq/page.tsx");
const faqStyles = read("../src/components/FaqAccordion.module.css");
const serviceTemplate = read("../src/components/AssessmentServicePage.tsx");

test("FAQ publishes a curated visible answer set with matching schema data", () => {
  assert.match(faq, /const canonical = `\$\{PUBLIC_SITE\.apexUrl\}\/faq`/);
  assert.match(faq, /"@type": "FAQPage"/);
  assert.match(faq, /mainEntity: faqs\.map/);
  assert.equal([...faq.matchAll(/\bquestion: "/g)].length, 36);
  assert.match(faq, /Home Energy Rating from 0 to 100\+/);
  assert.match(faq, /Star Rating from 0 to 10/);
  assert.match(faq, /Residential Efficiency Scorecard closed on 23 June 2026/);
  assert.match(faq, /Whole of Home is the 0 to 100\+ rating used with the thermal Star Rating/);
  assert.match(faq, /cannot demonstrate National Construction Code compliance/);
});

test("FAQ uses an accessible server-rendered accordion and page-scoped styling", () => {
  assert.match(faq, /<details className=\{styles\.item\}/);
  assert.match(faq, /<summary className=\{styles\.question\}>/);
  assert.match(faq, /<p>\{faq\.answer\}<\/p>/);
  assert.match(faq, /guide-source-links \$\{styles\.breadcrumb\}/);
  assert.doesNotMatch(faq, /className="assessment-two-column"/);
  assert.doesNotMatch(faq, /useState|onClick=/);
  assert.match(faqStyles, /\.breadcrumb a \{ border: 0/);
  assert.match(faqStyles, /\.item\[open\] > \.question/);
  assert.match(faqStyles, /\.question::-webkit-details-marker/);
  assert.match(faqStyles, /\.support article \{ min-height: 0/);
});

test("FAQ states nationwide desktop delivery and honest on-site coverage", () => {
  assert.match(faq, /delivered remotely for projects across Australia/);
  assert.match(faq, /primarily in New South Wales and Victoria/);
  assert.match(faq, /other Australian locations are confirmed before a booking is accepted/);
  assert.match(faq, /five-minute call on this website is only a logistics call/);
  assert.doesNotMatch(faq, /government assessors?/i);
  assert.doesNotMatch(faq, /guaranteed (?:bill|saving|payback)/i);
});

test("service schema carries current review, publisher and legacy search names", () => {
  assert.match(serviceTemplate, /dateModified: reviewedIso/);
  assert.match(serviceTemplate, /publisher: \{ "@id": PUBLIC_SITE\.organizationId \}/);
  assert.match(serviceTemplate, /alternateName: alternateNames/);
});
