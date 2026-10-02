import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as audit from '../src/lib/creditex-job-audit.ts';

const source = fs.readFileSync(new URL('../src/components/CreditexJobAuditDesk.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, fn) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, fn)) : [...(fn(node) ? [node] : []), ...nodes(node.props?.children, fn)];
const button = (tree, name) => nodes(tree, n => n.type === 'button' && text(n) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const workspace = () => ({ target: { intentId:'intent-1', jobNumber:'TLJ-TEST', customerName:'Test customer', customerPhone:'+61400000000', siteAddress:'Test site', activityDate:'2026-10-02', activityTitle:'Assessment', assignee:'Technician', addressReviewRequired:true }, sourceSha256:'a'.repeat(64), records:[{kind:'field',id:'form-1',title:'Site assessment',status:'submitted',revision:3,updatedAt:'2026-10-02',answers:[{key:'result',label:'Recorded result',section:'Inspection',value:'Done'}]}], files:[1,2].map(id => ({id:String(id),kind:'field_evidence',parentId:'form-1',label:`Photo ${id}`,previewPath:`/api/creditex/job-audit/file?id=${id}`,contentType:'image/png'})), checklist:null,history:[],auditCompleted:false,submissionReady:false,capabilities:{canSave:true,canComplete:true,canRequestCorrection:true,reason:''} });
function harness(options={}) {
  const slots=[], effects=[], queued=[], callbacks=[], requests=[], revocations=[], dirtyReports=[];
  let cursor=0, closed=0, changes=0, currentProps={user:{uid:'reviewer',getIdToken:async()=> 'fixture'},intentId:'intent-1',actorMode:options.actorMode || 'creditex',onClose:()=>closed++,onChanged:()=>changes++,onDirtyChange:value=>dirtyReports.push(value)};
  const hooks={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial){const i=cursor++;return slots[i] ||= {current:initial};},
    useCallback(fn,deps){const i=cursor++;if(!callbacks[i]||deps.some((dep,index)=>dep!==callbacks[i].deps[index]))callbacks[i]={fn,deps};return callbacks[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((dep,index)=>dep!==effects[i].deps[index])){effects[i]?.cleanup?.();effects[i]={deps};queued.push(()=>{effects[i].cleanup=fn();});}},
  };
  const stubs={CreditexAuditCallPanel:Object.assign(()=>null,{displayName:'CreditexAuditCallPanel'}),CreditexJobLifecycleActions:Object.assign(()=>null,{displayName:'CreditexJobLifecycleActions'})};
  const require=id=>id==='next/image'?{default:'img'}:id==='react'?hooks:id==='react/jsx-runtime'?jsx:id==='@/lib/creditex-job-audit'?audit:id.endsWith('.module.css')?{default:new Proxy({},{get:(_,key)=>key})}:stubs;
  const fetch=async(path,init={})=>{requests.push({path,init});if(options.fetch)return options.fetch(path,init);return path.includes('/file?')?new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}):Response.json({ok:true,workspace:workspace()});};
  const window={addEventListener(){},removeEventListener(){},setTimeout(){return 1;},clearTimeout(){},confirm:()=>options.confirm!==false};
  const exports={};Function('require','exports','window','fetch','URL','crypto',code)(require,exports,window,fetch,{createObjectURL:()=>`blob:fixture-${requests.length}`,revokeObjectURL:url=>revocations.push(url)},{randomUUID:()=> '00000000-0000-4000-8000-000000000001'});
  const render=()=>{cursor=0;const tree=exports.CreditexJobAuditDesk(currentProps);for(const effect of queued.splice(0))effect();return tree;};
  const settle=async()=>{render();await flush();render();await flush();return render();};
  return {render,settle,requests,revocations,dirtyReports,get closed(){return closed;},get changes(){return changes;},props:next=>{currentProps={...currentProps,...next};},cleanup(){for(const effect of effects)effect?.cleanup?.();}};
}

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
