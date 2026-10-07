import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const worker = read("worker/index.ts");
const policyStart = worker.indexOf("function secureResponse(");
const policyEnd = worker.indexOf("\nfunction queueCustomerOpportunityDispatch(", policyStart);
assert.ok(policyStart >= 0 && policyEnd > policyStart);
const secureResponse = new Function("PRIVATE_HTML_CACHE_CONTROL", "releaseIdentityFromEnvironment", `${stripTypeScriptTypes(worker.slice(policyStart, policyEnd))}; return secureResponse;`)("private, no-store, max-age=0", () => "");

// Model the client-side navigation that keeps the initial document's policy.
// Native anchors instead request a new document and its target route policy.
const Link = ({ children, prefetch: _prefetch, ...props }) => React.createElement("a", { ...props, "data-client-navigation": true }, children);
const nothing = () => null;
const dependencies = {
  React, Link, BrandBar: nothing, PublicSiteSearch: nothing, SiteNav: nothing,
  ServicesHeaderLink: nothing, SurgeHeaderButton: nothing, TLinkBrand: () => React.createElement("span", null, "TLink"),
  AeaProductLink: nothing, PUBLIC_SITE: { phoneHref: "tel:0000000000", phoneDisplay: "Phone" },
  useState: React.useState, councilReportPeriod: () => ({ timeZone: "Australia/Melbourne" }),
  QuickUpgradeEnquiryDialog: nothing, styles: { entry: "entry", entryPanel: "panel", brand: "brand", secondary: "secondary" },
};

async function component(path, name, end) {
  const source = read(path);
  const start = source.indexOf(`export function ${name}(`);
  const finish = end ? source.indexOf(end, start) : source.length;
  assert.ok(start >= 0 && finish > start);
  const { code } = await transform(source.slice(start, finish).replace(/^export /, ""), { loader: "tsx", jsxFactory: "React.createElement", jsxFragment: "React.Fragment" });
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

const SiteHeader = await component("src/components/ComparatorChrome.tsx", "SiteHeader", '\nexport { SiteFooter }');
const TLinkHeader = await component("src/components/TLinkChrome.tsx", "TLinkHeader");
const CouncilProgram = await component("src/components/CouncilProgram.tsx", "CouncilProgram");
const entries = [
  { path: "/", target: "/direct-trade/dashboard", name: "Open TLink", component: SiteHeader, props: { active: "start" } },
  { path: "/direct-trade/standards", target: "/direct-trade/dashboard", name: "Dashboard", component: TLinkHeader, props: { active: "standards" } },
  { path: "/council/program/example", target: "/council", selector: 'a[href="/council"]', component: CouncilProgram, props: { campaign: null } },
];

test("public portal entry links do not inherit a document's prohibited microphone policy", { skip: !browserPath, timeout: 30000 }, async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const entry = entries.find(item => item.path === url.pathname);
    const content = entry ? renderToStaticMarkup(React.createElement(entry.component, entry.props)) : "<p>Portal document</p>";
    const page = secureResponse(new Response(content, { headers: { "Content-Type": "text/html" } }), new Request(url));
    response.writeHead(page.status, Object.fromEntries(page.headers));
    response.end(`${content}<script>document.addEventListener('click', event => { const link = event.target.closest('a[data-client-navigation]'); if (link) { event.preventDefault(); history.pushState({}, '', link.href); document.body.innerHTML = '<p>Portal reached through client navigation</p>'; } });</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, timeout: 10000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const entry of entries) {
      await page.goto(`${base}${entry.path}`);
      assert.equal(await page.evaluate(() => document.featurePolicy.allowsFeature("microphone")), false, `${entry.path} prohibits microphone use`);
      await (entry.selector ? page.locator(entry.selector) : page.getByRole("link", { name: entry.name, exact: true })).click();
      await page.waitForURL(`${base}${entry.target}`);
      assert.equal(await page.evaluate(() => document.featurePolicy.allowsFeature("microphone")), true, `${entry.path} entry acquires the portal document policy`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("other public trade entry links also request the portal document", () => {
  for (const path of ["src/components/GettingStarted.tsx", "src/app/privacy/page.tsx", "src/app/rental-assessment/request/page.tsx", "src/app/direct-trade/integrations/page.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /<Link\b[^>]*href="\/direct-trade\/dashboard(?:\?[^"]*)?"/, path);
    assert.match(source, /<a\b[^>]*href="\/direct-trade\/dashboard(?:\?[^"]*)?"/, path);
  }
});
