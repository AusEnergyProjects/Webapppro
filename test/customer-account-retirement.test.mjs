import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { retiredProjectPlannerPath } from "../src/lib/customer-account-retirement.mjs";

const families = ["customer-account", "customer-projects", "customer-project-history", "customer-project-plan-email", "customer-asset-ownership", "customer-asset-lifecycle", "customer-appointment-rescheduling", "customer-trade-quotes", "customer-project-evidence/uploads"];
for (const family of families) test(`${family} is retired for every former self-service operation`, async () => {
  const source = fs.readFileSync(new URL(`../src/app/api/${family}/route.ts`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /getD1|firebase|EvidenceBucket/);
  const compiled = ts.transpileModule(source.replace("@/lib/customer-account-retirement.mjs", new URL("../src/lib/customer-account-retirement.mjs", import.meta.url).href), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const handlers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    const response = handlers[method](new Request("https://example.test/api/" + family, { method }));
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).code, "CUSTOMER_ACCOUNTS_RETIRED");
  }
});

test("old project links preserve bounded planning choices without carrying identity or arbitrary redirects", () => {
  assert.equal(retiredProjectPlannerPath({ goal: ["move-from-gas", "lower-bills"], postcode: "3000", email: "private@example.test", returnTo: "https://attacker.test", feature: "solar" }), "/plan?goal=move-from-gas&goal=lower-bills&feature=solar&postcode=3000");
  assert.equal(retiredProjectPlannerPath({ goal: "a".repeat(81) }), "/plan");
});

test("shared trade evidence remains authorised, consented and audited, with no former customer bypass", () => {
  const source = fs.readFileSync(new URL("../src/app/api/customer-project-evidence/route.ts", import.meta.url), "utf8");
  assert.match(source, /await installerCanAccess\(user.uid, record\)/);
  assert.match(source, /if \(!installerAccess\)/);
  assert.match(source, /record.sharing_scope !== "allocated-installers"/);
  assert.match(source, /consent.withdrawn_at = ''/);
  assert.match(source, /verifiedTradeAccountPredicate/);
  assert.match(source, /INSERT INTO customer_project_evidence_events/);
  assert.doesNotMatch(source, /ownerAccess|request.formData|object_key\)\.delete/);
});

test("public planning PDFs and consented enquiries survive customer account removal", () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../src/app/api/customer-plan-pdf/route.ts"), /export async function POST/);
  assert.match(read("../src/components/DirectTradeProjectBrief.tsx"), /PublicPlanEnquiryForm/);
  assert.doesNotMatch(read("../src/components/DirectTradeProjectBrief.tsx"), /href="\/account/);
  assert.equal(fs.existsSync(new URL("../src/components/CustomerDashboard.tsx", import.meta.url)), false);
});

test("retired service follow-up endpoints cannot read or mutate data", () => {
  for (const path of ["../src/app/api/trade-service-follow-ups/route.ts", "../src/app/api/admin/service-follow-up-reporting/route.ts"]) {
    assert.equal(fs.existsSync(new URL(path, import.meta.url)), false);
  }
});

test("queued customer-account notifications are suppressed while installer acceptance can still deliver", () => {
  const source = fs.readFileSync(new URL("../src/lib/customer-project-activity-notification-server.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("activity.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ineligibility");
  const compiled = ts.transpileModule(declaration.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const eligible = new Function("validEmail", `${compiled}; return ineligibility;`)((email) => email || "");
  assert.match(eligible({ audience: "customer", installer_access_approved: 1 }), /accounts have been retired/);
  assert.equal(eligible({ audience: "installer", event_type: "customer_installer_accepted", installer_access_approved: 1,
    customer_decision: "accepted", contact_release_status: "active", installer_account_status: "active",
    email_opportunities: 1, installer_consent_at: "2026-09-09", installer_email: "trade@example.test" }), "");
});
