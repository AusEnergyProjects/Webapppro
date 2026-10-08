import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadCouncilReport } from "../src/lib/council-reporting-server.ts";
import { councilReportPeriod } from "../src/lib/council-reporting.ts";
import { loadCouncilDemo } from "../src/lib/council-demo.ts";
import { postcodeCoordinate } from "../src/lib/postcode-distance.ts";
import { isValidAbn } from "../src/lib/trade-abn.ts";
import { creditexCanonicalSha256 } from "../src/lib/creditex-interchange-preflight.ts";
import { councilReportCsv } from "../src/lib/council-report-export.ts";

const now=new Date("2026-09-23T03:00:00Z");
const scope={ councilId:"council-a",name:"Test council",state:"VIC",postcodes:["3000","3001"],period:"quarter" };
const schema=fs.readFileSync(new URL("../db/schema.ts",import.meta.url),"utf8");
function fixture() {
  const db=new DatabaseSync(":memory:");
  for (const name of ["trade_accounts","trade_account_verification_reviews","trade_work_orders","trade_crm_job_details","trade_crm_customers","trade_crm_service_sites","trade_work_order_events","trade_crm_quick_invoices","trade_crm_accepted_invoices","trade_crm_quick_invoice_credits","trade_opportunities","trade_opportunity_matches","compliance_cases","compliance_programs","compliance_activity_versions","compliance_calculation_runs","compliance_calculator_versions","compliance_calculator_engine_receipts"]) {
    const start=schema.indexOf(`sqliteTable("${name}", {`); assert.ok(start>=0);
    const block=schema.slice(start,schema.indexOf("}, (table)",start));
    const cols=[...block.matchAll(/(text|integer|real)\("([a-z_0-9]+)"/g)];
    db.exec(`CREATE TABLE ${name} (${cols.map(([,type,key]) => `${key} ${type === "text" ? "TEXT DEFAULT ''" : "INTEGER DEFAULT 0"}`).join(",")})`);
  }
  const packetSql=fs.readFileSync(new URL("../drizzle/0144_creditex_output_actions.sql",import.meta.url),"utf8");
  const packSql=fs.readFileSync(new URL("../drizzle/0142_creditex_activity_work_packs.sql",import.meta.url),"utf8");
  for (const name of ["compliance_output_action_packets","compliance_output_action_reviews","compliance_output_action_events","compliance_output_action_adapter_receipts","compliance_activity_work_pack_instances","compliance_activity_work_pack_final_records","compliance_activity_work_pack_calculation_reviews"]) {
    const source=name.startsWith("compliance_output") ? packetSql : packSql;
    const start=source.indexOf(`CREATE TABLE \`${name}\``); assert.ok(start>=0);
    const block=source.slice(start,source.indexOf("CONSTRAINT",start));
    const columns=[...block.matchAll(/^\s*`([a-z_0-9]+)` (text|integer)/gm)];
    db.exec(`CREATE TABLE ${name} (${columns.map(([,key,type]) => `${key} ${type === "text" ? "TEXT DEFAULT ''" : "INTEGER DEFAULT 0"}`).join(",")})`);
  }
  db.exec("CREATE TABLE council_campaigns (id TEXT,council_id TEXT,code TEXT,title TEXT,kind TEXT,created_at TEXT); CREATE TABLE council_attributions (opportunity_id TEXT PRIMARY KEY,campaign_id TEXT,council_id TEXT,attributed_at TEXT)");
  const insert=(table,values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  let abn=51000000000;
  const account=(id="owner",overrides={}) => {
    while (!isValidAbn(String(++abn))) {}
    insert("trade_accounts",{ firebase_uid:id,abn:String(abn),verified_abn:String(abn),business_name:id,partner_type:"installer",account_status:"active",verification_status:"approved",verification_review_id:`r-${id}`,verification_reviewed_at:"2026-09-01",verification_reviewed_by_uid:"reviewer",postcode:"3000",address_state:"VIC",...overrides });
    insert("trade_account_verification_reviews",{ id:`r-${id}`,firebase_uid:id,abn:String(abn),business_name:id,partner_type:"installer",decision:"approved",review_method:"official_abr_lookup",reviewed_at:"2026-09-01",reviewed_by_uid:"reviewer" });
  };
  account();
  const job=(id,overrides={}) => {
    const { owner="owner",date="2026-09-10T12:00:00Z",postcode="3000",state="VIC",activity="hot-water",stage="completed",invoice=true,customer=`customer-${id}`,customerType="residential",customerOwner=owner,siteOwner=owner,...work }=overrides;
    if (!db.prepare("SELECT id FROM trade_crm_customers WHERE id=? AND firebase_uid=?").get(customer,customerOwner)) insert("trade_crm_customers",{id:customer,firebase_uid:customerOwner,customer_type:customerType});
    insert("trade_work_orders",{ id,firebase_uid:owner,partner_type:"installer",work_type:"job",record_status:"active",stage,service_category:activity,created_at:date,...work });
    insert("trade_crm_job_details",{ id:`d-${id}`,work_order_id:id,firebase_uid:owner,service_site_id:`s-${id}`,crm_customer_id:customer });
    insert("trade_crm_service_sites",{ id:`s-${id}`,firebase_uid:siteOwner,customer_id:customer,postcode,address_state:state,record_status:"active" });
    insert("trade_work_order_events",{ id:`e-${id}`,work_order_id:id,firebase_uid:owner,event_type:"job_completed",created_at:date });
    if (invoice) insert("trade_crm_quick_invoices",{ id:`i-${id}`,work_order_id:id,firebase_uid:owner,status:"issued",currency:"AUD",sent_at:date,total_cents:11000,tax_cents:1000 });
  };
  const prepare=(sql,values=[]) => ({ sql,values,bind:(...args) => prepare(sql,args),first:async () => db.prepare(sql).get(...values),all:async () => ({ results:db.prepare(sql).all(...values) }) });
  const d1={ prepare,batch:async statements => statements.map(statement => ({ results:db.prepare(statement.sql).all(...statement.values) })) };
  const impact=(job,unit="VEEC",suffix="",options={}) => {
    const key=`${job}-${unit}${suffix}`; const hash=creditexCanonicalSha256({ evidence:true }); const pdf="a".repeat(64); const input={ postcode:"3000",...options.inputs }; const output={ output:{ decimal:"20",unit },receiptHash:hash };
    const packet={ contract:"creditex-output-action-packet/v1",actionKind:"certificate_submission",outputClass:"tradable_certificate",outputCode:unit,programCode:unit==="VEEC" ? "VEU" : "SRES",complianceCaseId:`case-${key}`,caseRevision:1,workPack:{ finalRecordId:`final-${key}` },calculation:{ runId:`calc-${key}`,quantity:"20",unit,runByUid:"runner",verifiedByUid:"verifier",verifiedAt:"2026-09-01",inputSha256:creditexCanonicalSha256(input),outputSha256:creditexCanonicalSha256(output),receiptSha256:hash,calculatorVersionId:`calculator-${key}`,engineCalculatorKey:`key-${key}`,engineCalculatorVersion:1,calculatorSourceSha256:pdf } };
    const packetHash=creditexCanonicalSha256(packet); const reference=`provider-${key}`;
    const response={ packetSha256:packetHash,outcome:"provider_accepted",recordedByUid:"outcome-reviewer",providerReference:reference };
    insert("compliance_cases",{ id:`case-${key}`,organisation_id:"org",work_order_id:job,installer_uid:"owner",status:"accepted",revision:1,activity_version_id:`activity-${key}` });
    insert("compliance_programs",{ id:`program-${key}`,organisation_id:"org",program_code:options.programCode || (unit==="VEEC" ? "VEU" : "SRES") });
    insert("compliance_activity_versions",{ id:`activity-${key}`,program_id:`program-${key}`,registry_activity_code:options.activityCode || "" });
    insert("compliance_calculation_runs",{ id:`calc-${key}`,organisation_id:"org",case_id:`case-${key}`,case_revision:1,status:"verified",calculator_version_id:`calculator-${key}`,input_snapshot:JSON.stringify(input),output_snapshot:JSON.stringify(output),run_by_uid:"runner" });
    insert("compliance_calculator_versions",{ id:`calculator-${key}`,organisation_id:"org",activity_version_id:`activity-${key}`,approval_state:"approved",calculator_key:`key-${key}`,version:1,official_source_sha256:pdf });
    insert("compliance_calculator_engine_receipts",{ id:`engine-${key}`,organisation_id:"org",calculator_version_id:`calculator-${key}`,calculator_version_number:1,result:"passed",suite_receipt_hash:creditexCanonicalSha256({ suite:true }),vector_count:10,executed_by_uid:"engine-runner",executed_at:"2026-09-01" });
    insert("compliance_activity_work_pack_calculation_reviews",{ id:`calculation-review-${key}`,organisation_id:"org",instance_key:key,case_instance_id:`instance-${key}`,calculation_run_id:`calc-${key}`,decision:"approved",input_sha256:packet.calculation.inputSha256,output_sha256:packet.calculation.outputSha256,calculator_version_id:`calculator-${key}`,calculator_source_sha256:pdf,engine_receipt_id:`engine-${key}`,reviewer_uid:"verifier",reviewed_at:"2026-09-01" });
    insert("compliance_activity_work_pack_instances",{ id:`instance-${key}`,instance_key:key,organisation_id:"org",compliance_case_id:`case-${key}`,work_order_id:job,revision:1,status:"completed" });
    insert("compliance_activity_work_pack_final_records",{ id:`final-${key}`,organisation_id:"org",case_instance_id:`instance-${key}`,instance_sha256:hash,response_sha256:hash,pdf_sha256:pdf });
    insert("compliance_output_action_packets",{ id:`packet-${key}`,organisation_id:"org",action_kind:"certificate_submission",output_class:"tradable_certificate",output_code:unit,unit,program_code:packet.programCode,compliance_case_id:`case-${key}`,case_revision:1,work_pack_instance_id:`instance-${key}`,work_pack_revision:1,work_pack_final_record_id:`final-${key}`,work_pack_instance_sha256:hash,work_pack_response_sha256:hash,work_pack_final_pdf_sha256:pdf,calculation_run_id:`calc-${key}`,calculation_input_sha256:packet.calculation.inputSha256,calculation_output_sha256:packet.calculation.outputSha256,calculation_receipt_sha256:hash,calculator_version_id:`calculator-${key}`,engine_calculator_key:`key-${key}`,engine_calculator_version:1,calculator_source_sha256:pdf,quantity_text:"20",packet_snapshot:JSON.stringify(packet),packet_sha256:packetHash,prepared_by_uid:"preparer" });
    insert("compliance_output_action_reviews",{ id:`review-${key}`,organisation_id:"org",packet_id:`packet-${key}`,decision:"approved",packet_sha256:packetHash,reviewed_by_uid:"independent-reviewer",reviewed_at:"2026-09-02" });
    for (const [kind,sequence,actor] of [["submitted",2,"submitter"],["provider_accepted",3,"outcome-reviewer"]]) {
      insert("compliance_output_action_adapter_receipts",{ id:`receipt-${key}-${kind}`,organisation_id:"org",packet_id:`packet-${key}`,provider_status:kind,provider_name:"Provider",provider_reference:reference,adapter_id:"manual-provider-record/v1",request_snapshot:JSON.stringify(packet),request_sha256:packetHash,response_snapshot:JSON.stringify(response),response_sha256:creditexCanonicalSha256(response) });
      insert("compliance_output_action_events",{ id:`event-${key}-${kind}`,organisation_id:"org",packet_id:`packet-${key}`,sequence,to_status:kind,actor_kind:"compliance",actor_uid:actor,adapter_receipt_id:`receipt-${key}-${kind}`,occurred_at:"2026-09-03" });
    }
    return key;
  };
  return { db,insert,account,job,impact,report:(extra={}) => loadCouncilReport(d1,{ ...scope,...extra },now) };
}
function jobs(f,count=5,extra={}) { for (let i=0;i<count;i++) f.job(`j${i}`,extra); }

test("demo data is deterministic, fictional and reconciles across six months and all dimensions",() => {
  const report=loadCouncilDemo("year",now);
  assert.deepEqual(report,loadCouncilDemo("year",now));
  assert.equal(report.mode,"demonstration"); assert.match(report.scope.name,/Demonstration/); assert.equal(report.trend.length,6);
  for (const collection of [report.activities,report.postcodes,report.trend]) {
    for (const key of ["completedJobs","completedValueCents","localJobs","veecQuantity","stcQuantity","estimatedTonnesCo2e"]) assert.equal(collection.reduce((sum,row) => sum+row[key],0),report.metrics[key],key);
  }
  assert.equal(report.campaigns.reduce((sum,row) => sum+row.completedJobs,0),report.metrics.attributedCompletedJobs);
  assert.equal(report.campaigns.reduce((sum,row) => sum+row.enquiries,0),report.metrics.attributedEnquiries);
  assert.equal(loadCouncilDemo("quarter",now).trend.length,3);
  assert.ok(report.metrics.estimatedTonnesCo2e < report.metrics.veecQuantity+report.metrics.stcQuantity);
  assert.deepEqual(report.map.cells.map(row => row.postcode),["3182","3186","3194","3805","3810","3931","3995"]);
  for(const key of ["completedJobs","completedValueCents","veecQuantity","stcQuantity","estimatedTonnesCo2e"])assert.equal(report.sectors.rows.reduce((sum,row)=>sum+row.metrics[key],0),report.metrics[key],key);
  assert.equal(report.map.cells.reduce((sum,row) => sum+row.completedJobs,0),report.metrics.completedJobs);
  assert.equal(report.map.cells.reduce((sum,row) => sum+row.registeredLocalBusinesses,0),report.metrics.registeredLocalBusinesses);
  for (const cell of report.map.cells) {
    const [lat,lng]=postcodeCoordinate(cell.postcode);
    assert.deepEqual(cell.position,{ lat,lng });
  }
  assert.match(report.map.boundaryNote,/synthetic TLink outcomes, no council affiliation/);
});

test("fixed periods use Australian calendar dates and exact daylight-saving boundaries",() => {
  const period=councilReportPeriod("quarter","VIC",new Date("2026-12-31T14:00:00Z"));
  assert.equal(period.start,"2027-01-01"); assert.equal(period.end,"2027-01-01"); assert.equal(period.startUtc,"2026-12-31T13:00:00.000Z");
  assert.equal(councilReportPeriod("year","VIC",now).start,"2026-01-01");
  assert.throws(() => councilReportPeriod("custom","VIC",now));
});

test("empty live scope returns true zeros and unavailable impact, never demo data",async () => {
  const report=await fixture().report({ postcodes:[] });
  assert.equal(report.mode,"live"); assert.equal(report.metrics.completedJobs,0); assert.equal(report.metrics.completedValueCents,0);
  assert.equal(report.metrics.veecQuantity,null); assert.equal(report.metrics.stcQuantity,null); assert.equal(report.metrics.estimatedTonnesCo2e,null); assert.equal(report.dataQuality.missingCarbonMethod,true);
  assert.deepEqual(report.activities,[]); assert.equal(report.dataQuality.suppressed,false);
});

test("completed jobs and invoice values count once despite duplicate events and secondary activities",async () => {
  const f=fixture(); jobs(f);
  f.db.exec("UPDATE trade_work_orders SET service_categories='[\"hot-water\",\"solar\"]'");
  f.insert("trade_work_order_events",{ id:"duplicate",work_order_id:"j0",firebase_uid:"owner",event_type:"job_completed",created_at:"2026-09-11T12:00:00Z" });
  f.insert("trade_crm_accepted_invoices",{ id:"accepted",work_order_id:"j0",firebase_uid:"owner",status:"issued",currency:"AUD",total_cents:999999,tax_cents:0 });
  f.insert("trade_crm_quick_invoice_credits",{ id:"credit",invoice_id:"i-j0",work_order_id:"j0",firebase_uid:"owner",status:"issued",total_cents:550,tax_cents:50 });
  const report=await f.report(); assert.equal(report.metrics.completedJobs,5); assert.equal(report.metrics.completedValueCents,49500);
  assert.equal(report.activities.length,1); assert.equal(report.activities[0].key,"hot-water");
  assert.equal(report.metrics.localSharePercent,100);
});

test("postcode/state scope, owner joins, binned jobs and synthetic accounts are enforced",async () => {
  const f=fixture(); jobs(f); f.account("synthetic",{ is_synthetic:1 });
  for (const [id,extra] of [["other-area",{ postcode:"3999" }],["other-state",{ state:"NSW" }],["foreign-site",{ siteOwner:"another" }],["binned",{ record_status:"binned" }],["open",{ stage:"in_progress" }],["test",{ owner:"synthetic" }]]) f.job(id,extra);
  const report=await f.report(); assert.equal(report.metrics.completedJobs,5); assert.equal(report.metrics.completedValueCents,50000);
  assert.doesNotMatch(JSON.stringify(report),/customer-j0|i-j0|"firebase_uid"|"work_order_id"|"abn"/);
});

test("small distinct customer cohorts and all complementary breakdowns are withheld",async () => {
  for (const extra of [{ count:4 },{ count:5,customer:"same-customer" }]) {
    const f=fixture(); jobs(f,extra.count,extra.customer ? { customer:extra.customer } : {});
    const report=await f.report(); assert.equal(report.metrics.completedJobs,null); assert.equal(report.metrics.completedValueCents,null); assert.equal(report.dataQuality.suppressed,true); assert.deepEqual(report.activities,[]);
  }
});

test("small activity or postcode partitions hide the whole corresponding breakdown",async () => {
  const f=fixture(); jobs(f,10); f.db.exec("UPDATE trade_work_orders SET service_category='solar' WHERE id='j0'"); f.db.exec("UPDATE trade_crm_service_sites SET postcode='3001' WHERE id='s-j0'");
  const report=await f.report(); assert.equal(report.metrics.completedJobs,10); assert.deepEqual(report.activities,[]); assert.deepEqual(report.postcodes,[]);
  assert.ok(report.dataQuality.suppressedBreakdowns.includes("activities")); assert.ok(report.dataQuality.suppressedBreakdowns.includes("postcodes"));
  assert.ok(report.map.cells.every(row => row.completedJobs===null));
});

test("map contains every approved postcode and canonical centres without inventing missing coordinates",async () => {
  const f=fixture(); jobs(f);
  const report=await f.report({ postcodes:["3000","3001","9999"] });
  assert.deepEqual(report.map.cells.map(row => row.postcode),["3000","3001","9999"]);
  const [lat,lng]=postcodeCoordinate("3000");
  assert.deepEqual(report.map.cells[0].position,{ lat,lng });
  assert.equal(report.map.cells[0].completedJobs,5); assert.equal(report.map.cells[1].completedJobs,0);
  assert.equal(report.map.cells[2].position,null); assert.equal(report.map.cells[2].completedJobs,0);
  assert.match(report.map.boundaryNote,/not business or customer addresses/);
  assert.doesNotMatch(JSON.stringify(report.map),/customer-j|firebase_uid|work_order_id|ABN|s-j0/);
});

test("postcode trade counts reconcile with the approved local business total",async () => {
  const f=fixture(); jobs(f);
  for (let i=1;i<5;i++) f.account(`local${i}`);
  for (let i=0;i<6;i++) f.account(`other-local${i}`,{ postcode:"3001" });
  f.account("outside",{ postcode:"3002" }); f.account("synthetic",{ is_synthetic:1 });
  f.account("unreviewed"); f.db.exec("DELETE FROM trade_account_verification_reviews WHERE firebase_uid='unreviewed'");
  f.account("other-state",{ address_state:"NSW" });
  const report=await f.report();
  assert.equal(report.metrics.registeredLocalBusinesses,11);
  assert.deepEqual(report.map.cells.map(row => row.registeredLocalBusinesses),[5,6]);
  assert.equal(report.postcodes[0].registeredLocalBusinesses,5);
});

test("approved business directory counts stay visible while customer job cohorts remain protected",async () => {
  const f=fixture(); jobs(f);
  for (let i=1;i<5;i++) f.account(`local${i}`);
  f.account("small-area",{ postcode:"3001" });
  const report=await f.report();
  assert.equal(report.metrics.registeredLocalBusinesses,6);
  assert.deepEqual(report.map.cells.map(row => row.registeredLocalBusinesses),[5,1]);
  assert.equal(report.postcodes[0].registeredLocalBusinesses,5);
  assert.equal(report.metrics.completedJobs,5);
  f.job("small-customer-area",{ postcode:"3001" });
  const withSmallCustomerArea=await f.report();
  assert.equal(withSmallCustomerArea.metrics.registeredLocalBusinesses,6);
  assert.deepEqual(withSmallCustomerArea.map.cells.map(row => row.registeredLocalBusinesses),[5,1]);
  assert.ok(withSmallCustomerArea.map.cells.every(row => row.completedJobs===null));
  assert.deepEqual(withSmallCustomerArea.postcodes,[]);
});

test("period complements cannot expose one earlier-year customer by subtraction",async () => {
  const f=fixture(); jobs(f); f.job("earlier",{ date:"2026-05-01T00:00:00Z" });
  for (const period of ["quarter","year","all"]) assert.equal((await f.report({ period })).metrics.completedJobs,null);
});

test("period complements with small activity and locality slices withhold those metrics",async () => {
  const f=fixture(); jobs(f,10); f.account("outside",{ postcode:"4000",address_state:"QLD" });
  for (let i=0;i<5;i++) f.job(`early${i}`,{ date:"2026-05-01T00:00:00Z",owner:i===0 ? "outside" : "owner",activity:i===0 ? "solar" : "hot-water" });
  for (const period of ["quarter","year","all"]) {
    const report=await f.report({ period }); assert.equal(report.metrics.localJobs,null); assert.deepEqual(report.activities,[]); assert.equal(report.metrics.completedValueCents,null);
  }
});

test("local, outside and unknown business location counts stay distinct and hide small shares",async () => {
  const f=fixture(); f.account("outside",{ postcode:"4000",address_state:"QLD" }); f.account("unknown",{ postcode:"",address_state:"" });
  jobs(f); for (let i=0;i<5;i++) { f.job(`out${i}`,{ owner:"outside" }); f.job(`unknown${i}`,{ owner:"unknown" }); }
  let report=await f.report(); assert.equal(report.metrics.localJobs,5); assert.equal(report.metrics.outsideJobs,5); assert.equal(report.metrics.unknownLocalityJobs,5); assert.ok(Math.abs(report.metrics.localSharePercent-100/3)<1e-10);
  f.db.exec("UPDATE trade_work_orders SET record_status='binned' WHERE id='out0'");
  report=await f.report(); assert.equal(report.metrics.completedJobs,14); assert.equal(report.metrics.localJobs,null); assert.equal(report.metrics.outsideJobs,null); assert.equal(report.metrics.unknownLocalityJobs,null);
});

test("small invoice subsets cannot reveal a single customer's value",async () => {
  const f=fixture(); jobs(f,5,{ invoice:false });
  f.insert("trade_crm_quick_invoices",{ id:"only-invoice",work_order_id:"j0",firebase_uid:"owner",status:"issued",currency:"AUD",sent_at:"2026-09-01",total_cents:123400,tax_cents:0 });
  const report=await f.report(); assert.equal(report.metrics.completedJobs,5); assert.equal(report.metrics.completedValueCents,null); assert.equal(report.activities[0].completedValueCents,null);
});

test("five invoices for one customer do not satisfy the finance privacy cohort",async () => {
  const f=fixture(); jobs(f,5,{ customer:"same-customer" }); for (let i=0;i<5;i++) f.job(`uninvoiced${i}`,{ invoice:false });
  const report=await f.report(); assert.equal(report.metrics.completedJobs,10); assert.equal(report.metrics.completedValueCents,null); assert.equal(report.activities[0].completedValueCents,null);
});

test("registered local trades require the authoritative matching review and checksum-valid ABN",async () => {
  const f=fixture(); for (let i=1;i<5;i++) f.account(`approved${i}`);
  f.account("no-review"); f.db.exec("DELETE FROM trade_account_verification_reviews WHERE firebase_uid='no-review'");
  f.account("invalid"); f.db.exec("UPDATE trade_accounts SET abn='11111111111',verified_abn='11111111111' WHERE firebase_uid='invalid'");
  f.account("synthetic",{ is_synthetic:1 });
  assert.equal((await f.report()).metrics.registeredLocalBusinesses,5);
});

test("attribution uses matching opportunity and council and does not multiply jobs",async () => {
  const f=fixture(); jobs(f,10);
  f.insert("council_campaigns",{ id:"campaign",council_id:scope.councilId,code:"ref123",title:"Council event",kind:"session",created_at:"2026-09-01" });
  for (let i=0;i<5;i++) {
    f.insert("trade_opportunities",{ id:`op${i}`,state:"VIC",postcode:"3000",is_synthetic:0 });
    f.insert("trade_opportunity_matches",{ id:`match${i}`,opportunity_id:`op${i}`,firebase_uid:"owner" });
    f.insert("council_attributions",{ opportunity_id:`op${i}`,campaign_id:"campaign",council_id:scope.councilId,attributed_at:"2026-09-01" });
    f.db.prepare("UPDATE trade_work_orders SET source_type='public_lead',source_reference=? WHERE id=?").run(`match${i}`,`j${i}`);
  }
  const report=await f.report(); assert.equal(report.metrics.completedJobs,10); assert.equal(report.metrics.attributedEnquiries,5); assert.equal(report.metrics.attributedCompletedJobs,5); assert.equal(report.campaigns[0].completedValueCents,50000);
});

test("accepted governed packets provide separate VEEC/STC totals and VEU-only lifetime abatement",async () => {
  const f=fixture(); jobs(f);
  for (let i=0;i<5;i++) { f.impact(`j${i}`); f.impact(`j${i}`,"STC"); }
  const report=await f.report(); assert.equal(report.metrics.veecQuantity,100); assert.equal(report.metrics.stcQuantity,100); assert.equal(report.metrics.estimatedTonnesCo2e,100);
  assert.equal(report.dataQuality.impactEvidence,"provider_accepted"); assert.equal(report.dataQuality.impactCoverageJobs,5); assert.equal(report.activities[0].veecQuantity,100);
  assert.match(report.dataQuality.coverageNote,/not registry-issued/); assert.doesNotMatch(JSON.stringify(report),/packet-j|case-j|provider-j|outcome-reviewer|customer-j/);
});

test("stale, rejected, unreviewed, tampered and non-independent packets do not contribute",async () => {
  for (const mutation of [
    "UPDATE compliance_cases SET revision=2 WHERE id='case-j0-VEEC'",
    "UPDATE compliance_activity_work_pack_instances SET status='void' WHERE id='instance-j0-VEEC'",
    "UPDATE compliance_calculation_runs SET run_by_uid='different-person' WHERE id='calc-j0-VEEC'",
    "DELETE FROM compliance_calculator_engine_receipts WHERE id='engine-j0-VEEC'",
    "UPDATE compliance_activity_work_pack_calculation_reviews SET decision='rejected' WHERE calculation_run_id='calc-j0-VEEC'",
    "UPDATE compliance_calculator_versions SET approval_state='withdrawn' WHERE id='calculator-j0-VEEC'",
    "UPDATE compliance_calculator_engine_receipts SET result='failed' WHERE id='engine-j0-VEEC'",
    "UPDATE compliance_output_action_events SET to_status='rejected' WHERE packet_id='packet-j0-VEEC' AND sequence=3",
    "UPDATE compliance_output_action_reviews SET decision='rejected' WHERE packet_id='packet-j0-VEEC'",
    "UPDATE compliance_output_action_reviews SET reviewed_by_uid='preparer' WHERE packet_id='packet-j0-VEEC'",
    "UPDATE compliance_output_action_events SET actor_uid='submitter' WHERE packet_id='packet-j0-VEEC' AND sequence=3",
    "UPDATE compliance_output_action_adapter_receipts SET response_snapshot='{}' WHERE packet_id='packet-j0-VEEC' AND provider_status='provider_accepted'",
    "UPDATE compliance_calculation_runs SET output_snapshot='{}' WHERE id='calc-j0-VEEC'",
    "UPDATE compliance_output_action_packets SET quantity_text='99999' WHERE id='packet-j0-VEEC'",
  ]) {
    const f=fixture(); jobs(f); for (let i=0;i<5;i++) f.impact(`j${i}`); f.db.exec(mutation);
    const report=await f.report(); assert.equal(report.metrics.veecQuantity,null,mutation); assert.equal(report.metrics.estimatedTonnesCo2e,null,mutation); assert.equal(report.dataQuality.impactCoverageJobs,null,mutation);
  }
});

test("ambiguous multiple VEEC activities on a job are withheld while mixed schemes remain distinct",async () => {
  const f=fixture(); jobs(f); for (let i=0;i<5;i++) { f.impact(`j${i}`); f.impact(`j${i}`,"STC"); }
  f.impact("j0","VEEC","-overlap");
  const report=await f.report(); assert.equal(report.metrics.veecQuantity,null); assert.equal(report.metrics.stcQuantity,100); assert.equal(report.metrics.estimatedTonnesCo2e,null);
});

test("replayed accepted packets with identical final/calculation evidence cannot double count",async () => {
  const f=fixture(); jobs(f); for (let i=0;i<5;i++) f.impact(`j${i}`);
  // Simulates duplicate read candidates from a retained replay; same exact identity.
  for (const table of ["compliance_output_action_packets","compliance_output_action_reviews"]) f.db.exec(`INSERT INTO ${table} SELECT * FROM ${table} WHERE ${table.endsWith("packets") ? "id" : "packet_id"}='packet-j0-VEEC'`);
  assert.equal((await f.report()).metrics.veecQuantity,100);
});

test("all-time totals keep old jobs while the trend is bounded to the latest twelve months",async () => {
  const f=fixture(); jobs(f); for (let i=0;i<5;i++) f.job(`old${i}`,{ date:"2010-01-15T12:00:00Z" });
  const report=await f.report({ period:"all" }); assert.equal(report.metrics.completedJobs,10); assert.equal(report.trend.length,1); assert.equal(report.trend[0].completedJobs,5);
  assert.match(report.methodology.join(" "),/latest 12 months/);
});

test("packet quantity must equal the independently reviewed calculator decimal and unit",async () => {
  const f=fixture(); jobs(f); for (let i=0;i<5;i++) f.impact(`j${i}`);
  const row=f.db.prepare("SELECT * FROM compliance_output_action_packets WHERE id='packet-j0-VEEC'").get();
  const packet=JSON.parse(row.packet_snapshot); packet.calculation.quantity="999"; const hash=creditexCanonicalSha256(packet);
  f.db.prepare("UPDATE compliance_output_action_packets SET quantity_text='999',packet_snapshot=?,packet_sha256=? WHERE id=?").run(JSON.stringify(packet),hash,row.id);
  f.db.prepare("UPDATE compliance_output_action_reviews SET packet_sha256=? WHERE packet_id=?").run(hash,row.id);
  for (const receipt of f.db.prepare("SELECT * FROM compliance_output_action_adapter_receipts WHERE packet_id=?").all(row.id)) {
    const response=JSON.parse(receipt.response_snapshot); response.packetSha256=hash;
    f.db.prepare("UPDATE compliance_output_action_adapter_receipts SET request_snapshot=?,request_sha256=?,response_snapshot=?,response_sha256=? WHERE id=?").run(JSON.stringify(packet),hash,JSON.stringify(response),creditexCanonicalSha256(response),receipt.id);
  }
  assert.equal((await f.report()).metrics.veecQuantity,null);
});

test("superseded work-pack revisions cannot retain an accepted impact",async () => {
  const f=fixture(); jobs(f); for (let i=0;i<5;i++) f.impact(`j${i}`);
  f.insert("compliance_activity_work_pack_instances",{ id:"new-instance",instance_key:"j0-VEEC",organisation_id:"org",compliance_case_id:"case-j0-VEEC",work_order_id:"j0",revision:2,status:"in_progress" });
  assert.equal((await f.report()).metrics.veecQuantity,null);
});

test("council aggregates and governed evidence execute within actual Cloudflare D1 limits",async () => {
  const { Miniflare }=await import("miniflare");
  const runtime=new Miniflare({ modules:true,script:'export default { fetch() { return new Response("ok"); } }',compatibilityDate:"2025-04-01",d1Databases:{ DB:"council-reporting-regression" },port:0 });
  const f=fixture(); jobs(f); for (let i=0;i<5;i++) f.impact(`j${i}`);
  try {
    const db=await runtime.getD1Database("DB");
    for (const table of f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all()) {
      await db.prepare(table.sql).run();
      for (const row of f.db.prepare(`SELECT * FROM ${table.name}`).all()) await db.prepare(`INSERT INTO ${table.name} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).bind(...Object.values(row)).run();
    }
    for (const period of ["quarter","year","all"]) assert.deepEqual(await loadCouncilReport(db,{ ...scope,period },now),await f.report({ period }));
  } finally { f.db.close(); await runtime.dispose(); }
});

test("business, residential and unclassified work reconcile from owner-scoped customers, not delivering trades",async()=>{
  const f=fixture();
  for (const sector of ["business","residential",""]) for(let i=0;i<5;i++) f.job(`${sector || 'unknown'}-${i}`,{customerType:sector});
  const report=await f.report();
  assert.equal(report.metrics.completedJobs,15);
  assert.deepEqual(report.sectors.rows.map(row=>[row.key,row.metrics.completedJobs,row.metrics.completedValueCents]),[["business",5,50000],["residential",5,50000],["unclassified",5,50000]]);
  assert.equal(report.sectors.rows.reduce((sum,row)=>sum+row.metrics.completedJobs,0),report.metrics.completedJobs);
  assert.ok(report.sectors.rows.every(row=>row.activities[0].completedJobs===5));
  assert.equal(report.sectors.basis,"recorded_customer_type");
  assert.doesNotMatch(JSON.stringify(report),/customer-business|customer-residential|firebase_uid|work_order_id/);
  f.db.exec("UPDATE trade_crm_customers SET firebase_uid='another-owner' WHERE customer_type='business'");
  assert.deepEqual((await f.report()).sectors.rows.map(row=>row.metrics.completedJobs),[0,5,10]);
});

test("sector postcode activity month intersections and fixed-period complements cannot expose small groups",async()=>{
  for (const small of [
    {customerType:"business",postcode:"3001"},
    {customerType:"business",activity:"solar"},
    {customerType:"business",date:"2026-08-01T00:00:00Z"},
    {customerType:"business",date:"2026-05-01T00:00:00Z"},
  ]) {
    const f=fixture(); jobs(f,5,{customerType:"business"});
    for(let i=0;i<5;i++)f.job(`res-${i}`);
    f.job("small",small);
    for(const period of ["quarter","year","all"]){
      const report=await f.report({period});
      assert.equal(report.sectors.suppressed,true,JSON.stringify(small));
      assert.ok(report.sectors.rows.every(row=>row.metrics.completedJobs===null && row.metrics.completedValueCents===null && row.activities.length===0 && row.postcodes.length===0 && row.trend.length===0));
    }
  }
});

test("five completed jobs for one sector customer do not establish a safe sector cohort",async()=>{
  const f=fixture();jobs(f,5,{customerType:"business",customer:"same"});
  for(let i=0;i<5;i++)f.job(`res-${i}`);
  const report=await f.report();assert.equal(report.metrics.completedJobs,10);assert.equal(report.sectors.suppressed,true);
  assert.ok(report.sectors.rows.every(row=>row.metrics.completedJobs===null));
});

test("sector generation and storage use supported current accepted inputs and preserve unit distinctions",async()=>{
  const f=fixture();
  for(let i=0;i<5;i++){
    f.job(`pv-${i}`,{customerType:"business",activity:"solar"});
    f.impact(`pv-${i}`,"STC","",{activityCode:"PV",inputs:{ratedCapacityKw:"6.6"}});
    f.job(`battery-${i}`,{customerType:"business",activity:"battery"});
    f.impact(`battery-${i}`,"STC","",{activityCode:"BESS",inputs:{claimScope:"new_system",nominalCapacityKwh:"15",usableCapacityKwh:"13.5"}});
    f.impact(`pv-${i}`);
  }
  const report=await f.report(),business=report.sectors.rows[0].metrics;
  assert.equal(business.completedJobs,10);assert.equal(business.generationInstallations,5);assert.equal(business.generationCapacityKw,33);
  assert.equal(business.storageInstallations,5);assert.equal(business.storageCapacityKwh,67.5);assert.equal(business.measuredGenerationKwh,null);
  assert.equal(business.stcQuantity,200);assert.equal(business.veecQuantity,100);assert.equal(business.estimatedTonnesCo2e,100);
  assert.equal(report.sectors.rows[1].metrics.generationCapacityKw,null);
  assert.match(report.methodology.join(" "),/No metered generation dataset/);
});

test("invalid, ungoverned or extension-only capacity and small evidence complements are unavailable",async()=>{
  for(const options of [
    {activityCode:"PV",inputs:{ratedCapacityKw:"6.6"},programCode:"VEU"},
    {activityCode:"PV",inputs:{ratedCapacityKw:"6.6 kW"}},
    {activityCode:"BESS",inputs:{claimScope:"extension",usableCapacityKwh:"13.5"}},
    {activityCode:"SWH",inputs:{ratedCapacityKw:"6.6"}},
  ]){
    const f=fixture();jobs(f,5,{customerType:"business"});for(let i=0;i<5;i++)f.impact(`j${i}`,"STC","",options);
    const m=(await f.report()).sectors.rows[0].metrics;assert.equal(m.generationCapacityKw,null);assert.equal(m.storageCapacityKwh,null);
  }
  const f=fixture();jobs(f,5,{customerType:"business"});for(let i=0;i<5;i++)f.impact(`j${i}`,"STC","",{activityCode:"PV",inputs:{ratedCapacityKw:"6.6"}});
  f.job("unsupported",{customerType:"business"});
  const report=await f.report();assert.equal(report.metrics.completedJobs,6);assert.equal(report.sectors.rows[0].metrics.generationCapacityKw,null);assert.equal(report.metrics.stcQuantity,null);assert.equal(report.dataQuality.impactCoverageJobs,null);
});

test("council CSV exports protected sector figures with precise energy units and unavailable actual generation",async()=>{
  const f=fixture();jobs(f,5,{customerType:"business"});
  const report=await f.report(),csv=councilReportCsv(report);
  assert.match(csv,/Customer sector.*Rated generation capacity kW.*Usable storage capacity kWh.*Measured electricity generated kWh/);
  assert.match(csv,/"Business","5","500"/);assert.match(csv,/"Residential","0","0"/);
  assert.match(csv,/Withheld or unavailable/);assert.doesNotMatch(csv,/customer-j0|i-j0|firebase_uid/);
  f.job("small-residential");const hidden=councilReportCsv(await f.report());assert.doesNotMatch(hidden,/"Business","5"/);
});

test("empty sectors are true zero completed work but unsupported energy evidence remains unavailable",async()=>{
  const report=await fixture().report();assert.equal(report.sectors.suppressed,false);
  assert.deepEqual(report.sectors.rows.map(row=>row.metrics.completedJobs),[0,0,0]);
  assert.ok(report.sectors.rows.every(row=>row.metrics.generationCapacityKw===null && row.metrics.storageCapacityKwh===null && row.metrics.measuredGenerationKwh===null));
});
