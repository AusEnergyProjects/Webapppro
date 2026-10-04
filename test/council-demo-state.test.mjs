import assert from "node:assert/strict";
import test from "node:test";
import { COUNCIL_DEMO_STORAGE_KEY, createCouncilDemoState, readCouncilDemoState, councilDemoReport } from "../src/lib/council-demo-state.ts";
import { councilReportCsv } from "../src/lib/council-report-export.ts";

const now = new Date("2026-09-23T06:00:00Z");

test("demo profile, theme, period and edited campaigns survive a safe browser-storage round trip", () => {
  const state = createCouncilDemoState(now);
  state.profile.name = "Practice City Council";
  state.profile.theme = { primaryColor: "#172554", accentColor: "#7c3aed" };
  state.period = "quarter";
  state.campaigns[0].title = "Spring electrification";
  state.campaigns[0].status = "paused";
  const restored = readCouncilDemoState(JSON.stringify(state));
  assert.deepEqual(restored,state);
  assert.match(COUNCIL_DEMO_STORAGE_KEY,/demonstration/);
  const report = councilDemoReport(restored,now);
  assert.equal(report.scope.name,"Practice City Council");
  assert.equal(report.period.key,"quarter");
  assert.equal(report.campaigns[0].name,"Spring electrification");
  assert.match(councilReportCsv(report),/Spring electrification/);
});

test("editing demo postcodes updates every report partition and the map without retaining removed areas", () => {
  const state = createCouncilDemoState(now);
  state.profile.postcodes = ["3806","3810"];
  const report = councilDemoReport(state,now);
  assert.deepEqual(report.scope.postcodes,["3806","3810"]);
  assert.deepEqual(report.map.cells.map(row=>row.postcode),["3806","3810"]);
  assert.deepEqual(report.postcodes.map(row=>row.key),["3806","3810"]);
  assert.ok(report.map.cells.every(row=>row.position));
  assert.equal(report.metrics.registeredLocalBusinesses,report.map.cells.reduce((sum,row)=>sum+row.registeredLocalBusinesses,0));
  for (const field of ["completedJobs","completedValueCents","veecQuantity","stcQuantity","estimatedTonnesCo2e"]) {
    assert.equal(report.metrics[field],report.postcodes.reduce((sum,row)=>sum+row[field],0),field);
    assert.equal(report.metrics[field],report.activities.reduce((sum,row)=>sum+row[field],0),field);
    assert.equal(report.metrics[field],report.trend.reduce((sum,row)=>sum+row[field],0),field);
  }
});

test("new practice campaigns begin with zero recorded outcomes and retain a safe local preview path", () => {
  const state = createCouncilDemoState(now);
  const extra = {...state.campaigns[0],id:"demo-new",code:"demo-new",title:"New local campaign",shareUrl:"javascript:alert(1)"};
  state.campaigns.push(extra);
  const restored = readCouncilDemoState(JSON.stringify(state));
  assert.equal(restored.campaigns.at(-1).shareUrl,"/council/demo?campaign=demo-new");
  assert.deepEqual(councilDemoReport(restored,now).campaigns.at(-1),{id:"demo-new",name:"New local campaign",referenceCode:"demo-new",channel:"Council campaign",enquiries:0,completedJobs:0,completedValueCents:0});
});

test("corrupted storage, non-demo identity, unsafe logos, malformed campaign data and oversized data are rejected", () => {
  for (const raw of [null,"broken","{}","x".repeat(750001)]) assert.equal(readCouncilDemoState(raw),null);
  const mutations = [
    state=>state.version=2, state=>state.profile.councilId="real-council", state=>state.profile.state="NSW",
    state=>state.profile.logoDataUrl="data:image/svg+xml;base64,PHN2Zz4=", state=>state.profile.theme.accentColor="url(https://example.com)",
    state=>state.profile.postcodes=["2000"], state=>state.profile.updatedAt="bad", state=>state.period="day",
    state=>state.campaigns[0].meetingUrl="javascript:alert(1)",state=>state.campaigns[0].id="../real",
    state=>state.campaigns.push(state.campaigns[0]), state=>state.campaigns[0].status="unknown", state=>state.campaigns=[],state=>state.campaigns.pop(),
  ];
  for (const mutate of mutations) { const state = createCouncilDemoState(now); mutate(state); assert.equal(readCouncilDemoState(JSON.stringify(state)),null); }
});

test("reset produces the original council, palette and coherent default sample", () => {
  const report = councilDemoReport(createCouncilDemoState(now),now);
  assert.equal(report.metrics.completedJobs,1596);
  assert.equal(report.metrics.registeredLocalBusinesses,47);
  assert.equal(report.scope.name,"Greendale Demonstration Council");
  assert.equal(report.mode,"demonstration");
});
