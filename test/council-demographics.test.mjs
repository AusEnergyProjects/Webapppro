import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { censusTable, demographicRow } from "../scripts/import-council-demographics.mjs";
import { parseCouncilDemographics, loadCouncilDemographics, councilDemographicValue, councilDemographicComparison } from "../src/lib/council-demographics.ts";

const bytes=readFileSync(new URL("../public/data/council-demographics/abs-2021.json",import.meta.url));
const source=JSON.parse(bytes);
const manifest=JSON.parse(readFileSync(new URL("../public/data/council-demographics/manifest.json",import.meta.url),"utf8"));

test("ABS snapshot covers 2,641 spatial postal areas and nine state benchmarks with exact provenance",()=>{
  const parsed=parseCouncilDemographics(source);
  assert.equal(parsed.rows.length,2641);assert.equal(parsed.states.length,9);
  assert.ok(parsed.rows.some(row=>row.code==="0800"),"Leading zero postal codes survive import");
  for(const code of ["9494","9797","ZZZZ"])assert.ok(!parsed.rows.some(row=>row.code===code));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),manifest.file.sha256);
  assert.equal(bytes.length,manifest.file.bytes);
  assert.deepEqual(manifest.sources.map(source=>source.sha256),["ccca4c72ee769d81c13dd6cfaedff7df58819267384195118f3d3b87d6c64008","6267d16c87dec940a35a4b9c8f65e42d7962027bf7c5767718b5a295c6514d7a"]);
  for(const capture of manifest.sources){assert.match(capture.url,/^https:\/\/www.abs.gov.au\/census\/find-census-data\/datapacks\/download\//);assert.equal(capture.tables.length,3);}
});

test("sample import reconciles to ABS QuickStats 3805 and Victorian state values",()=>{
  const parsed=parseCouncilDemographics(source);
  assert.deepEqual(parsed.rows.find(row=>row.code==="3805"),{code:"3805",population:58600,medianAge:35,aged65PlusPercent:10.5,medianWeeklyHouseholdIncome:1942,renterPercent:22.6,ownerOccupierPercent:75.2,separateHousePercent:92.3,apartmentPercent:1.3,occupiedPrivateDwellings:17929,averageHouseholdSize:3.1});
  const state=parsed.states.find(row=>row.code==="VIC");
  assert.equal(state.medianWeeklyHouseholdIncome,1759);assert.equal(state.renterPercent,28.5);assert.equal(state.population,6503491);
});

function values(){return [{Tot_P_P:100,Age_65_74_yr_P:10,Age_75_84_yr_P:5,Age_85ov_P:2},{Median_age_persons:40,Median_tot_hhd_inc_weekly:1500,Average_household_size:2.5},{Total_Total:50,R_Tot_Total:15,O_OR_Total:10,O_MTG_Total:20,Total_DS_Sep_house:40,Total_DS_Flat_apart:5}];}
test("import uses explicit denominators, retains known zero and declines missing or inconsistent ratios",()=>{
  const [people,medians,homes]=values();
  assert.equal(demographicRow("3805",people,medians,homes).aged65PlusPercent,17);
  assert.equal(demographicRow("3805",people,medians,homes).ownerOccupierPercent,60);
  assert.equal(demographicRow("3805",people,medians,{...homes,R_Tot_Total:0}).renterPercent,0);
  for(const denominator of [0,null])assert.equal(demographicRow("3805",people,medians,{...homes,Total_Total:denominator}).renterPercent,null);
  assert.equal(demographicRow("3805",people,medians,{...homes,R_Tot_Total:null}).renterPercent,null);
  assert.equal(demographicRow("3805",people,medians,{...homes,R_Tot_Total:51}).renterPercent,null);
  const zero=demographicRow("3805",{...people,Tot_P_P:0},{...medians,Median_age_persons:0},{...homes,Total_Total:0});
  assert.equal(zero.population,0);assert.equal(zero.occupiedPrivateDwellings,0);assert.equal(zero.aged65PlusPercent,null);assert.equal(zero.medianAge,null);
  assert.throws(()=>demographicRow("3805",people,{},homes),/Missing Census column/);
});

test("CSV importer rejects shifted columns, duplicates, nonnumeric values and wrong geography",()=>{
  assert.deepEqual([...censusTable("POA_CODE_2021,Tot_P_P\nPOA0800,3000\nPOA0001,\n","POA")],[ ["POA0800",{Tot_P_P:3000}], ["POA0001",{Tot_P_P:null}] ]);
  for(const csv of ["WRONG,Tot_P_P\nPOA0800,1","POA_CODE_2021,Tot_P_P\nPOA0800,1\nPOA0800,2","POA_CODE_2021,Tot_P_P\nPOA0800,abc","POA_CODE_2021,Tot_P_P\nPOA0800,1,2"])assert.throws(()=>censusTable(csv,"POA"));
});

test("snapshot boundary rejects unsupported years, duplicates, nonfinite and invalid shares",()=>{
  const row=source.rows[0],valid={version:1,censusDate:"2021-08-10",rows:[row],states:[]};
  assert.throws(()=>parseCouncilDemographics({...valid,censusDate:"2026-08-11"}));
  assert.throws(()=>parseCouncilDemographics({...valid,rows:[row,row]}));
  for(const value of [NaN,Infinity,-1,101,"20",undefined])assert.throws(()=>parseCouncilDemographics({...valid,rows:[{...row,renterPercent:value}]}));
  assert.throws(()=>parseCouncilDemographics({...valid,rows:[{...row,code:"9494"}]}));
  assert.throws(()=>parseCouncilDemographics({...valid,states:[{...row,code:"other"}]}));
  assert.equal(parseCouncilDemographics({...valid,rows:[{...row,population:0,renterPercent:0}]}).rows[0].renterPercent,0);
});

test("loader returns only requested postcodes, reports absence and forwards cancellation",async t=>{
  const controller=new AbortController();let calls=0;
  t.mock.method(globalThis,"fetch",async(url,options)=>{calls++;assert.equal(url,"/data/council-demographics/abs-2021.json");assert.equal(options.signal,controller.signal);return new Response(bytes);});
  const result=await loadCouncilDemographics(["3805","9999","3805"],controller.signal);
  assert.deepEqual(result.rows.map(row=>row.code),["3805"]);assert.deepEqual(result.missingPostcodes,["9999"]);assert.equal(result.states.length,9);
  assert.deepEqual(await loadCouncilDemographics([]),{rows:[],states:[],missingPostcodes:[]});assert.equal(calls,1);
  await assert.rejects(loadCouncilDemographics(["../3805"]),/Invalid Census postcode/);
});

test("loader never converts an unavailable source into an empty successful profile",async t=>{
  t.mock.method(globalThis,"fetch",async()=>new Response("",{status:503}));
  await assert.rejects(loadCouncilDemographics(["3805"]),/could not be loaded/);
});

test("comparison uses percentage points, handles absence and preserves real zero",()=>{
  assert.equal(councilDemographicComparison(22.6,28.5,"percent"),"5.9 percentage points below state");
  assert.equal(councilDemographicComparison(1942,1759,"money"),"$183 above state");
  assert.equal(councilDemographicComparison(null,28.5,"percent"),null);
  assert.equal(councilDemographicValue(0,"percent"),"0%");assert.equal(councilDemographicValue(null,"percent"),"Not available");
  assert.equal(councilDemographicComparison(0,0,"number"),"Same as state");
});
