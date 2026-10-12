import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as catalogue from '../src/lib/energy-service-catalogue.mjs';

const read = path => readFileSync(new URL(path, import.meta.url),'utf8');
const admin = read('../src/components/AdminFormTemplates.tsx'), governance = read('../src/components/CreditexActivityWorkPackGovernance.tsx');
function declarations(source, componentName, names) {
  const ast = ts.createSourceFile('component.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === componentName);
  return names.map(name => {
    const node = component.body.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node,`Expected ${name}`); return node.getText(ast);
  }).join('\n');
}
function compileDeclarations(source, context, names) {
  const output = ts.transpileModule(source,{ compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(context),`${output};return {${names.join(',')}}`)(...Object.values(context));
}
test('created supporting forms offer compliance editing to authorised authors, excluding built-in report forms', () => {
  const savedTemplate = { id: 'created-template', templateKey: 'battery-check', version: 1, name: 'Synthetic created form', jurisdiction: 'AU', categories: ['battery'], description: 'Created review form', guidance: 'Record findings', fields: [], sourceNotes: 'Reviewed internally', status: 'published', publishedAt: '2026-10-12', updatedAt: '2026-10-12' };
  const react = { ...React, useState: initial => React.useState(Array.isArray(initial) && !initial.length ? [savedTemplate] : initial) };
  const result = { exports:{} }, imports = { 'react':react,'react/jsx-runtime':jsx,
    '@/lib/energy-service-catalogue.mjs':catalogue,
    './FormCompliancePanel':{ FormComplianceEditor:() => React.createElement('div',null,'Reviewer questions') } };
  const output = ts.transpileModule(admin,{ compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require','module','exports',output)(key => { assert.ok(key in imports,key);return imports[key]; },result,result.exports);
  const owner = renderToStaticMarkup(React.createElement(result.exports.AdminFormTemplates,{ api:async () => assert.fail('SSR must not fetch private data'),role:'owner' }));
  const reviewer = renderToStaticMarkup(React.createElement(result.exports.AdminFormTemplates,{ api:async () => assert.fail('SSR must not fetch private data'),role:'reviewer' }));
  assert.match(owner,/Synthetic created form/); assert.match(owner,/>Compliance checks</);
  assert.doesNotMatch(owner,/Built-in supporting forms/);
  assert.doesNotMatch(reviewer,/>Compliance checks</);
  assert.doesNotMatch(owner,/Test person|Foreign person|@example/);
  assert.match(admin,/formKey=\{`creditex-job-form:\$\{complianceKey\}`\}/);
  assert.match(admin,/onDirtyChange=\{reportComplianceDirty\}/);
});
test('declining a questionnaire switch keeps its unsaved changes and selection; confirming clears only that questionnaire', () => {
  const writes = [], dirty = { current:true };
  const source = declarations(admin,'AdminFormTemplates',['selectCompliance']);
  const make = accepted => compileDeclarations(source,{ complianceKey:'old',complianceDirty:dirty,window:{ confirm:() => accepted },
    reportComplianceDirty:value => writes.push(['dirty',value]),setComplianceKey:value => writes.push(['key',value]) },['selectCompliance']);
  make(false).selectCompliance('new'); assert.deepEqual(writes,[]);
  make(true).selectCompliance('new'); assert.deepEqual(writes,[['dirty',false],['key','new']]);
});
test('work-pack compliance uses stable activity keys, preserves unsaved selection on decline and keeps field form dirty status', () => {
  assert.match(governance,/formKey=\{`work-pack:\$\{complianceTemplateId\}`\}/);
  assert.match(governance,/actorMode=\{endpoint\.startsWith\('\/api\/admin\/'\) \? 'admin' : 'compliance'\}/);
  assert.match(governance,/onDirtyChange=\{reportWorkPackComplianceDirty\}/);
  assert.match(governance,/snapshot\.access\.canAuthor && \['draft', 'published'\]\.includes\(version\.state\)/);
  const source = declarations(governance,'CreditexActivityWorkPackGovernance',['closeWorkPackCompliance','openWorkPackCompliance']);
  const writes = [], dirty = { current:true };
  const make = accepted => compileDeclarations(source,{ complianceTemplateId:'old',workPackComplianceDirty:dirty,window:{ confirm:() => accepted },
    reportWorkPackComplianceDirty:value => writes.push(['dirty',value]),setComplianceTemplateId:value => writes.push(['key',value]) },['closeWorkPackCompliance','openWorkPackCompliance']);
  make(false).openWorkPackCompliance({ schema:{ activityTemplateId:'new' } }); assert.deepEqual(writes,[]);
  make(true).openWorkPackCompliance({ schema:{ activityTemplateId:'new' } }); assert.deepEqual(writes,[['dirty',false],['key',''],['key','new']]);
  const ast = ts.createSourceFile('governance.tsx',governance,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CreditexActivityWorkPackGovernance');
  const callbacks = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .filter(node => ['reportFieldFormDirty','reportWorkPackComplianceDirty'].includes(node.name.getText(ast)));
  const field = { current:false }, pack = { current:false }, notifications = [];
  const compiled = compileDeclarations(callbacks.map(node => `const ${node.name.getText(ast)}=${node.initializer.arguments[0].getText(ast)};`).join('\n'),
    { fieldFormDirty:field,workPackComplianceDirty:pack,onFieldFormDirtyChange:value => notifications.push(value) },['reportFieldFormDirty','reportWorkPackComplianceDirty']);
  compiled.reportFieldFormDirty(true); compiled.reportWorkPackComplianceDirty(true); compiled.reportFieldFormDirty(false); compiled.reportWorkPackComplianceDirty(false);
  assert.deepEqual(notifications,[true,true,true,false]);
});
test('admin tab and portal transitions respect independent supporting questionnaire and activity form leave guards', () => {
  const portal = read('../src/components/AdminOperationsPortal.tsx');
  assert.match(portal,/const supportingFormComplianceDirty = useRef\(false\)/);
  assert.match(portal,/onDirtyChange=\{reportSupportingFormComplianceDirty\}/);
  const ast = ts.createSourceFile('portal.tsx',portal,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AdminOperationsPortal');
  const select = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(ast) === 'selectTab');
  const tabWrites = [], output = ts.transpileModule(`const selectTab=${select.initializer.arguments[0].getText(ast)};`,{ compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None } }).outputText;
  const fn = new Function('tab','callActive','questionnaireDirty','fieldFormDirty','supportingFormComplianceDirty','auditDirty','window','setTab',`${output};return selectTab`)(
    'form-governance',{ current:false },{ current:false },{ current:false },{ current:true },{ current:false },{ confirm:() => false },value => tabWrites.push(value));
  assert.equal(fn('overview'),false); assert.deepEqual(tabWrites,[]);
});

test('portal sign out preserves unsaved compliance questions and reviews unless discard is confirmed', () => {
  for (const file of ['AdminOperationsPortal', 'CreditexCompliancePortal']) {
    const source = read(`../src/components/${file}.tsx`);
    const ast = ts.createSourceFile('portal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler;
    function visit(node) { if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onSignOut') handler = node.initializer.expression; ts.forEachChild(node, visit); }
    visit(ast); assert.ok(handler);
    const output = ts.transpileModule(`const leave=${handler.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    for (const dirtyName of file === 'AdminOperationsPortal' ? ['fieldFormDirty', 'supportingFormComplianceDirty', 'auditDirty'] : ['fieldFormDirty', 'auditDirty']) {
      let signOuts = 0;
      const context = { callActive: { current: false }, fieldFormDirty: { current: false }, supportingFormComplianceDirty: { current: false }, auditDirty: { current: false }, firebaseAuth: {}, signOut: () => signOuts++, window: { confirm: () => false } };
      context[dirtyName].current = true;
      const leave = new Function(...Object.keys(context), `${output};return leave`)(...Object.values(context));
      leave(); assert.equal(signOuts, 0, `${file} keeps ${dirtyName}`);
      context.window.confirm = () => true; leave(); assert.equal(signOuts, 1, `${file} allows an explicit discard`);
    }
  }
});
