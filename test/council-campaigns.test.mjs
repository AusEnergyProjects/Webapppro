import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseCouncilCampaignInput, councilReferenceCode } from "../src/lib/council-campaigns.ts";
import { resolveCouncilReferral, loadPublicCouncilCampaign } from "../src/lib/council-campaign-server.ts";
import { persistLeadOpportunity } from "../src/lib/opportunity-source-write.mjs";
import { councilReportCsv } from "../src/lib/council-report-export.ts";
import { loadCouncilDemo } from "../src/lib/council-demo.ts";

const code="1234567890abcdef1234567890abcdef";
const valid={title:"Autumn upgrades",kind:"campaign",audience:"everyone",startsAt:null,location:null,meetingUrl:null};
function fixture(){
  const sql=new DatabaseSync(":memory:");sql.exec("PRAGMA foreign_keys=ON");
  sql.exec(`CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY,title TEXT,project_type TEXT,postcode TEXT,state TEXT,service_categories TEXT,priority TEXT,timing TEXT,summary TEXT,status TEXT,source_reference TEXT,contact_limit INTEGER,maximum_connected_installers INTEGER,expires_at TEXT,expired_at TEXT,created_by_uid TEXT,created_at TEXT,updated_at TEXT); CREATE UNIQUE INDEX source_identity ON trade_opportunities(source_reference) WHERE source_reference<>'';`);
  sql.exec(fs.readFileSync(new URL("../drizzle/0257_enquiry_windows.sql",import.meta.url),"utf8"));
  sql.exec(fs.readFileSync(new URL("../drizzle/0250_council_workspace.sql",import.meta.url),"utf8"));
  sql.exec(`INSERT INTO council_organisations VALUES('one','First Council','first-council','VIC','active','2026-09-23','2026-09-23'); INSERT INTO council_organisations VALUES('two','Second Council','second-council','VIC','active','2026-09-23','2026-09-23'); INSERT INTO council_postcodes VALUES('one','VIC','3000','admin','2026-09-23'); INSERT INTO council_postcodes VALUES('two','VIC','3001','admin','2026-09-23');`);
  for (const file of ["0251_council_profile.sql", "0258_council_public_branding.sql"]) sql.exec(fs.readFileSync(new URL(`../drizzle/${file}`,import.meta.url),"utf8"));
  sql.prepare("INSERT INTO council_campaigns(id,council_id,code,title,kind,audience,status,created_at,updated_at) VALUES('campaign','one',?,'Autumn upgrades','campaign','everyone','active','2026-09-23','2026-09-23')").run(code);
  const prepare=(text,values=[])=>({text,values,bind:(...next)=>prepare(text,next),first:async()=>sql.prepare(text).get(...values)||null,all:async()=>({results:sql.prepare(text).all(...values)}),run:async()=>({meta:{changes:sql.prepare(text).run(...values).changes}})});
  const db={prepare,async batch(statements){sql.exec("BEGIN");try{const result=statements.map(stmt=>({meta:{changes:sql.prepare(stmt.text).run(...stmt.values).changes}}));sql.exec("COMMIT");return result;}catch(error){sql.exec("ROLLBACK");throw error;}}};
  const record={id:"opportunity",title:"Heating upgrade",projectType:"home",postcode:"3000",state:"VIC",serviceCategories:'["heating-cooling"]',priority:"standard",timing:"planning",summary:"Private contact details never enter council views",requestedStatus:"draft",sourceReference:"source-1",contactLimit:3,maximumConnectedInstallers:3,expiresAt:"2027-01-01",createdAt:"2026-09-23T00:00:00Z",publicPlanEnquiry:false};
  const referral={campaignId:"campaign",councilId:"one",code};
  return{sql,db,record,referral};
}

test("campaign input rejects invalid kinds, hidden credentials, unsafe meeting schemes and ambiguous session times",()=>{
  assert.deepEqual(parseCouncilCampaignInput(valid),valid);
  for(const change of [{kind:"ad"},{audience:"admin"},{title:"a"},{title:"hello\nworld"},{meetingUrl:"javascript:alert(1)"},{meetingUrl:"https://me:secret@example.com"},{startsAt:"2026-10-08T17:00"}])assert.throws(()=>parseCouncilCampaignInput({...valid,...change}));
  assert.throws(()=>parseCouncilCampaignInput({...valid,kind:"session",startsAt:"2026-10-08T07:00:00Z"}));
  assert.equal(parseCouncilCampaignInput({...valid,kind:"session",startsAt:"2026-10-08T18:00:00+11:00",location:"Community hall"}).startsAt,"2026-10-08T07:00:00.000Z");
  assert.equal(councilReferenceCode("../secret"),null);assert.equal(councilReferenceCode(code),code);
});
test("referral only resolves an active campaign in its approved postcode and state",async()=>{
  const f=fixture();assert.deepEqual({...await resolveCouncilReferral(f.db,code,"3000","VIC")},f.referral);
  for(const args of [[code,"3001","VIC"],[code,"3000","NSW"],["bad","3000","VIC"]])await assert.rejects(resolveCouncilReferral(f.db,...args),/COUNCIL_REFERENCE_INVALID/);
  f.sql.exec("UPDATE council_campaigns SET status='paused'");await assert.rejects(resolveCouncilReferral(f.db,code,"3000","VIC"),/COUNCIL_REFERENCE_INVALID/);
});
test("public campaign projection exposes no internal identifiers or customer data",async()=>{
  const f=fixture();const result=await loadPublicCouncilCampaign(f.db,code);
  assert.deepEqual(Object.keys(result).sort(),["code","title","kind","audience","startsAt","location","meetingUrl","councilName","state","postcodes","logoDataUrl","primaryColor","accentColor","homeUrl"].sort());
  f.sql.exec("UPDATE council_organisations SET status='suspended'");assert.equal(await loadPublicCouncilCampaign(f.db,code),null);
});
test("new opportunity and council attribution persist atomically, once, without reassigning retries",async()=>{
  const f=fixture();await persistLeadOpportunity(f.db,f.record,null,{},f.referral);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM council_attributions").get().n,1);
  await persistLeadOpportunity(f.db,{...f.record,id:"retry"},null,{},f.referral);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_opportunities").get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM council_attributions").get().n,1);
  assert.equal(f.sql.prepare("SELECT opportunity_id FROM council_attributions").get().opportunity_id,"opportunity");
});
test("an existing unattributed enquiry cannot be claimed by a later campaign retry",async()=>{
  const f=fixture();await persistLeadOpportunity(f.db,f.record,null,{});
  await persistLeadOpportunity(f.db,{...f.record,id:"retry"},null,{},f.referral);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM council_attributions").get().n,0);
});
test("campaign suspension or scope revocation at persistence prevents an untracked council enquiry",async()=>{
  for(const mutation of ["UPDATE council_campaigns SET status='paused'","UPDATE council_organisations SET status='suspended'","DELETE FROM council_postcodes"]){
    const f=fixture();f.sql.exec(mutation);
    await assert.rejects(persistLeadOpportunity(f.db,f.record,null,{},f.referral),/COUNCIL_REFERENCE_INVALID/);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_opportunities").get().n,0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM council_attributions").get().n,0);
  }
});
test("an attribution write failure rolls back its new opportunity",async()=>{
  const f=fixture();f.sql.exec("CREATE TRIGGER reject_attribution BEFORE INSERT ON council_attributions BEGIN SELECT RAISE(ABORT,'test failure'); END");
  await assert.rejects(persistLeadOpportunity(f.db,f.record,null,{},f.referral),/test failure/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_opportunities").get().n,0);
});
test("CSV preserves demonstration and unavailable labels and escapes user-authored formulas",()=>{
  const report=loadCouncilDemo();report.scope.name="=1+1";report.metrics.estimatedTonnesCo2e=null;
  const csv=councilReportCsv(report);
  assert.ok(csv.startsWith('\uFEFF"TLINK DEMONSTRATION ONLY'));
  assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"Deemed lifetime VEU abatement (tCO2e)","Withheld or unavailable"'));
  assert.ok(csv.includes("Reporting methodology"));
});
