import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as bounded from "../src/lib/bounded-json-request.ts";

function load(path, dependencies) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, result, result.exports);
  return result.exports;
}

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT,business_name TEXT,partner_type TEXT);
    CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,partner_type TEXT,record_status TEXT);
    CREATE TABLE trade_rental_inspections(id TEXT,work_order_id TEXT,firebase_uid TEXT,status TEXT,issued_report_id TEXT);
    CREATE TABLE trade_rental_reports(id TEXT,inspection_id TEXT,firebase_uid TEXT,status TEXT,report_number TEXT);
    INSERT INTO trade_accounts VALUES('business-a','Applied Trade Services','installer'),('business-b','Another business','installer');
    INSERT INTO trade_work_orders VALUES('job-a','business-a','installer','active'),('job-b','business-b','installer','active');
    INSERT INTO trade_rental_inspections VALUES('inspection-a','job-a','business-a','issued','report-a'),('inspection-b','job-b','business-b','issued','report-b');
    INSERT INTO trade_rental_reports VALUES('report-a','inspection-a','business-a','issued','RMS-A-R1'),('report-b','inspection-b','business-b','issued','RMS-B-R1');`);
  const admin = { uid: "real-admin", email: "admin@example.test", role: "admin", displayName: "Admin" };
  const state = { recipient: "hello@appliedtradeservices.com.au", review: null, delivery: null, linkStatus: "active", auditFailure: false, authFailure: "", send: null };
  const calls = { auth: [], audits: [], sends: [], verifications: [], lifetime: [] };
  const server = {
    sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
    adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }),
    adminError: error => Response.json({ ok: false, error: error.message }, { status: error.message === "AUTH_REQUIRED" ? 401 : ["ROLE_REQUIRED", "MFA_REQUIRED"].includes(error.message) ? 403 : 500 }),
    async requireAdminIdentity(request, roles) {
      calls.auth.push({ token: request.headers.get("authorization"), roles });
      if (state.authFailure) throw new Error(state.authFailure);
      if (!roles.includes(admin.role)) throw new Error("ROLE_REQUIRED");
      return admin;
    },
    async writeAdminAudit(...args) { if (state.auditFailure) throw new Error("Audit unavailable"); calls.audits.push(args); },
  };
  const service = load("../src/lib/admin-rental-report-email.ts", {
    "../../db": { getD1: () => ({ prepare: query => ({ bind: (...values) => ({ first: async () => sql.prepare(query).get(...values) || null }) }) }) },
    "./admin-server": server,
    "./trade-rental-report-provider-verification": { verifyRentalReportProviderDelivery: async input => {
      calls.verifications.push(input);
      return { status: "verified", reportId: input.reportId, providerStatus: "delivered", providerMessageId: "receipt-a",
        message: "The recipient mail server accepted the report email and its PDF matches the saved report." };
    } },
    "./trade-rental-report-server": { ownerRentalReportPresentation: async input => [{ id: input.inspectionId === "inspection-a" ? "report-a" : "report-b", link: { status: state.linkStatus } }] },
    "./trade-rental-report-email-server": {
      rentalReportDeliveryRecipient: async () => state.recipient ? { email: state.recipient, name: "James Winstanley" } : null,
      rentalReportDeliveryReview: async () => state.review,
      rentalReportDeliveryState: async () => state.delivery,
      emailRentalAssessmentReport: async input => {
        calls.sends.push(input);
        if (state.send) return state.send(input);
        return { status: "accepted", reportId: input.reportId, message: "The report email was accepted for delivery." };
      },
    },
  });
  const route = load("../src/app/api/admin/jobs/rental-report-email/route.ts", {
    "cloudflare:workers": { waitUntil: promise => calls.lifetime.push(promise) },
    "@/lib/admin-server": server, "@/lib/bounded-json-request": bounded,
    "@/lib/admin-rental-report-email": service,
  });
  const body = { workOrderId: "job-a", reportId: "report-a", expectedRecipientEmail: state.recipient };
  const post = (overrides = {}, headers = {}) => route.POST(new Request("https://example.test/api/admin/jobs/rental-report-email", {
    method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json", ...headers }, body: JSON.stringify({ ...body, ...overrides }),
  }));
  const get = (query = "workOrderId=job-a", headers = {}) => route.GET(new Request(`https://example.test/api/admin/jobs/rental-report-email?${query}`, { headers: { authorization: "Bearer admin-token", ...headers } }));
  return { sql, admin, state, calls, service, route, post, get, body };
}

test("admin status exposes only the exact current report and audits the real administrator", async () => {
  const f = fixture();
  const response = await f.get(), result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(result, { ok: true, reportId: "report-a", reportNumber: "RMS-A-R1", recipientEmail: f.body.expectedRecipientEmail,
    reportDelivery: null, canSend: true, canVerify: false, message: "The saved report is ready to email." });
  assert.equal(f.calls.sends.length, 0); assert.equal(f.calls.audits[0][0].uid, "real-admin");
  assert.equal(f.calls.audits[0][3], "job-a"); assert.equal(f.calls.audits[0][5].ownerUid, "business-a");
  assert.equal((await f.get("workOrderId=job-a&workOrderId=job-b")).status, 400);
});

test("admin resend derives business and preserves the administrator identity without granting general writes", async () => {
  const f = fixture();
  const response = await f.post({ ownerUid: "business-b", actorUid: "fake-owner", inspectionId: "inspection-b" });
  assert.equal(response.status, 200); assert.equal((await response.json()).reportDelivery.status, "accepted");
  assert.equal(f.calls.sends.length, 1); const sent = f.calls.sends[0];
  assert.equal(sent.access.ownerUid, "business-a"); assert.equal(sent.inspectionId, "inspection-a");
  assert.equal(sent.access.actorUid, "real-admin"); assert.equal(sent.access.isOwner, false); assert.equal(sent.access.memberId, "");
  assert.equal(sent.access.supportWorkOrderId, "job-a"); assert.equal(sent.access.canRunReports, true);
  assert.deepEqual(sent.admin, { uid: "real-admin", role: "admin" });
  for (const [key, value] of Object.entries(sent.access)) if (/^can/.test(key) && !["canRunReports", "canViewFieldEvidence"].includes(key)) assert.equal(value, false, key);
  assert.deepEqual(f.calls.audits.map(a => a[1]), ["job.report_email_requested", "job.report_email_result"]);
  assert.equal(f.calls.lifetime.length, 1); assert.equal(await f.calls.lifetime[0], response);
});

test("only authenticated owner/admin roles may view or resend; support transport and foreign origins remain blocked", async () => {
  for (const role of ["support", "reviewer"]) {
    const f = fixture(); f.admin.role = role;
    assert.equal((await f.get()).status, 403); assert.equal((await f.post()).status, 403);
    assert.equal(f.calls.sends.length, 0); assert.equal(f.calls.audits.length, 0);
  }
  const f = fixture();
  for (const headers of [{ Origin: "https://foreign.test" }, { "X-TLink-Admin-Job": "job-a" }]) {
    assert.equal((await f.get(undefined, headers)).status, 403); assert.equal((await f.post({}, headers)).status, 403);
  }
  assert.equal(f.calls.auth.length, 0); f.state.authFailure = "AUTH_REQUIRED";
  assert.equal((await f.post()).status, 401); assert.equal(f.calls.sends.length, 0);
  f.state.authFailure = "MFA_REQUIRED"; assert.equal((await f.post()).status, 403); assert.equal(f.calls.sends.length, 0);
});

test("changed recipient, cross-job report, inactive job and malformed identifiers fail without sending", async () => {
  const f = fixture();
  for (const input of [{ expectedRecipientEmail: "other@example.test" }, { reportId: "report-b" }, { expectedRecipientEmail: "" }]) {
    assert.equal((await f.post(input)).status, 409);
  }
  assert.equal((await f.post({ workOrderId: "../job-a" })).status, 400);
  f.sql.exec("UPDATE trade_work_orders SET record_status='archived' WHERE id='job-a'");
  assert.equal((await f.post()).status, 404); assert.equal(f.calls.sends.length, 0); assert.equal(f.calls.audits.length, 0);
});

test("owner holds, staged corrections, inactive links and uncertain delivery cannot be overridden by admin resend", async () => {
  for (const block of ["held", "staged", "link", "accepted", "sending", "reconciliation_required"]) {
    const f = fixture();
    if (block === "held") f.state.review = { status: "held", message: "Owner review is required." };
    else if (block === "staged") f.sql.exec("INSERT INTO trade_rental_reports VALUES('report-new','inspection-a','business-a','staged','RMS-A-R2')");
    else if (block === "link") f.state.linkStatus = "expired";
    else f.state.delivery = { status: block, reportId: "report-a", message: block };
    assert.equal((await (await f.get()).json()).canSend, false, block);
    const response = await f.post(); assert.equal((await response.json()).reportDelivery.status, ["held", "accepted", "sending", "reconciliation_required"].includes(block) ? block : "failed");
    assert.equal(f.calls.sends.length, 0, block);
  }
});

test("failed attempts are retryable and an audit failure prevents provider submission", async () => {
  const f = fixture(); f.state.delivery = { status: "failed", reportId: "report-a", message: "Retry email." };
  assert.equal((await (await f.get()).json()).canSend, true);
  f.state.auditFailure = true; assert.equal((await f.post()).status, 500); assert.equal(f.calls.sends.length, 0);
  await assert.rejects(f.calls.lifetime[0]);
  f.state.auditFailure = false; assert.equal((await f.post()).status, 200); assert.equal(f.calls.sends.length, 1);
});

test("resend request remains registered for worker completion while provider response is pending", async () => {
  const f = fixture(); let release;
  const pending = new Promise(resolve => { release = resolve; });
  f.state.send = async () => pending;
  const response = f.post();
  while (f.calls.sends.length === 0) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.lifetime.length, 1);
  release({ status: "accepted", reportId: "report-a", message: "Accepted." });
  assert.equal((await response).status, 200); await f.calls.lifetime[0];
  assert.equal(f.calls.audits.at(-1)[5].status, "accepted");
});

test("malformed and oversized bodies do not start a delivery", async () => {
  const f = fixture();
  for (const [body, status] of [["{", 400], [JSON.stringify({ padding: "a".repeat(4096) }), 413]]) {
    const response = await f.route.POST(new Request("https://example.test/api/admin/jobs/rental-report-email", {
      method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body,
    }));
    assert.equal(response.status, status);
  }
  assert.equal(f.calls.sends.length, 0); assert.equal(f.calls.lifetime.length, 0);
});

test("delivery verification uses the exact current job, recipient and real admin without sending", async () => {
  const f = fixture(); f.state.delivery = { status: "accepted", reportId: "report-a" };
  const response = await f.post({ action: "verify_delivery", ownerUid: "business-b", actorUid: "spoofed", providerMessageId: "spoofed" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verification.providerStatus, "delivered");
  assert.deepEqual(f.calls.verifications, [{ ownerUid: "business-a", workOrderId: "job-a", reportId: "report-a",
    expectedRecipientEmail: "hello@appliedtradeservices.com.au", actorUid: "real-admin" }]);
  assert.equal(f.calls.sends.length, 0);
  assert.deepEqual(f.calls.audits.map(a => a[1]), ["job.report_email_verification_requested", "job.report_email_verification_result"]);
  assert.equal(f.calls.lifetime.length, 1); await f.calls.lifetime[0];
});

test("a changed CRM recipient cannot inherit delivery and attachment evidence from a prior recipient", async () => {
  const f = fixture();
  f.state.delivery = { status: "accepted", reportId: "report-a", message: "Delivered.",
    recipientSha256: createHash("sha256").update(f.state.recipient).digest("hex"),
    providerStatus: "delivered", providerMessageId: "receipt-a", attachment: { filename: "RMS-A-R1.pdf" } };
  const initial = await (await f.get()).json();
  assert.equal(initial.canVerify, true); assert.equal(initial.reportDelivery.providerStatus, "delivered");
  f.state.recipient = "changed@example.test";
  const changed = await (await f.get()).json();
  assert.equal(changed.recipientEmail, "changed@example.test"); assert.equal(changed.canVerify, false);
  assert.equal(changed.canSend, false); assert.equal(changed.reportDelivery.status, "accepted");
  assert.equal(changed.reportDelivery.providerStatus, undefined); assert.equal(changed.reportDelivery.attachment, undefined);
  assert.match(changed.message, /Delivery to the current customer email is not confirmed/);
});

test("verification rejects stale reports, changed recipients, unknown actions, unsupported roles and unaudited requests", async () => {
  for (const input of [{ reportId: "report-b" }, { expectedRecipientEmail: "other@example.test" }]) {
    const f = fixture(); assert.equal((await f.post({ action: "verify_delivery", ...input })).status, 409);
    assert.equal(f.calls.verifications.length, 0); assert.equal(f.calls.sends.length, 0);
    await assert.rejects(f.calls.lifetime[0]);
  }
  const f = fixture();
  assert.equal((await f.post({ action: "unknown" })).status, 400);
  f.admin.role = "support"; assert.equal((await f.post({ action: "verify_delivery" })).status, 403);
  f.admin.role = "admin"; f.state.auditFailure = true;
  assert.equal((await f.post({ action: "verify_delivery" })).status, 500);
  await assert.rejects(f.calls.lifetime[0]);
  assert.equal(f.calls.verifications.length, 0); assert.equal(f.calls.sends.length, 0);
});
