import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createMapNavigationGuard } from '../src/lib/trade-map-navigation.ts';

const source = ts.createSourceFile('DirectTradeDashboard.tsx', readFileSync(new URL('../src/components/DirectTradeDashboard.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  if (predicate(node)) return node;
  let result;
  ts.forEachChild(node, child => { result ||= find(child, predicate); });
  return result;
}
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const evaluate = (node, context = {}) => Function(...Object.keys(context), `${compile(`const expression = (${node.getText(source)});`)}\nreturn expression;`)(...Object.values(context));
const sales = find(source, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'TradeSalesWorkspace');
function prop(name, context) {
  const attribute = sales.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(source) === name);
  assert.ok(attribute, `Sales needs its ${name} boundary`);
  return evaluate(attribute.initializer.expression, context);
}
const workspaceCallback = find(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'setWorkspace').initializer.arguments[0];
function navigation() {
  const events = [];
  const guard = createMapNavigationGuard();
  const setWorkspace = evaluate(workspaceCallback, { mapNavigation: guard, setWorkspaceState: value => events.push(['workspace', value]) });
  const context = { setWorkspace, setCommandTarget: value => events.push(['target', value]), setActiveWorkView: value => events.push(['view', value]) };
  return { events, guard, context };
}

test('Sales restores its bookmark without treating a sales URL as a job authorisation', () => {
  const names = ['dashboardWorkspaceFromSearch', 'jobNavigationFromSearch'];
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(value => ['dashboardWorkspaces', 'workOrderIdPattern'].includes(value.name.getText(source))));
  const helpers = Function(`${compile(declarations.map(node => node.getText(source)).join('\n'))}\nreturn {${names.join(',')}};`)();
  assert.equal(helpers.dashboardWorkspaceFromSearch('?workspace=sales'), 'sales');
  assert.equal(helpers.jobNavigationFromSearch('?workspace=sales&jobId=foreign'), null);
  assert.equal(helpers.jobNavigationFromSearch('?workspace=work&jobId=existing').id, 'existing');
});

test('saved customer links select only a valid work record and preserve job precedence', () => {
  const names=['dashboardWorkspaceFromSearch','jobNavigationFromSearch','dashboardCommandTargetFromSearch'];
  const declarations=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)
    ||ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>['dashboardWorkspaces','workOrderIdPattern'].includes(value.name.getText(source))));
  const helpers=Function(`${compile(declarations.map(node=>node.getText(source)).join('\n'))}\nreturn {${names.join(',')}};`)();
  const customer=helpers.dashboardCommandTargetFromSearch('?workspace=work&customerId=customer-saved:123');
  assert.equal(customer.kind,'customer');assert.equal(customer.id,'customer-saved:123');assert.equal(customer.workspace,'work');
  for(const search of ['?workspace=sales&customerId=customer-saved','?workspace=work&customerId=%3Cscript%3E','?workspace=work&customerId=']) assert.equal(helpers.dashboardCommandTargetFromSearch(search),null);
  assert.equal(helpers.dashboardCommandTargetFromSearch('?workspace=work&jobId=job-saved&customerId=customer-saved').kind,'job');
});

test('record URL synchronisation keeps the selected customer and removes stale job or customer identifiers', () => {
  const effect=find(source,node=>ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[0]?.getText(source).includes('const openCustomerId'));
  const names=['dashboardWorkspaceFromSearch','jobNavigationFromSearch','dashboardCommandTargetFromSearch'];
  const declarations=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)
    ||ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>['dashboardWorkspaces','workOrderIdPattern'].includes(value.name.getText(source))));
  const helpers=Function(`${compile(declarations.map(node=>node.getText(source)).join('\n'))}\nreturn {${names.join(',')}};`)();
  for(const [workspace,target,expected] of [['work',{kind:'customer',id:'new-customer'},{customerId:'new-customer'}],['work',{kind:'job',id:'new-job',jobTab:'quote'},{jobId:'new-job',jobTab:'quote'}],['forms',null,{}]]) {
    const changes=[];
    const callback=evaluate(effect.arguments[0],{...helpers,URL,window:{location:{href:'https://fixture.invalid/direct-trade/dashboard?workspace=work&customerId=old-customer&jobId=old-job&jobTab=summary'},history:{state:{},pushState:(_state,_title,href)=>changes.push(href),replaceState:(_state,_title,href)=>changes.push(href)}},
      commandTarget:target,workspace,activeWorkView:'today',financeView:'quotes',networkPostId:'',selectedOpportunityMatchId:'',workspaceRouteInitialised:{current:true},workspacePopstateSync:{current:false},workspaceLocation:{current:''}});
    callback();assert.equal(changes.length,1);
    const parameters=new URL(changes[0],'https://fixture.invalid').searchParams;
    for(const key of ['customerId','jobId','jobTab'])assert.equal(parameters.get(key),expected[key]||null,`${workspace}/${target?.kind||'none'} clears stale ${key}`);
  }
});

test('Sales opens the same job or quote through the existing guarded work destination', async () => {
  for (const tab of ['summary', 'quote']) {
    const flow = navigation();
    prop('onOpenJob', flow.context)('job-47', tab);
    await Promise.resolve();
    assert.deepEqual(flow.events.map(([kind]) => kind), ['workspace', 'target', 'view']);
    const target = flow.events.find(([kind]) => kind === 'target')[1];
    assert.equal(target.kind, 'job');
    assert.equal(target.workspace, 'work');
    assert.equal(target.id, 'job-47');
    assert.equal(target.jobTab, tab);
  }
});

test('a rejected Sales leave check prevents job, new quote and supplied-lead transitions', async () => {
  for (const name of ['onOpenJob', 'onNewQuote', 'onReviewSuppliedLeads']) {
    const flow = navigation();
    flow.guard.register(async () => { throw new Error('Draft retained'); });
    const callback = prop(name, { ...flow.context, hasLeadAccess: true });
    callback('job-47', 'quote');
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(flow.events, []);
  }
});

test('supplied lead teasers retain current permission and never copy private contact fields', () => {
  const opportunities = ['offered', 'viewed', 'interested', 'connected', 'closed'].map(matchStatus => ({ matchId: matchStatus, matchStatus, title: 'Roof enquiry', suburb: 'Geelong', state: 'VIC', privatePhone: 'PRIVATE', customerEmail: 'PRIVATE' }));
  assert.equal(prop('suppliedLeads', { hasLeadAccess: false, opportunities }), undefined);
  const teasers = prop('suppliedLeads', { hasLeadAccess: true, opportunities });
  assert.deepEqual(teasers, [
    { id: 'offered', title: 'Roof enquiry', detail: 'Geelong, VIC' },
    { id: 'viewed', title: 'Roof enquiry', detail: 'Geelong, VIC' },
  ]);
});
