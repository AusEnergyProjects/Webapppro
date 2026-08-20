import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const customerDashboard = read("../src/components/CustomerDashboard.tsx");
const directTradeDashboard = read("../src/components/DirectTradeDashboard.tsx");
const tlinkChrome = read("../src/components/TLinkChrome.tsx");
const styles = read("../src/app/globals.css");

const customerNavigation = customerDashboard.match(
  /<nav\s+className="customer-dashboard-nav customer-product-navigation"[\s\S]*?<\/nav>/,
)?.[0] || "";

test("customer account destinations expose one consistent navigation contract", () => {
  assert.match(
    customerNavigation,
    /className="customer-dashboard-nav customer-product-navigation"/,
  );
  assert.equal(
    customerNavigation.match(/customer-dashboard-nav-item/g)?.length,
    6,
  );

  for (const [className, href, label] of [
    ["customer-dashboard-nav-overview", "/account", "Overview"],
    ["customer-dashboard-nav-quotes", "/account/quotes", "Quotes"],
    ["customer-dashboard-nav-appointments", "/account/appointments", "Appointments"],
    ["customer-dashboard-nav-new-project", "/account/projects/new", "New project"],
    ["customer-dashboard-nav-profile", "/account/profile", "Privacy and profile"],
  ]) {
    assert.match(customerNavigation, new RegExp(className));
    assert.match(customerNavigation, new RegExp(`href="${href.replaceAll("/", "\\/")}"`));
    assert.match(customerNavigation, new RegExp(`>${label}<\\/span>`));
  }

  assert.equal(customerNavigation.match(/aria-current=/g)?.length, 5);
  assert.match(customerNavigation, /className="customer-dashboard-nav-signout"/);
  assert.equal(
    customerDashboard.match(/\{customerNavigation\}/g)?.length,
    2,
  );
  assert.match(
    customerDashboard,
    /view === "profile"[\s\S]*?\{customerNavigation\}[\s\S]*?<ProfileForm/,
  );
});

test("customer trade access is a plain and role-gated trade workspace destination", () => {
  assert.doesNotMatch(customerDashboard, /import \{ TLinkMark \} from "\.\/TLinkChrome"/);
  assert.match(
    customerNavigation,
    /account\.tradeWorkspace[\s\S]*?href="\/direct-trade\/dashboard"/,
  );
  assert.match(customerNavigation, /aria-label="Open the trade workspace"/);
  assert.match(customerNavigation, />Trade workspace<\/span>/);
  assert.doesNotMatch(customerNavigation, /\bTLink\b/);
});

test("TLink headers keep an obvious reciprocal AEA home link", () => {
  assert.match(tlinkChrome, /AEA_BRANDMARK_PNG_DATA_URI/);
  assert.match(tlinkChrome, /aria-label="Return to Australian Energy Assessments"/);
  assert.match(tlinkChrome, /className="tlink-aea-product-mark"/);
  assert.match(
    tlinkChrome,
    /className="tlink-aea-product-name">Australian Energy Assessments<\/span>/,
  );
  assert.match(tlinkChrome, /export function AeaProductLink/);
  assert.match(
    tlinkChrome,
    /<TLinkBrand \/>[\s\S]*?<AeaProductLink placement="site-header" \/>/,
  );
  assert.match(
    directTradeDashboard,
    /className="trade-portal-brand"[\s\S]*?<AeaProductLink placement="trade-portal" \/>[\s\S]*?<TLinkCommandCentre/,
  );
  assert.doesNotMatch(tlinkChrome, />AEA home</);
});

test("TLink headers switch to bounded layouts before their controls can overflow", () => {
  assert.match(
    styles,
    /@media \(max-width: 960px\) \{[\s\S]*?\.trade-portal-shell \{ grid-template-rows: auto auto; \}[\s\S]*?tlink-command-launcher[\s\S]*?flex: 1 0 100%/,
  );
  assert.match(
    styles,
    /@media \(max-width: 800px\) \{[\s\S]*?\.tlink-site-header nav \{ flex: 1 0 100%; order: 3; overflow-x: auto; \}/,
  );
  assert.match(
    styles,
    /@media \(max-width: 420px\) \{[\s\S]*?\.tlink-aea-product-link-site-header \{ justify-content: flex-start; order: 2; \}/,
  );
});

test("reciprocal product navigation copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(
    `${customerNavigation}\n${tlinkChrome}\n${directTradeDashboard}`,
    /[\u2013\u2014]/,
  );
});
