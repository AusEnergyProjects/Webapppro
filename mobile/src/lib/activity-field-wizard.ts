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

type BookingDocumentField = { key: string; presentation?: 'question' | 'prefilled' | 'derived' };
type ActivitySignatureIdentity = { declarationKey: string };
type ActivityMissingIdentity = { key: string; kind: string };
type ActivitySignerDefaults = { signerDefaults?: { technician?: string; customer?: string } };

const hasOwn = (value: ActivityAnswers, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const baseAnswerKey = (key: string) => key.replace(/\[([1-9]|1[0-9])\]$/, '');

function sameAnswer(left: ActivityAnswers, right: ActivityAnswers, key: string) {
  return hasOwn(left, key) === hasOwn(right, key) && (!hasOwn(left, key) || left[key] === right[key]);
}

export function mergeActivityAnswers(
  base: ActivityAnswers,
  local: ActivityAnswers,
  remote: ActivityAnswers,
  remoteOwnedBaseKeys: ReadonlySet<string> = new Set(),
  conflictWinner: 'remote' | 'local' = 'remote',
) {
  const merged: ActivityAnswers = { ...remote };
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    if (remoteOwnedBaseKeys.has(baseAnswerKey(key))) continue;
    const localChanged = !sameAnswer(base, local, key);
    const remoteChanged = !sameAnswer(base, remote, key);
    if (localChanged && remoteChanged && !sameAnswer(local, remote, key)) {
      conflicts.push(key);
      if (conflictWinner === 'local') {
        if (hasOwn(local, key)) merged[key] = local[key];
        else delete merged[key];
      }
      continue;
    }
    if (!localChanged) continue;
    if (hasOwn(local, key)) merged[key] = local[key];
    else delete merged[key];
  }
  return { merged, conflicts };
}

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

export function activityBookingDocumentDeliveryState(fields: readonly BookingDocumentField[], answers: ActivityAnswers) {
  const receiptFields = fields.filter((field) => field.presentation === 'derived' && /(?:^|[._])booking_documents\./.test(field.key));
  const acceptance = receiptFields.find((field) => field.key.endsWith('.provider_accepted'));
  return {
    applicable: receiptFields.length > 0,
    accepted: Boolean(acceptance && answers[acceptance.key] === true),
  };
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
