import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { creditexJobSubmissionSummary, deriveCreditexJobLifecycle } from "../src/lib/creditex-job-lifecycle.ts";
import { creditexIntentCompletionSnapshotSql, creditexIntentSubmissionSnapshotSql, creditexIntentOpenCorrectionSql } from "../src/lib/creditex-job-lifecycle-sql.ts";

import * as sql from "../src/lib/creditex-job-lifecycle-projection.ts";

const base = { workStage: "completed", scheduledStart: "2026-09-24T00:00:00Z", fieldComplete: true,
  fieldProgress: false, creditexAuditApproved: false, correctionRequired: false, packets: [] };

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE intent(id TEXT, work_order_id TEXT, installer_uid TEXT, compliance_organisation_id TEXT, activity_template_id TEXT, program_code TEXT, intent_snapshot TEXT);
    CREATE TABLE linked_case(id TEXT, organisation_id TEXT, revision INTEGER);
    CREATE TABLE compliance_output_action_packets(id TEXT, organisation_id TEXT, compliance_case_id TEXT, program_code TEXT, output_code TEXT, work_pack_instance_key TEXT, work_pack_revision INTEGER, case_revision INTEGER, prepared_at TEXT, packet_sha256 TEXT, prepared_by_uid TEXT);
    CREATE TABLE compliance_output_action_events(organisation_id TEXT, packet_id TEXT, sequence INTEGER, to_status TEXT);
    CREATE TABLE compliance_output_action_reviews(organisation_id TEXT, packet_id TEXT, decision TEXT, packet_sha256 TEXT, reviewed_by_uid TEXT);
    CREATE TABLE compliance_output_dispatch_intents(organisation_id TEXT, packet_id TEXT, status TEXT);
    CREATE TABLE creditex_registry_batches(id TEXT, organisation_id TEXT);
    CREATE TABLE creditex_registry_batch_items(organisation_id TEXT, batch_id TEXT, packet_id TEXT, packet_sha256 TEXT);
    CREATE TABLE creditex_registry_results(id TEXT, organisation_id TEXT, packet_id TEXT, registry_status TEXT, source TEXT, occurred_at TEXT, created_at TEXT);
    CREATE TABLE creditex_registry_result_reviews(organisation_id TEXT, result_id TEXT, decision TEXT);
    CREATE TABLE trade_activity_field_records(intent_id TEXT, owner_uid TEXT, work_order_id TEXT, organisation_id TEXT, activity_template_id TEXT, status TEXT, pdf_object_key TEXT, pdf_sha256 TEXT, payload TEXT);
    CREATE TABLE compliance_activity_work_pack_instances(id TEXT, organisation_id TEXT, compliance_case_id TEXT, work_order_id TEXT, compliance_intent_id TEXT, instance_key TEXT, revision INTEGER, status TEXT, work_pack_version_id TEXT);
    CREATE TABLE compliance_activity_work_pack_final_records(organisation_id TEXT,case_instance_id TEXT,instance_key TEXT,work_pack_version_id TEXT);
    CREATE TABLE compliance_case_decisions(id TEXT,organisation_id TEXT,case_id TEXT,case_revision INTEGER,decision_type TEXT,outcome TEXT,primary_reviewer_uid TEXT,secondary_reviewer_uid TEXT,decided_at TEXT);
    INSERT INTO intent VALUES('intent-1','job-1','installer-1','org-1','activity-1','VEU','{"program":{"claimOutputCode":"VEEC"}}');
    INSERT INTO linked_case VALUES('case-1','org-1',1);`);
  db.exec(`ALTER TABLE intent ADD COLUMN revision INTEGER DEFAULT 1;
    ALTER TABLE intent ADD COLUMN compliance_case_id TEXT DEFAULT 'case-1';
    ALTER TABLE intent ADD COLUMN status TEXT DEFAULT 'case_linked';
    ALTER TABLE intent ADD COLUMN intent_snapshot_sha256 TEXT DEFAULT 'intent-hash';
    ALTER TABLE linked_case ADD COLUMN status TEXT DEFAULT 'draft';
    ALTER TABLE linked_case ADD COLUMN evidence_status TEXT DEFAULT 'pending';
    ALTER TABLE linked_case ADD COLUMN updated_at TEXT DEFAULT '2026-09-24';
    ALTER TABLE trade_activity_field_records ADD COLUMN id TEXT DEFAULT 'field-1';
    ALTER TABLE trade_activity_field_records ADD COLUMN revision INTEGER DEFAULT 1;
    ALTER TABLE trade_activity_field_records ADD COLUMN supersedes_record_id TEXT;
    ALTER TABLE compliance_activity_work_pack_final_records ADD COLUMN id TEXT;
    ALTER TABLE compliance_activity_work_pack_final_records ADD COLUMN pdf_sha256 TEXT;
    ALTER TABLE compliance_activity_work_pack_final_records ADD COLUMN object_key TEXT;
    ALTER TABLE compliance_output_action_packets ADD COLUMN activity_template_id TEXT DEFAULT 'activity-1';
    ALTER TABLE compliance_output_action_packets ADD COLUMN action_kind TEXT DEFAULT 'certificate_submission';
    CREATE VIEW compliance_cases AS SELECT linked_case.*,intent.id compliance_intent_id,intent.work_order_id,intent.installer_uid FROM linked_case CROSS JOIN intent;
    CREATE TABLE creditex_job_lifecycle_events(id TEXT,organisation_id TEXT,work_order_id TEXT,owner_uid TEXT,intent_id TEXT,actor_kind TEXT,action TEXT,
      source_snapshot TEXT,recipient_uid TEXT,amount_minor INTEGER,reference TEXT,occurred_at TEXT,created_at TEXT);
    CREATE VIEW trade_work_order_compliance_intents AS SELECT * FROM intent;
    CREATE TABLE work(id TEXT,firebase_uid TEXT,stage TEXT,record_status TEXT,scheduled_start TEXT);
    INSERT INTO work VALUES('job-1','installer-1','completed','active','2026-09-24');`);
  const packet = (id = "packet-1", patch = {}) => {
    const row = { id, organisation_id: "org-1", compliance_case_id: "case-1", program_code: "VEU", output_code: "VEEC", work_pack_instance_key: id,
      work_pack_revision: 1, case_revision: 1, prepared_at: "2026-09-24T00:00:00Z", packet_sha256: `hash-${id}`, prepared_by_uid: "author", ...patch };
    db.prepare(`INSERT INTO compliance_output_action_packets(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    return row;
  };
  const approve = (id = "packet-1") => db.prepare("INSERT INTO compliance_output_action_reviews VALUES('org-1',?,'approved',?,'reviewer')").run(id, `hash-${id}`);
  const event = (status, id = "packet-1", organisation = "org-1") => db.prepare("INSERT INTO compliance_output_action_events VALUES(?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM compliance_output_action_events WHERE packet_id=? AND organisation_id=?),?)").run(organisation,id,id,organisation,status);
  const exportPacket = (id = "packet-1", organisation = "org-1", hash = `hash-${id}`) => {
    db.prepare("INSERT INTO creditex_registry_batches VALUES(?,?)").run(`batch-${id}`, organisation);
    db.prepare("INSERT INTO creditex_registry_batch_items VALUES(?,?,?,?)").run(organisation, `batch-${id}`, id, hash);
  };
  const projected = () => db.prepare(`SELECT ${sql.SUBMISSION_PACKETS_SQL} packets, ${sql.FIELD_PROGRESS_SQL} field,
    ${sql.WORK_PACK_PROGRESS_SQL} packs, ${sql.CREDITEX_AUDIT_SQL} audited,
    ${sql.TRADE_REVIEW_SQL} reviewed, ${sql.CREDITEX_PAYOUT_SQL} paid,
    ${creditexIntentOpenCorrectionSql("intent")} correction FROM intent CROSS JOIN linked_case`).get();
  const packets = () => JSON.parse(projected().packets);
  const lifecycle = () => deriveCreditexJobLifecycle({ ...base, packets: packets(), creditexAuditApproved: Boolean(projected().audited) });
  return { db, packet, approve, event, exportPacket, projected, packets, lifecycle };
}

test("batch export leaves an approved job Audited; only real lodgement makes it Submitted", t => {
  const f = fixture(t); f.packet(); f.approve();
  assert.equal(f.lifecycle().label, "Audited");
  f.exportPacket();
  assert.deepEqual(f.lifecycle(), { status: "audited", label: "Audited", detail: "Exported, awaiting lodgement" });
  assert.equal(creditexJobSubmissionSummary(f.packets()).submittedCount, 0);
  f.event("submitted");
  assert.equal(f.lifecycle().label, "Submitted");
  f.event("provider_accepted");
  assert.equal(f.lifecycle().label, "Submitted", "Government acceptance is not a Creditex payout.");
});

test("one lodged packet cannot claim the remaining activity packets are submitted", t => {
  const f = fixture(t); f.packet(); f.approve(); f.packet("packet-2"); f.approve("packet-2"); f.event("submitted");
  assert.equal(f.lifecycle().status, "audited");
  assert.equal(f.lifecycle().detail, "1 of 2 claims lodged");
  f.event("submitted", "packet-2"); assert.equal(f.lifecycle().status, "submitted");
});

test("local rejection requests corrections; retained government rejection after lodgement means Failed", t => {
  const f = fixture(t); f.packet(); f.event("rejected");
  assert.equal(f.lifecycle().label, "Correction required");
  f.event("submitted"); f.event("rejected");
  assert.equal(f.lifecycle().label, "Failed");
});

test("uncertain dispatch never implies submission and remains visible beside the lifecycle", t => {
  const f = fixture(t); f.packet(); f.approve();
  f.db.exec("INSERT INTO compliance_output_dispatch_intents VALUES('org-1','packet-1','uncertain')");
  assert.deepEqual(f.lifecycle(), { status: "audited", label: "Audited", detail: "Check submission outcome" });
});

test("packet, event, review and batch projection remains organisation and case scoped", t => {
  const f = fixture(t); f.packet();
  f.packet("other-org", { organisation_id: "org-2" }); f.packet("other-case", { compliance_case_id: "case-2" });
  f.packet("other-program", { program_code: "SRES" }); f.packet("other-output", { output_code: "STC" });
  f.event("submitted", "packet-1", "org-2"); f.exportPacket("packet-1", "org-2");
  f.db.exec("INSERT INTO compliance_output_action_reviews VALUES('org-2','packet-1','approved','hash-packet-1','reviewer')");
  assert.equal(f.packets().length, 1);
  assert.equal(f.lifecycle().label, "Complete");
  assert.equal(creditexJobSubmissionSummary(f.packets()).exportedCount, 0);
});

test("a different batch packet hash does not count as an export", t => {
  const f = fixture(t); f.packet(); f.approve(); f.exportPacket("packet-1", "org-1", "different");
  assert.equal(f.lifecycle().detail, "");
});

test("latest packet revision supersedes old submitted history and stale approvals cannot imply Audited", t => {
  const f = fixture(t); f.packet("old", { work_pack_instance_key: "same" }); f.event("submitted", "old");
  f.packet("new", { work_pack_instance_key: "same", work_pack_revision: 2 });
  assert.equal(f.packets().length, 1); assert.equal(f.lifecycle().label, "Complete");
  f.approve("new"); assert.equal(f.lifecycle().label, "Audited");
  f.db.exec("UPDATE linked_case SET revision=2"); assert.equal(f.lifecycle().label, "Complete");
});

test("only the latest reviewed government result affects Failed", t => {
  const f = fixture(t); f.packet(); f.event("submitted");
  f.db.exec("INSERT INTO creditex_registry_results VALUES('result','org-1','packet-1','rejected','reviewed_document','2026-09-25','2026-09-25')");
  assert.equal(f.lifecycle().label, "Submitted");
  f.db.exec("INSERT INTO creditex_registry_result_reviews VALUES('org-1','result','approved')");
  assert.equal(f.lifecycle().label, "Failed");
  f.db.exec("INSERT INTO creditex_registry_results VALUES('result-new','org-1','packet-1','registered','rec_public_register','2026-09-26','2026-09-26')");
  assert.equal(f.lifecycle().label, "Submitted");
});

test("Creditex audit requires latest exact-revision dual approval, not an older superseded approval", t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO compliance_case_decisions VALUES('approved','org-1','case-1',1,'ready_to_submit','approved','one','two','2026-09-24')");
  assert.equal(f.lifecycle().label, "Audited");
  f.db.exec("INSERT INTO compliance_case_decisions VALUES('changed','org-1','case-1',1,'ready_to_submit','changes_required','one','','2026-09-25')");
  assert.equal(f.projected().audited, 0);
  f.db.exec("UPDATE compliance_case_decisions SET outcome='approved',secondary_reviewer_uid='one' WHERE id='changed'");
  assert.equal(f.projected().audited, 0);
  f.db.exec("UPDATE linked_case SET revision=2"); assert.equal(f.projected().audited, 0);
});

test("field completion and progress belong only to the exact installer, activity and organisation", t => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO trade_activity_field_records(intent_id,owner_uid,work_order_id,organisation_id,activity_template_id,status,pdf_object_key,pdf_sha256,payload) VALUES('intent-1','installer-1','job-1','org-1','activity-1','submitted_for_creditex_review','private.pdf',?,'{\"hasUserEdits\":true}')").run("a".repeat(64));
  assert.deepEqual(JSON.parse(f.projected().field), { complete: 1, progress: 1 });
  for (const [column, value] of [["owner_uid", "installer-1"], ["work_order_id", "job-1"], ["organisation_id", "org-1"], ["activity_template_id", "activity-1"]]) {
    f.db.prepare(`UPDATE trade_activity_field_records SET ${column}='other'`).run(); assert.equal(f.projected().field, null);
    f.db.prepare(`UPDATE trade_activity_field_records SET ${column}=?`).run(value);
  }
});

test("canonical early stages come from schedule and field work, never from invoice payments", () => {
  const initial = { ...base, workStage: "backlog", scheduledStart: "", fieldComplete: false };
  assert.equal(deriveCreditexJobLifecycle(initial).label, "Unscheduled");
  assert.equal(deriveCreditexJobLifecycle({ ...initial, scheduledStart: "2026-09-24" }).label, "Assigned");
  assert.equal(deriveCreditexJobLifecycle({ ...initial, fieldProgress: true }).label, "Partial");
  assert.equal(deriveCreditexJobLifecycle({ ...initial, fieldComplete: true }).label, "Complete");
  assert.equal(deriveCreditexJobLifecycle({ ...initial, creditexAuditApproved: true }).label, "Audited");
  assert.equal(deriveCreditexJobLifecycle({ ...initial, correctionRequired: true }).label, "Correction required");
});

test("Reviewed, corrections and Paid remain separate explicit business events", () => {
  assert.equal(deriveCreditexJobLifecycle({ ...base, tradeReviewed: true }).label, "Reviewed");
  assert.equal(deriveCreditexJobLifecycle({ ...base, tradeReviewed: true, correctionRequired: true }).label, "Correction required");
  assert.equal(deriveCreditexJobLifecycle({ ...base, creditexPayoutRecorded: true }).label, "Complete", "A payment cannot replace actual lodgement.");
  const packet = { status: "submitted", registryStatus: "registered", approved: 1, lodged: 1, exported: 1, dispatchPending: 0, currentCase: 1 };
  assert.equal(deriveCreditexJobLifecycle({ ...base, packets: [packet] }).label, "Submitted");
  assert.equal(deriveCreditexJobLifecycle({ ...base, packets: [packet], creditexPayoutRecorded: true }).label, "Paid");
  assert.equal(deriveCreditexJobLifecycle({ ...base, packets: [packet, { ...packet, lodged: 0 }], creditexPayoutRecorded: true }).label, "Audited", "A mixed job cannot claim every activity was lodged or paid.");
  assert.equal(deriveCreditexJobLifecycle({ ...base, packets: [{ ...packet, registryStatus: "rejected" }], creditexPayoutRecorded: true }).label, "Failed");
});

test("recoverable Deleted and pre-completion Cancelled remain distinct from field completion", () => {
  assert.equal(deriveCreditexJobLifecycle({ ...base, deleted: true, correctionRequired: true }).label, "Deleted");
  assert.equal(deriveCreditexJobLifecycle({ ...base, fieldComplete: false, workStage: "cancelled" }).label, "Cancelled");
  assert.equal(deriveCreditexJobLifecycle({ ...base, deleted: false }).label, "Complete");
});

test("trade review uses the latest event and exact current completion, with corrections reopened until resubmitted", t => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO trade_activity_field_records(intent_id,owner_uid,work_order_id,organisation_id,activity_template_id,status,pdf_object_key,pdf_sha256,payload) VALUES('intent-1','installer-1','job-1','org-1','activity-1','submitted_for_creditex_review','private.pdf',?,'{}')").run('a'.repeat(64));
  const snapshot = () => f.db.prepare(`SELECT ${creditexIntentCompletionSnapshotSql()} snapshot FROM intent`).get().snapshot;
  const add = (id, action, patch={}) => {
    const row={id,organisation_id:'org-1',work_order_id:'job-1',owner_uid:'installer-1',intent_id:'intent-1',actor_kind:'trade',action,
      source_snapshot:snapshot(),created_at:id,occurred_at:id,...patch};
    f.db.prepare(`INSERT INTO creditex_job_lifecycle_events(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  };
  add('1','reviewed');assert.equal(f.projected().reviewed,'reviewed');
  add('2','correction_required');assert.equal(f.projected().reviewed,'');assert.equal(f.projected().correction,1);
  f.db.exec("UPDATE trade_activity_field_records SET revision=2,status='draft',pdf_object_key='',pdf_sha256=''");
  assert.equal(f.projected().correction,1,'Starting corrections does not hide the request.');
  f.db.prepare("UPDATE trade_activity_field_records SET status='submitted_for_creditex_review',pdf_object_key='corrected.pdf',pdf_sha256=?").run('b'.repeat(64));
  assert.equal(f.projected().correction,0);assert.equal(f.projected().reviewed,'','Corrected completion needs a fresh trade review.');
  add('3','reviewed');assert.equal(f.projected().reviewed,'reviewed');
  f.db.exec("UPDATE intent SET revision=2");assert.equal(f.projected().reviewed,'','Planning changes invalidate approval of the old intent.');
  for(const [column,value] of [['organisation_id','org-1'],['work_order_id','job-1'],['owner_uid','installer-1'],['intent_id','intent-1']]) {
    f.db.prepare(`UPDATE creditex_job_lifecycle_events SET ${column}='other'`).run();assert.equal(f.projected().reviewed,null);
    f.db.prepare(`UPDATE creditex_job_lifecycle_events SET ${column}=?`).run(value);
  }
});

test("payout projection requires exact claim identity, recipient and Creditex actor, never fee payment", t => {
  const f=fixture(t);f.packet();f.event('submitted');
  const snapshot=f.db.prepare(`SELECT ${creditexIntentSubmissionSnapshotSql()} snapshot FROM intent`).get().snapshot;
  f.db.prepare("INSERT INTO creditex_job_lifecycle_events(id,organisation_id,work_order_id,owner_uid,intent_id,actor_kind,action,source_snapshot,recipient_uid,amount_minor,reference,created_at) VALUES('pay','org-1','job-1','installer-1','intent-1','compliance','payout_recorded',?,'installer-1',12300,'BANK-1','2026-09-25')").run(snapshot);
  assert.equal(f.projected().paid,1);
  for(const [column,value] of [['organisation_id','org-1'],['work_order_id','job-1'],['owner_uid','installer-1'],['intent_id','intent-1'],['recipient_uid','installer-1'],['actor_kind','compliance'],['source_snapshot',snapshot],['reference','BANK-1']]) {
    f.db.prepare(`UPDATE creditex_job_lifecycle_events SET ${column}=?`).run(column==='reference'?'':'other');assert.equal(f.projected().paid,0,column);
    f.db.prepare(`UPDATE creditex_job_lifecycle_events SET ${column}=?`).run(value);
  }
  f.db.exec("UPDATE creditex_job_lifecycle_events SET amount_minor=0");assert.equal(f.projected().paid,0);
  f.db.exec("UPDATE creditex_job_lifecycle_events SET amount_minor=12300");
  f.packet('replacement',{work_pack_instance_key:'packet-1',work_pack_revision:2});assert.equal(f.projected().paid,0,'A replacement claim cannot inherit an old payout.');
});

test("SQL canonical lifecycle matches Creditex display and conservatively aggregates trade activities", t => {
  const f=fixture(t);
  const intentStatus = () => f.db.prepare(`SELECT ${sql.creditexIntentLifecycleStatusSql('work', "work.scheduled_start")} status FROM intent CROSS JOIN linked_case CROSS JOIN work`).get().status;
  const wholeJob = () => f.db.prepare(`SELECT ${sql.creditexWholeJobLifecycleSql('work', "work.scheduled_start")} status FROM work`).get().status;
  assert.equal(intentStatus(),'complete');assert.equal(wholeJob(),'completed');
  f.packet();f.approve();assert.equal(intentStatus(),f.lifecycle().status);assert.equal(wholeJob(),'audited');
  f.exportPacket();assert.equal(wholeJob(),'audited');
  f.event('submitted');assert.equal(intentStatus(),f.lifecycle().status);assert.equal(wholeJob(),'submitted');
  f.db.exec("INSERT INTO intent SELECT 'intent-2',work_order_id,installer_uid,compliance_organisation_id,'activity-2',program_code,intent_snapshot,revision,'',status,intent_snapshot_sha256 FROM intent WHERE id='intent-1'");
  assert.equal(wholeJob(),'completed','One lodged activity cannot make a whole job Submitted.');
  f.db.exec("UPDATE intent SET status='superseded' WHERE id='intent-2'");assert.equal(wholeJob(),'submitted');
  f.db.exec("UPDATE work SET firebase_uid='another-owner'");assert.equal(wholeJob(),null,'A different owner cannot inherit any activity.');
});

test("a correction leaf preserves signed history and invalidates prior audit and lodgement for the current revision", t => {
  const f=fixture(t);f.packet();f.approve();f.event('submitted');
  f.db.prepare("INSERT INTO trade_activity_field_records(intent_id,owner_uid,work_order_id,organisation_id,activity_template_id,status,pdf_object_key,pdf_sha256,payload,id) VALUES('intent-1','installer-1','job-1','org-1','activity-1','submitted_for_creditex_review','signed.pdf',?,'{}','signed')").run('a'.repeat(64));
  const original=f.db.prepare(`SELECT ${creditexIntentCompletionSnapshotSql()} snapshot FROM intent`).get().snapshot;
  f.db.prepare("INSERT INTO creditex_job_lifecycle_events(id,organisation_id,work_order_id,owner_uid,intent_id,actor_kind,action,source_snapshot,created_at) VALUES('correct','org-1','job-1','installer-1','intent-1','trade','correction_required',?,'2026-09-25')").run(original);
  f.db.exec("UPDATE linked_case SET status='changes_requested',evidence_status='changes_required',updated_at='2026-09-25'");
  f.db.exec("INSERT INTO compliance_case_decisions VALUES('approved','org-1','case-1',1,'ready_to_submit','approved','one','two','2026-09-24')");
  f.db.exec("INSERT INTO trade_activity_field_records(intent_id,owner_uid,work_order_id,organisation_id,activity_template_id,status,pdf_object_key,pdf_sha256,payload,id,supersedes_record_id) VALUES('intent-1','installer-1','job-1','org-1','activity-1','draft','','','{}','correction','signed')");
  assert.equal(JSON.parse(f.projected().field).complete,0);assert.equal(f.projected().correction,1);
  assert.equal(f.packets().length,0);assert.equal(f.projected().audited,0);
  f.db.prepare("UPDATE trade_activity_field_records SET status='submitted_for_creditex_review',pdf_object_key='corrected.pdf',pdf_sha256=? WHERE id='correction'").run('b'.repeat(64));
  assert.equal(f.projected().correction,0);assert.equal(JSON.parse(f.projected().field).complete,1);
  assert.equal(f.db.prepare(`SELECT ${sql.creditexWholeJobLifecycleSql('work', "work.scheduled_start")} status FROM work`).get().status,'completed');
  assert.deepEqual({...f.db.prepare("SELECT status,pdf_object_key FROM trade_activity_field_records WHERE id='signed'").get()},{status:'submitted_for_creditex_review',pdf_object_key:'signed.pdf'});
  f.packet('new',{work_pack_instance_key:'packet-1',work_pack_revision:2,prepared_at:'2026-09-26'});f.approve('new');assert.equal(f.lifecycle().status,'audited');
  f.db.exec("UPDATE linked_case SET updated_at='2026-09-27'");
  assert.equal(f.db.prepare(`SELECT ${sql.creditexWholeJobLifecycleSql('work', "work.scheduled_start")} status FROM work`).get().status,'correction_required','A later independent Creditex correction remains active.');
});
