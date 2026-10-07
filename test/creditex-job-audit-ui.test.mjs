import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as audit from '../src/lib/creditex-job-audit.ts';
import * as auditNavigation from '../src/lib/creditex-workspace-navigation.ts';

const source = fs.readFileSync(new URL('../src/components/CreditexJobAuditDesk.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, fn) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, fn)) : [...(fn(node) ? [node] : []), ...nodes(node.props?.children, fn)];
const button = (tree, name) => nodes(tree, n => n.type === 'button' && text(n) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const workspace = () => ({ target: { intentId:'intent-1', jobNumber:'TLJ-TEST', customerName:'Test customer', customerPhone:'+61400000000', siteAddress:'Test site', activityDate:'2026-10-02', activityTitle:'Assessment', assignee:'Technician', addressReviewRequired:true }, sourceSha256:'a'.repeat(64), records:[{kind:'field',id:'form-1',title:'Site assessment',status:'submitted',revision:3,updatedAt:'2026-10-02',answers:[{key:'result',label:'Recorded result',section:'Inspection',value:'Done'}]}], files:[1,2].map(id => ({id:String(id),kind:'field_evidence',parentId:'form-1',label:`Photo ${id}`,previewPath:`/api/creditex/job-audit/file?id=${id}`,contentType:'image/png'})), checklist:null,history:[],requirements:[],findings:[],notifications:[],auditCompleted:false,submissionReady:false,capabilities:{canSave:true,canComplete:true,canRequestCorrection:true,canResolveFindings:true,canCall:true,reason:''} });
function harness(options={}) {
  const slots=[], effects=[], queued=[], callbacks=[], requests=[], revocations=[], dirtyReports=[], sourceViews=[], wattzunRequests=[];
  let cursor=0, closed=0, changes=0, currentProps={user:{uid:'reviewer',getIdToken:async()=> 'fixture'},intentId:'intent-1',actorMode:options.actorMode || 'creditex',onClose:()=>closed++,onChanged:()=>changes++,onDirtyChange:value=>dirtyReports.push(value)};
  const hooks={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial){const i=cursor++;return slots[i] ||= {current:initial};},
    useCallback(fn,deps){const i=cursor++;if(!callbacks[i]||deps.some((dep,index)=>dep!==callbacks[i].deps[index]))callbacks[i]={fn,deps};return callbacks[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((dep,index)=>dep!==effects[i].deps[index])){effects[i]?.cleanup?.();effects[i]={deps};queued.push(()=>{effects[i].cleanup=fn();});}},
  };
  const stubs={CreditexAuditCallPanel:Object.assign(()=>null,{displayName:'CreditexAuditCallPanel'}),CreditexJobLifecycleActions:Object.assign(()=>null,{displayName:'CreditexJobLifecycleActions'})};
  const require=id=>id==='@/lib/creditex-workspace-navigation'?auditNavigation:id==='@/lib/wattzun-appearance'?{requestWattzunAssistant:async request=>{wattzunRequests.push(request);return options.wattzunOpened!==false;}}:id==='next/image'?{default:'img'}:id==='react'?hooks:id==='react/jsx-runtime'?jsx:id==='@/lib/creditex-job-audit'?audit:id.endsWith('.module.css')?{default:new Proxy({},{get:(_,key)=>key})}:stubs;
  const fetch=async(path,init={})=>{requests.push({path,init});if(options.fetch)return options.fetch(path,init);return path.includes('/file?')?new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:workspace()});};
  const window={location:{search:options.search||'',hash:options.hash||''},requestAnimationFrame(callback){callback();return 1;},cancelAnimationFrame(){},addEventListener(){},removeEventListener(){},setTimeout(){return 1;},clearTimeout(){},confirm:()=>options.confirm!==false};
  const document={getElementById:id=>{sourceViews.push(id);return {scrollIntoView(){},focus(){},closest:()=>null};}};
  const exports={};Function('require','exports','window','fetch','URL','crypto','document',code)(require,exports,window,fetch,{createObjectURL:()=>`blob:fixture-${requests.length}`,revokeObjectURL:url=>revocations.push(url)},{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},document);
  const render=()=>{cursor=0;const tree=exports.CreditexJobAuditDesk(currentProps);for(const effect of queued.splice(0))effect();return tree;};
  const settle=async()=>{render();await flush();render();await flush();return render();};
  return {render,settle,requests,revocations,dirtyReports,sourceViews,wattzunRequests,get closed(){return closed;},get changes(){return changes;},props:next=>{currentProps={...currentProps,...next};},cleanup(){for(const effect of effects)effect?.cleanup?.();}};
}

test('Ask Wattzun passes only the selected audit reference and exactly one current authorised scope', async () => {
  const h = harness({ fetch: async path => path.includes('/wattzun/portal?')
    ? Response.json({ scopes: [{ portal: 'creditex', scopeId: 'synthetic-creditex' }] })
    : path.includes('/file?') ? new Response('photo', { headers: { 'Content-Type': 'image/png' } }) : Response.json({ ok: true, workspace: workspace() }) });
  let tree = await h.settle(); button(tree, 'Ask Wattzun about this audit').props.onClick(); tree = await h.settle();
  assert.deepEqual(h.wattzunRequests, [{ userUid: 'reviewer', portal: 'creditex', scopeId: 'synthetic-creditex', mode: 'message',
    workReference: { kind: 'creditex_audit', recordId: 'intent-1' }, initialMessage: 'Summarise this audit, supported gaps and the next review steps.' }]);
  assert.ok(h.requests.every(request => !request.init.method)); assert.equal(h.changes, 0); assert.equal(h.closed, 0);
  assert.doesNotMatch(JSON.stringify(h.wattzunRequests), /Test customer|Test site|sourceSha256|040000/); h.cleanup();
});

test('Ask Wattzun preserves the audit and exposes a retry for ambiguous scope, denied scope or unavailable assistant', async () => {
  for (const response of [() => Response.json({ scopes: [] }), () => Response.json({ scopes: [{ portal: 'creditex', scopeId: 'a' }, { portal: 'creditex', scopeId: 'b' }] }),
    () => Response.json({ scopes: [{ portal: 'council', scopeId: 'a' }] }), () => Response.json({ error: 'Denied' }, { status: 403 })]) {
    const h = harness({ fetch: async path => path.includes('/wattzun/portal?') ? response()
      : path.includes('/file?') ? new Response('photo', { headers: { 'Content-Type': 'image/png' } }) : Response.json({ ok: true, workspace: workspace() }) });
    let tree = await h.settle(); button(tree, 'Ask Wattzun about this audit').props.onClick(); tree = await h.settle();
    assert.equal(h.wattzunRequests.length, 0); assert.match(text(tree), /Reopen your Creditex workspace/);
    assert.equal(button(tree, 'Save draft').props.disabled, false); assert.equal(h.closed, 0); h.cleanup();
  }
  const h = harness({ wattzunOpened: false, fetch: async path => path.includes('/wattzun/portal?') ? Response.json({ scopes: [{ portal: 'creditex', scopeId: 'a' }] })
    : path.includes('/file?') ? new Response('photo', { headers: { 'Content-Type': 'image/png' } }) : Response.json({ ok: true, workspace: workspace() }) });
  let tree = await h.settle(); button(tree, 'Ask Wattzun about this audit').props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Wattzun could not open/); assert.equal(h.closed, 0); h.cleanup();
});

test('Ask Wattzun is unavailable to admin-mode and view-only audits', async () => {
  const admin = harness({ actorMode: 'admin' }); assert.equal(button(await admin.settle(), 'Ask Wattzun about this audit'), undefined); admin.cleanup();
  const denied = workspace(); denied.capabilities.canSave = false;
  const view = harness({ fetch: async path => path.includes('/file?') ? new Response('photo', { headers: { 'Content-Type': 'image/png' } }) : Response.json({ ok: true, workspace: denied }) });
  assert.equal(button(await view.settle(), 'Ask Wattzun about this audit'), undefined); view.cleanup();
});

test('exact audit source navigation focuses only a verified panel on the currently loaded audit', async () => {
  const linked = harness({ search: '?workspace=cases&intentId=intent-1', hash: '#audit-records' });
  await linked.settle(); assert.ok(linked.sourceViews.includes('audit-records')); linked.cleanup();
  for (const options of [{ search: '?workspace=cases&intentId=other', hash: '#audit-records' },
    { search: '?workspace=cases&intentId=intent-1', hash: '#foreign-private-element' },
    { search: '?workspace=cases&intentId=intent-1', hash: '#audit-files', actorMode: 'admin' }]) {
    const h = harness(options); await h.settle(); assert.equal(h.sourceViews.length, 0); h.cleanup();
  }
});

test('a late scope response cannot open Wattzun for an audit the user has left', async () => {
  let complete;
  const h = harness({ fetch: async path => path.includes('/wattzun/portal?') ? new Promise(resolve => { complete = resolve; })
    : path.includes('/file?') ? new Response('photo', { headers: { 'Content-Type': 'image/png' } }) : Response.json({ ok: true, workspace: workspace() }) });
  let tree = await h.settle(); button(tree, 'Ask Wattzun about this audit').props.onClick(); await h.settle();
  h.props({ intentId: 'another-audit' }); await h.settle();
  complete(Response.json({ scopes: [{ portal: 'creditex', scopeId: 'synthetic-creditex' }] })); tree = await h.settle();
  assert.equal(h.wattzunRequests.length, 0); assert.equal(button(tree, 'Ask Wattzun about this audit').props.disabled, false); h.cleanup();
});

test('audit opens through authenticated read only requests and previews next/previous private files', async()=>{
  const h=harness();let tree=await h.settle();
  assert.match(text(tree),/TLJ-TEST/);assert.match(text(tree),/Manual address/);
  assert.equal(button(tree,'Previous').props.disabled,true);assert.equal(button(tree,'Next').props.disabled,false);
  assert.ok(h.requests.every(request=>request.init.headers.Authorization==='Bearer fixture'));
  assert.ok(h.requests.every(request=>!request.init.method));
  button(tree,'Next').props.onClick();tree=await h.settle();
  assert.match(h.requests.at(-1).path,/id=2$/);assert.equal(button(tree,'Next').props.disabled,true);assert.equal(h.revocations.length,1);
  button(tree,'Previous').props.onClick();tree=await h.settle();assert.equal(button(tree,'Previous').props.disabled,true);h.cleanup();assert.equal(h.revocations.length,3);
});

test('completion requires every check and an explicit call result; correction requires notes',async()=>{
  const h=harness();let tree=await h.settle();assert.equal(button(tree,'Mark audited').props.disabled,true);assert.equal(button(tree,'Correction required').props.disabled,true);
  for(const radio of nodes(tree,n=>n.type==='input'&&n.props.value==='yes'))radio.props.onChange();tree=h.render();
  assert.equal(button(tree,'Mark audited').props.disabled,true);
  const call=nodes(tree,n=>n.type==='select'&&n.props.value==='unavailable')[0];call.props.onChange({target:{value:'completed'}});tree=h.render();assert.equal(button(tree,'Mark audited').props.disabled,false);
  const note=nodes(tree,n=>n.type==='textarea')[0];note.props.onChange({target:{value:'Correct the installation date.'}});tree=h.render();assert.equal(button(tree,'Correction required').props.disabled,false);assert.equal(h.dirtyReports.at(-1),true);
  button(tree,'Save draft').props.onClick();tree=await h.settle();const post=h.requests.find(request=>request.init.method==='POST');assert.ok(post);const body=JSON.parse(post.init.body);assert.equal(body.action,'save');assert.equal(body.expectedSourceSha256,'a'.repeat(64));assert.equal(body.expectedAuditRevision,0);assert.equal(body.answers.workConfirmed,'yes');assert.equal(h.changes,1);h.cleanup();
});

test('unsaved audit cannot be abandoned when the reviewer cancels confirmation',async()=>{
  const h=harness({confirm:false});let tree=await h.settle();nodes(tree,n=>n.type==='input'&&n.props.value==='yes')[0].props.onChange();tree=h.render();button(tree,'Back to jobs').props.onClick();assert.equal(h.closed,0);h.cleanup();assert.equal(h.dirtyReports.at(-1),false);
});

test('an obsolete file response is ignored after switching previews',async()=>{
  let resolveFirst;const h=harness({fetch:async(path)=>path.includes('/file?') ? path.endsWith('1')?new Promise(resolve=>{resolveFirst=resolve;}):new Response('second',{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:workspace()})});
  let tree=await h.settle();button(tree,'Next').props.onClick();tree=await h.settle();const selected=nodes(tree,n=>n.type==='img')[0].props.src;
  resolveFirst(new Response('first',{headers:{'Content-Type':'image/png'}}));tree=await h.settle();assert.equal(nodes(tree,n=>n.type==='img')[0].props.src,selected);h.cleanup();
});

test('access failures expose a retry without rendering unavailable answers or files',async()=>{
  const h=harness({fetch:async()=>Response.json({ok:false,error:'This job is no longer assigned to you.'},{status:404})});const tree=await h.settle();assert.match(text(tree),/no longer assigned/);assert.equal(button(tree,'Mark audited'),undefined);assert.equal(nodes(tree,n=>n.type==='img').length,0);h.cleanup();
});

test('admin requests use admin authority and never mount the Creditex-only call panel',async()=>{
  const h=harness({actorMode:'admin'});const tree=await h.settle();assert.match(h.requests[0].path,/actorMode=admin/);assert.equal(button(tree,'Call customer'),undefined);assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexAuditCallPanel').length,0);h.cleanup();
});

test('audit calling controls follow the server customer permission', async () => {
  const denied = workspace(); denied.capabilities.canCall = false;
  const h = harness({ fetch: async path => path.includes('/file?') ? new Response('photo', { headers: { 'Content-Type': 'image/png' } }) : Response.json({ ok: true, workspace: denied }) });
  const tree = await h.settle(); assert.equal(button(tree, 'Call customer'), undefined);
  assert.equal(nodes(tree, node => node.type?.displayName === 'CreditexAuditCallPanel').length, 0); h.cleanup();
});

test('HTML or SVG attachments are never executed by the inline preview',async()=>{
  const h=harness({fetch:async path=>path.includes('/file?')?new Response('<svg onload="alert(1)"/>',{headers:{'Content-Type':'image/svg+xml'}}):Response.json({ok:true,workspace:workspace()})});const tree=await h.settle();assert.match(text(tree),/Preview is unavailable/);assert.equal(nodes(tree,n=>n.type==='iframe'||n.type==='img').length,0);h.cleanup();
});

test('saved call association is preserved and cannot be changed during a pending save',async()=>{
  const saved=workspace();saved.checklist={revision:2,callId:'call-saved',callOutcome:'completed',answers:audit.emptyCreditexJobAuditAnswers(),sourceSha256:saved.sourceSha256};
  let finishSave;
  const h=harness({fetch:async(path,init)=>init.method==='POST'?new Promise(resolve=>{finishSave=resolve;}):path.includes('/file?')?new Response('photo',{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:saved})});
  let tree=await h.settle();button(tree,'Call customer').props.onClick();tree=h.render();
  let panel=nodes(tree,n=>n.type?.displayName==='CreditexAuditCallPanel')[0];assert.equal(panel.props.selectedCallId,'call-saved');
  panel.props.onCallSelected('call-new');tree=h.render();assert.match(text(tree),/Save your audit answers before managing/);
  assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexJobLifecycleActions').length,0);
  button(tree,'Save draft').props.onClick();tree=await h.settle();
  assert.equal(JSON.parse(h.requests.find(request=>request.init.method==='POST').init.body).callId,'call-new');
  panel=nodes(tree,n=>n.type?.displayName==='CreditexAuditCallPanel')[0];assert.equal(panel.props.onCallSelected,undefined);
  finishSave(Response.json({ok:true,workspace:saved}));tree=await h.settle();
  assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexJobLifecycleActions').length,1);h.cleanup();
});

test('restricted evidence is described without attempting a private file request',async()=>{
  const restricted=workspace();restricted.files[0].unavailableReason='Your role cannot preview this evidence.';
  const h=harness({fetch:async()=>Response.json({ok:true,workspace:restricted})});const tree=await h.settle();
  assert.match(text(tree),/Your role cannot preview/);assert.equal(h.requests.filter(request=>request.path.includes('/file?')).length,0);
  assert.equal(nodes(tree,n=>n.type==='img'||n.type==='iframe').length,0);h.cleanup();
});

test('the single correction action includes the selected file identity and preserves actionable delivery failures',async()=>{
  const current=workspace(); current.notifications=[{id:'delivery',status:'failed',recipient:'technician@example.test',error:'Email was not accepted.'}];
  const h=harness({fetch:async path=>path.includes('/file?')?new Response('photo',{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:current})});
  let tree=await h.settle(); button(tree,'Use this file in correction').props.onClick();
  nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'Retake the equipment label in focus.'}}); tree=h.render();
  button(tree,'Correction required').props.onClick(); tree=await h.settle();
  const body=JSON.parse(h.requests.find(request=>request.init.method==='POST').init.body);
  assert.deepEqual(body.correction,{file:{kind:'field_evidence',id:'1',parentId:'form-1'}});
  assert.equal(body.note,'Retake the equipment label in focus.'); assert.doesNotMatch(JSON.stringify(body),/blob:|objectKey/);
  assert.match(text(tree),/Email was not accepted/); assert.match(text(tree),/Job management below to review or retry/); h.cleanup();
});

test('finding closeout shows original and current replacement, sends source guard and preserves unsaved checklist edits',async()=>{
  const current=workspace(); current.findings=[{id:'finding',evidenceId:'original',requirementId:'requirement',evidenceLabel:'Original label.jpg',requirementTitle:'Equipment label',status:'open',description:'Label is unreadable.',raisedAt:'2026-10-04'}];
  current.files=[{id:'original',kind:'case_evidence',parentId:'case',label:'Original label.jpg',previewPath:'/api/creditex/job-audit/file?id=original',requirementId:'requirement',evidenceStatus:'superseded'},
    {id:'replacement',kind:'case_evidence',parentId:'case',label:'Replacement label.jpg',previewPath:'/api/creditex/job-audit/file?id=replacement',requirementId:'requirement',evidenceStatus:'received'},
    {id:'other',kind:'case_evidence',parentId:'case',label:'Different requirement.jpg',requirementId:'other',evidenceStatus:'received',previewPath:'/api/creditex/job-audit/file?id=other'}];
  current.capabilities.canComplete=false;
  const h=harness({fetch:async(path,init)=>{
    if(path.includes('/file?'))return new Response('photo',{headers:{'Content-Type':'image/png'}});
    if(init.method==='POST'){const next=structuredClone(current);next.findings[0].status='resolved';next.findings[0].resolutionNote='Read the replacement label.';next.findings[0].reviewedEvidenceLabel='Replacement label.jpg';next.sourceSha256='b'.repeat(64);return Response.json({ok:true,workspace:next});}
    return Response.json({ok:true,workspace:current});
  }});
  let tree=await h.settle(); nodes(tree,n=>n.type==='input'&&n.props.value==='yes')[0].props.onChange(); tree=h.render();
  assert.equal(button(tree,'Mark audited').props.disabled,true); button(tree,'Review correction').props.onClick(); tree=h.render();
  const evidenceSelect=nodes(nodes(tree,n=>n.type==='label'&&text(n).startsWith('Evidence checked'))[0],n=>n.type==='select')[0];
  assert.deepEqual(nodes(evidenceSelect,n=>n.type==='option').map(n=>n.props.value),['','replacement']);
  evidenceSelect.props.onChange({target:{value:'replacement'}});
  nodes(nodes(tree,n=>n.type==='label'&&text(n).startsWith('How was this resolved?'))[0],n=>n.type==='textarea')[0].props.onChange({target:{value:'Read the replacement label.'}});
  tree=h.render(); button(tree,'View selected evidence').props.onClick(); tree=await h.settle(); assert.match(h.requests.at(-1).path,/id=replacement$/);
  button(tree,'Close correction').props.onClick(); tree=await h.settle();
  const body=JSON.parse(h.requests.find(request=>request.init.method==='POST').init.body);
  assert.equal(body.action,'resolve_finding'); assert.equal(body.findingId,'finding'); assert.equal(body.reviewedEvidenceId,'replacement'); assert.equal(body.expectedSourceSha256,'a'.repeat(64));
  assert.equal(nodes(tree,n=>n.type==='input'&&n.props.value==='yes')[0].props.checked,true); assert.equal(h.dirtyReports.at(-1),true);
  assert.match(text(tree),/Evidence reviewed:\s+Replacement label.jpg/); assert.match(text(tree),/Submission approval remains separate/); h.cleanup();
});

test('view-only users cannot open finding closeout or choose correction targets',async()=>{
  const current=workspace(); current.capabilities.canResolveFindings=false;current.capabilities.canRequestCorrection=false;
  current.findings=[{id:'finding',status:'open',description:'Missing evidence.',raisedAt:'2026-10-04'}];
  const h=harness({fetch:async path=>path.includes('/file?')?new Response('photo',{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:current})});const tree=await h.settle();
  assert.equal(button(tree,'Review correction'),undefined);assert.equal(button(tree,'Use this file in correction'),undefined);
  assert.equal(nodes(tree,n=>n.type==='label'&&text(n).startsWith('Correction relates to')).length,0);h.cleanup();
});

test('optional AI shows its file-content limitation, opens cited records and copies wording only to an unsent correction draft',async()=>{
  const review={sourceSha256:'a'.repeat(64),summary:'Check the recorded date.',items:[{kind:'contradiction',detail:'The dates differ.',suggestedCorrection:'Confirm the activity date.',sources:[{id:'record-1-answer-1',kind:'record',label:'Recorded result',recordId:'form-1',recordKind:'field'}]}]};
  const h=harness({fetch:async path=>path.includes('/job-audit/ai?')?Response.json({ok:true,review}):path.includes('/file?')?new Response('photo',{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:workspace()})});
  let tree=await h.settle();assert.match(text(tree),/AI does not inspect photos, PDFs, signatures or call recordings/);
  button(tree,'Review with AI').props.onClick();tree=await h.settle();const request=h.requests.find(request=>request.path.includes('/job-audit/ai?'));
  assert.equal(request.init.headers.Authorization,'Bearer fixture');assert.equal(JSON.parse(request.init.body).expectedSourceSha256,'a'.repeat(64));
  nodes(tree,n=>n.type==='button'&&/View\s+Recorded result/.test(text(n)))[0].props.onClick();assert.deepEqual(h.sourceViews,['audit-records']);
  button(tree,'Use wording in correction note').props.onClick();tree=h.render();assert.equal(nodes(tree,n=>n.type==='textarea')[0].props.value,'Confirm the activity date.');
  assert.equal(h.requests.filter(request=>request.init.method==='POST').length,1);assert.equal(button(tree,'Mark audited').props.disabled,true);
  assert.match(text(tree),/Nothing has been approved, closed or sent/);h.cleanup();
});

test('stale AI suggestions are hidden and unavailable AI leaves manual review available',async()=>{
  for(const response of [Response.json({ok:true,review:{sourceSha256:'b'.repeat(64),summary:'Stale suggestion',items:[]}}),Response.json({ok:false,error:'AI assistance is unavailable.'},{status:503})]) {
    const h=harness({fetch:async path=>path.includes('/job-audit/ai?')?response:path.includes('/file?')?new Response('photo',{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:workspace()})});
    let tree=await h.settle();button(tree,'Review with AI').props.onClick();tree=await h.settle();
    assert.doesNotMatch(text(tree),/Stale suggestion/);assert.match(text(tree),/Run AI pre-review again|AI assistance is unavailable/);assert.equal(button(tree,'Save draft').props.disabled,false);h.cleanup();
  }
});
