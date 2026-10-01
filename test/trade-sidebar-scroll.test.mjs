import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = ts.createSourceFile("DirectTradeDashboard.tsx", read("../src/components/DirectTradeDashboard.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function find(node, predicate) {
  if (predicate(node)) return node;
  let result;
  ts.forEachChild(node, child => { result ||= find(child, predicate); });
  return result;
}
const navigation = find(dashboard, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(dashboard) === "nav"
  && node.openingElement.getText(dashboard).includes('aria-label="TLink installer account"'));
const headerObserver = find(dashboard, node => ts.isVariableDeclaration(node) && node.name.getText(dashboard) === "observePortalHeader").initializer.arguments[0];
const context = { require: () => jsx, exports: {}, workspace: "account", activeWorkView: "today", offeredCount: 0,
  TLinkNavigationIcon: () => jsx.jsx("svg", { className: "tlink-navigation-icon", "aria-hidden": true }), TradeMessageUnreadBadge: () => null };
const markup = renderToStaticMarkup(Function(...Object.keys(context), `${compile(`const navigation = (${navigation.getText(dashboard)});`)}\nreturn navigation;`)(...Object.values(context)));
const styles = ["../src/app/globals.css", "../src/app/protected-workspaces.css", "../src/components/TLinkChrome.css", "../src/app/tlink-colour-mode.css"].map(read).join("\n");
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));

test("desktop rail scrolls independently through Business and mobile keeps its horizontal navigation", { skip: !browserPath && "No installed browser is available for layout checks" }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const scenario of [
      { name: "live desktop with business context bar", width: 2276, height: 1030, headerHeight: 72 },
      { name: "short laptop", width: 1366, height: 600, headerHeight: 72 },
      { name: "dashboard mounts after the document has scrolled", width: 1366, height: 600, headerHeight: 72, initialScroll: 300 },
      { name: "125 percent zoom equivalent CSS viewport", width: 1093, height: 614, headerHeight: 72 },
      { name: "wrapped narrow desktop header", width: 900, height: 600, headerHeight: 124 },
      { name: "mobile horizontal rail", width: 390, height: 844, headerHeight: 190, mobile: true },
    ]) await t.test(scenario.name, async () => {
      const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height } });
      await page.route("**/*", route => route.abort());
      await page.setContent(`<style>* { box-sizing: border-box; } html, body { margin: 0; font-family: Arial, sans-serif; } ${styles}</style><div id="business-context" style="height:46px">Working with Australian Energy Assessments</div><main class="direct-trade-dashboard-page"><div class="trade-portal-shell is-installer"><header class="dashboard-hero" style="height:${scenario.headerHeight}px">TLink</header>${markup}<section style="height:2400px;min-width:0">Business workspace</section></div></main>`);
      const initialScroll = scenario.initialScroll || 0;
      await page.evaluate(y => window.scrollTo(0, y), initialScroll);
      await page.evaluate(compile(`const observe = ${headerObserver.getText(dashboard)}; window.cleanupHeaderObserver = observe(document.querySelector('.dashboard-hero'));`));
      const rail = page.locator('.dashboard-workspace-nav');
      const business = rail.getByRole('button', { name: /^Business\b/ });
      assert.equal(await rail.getByRole('button', { name: /^Design & Measure\b/ }).count(), 1);
      await page.waitForFunction(() => document.querySelector('.trade-portal-shell').style.getPropertyValue('--trade-rail-top-offset'));
      if (scenario.mobile) {
        assert.equal(await rail.evaluate(node => getComputedStyle(node).flexDirection), "row");
        assert.equal(await rail.evaluate(node => getComputedStyle(node).overflowX), "auto");
        assert.ok(await rail.evaluate(node => node.scrollWidth > node.clientWidth));
        await business.focus();
        assert.ok(await rail.evaluate(node => node.scrollLeft > 0));
      } else {
        const railBounds = await rail.boundingBox();
        assert.ok(railBounds.y + railBounds.height <= scenario.height + 1, "The complete scroll container fits below the actual header");
        assert.ok(await rail.evaluate(node => node.scrollHeight > node.clientHeight), "The menu must retain an independent scroll range");
        await rail.hover();
        await page.mouse.wheel(0, 5000);
        await page.waitForFunction(() => { const nav = document.querySelector('.dashboard-workspace-nav'); return Math.abs(nav.scrollHeight - nav.clientHeight - nav.scrollTop) < 2; });
        assert.equal(await page.evaluate(() => window.scrollY), initialScroll, "Wheel input over the menu must not scroll the workspace");
        const last = await business.boundingBox();
        assert.ok(last.y >= railBounds.y && last.y + last.height <= scenario.height, "Business is fully visible after scrolling the menu");
        await page.mouse.wheel(0, 5000);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.scrollY), initialScroll, "Wheel input at the menu boundary must not chain to the page");
        await rail.evaluate(node => { node.scrollTop = 0; });
        await rail.getByRole('button').first().focus();
        for (let index = 1; index < await rail.getByRole('button').count(); index++) await page.keyboard.press('Tab');
        assert.equal(await business.evaluate(node => document.activeElement === node), true);
        assert.ok(await rail.evaluate(node => node.scrollTop > 0), "Keyboard focus reveals the bottom destination inside the menu");
        assert.equal(await page.evaluate(() => window.scrollY), initialScroll);
        await page.locator('#business-context').evaluate(node => { node.style.height = '80px'; });
        await page.waitForFunction(expected => Number.parseFloat(document.querySelector('.trade-portal-shell').style.getPropertyValue('--trade-rail-top-offset')) === expected, scenario.headerHeight + 80);
        const resizedBounds = await rail.boundingBox();
        assert.ok(resizedBounds.y + resizedBounds.height <= scenario.height + 1, "A growing business context bar cannot push the rail below the viewport");
        await page.evaluate(() => window.scrollTo(0, 300));
        await rail.hover();
        await page.mouse.wheel(0, 5000);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.scrollY), 300, "The sticky rail keeps wheel input independent after the page scrolls");
        const stickyLast = await business.boundingBox();
        assert.ok(stickyLast.y >= 0 && stickyLast.y + stickyLast.height <= scenario.height, "Business stays visible in the sticky rail");
      }
      await page.evaluate(() => window.cleanupHeaderObserver());
      assert.equal(await page.locator('.trade-portal-shell').evaluate(node => node.style.getPropertyValue('--trade-rail-top-offset')), "");
      await page.close();
    });
  } finally { await browser.close(); }
});
