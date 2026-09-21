import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as catalogue from '../src/lib/australian-government-program-catalogue.ts';
import * as dateHelpers from '../src/lib/job-register-dates.ts';
import * as certificateTypes from '../src/lib/creditex-certificate-types.ts';
const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child,predicate)) : [...(predicate(node) ? [node] : []),...nodes(node.props?.children,predicate)];
const normalize = value => value.replace(/\s+/g, ' ').trim();
const button = (tree, label) => nodes(tree, n => n.type === 'button' && normalize(text(n)) === normalize(label))[0];
const field = (tree, label) => nodes(tree, n => n.props?.['aria-label'] === label)[0];
const labelledField = (tree, label) => { const control = field(tree,label); if(control)return control; const parent=nodes(tree,n=>n.type==='label'&&normalize(text(n)).startsWith(label))[0]; return nodes(parent,n=>['input','select'].includes(n.type))[0]; };
const filterPanel = tree => nodes(tree,n=>n.type==='aside'&&nodes(n,child=>/^h[1-6]$/.test(child.type)&&text(child)==='Job filters').length)[0];
const filterToggle = tree => nodes(tree,n=>n.type==='button'&&n.props['aria-controls']==='creditex-job-filters')[0];
function submitFilters(tree) { let prevented=false; nodes(filterPanel(tree),n=>n.type==='form')[0].props.onSubmit({preventDefault(){prevented=true;}}); assert.equal(prevented,true); }
const openJobButtons = tree => nodes(tree,n=>n.type==='button'&&n.props?.['aria-label']?.startsWith('Open job '));
const flush = () => new Promise(resolve => setImmediate(resolve));
const user = { uid: 'reviewer-1', getIdToken: async () => 'test-token' };
const job = (id,name) => ({ id, jobId:id, jobNumber:id.toUpperCase(),jobTitle:'Heat pump upgrade',customerName:name,customerPhone:'+61400000001',customerEmail:'customer@example.invalid',jobStage:'scheduled',jobPriority:'standard',plannedStart:'2026-09-22T09:00:00Z',updatedAt:'2026-09-21T09:00:00Z',planningCurrent:true,status:'planned',programCode:'VEU',activityKey:'hot-water',activityTitle:'Hot water',installerBusiness:'Example Trade',quotedValueCents:10000,invoicedValueCents:0,quoteStatus:'accepted',invoiceStatus:'not_started' });
const jobs=[job('job-1','Alex Example'),job('job-2','Sam Sample')];
const audit = item => ({ ok:true,customer:{ phone:item.customerPhone },groups:[], serviceSiteAddressProvenance:{entryMode:'manual',provider:'',providerReference:'',formattedAddress:'Test site',verifiedAt:'',status:'manual_review_required',reviewRequired:true} });
function runtime(name, props={}, options={}) {
  const slots=[], effects=[], callbacks=[], queued=[], timers=new Map(), requests=[], requestOptions=[], focusEvents=[];
  let cursor=0,stateOrdinal=0,timerId=0,mounted=true,lateStateWrites=0;
  const hooks={
    useState(initial) { const i=cursor++, ordinal=stateOrdinal++; if(!(i in slots))slots[i]=ordinal in (options.seed||{}) ? options.seed[ordinal] : typeof initial==='function'?initial():initial; return [slots[i],value=>{if(!mounted)lateStateWrites++;slots[i]=typeof value==='function'?value(slots[i]):value;}]; },
    useRef(initial){ const i=cursor++; if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useCallback(callback,deps){const i=cursor++;if(!callbacks[i]||deps.some((x,j)=>x!==callbacks[i].deps[j]))callbacks[i]={callback,deps};return callbacks[i].callback;},
    useMemo(callback){cursor++;return callback();},
    useEffect(callback,deps){const i=cursor++; if(options.noEffects)return; if(!effects[i]||deps.some((x,j)=>x!==effects[i].deps[j])){effects[i]?.cleanup?.();effects[i]={deps};queued.push(()=>{effects[i].cleanup=callback();});}},
  };
  const stubs=new Map();
  const rowActions={};
  const require=id=>id==='react'?hooks:id==='react/jsx-runtime'?jsx:id==='./JobRowActions'?rowActions:id==='@/lib/job-register-dates'?dateHelpers:id==='@/lib/creditex-certificate-types'?certificateTypes:id==='@/lib/australian-government-program-catalogue'?catalogue:id==='@/lib/firebase-client'?{firebaseAuth:{currentUser:user}}:id==='next/dynamic'?{default:()=>()=>null}:id.endsWith('.module.css')?{default:new Proxy({},{get:(_,key)=>String(key)})}:new Proxy({},{get:(_,key)=>{const name=key==='default'?id.split('/').pop():String(key);if(!stubs.has(name))stubs.set(name,Object.defineProperty(()=>null,'displayName',{value:name}));return stubs.get(name);}});
  Function('require','exports',compile('JobRowActions'))(require,rowActions);
  const api=async(path,init)=>{requests.push(path);requestOptions.push(init);if(options.api)return options.api(path,init);return path.includes('?')?{ok:true,items:jobs,total:150,totalPages:3,page:Number(new URL(path,'https://test.invalid').searchParams.get('page'))}:audit(jobs.find(item=>path.endsWith(item.id)));};
  const filterLauncher={isConnected:true,focus(){focusEvents.push('Filters');}};
  const window={setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(callback){callback();},confirm:()=>options.confirm!==false};
  const exports={}; Function('require','exports','window','document',compile(name))(require,exports,window,{getElementById:()=>({focus(){}})});
  const render=()=>{cursor=0;stateOrdinal=0;const tree=exports[name]({...props,...(name==='CreditexPlannedIntakeQueue'?{api}:{})});for(const node of nodes(tree,n=>n.props?.ref))if(!node.props.ref.current)node.props.ref.current=node.props.className==='filterToggle'?filterLauncher:{focus(){focusEvents.push(node.props['aria-label']||normalize(text(node)));},scrollIntoView(){},scrollTop:0,scrollLeft:0};for(const effect of queued.splice(0))effect();return tree;};
  const settle=async()=>{render();for(const [id,callback] of [...timers]){timers.delete(id);callback();}await flush();return render();};
  return {render,settle,requests,requestOptions,stubs,filterLauncher,focusEvents,get lateStateWrites(){return lateStateWrites;},async mount(){return settle();},cleanup(){mounted=false;for(const effect of effects)effect?.cleanup?.();}};
}

test('advanced filters batch changes until Search, request the full dataset and reset pagination',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();button(tree,'Next').props.onClick();tree=await h.settle();assert.match(h.requests.at(-1),/page=2/);
  const before=h.requests.length;button(tree,'Filters').props.onClick({currentTarget:h.filterLauncher});tree=h.render();
  assert.ok(filterPanel(tree));assert.notEqual(filterPanel(tree).props['aria-modal'],true);
  field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=await h.settle();
  field(tree,'Filter installer').props.onChange({target:{value:'Trade'}});tree=await h.settle();
  assert.equal(h.requests.length,before,'editing draft filters must not start a request');
  assert.equal(button(filterPanel(tree),'Search').props.type,'submit');submitFilters(tree);tree=await h.settle();
  const query=new URL(h.requests.at(-1),'https://test.invalid').searchParams;
  assert.equal(h.requests.length,before+1);assert.equal(query.get('page'),'1');assert.equal(query.get('customer'),'Alex');assert.equal(query.get('installer'),'Trade');
  assert.ok(filterPanel(tree),'applying filters keeps the filter panel open');h.cleanup();
});

test('certificate type is a primary filter with exact server values and resets the result page',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();
  assert.equal(filterPanel(tree),undefined);
  const select=()=>labelledField(h.render(),'Certificate type');
  assert.ok(select());assert.deepEqual(nodes(select(),n=>n.type==='option').map(n=>n.props.value),['all','certificates',...certificateTypes.CREDITEX_CERTIFICATE_TYPES]);
  for(const certificateType of ['certificates',...certificateTypes.CREDITEX_CERTIFICATE_TYPES,'all']) {
    button(tree,'Next').props.onClick();tree=await h.settle();assert.equal(new URL(h.requests.at(-1),'https://test.invalid').searchParams.get('page'),'2');
    const before=h.requests.length;select().props.onChange({target:{value:certificateType}});tree=await h.settle();
    const params=new URL(h.requests.at(-1),'https://test.invalid').searchParams;
    assert.equal(h.requests.length,before+1);assert.equal(params.get('certificateType'),certificateType);assert.equal(params.get('page'),'1');assert.equal(select().props.value,certificateType);
  }h.cleanup();
});

test('the register renders 50 separate activity records per page without claiming they are unique jobs',async()=>{
  const rows=Array.from({length:75},(_,index)=>({...job(`activity-${index}`,`Customer ${index}`),jobId:`job-${Math.floor(index/2)}`,jobNumber:`JOB-${Math.floor(index/2)}`}));
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async path=>{const page=Number(new URL(path,'https://test.invalid').searchParams.get('page'));return {ok:true,items:rows.slice((page-1)*50,page*50),total:75,page,totalPages:2,pageSize:50};}});
  let tree=await h.mount();assert.equal(openJobButtons(tree).length,50);assert.match(text(tree),/75 matching records/);assert.doesNotMatch(text(tree),/75 (?:matching )?jobs/);
  assert.equal(openJobButtons(tree)[0].props.id,'creditex-job-activity-0');assert.equal(openJobButtons(tree)[1].props.id,'creditex-job-activity-1');
  assert.equal(openJobButtons(tree)[0].props['aria-label'],'Open job JOB-0');assert.equal(openJobButtons(tree)[1].props['aria-label'],'Open job JOB-0');
  assert.doesNotMatch(text(openJobButtons(tree)[0]),/Open job/,'the compact reference retains its full accessible action name');
  button(tree,'Next').props.onClick();tree=await h.settle();assert.equal(openJobButtons(tree).length,25);assert.equal(openJobButtons(tree)[0].props.id,'creditex-job-activity-50');
  assert.equal(new URL(h.requests.at(-1),'https://test.invalid').searchParams.get('page'),'2');h.cleanup();
});

test('closing or escaping draft filters discards unsubmitted edits and restores the launcher',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();filterToggle(tree).props.onClick();tree=h.render();
  const panel=filterPanel(tree);assert.ok(panel.props['aria-labelledby']);assert.equal(text(nodes(panel,n=>n.props?.id===panel.props['aria-labelledby'])[0]),'Job filters');
  field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=h.render();submitFilters(tree);tree=await h.settle();
  const before=h.requests.length;
  for(const method of ['button','escape']) {
    field(tree,'Filter customer').props.onChange({target:{value:'Unapplied customer'}});tree=await h.settle();assert.equal(h.requests.length,before);
    if(method==='button') (field(tree,'Close filters')||button(tree,'Close filters')).props.onClick();
    else filterPanel(tree).props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});
    tree=h.render();assert.equal(filterPanel(tree),undefined);assert.equal(h.focusEvents.at(-1),'Filters');
    filterToggle(tree).props.onClick();tree=h.render();assert.equal(field(tree,'Filter customer').props.value,'Alex');assert.equal(h.requests.length,before);
  }h.cleanup();
});

test('Clear filters immediately resets drafts, applied filters, primary controls and sort',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();
  for(const [label,value] of [['Search jobs','heat pump'],['Certificate type','VEEC'],['Record status','case_linked']]) {labelledField(tree,label).props.onChange({target:{value}});tree=await h.settle();}
  button(tree,'Created ↕').props.onClick();tree=await h.settle();filterToggle(tree).props.onClick();tree=h.render();
  field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=h.render();submitFilters(tree);tree=await h.settle();
  field(tree,'Filter installer').props.onChange({target:{value:'Unsubmitted trade'}});tree=h.render();
  button(tree,'Clear filters').props.onClick();tree=await h.settle();
  const params=new URL(h.requests.at(-1),'https://test.invalid').searchParams;
  for(const key of ['customer','installer'])assert.equal(params.has(key),false);
  for(const [key,value] of [['status','all'],['certificateType','all'],['search',''],['page','1'],['sort','plannedStart'],['sortDirection','asc']])assert.equal(params.get(key),value,key);
  assert.equal(labelledField(tree,'Search jobs').props.value,'');assert.equal(labelledField(tree,'Certificate type').props.value,'all');assert.equal(labelledField(tree,'Record status').props.value,'all');
  assert.equal(field(tree,'Filter customer').props.value,'');assert.equal(field(tree,'Filter installer').props.value,'');h.cleanup();
});

test('column sorting uses API direction and exposes the actual selected sort',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();button(tree,'First name ↕').props.onClick();tree=await h.settle();
  assert.match(h.requests.at(-1),/sort=customerFirstName/);assert.match(h.requests.at(-1),/sortDirection=asc/);
  assert.equal(nodes(tree,n=>n.type==='th'&&normalize(text(n))==='First name ↑')[0].props['aria-sort'],'ascending');
  button(tree,'First name ↑').props.onClick();tree=await h.settle();assert.match(h.requests.at(-1),/sortDirection=desc/);assert.ok(button(tree,'First name ↓'));h.cleanup();
});

test('created date and saved names have independent filters, sorts and paired calendar controls',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue');let tree=await h.mount();
  assert.deepEqual(nodes(tree,n=>n.type==='th').slice(0,2).map(n=>normalize(text(n))),['Job ID ↕','Created ↕']);
  button(tree,'Next').props.onClick();tree=await h.settle();
  button(tree,'Filters').props.onClick({currentTarget:h.filterLauncher});tree=h.render();
  for(const [label,value] of [['Filter first name','Mary Jane'],['Filter last name','van Example'],['Created from','2026-09-20'],['Created to','2026-09-21']]) {
    field(tree,label).props.onChange({target:{value}});tree=await h.settle();
  }
  submitFilters(tree);tree=await h.settle();
  const params=new URL(h.requests.at(-1),'https://test.invalid').searchParams;
  assert.equal(params.get('firstName'),'Mary Jane');assert.equal(params.get('lastName'),'van Example');assert.equal(params.get('createdFrom'),'2026-09-20');assert.equal(params.get('createdTo'),'2026-09-21');assert.equal(params.get('page'),'1');
  for(const [prefix,group] of [['Created','creditex-job-created'],['Planned','creditex-job-planned']]) {
    assert.equal(field(tree,`${prefix} from`).props['data-date-range-group'],group);assert.equal(field(tree,`${prefix} to`).props['data-date-range-group'],group);
    assert.equal(field(tree,`${prefix} from`).props['data-date-range-role'],'start');assert.equal(field(tree,`${prefix} to`).props['data-date-range-role'],'end');
  }
  button(tree,'Last name ↕').props.onClick();tree=await h.settle();assert.match(h.requests.at(-1),/sort=customerLastName/);
  button(tree,'Created ↕').props.onClick();tree=await h.settle();assert.match(h.requests.at(-1),/sort=createdAt/);assert.match(h.requests.at(-1),/sortDirection=asc/);
  button(tree,'Created ↑').props.onClick();tree=await h.settle();assert.match(h.requests.at(-1),/sortDirection=desc/);
  button(tree,'Clear filters').props.onClick();await h.settle();const reset=new URL(h.requests.at(-1),'https://test.invalid').searchParams;
  for(const key of ['firstName','lastName','createdFrom','createdTo'])assert.equal(reset.has(key),false);h.cleanup();
});

test('filter controls remain usable when no rows match or a filter is rejected',async()=>{
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async path=>new URL(path,'https://test.invalid').searchParams.has('customer')?{ok:false,error:'Invalid date range'}:{ok:true,items:[],total:0,page:1,totalPages:1}});
  let tree=await h.mount();button(tree,'Filters').props.onClick({currentTarget:h.filterLauncher});tree=h.render();assert.ok(field(tree,'Filter customer'));field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=h.render();submitFilters(tree);tree=await h.settle();assert.match(text(tree),/Invalid date range/);assert.ok(field(tree,'Filter customer'));h.cleanup();
});

test('changed filters abort the old request before debounce and ignore its late response',async()=>{
  const pending=[];
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:(path,init)=>new Promise(resolve=>pending.push({path,signal:init.signal,resolve}))});
  let tree=await h.mount();assert.equal(pending.length,1);assert.equal(pending[0].signal.aborted,false);
  button(tree,'Filters').props.onClick({currentTarget:h.filterLauncher});tree=h.render();field(tree,'Created from').props.onChange({target:{value:'2026-09-01'}});tree=h.render();
  assert.equal(pending[0].signal.aborted,false,'editing a draft leaves the current request alone');submitFilters(tree);tree=h.render();
  assert.equal(pending[0].signal.aborted,true);assert.equal(pending.length,1,'the replacement request is still debouncing');
  pending[0].resolve({ok:true,items:jobs,total:2,totalPages:1,page:1});await flush();tree=h.render();
  assert.doesNotMatch(text(tree),/JOB-1|JOB-2/);assert.match(text(tree),/Updating jobs/);
  tree=await h.settle();assert.equal(pending.length,2);assert.match(pending[1].path,/createdFrom=2026-09-01/);
  pending[1].resolve({ok:true,items:[job('fresh-job','Current customer')],total:1,totalPages:1,page:1});await flush();tree=h.render();
  assert.match(text(tree),/FRESH-JOB/);assert.match(text(tree),/1 matching record/);assert.doesNotMatch(text(tree),/JOB-1|JOB-2/);h.cleanup();
});

test('failed filtering preserves loaded rows and offers immediate retry without claiming current counts',async()=>{
  let attempt=0;
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async()=>{attempt++;if(attempt===2)throw Error('The request timed out.');return {ok:true,items:attempt===1?jobs:[jobs[1]],total:attempt===1?2:1,totalPages:1,page:1};}});
  let tree=await h.mount();button(tree,'Filters').props.onClick({currentTarget:h.filterLauncher});tree=h.render();field(tree,'Created to').props.onChange({target:{value:'2026-09-21'}});tree=h.render();submitFilters(tree);tree=await h.settle();
  assert.match(text(tree),/JOB-1/);assert.match(text(tree),/JOB-2/);assert.match(text(tree),/2 previously loaded records shown/);assert.match(text(tree),/may not match the current filters/);
  assert.doesNotMatch(text(tree),/0 records|matching records|filters applied/);assert.equal(field(tree,'Created to').props.value,'2026-09-21');
  assert.equal(nodes(tree,n=>n.props?.role==='region')[0].props['data-stale'],true);assert.ok(button(tree,'Created ↕'));
  button(tree,'Retry').props.onClick();assert.equal(h.requests.length,3,'explicit retry starts without waiting for debounce');await flush();tree=h.render();
  assert.doesNotMatch(text(tree),/JOB-1|previously loaded|timed out/);assert.match(text(tree),/JOB-2/);assert.match(text(tree),/1 matching record/);h.cleanup();
});

test('first-load errors keep the table controls and never report zero jobs until a successful empty response',async()=>{
  let attempt=0;
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async()=>{if(++attempt===1)throw Error('Service unavailable');return {ok:true,items:[],total:0,totalPages:1,page:1};}});
  let tree=await h.mount();assert.match(text(tree),/count unavailable/);assert.match(text(tree),/Jobs could not be loaded/);
  assert.doesNotMatch(text(tree),/0 (?:jobs|records)|0 matching|No matching (?:jobs|records)/);assert.ok(button(tree,'Created ↕'));
  button(tree,'Filters').props.onClick({currentTarget:h.filterLauncher});tree=h.render();assert.ok(field(tree,'Created from'));assert.ok(field(tree,'Filter first name'));
  button(tree,'Retry').props.onClick();await flush();tree=h.render();assert.match(text(tree),/0 matching records/);assert.match(text(tree),/No matching (?:jobs|records)/);h.cleanup();
});

test('unmount aborts the active list load and ignores subsequent success or failure',async()=>{
  for(const fail of [false,true]){
    let resolveRequest,rejectRequest;
    const h=runtime('CreditexPlannedIntakeQueue',{}, {api:()=>new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;})});
    await h.mount();const signal=h.requestOptions[0].signal;h.cleanup();assert.equal(signal.aborted,true);
    if(fail)rejectRequest(Error('Late timeout'));else resolveRequest({ok:true,items:jobs,total:2,totalPages:1,page:1});
    await flush();assert.equal(h.lateStateWrites,0);
  }
});

test('one job action opens its audited work area and stale details cannot switch customer',async()=>{
  let resolveFirst;
  const h=runtime('CreditexPlannedIntakeQueue',{}, {api:async path=>path.includes('?')?{ok:true,items:jobs,total:2,page:1,totalPages:1}:path.endsWith('job-1')?new Promise(resolve=>{resolveFirst=resolve;}):audit(jobs[1])});
  let tree=await h.mount();const jobButtons=()=>openJobButtons(h.render());
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
  let tree=await h.mount();button(tree,'Filters').props.onClick({currentTarget:h.filterLauncher});tree=h.render();field(tree,'Filter customer').props.onChange({target:{value:'Alex'}});tree=h.render();submitFilters(tree);tree=await h.settle();
  openJobButtons(tree)[0].props.onClick({currentTarget:{isConnected:false,focus(){}}});await flush();tree=h.render();
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
