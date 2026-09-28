import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source=ts.transpileModule(fs.readFileSync(new URL("../src/app/api/trade-follow-ups/route.ts",import.meta.url),"utf8"),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({owner=true,authenticated=true,connected=true}={}) {
  const access={ownerUid:"business",actorUid:owner?"business":"staff",isOwner:owner};
  const calls=[];
  const db={};
  const json=(body,status=200)=>Response.json(body,{status});
  const server={};
  for(const name of ["saveFollowUpTemplate","deleteFollowUpTemplate","saveFollowUpSettings","followUpHistory","queueManualFollowUp","deliverFollowUp"]) {
    server[name]=async(...args)=>{calls.push({name,args});return name==="queueManualFollowUp"?"message-id":name==="deliverFollowUp"?"accepted":[];};
  }
  server.followUpConfiguration=async(...args)=>{calls.push({name:"config",args});return {templates:[],settings:{invoiceEnabled:false,appointmentEnabled:false}};};
  server.previewFollowUp=async(...args)=>{calls.push({name:"preview",args});return {recipient:"customer@example.test",recipientName:"Alex",subject:"Visit",body:"Hello Alex",contextHash:"hash",missing:[],context:{private:"never expose",fields:{job_number:"TLJ-123"}}};};
  const deps={
    "../../../../db":{getD1:()=>db},
    "@/lib/admin-server":{adminJson:json,sameOrigin:r=>r.headers.get("origin")==="https://example.test"},
    "@/lib/trade-team-server":{requireInstallerTeamAccess:async()=>{if(!authenticated) throw Error("AUTH");return access;}},
    "@/lib/trade-email-api":{tradeEmailRequestBody:r=>r.json(),tradeEmailApiError:e=>json({ok:false,error:e.message},401)},
    "@/lib/trade-email-server":{tradeEmailSettings:async()=>({connection:connected?{status:"connected",email:"trade@example.test"}:null})},
    "@/lib/trade-follow-ups-runtime":{followUpServices:()=>({recipient:async(...args)=>calls.push({name:"recipient",args})})},
    "@/lib/trade-follow-ups-server":server,
  };
  const record={exports:{}};
  new Function("require","module","exports",source)(key=>{if(!Object.hasOwn(deps,key)) throw Error(key);return deps[key];},record,record.exports);
  const request=(action,extra={},origin="https://example.test")=>new Request("https://example.test/api/trade-follow-ups",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({action,...extra})});
  return {route:record.exports,calls,access,db,request};
}

test("foreign-origin and unauthenticated follow-up requests cannot reach mutations",async()=>{
  const f=fixture();assert.equal((await f.route.POST(f.request("save_template",{},"https://elsewhere.test"))).status,403);assert.equal(f.calls.length,0);
  const locked=fixture({authenticated:false});assert.equal((await locked.route.POST(locked.request("send"))).status,401);assert.equal(locked.calls.length,0);
});
test("only business owner can change templates or reminder settings",async()=>{
  for(const action of ["save_template","delete_template","save_settings"]) {
    const f=fixture({owner:false});assert.equal((await f.route.POST(f.request(action))).status,403);assert.equal(f.calls.length,0);
  }
});
test("enabling automatic email requires a connected business mailbox but disabling does not",async()=>{
  const f=fixture({connected:false});assert.equal((await f.route.POST(f.request("save_settings",{settings:{invoiceEnabled:true}}))).status,401);
  assert.equal(f.calls.length,0);
  assert.equal((await f.route.POST(f.request("save_settings",{settings:{invoiceEnabled:false,appointmentEnabled:false}}))).status,200);
  assert.equal(f.calls[0].name,"saveFollowUpSettings");assert.equal(f.calls[0].args[1],"business");
});
test("preview uses authenticated access and server recipient, never submitted recipient",async()=>{
  const f=fixture();const r=await f.route.POST(f.request("preview",{workOrderId:"job",templateId:"general",recipient:"attacker@example.test"}));
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.recipient,"customer@example.test");assert.equal(data.context,undefined);
  const c=f.calls.find(c=>c.name==="preview");assert.equal(c.args[2],f.access);assert.deepEqual(c.args.slice(3),["job","general"]);
});
test("manual send retains the same request reference and authenticated delivery context",async()=>{
  const f=fixture();const input={workOrderId:"job",templateId:"general",requestId:"stable-request-id",subject:"Hello",body:"Alex",contextHash:"hash"};
  const r=await f.route.POST(f.request("send",input));assert.equal(r.status,200);assert.equal((await r.json()).status,"accepted");
  const q=f.calls.find(c=>c.name==="queueManualFollowUp"),d=f.calls.find(c=>c.name==="deliverFollowUp");
  assert.equal(q.args[2],f.access);assert.equal(q.args[3].requestId,input.requestId);assert.equal(d.args[2],"message-id");assert.equal(d.args[3],f.access);
});
test("staff cannot read business-wide follow-up history and job reads check access",async()=>{
  const f=fixture({owner:false});const r=await f.route.GET(new Request("https://example.test/api/trade-follow-ups?workOrderId=job",{headers:{origin:"https://example.test"}}));
  const result=await r.json();assert.deepEqual(result.history,[]);assert.equal(result.canManage,false);
  assert.equal(f.calls.some(c=>c.name==="followUpHistory"),false);assert.equal(f.calls.find(c=>c.name==="recipient").args[0],f.access);
  assert.equal(f.calls.find(c=>c.name==="config").args[1],"business");
});
