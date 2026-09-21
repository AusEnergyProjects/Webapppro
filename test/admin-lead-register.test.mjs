import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {Fragment} from 'react';
import {DatabaseSync} from 'node:sqlite';
import * as catalogue from '../src/lib/energy-service-catalogue.mjs';
import * as routing from '../src/lib/aea-trade-routing.mjs';
import * as aea from '../src/lib/aea-service-identity.mjs';
import {certificateTestDependency,installAeaTradeOwnerFixtureSchema} from './helpers/creditex-training-fixture.mjs';
const {certificateLeadEligibilitySql}=certificateTestDependency('trade-certificate-leads');
const source=fs.readFileSync(new URL('../src/components/AdminOpportunityWorkspace.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(' '):text(n.props?.children);
const nodes=(n,p)=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(i=>nodes(i,p)):[...(p(n)?[n]:[]),...nodes(n.props?.children,p)];
const lead={id:'lead-1',sourceReference:'AEA-REF',title:'Sunbury upgrade request',serviceCategories:['glazing','assessment','insulation'],postcode:'3429',state:'VIC',priority:'standard',timing:'planning',projectType:'Home',summary:'Scope',status:'draft',createdAt:'2026-09-20T06:03:13.398Z',updatedAt:'2026-09-20T06:03:13.398Z',expiresAt:'2026-10-20T06:03:13.398Z',matchCount:0,interestedCount:0,connectedCount:0,maximumConnectedInstallers:3,allocations:[]};
function harness(opportunity=lead,role='owner'){
 const state=[];let cursor=0;const exports={};
 const require=id=>id==='react'?{Fragment,useState:initial=>{const key=cursor++;if(!(key in state))state[key]=key===0?[opportunity]:typeof initial==='function'?initial():initial;return[state[key],value=>state[key]=typeof value==='function'?value(state[key]):value]},useEffect:()=>{},useCallback:fn=>fn,useRef:value=>({current:value})}:id==='react/jsx-runtime'?jsx:id.includes('energy-service-catalogue')?catalogue:id.includes('aea-trade-routing')?routing:id.includes('aea-service-identity')?aea:id.includes('australian-postcodes')?{AUSTRALIAN_STATE_CODES:['VIC','NSW']}:id.includes('admin-workspace')?{dateTime:value=>value||'Not yet',readable:value=>value.replaceAll('_',' ')}:id.endsWith('.css')?{default:{}}:{};
 Function('require','exports',compiled)(require,exports);
 return()=>{cursor=0;return exports.AdminOpportunityWorkspace({api:async()=>({}),role,setStatus:()=>{}})};
}
test('lead register shows received timestamp and AEA routing before opening private details',()=>{
 const render=harness();let tree=render();assert.equal(nodes(tree,n=>n.type==='table').length,1);assert.match(text(tree),/2026-09-20T06:03:13.398Z/);assert.match(text(tree),/Australian Energy Assessments follow-up/);assert.match(text(tree),/Not available to other businesses/);
 assert.equal(nodes(tree,n=>n.type==='button'&&text(n)==='Show retained contact').length,0);
 nodes(tree,n=>n.type==='button'&&text(n)==='View lead')[0].props.onClick();tree=render();assert.match(text(tree),/customer's separate permission/);assert.equal(nodes(tree,n=>n.type==='button'&&text(n)==='Show retained contact').length,1);assert.equal(nodes(tree,n=>n.type==='button'&&/Open for matching|Send to every/.test(text(n))).length,0);
});
test('trade assignment display distinguishes sent email from delivery and flags current eligibility',()=>{
 const render=harness({...lead,serviceCategories:['hot-water'],status:'open',matchCount:1,allocations:[{id:'match1',businessName:'Trade business',allocationRank:1,distanceKm:2,status:'offered',matchSource:'automatic',matchedAt:lead.createdAt,notificationStatus:'sent',notificationSentAt:lead.createdAt,notificationDeliveredAt:'',businessEligible:false}]});
 let tree=render();nodes(tree,n=>n.type==='button'&&text(n)==='View lead')[0].props.onClick();tree=render();assert.match(text(tree),/Trade matching/);assert.match(text(tree),/1\s+email\s+sent/);assert.match(text(tree),/Email status: .*sent/i);assert.doesNotMatch(text(tree),/Delivered/);assert.match(text(tree),/Business eligibility needs attention/);assert.equal(nodes(tree,n=>n.type==='button'&&text(n)==='Send to every eligible service-area trade').length,1);
});
test('support can open retained contact but cannot run allocation or status actions',()=>{
 const render=harness({...lead,serviceCategories:['hot-water'],status:'open'},'support');let tree=render();nodes(tree,n=>n.type==='button'&&text(n)==='View lead')[0].props.onClick();tree=render();assert.match(text(tree),/Show retained contact/);assert.equal(nodes(tree,n=>n.type==='button'&&/Send to every|Pause|Close enquiry/.test(text(n))).length,0);
});

test('reserved enquiry recovery is available only to operations owners and admins',()=>{
 for(const role of ['owner','admin','reviewer','support']){
  const render=harness(lead,role);let tree=render();nodes(tree,n=>n.type==='button'&&text(n)==='View lead')[0].props.onClick();tree=render();
  assert.equal(nodes(tree,n=>n.type==='button'&&text(n)==='Send to Australian Energy Assessments trade account').length,['owner','admin'].includes(role)?1:0);
  assert.equal(nodes(tree,n=>n.type==='button'&&text(n)==='Send to every eligible service-area trade').length,0);
 }
});
test('admin assignment query returns only this page, current eligibility and delivery metadata',()=>{
 const route=fs.readFileSync(new URL('../src/app/api/admin/opportunities/route.ts',import.meta.url),'utf8');
 const section=route.slice(route.indexOf('const allocationRows ='),route.indexOf('const allocations ='));
 const query=section.match(/db.prepare\(`([\s\S]*?)`\)/)[1].replace('${certificateLeadEligibilitySql("m.firebase_uid", "m.matched_categories", "o.state")}',certificateLeadEligibilitySql('m.firebase_uid','m.matched_categories','o.state')).replace('${pageRows.map(() => "?").join(",")}','?');
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE trade_opportunities(id TEXT,state TEXT); CREATE TABLE trade_accounts(firebase_uid TEXT,business_name TEXT,address_state TEXT,postcode TEXT,partner_type TEXT,capabilities TEXT); CREATE TABLE creditex_current_business_jurisdictions(owner_uid TEXT,state TEXT); CREATE TABLE trade_opportunity_matches(id TEXT,opportunity_id TEXT,firebase_uid TEXT,status TEXT,matched_categories TEXT,distance_metres INTEGER,allocation_rank INTEGER,match_source TEXT,contact_attempt_count INTEGER,last_contact_at TEXT,connected_at TEXT,matched_at TEXT); CREATE TABLE trade_opportunity_notification_deliveries(match_id TEXT,status TEXT,sent_at TEXT,delivered_at TEXT); INSERT INTO trade_opportunities VALUES('lead1','VIC'),('other','VIC'); INSERT INTO trade_accounts VALUES('trade1','Business','VIC','3000','installer','["hot-water"]'); INSERT INTO trade_opportunity_matches VALUES('m1','lead1','trade1','offered','["hot-water"]',1000,1,'automatic',0,'','','2026-09-20'),('m2','other','trade1','offered','["hot-water"]',1000,1,'automatic',0,'','','2026-09-20'); INSERT INTO trade_opportunity_notification_deliveries VALUES('m1','sent','2026-09-20','');`);
 installAeaTradeOwnerFixtureSchema(db);db.exec("ALTER TABLE trade_accounts ADD COLUMN service_states TEXT NOT NULL DEFAULT '[\"VIC\"]'");
 let rows=db.prepare(query).all('lead1');assert.equal(rows.length,1);assert.equal(rows[0].business_eligible,0);assert.equal(rows[0].notification_status,'sent');assert.equal(rows[0].notification_delivered_at,'');db.exec("INSERT INTO creditex_current_business_jurisdictions VALUES('trade1','VIC')");rows=db.prepare(query).all('lead1');assert.equal(rows[0].business_eligible,1);db.exec("UPDATE trade_accounts SET capabilities='[]'");assert.equal(db.prepare(query).get('lead1').business_eligible,0);db.close();
 assert.match(route,/"created-desc": makeSort\(\[term\("o.created_at", "desc", "created_at"\)\]\)/);
});

test('a later bounce is visible even when old delivery timestamps exist',()=>{
 const render=harness({...lead,serviceCategories:['hot-water'],status:'open',allocations:[{id:'m1',businessName:'Business',distanceKm:0,status:'offered',matchSource:'automatic',notificationStatus:'bounced',notificationSentAt:lead.createdAt,notificationDeliveredAt:lead.createdAt,businessEligible:true}]});
 let tree=render();nodes(tree,n=>n.type==='button'&&text(n)==='View lead')[0].props.onClick();tree=render();assert.match(text(tree),/Email status: .*bounced/);assert.match(text(tree),/Delivery receipt/);
});
test('refresh resets the first-page cursor and asks for a fresh total',()=>{
 const refresh=source.slice(source.indexOf('function refreshOpportunities()'),source.indexOf('function applyOpportunityView('));
 assert.match(refresh,/opportunityCursors.current = \[""\]/);assert.match(refresh,/opportunityTotalReady.current = false/);assert.match(refresh,/else setOpportunityPage\(1\)/);assert.match(refresh,/opportunityPage === 1.*loadOpportunities/);
});
