import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {loadCouncilEnquiries} from '../src/lib/council-enquiries-server.ts';
import {reportMidnight} from '../src/lib/trade-business-reports.ts';
const scope={councilId:'c',name:'Council',state:'VIC',postcodes:['3805','3806'],period:'year'};
const now=new Date('2026-10-05T02:00:00Z');
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE trade_opportunities(id TEXT,postcode TEXT,state TEXT,created_at TEXT,is_synthetic INTEGER,source_reference TEXT,created_by_uid TEXT); CREATE TABLE public_trade_lead_contact_releases(opportunity_id TEXT,status TEXT,withdrawn_at TEXT,customer_email TEXT)`);
 const prepare=(query,args=[])=>({bind:(...v)=>prepare(query,v),all:async()=>({results:sql.prepare(query).all(...args)})});
 const add=(id,opts={})=>{const {postcode='3805',state='VIC',date='2026-10-02T02:00:00Z',synthetic=0,status='active',customer=id+'@example.invalid',source='lead-intake'}=opts;sql.prepare('INSERT INTO trade_opportunities VALUES(?,?,?,?,?,?,?)').run(id,postcode,state,date,synthetic,id,source);sql.prepare('INSERT INTO public_trade_lead_contact_releases VALUES(?,?,?,?)').run(id,status,'',customer)};
 return {db:{prepare},add,close:()=>sql.close()};
}
test('community enquiries cover the approved area and exclude synthetic, private and withdrawn records',async()=>{
 const {db,add}=fixture();for(let i=0;i<6;i++)add('a'+i);add('outside',{postcode:'3000'});add('state',{state:'NSW'});add('demo',{synthetic:1});add('private',{source:'trade-owner'});add('withdrawn',{status:'withdrawn'});
 const r=await loadCouncilEnquiries(db,scope,now);assert.equal(r.total,6);assert.deepEqual(r.postcodes,[{postcode:'3805',count:6},{postcode:'3806',count:0}]);assert.equal(JSON.stringify(r).includes('@'),false);
});
test('repeated enquiries from one contact do not establish a safe customer cohort',async()=>{const {db,add}=fixture();for(let i=0;i<8;i++)add('a'+i,{customer:'same@example.invalid'});const r=await loadCouncilEnquiries(db,scope,now);assert.equal(r.total,null);assert.equal(r.suppressed,true)});
test('small postcode and complementary period groups suppress the complete breakdown family',async()=>{const {db,add}=fixture();for(let i=0;i<8;i++)add('a'+i);add('small',{postcode:'3806',date:'2026-08-01T00:00:00Z'});const r=await loadCouncilEnquiries(db,scope,now);assert.equal(r.total,null);assert.ok(r.postcodes.every(r=>r.count===null));assert.deepEqual(r.trend,[])});
test('empty activity returns a genuine zero',async()=>{const {db}=fixture();const r=await loadCouncilEnquiries(db,scope,now);assert.equal(r.total,0);assert.equal(r.suppressed,false)});

test('Victorian month boundaries use local midnight in both daylight and standard time',async()=>{
 for(const [month,boundary,reportDate] of [
  ['2026-04','2026-03-31T13:00:00.000Z','2026-04-06T02:00:00Z'],
  ['2026-10','2026-09-30T14:00:00.000Z','2026-10-05T02:00:00Z'],
 ]){
  const f=fixture();
  try{
   assert.equal(reportMidnight(month+'-01','VIC'),boundary);
   for(let i=0;i<5;i++)f.add('before'+i,{date:new Date(Date.parse(boundary)-1).toISOString()});
   for(let i=0;i<6;i++)f.add('after'+i,{date:boundary});
   const report=await loadCouncilEnquiries(f.db,{...scope,period:'all'},new Date(reportDate));
   assert.equal(report.total,11);assert.equal(report.suppressed,false);
   assert.equal(report.trend.find(row=>row.month===month).count,6);
   assert.equal(report.trend.find(row=>row.month!==month).count,5);
  }finally{f.close()}
 }
});

test('half-hour state offsets and daylight-saving transitions produce nonoverlapping local month windows',async()=>{
 const f=fixture();
 try{
  assert.equal(reportMidnight('2026-04-01','SA'),'2026-03-31T13:30:00.000Z');
  assert.equal(reportMidnight('2026-05-01','SA'),'2026-04-30T14:30:00.000Z');
  for(let i=0;i<5;i++)f.add('march'+i,{state:'SA',date:'2026-03-31T13:29:59.999Z'});
  for(let i=0;i<6;i++)f.add('april-start'+i,{state:'SA',date:'2026-03-31T13:30:00.000Z'});
  for(let i=0;i<5;i++)f.add('april-end'+i,{state:'SA',date:'2026-04-30T14:29:59.999Z'});
  for(let i=0;i<7;i++)f.add('may'+i,{state:'SA',date:'2026-04-30T14:30:00.000Z'});
  const report=await loadCouncilEnquiries(f.db,{...scope,state:'SA',period:'all'},new Date('2026-05-02T02:00:00Z'));
  assert.equal(report.total,23);assert.deepEqual(report.trend,[{month:'2026-03',count:5},{month:'2026-04',count:11},{month:'2026-05',count:7}]);
 }finally{f.close()}
});

test('latest twelve displayed months do not truncate the all-time headline total',async()=>{
 const f=fixture();
 try{
  for(let month=0;month<18;month++)for(let i=0;i<5;i++)f.add(`m${month}-${i}`,{date:new Date(Date.UTC(2025,4+month,15)).toISOString()});
  const report=await loadCouncilEnquiries(f.db,{...scope,period:'all'},new Date('2026-10-30T02:00:00Z'));
  assert.equal(report.total,90);assert.equal(report.trend.length,12);
  assert.equal(report.trend[0].month,'2025-11');assert.equal(report.trend.at(-1).month,'2026-10');
  assert.equal(report.trend.reduce((sum,row)=>sum+row.count,0),60);
 }finally{f.close()}
});

test('the earlier history remainder cannot be recovered as a small cohort by subtracting the visible months',async()=>{
 const f=fixture();
 try{
  f.add('older-person',{date:'2025-10-15T00:00:00Z'});
  for(let i=0;i<5;i++)f.add('last-year-visible'+i,{date:'2025-11-15T00:00:00Z'});
  for(let i=0;i<5;i++)f.add('this-year'+i,{date:'2026-10-02T00:00:00Z'});
  const report=await loadCouncilEnquiries(f.db,{...scope,period:'all'},now);
  assert.equal(report.suppressed,true);assert.equal(report.total,null);assert.deepEqual(report.trend,[]);
  assert.ok(report.postcodes.every(row=>row.count===null));
 }finally{f.close()}
});

test('safe individual month and postcode margins do not expose unsafe postcode/month intersections',async()=>{
 const f=fixture();
 try{
  for(let i=0;i<5;i++)f.add('august-local'+i,{date:'2026-08-15T00:00:00Z',postcode:'3805'});
  f.add('august-small',{date:'2026-08-15T00:00:00Z',postcode:'3806'});
  for(let i=0;i<5;i++)f.add('september-other'+i,{date:'2026-09-15T00:00:00Z',postcode:'3806'});
  f.add('september-small',{date:'2026-09-15T00:00:00Z',postcode:'3805'});
  const report=await loadCouncilEnquiries(f.db,scope,now);
  assert.equal(report.suppressed,true);assert.equal(report.total,null);assert.deepEqual(report.trend,[]);
 }finally{f.close()}
});

test('contact normalization and missing contacts cannot manufacture a safe cohort or escape as personal information',async()=>{
 const f=fixture();
 try{
  for(const [index,customer] of ['same@example.invalid',' SAME@example.invalid ','\tSame@example.invalid\n','same@EXAMPLE.invalid\r','same@example.invalid','same@example.invalid'].entries())f.add('same'+index,{customer});
  const report=await loadCouncilEnquiries(f.db,scope,now);
  assert.equal(report.suppressed,true);assert.equal(JSON.stringify(report).includes('example.invalid'),false);
 }finally{f.close()}
 const missing=fixture();
 try{
  for(let i=0;i<5;i++)missing.add('known'+i);
  missing.add('missing',{customer:'\t\r\n '});
  assert.equal((await loadCouncilEnquiries(missing.db,scope,now)).suppressed,true);
 }finally{missing.close()}
});
