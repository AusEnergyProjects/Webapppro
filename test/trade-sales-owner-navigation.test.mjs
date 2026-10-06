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
