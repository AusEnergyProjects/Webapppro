import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { installFieldCorrectionFixture } from "./helpers/activity-field-corrections-fixture.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,record_status TEXT,stage TEXT);
    INSERT INTO trade_work_orders VALUES('job','owner','active','completed');
    CREATE TABLE trade_work_order_compliance_intents(id TEXT,work_order_id TEXT,installer_uid TEXT,compliance_organisation_id TEXT,activity_template_id TEXT,status TEXT);
    INSERT INTO trade_work_order_compliance_intents VALUES('intent','job','owner','org','activity','case_linked');`);
  db.exec(fs.readFileSync(new URL("../drizzle/0170_trade_activity_forms.sql",import.meta.url),"utf8"));
  const payload = {id:"original",intentId:"intent",workOrderId:"job",ownerUid:"owner",organisationId:"org",revision:2,status:"submitted_for_creditex_review",
    form:{activityTemplateId:"activity"},answers:{model:"old"},evidence:[{objectKey:"retained/photo"}],signatures:[{strokes:[1,2]}]};
  db.prepare(`INSERT INTO trade_activity_field_records VALUES('original','intent','job','owner','org','activity',2,'submitted_for_creditex_review',?,'retained/pdf',?,'worker','before','before','before')`).run(JSON.stringify(payload),"a".repeat(64));
  db.prepare("INSERT INTO trade_activity_field_report_links VALUES('share','original',?,'2099','','worker','before')").run("b".repeat(64));
  db.exec(`CREATE TABLE original_reference_probe(id TEXT);
    CREATE TRIGGER original_reference_probe_guard BEFORE INSERT ON original_reference_probe
    WHEN NOT EXISTS(SELECT 1 FROM trade_activity_field_records WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Missing original'); END;`);
  return {db,payload};
}

test("0194 preserves populated signed rows, versions, share-link foreign keys and referencing triggers",()=>{
  const {db}=fixture();
  try {
    const original=db.prepare("SELECT * FROM trade_activity_field_records").get();
    const versions=db.prepare("SELECT * FROM trade_activity_field_record_versions").all();
    const links=db.prepare("SELECT * FROM trade_activity_field_report_links").all();
    installFieldCorrectionFixture(db);
    const {supersedes_record_id,correction_event_id,...retained}=db.prepare("SELECT * FROM trade_activity_field_records").get();
    assert.equal(supersedes_record_id,null);assert.equal(correction_event_id,null);
    assert.deepEqual({...retained},{...original});
    assert.deepEqual(db.prepare("SELECT * FROM trade_activity_field_record_versions").all(),versions);
    assert.deepEqual(db.prepare("SELECT * FROM trade_activity_field_report_links").all(),links);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    assert.equal(db.prepare("PRAGMA foreign_key_list(trade_activity_field_report_links)").get().table,"trade_activity_field_records");
    db.exec("INSERT INTO original_reference_probe VALUES('original')");
    assert.throws(()=>db.exec("DELETE FROM trade_activity_field_records WHERE id='original'"),/history must be retained/);
    assert.throws(()=>db.exec("UPDATE trade_activity_field_records SET actor_uid='tamper' WHERE id='original'"),/immutable/);
  } finally {db.close();}
});

test("correction insertion requires exact current event, tenant, retained source and fresh unsigned draft",()=>{
  const {db,payload}=fixture();
  try {
    installFieldCorrectionFixture(db);
    const source=JSON.stringify({records:[{kind:"field",id:"original",revision:2,sha256:"a".repeat(64),objectKey:"retained/pdf"}]});
    db.prepare("INSERT INTO creditex_job_lifecycle_events VALUES('event','org','owner','job','intent','correction_required',?,'Fix model','2026-09-25')").run(source);
    const correction={...payload,id:"correction",revision:1,status:"draft",signatures:[],correction:{eventId:"event",sourceRecordId:"original",sourceRevision:2}};
    const insert=(value)=>db.prepare(`INSERT INTO trade_activity_field_records
      (id,intent_id,work_order_id,owner_uid,organisation_id,activity_template_id,revision,status,payload,actor_uid,created_at,updated_at,supersedes_record_id,correction_event_id)
      VALUES(?,'intent','job','owner','org','activity',1,'draft',?,'reviewer','now','now','original','event')`).run(value.id,JSON.stringify(value));
    assert.throws(()=>insert({...correction,signatures:payload.signatures}),/MUST_START_UNSIGNED/);
    assert.throws(()=>insert({...correction,signatures:null}),/MUST_START_UNSIGNED/);
    assert.throws(()=>insert({...correction,correction:{...correction.correction,sourceRevision:1}}),/SOURCE_CHANGED/);
    db.exec("UPDATE trade_work_orders SET stage='cancelled'");
    assert.throws(()=>insert(correction),/SOURCE_CHANGED/);
    db.exec("UPDATE trade_work_orders SET stage='completed'");
    db.exec("UPDATE creditex_job_lifecycle_events SET organisation_id='other'");
    assert.throws(()=>insert(correction),/SOURCE_CHANGED/);
    db.exec("UPDATE creditex_job_lifecycle_events SET organisation_id='org'");
    insert(correction);
    assert.throws(()=>insert({...correction,id:"duplicate"}),/UNIQUE constraint/);
    assert.equal(db.prepare("SELECT count(*) n FROM trade_activity_field_records").get().n,2);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally {db.close();}
});
