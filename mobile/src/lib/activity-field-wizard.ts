export { mergeActivityAnswers } from '../../../src/lib/trade-activity-form-flow';

type ActivityAnswer = string | number | boolean;
type ActivityAnswers = Record<string, ActivityAnswer>;

type ProgressField = {
  key: string;
  section: string;
  phase: 'before' | 'after';
  type: string;
  required: boolean;
  requiredValue?: ActivityAnswer;
};

type ProgressStep =
  | { key: string; kind: 'field'; field: ProgressField }
  | { key: string; kind: 'signature'; declaration: { key: string; required: boolean } }
  | { key: string; kind: 'declaration' | 'review' };

type ProgressFieldStep = Extract<ProgressStep, { kind: 'field' }>;
type ProgressSignatureStep = Extract<ProgressStep, { kind: 'signature' }>;
type RequiredProgressStep = ProgressFieldStep | ProgressSignatureStep;

type ActivitySignatureIdentity = { declarationKey: string };
type ActivityMissingIdentity = { key: string; kind: string };
type ActivitySignerDefaults = { signerDefaults?: { technician?: string; customer?: string } };

export function activityOptionLabel(value: string, explicit?: string) {
  const supplied = explicit?.trim();
  if (supplied) return supplied;
  const raw = value.trim();
  if (!raw) return '';
  if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi)$/i.test(raw)) return `Scenario ${raw.toUpperCase()}`;
  if (raw === 'retain_unsafe_or_impractical') return 'Retain because removal is unsafe or impractical';
  if (/^(n_?a|not_applicable)$/i.test(raw)) return 'Not applicable';
  const readable = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function activityCurrentSignatureKeys(
  signatures: readonly ActivitySignatureIdentity[],
  missing: readonly ActivityMissingIdentity[],
) {
  const invalid = new Set(missing.filter((item) => item.kind === 'signature').map((item) => item.key));
  return new Set(signatures.filter((signature) => !invalid.has(signature.declarationKey)).map((signature) => signature.declarationKey));
}

export function activitySignerDefault(record: ActivitySignerDefaults, role: string) {
  if (role === 'technician') return record.signerDefaults?.technician || '';
  if (role === 'customer') return record.signerDefaults?.customer || '';
  return '';
}

function answered(value: ActivityAnswer | undefined) {
  return value !== undefined && value !== '';
}

function isRequiredProgressStep(step: ProgressStep): step is RequiredProgressStep {
  if (step.kind === 'field') return step.field.required;
  if (step.kind === 'signature') return step.declaration.required;
  return false;
}

function activityProgressFieldComplete(
  field: ProgressField,
  answers: ActivityAnswers,
  evidenceFieldKeys: ReadonlySet<string>,
) {
  if (field.type === 'photo' || field.type === 'document') return evidenceFieldKeys.has(field.key);
  const value = answers[field.key];
  return field.requiredValue === undefined ? answered(value) : value === field.requiredValue;
}

export function activityProgress(
  steps: readonly ProgressStep[],
  answers: ActivityAnswers,
  evidenceFieldKeys: ReadonlySet<string>,
  signatureDeclarationKeys: ReadonlySet<string>,
) {
  // The supplied wizard steps are already condition-filtered. Declaration pages and
  // optional steps remain in that list for navigation, but do not represent required work.
  const required = steps.filter(isRequiredProgressStep);
  const isComplete = (step: RequiredProgressStep) => {
    if (step.kind === 'signature') return signatureDeclarationKeys.has(step.declaration.key);
    return activityProgressFieldComplete(step.field, answers, evidenceFieldKeys);
  };
  return { complete: required.filter(isComplete).length, total: required.length };
}

export function activitySectionProgress(
  steps: readonly ProgressStep[],
  answers: ActivityAnswers,
  evidenceFieldKeys: ReadonlySet<string>,
) {
  const sections = new Map<string, { key: string; phase: 'before' | 'after'; label: string; firstStepKey: string; complete: number; total: number }>();
  for (const step of steps) {
    if (step.kind !== 'field') continue;
    const key = `${step.field.phase}:${step.field.section}`;
    const section = sections.get(key) || { key, phase: step.field.phase, label: step.field.section, firstStepKey: step.key, complete: 0, total: 0 };
    if (!step.field.required) {
      sections.set(key, section);
      continue;
    }
    section.total += 1;
    if (activityProgressFieldComplete(step.field, answers, evidenceFieldKeys)) {
      section.complete += 1;
    }
    sections.set(key, section);
  }
  return [...sections.values()];
}
