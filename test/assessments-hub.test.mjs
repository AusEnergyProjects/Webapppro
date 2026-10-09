import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as publicSite from "../src/lib/public-site.ts";
import * as services from "../src/lib/aea-services.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const page = read("../src/app/assessments/page.tsx");
const home = read("../src/components/GettingStarted.tsx");
const guides = read("../src/app/guides/page.tsx");
const navigation = read("../src/components/ResponsiveSiteNav.tsx");
const styles = read("../src/app/globals.css");

function renderHub() {
  const dependencies = {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ href, children }) => jsxRuntime.jsx("a", { href, children }) },
    "@/components/JsonLd": { JsonLd: ({ data }) => jsxRuntime.jsx("script", { type: "application/ld+json", children: JSON.stringify(data) }) },
    "@/components/ComparatorChrome": { SiteHeader: () => null, SiteFooter: ({ children }) => jsxRuntime.jsx("footer", { children }) },
    "@/lib/public-site": publicSite,
    "@/lib/aea-services.mjs": services,
  };
  const record = { exports: {} };
  const compiled = ts.transpileModule(page, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, record, record.exports);
  return renderToStaticMarkup(jsxRuntime.jsx(record.exports.default, {}));
}

test("assessment services are first class routes across the site", () => {
  assert.match(navigation, /\["\/assessments", "Assessment types"\]/);
  assert.match(home, /NatHERS<br \/>assessments/);
  assert.ok(home.indexOf("home-assessments") < home.indexOf("home-tools-title"));
  assert.match(home, /href="\/assessments"/);
  assert.match(guides, /title="Assessments and ratings"/);
  assert.match(guides, /href="\/assessments"/);
});

test("the hub separates new homes, existing homes and NSW BASIX", () => {
  assert.match(page, /New homes and major renovations/);
  assert.match(page, /Still working from plans\? A NatHERS assessor models the proposed home before construction/);
  assert.match(page, /Homes that are already built/);
  assert.match(page, /Want to understand how your current home performs and what to improve first/);
  assert.match(page, /Home Energy Rating from 0 to 100\+/);
  assert.match(page, /Star Rating from 0 to 10/);
  assert.match(page, /not the certificate used to prove new-home building-code compliance/);
  assert.match(page, /Building or renovating in NSW\? BASIX is part of the planning process/);
  assert.match(page, /alterations and additions costing \$50,000 or more/);
  assert.match(page, /swimming pools of 40,000 litres or more/);
});

test("existing-home advice and formal rating have distinct deliverables, catalogue prices and service links", () => {
  const markup = renderHub();
  const text = markup.replace(/<[^>]+>/g, " ");
  assert.match(text, /Onsite energy assessment: advice without a certificate/);
  assert.match(text, /written advice and practical priorities, without a formal rating certificate/);
  assert.match(text, /Home Energy Rating: two ratings and a certificate/);
  for (const serviceId of ["onsite-energy-assessment", "nathers-existing", "nathers-new"]) {
    const service = services.getAeaService(serviceId);
    assert.ok(service);
    assert.ok(text.includes(`${services.audPrice(services.gstInclusiveCents(service.priceExGstCents))} including GST`));
    assert.ok(markup.includes(`href="${service.path}"`));
  }
  assert.ok(markup.includes('href="/services#energy-assessments"'));
  assert.match(text, /BASIX, separate specialist reports and redesign work are scoped separately/);
});

test("hub structured service scope matches the visible existing-home delivery areas", () => {
  const markup = renderHub();
  const schema = JSON.parse(markup.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const nodes = schema["@graph"].filter((item) => item["@type"] === "Service");
  assert.equal(nodes.length, 4);
  assert.equal(new Set(nodes.map((item) => item["@id"])).size, 4);
  for (const route of ["/services/onsite-energy-assessment", "/home-energy-rating-for-existing-homes"]) {
    const service = nodes.find((item) => item.url === `${publicSite.PUBLIC_SITE.apexUrl}${route}`);
    assert.ok(service);
    assert.deepEqual(service.areaServed.map((area) => area.name), ["New South Wales", "Victoria"]);
  }
  const advice = nodes.find((item) => item.url.endsWith("/services/onsite-energy-assessment"));
  assert.match(advice.serviceType, /without a rating certificate/);
  assert.equal(schema["@graph"].find((item) => item["@type"] === "ItemList").numberOfItems, nodes.length);
});

test("official sources, date and approval boundaries remain visible", () => {
  assert.match(page, /Official guidance checked 1 September 2026/);
  assert.match(page, /Requirements can change/);
  assert.match(page, /homeenergyrating\.gov\.au\/households\/new-homes/);
  assert.match(page, /homeenergyrating\.gov\.au\/households\/existing-homes/);
  assert.match(page, /planningportal\.nsw\.gov\.au\/development-and-assessment\/basix/);
  assert.match(page, /planningportal\.nsw\.gov\.au\/basix-thermal-performance-section/);
  assert.match(page, /does not replace the approval authority/);
  assert.doesNotMatch(page, /cdr\.|\/cds-au\/|\/api\//);
});

test("the hub explains the 2026 brand transition and provides a booking path", () => {
  assert.match(page, /Home Energy Rating is the new existing-home consumer brand/);
  assert.match(page, /Residential Efficiency Scorecard service closed on 23 June 2026/);
  assert.match(page, /Whole of Home is a new-home rating/);
  assert.match(page, /href="\/home-energy-rating-vs-nathers-vs-scorecard"/);
  assert.match(page, /href="\/residential-efficiency-scorecard"/);
  assert.match(page, /href="\/book-an-assessment"/);
  assert.doesNotMatch(page, /type="file"|<input/);
  assert.match(page, /What is a home energy assessment\?/);
  assert.match(page, /How much does a home energy assessment cost\?/);
  assert.match(page, /"@type": "ItemList"/);
  assert.match(page, /assessmentServiceNodes/);
});

test("assessment cards align on desktop and stack on mobile", () => {
  assert.match(styles, /\.assessment-card-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.assessment-card \{[^}]*display: grid;[^}]*grid-row: span 5;[^}]*grid-template-rows: subgrid/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.assessment-card \{ display: flex; grid-row: auto; min-height: 0; \}/);
  assert.match(styles, /\.assessment-home-grid[^\n]*\.assessment-card-grid[^\n]*\.assessment-process[^\n]*\.assessment-two-column/);
});

test("assessment customer copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(`${page}${home}${guides}`, /\u2013|\u2014/);
  assert.doesNotMatch(page, /\bAEA\b/);
  assert.match(page, /Choose the right home energy assessment/);
  assert.match(page, /Not sure where to start\?/);
});
