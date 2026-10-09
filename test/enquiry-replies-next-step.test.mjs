import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const source = fs.readFileSync(new URL("../src/components/EnquiryRepliesNextStep.tsx", import.meta.url), "utf8");
const record = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "react/jsx-runtime") return jsxRuntime;
  assert.equal(name, "./PublicPlanEnquiryForm.module.css");
  return { default: { repliesNextStep: "replies-next-step" } };
}, record, record.exports);
const render = (deliveryStatus, email = "customer@example.test", replyLinkExpected = true) => renderToStaticMarkup(jsxRuntime.jsx(record.exports.EnquiryRepliesNextStep, { email, deliveryStatus, replyLinkExpected }));

test("queued and accepted emails do not claim customer delivery", () => {
  const queued = render("queued");
  assert.match(queued, /queued for delivery/);
  assert.doesNotMatch(queued, /has been delivered/);
  const accepted = render("sent");
  assert.match(accepted, /accepted for delivery/);
  assert.doesNotMatch(accepted, /has been delivered/);
  assert.match(render("delivered"), /has been delivered/);
  assert.match(render("not_queued"), /being prepared/);
});

test("requests without an available reply link get email/contact instructions without promising a quote page", () => {
  const html = render("queued", "customer@example.test", false);
  assert.match(html, /Keep your confirmation email/);
  assert.match(html, /explains how to contact us/);
  assert.doesNotMatch(html, /Open my quotes|Keep the link private|private link/);
});

test("the next step names the email action without exposing a private URL or adding a form", () => {
  const html = render("queued", "<img src=x onerror=alert(1)>@example.test");
  assert.match(html, /Open my quotes &amp; questions/);
  assert.match(html, /No account or extra form is needed/);
  assert.match(html, /Keep the link private/);
  assert.match(html, /href="tel:1300241149"/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<form|customer-hub\//);
});
