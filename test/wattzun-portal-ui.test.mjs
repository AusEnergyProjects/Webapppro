import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as portalContract from "../src/lib/wattzun-portal.ts";
import * as recordContract from "../src/lib/wattzun-records.ts";
import * as actionContract from "../src/lib/wattzun-actions.ts";

const source = readFileSync(new URL("../src/components/WattzunPortalAssistant.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function load({ values = [null, [], "", false, null], storage, events, fetchRequest = () => { throw new Error("Unexpected fetch"); } } = {}) {
  let stateIndex = 0;
  const effects = [], updates = [], auth = { callback: null, unsubscribed: false };
  const dependencies = {
    react: {
      useState: () => { const index = stateIndex++; return [values[index], value => updates.push({ index, value })]; },
      useRef: initial => ({ current: initial }), useCallback: callback => callback,
      useEffect: callback => effects.push(callback),
    },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "next/link": { default: "Link" },
    "next/navigation": { usePathname: () => "/direct-trade/dashboard", useRouter: () => ({ push() {} }) },
    "firebase/auth": { onAuthStateChanged: (_auth, callback) => { auth.callback = callback; return () => { auth.unsubscribed = true; }; } },
    "@/lib/firebase-client": { firebaseAuth: {} },
    "@/lib/trade-business-client": { readTradeBusinessSelection: () => "business-b", TRADE_BUSINESS_SELECTION_CHANGED_EVENT: "tlink:business-selection-changed" },
    "@/lib/wattzun-portal-path": { wattzunPortalForPath: portalContract.wattzunPortalForPath },
    "@/lib/wattzun-records": recordContract,
    "@/lib/wattzun-actions": actionContract,
    "@/lib/wattzun-portal": portalContract,
    "@/lib/wattzun-appearance": {
      WATTZUN_OPEN_EVENT:'wattzun:open',WATTZUN_READY_EVENT:'wattzun:ready',WATTZUN_USAGE_CHANGED_EVENT:'wattzun:usage-changed',
      readWattzunOpenRequest:value=>value,
      useWattzunPresentation:()=>({hat:'none',speed:1,setSpeed:speed=>updates.push({index:'speed',value:speed})}),
    },
    "@/lib/wattzun-voice-client": {},
    "@/lib/wattzun-voice-stream": {},
    "./EnergyAssistantLauncher": { EnergyAssistantLauncher: "Launcher" },
    "./WattzunMascot": { WattzunMascot: "Mascot" },
    "./WattzunRecordPicker": { WattzunRecordPicker: "Picker" },
    "./WattzunActionReview": { WattzunActionReview: "Review" },
    "./WattzunPortalAssistant.module.css": { default: {} },
  };
  const exported = {};
  new Function("require", "exports", "window", "fetch", `${compiled}\nexports.testHelpers = {conversationHistory, responsePayload, isReply, WattzunConversation, workspaceHref};`)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, exported, { localStorage: storage, ...events }, fetchRequest);
  return { exported, effects, updates, auth };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const user = { uid: "user-a", emailVerified: true, getIdToken: () => Promise.resolve("test-token") };
const scopes = [{ portal: "trade", scopeId: "business-a", label: "Business A" }, { portal: "trade", scopeId: "business-b", label: "Business B" }];

test("the launcher is absent before authentication and until server-authorised scopes exist", () => {
  for (const values of [[null, scopes, "business-a", false], [user, [], "", false]]) {
    const result = load({ values }).exported.WattzunPortalAssistant({ portal: "trade" });
    assert.equal(result, null);
  }
  const result = load({ values: [user, scopes, "business-b", false] }).exported.WattzunPortalAssistant({ portal: "trade" });
  assert.equal(result.props.children[0].type, "Launcher");
  assert.equal(typeof result.props.children[0].props.onOpen, "function");
});
test("auth changes immediately clear scopes, workspace and the open modal", () => {
  const h = load(); h.exported.WattzunPortalAssistant({ portal: "trade" }); const unsubscribe = h.effects[0]();
  h.auth.callback({ ...user, emailVerified: false });
  assert.deepEqual(h.updates, [{ index: 0, value: null }, { index: 1, value: [] }, { index: 2, value: "" }, { index: 3, value: false }, { index:4,value:null }]);
  unsubscribe(); assert.equal(h.auth.unsubscribed, true);
});
test("scope discovery sends a fresh auth token and restores an authorised trade selection", async () => {
  const requests = [];
  const h = load({ values: [user, [], "", false], fetchRequest: async (url, init) => { requests.push({ url, init }); return Response.json({ ok: true, scopes }); } });
  h.exported.WattzunPortalAssistant({ portal: "trade" }); h.effects[0](); h.auth.callback(user); h.updates.length=0; const cleanup = h.effects[1](); await flush();
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/wattzun/portal?portal=trade"); assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
  assert.deepEqual(h.updates.find(update => update.index === 1).value, scopes); assert.equal(h.updates.find(update => update.index === 2).value, "business-b");
  cleanup(); assert.equal(requests[0].init.signal.aborted, true);
});
test("scope discovery ignores a late response after sign-out or route removal", async () => {
  let resolve;
  const response = new Promise(yes => { resolve = yes; });
  const h = load({ values: [user, [], "", false], fetchRequest: () => response });
  h.exported.WattzunPortalAssistant({ portal: "trade" }); const cleanup = h.effects[1](); await flush(); cleanup(); resolve(Response.json({ ok: true, scopes })); await flush();
  assert.equal(h.updates.length, 0);
});
test("unauthorised server discovery cannot reveal a launcher", async () => {
  const h = load({ values: [user, [], "", false], fetchRequest: () => Promise.resolve(Response.json({ ok: false, error: "Access denied" }, { status: 403 })) });
  h.exported.WattzunPortalAssistant({ portal: "council" }); const cleanup = h.effects[1](); await flush();
  assert.deepEqual(h.updates, [{ index: 1, value: [] }]); cleanup();
});
test('workspace open events reject another actor, portal or unauthorised scope before acknowledging',()=>{
  const target=new EventTarget();let acknowledgements=0;
  const h=load({values:[user,scopes,'business-b',false,null],events:{addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target),dispatchEvent:target.dispatchEvent.bind(target)}});
  h.exported.WattzunPortalAssistant({portal:'trade'});h.effects[0]();h.auth.callback(user);h.updates.length=0;const cleanup=h.effects[2]();
  const send=change=>target.dispatchEvent(new CustomEvent('wattzun:open',{detail:{userUid:'user-a',portal:'trade',scopeId:'business-a',mode:'message',acknowledge:()=>acknowledgements++,...change}}));
  send({userUid:'old-actor'});send({portal:'council'});send({scopeId:'private-business'});assert.equal(h.updates.length,0);assert.equal(acknowledgements,0);
  send({});assert.equal(acknowledgements,1);assert.deepEqual(h.updates.find(update=>update.index===2),{index:2,value:'business-a'});assert.deepEqual(h.updates.find(update=>update.index===3),{index:3,value:true});
  h.auth.callback(null);h.updates.length=0;send({});assert.equal(h.updates.length,0,'Sign-out invalidates actor access before an old listener can clean up');assert.equal(acknowledgements,1);
  cleanup();send({});assert.equal(acknowledgements,1);
});
const text = node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):text(node.props?.children);
const nodes = (node,predicate)=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(item=>nodes(item,predicate)):[...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];
test('conversation settings expose speed only and active check-ins provide accessible Continue and End controls', () => {
  const h=load({values:[[],'',false,'',{state:'confirming',message:'Would you like to continue this call?'},false]});
  const tree=h.exported.testHelpers.WattzunConversation({user,scope:scopes[0]});
  const settings=nodes(tree,node=>node.type==='details')[0]; assert.match(text(settings),/Speech speed/);
  assert.deepEqual(nodes(settings,node=>node.type==='select').map(node=>node.props['aria-label']),['Speaking speed']);
  assert.equal(nodes(settings,node=>node.type==='textarea').length,0); assert.doesNotMatch(text(settings),/Voice and personality|Tone|Personality note/);
  const speed=nodes(settings,node=>node.type==='select')[0]; speed.props.onChange({target:{value:'1.15'}}); assert.deepEqual(h.updates.at(-1),{index:'speed',value:1.15});
  const checkin=nodes(tree,node=>node.props?.['aria-label']==='Call check-in')[0]; assert.equal(checkin.props.role,'group');
  assert.ok(nodes(checkin,node=>node.type==='button'&&text(node)==='Continue call')[0]); assert.ok(nodes(checkin,node=>node.type==='button'&&text(node)==='End call')[0]);
});
test("follow-up history stays in memory, retains questions, and stays within the API budget", () => {
  const helpers = load().exported.testHelpers;
  const messages = [
    { role: "user", content: "Help me with the job", id: "1" },
    { role: "assistant", content: "Which job?\nWhat would you like to achieve?", id: "2" },
  ];
  assert.deepEqual(helpers.conversationHistory(messages), messages.map(({ role, content }) => ({ role, content })));
  const shortTurns = Array.from({ length: 44 }, (_, index) => ({ id: String(index), role: index % 2 ? "assistant" : "user", content: `Turn ${index}` }));
  const retained = helpers.conversationHistory(shortTurns);
  assert.equal(retained.length, portalContract.WATTZUN_MAX_HISTORY_TURNS);
  assert.deepEqual(retained, shortTurns.slice(-40).map(({role,content})=>({role,content})));
  assert.equal(portalContract.parseWattzunTurn({portal:'trade',scopeId:'business-a',requestId:'history-forty-fixture',message:'Continue',history:retained}).history.length,40);
  const bounded = helpers.conversationHistory(Array.from({ length: 40 }, (_, index) => ({ id: String(index), role: index % 2 ? "assistant" : "user", content: String(index).padEnd(4000, "x") })));
  assert.ok(bounded.length < 40); assert.ok(JSON.stringify(bounded).length <= portalContract.WATTZUN_MAX_HISTORY_CHARACTERS); assert.ok(bounded.at(-1).content.startsWith("39"));
  assert.doesNotThrow(()=>portalContract.parseWattzunTurn({portal:'trade',scopeId:'business-a',requestId:'history-budget-fixture',message:'Continue',history:bounded}));
  assert.doesNotMatch(source,/localStorage|appearance\.hat.*preferences/);
});
test("reply links reject off-site and malformed destinations before rendering", () => {
  const { isReply } = load().exported.testHelpers;
  const reply = { kind: "clarification", message: "Tell me more", questions: ["Which job?"], links: [{ label: "Jobs", href: "/direct-trade/dashboard?tab=jobs" }] };
  assert.equal(isReply(reply), true);
  for (const href of ["//evil.example", "javascript:alert(1)", "https://evil.example"]) assert.equal(isReply({ ...reply, links: [{ label: "Go", href }] }), false);
  assert.equal(isReply({ ...reply, questions: [17] }), false);
  assert.equal(isReply({...reply,lookup:{kind:'file',query:'JOB-24'}}),true);
  assert.equal(isReply({...reply,lookup:{kind:'customer',query:'JOB-24'}}),false);
});

test('workspace links retain the current owner or staff route while preserving the selected record',()=>{
  const {workspaceHref}=load().exported.testHelpers;
  const scope={portal:'trade',scopeId:'business-owner',label:'Business'};
  assert.equal(workspaceHref('/direct-trade/dashboard?workspace=work&customerId=saved',scope,'staff-user','/direct-trade/team'),'/direct-trade/team?workspace=work&customerId=saved');
  assert.equal(workspaceHref('/direct-trade/team?workspace=work&jobId=saved&jobTab=quote',scope,'business-owner','/direct-trade/dashboard'),'/direct-trade/dashboard?workspace=work&jobId=saved&jobTab=quote');
  assert.equal(workspaceHref('/direct-trade/dashboard?workspace=work',scope,'staff-user','/direct-trade/messages'),'/direct-trade/team?workspace=work');
  assert.equal(workspaceHref('/direct-trade/team?workspace=work',scope,'business-owner','/direct-trade/messages'),'/direct-trade/dashboard?workspace=work');
  assert.equal(workspaceHref('/api/saved-file.pdf',scope,'staff-user','/direct-trade/team'),'/api/saved-file.pdf');
});
