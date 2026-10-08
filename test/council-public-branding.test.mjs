import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { resolveCouncilPublicHost, isCouncilPlatformHost, SECCCA_DEMO_BRANDING, SECCCA_DEMO_POSTCODES, SECCCA_JOURNEY_DEMO_PATH } from "../src/lib/council-public-branding.ts";
import { loadPublicCouncilCampaign, resolveCouncilReferral } from "../src/lib/council-campaign-server.ts";

const code = "1234567890abcdef1234567890abcdef";
function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON; CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY);");
  for (const name of ["0250_council_workspace.sql", "0251_council_profile.sql", "0258_council_public_branding.sql"]) sql.exec(fs.readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  sql.exec(`INSERT INTO council_organisations(id,name,slug,state,created_at,updated_at) VALUES ('one','First Council','first-council','VIC','now','now'),('two','Other Council','other-council','VIC','now','now');
    INSERT INTO council_postcodes VALUES ('one','VIC','3182','admin','now');`);
  sql.prepare("INSERT INTO council_campaigns(id,council_id,code,title,kind,audience,status,created_at,updated_at) VALUES ('campaign','one',?,'Local upgrades','campaign','everyone','active','now','now')").run(code);
  sql.prepare("UPDATE council_organisations SET public_journey_enabled=1,public_home_url='https://www.portphillip.vic.gov.au/',public_hostname='energy.portphillip.vic.gov.au',public_campaign_id='campaign' WHERE id='one'").run();
  const prepare = (text, values = []) => ({ bind: (...next) => prepare(text, next), first: async () => sql.prepare(text).get(...values) || null });
  return { sql, db: { prepare }, close: () => sql.close(), verify: () => sql.exec("UPDATE council_organisations SET public_hostname_verified_at='2026-10-08T01:00:00Z' WHERE id='one'") };
}

test("a requested domain cannot serve a journey until separately verified, and another hostname cannot borrow that verification", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await resolveCouncilPublicHost(f.db, "https://energy.portphillip.vic.gov.au/", "GET"), { kind: "deny" });
    f.verify();
    assert.deepEqual(await resolveCouncilPublicHost(f.db, "https://energy.portphillip.vic.gov.au/", "GET"), { kind: "council", code, rewritePath: `/council/program/${code}` });
    for (const url of ["https://another-council.vic.gov.au/", "http://energy.portphillip.vic.gov.au/", "https://energy.portphillip.vic.gov.au:444/", "https://energy.portphillip.vic.gov.au.evil.example/"]) assert.deepEqual(await resolveCouncilPublicHost(f.db, url, "GET"), { kind: "deny" }, url);
  } finally { f.close(); }
});

test("verified domains expose only their own public journey, public address lookups and enquiry endpoint", async () => {
  const f = fixture();
  try {
    f.verify();
    for (const path of [`/council/program/${code}`, `/council/program/${code}/`, "/assets/client.js", "/_next/static/chunk.js", "/api/address-localities?postcode=3182", "/api/address-suggestions?query=Test"]) assert.equal((await resolveCouncilPublicHost(f.db, `https://energy.portphillip.vic.gov.au${path}`, "GET")).kind, "council", path);
    assert.equal((await resolveCouncilPublicHost(f.db, "https://energy.portphillip.vic.gov.au/api/leads", "POST")).kind, "council");
    for (const path of ["/council", "/council/demo", "/direct-trade/dashboard", "/account", "/creditex/compliance", "/api/admin/councils", "/api/council/report", "/api/council/profile", "/api/leads", "/api/health", "/council/program/abcdefabcdefabcdefabcdefabcdefab"]) assert.equal((await resolveCouncilPublicHost(f.db, `https://energy.portphillip.vic.gov.au${path}`, "GET")).kind, "deny", path);
    assert.equal((await resolveCouncilPublicHost(f.db, "https://energy.portphillip.vic.gov.au/", "POST")).kind, "deny");
  } finally { f.close(); }
});

test("suspending the council, disabling its journey or pausing its campaign immediately revokes every custom-host request", async () => {
  for (const change of ["UPDATE council_organisations SET status='suspended' WHERE id='one'", "UPDATE council_organisations SET public_journey_enabled=0 WHERE id='one'", "UPDATE council_campaigns SET status='paused' WHERE id='campaign'", "UPDATE council_organisations SET public_hostname_verified_at=NULL WHERE id='one'"]) {
    const f = fixture();
    try { f.verify(); f.sql.exec(change); assert.equal((await resolveCouncilPublicHost(f.db, "https://energy.portphillip.vic.gov.au/", "GET")).kind, "deny"); }
    finally { f.close(); }
  }
});

test("public branding is an allowlist, while referral attribution still requires the exact campaign and approved postcode", async () => {
  const f = fixture();
  try {
    const row = await loadPublicCouncilCampaign(f.db, code);
    assert.equal(row.councilName, "First Council"); assert.equal(row.homeUrl, "https://www.portphillip.vic.gov.au/");
    assert.equal(row.primaryColor, "#032733"); assert.equal(row.accentColor, "#0b765d");
    for (const key of ["councilId", "public_hostname", "public_hostname_verified_at", "id", "memberships", "email", "customers"]) assert.equal(Object.hasOwn(row, key), false, key);
    assert.deepEqual({ ...await resolveCouncilReferral(f.db, code, "3182", "VIC") }, { campaignId: "campaign", councilId: "one", code });
    await assert.rejects(resolveCouncilReferral(f.db, code, "3183", "VIC"), /COUNCIL_REFERENCE_INVALID/);
  } finally { f.close(); }
});

test("known platform hosts remain platform routes and do not need a council binding", async () => {
  for (const url of ["https://ausenergyassessments.com/council", "https://aea-energy-comparison.info294029.chatgpt.site/council", "http://localhost:3000/council"]) {
    assert.equal(isCouncilPlatformHost(url), true);
    assert.deepEqual(await resolveCouncilPublicHost({ prepare() { throw new Error("Should not query council hosts"); } }, url, "GET"), { kind: "platform" });
  }
});

test("SECCCA public preview is labelled, returns to its website and uses a local-only enquiry", () => {
  assert.equal(SECCCA_DEMO_BRANDING.homeUrl, "https://seccca.org.au/");
  assert.equal(SECCCA_JOURNEY_DEMO_PATH, "/council/program/demo/seccca");
  assert.match(SECCCA_DEMO_BRANDING.logoDataUrl,/^data:image\/png;base64,/);
  assert.deepEqual(SECCCA_DEMO_POSTCODES,["3182","3186","3194","3805","3810","3931","3995"]);
  const component = fs.readFileSync(new URL("../src/components/CouncilProgram.tsx", import.meta.url), "utf8");
  assert.match(component, /No enquiries are sent/); assert.match(component, /does not imply council endorsement/);
  assert.match(component, /councilReference=\{demonstration \? undefined : campaign.code\}/);
  assert.match(component, /initialCustomerSector=\{sector\}/);
});

function demoPage(path, dependencies) {
  const exported = {};
  const output = ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),"utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  Function("require","exports",output)(name => {
    assert.ok(Object.hasOwn(dependencies,name),`Unexpected page dependency: ${name}`);
    return dependencies[name];
  },exported);
  return exported;
}

test("the new public page supplies the shared SECCCA logo, colours and selected areas to its preview", () => {
  const Entry = () => null;
  const page = demoPage("../src/app/council/program/demo/seccca/page.tsx", {
    "react/jsx-runtime":jsxRuntime,"@/components/CouncilEntry":{CouncilProgramEntry:Entry},
    "@/lib/council-public-branding":{SECCCA_DEMO_BRANDING,SECCCA_DEMO_POSTCODES},
  });
  const element = page.default();
  assert.equal(element.type,Entry);
  assert.equal(element.props.demonstration,true);
  assert.equal(element.props.campaign.councilName,"SECCCA");
  assert.equal(element.props.campaign.logoDataUrl,SECCCA_DEMO_BRANDING.logoDataUrl);
  assert.equal(element.props.campaign.primaryColor,SECCCA_DEMO_BRANDING.theme.primaryColor);
  assert.equal(element.props.campaign.accentColor,SECCCA_DEMO_BRANDING.theme.accentColor);
  assert.deepEqual(element.props.campaign.postcodes,SECCCA_DEMO_POSTCODES);
  assert.match(page.metadata.title.absolute,/SECCCA/);
  assert.deepEqual(page.metadata.robots,{index:false,follow:false});
});

test("the previous Port Phillip path redirects through the framework to the single SECCCA preview", () => {
  const redirected = [];
  const page = demoPage("../src/app/council/program/demo/port-phillip/page.tsx", {
    "next/navigation":{redirect:path=>{redirected.push(path);throw new Error("NEXT_REDIRECT");}},
    "@/lib/council-public-branding":{SECCCA_JOURNEY_DEMO_PATH},
  });
  assert.throws(()=>page.default(),/NEXT_REDIRECT/);
  assert.deepEqual(redirected,[SECCCA_JOURNEY_DEMO_PATH]);
});
