import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { councilMonthlyScopeKey } from "../src/lib/council-monthly-report.ts";

const source=readFileSync(new URL("../src/app/api/council/report-pdf/route.ts",import.meta.url),"utf8");
function setup(change={}) {
  const scope={id:"council-a",name:"Council A",state:"VIC",postcodes:["3182"],role:"viewer"};
  const profile={councilId:scope.id,name:scope.name,state:scope.state,postcodes:scope.postcodes};
  const calls={access:0,profile:0,pdf:0,pdfModule:0,demo:0,bundle:0};
  const pdf=new TextEncoder().encode("%PDF-1.7 synthetic fixture");
  const access={ok:true,db:{},identity:{uid:"viewer-a"},council:scope};
  const bundle={profile,community:{sourceAsOf:"2026-08-31",stale:false},demonstration:false};
  const mocks={
    "@/lib/council-access-server":{requireCouncilAccess:async()=>{calls.access++; return calls.access===1?access:change.afterAccess??access;}},
    "@/lib/council-monthly-demo":{councilMonthlyDemoBundle:async()=>{calls.demo++;return {...bundle,demonstration:true};}},
    "@/lib/council-monthly-report-pdf":{createCouncilMonthlyReportPdf:async()=>{calls.pdf++;return pdf;}},
    "@/lib/council-monthly-report":{councilMonthlyScopeKey,councilMonthlyFilename:()=>"Council-report.pdf"},
    "@/lib/council-monthly-report-server":{buildCouncilMonthlyBundle:async(db,input)=>{calls.bundle++;assert.equal(input.councilId,"council-a");return bundle;}},
    "@/lib/council-profile-server":{readCouncilProfile:async()=>{calls.profile++;return profile;}},
    "@/lib/council-community-server":{loadCommunitySnapshot:async()=>({snapshot:{sourceAsOf:"2026-08-31"},checkedAt:"2026-10-08",refreshFailed:false,dataOrigin:"cache"}),runtimeCommunityCache:async()=>undefined},
  };
  const fixtureSource=source.replaceAll('import("@/lib/council-monthly-report-pdf")','Promise.resolve(require("@/lib/council-monthly-report-pdf"))');
  const record={exports:{}}; new Function("require","module","exports",transformSync(fixtureSource,{loader:"ts",format:"cjs"}).code)(id=>{assert.ok(mocks[id],id);if(id==="@/lib/council-monthly-report-pdf")calls.pdfModule++;return mocks[id];},record,record.exports);
  assert.equal(calls.pdfModule,0,"PDF module must not load at route startup");
  return {GET:record.exports.GET,calls,access};
}
test("public demo PDF has a fixed identity and does not access private records",async()=>{
  const f=setup(),response=await f.GET(new Request("https://example.test/api/council/report-pdf?demonstration=seccca"));
  assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"application/pdf");
  assert.equal(f.calls.access,0);assert.equal(f.calls.profile,0);assert.equal(f.calls.bundle,0);assert.equal(f.calls.demo,1);
});
test("malformed or mixed demo selectors never reach source, private records or PDF generation",async()=>{
  for(const query of ["demonstration=", "demonstration=other", "demonstration=seccca&councilId=private", "councilId=a&councilId=b", "demonstration=seccca&postcodes=2000"]){
    const f=setup();assert.equal((await f.GET(new Request(`https://example.test/api/council/report-pdf?${query}`))).status,400);assert.equal(f.calls.access,0);assert.equal(f.calls.pdf,0);assert.equal(f.calls.pdfModule,0);
  }
});
test("revocation while a private PDF is generated blocks its bytes",async()=>{
  const f=setup({afterAccess:{ok:false,response:Response.json({ok:false,error:"revoked"},{status:403})}});
  const response=await f.GET(new Request("https://example.test/api/council/report-pdf?councilId=council-a"));
  assert.equal(response.status,403);assert.equal(f.calls.pdf,1);assert.equal(f.calls.access,2);assert.ok(!(await response.text()).includes("%PDF"));
});
test("a changed approved postcode scope blocks an obsolete private PDF",async()=>{
  const f=setup({afterAccess:{ok:true,council:{id:"council-a",name:"Council A",state:"VIC",postcodes:["3205"]}}});
  const response=await f.GET(new Request("https://example.test/api/council/report-pdf?councilId=council-a"));
  assert.equal(response.status,409);assert.equal(f.calls.access,2);assert.ok(!(await response.text()).includes("%PDF"));
});
test("an authorised viewer can download protected aggregates with private cache headers",async()=>{
  const f=setup(),response=await f.GET(new Request("https://example.test/api/council/report-pdf?councilId=council-a"));
  assert.equal(response.status,200);assert.match(response.headers.get("cache-control"),/private.*no-store/);assert.equal(response.headers.get("vary"),"Authorization");assert.equal(f.calls.access,2);
});
test("cross-origin PDF requests are rejected before any source or membership read",async()=>{
  const f=setup(),response=await f.GET(new Request("https://example.test/api/council/report-pdf?councilId=council-a",{headers:{origin:"https://other.test"}}));
  assert.equal(response.status,403);assert.equal(f.calls.access,0);assert.equal(f.calls.pdf,0);
});
