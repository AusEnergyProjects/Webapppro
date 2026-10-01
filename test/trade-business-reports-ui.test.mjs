import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as projection from "../src/lib/trade-finance-projection.ts";
import * as reporting from "../src/lib/trade-business-reports.ts";
const source = fs.readFileSync(new URL("../src/components/TradeBusinessReports.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item,predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children,predicate)];
const button = (tree,name) => nodes(tree,node=>node.type==="button" && text(node)===name)[0];
const flush = () => new Promise(resolve=>setImmediate(resolve));
const measures = { newJobs: 4,completedJobs: 2,quoteIssues: 3,wonQuotes: 2,declinedQuotes:1,wonCents: 20000,invoicedCents: 10000,creditCents:0,invoiceCount:1,bookedMinutes:240,visits:4,completedVisits:2,missingDurations:0 };
function report() { return { generatedAt:"2026-09-20T03:00:00Z",period:reporting.resolveReportPeriod(new URLSearchParams(),"VIC",new Date("2026-09-20T03:00Z")),service:"",state:"",permissions:{invoices:true,quotes:true},options:{services:["hot-water"],states:["VIC"]},current:{...measures},previous:{...measures,newJobs:2},trend:[],services:[],regions:[],work:{openJobs:3,waitingJobs:0,unassignedJobs:1,awaitingSchedule:1,overdueTasks:0,openIssues:0,completedUninvoiced:1,stages:[]},receivables:null,team:[] }; }
function harness(responder, options={}) {
  let cursor=0; let business={ownerUid:"business-a",memberId:""}; const state=[]; const effects=[]; const pending=[]; const requests=[]; const exports={}; const downloads=[];
  const user={getIdToken:options.getIdToken || (async()=>"token")};
  const hooks={useState(initial){const index=cursor++; if(!(index in state)) state[index]=typeof initial==="function"?initial():initial; return [state[index],next=>state[index]=typeof next==="function"?next(state[index]):next];},useEffect(callback,deps){const index=cursor++; const old=effects[index]; if(!old || deps.some((value,i)=>value!==old.deps[i])) { old?.cleanup?.(); effects[index]={deps}; pending.push(()=>effects[index].cleanup=callback()); }}};
  const require=id=>id==="react"?hooks:id==="react/jsx-runtime"?jsx:id==="./TradeBusinessProvider"?{useTradeBusinessFetch:()=>fetch,useTradeBusiness:()=>business}:id==="@/lib/trade-business-reports"?reporting:id==="@/lib/trade-finance-projection"?projection:id==="@/lib/energy-service-catalogue.mjs"?{ENERGY_SERVICE_LABELS:{"hot-water":"Hot water"}}:id==="./WorkspaceTableTools"?{downloadWorkspaceCsv:(...args)=>downloads.push(args)}:id.endsWith(".module.css")?{default:new Proxy({},{get:(_,key)=>String(key)})}:{};
  const fetch=async(url,init)=>{requests.push({url,init}); return responder(url,init);};
  Function("require","exports","fetch",compiled)(require,exports,fetch);
  const render=()=>{cursor=0; const tree=exports.TradeBusinessReports({user,onOpenJobs(){},...options.props}); for(const effect of pending.splice(0)) effect(); return tree;};
  return {render,requests,downloads,setBusiness(value){business=value;},async mount(){render();await flush();return render();},cleanup(){for(const effect of effects) effect?.cleanup?.();}};
}
const response=value=>({ok:true,json:async()=>({ok:true,report:value})});
test("period buttons request reports directly, expose export, and use authorised no-store requests", async()=>{
  const h=harness(async()=>response(report())); let tree=await h.mount();
  assert.equal(h.requests.length,1); assert.match(h.requests[0].url,/period=monthly/); assert.equal(h.requests[0].init.headers.Authorization,"Bearer token"); assert.equal(h.requests[0].init.cache,"no-store");
  for(const name of ["Weekly","Quarterly","Financial year to date"]){button(tree,name).props.onClick();h.render();await flush();tree=h.render();}
  assert.match(h.requests.at(-1).url,/period=fytd/); assert.equal(button(tree,"Export report").props.disabled,false);button(tree,"Export report").props.onClick();assert.equal(h.downloads.length,1);h.cleanup();
});
test("custom dates use the shared range picker and only load after Apply",async()=>{
  const h=harness(async()=>response(report()));let tree=await h.mount();button(tree,"Custom dates").props.onClick();tree=h.render();assert.equal(h.requests.length,1);
  const inputs=nodes(tree,node=>node.type==="input"&&node.props.type==="date");assert.equal(inputs.length,2);assert.equal(inputs[0].props['data-date-range-group'],inputs[1].props['data-date-range-group']);assert.equal(inputs[0].props['data-date-range-role'],"start");
  inputs[0].props.onChange({target:{value:"2026-07-01"}});inputs[1].props.onChange({target:{value:"2026-07-31"}});tree=h.render();nodes(tree,node=>node.type==="form")[0].props.onSubmit({preventDefault(){}});h.render();await flush();assert.match(h.requests.at(-1).url,/from=2026-07-01&to=2026-07-31/);h.cleanup();
});
test("failed reports show a recoverable error and prevent exporting old data",async()=>{
  const h=harness(async()=>({ok:false,json:async()=>({error:"Reports unavailable"})}));const tree=await h.mount();assert.match(text(tree),/Reports unavailable/);assert.equal(button(tree,"Export report").props.disabled,true);assert.ok(button(tree,"Try again"));h.cleanup();
});
test("a late response cannot replace the newly selected reporting period",async()=>{
  let release; const h=harness(async()=>h.requests.length===1?new Promise(resolve=>release=resolve):response({...report(),current:{...measures,newJobs:99}}));
  let tree=h.render();await flush();button(tree,"Weekly").props.onClick();h.render();await flush();tree=h.render();assert.equal(h.requests[0].init.signal.aborted,true);
  release(response(report()));await flush();tree=h.render();const cards=nodes(tree,node=>typeof node.type==="function"&&node.props.label==="New jobs");assert.equal(cards[0].props.value,"99");h.cleanup();
});

test("business and member changes immediately hide report data and options and disable stale exports",async()=>{
  const value=report(); value.options.services=["private-service"];
  let release; const h=harness(async()=>h.requests.length===1?response(value):new Promise(resolve=>release=resolve));
  await h.mount(); h.setBusiness({ownerUid:"business-b",memberId:""}); let tree=h.render();
  assert.match(text(tree),/Loading the selected business report/); assert.doesNotMatch(text(tree),/private-service/);
  assert.equal(nodes(tree,node=>typeof node.type==='function'&&node.props.label==='Net TLink invoicing').length,0);
  assert.equal(button(tree,"Export report").props.disabled,true); button(tree,"Export report").props.onClick(); assert.equal(h.downloads.length,0);
  await flush(); const oldRequest=h.requests.at(-1);
  h.setBusiness({ownerUid:"business-b",memberId:"new-member"}); tree=h.render(); assert.equal(oldRequest.init.signal.aborted,true);
  release(response(value)); await flush(); tree=h.render(); assert.doesNotMatch(text(tree),/private-service/); assert.equal(button(tree,"Export report").props.disabled,true); h.cleanup();
});

test("all time stays visible and exportable without comparison, with years on historical trends",async()=>{
  const value={...report(),period:reporting.resolveReportPeriod(new URLSearchParams({period:"all"}),"VIC",new Date("2026-09-20T03:00Z"),"1990-01-01"),previous:null,trend:[{start:"1990-01-01",end:"1990-12-31",newJobs:4,completedJobs:2,invoicedCents:10000}]};
  const h=harness(async()=>response(value));let tree=await h.mount();button(tree,"All time").props.onClick();h.render();await flush();tree=h.render();
  assert.match(h.requests.at(-1).url,/period=all/); assert.match(text(tree),/All recorded history/); assert.match(text(tree),/1990/);
  assert.equal(button(tree,"Previous"),undefined); assert.equal(button(tree,"Next"),undefined);
  const metrics=nodes(tree,node=>typeof node.type==="function"&&typeof node.props.label==="string");assert.equal(metrics.length,6);assert.ok(metrics.every(node=>node.props.comparison===null));
  button(tree,"Export report").props.onClick();assert.equal(h.downloads.length,1);h.cleanup();
});

test("report payment and incomplete-cost actions open the right job while partial margins stay explicit",async()=>{
  const value=report(),calls=[];
  value.receivables={outstandingCents:12000,paidCents:1000,buckets:[],undatedInvoiceCount:0,undatedInvoiceCents:0,items:[{jobId:'late',number:'TLJ-LATE',title:'Overdue work',balanceCents:12000,dueAt:'2026-09-01',overdueDays:19}]};
  value.profitability={jobs:2,completeJobs:0,revenueCents:20000,labourCents:0,materialCents:0,otherCents:0,labourMinutes:0,completeRevenueCents:0,marginCents:null,marginPercent:null,page:1,pageSize:50,
    coverage:{invoiceNeeded:1,planNeeded:0,scopeReview:0,costsNeeded:1,missingCosts:2},attentionItems:[],
    items:[{id:'missing-cost',number:'TLJ-COST',title:'Work needing costs',revenueCents:10000,labourCents:0,materialCents:0,otherCents:0,labourMinutes:0,missingCosts:2,status:'costs_needed',marginCents:null,marginPercent:null},
      {id:'missing-invoice',number:'TLJ-INVOICE',title:'Work needing invoice',revenueCents:0,labourCents:0,materialCents:0,otherCents:0,labourMinutes:0,missingCosts:0,status:'invoice_needed',marginCents:null,marginPercent:null}]};
  const h=harness(async()=>response(value),{props:{onOpenJobInvoice:id=>calls.push(['invoice',id]),onOpenJobCosts:id=>calls.push(['cost',id])}});const tree=await h.mount();
  for(const row of nodes(tree,node=>node.type==='tr'&&/TLJ-LATE|TLJ-COST|TLJ-INVOICE/.test(text(node)))) nodes(row,node=>node.type==='button')[0].props.onClick();
  assert.deepEqual(calls,[['invoice','late'],['cost','missing-cost'],['invoice','missing-invoice']]);
  const margin=nodes(tree,node=>typeof node.type==='function'&&node.props.label==='Margin on complete records')[0];assert.equal(margin.props.value,'Costs needed');
  assert.match(text(tree),/cost items missing/);assert.equal(nodes(tree,node=>node.type==='meter'&&node.props['aria-label']==='Jobs with complete cost and invoice records')[0].props.value,0);
  button(tree,'Export report').props.onClick();assert.ok(h.downloads[0][2].some(row=>row.section==='Cost coverage'&&row.metric==='Missing cost items'&&row.value===2)); h.cleanup();
});
