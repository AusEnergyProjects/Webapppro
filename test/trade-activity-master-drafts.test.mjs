import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as library from "../src/lib/trade-activity-forms-library.ts";
import * as core from "../src/lib/trade-activity-forms.ts";
import * as bounded from "../src/lib/bounded-json-request.ts";
import { canEditCreditexFieldMasters } from "../src/lib/creditex-field-master-access.ts";
import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import { certificateTestDependency } from "./helpers/creditex-training-fixture.mjs";

const routeSource = fs.readFileSync(new URL("../src/app/api/trade-activity-forms/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  for (const name of ["0170_trade_activity_forms.sql", "0190_trade_activity_master_drafts.sql"]) {
    database.exec(fs.readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  database.exec(`CREATE TABLE compliance_audit_events (
    id TEXT PRIMARY KEY, organisation_id TEXT, actor_type TEXT CHECK(actor_type IN ('platform','compliance','installer')),
    actor_uid TEXT, event_type TEXT, target_type TEXT, target_id TEXT, summary TEXT, metadata TEXT, created_at TEXT
  );`);
  let actor = { uid: "reviewer-a", organisationId: "creditex", organisationCode: "CREDITEX-AU",
    displayName: "Jamie Smith", email: "jamie.smith@example.com", role: "reviewer" };
  let beforeBatch;
  let policy = library.applyDefaultActivityFormPolicy;
  const d1 = {
    prepare(sql) {
      const bind = (...values) => ({
        async first() { return database.prepare(sql).get(...values) || null; },
        async all() { return { results: database.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: Number(database.prepare(sql).run(...values).changes) } }; },
      });
      return { ...bind(), bind };
    },
    async batch(statements) {
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = undefined; await callback(); }
      database.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
  const dependencies = {
    "../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": { mfaErrorResponse, sameOrigin: (request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
      adminJson: (body, status = 200) => Response.json(body, { status }), requireAdminIdentity: async () => ({ uid: "aea-admin" }) },
    "@/lib/compliance-access-server": { requireComplianceAccess: async (_request, options) => {
      if (!actor || !options.allowedRoles.includes(actor.role)) throw new Error("ACTIVITY_AUTHOR_REQUIRED"); return actor;
    } },
    "@/lib/creditex-field-master-access": { canEditCreditexFieldMasters },
    "@/lib/creditex-official-source-custody-server": { resolveActiveCreditexOfficialSourceOrganisation: async () => "creditex" },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => { throw new Error("ACTIVITY_ACCESS_REQUIRED"); } },
    "@/lib/trade-activity-forms-server": {}, "@/lib/trade-activity-forms": core,
    "@/lib/trade-activity-forms-library": { ...library, applyDefaultActivityFormPolicy: (...args) => policy(...args) },
    "@/lib/bounded-json-request": bounded,
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name in dependencies) return dependencies[name];
    const result = certificateTestDependency(name); assert.ok(result, name); return result;
  }, moduleRecord, moduleRecord.exports);
  const route = moduleRecord.exports;
  async function post(body, extraHeaders = {}) {
    const response = await route.POST(new Request("https://test.invalid/api/trade-activity-forms", {
      method: "POST", headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify({ actorMode: "creditex", ...body }),
    }));
    return { status: response.status, body: await response.json() };
  }
  async function get(query = "view=master_drafts&actorMode=creditex") {
    const response = await route.GET(new Request(`https://test.invalid/api/trade-activity-forms?${query}`));
    return { status: response.status, body: await response.json() };
  }
  const form = library.defaultActivityFieldForm("veu-6");
  const create = (extra = {}) => post({ action: "create_master_draft", activityTemplateId: form.activityTemplateId,
    variantId: form.variantId, expectedVersion: 0, ...extra });
  const count = (table) => database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  return { database, form, post, get, create, count, setActor: (value) => { actor = { ...actor, ...value }; },
    race: (callback) => { beforeBatch = callback; }, policy: (callback) => { policy = callback; } };
}

test("draft copies persist separately, reopen across requests, and publish only the saved reviewed copy", async (t) => {
  const h = fixture(t);
  const first = await h.create(); assert.equal(first.status, 200);
  const draft = first.body.draft;
  assert.equal(draft.revision, 1); assert.equal(draft.baseMasterVersion, 0); assert.equal(draft.baseIsCurrent, true);
  assert.equal(h.count("trade_activity_field_masters"), 0);
  const edited = { ...draft.form, title: "Creditex reviewed air conditioning draft" };
  const saved = await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1, form: edited });
  assert.equal(saved.status, 200); assert.equal(saved.body.draft.revision, 2);
  assert.equal(h.count("trade_activity_field_masters"), 0);
  const reopened = await h.get(`view=master_drafts&actorMode=creditex&draftId=${draft.id}`);
  assert.equal(reopened.body.draft.form.title, edited.title);
  const live = await h.get(`view=masters&actorMode=creditex&activityTemplateId=veu-6&variantId=${h.form.variantId}`);
  assert.equal(live.body.form.title, h.form.title);
  const catalogue = await h.get("view=masters&actorMode=creditex");
  assert.equal(catalogue.body.drafts[0].title, edited.title); assert.ok(catalogue.body.catalogue.length > 0);
  assert.equal("form" in catalogue.body.drafts[0], false);
  const published = await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 2,
    form: { ...edited, title: "Unreviewed extra body is never published" } });
  assert.equal(published.status, 200); assert.equal(published.body.form.title, edited.title);
  assert.equal(published.body.expectedVersion, h.form.version + 1);
  assert.equal(published.body.draft.status, "published"); assert.equal(published.body.draft.revision, 3);
  assert.equal(h.count("trade_activity_field_masters"), 1); assert.deepEqual((await h.get()).body.drafts, []);
  const stored = h.database.prepare("SELECT form_json,form_sha256 FROM trade_activity_field_masters").get();
  assert.equal(core.activityHash(JSON.parse(stored.form_json)), stored.form_sha256);
  assert.equal(h.count("compliance_audit_events"), 3);
});

test("New form starts from program requirements with a chosen name and preserves the current publication baseline", async (t) => {
  const h = fixture(t);
  const previous = { ...h.form, title: "Previous Creditex custom form", fields: [...h.form.fields,
    { key: "custom.previous", label: "Old custom question", section: "Previous extras", phase: "after", type: "text", required: false, options: [], help: "" }] };
  const published = await h.post({ action: "save_master", activityTemplateId: h.form.activityTemplateId,
    variantId: h.form.variantId, expectedVersion: 0, form: previous });
  assert.equal(published.status, 200);
  const retainedMaster = h.database.prepare("SELECT * FROM trade_activity_field_masters").get();
  const created = await h.create({ startFrom: "activity_template", title: "  Creditex installation checks  ", expectedVersion: published.body.expectedVersion,
    form: { fields: [] }, organisationId: "forged-org", programCode: "invented-program" });
  assert.equal(created.status, 200);
  const draft = created.body.draft;
  assert.equal(draft.title, "Creditex installation checks"); assert.equal(draft.baseIsCurrent, true);
  assert.equal(draft.baseMasterVersion, published.body.expectedVersion);
  assert.equal(draft.form.programCode, h.form.programCode);
  assert.equal(draft.form.fields.some(field => field.key === "custom.previous"), false);
  assert.deepEqual(draft.form.fields, library.applyDefaultActivityFormPolicy(h.form, h.form).fields);
  assert.deepEqual(draft.form.declarations, h.form.declarations);
  assert.deepEqual(h.database.prepare("SELECT * FROM trade_activity_field_masters").get(), retainedMaster);
  const stored = h.database.prepare("SELECT * FROM trade_activity_field_master_drafts WHERE id=?").get(draft.id);
  assert.equal(stored.organisation_id, "creditex");
  assert.equal(stored.base_form_sha256, core.activityHash(library.applyDefaultActivityFormPolicy(published.body.form, h.form)));
  assert.equal(stored.form_sha256, core.activityHash(draft.form)); assert.notEqual(stored.base_form_sha256, stored.form_sha256);
  const duplicate = await h.create({ expectedVersion: published.body.expectedVersion });
  assert.equal(duplicate.body.draft.title, previous.title);
  assert.equal(duplicate.body.draft.form.fields.some(field => field.key === "custom.previous"), true);
  const custom = { key: "custom.new", label: "Creditex site notes", section: "New extras", phase: "after", type: "text", required: false, options: [], help: "" };
  const saved = await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1,
    form: { ...draft.form, fields: [...draft.form.fields, custom] } });
  assert.equal(saved.status, 200);
  const result = await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 2 });
  assert.equal(result.status, 200); assert.equal(result.body.form.title, draft.title);
  assert.deepEqual(result.body.form.fields.find(field => field.key === custom.key), custom);
  assert.deepEqual(h.database.prepare("SELECT * FROM trade_activity_field_masters WHERE id=?").get(retainedMaster.id), retainedMaster);
});

test("New form requires a valid name, known activity and premises, and existing author access", async (t) => {
  const h = fixture(t);
  for (const title of [undefined, "", "   ", 42, "x".repeat(301)]) {
    const result = await h.create({ startFrom: "activity_template", title });
    assert.equal(result.status, 400); assert.equal(result.body.code, "INVALID_ACTIVITY_DRAFT_START");
  }
  assert.equal((await h.create({ startFrom: "blank", title: "Unchecked form" })).status, 400);
  assert.notEqual((await h.create({ startFrom: "activity_template", title: "Unknown activity", activityTemplateId: "invented-activity" })).status, 200);
  assert.equal((await h.create({ startFrom: "activity_template", title: "Unknown premises", variantId: "invented-premises" })).status, 400);
  h.setActor({ role: "auditor" });
  assert.equal((await h.create({ startFrom: "activity_template", title: "Viewer draft" })).status, 403);
  h.setActor({ role: "admin", displayName: "Creditex Office", email: "info@example.com" });
  assert.equal((await h.create({ startFrom: "activity_template", title: "Shared mailbox draft" })).status, 403);
  assert.equal(h.count("trade_activity_field_master_drafts"), 0); assert.equal(h.count("compliance_audit_events"), 0);
});

test("New forms are available across existing program activities and premises variants", async (t) => {
  const h = fixture(t); let created = 0;
  for (const activity of library.activityFieldCatalogue()) {
    const builtIn = library.defaultActivityFieldForm(activity.activityTemplateId);
    for (const variantId of builtIn.variantOptions.length ? builtIn.variantOptions.map(item => item.id) : [builtIn.variantId]) {
      const result = await h.create({ activityTemplateId: activity.activityTemplateId, variantId, startFrom: "activity_template", title: `${activity.programCode} ${activity.activityCode} new form` });
      assert.equal(result.status, 200, `${activity.activityTemplateId} ${variantId}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.draft.form.activityTemplateId, activity.activityTemplateId);
      assert.equal(result.body.draft.form.variantId, variantId); assert.equal(result.body.draft.baseIsCurrent, true); created++;
    }
  }
  assert.equal(h.count("trade_activity_field_master_drafts"), created); assert.equal(h.count("trade_activity_field_masters"), 0);
});

test("New form creation rejects stale publication state inside the atomic batch", async (t) => {
  const h = fixture(t);
  h.race(async () => assert.equal((await h.post({ action: "save_master", activityTemplateId: h.form.activityTemplateId,
    variantId: h.form.variantId, expectedVersion: 0, form: h.form })).status, 200));
  const result = await h.create({ startFrom: "activity_template", title: "Stale creation" });
  assert.equal(result.status, 409); assert.equal(result.body.code, "ACTIVITY_MASTER_CHANGED");
  assert.equal(h.count("trade_activity_field_master_drafts"), 0); assert.equal(h.count("compliance_audit_events"), 0);
});

test("draft save and discard require the exact revision and retain closed copies", async (t) => {
  const h = fixture(t); const { draft } = (await h.create()).body;
  const first = await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1, form: { ...draft.form, title: "Saved first" } });
  assert.equal(first.status, 200);
  for (const action of ["save_master_draft", "publish_master_draft", "discard_master_draft"]) {
    const stale = await h.post({ action, draftId: draft.id, expectedRevision: 1, form: { ...draft.form, title: "Stale copy" } });
    assert.equal(stale.status, 409); assert.equal(stale.body.code, "ACTIVITY_DRAFT_REVISION_CONFLICT");
  }
  const discarded = await h.post({ action: "discard_master_draft", draftId: draft.id, expectedRevision: 2 });
  assert.equal(discarded.body.draft.status, "discarded"); assert.deepEqual((await h.get()).body.drafts, []);
  const retained = await h.get(`view=master_drafts&actorMode=creditex&draftId=${draft.id}`);
  assert.equal(retained.body.draft.form.title, "Saved first");
  assert.equal((await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 3 })).status, 409);
  assert.equal(h.count("trade_activity_field_masters"), 0); assert.equal(h.count("compliance_audit_events"), 3);
});

test("competing copies cannot replace a newer published master, but their edits remain saved", async (t) => {
  const h = fixture(t); const first = (await h.create()).body.draft; const second = (await h.create()).body.draft;
  const published = await h.post({ action: "publish_master_draft", draftId: first.id, expectedRevision: 1 });
  assert.equal(published.status, 200);
  const conflict = await h.post({ action: "publish_master_draft", draftId: second.id, expectedRevision: 1 });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, "ACTIVITY_MASTER_CHANGED");
  const saved = await h.post({ action: "save_master_draft", draftId: second.id, expectedRevision: 1,
    form: { ...second.form, title: "Work retained after publication changed" } });
  assert.equal(saved.status, 200); assert.equal(saved.body.draft.baseIsCurrent, false);
  assert.equal(saved.body.draft.baseMasterVersion, 0);
  assert.equal(h.count("trade_activity_field_masters"), 1);
  assert.equal((await h.create()).body.code, "ACTIVITY_MASTER_CHANGED");
  assert.equal((await h.create({ expectedVersion: published.body.expectedVersion })).body.draft.baseIsCurrent, true);
});

test("draft publication rechecks concurrent master publication inside its atomic batch", async (t) => {
  const h = fixture(t); const first = (await h.create()).body.draft; const second = (await h.create()).body.draft;
  h.race(async () => assert.equal((await h.post({ action: "publish_master_draft", draftId: second.id, expectedRevision: 1 })).status, 200));
  const lost = await h.post({ action: "publish_master_draft", draftId: first.id, expectedRevision: 1 });
  assert.equal(lost.status, 409); assert.equal(lost.body.code, "ACTIVITY_MASTER_CHANGED");
  assert.equal(h.count("trade_activity_field_masters"), 1);
  assert.equal(h.database.prepare("SELECT status FROM trade_activity_field_master_drafts WHERE id=?").get(first.id).status, "draft");
  assert.equal(h.count("compliance_audit_events"), 3);
});

test("concurrent save wins over stale publish without publishing or writing a false audit", async (t) => {
  const h = fixture(t); const draft = (await h.create()).body.draft;
  h.race(async () => assert.equal((await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1,
    form: { ...draft.form, title: "Latest edit" } })).status, 200));
  const lost = await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 1 });
  assert.equal(lost.status, 409); assert.equal(lost.body.code, "ACTIVITY_DRAFT_REVISION_CONFLICT");
  assert.equal(h.count("trade_activity_field_masters"), 0); assert.equal(h.count("compliance_audit_events"), 2);
});

test("concurrent saves preserve the winning draft and a changed master cannot be cloned under an old version", async (t) => {
  const h = fixture(t); const draft = (await h.create()).body.draft;
  h.race(async () => assert.equal((await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1,
    form: { ...draft.form, title: "Winning edit" } })).status, 200));
  const stale = await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1,
    form: { ...draft.form, title: "Losing edit" } });
  assert.equal(stale.status, 409); assert.equal(h.count("compliance_audit_events"), 2);
  assert.equal((await h.get(`view=master_drafts&actorMode=creditex&draftId=${draft.id}`)).body.draft.form.title, "Winning edit");
  h.race(async () => assert.equal((await h.post({ action: "save_master", activityTemplateId: h.form.activityTemplateId,
    variantId: h.form.variantId, expectedVersion: 0, form: h.form })).status, 200));
  const staleCopy = await h.create();
  assert.equal(staleCopy.status, 409); assert.equal(staleCopy.body.code, "ACTIVITY_MASTER_CHANGED");
  assert.equal(h.count("trade_activity_field_master_drafts"), 1); assert.equal(h.count("compliance_audit_events"), 2);
});

test("publication and draft state roll back together when the audit cannot be retained", async (t) => {
  const h = fixture(t); const draft = (await h.create()).body.draft;
  h.database.exec(`CREATE TRIGGER fail_publication_audit BEFORE INSERT ON compliance_audit_events
    WHEN NEW.event_type = 'activity_master_draft.published' BEGIN SELECT RAISE(ABORT,'forced audit failure'); END;`);
  const result = await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 1 });
  assert.equal(result.status, 500); assert.equal(h.count("trade_activity_field_masters"), 0);
  assert.equal(h.database.prepare("SELECT status FROM trade_activity_field_master_drafts").get().status, "draft");
  assert.equal(h.count("compliance_audit_events"), 1);
});

test("drafts reuse publication validation and cannot weaken mandatory source questions", async (t) => {
  const h = fixture(t); const draft = (await h.create()).body.draft;
  const invalid = structuredClone(draft.form); invalid.fields[0].type = "invalid";
  assert.equal((await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1, form: invalid })).status, 400);
  const protectedField = draft.form.fields.find((field) => field.sourceRequirementId && field.required);
  assert.ok(protectedField);
  const edited = structuredClone(draft.form); const target = edited.fields.find((field) => field.key === protectedField.key);
  target.required = false; target.label = "Weakened source question";
  const saved = await h.post({ action: "save_master_draft", draftId: draft.id, expectedRevision: 1, form: edited });
  assert.equal(saved.status, 200);
  const restored = saved.body.draft.form.fields.find((field) => field.key === protectedField.key);
  assert.equal(restored.required, true); assert.equal(restored.label, protectedField.label);
});

test("base hash blocks publication when default policy changed without a stored master version change", async (t) => {
  const h = fixture(t); const draft = (await h.create()).body.draft;
  h.policy((...args) => ({ ...library.applyDefaultActivityFormPolicy(...args), title: "Updated policy title" }));
  const result = await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 1 });
  assert.equal(result.status, 409); assert.equal(result.body.code, "ACTIVITY_MASTER_CHANGED");
  assert.equal(h.count("trade_activity_field_masters"), 0);
});

test("draft access stays within the signed-in organisation and existing author roles", async (t) => {
  const h = fixture(t); const draft = (await h.create({ organisationId: "forged-org" })).body.draft;
  assert.equal(h.database.prepare("SELECT organisation_id FROM trade_activity_field_master_drafts").get().organisation_id, "creditex");
  h.setActor({ organisationId: "other-org" });
  assert.deepEqual((await h.get()).body.drafts, []);
  assert.equal((await h.get(`view=master_drafts&actorMode=creditex&draftId=${draft.id}`)).status, 404);
  assert.equal((await h.post({ action: "discard_master_draft", draftId: draft.id, expectedRevision: 1 })).status, 404);
  h.setActor({ organisationId: "creditex", role: "auditor" });
  assert.equal((await h.get()).body.drafts.length, 1);
  for (const action of ["create_master_draft", "save_master_draft", "publish_master_draft", "discard_master_draft"]) {
    assert.equal((await h.post({ action, draftId: draft.id, expectedRevision: 1, form: draft.form })).status, 403);
  }
  h.setActor({ role: "reviewer", organisationCode: "NOT-CREDITEX" });
  assert.equal((await h.get()).status, 403);
  assert.equal((await h.create()).status, 403);
  h.setActor({ organisationCode: "CREDITEX-AU" });
  assert.equal((await h.create({ actorMode: "installer" })).status, 403);
  assert.equal((await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 1 }, { origin: "https://foreign.invalid" })).status, 403);
  assert.equal(h.count("compliance_audit_events"), 1);
});

test("platform admin draft actions use the platform audit actor and retain immutable published history", async (t) => {
  const h = fixture(t); const draft = (await h.create({ actorMode: "admin" })).body.draft;
  const original = await h.post({ action: "save_master", activityTemplateId: h.form.activityTemplateId,
    variantId: h.form.variantId, expectedVersion: 0, form: h.form });
  assert.equal(original.status, 200);
  const publishedBefore = h.database.prepare("SELECT * FROM trade_activity_field_masters").get();
  const fresh = (await h.create({ actorMode: "admin", expectedVersion: original.body.expectedVersion })).body.draft;
  const published = await h.post({ actorMode: "admin", action: "publish_master_draft", draftId: fresh.id, expectedRevision: 1 });
  assert.equal(published.status, 200); assert.equal(h.count("trade_activity_field_masters"), 2);
  assert.deepEqual(h.database.prepare("SELECT * FROM trade_activity_field_masters WHERE id=?").get(publishedBefore.id), publishedBefore);
  assert.equal(h.database.prepare("SELECT actor_type FROM compliance_audit_events WHERE target_id=?").get(draft.id).actor_type, "platform");
  assert.throws(() => h.database.exec("DELETE FROM trade_activity_field_masters"), /history must be retained/);
});

test("publishing a copy preserves signed and submitted field records and their version history exactly", async (t) => {
  const h = fixture(t);
  h.database.exec(`CREATE TABLE trade_work_order_compliance_intents
    (id TEXT, work_order_id TEXT, installer_uid TEXT, compliance_organisation_id TEXT, activity_template_id TEXT, status TEXT);`);
  for (const [id, status] of [["signed", "draft"], ["completed", "submitted_for_creditex_review"]]) {
    h.database.prepare("INSERT INTO trade_work_order_compliance_intents VALUES (?,?,?,?,?,'planned')")
      .run(id, `job-${id}`, "installer", "creditex", h.form.activityTemplateId);
    const payload = { id, intentId: id, workOrderId: `job-${id}`, ownerUid: "installer", organisationId: "creditex",
      revision: 1, status, form: h.form, signatures: [{ id: "retained-signature", declarationSha256: "original", signedAt: "2026-09-24" }] };
    h.database.prepare(`INSERT INTO trade_activity_field_records
      (id,intent_id,work_order_id,owner_uid,organisation_id,activity_template_id,revision,status,payload,
      pdf_object_key,pdf_sha256,actor_uid,created_at,updated_at,submitted_at)
      VALUES (?,?,?,?,?,?,1,?,?,?,?,?,'2026-09-24','2026-09-24',?)`)
      .run(id, id, `job-${id}`, "installer", "creditex", h.form.activityTemplateId, status, JSON.stringify(payload),
        status === "draft" ? "" : "retained.pdf", status === "draft" ? "" : "a".repeat(64), "installer", status === "draft" ? "" : "2026-09-24");
  }
  const records = h.database.prepare("SELECT * FROM trade_activity_field_records ORDER BY id").all();
  const versions = h.database.prepare("SELECT * FROM trade_activity_field_record_versions ORDER BY record_id").all();
  const draft = (await h.create()).body.draft;
  assert.equal((await h.post({ action: "publish_master_draft", draftId: draft.id, expectedRevision: 1 })).status, 200);
  assert.deepEqual(h.database.prepare("SELECT * FROM trade_activity_field_records ORDER BY id").all(), records);
  assert.deepEqual(h.database.prepare("SELECT * FROM trade_activity_field_record_versions ORDER BY record_id").all(), versions);
});
