import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as catalogue from '../src/lib/australian-government-program-catalogue.ts';
const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child,predicate)) : [...(predicate(node) ? [node] : []),...nodes(node.props?.children,predicate)];
const normalize = value => value.replace(/\s+/g, ' ').trim();
const button = (tree, label) => nodes(tree, n => n.type === 'button' && normalize(text(n)) === normalize(label))[0];
const field = (tree, label) => nodes(tree, n => n.props?.['aria-label'] === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const user = { uid: 'reviewer-1', getIdToken: async () => 'test-token' };
const job = (id,name) => ({ id, jobId:id, jobNumber:id.toUpperCase(),jobTitle:'Heat pump upgrade',customerName:name,customerPhone:'+61400000001',customerEmail:'customer@example.invalid',jobStage:'scheduled',jobPriority:'standard',plannedStart:'2026-09-22T09:00:00Z',updatedAt:'2026-09-21T09:00:00Z',planningCurrent:true,status:'planned',programCode:'VEU',activityKey:'hot-water',activityTitle:'Hot water',installerBusiness:'Example Trade',quotedValueCents:10000,invoicedValueCents:0,quoteStatus:'accepted',invoiceStatus:'not_started' });
const jobs=[job('job-1','Alex Example'),job('job-2','Sam Sample')];
const audit = item => ({ ok:true,customer:{ phone:item.customerPhone },groups:[], serviceSiteAddressProvenance:{entryMode:'manual',provider:'',providerReference:'',formattedAddress:'Test site',verifiedAt:'',status:'manual_review_required',reviewRequired:true} });
function runtime(name, props={}, options={}) {
  const slots=[], effects=[], callbacks=[], queued=[], timers=new Map(), requests=[];
  let cursor=0,stateOrdinal=0,timerId=0;
  const hooks={
    useState(initial) { const i=cursor++, ordinal=stateOrdinal++; if(!(i in slots))slots[i]=ordinal in (options.seed||{}) ? options.seed[ordinal] : typeof initial==='function'?initial():initial; return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}]; },
    useRef(initial){ const i=cursor++; if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useCallback(callback,deps){const i=cursor++;if(!callbacks[i]||deps.some((x,j)=>x!==callbacks[i].deps[j]))callbacks[i]={callback,deps};return callbacks[i].callback;},
    useMemo(callback){cursor++;return callback();},
    useEffect(callback,deps){const i=cursor++; if(options.noEffects)return; if(!effects[i]||deps.some((x,j)=>x!==effects[i].deps[j])){effects[i]?.cleanup?.();effects[i]={deps};queued.push(()=>{effects[i].cleanup=callback();});}},
  };
  const stubs=new Map();
  const rowActions={};
  const require=id=>id==='react'?hooks:id==='react/jsx-runtime'?jsx:id==='./JobRowActions'?rowActions:id==='@/lib/australian-government-program-catalogue'?catalogue:id==='@/lib/firebase-client'?{firebaseAuth:{currentUser:user}}:id==='next/dynamic'?{default:()=>()=>null}:id.endsWith('.module.css')?{default:new Proxy({},{get:(_,key)=>String(key)})}:new Proxy({},{get:(_,key)=>{const name=key==='default'?id.split('/').pop():String(key);if(!stubs.has(name))stubs.set(name,Object.defineProperty(()=>null,'displayName',{value:name}));return stubs.get(name);}});
  Function('require','exports',compile('JobRowActions'))(require,rowActions);
  const api=async(path)=>{requests.push(path);if(options.api)return options.api(path);return path.includes('?')?{ok:true,items:jobs,total:150,totalPages:2,page:Number(new URL(path,'https://test.invalid').searchParams.get('page'))}:audit(jobs.find(item=>path.endsWith(item.id)));};
  const window={setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(callback){callback();},confirm:()=>options.confirm!==false};
  const exports={}; Function('require','exports','window','document',compile(name))(require,exports,window,{getElementById:()=>({focus(){}})});
  const render=()=>{cursor=0;stateOrdinal=0;const tree=exports[name]({...props,...(name==='CreditexPlannedIntakeQueue'?{api}:{})});for(const effect of queued.splice(0))effect();return tree;};
  const settle=async()=>{render();for(const [id,callback] of [...timers]){timers.delete(id);callback();}await flush();return render();};
  return {render,settle,requests,stubs,async mount(){return settle();},cleanup(){for(const effect of effects)effect?.cleanup?.();}};
}

test('column filters request the full authorised dataset and reset pagination',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();button(tree,'Next').props.onClick();tree=await h.settle();assert.match(h.requests.at(-1),/page=2/);
  button(tree,'Filters').props.onClick();tree=h.render();field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=await h.settle();
  let query=new URL(h.requests.at(-1),'https://test.invalid').searchParams;assert.equal(query.get('page'),'1');assert.equal(query.get('customer'),'Alex');
  field(tree,'Filter installer').props.onChange({target:{value:'Trade'}});tree=await h.settle();query=new URL(h.requests.at(-1),'https://test.invalid').searchParams;assert.equal(query.get('customer'),'Alex');assert.equal(query.get('installer'),'Trade');
  button(tree,'Reset filters & sort').props.onClick();await h.settle();query=new URL(h.requests.at(-1),'https://test.invalid').searchParams;assert.equal(query.has('customer'),false);assert.equal(query.has('installer'),false);h.cleanup();
});

test('column sorting uses API direction and exposes the actual selected sort',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();button(tree,'Customer ↕').props.onClick();tree=await h.settle();
  assert.match(h.requests.at(-1),/sort=customerName/);assert.match(h.requests.at(-1),/sortDirection=asc/);
  assert.equal(nodes(tree,n=>n.type==='th'&&normalize(text(n))==='Customer ↑')[0].props['aria-sort'],'ascending');
  button(tree,'Customer ↑').props.onClick();tree=await h.settle();assert.match(h.requests.at(-1),/sortDirection=desc/);assert.ok(button(tree,'Customer ↓'));h.cleanup();
});

test('filter controls remain usable when no rows match or a filter is rejected',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async path=>new URL(path,'https://test.invalid').searchParams.has('customer')?{ok:false,error:'Invalid date range'}:{ok:true,items:[],total:0,page:1,totalPages:1}});
  let tree=await h.mount();button(tree,'Filters').props.onClick();tree=h.render();assert.ok(field(tree,'Filter customer'));field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=await h.settle();assert.match(text(tree),/Invalid date range/);assert.ok(field(tree,'Filter customer'));h.cleanup();
});

test('one job action opens its audited work area and stale details cannot switch customer',async()=>{
  let resolveFirst;
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async path=>path.includes('?')?{ok:true,items:jobs,total:2,page:1,totalPages:1}:path.endsWith('job-1')?new Promise(resolve=>{resolveFirst=resolve;}):audit(jobs[1])});
  let tree=await h.mount();const jobButtons=()=>nodes(h.render(),n=>n.type==='button'&&text(n).includes('Open job'));
  assert.equal(jobButtons().length,2);assert.doesNotMatch(text(tree),/View summary|Open full audit workspace/);
  jobButtons()[0].props.onClick({currentTarget:{isConnected:true,focus(){}}});await flush();tree=h.render();assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexAuditCallPanel').length,0);
  assert.equal(jobButtons().length,0);
  button(tree,'Back to jobs').props.onClick();tree=h.render();
  jobButtons()[1].props.onClick({currentTarget:{isConnected:true,focus(){}}});await flush();tree=h.render();assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexAuditCallPanel')[0].props.jobIntentId,'job-2');
  resolveFirst(audit(jobs[0]));await flush();tree=h.render();assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexAuditCallPanel')[0].props.jobIntentId,'job-2');
  button(tree,'Back to jobs').props.onClick();tree=h.render();assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexAuditCallPanel').length,0);h.cleanup();
});

test('selected work replaces the register, uses fresh private details and returns to the same filters',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async path=>path.includes('?')?{ok:true,items:jobs,total:2,page:1,totalPages:1}:{...audit(jobs[0]),customer:{first_name:'Current',last_name:'Customer',phone:'+61400000003'},serviceSite:{address_line_1:'Updated site address'}}});
  let tree=await h.mount();button(tree,'Filters').props.onClick();tree=h.render();field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=await h.settle();
  nodes(tree,n=>n.type==='button'&&text(n).includes('Open job'))[0].props.onClick({currentTarget:{isConnected:false,focus(){}}});await flush();tree=h.render();
  assert.equal(field(tree,'Filter customer'),undefined);assert.match(text(tree),/Current Customer/);assert.match(text(tree),/Updated site address/);assert.doesNotMatch(text(tree),/Alex Example/);
  button(tree,'Back to jobs').props.onClick();tree=h.render();assert.equal(field(tree,'Filter customer').props.value,'Alex');h.cleanup();
});

function portal(role='admin', options={}) {return runtime('CreditexCompliancePortal',{}, {noEffects:true,...options,seed:{0:user,1:true,2:{role,email:'reviewer@example.invalid',displayName:'Test Reviewer',governanceIdentityVerified:true,canEditFieldMasters:role==='admin',organisation:{code:'creditex',legalName:'Creditex',tradingName:'Creditex'}},3:false}});}

test('Jobs defaults and Training and Activity forms stay directly visible in the left rail',()=>{
  const h=portal();let tree=h.render();assert.equal(button(tree,'Jobs').props['aria-selected'],true);
  for(const label of ['Jobs','Cases','Training','Activity forms','Trade onboarding','Official sources','Government rules'])assert.ok(button(tree,label));
  assert.doesNotMatch(text(tree),/Setup & rules|VEU test pilot/);
  assert.equal(nodes(tree,n=>n.props?.role==='tablist')[0].props['aria-orientation'],'vertical');
  button(tree,'Cases').props.onClick();tree=h.render();assert.equal(button(tree,'Cases').props['aria-selected'],true);assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexOperationsWorkspace').length,1);
  button(tree,'Activity forms').props.onClick();tree=h.render();assert.ok(nodes(tree,n=>n.props?.id==='creditex-panel-forms')[0]);
  const outputs=nodes(tree,n=>n.type==='details'&&text(n).includes('Certificate outputs'))[0];assert.ok(outputs);assert.notEqual(outputs.props.open,true);h.cleanup();
});

test('auditors retain forms and source access but never gain training or administrator tools',()=>{
  const h=portal('auditor');const tree=h.render();assert.equal(nodes(tree,n=>n.type?.displayName==='CreditexVoiceSetupPanel').length,0);
  assert.ok(button(tree,'Official sources'));assert.ok(button(tree,'Activity forms'));
  for(const label of ['Government rules','Training','Trade onboarding'])assert.equal(button(tree,label),undefined);
  const selector=nodes(tree,n=>n.type==='select'&&n.props.value==='cases')[0];assert.deepEqual(nodes(selector,n=>n.type==='option').map(n=>n.props.value),['cases','operations','forms','sources']);h.cleanup();
});

test('vertical keyboard navigation cycles through the visible authorised tabs',()=>{
  const h=portal();let tree=h.render();let prevented=false;button(tree,'Jobs').props.onKeyDown({key:'ArrowDown',preventDefault(){prevented=true;}});tree=h.render();assert.equal(prevented,true);assert.equal(button(tree,'Cases').props['aria-selected'],true);
  button(tree,'Cases').props.onKeyDown({key:'End',preventDefault(){}});tree=h.render();assert.equal(button(tree,'Government rules').props['aria-selected'],true);
  button(tree,'Government rules').props.onKeyDown({key:'ArrowDown',preventDefault(){}});tree=h.render();assert.equal(button(tree,'Jobs').props['aria-selected'],true);
  button(tree,'Jobs').props.onKeyDown({key:'ArrowUp',preventDefault(){}});tree=h.render();assert.equal(button(tree,'Government rules').props['aria-selected'],true);
  button(tree,'Government rules').props.onKeyDown({key:'Home',preventDefault(){}});tree=h.render();assert.equal(button(tree,'Jobs').props['aria-selected'],true);h.cleanup();
});

test('mobile section selector opens the same panels and ignores unavailable destinations',()=>{
  const h=portal('reviewer');let tree=h.render();const select=()=>nodes(h.render(),n=>n.type==='select'&&Array.isArray(n.props.children)&&n.props.children.some(x=>x?.props?.value==='cases'))[0];
  select().props.onChange({target:{value:'compliance-questions'}});tree=h.render();assert.equal(button(tree,'Training').props['aria-selected'],true);assert.ok(nodes(tree,n=>n.props?.id==='creditex-panel-compliance-questions')[0]);
  select().props.onChange({target:{value:'governance'}});tree=h.render();assert.equal(button(tree,'Training').props['aria-selected'],true);h.cleanup();
});

test('desktop, keyboard and mobile changes all respect unsaved training edits',()=>{
  const h=portal('admin',{confirm:false});let tree=h.render();button(tree,'Training').props.onClick();tree=h.render();nodes(tree,n=>typeof n.props?.onDirtyChange==='function')[0].props.onDirtyChange(true);
  button(tree,'Jobs').props.onClick();tree=h.render();assert.equal(button(tree,'Training').props['aria-selected'],true);
  button(tree,'Training').props.onKeyDown({key:'Home',preventDefault(){}});tree=h.render();assert.equal(button(tree,'Training').props['aria-selected'],true);
  nodes(tree,n=>n.type==='select'&&n.props.value==='compliance-questions')[0].props.onChange({target:{value:'forms'}});tree=h.render();assert.equal(button(tree,'Training').props['aria-selected'],true);h.cleanup();
});
