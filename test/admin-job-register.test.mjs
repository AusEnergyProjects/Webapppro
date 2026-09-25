import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { adminJobQuery, ADMIN_JOB_JOINS,ADMIN_JOB_STATUS_SQL } from "../src/lib/admin-job-register.ts";
import {creditexIntentCompletionSnapshotSql} from "../src/lib/creditex-job-lifecycle-sql.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,record_status TEXT,work_number TEXT,title TEXT,stage TEXT,service_category TEXT,site_area TEXT,scheduled_start TEXT,updated_at TEXT,created_at TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT PRIMARY KEY,firebase_uid TEXT,crm_customer_id TEXT);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,business_name TEXT,first_name TEXT,last_name TEXT);
    INSERT INTO trade_accounts VALUES ('trade','Example Electrical'),('other','Different owner');
    INSERT INTO trade_crm_customers VALUES ('customer','trade','','Customer','One'),('other-customer','other','','Private','Other');`);
  db.exec(`CREATE TABLE trade_work_order_compliance_intents(id TEXT,work_order_id TEXT,installer_uid TEXT,compliance_organisation_id TEXT,activity_template_id TEXT,program_code TEXT,intent_snapshot TEXT,revision INTEGER,compliance_case_id TEXT,status TEXT,intent_snapshot_sha256 TEXT);
    CREATE TABLE compliance_cases(id TEXT,organisation_id TEXT,revision INTEGER,status TEXT,evidence_status TEXT,updated_at TEXT,compliance_intent_id TEXT,work_order_id TEXT,installer_uid TEXT);
    CREATE TABLE compliance_output_action_packets(id TEXT,organisation_id TEXT,compliance_case_id TEXT,program_code TEXT,output_code TEXT,work_pack_instance_key TEXT,work_pack_revision INTEGER,case_revision INTEGER,prepared_at TEXT,packet_sha256 TEXT,prepared_by_uid TEXT,activity_template_id TEXT);
    CREATE TABLE compliance_output_action_events(organisation_id TEXT,packet_id TEXT,sequence INTEGER,to_status TEXT);
    CREATE TABLE compliance_output_action_reviews(organisation_id TEXT,packet_id TEXT,decision TEXT,packet_sha256 TEXT,reviewed_by_uid TEXT);
    CREATE TABLE compliance_output_dispatch_intents(organisation_id TEXT,packet_id TEXT,status TEXT);
    CREATE TABLE creditex_registry_batches(id TEXT,organisation_id TEXT);
    CREATE TABLE creditex_registry_batch_items(organisation_id TEXT,batch_id TEXT,packet_id TEXT,packet_sha256 TEXT);
    CREATE TABLE creditex_registry_results(id TEXT,organisation_id TEXT,packet_id TEXT,registry_status TEXT,source TEXT,occurred_at TEXT,created_at TEXT);
    CREATE TABLE creditex_registry_result_reviews(organisation_id TEXT,result_id TEXT,decision TEXT);
    CREATE TABLE trade_activity_field_records(id TEXT,intent_id TEXT,owner_uid TEXT,work_order_id TEXT,organisation_id TEXT,activity_template_id TEXT,status TEXT,pdf_object_key TEXT,pdf_sha256 TEXT,payload TEXT,revision INTEGER,supersedes_record_id TEXT);
    CREATE TABLE compliance_activity_work_pack_instances(id TEXT,organisation_id TEXT,compliance_case_id TEXT,work_order_id TEXT,compliance_intent_id TEXT,instance_key TEXT,revision INTEGER,status TEXT,work_pack_version_id TEXT);
    CREATE TABLE compliance_activity_work_pack_final_records(id TEXT,organisation_id TEXT,case_instance_id TEXT,instance_key TEXT,work_pack_version_id TEXT,pdf_sha256 TEXT,object_key TEXT);
    CREATE TABLE compliance_case_decisions(id TEXT,organisation_id TEXT,case_id TEXT,case_revision INTEGER,decision_type TEXT,outcome TEXT,primary_reviewer_uid TEXT,secondary_reviewer_uid TEXT,decided_at TEXT);
    CREATE TABLE creditex_job_lifecycle_events(id TEXT,organisation_id TEXT,work_order_id TEXT,owner_uid TEXT,intent_id TEXT,actor_kind TEXT,action TEXT,source_snapshot TEXT,recipient_uid TEXT,amount_minor INTEGER,reference TEXT,occurred_at TEXT,created_at TEXT);`);
  const add = db.prepare("INSERT INTO trade_work_orders VALUES (?,?, 'installer','active',?,?,?, 'electrical','VIC 3000',?,?,'2026-09-20T14:30:00Z')");
  for (let n = 0; n < 112; n++) {
    const id = `job-${String(n).padStart(3,"0")}`;
    add.run(id,"trade",`TLJ-${n}`,n===110?"100%_literal":"Switchboard",n===111?"completed":"scheduled","2026-09-22T09:00:00Z","2026-09-21T01:00:00Z");
    db.prepare("INSERT INTO trade_crm_job_details VALUES (?, 'trade','customer')").run(id);
  }
  const select = params => {
    const q = adminJobQuery(new URLSearchParams(params));
    const rows = db.prepare(`SELECT w.id,${ADMIN_JOB_STATUS_SQL} stage,COALESCE(c.first_name,'') customer_name ${ADMIN_JOB_JOINS} WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT ? OFFSET ?`).all(...q.values,q.pageSize,q.offset);
    const count = db.prepare(`SELECT COUNT(*) total ${ADMIN_JOB_JOINS} WHERE ${q.where}`).get(...q.values).total;
    return {rows,count,q};
  };
  return {db,select};
}

test("admin Bin filters archived jobs before pagination and unrecognised views remain active",()=>{
  const f=fixture();try{
    f.db.exec("UPDATE trade_work_orders SET record_status='archived' WHERE id='job-111'");
    assert.equal(f.select({}).count,111);const bin=f.select({view:'bin'});assert.equal(bin.count,1);assert.equal(bin.rows[0].id,'job-111');
    assert.equal(f.select({view:"bin' OR 1=1 --"}).count,111);
  }finally{f.db.close();}
});

test("admin rows and status filters share current certificate Reviewed and Audited milestones",()=>{
  const f=fixture();try{
    f.db.exec(`INSERT INTO trade_work_order_compliance_intents VALUES('intent','job-111','trade','org','activity','VEU','{"program":{"claimOutputCode":"VEEC"}}',1,'case','planned','hash');
      INSERT INTO compliance_cases VALUES('case','org',1,'in_review','complete','2026-09-25','intent','job-111','trade');
      INSERT INTO trade_activity_field_records VALUES('field','intent','trade','job-111','org','activity','submitted_for_creditex_review','report.pdf','${'a'.repeat(64)}','{}',1,NULL);`);
    const snapshot=f.db.prepare(`SELECT ${creditexIntentCompletionSnapshotSql()} snapshot FROM trade_work_order_compliance_intents intent`).get().snapshot;
    f.db.prepare(`INSERT INTO creditex_job_lifecycle_events VALUES('review','org','job-111','trade','intent','trade','reviewed',?,'',0,'','2026-09-25','2026-09-25')`).run(snapshot);
    assert.equal(f.select({stage:'reviewed'}).rows[0].stage,'reviewed');assert.equal(f.select({stage:'completed'}).count,0);
    assert.equal(f.select({q:'job-000'}).rows[0].stage,'scheduled','Noncertificate fallback remains unchanged');
    f.db.exec(`INSERT INTO compliance_case_decisions VALUES('audit','org','case',1,'ready_to_submit','approved','first','second','2026-09-26')`);
    assert.equal(f.select({stage:'reviewed'}).count,0);assert.equal(f.select({stage:'audited'}).rows[0].stage,'audited');
  }finally{f.db.close();}
});
test("job filters search the full register before pagination and combine status, trade and date",()=>{
  const f=fixture();
  try {
    const result=f.select({stage:"completed",installer:"Example Electrical",from:"2026-09-22",to:"2026-09-22"});
    assert.equal(result.count,1);assert.equal(result.rows[0].id,"job-111");
    assert.equal(f.select({stage:"completed",to:"2026-09-21"}).count,0);
    assert.equal(f.select({q:"Customer One"}).count,112);
  } finally {f.db.close();}
});
test("stable tie ordering makes consecutive job pages complete and non-overlapping",()=>{
  const f=fixture();try{
    const one=f.select({}),two=f.select({page:"2"}),three=f.select({page:"3"});
    assert.equal(one.rows.length,50);assert.equal(two.rows.length,50);assert.equal(three.rows.length,12);
    assert.equal(new Set([...one.rows,...two.rows,...three.rows].map(row=>row.id)).size,112);
  }finally{f.db.close();}
});
test("job search treats wildcard characters literally and sort input never becomes SQL",()=>{
  const f=fixture();try{
    assert.equal(f.select({q:"100%_literal"}).count,1);
    assert.equal(f.select({q:"' OR 1=1 --"}).count,0);
    const query=adminJobQuery(new URLSearchParams({sort:"w.id;DROP TABLE trade_accounts",page:"-3",from:"2026-02-31"}));
    assert.equal(query.sort,"updated-desc");assert.equal(query.page,1);assert.equal(query.filters.from,"");
    assert.equal(f.select({q:"job-111"}).count,1);
  }finally{f.db.close();}
});
test("binned work and cross-owner linked customer details never leak into the register",()=>{
  const f=fixture();try{
    f.db.exec("UPDATE trade_work_orders SET record_status='binned' WHERE id='job-000'; UPDATE trade_crm_job_details SET crm_customer_id='other-customer' WHERE work_order_id='job-001';");
    assert.equal(f.select({}).count,111);
    assert.equal(f.select({q:"Private Other"}).count,0);
    assert.equal(f.select({q:"job-001"}).rows[0].customer_name,"");
  }finally{f.db.close();}
});

test("creation ranges use the displayed Australian day and combine with independent name filters",()=>{
  const f=fixture();try{
    assert.equal(f.select({createdFrom:"2026-09-21",createdTo:"2026-09-21",firstName:"customer",lastName:"one"}).count,112);
    assert.equal(f.select({createdTo:"2026-09-20"}).count,0);
    assert.equal(f.select({firstName:"one"}).count,0);
    assert.equal(f.select({lastName:"customer"}).count,0);
    assert.equal(f.select({firstName:"Cust%"}).count,0);
    f.db.exec("UPDATE trade_work_orders SET created_at='2026-09-21T14:00:00Z' WHERE id='job-111'");
    assert.equal(f.select({createdTo:"2026-09-21"}).count,111);
    assert.equal(f.select({sort:"created-desc"}).rows[0].id,"job-111");
    assert.equal(f.select({sort:"first-name-asc"}).count,112);
    assert.equal(f.select({sort:"last-name-asc"}).count,112);
  }finally{f.db.close();}
});
