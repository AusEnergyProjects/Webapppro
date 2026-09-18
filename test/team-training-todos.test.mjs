import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { ENERGY_SERVICE_CATALOGUE } from '../src/lib/energy-service-catalogue.mjs';

const source=fs.readFileSync(new URL('../src/components/TeamTrainingTodos.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const nodes=(node,predicate)=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(child=>nodes(child,predicate)):[...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node)===label)[0];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const makeModule=(index=0,extra={})=>({id:`module-${index}`,title:`Activity ${index}`,programCode:'VEU',activityTemplateIds:[`activity-${index}`],serviceCategory:'insulation',businessServiceEnabled:true,status:'required',availability:'active',completion:null,...extra});
const payload=(extra={})=>({ok:true,memberId:'member-a',canTakeTraining:false,selectedMember:{memberId:'member-a',displayName:'Alex Installer',isOwner:false,isSelf:false},modules:[makeModule()],unavailableActivities:[],...extra});
function harness(responder=()=>payload(),overrides={}) {
  const state=[],effects=[],deps=[];let cursor=0,effectIndex=0;
  const requests=[],saved=[],opened=[];
  const props={user:{uid:'owner',getIdToken:async()=> 'token'},memberId:'member-a',displayName:'Alex Installer',hasOfficeLogin:false,active:true,unsavedServices:false,saving:false,onSave:()=>saved.push(true),onOpenOwnTraining:()=>opened.push(true),ownTrainingHref:'/direct-trade/dashboard?workspace=training',...overrides};
  const hooks={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useEffect(callback,next){const i=effectIndex++;if(!deps[i]||next.some((value,j)=>value!==deps[i][j])){effects.push(callback);deps[i]=next;}}};
  const exports={};const fetch=async(url,init)=>{requests.push({url,...init});return{ok:true,json:async()=>responder()};};
  Function('require','exports','fetch',code)(id=>id==='react'?hooks:id==='react/jsx-runtime'?jsx:id.endsWith('.module.css')?{default:new Proxy({},{get:(_,key)=>key})}:id.endsWith('energy-service-catalogue.mjs')?{ENERGY_SERVICE_CATALOGUE}:(()=>{throw new Error(id);})(),exports,fetch);
  const render=()=>{cursor=0;effectIndex=0;return exports.TeamTrainingTodos(props);};
  const settle=async()=>{render();while(effects.length)effects.shift()();await flush();return render();};
  return{render,settle,props,requests,saved,opened};
}

test('roster-only member receives saved training to-dos without a manager assessment action',async()=>{
  const h=harness();const tree=await h.settle();
  assert.equal(h.requests[0].url,'/api/trade-training?memberId=member-a');assert.equal(h.requests[0].headers.Authorization,'Bearer token');assert.equal(h.requests[0].cache,'no-store');
  assert.match(text(tree),/Office login is not linked/);assert.match(text(tree),/Use the app PIN setup above if this person has not signed in/);
  assert.match(text(tree),/manager cannot complete another person's assessment/);assert.equal(button(tree,'Open my training'),undefined);
  assert.equal(nodes(tree,node=>node.type==='form'||node.props.onSubmit).length,0);assert.doesNotMatch(source,/action:\s*['"](?:start|submit)|correctOptionId|TRAINING_MODULES/);
});

test('unsaved service selections do not fetch or replace assigned training before save',async()=>{
  let current=payload();const h=harness(()=>current);await h.settle();h.props.unsavedServices=true;
  let tree=await h.settle();assert.equal(h.requests.length,1);assert.match(text(tree),/still reflect the saved services/);
  button(tree,'Save services and update to-dos').props.onClick();assert.equal(h.saved.length,1);assert.equal(h.requests.length,1);
  current=payload({modules:[makeModule(1),makeModule(2)]});h.props.unsavedServices=false;
  button(h.render(),'Refresh training').props.onClick();tree=await h.settle();
  assert.equal(h.requests.length,2);assert.match(text(tree),/0 of 2 modules passed/);assert.doesNotMatch(text(tree),/Service changes are not saved/);
});

test('217 modules are paginated and exact programme filters preserve passed and pending review state',async()=>{
  const modules=Array.from({length:217},(_,i)=>makeModule(i,{programCode:i<100?'ACT-SHS':'ACT-HES'}));
  modules[0]=makeModule(0,{programCode:'ACT-SHS',status:'passed',completion:{reference:'TL-CX-TRAIN-MEMBER-A',expiresAt:'2027-01-01'}});
  modules[1]=makeModule(1,{programCode:'ACT-SHS',availability:'awaiting_review',status:'awaiting_review',businessServiceEnabled:false});
  const h=harness(()=>payload({modules}));let tree=await h.settle();
  assert.equal(nodes(tree,node=>node.type==='li').length,6);assert.match(text(tree),/1 of 217 modules passed/);assert.match(text(tree),/TL-CX-TRAIN-MEMBER-A/);assert.match(text(tree),/Awaiting Creditex review/);assert.match(text(tree),/business has not enabled/);
  button(tree,'Next').props.onClick();tree=h.render();assert.match(text(tree),/Page 2 of 37/);
  nodes(tree,node=>node.type==='select')[0].props.onChange({target:{value:'ACT-HES'}});tree=h.render();assert.match(text(tree),/117 matching activities/);
  nodes(tree,node=>node.type==='input')[0].props.onChange({target:{value:'Activity 120'}});tree=h.render();assert.equal(nodes(tree,node=>node.type==='li').length,1);assert.match(text(tree),/Activity 120/);
});

test('only the authenticated member receives own training navigation and inactive records do not fetch',async()=>{
  const own=harness(()=>payload({canTakeTraining:true,selectedMember:{memberId:'member-a',displayName:'Alex',isOwner:false,isSelf:true}}));
  button(await own.settle(),'Open my training').props.onClick();assert.equal(own.opened.length,1);
  const inactive=harness(undefined,{active:false});assert.match(text(await inactive.settle()),/member is inactive/);assert.equal(inactive.requests.length,0);
});

test('mismatched member responses fail closed without exposing a completion',async()=>{
  const h=harness(()=>payload({memberId:'other',modules:[makeModule(0,{status:'passed',completion:{reference:'PRIVATE-OTHER',expiresAt:'2027-01-01'}})]}));
  const tree=await h.settle();assert.match(text(tree),/did not match this member/);assert.doesNotMatch(text(tree),/PRIVATE-OTHER/);
});

test('member save refreshes to-dos only after success and selected services use canonical catalogue',()=>{
  const team=fs.readFileSync(new URL('../src/components/TradeTeamSettings.tsx',import.meta.url),'utf8');
  const start=team.indexOf('async function saveMember('),end=team.indexOf('async function createLogin(',start),save=team.slice(start,end);
  assert.ok(save.indexOf('if (!response.ok || !result.ok)')<save.indexOf('setTrainingRevision(value => value + 1)'));
  assert.match(save,/setMemberServices\(savedMember\.capabilities \|\| \[\]\)/);
  assert.match(save,/api\/trade-team\?memberId=\$\{encodeURIComponent\(savedId\)\}/);
  assert.match(team,/key=\{`\$\{user.uid\}:\$\{editing.id\}:\$\{trainingRevision\}`\}/);
  assert.match(team,/ENERGY_SERVICE_CATALOGUE\.map/);
  const parsed=ts.createSourceFile('TradeTeamSettings.tsx',team,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const checkLiteral=node=>{if(ts.isStringLiteral(node))assert.ok(!node.text.includes('&apos;'),'JS strings must contain a real apostrophe');ts.forEachChild(node,checkLiteral);};
  checkLiteral(parsed);
});
