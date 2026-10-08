import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { transformSync } from "esbuild";
import * as model from "../src/lib/council-monthly-report.ts";
import * as community from "../src/lib/council-community.ts";
import * as provider from "../src/lib/service-reminder-delivery.ts";
import * as boundedJson from "../src/lib/bounded-json-request.ts";
import * as profileContract from "../src/lib/council-profile.ts";

const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
function load(path,dependencies) {
  const compiled=transformSync(read(path),{loader:"ts",format:"cjs",target:"es2022"}).code;
  const record={exports:{}};
  Function("require","module","exports",compiled)(name=>{
    assert.ok(Object.hasOwn(dependencies,name),`Unexpected dependency ${name}`);return dependencies[name];
  },record,record.exports);
  return record.exports;
}
const profileServer=load("../src/lib/council-profile-server.ts",{"./address-localities.mjs":{},"./council-profile":profileContract});
const tokens=new Map();
const encryption={
  encrypt:async value=>{const token=`opaque-${crypto.randomUUID()}`;tokens.set(token,structuredClone(value));return token;},
  decrypt:async token=>{if(!tokens.has(token))throw new Error("Unknown test ciphertext");return structuredClone(tokens.get(token));},
  recipientHash:async(_purpose,value)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`synthetic-secret|${value}`))),byte=>byte.toString(16).padStart(2,"0")).join(""),
};
const server=load("../src/lib/council-monthly-report-server.ts",{
  "./trade-integration-crypto":{encryptProtectedPayload:encryption.encrypt,decryptProtectedPayload:encryption.decrypt,keyedProtectedAuditHash:encryption.recipientHash},
  "./council-community-server":{fetchCommunitySnapshot:async()=>{throw new Error("Unexpected external CER fetch");}},
  "./council-community":community,"./council-veu-server":{},"./council-veu":{},"./council-profile-server":profileServer,
  "./council-reporting-server":{},"./council-enquiries-server":{},"./council-monthly-report":model,"./service-reminder-delivery":provider,
});
const day0=new Date("2026-10-08T00:00:00.000Z"),day1=new Date("2026-10-09T00:00:00.000Z");
function snapshot(now=day0,sourceAsOf="2026-09-30") {
  return {version:1,sourceAsOf,fetchedAt:now.toISOString(),sourcePage:{url:community.CER_COMMUNITY_URL,sha256:"a".repeat(64)},datasets:community.COMMUNITY_METRICS.map(metric=>({id:metric.id,url:`https://cer.gov.au/document/${metric.path}`,sha256:"b".repeat(64),months:[sourceAsOf.slice(0,7)],rows:[{postcode:"3182",total:5,monthly:[5]}]}))};
}
function fixture() {
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY); CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,admin_uid TEXT,action TEXT,entity_type TEXT,entity_id TEXT,summary TEXT,metadata TEXT,created_at TEXT);");
  for(const name of ["0250_council_workspace.sql","0251_council_profile.sql","0258_council_public_branding.sql","0259_council_monthly_reports.sql"])sqlite.exec(read(`../drizzle/${name}`));
  sqlite.exec(`INSERT INTO council_organisations(id,name,slug,state,created_at,updated_at) VALUES ('owned','City of Port Phillip','owned-council','VIC','now','now'),('other','Other Council','other-council','VIC','now','now');
    INSERT INTO council_postcodes VALUES ('owned','VIC','3182','admin','now'),('other','VIC','3183','admin','now');
    INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,status,invited_by_uid,created_at,updated_at) VALUES ('member','owned','manager','manager@example.test','editor','active','admin','now','now'),('viewer','owned','viewer','viewer@example.test','viewer','active','admin','now','now');`);
  let beforeBatch=null;
  const statement=(sql,values=[])=>({sql,values,bind:(...next)=>statement(sql,next),first:async()=>sqlite.prepare(sql).get(...values)||null,all:async()=>({results:sqlite.prepare(sql).all(...values)}),run:async()=>({success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}),execute:()=>{
    const query=sqlite.prepare(sql);return /^\s*SELECT\b/i.test(sql)?{success:true,results:query.all(...values),meta:{changes:0}}:{success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};
  }});
  const db={prepare:statement,batch:async statements=>{const hook=beforeBatch;beforeBatch=null;hook?.(statements);sqlite.exec("BEGIN");try{const results=statements.map(value=>value.execute());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const objects=new Map();let storageHook=null;
  const artifactStore={put:async(key,bytes)=>{objects.set(key,Uint8Array.from(new Uint8Array(bytes)));},get:async key=>{
    const hook=storageHook;storageHook=null;hook?.();const bytes=objects.get(key);return bytes?{arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;
  },delete:async key=>{objects.delete(key);}};
  const sent=[];
  const sendEmail=async message=>{sent.push(structuredClone(message));return{provider:"resend",providerMessageId:`synthetic-${sent.length}`,providerStatus:"sent"};};
  const options={db,artifactStore,...encryption,buildBundle:async(_db,_scope,profile,source,now)=>({profile,source,generatedAt:now.toISOString(),demonstration:false}),buildPdf:async()=>new TextEncoder().encode("%PDF-1.7\nSynthetic aggregate report only"),sendEmail,emailConfigured:true};
  return {sqlite,db,options,artifactStore,objects,sent,sendEmail,close:()=>sqlite.close(),beforeBatch:hook=>{beforeBatch=hook;},storageHook:hook=>{storageHook=hook;},
    enable:async(recipients=["council@example.test"])=>server.saveCouncilMonthlySettings(db,"owned","manager",{enabled:true,recipients},{...encryption,now:day0,emailConfigured:true}),
    generate:async()=>{await server.runCouncilMonthlyReports({...options,now:day0,loadFreshSource:async()=>snapshot(day0)});return server.runCouncilMonthlyReports({...options,now:day1,loadFreshSource:async()=>snapshot(day1)});},
  };
}

test("monthly settings are disabled by default, membership scoped, encrypted, audited without addresses and redacted for viewers",async()=>{
  const f=fixture();try{
    const initial=await server.readCouncilMonthlySettings(f.db,"owned","manager",{...encryption,emailConfigured:true});assert.equal(initial.enabled,false);assert.deepEqual(initial.recipients,[]);
    assert.equal(await server.readCouncilMonthlySettings(f.db,"other","manager",encryption),null);
    const saved=await f.enable();assert.equal(saved.enabled,true);assert.deepEqual(saved.recipients,["council@example.test"]);
    const viewer=await server.readCouncilMonthlySettings(f.db,"owned","viewer",encryption);assert.equal(viewer.canManage,false);assert.deepEqual(viewer.recipients,[]);
    assert.equal(await server.saveCouncilMonthlySettings(f.db,"owned","viewer",{enabled:true,recipients:["attacker@example.test"]},encryption),null);
    const raw=f.sqlite.prepare("SELECT * FROM council_monthly_report_settings").get();assert.equal(JSON.stringify(raw).includes("council@example.test"),false);
    const audit=f.sqlite.prepare("SELECT * FROM admin_audit_log").get();assert.equal(audit.admin_uid,"manager");assert.equal(audit.entity_id,"owned");assert.equal(audit.metadata.includes("@"),false);
  }finally{f.close();}
});

test("revoking a manager between access and the settings transaction prevents settings and audit writes",async()=>{
  const f=fixture();try{
    f.beforeBatch(()=>f.sqlite.exec("UPDATE council_memberships SET status='suspended' WHERE id='member'"));
    assert.equal(await f.enable(),null);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_report_settings").get().n,0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_log").get().n,0);
  }finally{f.close();}
});

test("a membership revoked during recipient decryption cannot receive report configuration",async()=>{
  const f=fixture();try{
    await f.enable();const decrypt=async token=>{const value=await encryption.decrypt(token);f.sqlite.exec("UPDATE council_memberships SET status='suspended' WHERE id='member'");return value;};
    assert.equal(await server.readCouncilMonthlySettings(f.db,"owned","manager",{...encryption,decrypt}),null);
  }finally{f.close();}
});

test("only actual fresh CER observation triggers one frozen edition after a full 24 hours, with retained verified PDF and nominated recipient",async()=>{
  const f=fixture();try{
    await f.enable();
    const first=await server.runCouncilMonthlyReports({...f.options,now:day0,loadFreshSource:async()=>snapshot(day0)});assert.equal(first.waitingForSourceDay,true);assert.equal(f.objects.size,0);
    const early=new Date(day0.getTime()+86400_000-1);assert.equal((await server.runCouncilMonthlyReports({...f.options,now:early,loadFreshSource:async()=>snapshot(early)})).generated,0);
    assert.equal((await server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)})).generated,1);
    assert.equal((await server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)})).generated,0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_reports").get().n,1);assert.equal(f.objects.size,1);
    const report=f.sqlite.prepare("SELECT * FROM council_monthly_reports").get();assert.equal(report.status,"ready");assert.match(report.pdf_sha256,/^[a-f0-9]{64}$/);assert.equal(report.encrypted_payload.includes("@"),false);
    const delivery=await server.drainCouncilMonthlyReportEmails({...f.options,now:day1});assert.deepEqual(delivery,{attempted:1,accepted:1,failed:0,cancelled:0});
    assert.equal(f.sent[0].recipient,"council@example.test");assert.equal(f.sent[0].attachments.length,1);assert.equal(f.sent[0].attachments[0].contentType,"application/pdf");
    assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,now:day1})).attempted,0);
    const settings=await server.readCouncilMonthlySettings(f.db,"owned","manager",encryption);assert.equal(settings.lastReport.status,"accepted");assert.equal(settings.lastReport.acceptedRecipients,1);
  }finally{f.close();}
});

test("a stale/baseline snapshot cannot qualify as a fresh monthly release and failed fetch never generates an edition",async()=>{
  const f=fixture();try{
    await f.enable();
    await assert.rejects(server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day0)}),/FRESH_SOURCE_REQUIRED/);
    await assert.rejects(server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>{throw new Error("CER unavailable");}}),/CER unavailable/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_source_observations").get().n,0);assert.equal(f.objects.size,0);
  }finally{f.close();}
});

test("a later source request cannot move the monthly publication backwards or produce an older edition",async()=>{
  const f=fixture();try{
    await f.enable();await server.runCouncilMonthlyReports({...f.options,now:day0,loadFreshSource:async()=>snapshot(day0)});
    await assert.rejects(server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1,"2026-08-31")}),/SOURCE_REGRESSED/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_source_observations").get().n,1);assert.equal(f.objects.size,0);
  }finally{f.close();}
});

test("the idle monthly detector waits a full source day and excludes disabled, revoked, stale and superseded editions without building PDFs",async()=>{
  const f=fixture();try{
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    await f.enable();
    await server.runCouncilMonthlyReports({...f.options,now:day0,loadFreshSource:async()=>snapshot(day0)});
    const early=new Date(day1.getTime()-1);
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,early),false);
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),true);
    f.sqlite.exec("UPDATE council_monthly_report_settings SET enabled=0");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    f.sqlite.exec("UPDATE council_monthly_report_settings SET enabled=1; UPDATE council_memberships SET role='viewer' WHERE id='member'");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    f.sqlite.exec("UPDATE council_memberships SET role='editor' WHERE id='member'");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,new Date('2026-12-20T00:00:00.000Z')),false);
    f.sqlite.prepare("INSERT INTO council_monthly_source_observations VALUES (?,?,?,?)").run('2026-10-01',day1.toISOString(),day1.toISOString(),'c'.repeat(64));
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    assert.equal(f.objects.size,0);assert.equal(f.sent.length,0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_reports").get().n,0);
  }finally{f.close();}
});

test("the due detector and generator agree on leases, retry limits, terminal journals and current postcode authority",async()=>{
  const f=fixture();try{
    await f.enable();await f.generate();
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    f.sqlite.exec("UPDATE council_monthly_reports SET status='failed',generation_attempts=1");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),true);
    const lease=new Date(day1.getTime()+60_000);
    f.sqlite.prepare("UPDATE council_monthly_reports SET status='preparing',lease_expires_at=?").run(lease.toISOString());
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,lease),true);
    f.sqlite.exec("UPDATE council_monthly_reports SET lease_expires_at='',generation_attempts=4");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    f.sqlite.exec("UPDATE council_monthly_reports SET generation_attempts=1,status='cancelled'");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    f.sqlite.exec("UPDATE council_monthly_reports SET status='failed'; UPDATE council_postcodes SET postcode='3183' WHERE council_id='owned'");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
    assert.equal((await server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)})).generated,0);
    f.sqlite.exec("DELETE FROM council_postcodes WHERE council_id='owned'");
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false);
  }finally{f.close();}
});

test("twenty-three subscribed councils drain the same eligible edition in bounded ten-council runs and then become idle",async()=>{
  const f=fixture();try{
    await f.enable();
    for(let index=0;index<22;index++){
      const id=`additional-${String(index).padStart(2,'0')}`;
      f.sqlite.prepare("INSERT INTO council_organisations(id,name,slug,state,created_at,updated_at) VALUES (?,?,?,'VIC','now','now')").run(id,`Council ${index}`,id);
      f.sqlite.prepare("INSERT INTO council_postcodes VALUES (?,'VIC','3182','admin','now')").run(id);
      f.sqlite.prepare("INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,status,invited_by_uid,created_at,updated_at) VALUES (?,?,'manager','manager@example.test','editor','active','admin','now','now')").run(`member-${index}`,id);
      await server.saveCouncilMonthlySettings(f.db,id,'manager',{enabled:true,recipients:[`council-${index}@example.test`]},{...encryption,now:day0,emailConfigured:true});
    }
    await server.runCouncilMonthlyReports({...f.options,now:day0,loadFreshSource:async()=>snapshot(day0)});
    const generated=[];
    for(let minute=0;minute<3;minute++){
      const now=new Date(day1.getTime()+minute*60_000);
      assert.equal(await server.hasDueCouncilMonthlyReports(f.db,now),true);
      generated.push((await server.runCouncilMonthlyReports({...f.options,now,loadFreshSource:async()=>snapshot(now)})).generated);
    }
    assert.deepEqual(generated,[10,10,3]);
    assert.equal(await server.hasDueCouncilMonthlyReports(f.db,new Date(day1.getTime()+180_000)),false);
    assert.equal(f.objects.size,23);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_reports WHERE status='ready'").get().n,23);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_report_deliveries").get().n,23);
    assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,now:day1,limit:100})).accepted,23);
    assert.equal(new Set(f.sent.map(message=>message.idempotencyKey)).size,23);
    assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,now:day1,limit:100})).attempted,0);
  }finally{f.close();}
});

test("recipient changes before release invalidate unsent generation and rebuild this edition under current settings without consuming the failure budget",async()=>{
  for(const moment of ['build','encrypt','transaction']){
    const f=fixture();try{
      await f.enable();await server.runCouncilMonthlyReports({...f.options,now:day0,loadFreshSource:async()=>snapshot(day0)});
      const options={...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)};
      const recipients=['new-recipient@example.test'];
      if(moment==='build')options.buildPdf=async()=>{await f.enable(recipients);return f.options.buildPdf();};
      else if(moment==='encrypt')options.encrypt=async value=>{await f.enable(recipients);return encryption.encrypt(value);};
      else{
        const encrypted=await encryption.encrypt({recipients});
        f.beforeBatch(()=>f.sqlite.prepare("UPDATE council_monthly_report_settings SET encrypted_payload=?,revision=revision+1 WHERE council_id='owned'").run(encrypted));
      }
      assert.equal((await server.runCouncilMonthlyReports(options)).generated,0,moment);
      const invalidated=f.sqlite.prepare("SELECT * FROM council_monthly_reports").get();
      assert.equal(invalidated.status,'failed',moment);assert.equal(invalidated.generation_attempts,0,moment);
      assert.equal(f.objects.size,0,moment);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_report_deliveries").get().n,0,moment);
      assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),true,moment);
      assert.equal((await server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)})).generated,1,moment);
      const retained=f.sqlite.prepare("SELECT * FROM council_monthly_reports").get();
      assert.equal(retained.id,invalidated.id,moment);assert.equal(retained.settings_revision,2,moment);
      assert.deepEqual((await encryption.decrypt(retained.encrypted_payload)).recipients,recipients,moment);
      assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,now:day1})).accepted,1,moment);
      assert.equal(f.sent[0].recipient,recipients[0],moment);
      await f.enable(['another-recipient@example.test']);
      assert.equal(await server.hasDueCouncilMonthlyReports(f.db,day1),false,moment);
      assert.equal((await server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)})).generated,0,moment);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_reports").get().n,1,moment);
      assert.equal(f.sent.length,1,moment);
    }finally{f.close();}
  }
});

test("concurrent monthly generation claims retain one immutable edition and one set of recipient deliveries",async()=>{
  const f=fixture();try{
    await f.enable();await server.runCouncilMonthlyReports({...f.options,now:day0,loadFreshSource:async()=>snapshot(day0)});
    const results=await Promise.all([server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)}),server.runCouncilMonthlyReports({...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)})]);
    assert.equal(results.reduce((sum,row)=>sum+row.generated,0),1);assert.equal(f.objects.size,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_report_deliveries").get().n,1);
  }finally{f.close();}
});

test("membership, scope or settings changes during generation and immediately before its transaction cannot release a stale PDF",async()=>{
  for(const moment of ["build","transaction"])for(const change of ["UPDATE council_memberships SET status='suspended' WHERE id='member'","UPDATE council_monthly_report_settings SET enabled=0","DELETE FROM council_postcodes WHERE council_id='owned'"]){
    const f=fixture();try{
      await f.enable();await server.runCouncilMonthlyReports({...f.options,now:day0,loadFreshSource:async()=>snapshot(day0)});
      const options={...f.options,now:day1,loadFreshSource:async()=>snapshot(day1)};
      if(moment==="build")options.buildPdf=async()=>{f.sqlite.exec(change);return f.options.buildPdf();};
      else f.beforeBatch(()=>f.sqlite.exec(change));
      assert.equal((await server.runCouncilMonthlyReports(options)).generated,0,`${moment}: ${change}`);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_monthly_report_deliveries").get().n,0);assert.equal(f.objects.size,0);
    }finally{f.close();}
  }
});

test("queued reports stop before any provider call when disabled, scope changed or manager revoked; removed recipients alone are cancelled",async()=>{
  for(const change of ["UPDATE council_monthly_report_settings SET enabled=0","UPDATE council_memberships SET status='suspended' WHERE id='member'","UPDATE council_postcodes SET postcode='3183' WHERE council_id='owned'"]){
    const f=fixture();try{await f.enable();await f.generate();f.sqlite.exec(change);assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,now:day1})).cancelled,1);assert.equal(f.sent.length,0);}finally{f.close();}
  }
  const f=fixture();try{
    await f.enable(["one@example.test","two@example.test"]);await f.generate();await f.enable(["two@example.test"]);
    const outcome=await server.drainCouncilMonthlyReportEmails({...f.options,now:day1});assert.equal(outcome.accepted,1);assert.equal(outcome.cancelled,1);assert.equal(f.sent[0].recipient,"two@example.test");
  }finally{f.close();}
});

test("late scope change while reading the PDF is checked again before provider dispatch",async()=>{
  const f=fixture();try{await f.enable();await f.generate();f.storageHook(()=>f.sqlite.exec("DELETE FROM council_postcodes WHERE council_id='owned'"));assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,now:day1})).cancelled,1);assert.equal(f.sent.length,0);}finally{f.close();}
});

test("provider timeouts replay exactly the same frozen payload/key inside 23 hours and accepted mail is never resent",async()=>{
  const f=fixture();try{
    await f.enable();await f.generate();const messages=[];let tries=0;
    const sendEmail=async message=>{messages.push(structuredClone(message));if(++tries===1)throw new provider.ReminderProviderDeliveryError("indeterminate","Synthetic timeout");return{provider:"resend",providerMessageId:"synthetic-ok",providerStatus:"sent"};};
    const first=await server.drainCouncilMonthlyReportEmails({...f.options,sendEmail,now:day1});assert.equal(first.failed,1);assert.equal(f.sqlite.prepare("SELECT status FROM council_monthly_report_deliveries").get().status,"retry");
    const retryAt=new Date(day1.getTime()+5*60_000);assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,sendEmail,now:retryAt})).accepted,1);
    assert.deepEqual(messages[0],messages[1]);assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,sendEmail,now:retryAt})).attempted,0);
  }finally{f.close();}
});

test("an expired ambiguous delivery becomes unknown and four indeterminate attempts are terminal",async()=>{
  const f=fixture();try{
    await f.enable();await f.generate();const sendEmail=async()=>{throw new provider.ReminderProviderDeliveryError("indeterminate","Synthetic timeout");};
    await server.drainCouncilMonthlyReportEmails({...f.options,sendEmail,now:day1});
    const late=new Date(day1.getTime()+23*3600_000);assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,sendEmail,now:late})).attempted,0);assert.equal(f.sqlite.prepare("SELECT status FROM council_monthly_report_deliveries").get().status,"unknown");
  }finally{f.close();}
  const g=fixture();try{
    await g.enable();await g.generate();const sendEmail=async()=>{throw new provider.ReminderProviderDeliveryError("indeterminate","Synthetic timeout");};
    for(const minutes of [0,5,35,155])await server.drainCouncilMonthlyReportEmails({...g.options,sendEmail,now:new Date(day1.getTime()+minutes*60_000)});
    const row=g.sqlite.prepare("SELECT status,attempts FROM council_monthly_report_deliveries").get();assert.equal(row.status,"unknown");assert.equal(row.attempts,4);
  }finally{g.close();}
});

test("definite provider rejection and corrupt stored PDF never enter automatic resend",async()=>{
  for(const corrupt of [false,true]){
    const f=fixture();try{
      await f.enable();await f.generate();if(corrupt){const key=[...f.objects.keys()][0];f.objects.set(key,new TextEncoder().encode("corrupt"));}
      const sendEmail=async()=>{throw new provider.ReminderProviderDeliveryError("definite_failure","Synthetic provider rejection");};
      const result=await server.drainCouncilMonthlyReportEmails({...f.options,sendEmail,now:day1});assert.equal(result.failed,1);assert.equal(f.sqlite.prepare("SELECT status FROM council_monthly_report_deliveries").get().status,"failed");
      assert.equal((await server.drainCouncilMonthlyReportEmails({...f.options,sendEmail,now:day1})).attempted,0);
    }finally{f.close();}
  }
});

test("concurrent drainers claim each recipient once and recover an interrupted lease with the same provider key",async()=>{
  const f=fixture();try{
    await f.enable();await f.generate();const outcomes=await Promise.all([server.drainCouncilMonthlyReportEmails({...f.options,now:day1}),server.drainCouncilMonthlyReportEmails({...f.options,now:day1})]);
    assert.equal(outcomes.reduce((sum,row)=>sum+row.accepted,0),1);assert.equal(f.sent.length,1);
  }finally{f.close();}
  const g=fixture();try{
    await g.enable();await g.generate();g.sqlite.prepare("UPDATE council_monthly_report_deliveries SET status='sending',attempts=1,first_attempt_at=?,claim_token='old-claim',lease_expires_at=?").run(day1.toISOString(),day1.toISOString());
    assert.equal((await server.drainCouncilMonthlyReportEmails({...g.options,now:new Date(day1.getTime()+180_000)})).accepted,1);
    assert.equal(g.sqlite.prepare("SELECT attempts FROM council_monthly_report_deliveries").get().attempts,2);
  }finally{g.close();}
});

test("saved PDF downloads require current council membership and the same current postcode scope",async()=>{
  const f=fixture();try{
    await f.enable();await f.generate();const report=f.sqlite.prepare("SELECT id FROM council_monthly_reports").get();
    assert.ok(await server.readCouncilMonthlyReportPdf(f.db,"owned","viewer",f.artifactStore,report.id));
    assert.equal(await server.readCouncilMonthlyReportPdf(f.db,"other","manager",f.artifactStore,report.id),null);
    f.sqlite.exec("UPDATE council_postcodes SET postcode='3183' WHERE council_id='owned'");assert.equal(await server.readCouncilMonthlyReportPdf(f.db,"owned","manager",f.artifactStore,report.id),null);
  }finally{f.close();}
});

test("monthly route enforces exact origin, owner/editor role, bounded strict JSON and no-store responses",async()=>{
  const f=fixture();try{
    let role="editor";
    const route=load("../src/app/api/council/monthly-report/route.ts",{
      "@/lib/council-access-server":{requireCouncilAccess:async()=>({ok:true,db:f.db,identity:{uid:role==="viewer"?"viewer":"manager"},council:{id:"owned",role}})},
      "@/lib/council-monthly-report-server":server,"@/lib/council-monthly-report":model,"@/lib/bounded-json-request":boundedJson,"@/lib/customer-project-evidence-bucket":{getCustomerProjectEvidenceBucket:()=>f.artifactStore},
    });
    const request=(body,{origin="https://example.test",type="application/json"}={})=>new Request("https://example.test/api/council/monthly-report?councilId=owned",{method:"PATCH",headers:{Origin:origin,"Content-Type":type},body:typeof body==="string"?body:JSON.stringify(body)});
    assert.equal((await route.PATCH(request({enabled:true,recipients:["council@example.test"]},{origin:"https://hostile.example"}))).status,403);
    role="viewer";assert.equal((await route.PATCH(request({enabled:true,recipients:["council@example.test"]}))).status,403);role="editor";
    assert.equal((await route.PATCH(request({enabled:true,recipients:["council@example.test"],councilId:"other"}))).status,400);
    assert.equal((await route.PATCH(request("{"))).status,400);assert.equal((await route.PATCH(request("x".repeat(5000)))).status,413);
    assert.equal((await route.PATCH(request({enabled:true,recipients:["council@example.test"]},{type:"text/plain"}))).status,415);
    const response=await route.PATCH(request({enabled:true,recipients:["council@example.test"]}));assert.equal(response.status,200);assert.equal(response.headers.get("Cache-Control"),"private, no-store");
    const get=await route.GET(new Request("https://example.test/api/council/monthly-report?councilId=owned"));assert.equal(get.status,200);assert.equal((await get.json()).settings.enabled,true);
  }finally{f.close();}
});
