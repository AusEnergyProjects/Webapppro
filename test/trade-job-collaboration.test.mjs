import { CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS } from "../src/lib/creditex-work-pack-schema-guards.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { isJobMember, jobMemberSql } from "../src/lib/trade-job-collaboration.ts";

test("job collaboration follows live or completed visits within the same business", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,assignee_member_id TEXT,record_status TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,assignee_member_id TEXT,status TEXT);
    INSERT INTO trade_work_orders VALUES ('job','owner','lead','active');
    INSERT INTO trade_crm_appointments VALUES ('job','owner','plumber','scheduled'),('job','owner','electrician','in_progress'),
      ('job','owner','finished','completed'),('job','owner','cancelled','cancelled'),('job','owner','absent','no_show'),
      ('job','foreign-owner','foreign','scheduled'),('other-job','owner','other','scheduled');`);
  const db = { prepare: sql => ({ bind: (...values) => ({ first: async () => sqlite.prepare(sql).get(...values) }) }) };
  try {
    for (const member of ["lead", "plumber", "electrician", "finished"]) assert.equal(await isJobMember(db, "owner", "job", member), true, member);
    for (const member of ["cancelled", "absent", "foreign", "other", ""]) assert.equal(await isJobMember(db, "owner", "job", member), false, member);
    sqlite.exec("UPDATE trade_crm_appointments SET status='cancelled' WHERE assignee_member_id='plumber'");
    assert.equal(await isJobMember(db, "owner", "job", "plumber"), false);
    sqlite.exec("UPDATE trade_work_orders SET record_status='archived'");
    assert.equal(await isJobMember(db, "owner", "job", "lead"), false);
  } finally { sqlite.close(); }
});

test("membership SQL only permits static identifiers and one default binding", () => {
  assert.equal((jobMemberSql("work").match(/\?/g) || []).length, 1);
  assert.throws(() => jobMemberSql("work; DELETE FROM trade_work_orders"));
  assert.throws(() => jobMemberSql("work", "unsafe expression"));
});


test('governed evidence uploads admit collaborators without granting lead signature authority',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,assignee_member_id TEXT,record_status TEXT);
      CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,assignee_member_id TEXT,status TEXT);
      CREATE TABLE trade_team_members(id TEXT,owner_uid TEXT,member_uid TEXT,status TEXT,job_scope TEXT);
      CREATE TABLE compliance_activity_work_pack_instances(id TEXT,organisation_id TEXT,work_order_id TEXT,work_pack_version_id TEXT,instance_key TEXT,status TEXT,compliance_case_id TEXT,revision INTEGER);
      CREATE TABLE compliance_activity_work_pack_versions(id TEXT,organisation_id TEXT,schema_snapshot TEXT);
      CREATE TABLE compliance_activity_work_pack_browser_upload_receipts(case_instance_id TEXT,organisation_id TEXT,work_order_id TEXT,owner_uid TEXT,member_id TEXT,actor_uid TEXT,instance_key TEXT,prompt_key TEXT,purpose TEXT,artifact_kind TEXT,content_type TEXT,metadata_snapshot TEXT);
      INSERT INTO trade_work_orders VALUES('job','owner','lead','active');
      INSERT INTO trade_crm_appointments VALUES('job','owner','collaborator','in_progress');
      INSERT INTO trade_team_members VALUES('lead','owner','lead-user','active','own'),('collaborator','owner','worker-user','active','own');
      INSERT INTO compliance_activity_work_pack_instances VALUES('instance','org','job','version','instance-key','in_progress','case',1);`);
    db.prepare('INSERT INTO compliance_activity_work_pack_versions VALUES(?,?,?)').run('version','org',JSON.stringify({sections:[{repeatability:null,prompts:[{promptKey:'photo',type:'photo',fileRequirement:{allowedContentTypes:['image/jpeg'],metadataRequired:false,gpsRequired:false,captureTimeRequired:false}},{promptKey:'signed',type:'signature'}]}]}));
    db.exec(CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.find(d=>d.name==='compliance_work_pack_browser_upload_insert_guard').sql);
    const insert=db.prepare("INSERT INTO compliance_activity_work_pack_browser_upload_receipts VALUES('instance','org','job','owner',?,?,'instance-key',?,?,?,?, '{}')");
    assert.doesNotThrow(()=>insert.run('collaborator','worker-user','photo','artifact','photo','image/jpeg'));
    assert.throws(()=>insert.run('collaborator','worker-user','signed','signature','','image/jpeg'),/COMPLIANCE_WORK_PACK_BROWSER_UPLOAD_INVALID/);
    assert.doesNotThrow(()=>insert.run('lead','lead-user','signed','signature','','image/jpeg'));
    db.exec("UPDATE trade_crm_appointments SET status='cancelled'");
    assert.throws(()=>insert.run('collaborator','worker-user','photo','artifact','photo','image/jpeg'),/COMPLIANCE_WORK_PACK_BROWSER_UPLOAD_INVALID/);
    db.exec("UPDATE trade_crm_appointments SET status='completed'");
    assert.doesNotThrow(()=>insert.run('collaborator','worker-user','photo','artifact','photo','image/jpeg'));
  } finally {db.close();}
});
