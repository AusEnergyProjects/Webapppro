import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const source = ts.createSourceFile("DirectTradeDashboard.tsx", read("../src/components/DirectTradeDashboard.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let header;
function find(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "header"
    && node.openingElement.getText(source).includes('className="dashboard-hero"')) header = node;
  ts.forEachChild(node, find);
}
find(source);
assert.ok(header);
const compiled = ts.transpileModule(`const header = (${header.getText(source)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const context = {
  require: () => jsx, exports: {}, observePortalHeader: null, profile: { businessName: "A business with a longer name", brandThemeKey: "teal" },
  user: { uid: "test" }, isSupplier: false, hasBusinessOperations: true, hasTeamAccess: true, colourMode: "day", toggleColourMode() {},
  tradeBusinessThemeGradient: () => "linear-gradient(135deg,#093d45,#0d635b)",
  TLinkBrand: ({ context }) => jsx.jsxs("span", { className: "tlink-brand", children: [jsx.jsx("svg", { className: "tlink-brand-mark" }), jsx.jsxs("span", { children: [jsx.jsx("strong", { children: "TLink" }), jsx.jsx("small", { children: context })] })] }),
  AeaProductLink: () => jsx.jsxs("a", { className: "tlink-aea-product-link", href: "/", children: [jsx.jsx("span", { className: "tlink-aea-product-mark" }), jsx.jsx("span", { className: "tlink-aea-product-name", children: "Australian Energy Assessments" })] }),
  TLinkCommandCentre: () => jsx.jsxs("button", { className: "tlink-command-launcher", children: [jsx.jsx("span", { className: "tlink-command-search-icon" }), jsx.jsx("span", { children: "Search TLink" })] }),
  TradeJobNotifications: () => jsx.jsx("div", { className: "tlink-job-notifications", children: jsx.jsx("button", { "aria-label": "Work updates", children: "!" }) }),
  TradeTeamPresence: () => jsx.jsx("div", { className: "tlink-presence-presence", children: jsx.jsx("button", { className: "tlink-presence-control", children: "Available" }) }),
  Image: ({ alt, width, height }) => jsx.jsx("span", { "aria-label": alt, style: { display: "inline-block", width, height } }),
};
const renderHeader = overrides => {
  const values = { ...context, ...overrides };
  return renderToStaticMarkup(Function(...Object.keys(values), `${compiled}\nreturn header;`)(...Object.values(values)));
};
const styles = ["../src/app/globals.css", "../src/app/protected-workspaces.css", "../src/components/TLinkChrome.css", "../src/app/tlink-colour-mode.css"].map(read).join("\n").replace("@theme inline {", ":root {");
const executablePath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));

test("business header shows identity and account controls directly without a menu at desktop and phone widths", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const [width, isSupplier] of [320, 390, 768, 960, 1280, 1920].flatMap(width => [[width, false], [width, true]])) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      await page.setContent(`<style>${styles}</style><div class="trade-portal-shell ${isSupplier ? "is-supplier" : "is-installer"}">${renderHeader({ isSupplier })}<main>Jobs and forms</main></div>`);
      const bounds = await page.locator(".dashboard-hero").boundingBox();
      if (width < 780) assert.ok(bounds.height < 360, `Header uses ${bounds.height}px at ${width}px`);
      else assert.ok(bounds.height < 200, `Header only occupies its content height at ${width}px (${bounds.height}px)`);
      assert.equal(await page.locator(".dashboard-hero details").count(), 0, "Business controls do not require opening a disclosure");
      const controls = [".tlink-command-launcher", ".tlink-colour-mode-toggle", ".tlink-aea-product-link", ".dashboard-account-summary", ".dashboard-account-actions > button"];
      if (!isSupplier) controls.push(".tlink-job-notifications > button", ".tlink-presence-control", ".tlink-get-app");
      const rectangles = [];
      for (const selector of controls) {
        for (const control of await page.locator(selector).all()) {
          assert.equal(await control.isVisible(), true, selector);
          const rectangle = await control.boundingBox();
          assert.ok(rectangle.x >= 0 && rectangle.x + rectangle.width <= width + 1, `${selector} stays within ${width}px viewport`);
          assert.ok(rectangle.y >= bounds.y && rectangle.y + rectangle.height <= bounds.y + bounds.height + 1, `${selector} stays inside header at ${width}px (${JSON.stringify({ rectangle, bounds })})`);
          rectangles.push(rectangle);
        }
      }
      for (let a = 0; a < rectangles.length; a++) for (let b = a + 1; b < rectangles.length; b++) {
        const left = rectangles[a], right = rectangles[b];
        assert.ok(left.x + left.width <= right.x + 1 || right.x + right.width <= left.x + 1
          || left.y + left.height <= right.y + 1 || right.y + right.height <= left.y + 1, "Header controls do not overlap");
      }
      const labels = ["Business settings", "Sign out", "Australian Energy Assessments", context.profile.businessName];
      if (!isSupplier) labels.push("Available", "Get the app");
      for (const label of labels) {
        assert.equal(await page.getByText(label, { exact: true }).isVisible(), true, label);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Header does not cause horizontal scrolling");
      if (process.env.TEST_HEADER_SCREENSHOT_DIR && !isSupplier && [390, 1280].includes(width)) {
        await page.screenshot({ path: `${process.env.TEST_HEADER_SCREENSHOT_DIR}/header-${width}.png` });
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
