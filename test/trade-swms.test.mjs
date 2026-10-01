import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { loadSwms, startSwms, saveSwms, SwmsError, swmsPdfRecord, swmsSignature } from "../src/lib/trade-swms-server.ts";
import { emptySwmsAnswers } from "../src/lib/trade-swms.ts";
import { renderSwmsPdf } from "../src/lib/trade-swms-pdf.ts";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "../src/lib/bounded-json-request.ts";

const now = "2026-10-02T05:00:00.000Z";
const owner = { ownerUid: "owner", actorUid: "owner", memberId: "owner-member", isOwner: true, jobScope: "team", canViewFieldEvidence: true, canManageFieldEvidence: true };
const worker = { ...owner, actorUid: "worker", memberId: "worker-member", isOwner: false, jobScope: "own" };
const answers = { workDescription: "Replace the damaged roof sheet.", highRiskWork: "Work with a risk of falling more than two metres.", workSteps: "1. Isolate area\n2. Establish access\n3. Replace sheet", hazardsControls: "Fall: install edge protection before access. Worker checks it remains in place.", consultation: "Discuss the steps and controls with the crew before work.", reviewPlan: "Worker checks controls before work and stops to review if conditions change." };
const signature = [{ points: [{ x: .1, y: .2, pressure: null, capturedAtOffsetMs: 0 }, { x: .3, y: .5, pressure: .5, capturedAtOffsetMs: 100 }, { x: .8, y: .3, pressure: .5, capturedAtOffsetMs: 250 }] }];
const fonts = { regular: new Uint8Array(fs.readFileSync(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url))), bold: new Uint8Array(fs.readFileSync(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url))) };

function fixture(t) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  const insert = (table, fields) => {
    const row = { ...fields };
    for (const col of sqlite.prepare(`PRAGMA table_info(${table})`).all()) if (col.notnull && col.dflt_value === null && row[col.name] === undefined) row[col.name] = /INT|REAL/.test(col.type) ? 0 : "";
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  };
  let beforeBatch, loseAcknowledgement = false;
  const prepare = (sql, values = []) => ({ bind: (...bindings) => prepare(sql, bindings),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  });
  const db = { prepare, batch: async statements => {
    beforeBatch?.(); beforeBatch = undefined;
    sqlite.exec("BEGIN");
    let result;
    try { result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("DB acknowledgement interrupted"); }
    return result;
  } };
  insert("trade_accounts", { firebase_uid: "owner", business_name: "Example Roofing", abn: "51824753556" });
  for (const [id, uid, name, scope] of [["owner-member", "owner", "Business Owner", "team"], ["worker-member", "worker", "Alex Worker", "own"], ["other-member", "other", "Other Worker", "own"]])
    insert("trade_team_members", { id, owner_uid: "owner", member_uid: uid, email: `${uid}@example.test`, display_name: name, job_scope: scope, status: "active", can_view_field_evidence: 1, can_manage_field_evidence: 1 });
  insert("trade_work_orders", { id: "job", firebase_uid: "owner", partner_type: "installer", work_number: "TLJ-101", title: "Roof repair", stage: "scheduled", revision: 1, assignee_member_id: "worker-member", created_at: now, updated_at: now });
  insert("trade_crm_job_details", { id: "details", work_order_id: "job", firebase_uid: "owner", crm_customer_id: "customer", service_site_id: "site", customer_source: "trade_owned", pipeline_stage: "scheduled" });
  insert("trade_crm_service_sites", { id: "site", firebase_uid: "owner", customer_id: "customer", address_line_1: "1 Example Street", suburb: "Melbourne", address_state: "VIC", postcode: "3000" });
  insert("trade_crm_appointments", { id: "visit", firebase_uid: "owner", work_order_id: "job", assignee_member_id: "worker-member", status: "scheduled", starts_at: "2026-10-03T09:00", revision: 1 });
  const start = (access = worker) => startSwms(db, access, "job", 1, now);
  const input = record => ({ workOrderId: "job", id: record.id, expectedRevision: record.revision, expectedJobRevision: 1, answers });
  return { sqlite, db, insert, start, input, race: callback => { beforeBatch = callback; }, loseAck: () => { loseAcknowledgement = true; } };
}

test("every business has the optional default with server business and booked worker prefill, never the owner as proxy signer", async t => {
  const f = fixture(t), payload = await loadSwms(f.db, owner, "job");
  assert.equal(payload.template.key, "tlink-swms-v1"); assert.equal(payload.record, null);
  assert.equal(payload.context.businessName, "Example Roofing"); assert.equal(payload.context.abn, "51824753556");
  assert.equal(payload.context.scheduledWorker.name, "Alex Worker"); assert.equal(payload.context.signer.name, "Business Owner");
  assert.equal(payload.capabilities.canEdit, true); assert.equal(payload.capabilities.canSign, false);
  const started = await f.start(owner), again = await f.start(owner);
  assert.equal(started.record.id, again.record.id); assert.equal(again.duplicate, true);
  assert.deepEqual(started.record.answers, { ...emptySwmsAnswers(), workDescription: "Roof repair" });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_job_forms").get().count, 0);
  assert.equal(f.sqlite.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
  await assert.rejects(saveSwms(f.db, owner, { ...f.input(started.record), finalize: true, signature }, now), /must sign in/);
});

test("draft saves and exact retries are isolated from progress; only the scheduled worker signs the immutable retained record", async t => {
  const f = fixture(t), initial = await f.start();
  const draftInput = f.input(initial.record);
  const draft = await saveSwms(f.db, worker, draftInput, now);
  assert.equal(draft.record.revision, 2); assert.equal(draft.jobRevision, 1);
  assert.equal((await saveSwms(f.db, worker, draftInput, now)).duplicate, true);
  const signInput = { ...f.input(draft.record), finalize: true, signature, signerName: "Spoofed Owner", context: { businessName: "Spoofed business" } };
  f.loseAck();
  const signed = await saveSwms(f.db, worker, signInput, now);
  assert.equal(signed.duplicate, true, "acknowledgement loss recovers the committed immutable record");
  assert.equal(signed.record.status, "complete"); assert.equal(signed.record.signature.signerName, "Alex Worker");
  assert.equal(signed.record.signature.signerMemberId, "worker-member"); assert.equal(signed.record.signature.signedAt, now);
  assert.equal(signed.jobRevision, 2); assert.equal(signed.capabilities.canEdit, false);
  assert.equal((await saveSwms(f.db, worker, signInput, now)).duplicate, true);
  await assert.rejects(saveSwms(f.db, worker, { ...signInput, answers: { ...answers, workDescription: "Changed" } }, now), /cannot be changed/);
  assert.equal(f.sqlite.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
  assert.equal(f.sqlite.prepare("SELECT pipeline_stage FROM trade_crm_job_details").get().pipeline_stage, "scheduled");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_work_order_events WHERE event_type='swms_signed'").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_crm_job_media").get().count, 0);
  assert.equal((await swmsPdfRecord(f.db, worker, "job")).record.context.businessName, "Example Roofing");
});

test("SWMS rejects empty, dot, out-of-range and oversized signature data without claiming acceptance", async t => {
  const f = fixture(t), initial = await f.start(), input = f.input(initial.record);
  for (const invalid of [[], [{ points: [signature[0].points[0]] }], [{ points: [{ ...signature[0].points[0], x: 2 }] }], Array(101).fill(signature[0])])
    assert.throws(() => swmsSignature(invalid));
  await assert.rejects(saveSwms(f.db, worker, { ...input, finalize: true, signature, answers: emptySwmsAnswers() }, now), /must be completed/);
  await assert.rejects(saveSwms(f.db, worker, { ...input, answers: { ...answers, reviewPlan: "x".repeat(4001) } }, now), /4,000/);
  assert.equal((await loadSwms(f.db, worker, "job")).record.revision, 1);
  await assert.rejects(swmsPdfRecord(f.db, worker, "job"), /Sign the SWMS/);
});

test("business scope, field permissions, terminal states and unassigned jobs remain enforced", async t => {
  const f = fixture(t);
  await assert.rejects(loadSwms(f.db, { ...owner, ownerUid: "foreign" }, "job"), /current field access/);
  await assert.rejects(loadSwms(f.db, { ...worker, actorUid: "other", memberId: "other-member" }, "job"), /current field access/);
  f.sqlite.exec("UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id='worker-member'");
  await assert.rejects(f.start(), /viewing/);
  f.sqlite.exec("UPDATE trade_team_members SET can_manage_field_evidence=1 WHERE id='worker-member'");
  for (const stage of ["imported", "completed", "cancelled"]) {
    f.sqlite.prepare("UPDATE trade_work_orders SET stage=?").run(stage); await assert.rejects(f.start(), /read-only/);
  }
  f.sqlite.exec("UPDATE trade_work_orders SET stage='scheduled'; UPDATE trade_crm_job_details SET pipeline_stage='lost'");
  await assert.rejects(f.start(), /read-only/);
  f.sqlite.exec("UPDATE trade_crm_job_details SET pipeline_stage='enquiry'; UPDATE trade_work_orders SET assignee_member_id=''; DELETE FROM trade_crm_appointments");
  const unassigned = await loadSwms(f.db, owner, "job"); assert.equal(unassigned.capabilities.canSign, false); assert.equal(unassigned.context.scheduledWorker.source, "unassigned");
  assert.match(unassigned.capabilities.reason, /Assign this job/);
});

test("current crew scope and assignment changes cannot be bypassed by a stale team-wide access object", async t => {
  const f = fixture(t), stale = { ...worker, jobScope: "team" };
  f.sqlite.exec("UPDATE trade_team_members SET job_scope='team' WHERE id='worker-member'; UPDATE trade_work_orders SET assignee_member_id='other-member'; UPDATE trade_crm_appointments SET assignee_member_id='other-member'");
  f.insert("trade_crews", { id: "crew", owner_uid: "owner", name: "Crew", lead_member_id: "worker-member" });
  f.insert("trade_crew_members", { owner_uid: "owner", crew_id: "crew", member_id: "worker-member" });
  await assert.rejects(loadSwms(f.db, stale, "job"), /current field access/);
});

test("atomic guard prevents assignment, permission, scheduling, sales-state and revision races", async t => {
  const f = fixture(t), initial = await f.start();
  const changes = [
    ["UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id='worker-member'", "UPDATE trade_team_members SET can_manage_field_evidence=1 WHERE id='worker-member'"],
    ["UPDATE trade_team_members SET status='inactive' WHERE id='worker-member'", "UPDATE trade_team_members SET status='active' WHERE id='worker-member'"],
    ["UPDATE trade_crm_appointments SET assignee_member_id='other-member'", "UPDATE trade_crm_appointments SET assignee_member_id='worker-member'"],
    ["UPDATE trade_crm_job_details SET pipeline_stage='lost'", "UPDATE trade_crm_job_details SET pipeline_stage='scheduled'"],
    ["UPDATE trade_work_orders SET revision=2", "UPDATE trade_work_orders SET revision=1"],
  ];
  for (const [change, reset] of changes) {
    f.race(() => f.sqlite.exec(change));
    await assert.rejects(saveSwms(f.db, worker, { ...f.input(initial.record), finalize: true, signature }, now));
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_job_swms").get().status, "draft");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
    f.sqlite.exec(reset);
  }
});

test("protected and foreign-customer site context is never included in the SWMS prefill", async t => {
  const f = fixture(t);
  f.sqlite.exec("UPDATE trade_work_orders SET source_type='opportunity'");
  let payload = await loadSwms(f.db, owner, "job"); assert.equal(payload.context.siteAddress, ""); assert.equal(payload.context.jobTitle, "Protected job");
  assert.equal((await f.start(owner)).record.answers.workDescription, "", "protected job descriptions are not copied into SWMS answers");
  f.sqlite.exec("UPDATE trade_work_orders SET source_type='internal'; UPDATE trade_crm_job_details SET customer_source='platform_private'");
  payload = await loadSwms(f.db, owner, "job"); assert.equal(payload.context.siteAddress, "");
  f.sqlite.exec("UPDATE trade_crm_job_details SET customer_source='trade_owned'; UPDATE trade_crm_service_sites SET customer_id='different-customer'");
  assert.equal((await loadSwms(f.db, owner, "job")).context.siteAddress, "");
});

test("signed PDF is deterministic, readable and retains snapshot identity after business changes", async t => {
  const f = fixture(t), initial = await f.start();
  await saveSwms(f.db, worker, { ...f.input(initial.record), finalize: true, signature }, now);
  f.sqlite.exec("UPDATE trade_accounts SET business_name='New name'; UPDATE trade_team_members SET display_name='New name' WHERE id='worker-member'");
  const signed = await swmsPdfRecord(f.db, worker, "job");
  const bytes = await renderSwmsPdf(signed.record, signed.template, signed.sha256, fonts);
  assert.deepEqual(bytes, await renderSwmsPdf(signed.record, signed.template, signed.sha256, fonts));
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
  const content = await extractText(bytes.slice(), { mergePages: true });
  assert.match(content.text, /Example Roofing/); assert.match(content.text, /Alex Worker/); assert.match(content.text, /Hazards and controls/);
  assert.match(content.text, /SWMS/); assert.doesNotMatch(content.text, /New name/);
  f.sqlite.exec("UPDATE trade_job_swms SET template_version=999,template_name='Unverified metadata'");
  const changedMetadata = await swmsPdfRecord(f.db, worker, "job");
  const retainedBytes = await renderSwmsPdf(changedMetadata.record, changedMetadata.template, changedMetadata.sha256, fonts);
  assert.deepEqual(retainedBytes, bytes, "PDF template identity comes from the verified signed snapshot, never mutable lookup metadata");
  assert.match(content.text, /Template version 1/);
  const pages = await extractText(retainedBytes.slice(), { mergePages: false });
  const signaturePage = pages.text.find(page => page.includes("Worker signature"));
  assert.ok(signaturePage, "the signature heading appears in the PDF");
  assert.match(signaturePage, /Authenticated worker/, "the signature heading, declaration and signer stay on the same page");
  assert.match(signaturePage, /conditions described/, "ordinary words wrap without splitting into fragments");
  f.sqlite.exec("UPDATE trade_job_swms SET answers_json='{}'");
  await assert.rejects(swmsPdfRecord(f.db, worker, "job"), /could not be verified/);
});

function routeFixture(t) {
  const f = fixture(t), calls = [], state = { sameOrigin: true, access: worker, authError: null, assignmentError: null, mfaResponse: null };
  class TradeAccessError extends Error {}
  const dependencies = {
    "../../../../db": { getD1: () => f.db },
    "@/lib/admin-server": {
      adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }),
      cleanAdminText: (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "",
      sameOrigin: () => state.sameOrigin, mfaErrorResponse: () => state.mfaResponse,
    },
    "@/lib/trade-access-server": { TradeAccessError },
    "@/lib/trade-team-server": {
      requireInstallerTeamAccess: async () => { calls.push("auth"); if (state.authError) throw state.authError; return state.access; },
      assignedJob: async (access, id) => { calls.push(["assignment", access, id]); if (state.assignmentError) throw state.assignmentError; },
    },
    "@/lib/bounded-json-request": { BoundedJsonRequestError, readBoundedJsonRequest },
    "@/lib/trade-swms-server": { loadSwms, saveSwms, startSwms, SwmsError, swmsPdfRecord },
    "@/lib/trade-swms-pdf": { renderSwmsPdf },
    "@/lib/customer-plan-pdf-fonts": { loadCustomerPlanPdfFonts: async () => fonts },
  };
  const output = ts.transpileModule(fs.readFileSync(new URL("../src/app/api/trade-swms/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmocked route dependency ${name}`); return dependencies[name];
  }, moduleRecord, moduleRecord.exports);
  return { ...f, route: moduleRecord.exports, calls, state, TradeAccessError };
}
const routeRequest = (method = "GET", body, query = "?workOrderId=job") => new Request(`https://example.test/api/trade-swms${query}`, {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
});

test("API uses authenticated job access for the default, mutations and private PDF, ignoring supplied identities", async t => {
  const f = routeFixture(t);
  const initialResponse = await f.route.GET(routeRequest());
  assert.equal(initialResponse.status, 200); assert.equal((await initialResponse.json()).context.scheduledWorker.name, "Alex Worker");
  const startedResponse = await f.route.POST(routeRequest("POST", { action: "start", workOrderId: "job", expectedJobRevision: 1, ownerUid: "foreign", actorUid: "owner" }));
  const started = await startedResponse.json(); assert.equal(startedResponse.status, 200);
  const completedResponse = await f.route.PATCH(routeRequest("PATCH", { ...f.input(started.record), finalize: true, signature, ownerUid: "foreign", signerName: "Fake signer" }));
  assert.equal(completedResponse.status, 200); const completed = await completedResponse.json();
  assert.equal(completed.record.signature.signerName, "Alex Worker");
  assert.equal(completedResponse.headers.get("Cache-Control"), "private, no-store");
  const pdf = await f.route.GET(routeRequest("GET", undefined, "?workOrderId=job&download=1"));
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
  assert.equal(pdf.headers.get("Content-Disposition"), 'attachment; filename="SWMS-TLJ-101.pdf"');
  assert.equal(pdf.headers.get("Cache-Control"), "private, no-store"); assert.equal(pdf.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).subarray(0, 8)), /^%PDF-/);
  assert.equal(f.calls.filter(call => Array.isArray(call)).length, 4);
  for (const call of f.calls.filter(call => Array.isArray(call))) assert.deepEqual(call, ["assignment", worker, "job"]);
});

test("API denies cross-origin, unauthenticated, revoked, unassigned and MFA requests before SWMS writes", async t => {
  const f = routeFixture(t), start = () => routeRequest("POST", { action: "start", workOrderId: "job", expectedJobRevision: 1 });
  f.state.sameOrigin = false;
  for (const method of ["GET", "POST", "PATCH"]) assert.equal((await f.route[method](method === "GET" ? routeRequest() : start())).status, 403);
  assert.deepEqual(f.calls, []); f.state.sameOrigin = true;
  for (const [error, status] of [[new Error("AUTH_REQUIRED"), 401], [new Error("FIELD_SESSION_REVOKED"), 403], [new f.TradeAccessError("Private account detail"), 403]]) {
    f.state.authError = error; const response = await f.route.POST(start()); assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /Private account detail/);
  }
  f.state.authError = new Error("MFA_REQUIRED"); f.state.mfaResponse = Response.json({ ok: false, code: "MFA_REQUIRED" }, { status: 403 });
  assert.equal((await f.route.POST(start())).status, 403); f.state.authError = null; f.state.mfaResponse = null;
  f.state.assignmentError = new Error("JOB_NOT_ASSIGNED"); assert.equal((await f.route.POST(start())).status, 403);
  f.state.assignmentError = new Error("JOB_NOT_FOUND"); assert.equal((await f.route.GET(routeRequest())).status, 404);
  f.state.assignmentError = new Error("Database secret"); const failed = await f.route.GET(routeRequest());
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /Database secret/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_job_swms").get().count, 0);
});

test("API rejects malformed and oversized streamed JSON, unknown starts and drafts requested as PDFs", async t => {
  const f = routeFixture(t);
  for (const body of ["{broken", "[]", "null", { action: "upload", workOrderId: "job", expectedJobRevision: 1 }])
    assert.equal((await f.route.POST(routeRequest("POST", body))).status, 400);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_200_001)); }, cancel() { cancelled = true; } });
  const tooLarge = await f.route.PATCH(new Request("https://example.test/api/trade-swms", { method: "PATCH", body, duplex: "half" }));
  assert.equal(tooLarge.status, 413); assert.equal(cancelled, true); assert.match((await tooLarge.json()).error, /too large/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_job_swms").get().count, 0);
  await f.start();
  const unsignedPdf = await f.route.GET(routeRequest("GET", undefined, "?workOrderId=job&download=1"));
  assert.equal(unsignedPdf.status, 404); assert.match((await unsignedPdf.json()).error, /Sign the SWMS/);
});

test("SWMS migration preserves all prior time records and indexes while accepting the new form kind", t => {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0232_trade_work_time.sql", import.meta.url), "utf8"));
  const insert = sqlite.prepare(`INSERT INTO trade_work_time_sessions
    (id,owner_uid,member_id,actor_uid,kind,source,form_kind,form_id,form_key,form_title,page_key,page_title,work_order_id,started_at,ended_at,observed_completed_at,received_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const end = "2026-10-02T05:30:00.000Z";
  for (const [index, kind] of ["job_form", "activity_record", "work_pack", "rental_inspection"].entries())
    insert.run(`old-${index}`, "owner", "worker", "worker-uid", "form", index % 2 ? "native" : "web", kind, `form-${index}`, `${kind}:job:form-${index}`, `Form ${index}`, "signature", "Signature", "job", now, end, index % 2 ? end : "", end, end);
  insert.run("old-app", "owner", "worker", "worker-uid", "app", "web", "", "", "", "", "", "", "", now, end, "", end, end);
  const before = sqlite.prepare("SELECT * FROM trade_work_time_sessions ORDER BY id").all();
  const beforeIndexes = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='trade_work_time_sessions' ORDER BY name").all();
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0233_trade_job_swms.sql", import.meta.url), "utf8"));
  assert.deepEqual(sqlite.prepare("SELECT * FROM trade_work_time_sessions ORDER BY id").all(), before);
  assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='trade_work_time_sessions' ORDER BY name").all(), beforeIndexes);
  const newRecord = ["new-swms", "owner", "worker", "worker-uid", "form", "native", "swms", "swms-1", "swms:job:swms-1", "SWMS", "signature", "Signature", "job", now, end, end, end, end];
  insert.run(...newRecord);
  assert.equal(sqlite.prepare("SELECT form_kind FROM trade_work_time_sessions WHERE id='new-swms'").get().form_kind, "swms");
  assert.throws(() => insert.run("invalid", ...newRecord.slice(1, 6), "unknown_form", ...newRecord.slice(7)), /CHECK constraint/);
  assert.throws(() => sqlite.prepare("UPDATE trade_work_time_sessions SET observed_completed_at=? WHERE id='new-swms'").run(now), /CHECK constraint/);
  assert.throws(() => sqlite.exec("UPDATE trade_work_time_sessions SET page_key='' WHERE id='new-swms'"), /CHECK constraint/);
  assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
});
