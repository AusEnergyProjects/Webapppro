import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function loadModule(source, fileName) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName,
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function('require', 'module', 'exports', output)(
    (specifier) => {
      throw new Error(`Unexpected runtime dependency: ${specifier}`);
    },
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function sourceFunction(source, name) {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration, `missing ${name}`);
  return declaration.getText(sourceFile);
}

function executableFunction(source, name, dependencies = {}) {
  const output = ts.transpileModule(
    sourceFunction(source, name).replace(/^export\s+/, ''),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    },
  ).outputText;
  return Function(
    ...Object.keys(dependencies),
    `${output}; return ${name};`,
  )(...Object.values(dependencies));
}

const complianceSource = read('../src/lib/compliance.ts');
const evidenceSource = read('../src/lib/evidence.ts');
const jobScreen = read('../src/app/job/[id].tsx');
const {
  complianceCasesForJob,
  governedEvidenceBinding,
} = loadModule(complianceSource, 'compliance.ts');

const stcRequirement = {
  id: 'requirement-stc-photo',
  code: 'STC-PHOTO',
};
const veecRequirement = {
  id: 'requirement-veec-photo',
  code: 'VEEC-PHOTO',
};
const stcCase = {
  caseId: 'case-stc',
  caseNumber: 'STC-001',
  activityVersionId: 'activity-stc',
  activityCode: 'STC',
  activityTitle: 'Air-source heat-pump water heater',
  evidencePolicyVersionId: 'policy-stc',
  requirements: [stcRequirement],
};
const veecCase = {
  caseId: 'case-veec',
  caseNumber: 'VEEC-001',
  activityVersionId: 'activity-veec',
  activityCode: 'VEEC 1D',
  activityTitle: 'Water heating activity',
  evidencePolicyVersionId: 'policy-veec',
  requirements: [veecRequirement],
};

test('two compliance cases remain separate even when the legacy singular field is present', () => {
  const cases = complianceCasesForJob({
    complianceCases: [stcCase, veecCase],
    compliance: stcCase,
  });
  assert.deepEqual(cases.map((item) => item.caseId), ['case-stc', 'case-veec']);
  assert.equal(cases[0], stcCase);
  assert.equal(cases[1], veecCase);
  assert.match(jobScreen, /complianceCases\.map\(\(complianceCase, index\)/);
  assert.match(jobScreen, /key=\{complianceCase\.caseId\}/);
});

test('each requirement binds only to its own case, activity and policy', () => {
  const evidenceIdentifiers = executableFunction(
    evidenceSource,
    'evidenceIdentifiers',
    { governedEvidenceBinding },
  );
  assert.deepEqual(
    governedEvidenceBinding({
      complianceCase: stcCase,
      requirement: stcRequirement,
    }),
    {
      complianceCaseId: 'case-stc',
      complianceActivityVersionId: 'activity-stc',
      evidencePolicyVersionId: 'policy-stc',
      evidenceRequirementId: 'requirement-stc-photo',
      evidenceRequirementCode: 'STC-PHOTO',
    },
  );
  assert.deepEqual(
    governedEvidenceBinding({
      complianceCase: veecCase,
      requirement: veecRequirement,
    }),
    {
      complianceCaseId: 'case-veec',
      complianceActivityVersionId: 'activity-veec',
      evidencePolicyVersionId: 'policy-veec',
      evidenceRequirementId: 'requirement-veec-photo',
      evidenceRequirementCode: 'VEEC-PHOTO',
    },
  );
  assert.throws(
    () => governedEvidenceBinding({
      complianceCase: stcCase,
      requirement: veecRequirement,
    }),
    /does not belong to the selected compliance case/,
  );
  assert.deepEqual(
    evidenceIdentifiers(
      { id: 'job-1' },
      { complianceCase: veecCase, requirement: veecRequirement },
    ),
    {
      jobId: 'job-1',
      complianceCaseId: 'case-veec',
      complianceActivityVersionId: 'activity-veec',
      evidencePolicyVersionId: 'policy-veec',
      evidenceRequirementId: 'requirement-veec-photo',
      evidenceRequirementCode: 'VEEC-PHOTO',
    },
  );
  assert.deepEqual(
    evidenceIdentifiers({ id: 'job-1' }),
    {
      jobId: 'job-1',
      complianceCaseId: '',
      complianceActivityVersionId: '',
      evidencePolicyVersionId: '',
      evidenceRequirementId: '',
      evidenceRequirementCode: '',
    },
  );
  assert.match(jobScreen, /onPhoto=\{\(selection\) => void capturePhoto\(selection\)\}/);
  assert.match(jobScreen, /onDocument=\{\(selection\) => void chooseDocument\(selection\)\}/);
});

test('a legacy singular compliance job still exposes one governed case', () => {
  assert.deepEqual(
    complianceCasesForJob({ compliance: stcCase }).map((item) => item.caseId),
    ['case-stc'],
  );
  assert.deepEqual(
    complianceCasesForJob({ complianceCases: [], compliance: stcCase })
      .map((item) => item.caseId),
    ['case-stc'],
  );
});

test('governed evidence cannot be queued with a partial or unbound identifier set', () => {
  const validate = executableFunction(evidenceSource, 'validateEvidenceIdentifiers');
  const general = {
    jobId: 'job-1',
    complianceCaseId: '',
    complianceActivityVersionId: '',
    evidencePolicyVersionId: '',
    evidenceRequirementId: '',
    evidenceRequirementCode: '',
  };
  assert.equal(validate(general), general);
  assert.throws(
    () => validate({
      ...general,
      complianceCaseId: 'case-stc',
      evidenceRequirementId: 'requirement-stc-photo',
    }),
    /must be bound to one complete case, activity, policy and requirement/,
  );
  assert.throws(
    () => validate({
      ...general,
      evidenceRequirementCode: undefined,
    }),
    /identifiers are malformed/,
  );
  assert.doesNotThrow(() => validate({
    ...general,
    ...governedEvidenceBinding({
      complianceCase: stcCase,
      requirement: stcRequirement,
    }),
  }));
  assert.match(evidenceSource, /validateEvidenceIdentifiers\(input\.identifiers\)/);
  assert.match(jobScreen, /General job files remain separate and are not submitted against a governed requirement/);
});

test('field completion waits for required submissions, not later audit acceptance', () => {
  assert.match(
    jobScreen,
    /requirement\.submittedCount < requirement\.minimumCount/,
  );
  assert.doesNotMatch(
    jobScreen,
    /governedEvidenceIncomplete[\s\S]{0,300}acceptedCount < requirement\.minimumCount/,
  );
});
