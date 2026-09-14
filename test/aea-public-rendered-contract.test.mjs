import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the real public route/component tree. Only framework navigation, chrome,
// styles and the interactive enquiry boundary are replaced; catalogue, metadata,
// price presentation, JSON-LD and FAQ components execute unchanged.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cache = new Map();
const styles = new Proxy({}, { get: (_target, property) => String(property) });
const Link = ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);
const chrome = { SiteHeader: () => null, SiteFooter: ({ children }) => React.createElement("footer", null, children) };

function load(relative) {
  const file = path.resolve(project, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const compiledModule = { exports: {} };
  cache.set(file, compiledModule);
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file.replace(/\.mjs$/, ".ts"),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const resolveImport = (specifier) => {
    if (specifier === "next/link") return Link;
    if (specifier.endsWith(".module.css")) return styles;
    if (specifier.endsWith("/aea-services.css")) return {};
    if (specifier.endsWith("/ComparatorChrome")) return chrome;
    if (specifier.endsWith("/AeaServiceEnquiryButton")) return {
      AeaServiceEnquiryButton: ({ serviceId, children }) => React.createElement("button", { "data-enquiry-service": serviceId }, children || "Enquire now"),
    };
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return require(specifier);
    const base = specifier.startsWith("@/") ? path.join(project, "src", specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
    const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.mjs`].find((candidate) => existsSync(candidate));
    assert.ok(resolved, `Unresolved component dependency ${specifier}`);
    return load(path.relative(project, resolved));
  };
  new Function("require", "module", "exports", compiled)(resolveImport, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

const decode = (text) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
const graph = (html) => [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .flatMap((match) => { const data = JSON.parse(match[1]); return data["@graph"] || [data]; });
const catalogue = load("src/lib/aea-services.mjs");
const publicSite = load("src/lib/public-site.ts").PUBLIC_SITE;

for (const [id, pathName, total, area] of [
  ["smoke-alarm-blind-safety", "/services/smoke-alarm-blind-safety", "110.00", ["Victoria"]],
  ["gas-safety-check", "/services/gas-safety-check", "275.00", ["Victoria"]],
  ["electrical-safety-check", "/services/electrical-safety-check", "275.00", ["Victoria"]],
  ["minimum-rental-standards", "/minimum-rental-standards", "187.00", ["Victoria"]],
  ["nathers-new", "/nathers-for-new-homes", "330.00", ["Australia"]],
  ["nathers-existing", "/home-energy-rating-for-existing-homes", "330.00", ["NSW", "Victoria"]],
  ["onsite-energy-assessment", "/services/onsite-energy-assessment", "198.00", ["NSW", "Victoria"]],
]) {
  test(`${id}: rendered price, canonical, current area and one FAQ graph agree`, () => {
    const route = load(`src/app${pathName}/page.tsx`);
    const html = renderToStaticMarkup(React.createElement(route.default));
    const nodes = graph(html);
    const services = nodes.filter((node) => node["@type"] === "Service");
    const faqs = nodes.filter((node) => node["@type"] === "FAQPage");
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1);
    assert.equal(services.length, 1, "The existing guide and priced panel must describe one primary service");
    assert.equal(faqs.length, 1);
    assert.equal(nodes.filter((node) => node["@type"] === "BreadcrumbList").length, 1);
    assert.equal(route.metadata.alternates.canonical, `${publicSite.apexUrl}${pathName}`);
    assert.equal(services[0].url, `${publicSite.apexUrl}${pathName}`);
    assert.equal(services[0].offers.price, total);
    assert.equal(services[0].offers.priceCurrency, "AUD");
    assert.equal(services[0].offers.priceSpecification.valueAddedTaxIncluded, true);
    const served = JSON.stringify(services[0].areaServed).replace(/New South Wales/g, "NSW");
    for (const place of area) assert.ok(served.includes(place), `Expected current service area ${place}, got ${served}`);
    const visible = text(html);
    const service = catalogue.getAeaService(id);
    assert.ok(visible.includes(catalogue.audPrice(service.priceExGstCents)));
    assert.ok(visible.includes(catalogue.audPrice(Number(total) * 100)));
    assert.match(visible, /including GST/);
    assert.ok(html.includes(`data-enquiry-service="${id}"`));
    const summaries = [...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map((match) => text(match[1]));
    for (const question of faqs[0].mainEntity) {
      assert.ok(summaries.includes(question.name), `FAQ must be a visible dropdown: ${question.name}`);
      assert.ok(visible.includes(question.acceptedAnswer.text), `Schema answer is missing from visible page: ${question.name}`);
    }
    assert.ok(service.sources.length > 0);
    for (const source of service.sources) assert.ok(html.includes(source.url.replaceAll("&", "&amp;")), `Missing official source ${source.url}`);
  });
}

test("rendered catalogue and bundles retain exact offer counts, two-year totals and annual labels", () => {
  const components = load("src/components/AeaServices.tsx");
  const hub = renderToStaticMarkup(React.createElement(components.AeaServicesPage));
  const hubOffers = graph(hub).find((node) => node["@type"] === "OfferCatalog").itemListElement;
  assert.equal(hubOffers.length, 7);
  assert.deepEqual(hubOffers.map((offer) => offer.price), ["110.00", "275.00", "275.00", "187.00", "330.00", "330.00", "198.00"]);
  const offers = renderToStaticMarkup(React.createElement(components.AeaOffersPage));
  const packages = graph(offers).find((node) => node["@type"] === "OfferCatalog").itemListElement;
  assert.deepEqual(packages.map((offer) => offer.price), ["495.00", "770.00"]);
  const visible = text(offers);
  for (const amount of ["$225", "$247.50", "$450", "$495", "$350", "$385", "$700", "$770"]) assert.ok(visible.includes(amount), amount);
  assert.match(visible, /year equivalent/);
  assert.match(visible, /two-year total including GST/);
  assert.doesNotMatch(visible, /\$112\.50|\$175\b|50% off/);
});
