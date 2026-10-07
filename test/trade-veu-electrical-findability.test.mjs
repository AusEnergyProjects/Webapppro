import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = path => ts.createSourceFile(path, fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const descendants = node => { const result = [node]; node.forEachChild(child => { result.push(...descendants(child)); }); return result; };
const elements = (file, tag) => descendants(file).filter(node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(file) === tag);
const attribute = (element, name) => element.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.text === name);
const expression = (element, name, file) => attribute(element, name)?.initializer?.getText(file);
const ancestors = node => { const result = []; for (let parent = node.parent; parent; parent = parent.parent) result.push(parent); return result; };

test('Files exposes one exact-job electrical assessment ahead of the work panel and collapsed supporting forms', () => {
  const file = source('src/components/InstallerCrmWorkspace.tsx');
  const [assessment, ...duplicates] = elements(file, 'TradeVeuElectricalAssessmentPanel'); assert.ok(assessment); assert.equal(duplicates.length, 0);
  assert.equal(expression(assessment, 'workOrderId', file), '{job.id}');
  assert.equal(expression(assessment, 'user', file), '{user}');
  assert.equal(expression(assessment, 'readOnly', file), '{!canManageFieldEvidence}');
  const parents = ancestors(assessment);
  assert.ok(parents.some(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'activeTab === "files"'), 'The form is mounted only on Files');
  assert.ok(parents.some(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'canViewFieldEvidence'), 'Existing field-evidence visibility is preserved');
  assert.equal(parents.some(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'details'), false, 'The form is visible without opening a forms accordion');
  const work = elements(file, 'TradeFieldWorkPanel').find(node => expression(node, 'workOrderId', file) === '{job.id}');
  assert.ok(work && assessment.pos < work.pos); assert.equal(expression(work, 'showElectricalAssessment', file), '{false}', 'The embedded panel cannot render a duplicate');
  const supporting = elements(file, 'TradeJobFormsPanel').find(node => expression(node, 'workOrderId', file) === '{job.id}');
  assert.ok(supporting && assessment.pos < supporting.pos);
});

test('standalone field tools keep the assessment and both permission branches respect the explicit visibility choice', () => {
  const file = source('src/components/TradeFieldWorkPanel.tsx');
  const fn = descendants(file).find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TradeFieldWorkPanel');
  const binding = fn.parameters[0].name.elements.find(element => element.name.getText(file) === 'showElectricalAssessment');
  assert.equal(binding.initializer.kind, ts.SyntaxKind.TrueKeyword, 'Existing standalone behaviour is preserved by default');
  const assessments = elements(file, 'TradeVeuElectricalAssessmentPanel'); assert.equal(assessments.length, 2, 'One instance per mutually exclusive read/write return');
  for (const assessment of assessments) {
    assert.equal(expression(assessment, 'workOrderId', file), '{workOrderId}');
    assert.ok(ancestors(assessment).some(node => ts.isBinaryExpression(node) && node.left.getText(file) === 'showElectricalAssessment'));
  }
  assert.equal(attribute(assessments[0], 'readOnly').initializer, undefined, 'Read-only tools stay read-only');
  assert.equal(expression(assessments[1], 'readOnly', file), '{readOnly}');
});

test('the form library and job editor use the searchable insulation title and practical PIESA label', () => {
  const file = source('src/components/TradeVeuElectricalAssessmentPanel.tsx');
  const headings = descendants(file).filter(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'h3')
    .map(node => node.children.map(child => child.getText(file)).join(''));
  assert.equal(headings.filter(title => title === 'Pre-installation electrical safety assessment (Insulation)').length, 2);
  assert.match(file.text, /JOB SAFETY · PIESA/);
  assert.match(file.text, /find Pre-installation electrical safety assessment \(Insulation\) and choose Start assessment/);
});
