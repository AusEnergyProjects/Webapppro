import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const source = fs.readFileSync(new URL("../src/components/DirectTradeDashboard.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("DirectTradeDashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found;
  function visit(node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found, "Expected production contact panel code");
  return found;
}
const helper = find(node => ts.isFunctionDeclaration(node) && node.name?.text === "contactFieldIsRedacted").getText(parsed);
const declaration = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name).getText(parsed);
const panel = find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "section"
  && node.openingElement.getText(parsed).includes('className="dashboard-connected-customer-identity"')).getText(parsed);
const compiled = ts.transpileModule(`
${helper}
exports.render = (opportunity, isExpanded = true) => {
  const ${declaration("releasedCustomerContact")};
  const ${declaration("releasedCustomerName")};
  const ${declaration("customerDisplayName")};
  const customerIdentityId = "contact-test";
  const customerIdentityHeadingId = "contact-heading-test";
  return (${panel});
};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const production = {};
Function("exports", "require", compiled)(production, id => { assert.equal(id, "react/jsx-runtime"); return jsx; });
const render = (contact, expanded = true) => renderToStaticMarkup(production.render({ customerContact: contact, title: "Energy assessment" }, expanded));
const contact = {
  name: "Jamie Example", email: "jamie@example.com", phone: "0400000000",
  addressLine1: "12 Example Street", addressLine2: "", suburb: "Melbourne", addressState: "VIC", postcode: "3000",
  message: "Please call in the afternoon.", grantedAt: "2026-09-23T00:00:00Z", releaseScope: "all_qualified_trades", redactedFields: [],
};

test("a selected lead with no active release keeps labelled contact rows and explains the boundary", () => {
  const html = render(null);
  for (const label of ["Name", "Phone"]) assert.match(html, new RegExp(`<dt>${label}</dt><dd>Redacted</dd>`));
  assert.match(html, /<dt>Email<\/dt><dd>Awaiting customer release<\/dd>/);
  assert.match(html, /No active contact release is available/);
  assert.match(html, /customer needs to release their details before you can call or email them/);
  assert.doesNotMatch(html, /href=|tel:|mailto:|undefined|Invalid Date/);
});

test("available contact details provide direct phone and email links with address and message", () => {
  const html = render(contact);
  assert.match(html, /<dt>Name<\/dt><dd>Jamie Example<\/dd>/);
  assert.match(html, /href="tel:0400000000"/);
  assert.match(html, /href="mailto:jamie@example.com"/);
  assert.match(html, /12 Example Street, Melbourne, VIC, 3000/);
  assert.match(html, /Please call in the afternoon/);
  assert.doesNotMatch(html, /Redacted|Not provided/);
});

test("partial release marks unavailable fields without rendering withheld values in text or links", () => {
  const html = render({ ...contact, name: "WITHHELD_NAME", phone: "WITHHELD_PHONE", redactedFields: ["name", "phone"] });
  assert.match(html, /<dt>Name<\/dt><dd>Redacted<\/dd>/);
  assert.match(html, /<dt>Phone<\/dt><dd>Redacted<\/dd>/);
  assert.match(html, /href="mailto:jamie@example.com"/);
  assert.match(html, /these details have not been released to your business/);
  assert.doesNotMatch(html, /WITHHELD_|tel:/);
});

test("AEA authorization exposes complete contacts while legacy withheld fields remain explicitly redacted", () => {
  const html = render({ ...contact, releaseScope: "aea_only" });
  assert.match(html, /customer authorised Australian Energy Assessments/);
  assert.match(html, /href="tel:0400000000"/);
  assert.match(html, /href="mailto:jamie@example.com"/);
  assert.doesNotMatch(html, /Redacted|Not provided/);
  const legacy = render({ ...contact, phone: "PRIVATE_PHONE", releaseScope: "aea_only", redactedFields: ["phone"] });
  assert.match(legacy, /<dt>Phone<\/dt><dd>Redacted<\/dd>/);
  assert.doesNotMatch(legacy, /PRIVATE_PHONE/);
});

test("empty legacy contact fields remain redacted and unavailable email never renders a dead link", () => {
  const legacy = { ...contact, phone: "", redactedFields: undefined };
  assert.match(render(legacy), /<dt>Phone<\/dt><dd>Redacted<\/dd>/);
  assert.match(render({ ...legacy, releaseScope: "shortlisted_installer" }), /<dt>Phone<\/dt><dd>Redacted<\/dd>/);
  assert.match(render({ ...legacy, redactedFields: [] }), /<dt>Phone<\/dt><dd>Redacted<\/dd>/);
  for (const restricted of [{ ...contact, email: "" }, { ...contact, email: "PRIVATE_EMAIL", redactedFields: ["email"] }]) {
    const html = render(restricted);
    assert.match(html, /<dt>Email<\/dt><dd>Awaiting customer release<\/dd>/);
    assert.doesNotMatch(html, /mailto:|PRIVATE_EMAIL|Not provided/);
  }
});

test("unselected contact panels do not render contact data or actionable links", () => {
  const html = render(contact, false);
  assert.match(html, /hidden=""/);
  assert.doesNotMatch(html, /Jamie|0400000000|jamie@example|href=|<dt>|aria-labelledby/);
});
