import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
const source=fs.readFileSync(new URL("../src/app/api/trade-job-readiness/route.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture() {
  const db=new DatabaseSync(":memory:");
  const schema=fs.readFileSync(new URL("../db/schema.ts",import.meta.url),"utf8");
  for(const table of ["trade_work_orders","trade_crm_job_details","trade_crm_job_plans","trade_crm_job_plan_requirements","trade_crm_job_actuals","trade_work_order_events","trade_crm_commercial_handovers"]){
    const start=schema.indexOf(`sqliteTable("${table}", {`);const block=schema.slice(start,schema.indexOf("}, (table)",start));
    const columns=[...block.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match=>match[1]);db.exec(`CREATE TABLE ${table} (${columns.map(name=>`${name} ${/cents|minutes|milli/.test(name)?"INTEGER DEFAULT 0":"TEXT DEFAULT ''"}`).join(",")})`);
  }
  db.exec("CREATE UNIQUE INDEX actual_requirement ON trade_crm_job_actuals(job_plan_requirement_id)");
  db.exec("INSERT INTO trade_work_orders(id,firebase_uid,partner_type,record_status,stage) VALUES('job','owner','installer','active','completed'); INSERT INTO trade_crm_job_details(work_order_id,firebase_uid,customer_source) VALUES('job','owner','trade_owned'); INSERT INTO trade_crm_job_plans(id,work_order_id,firebase_uid,status) VALUES('plan','job','owner','completed'); INSERT INTO trade_crm_job_plan_requirements(id,job_plan_id,firebase_uid,requirement_type,status,description) VALUES('cost','plan','owner','labour','completed','Installation labour')");
  const prepare=(sql,values=[])=>({bind:(...args)=>prepare(sql,args),first:async()=>db.prepare(sql).get(...values),all:async()=>({results:db.prepare(sql).all(...values)}),run:async()=>db.prepare(sql).run(...values),sql,values});
  const d1={prepare,async batch(statements){db.exec("BEGIN");try {for(const s of statements)db.prepare(s.sql).run(...s.values);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}}};
  let authorised=true;const exports={};
  const require=id=>id.endsWith("/db")?{getD1:()=>d1}:id.endsWith("admin-server")?{sameOrigin:()=>true,cleanAdminText:(value,max)=>String(value||"").slice(0,max),adminJson:(value,status=200)=>Response.json(value,{status})}:id.endsWith("trade-integrations-server")?{requireInstallerOperations:async()=>{if(!authorised)throw new Error("FULL_ACCESS_REQUIRED");return {uid:"owner"};}}:{};
  Function("require","exports",compiled)(require,exports);
  return {db,setAuthorised:value=>authorised=value,post:extra=>exports.POST(new Request("https://example.com/api/trade-job-readiness",{method:"POST",body:JSON.stringify({action:"actual",workOrderId:"job",requirementId:"cost",quantityMilli:1000,durationMinutes:60,totalCostCents:2000,...extra})}))};
}
test("owner can record and correct completed-job costs without reopening or rewriting completion",async()=>{
  const f=fixture();assert.equal((await f.post({})).status,200);assert.equal((await f.post({totalCostCents:2500})).status,200);
  assert.equal(f.db.prepare("SELECT total_cost_cents FROM trade_crm_job_actuals").get().total_cost_cents,2500);
  assert.equal(f.db.prepare("SELECT stage FROM trade_work_orders").get().stage,"completed");assert.equal(f.db.prepare("SELECT status FROM trade_crm_job_plans").get().status,"completed");
  const events=f.db.prepare("SELECT summary FROM trade_work_order_events WHERE event_type='job_cost_recorded' ORDER BY rowid").all();assert.equal(events.length,2);assert.match(events[0].summary,/previous not recorded/);assert.match(events[1].summary,/costExGstCents":2000/);assert.match(events[1].summary,/costExGstCents":2500/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_work_order_events WHERE event_type='job_completed'").get().n,0);
});
test("completed-job correction retains owner boundary and cannot change waived work or compliance forms",async()=>{
  const f=fixture();f.setAuthorised(false);assert.equal((await f.post({})).status,403);f.setAuthorised(true);
  assert.equal((await f.post({workOrderId:"foreign"})).status,404);
  f.db.exec("UPDATE trade_crm_job_plan_requirements SET requirement_type='form'");assert.equal((await f.post({})).status,400);
  f.db.exec("UPDATE trade_crm_job_plan_requirements SET requirement_type='labour',status='not_needed'");assert.equal((await f.post({})).status,400);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_crm_job_actuals").get().n,0);
});
