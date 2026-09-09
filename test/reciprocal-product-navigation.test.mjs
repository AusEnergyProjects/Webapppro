import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const directTradeDashboard = read("../src/components/DirectTradeDashboard.tsx");
const tlinkChrome = read("../src/components/TLinkChrome.tsx");
const styles = [
  read("../src/app/globals.css"),
  read("../src/app/protected-workspaces.css"),
  read("../src/components/TLinkChrome.css"),
].join("\n");

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
