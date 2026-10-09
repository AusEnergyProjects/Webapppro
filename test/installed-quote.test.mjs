import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseInstalledQuote } from "../src/lib/installed-quote.ts";

test("installed quotes accept complete dollar amounts and retain cents", () => {
  assert.equal(parseInstalledQuote("4500.12"), 4500.12);
  assert.equal(parseInstalledQuote("0.01"), 0.01);
  assert.equal(parseInstalledQuote(" 11600 "), 11600);
  for (const value of ["", " ", "0", "-500", "0.001", "4500.123", "NaN", "Infinity", "1e308", "1e309", "90071992547410", "price"]) {
    assert.equal(parseInstalledQuote(value), null, value);
  }
});

test("Google tag commands queue the documented Arguments objects and preserve an existing tag", () => {
  const source = fs.readFileSync(new URL("../src/components/AnalyticsConsent.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function ensureGoogleTagFunction()");
  const end = source.indexOf("function ensureGoogleConsentDefaults()", start);
  const context = vm.createContext({ window: {} });
  vm.runInContext(source.slice(start, end) + "ensureGoogleTagFunction();", context);
  context.window.gtag("config", "G-3PGGJ0JX4H", { send_page_view: false });
  const command = context.window.dataLayer[0];
  assert.equal(Object.prototype.toString.call(command), "[object Arguments]");
  assert.equal(command[0], "config");
  assert.equal(command[2].send_page_view, false);
  const existing = context.window.gtag;
  vm.runInContext("ensureGoogleTagFunction();", context);
  assert.equal(context.window.gtag, existing);
  assert.equal(context.window.dataLayer.length, 1);
});
