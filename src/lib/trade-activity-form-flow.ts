import type { ActivityAnswers, ActivityCondition, ActivityDeclaration, ActivityField, ActivityForm } from './trade-activity-form-types';

// Only answers changed on this device replace the latest record. Unrelated office
// edits and system-owned values remain current, including when a save races a sync.
export function mergeActivityAnswers(base: ActivityAnswers, local: ActivityAnswers, remote: ActivityAnswers,
  remoteOwnedBaseKeys: ReadonlySet<string> = new Set(), conflictWinner: 'remote' | 'local' = 'local') {
  const merged: ActivityAnswers = { ...remote };
  const conflicts: string[] = [];
  const same = (left: ActivityAnswers, right: ActivityAnswers, key: string) =>
    Object.hasOwn(left, key) === Object.hasOwn(right, key) && left[key] === right[key];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    if (remoteOwnedBaseKeys.has(activityBaseFieldKey(key)) || same(base, local, key)) continue;
    if (!same(base, remote, key) && !same(local, remote, key)) {
      conflicts.push(key);
      if (conflictWinner === 'remote') continue;
    }
    if (Object.hasOwn(local, key)) merged[key] = local[key];
    else delete merged[key];
  }
  return { merged, conflicts };
}

export const activityBaseFieldKey = (key: string) => key.replace(/\[([1-9]|1[0-9])\]$/, '');
export const activityRepeatKey = (key: string, index: number) => index ? `${key}[${index}]` : key;
export function activityRepeatCount(form: ActivityForm, answers: ActivityAnswers, group: string) {
  if (!form.fields.some((field) => field.repeatGroup === group)) return 1;
  const value = answers[`$repeat.${group}`];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20 ? value : 1;
}
export function fieldConditionMet(condition: ActivityCondition | undefined, answers: ActivityAnswers, form?: ActivityForm, group?: string, index = 0): boolean {
  if (!condition) return true;
  if (condition.all) return condition.all.every((item) => fieldConditionMet(item, answers, form, group, index));
  if (condition.any) return condition.any.some((item) => fieldConditionMet(item, answers, form, group, index));
  if (!condition.fieldKey) return false;
  const sameGroup = group && form?.fields.some((field) => field.key === condition.fieldKey && field.repeatGroup === group);
  const value = answers[sameGroup ? activityRepeatKey(condition.fieldKey, index) : condition.fieldKey];
  if (value === undefined || value === '') return false;
  if (condition.lessThanOrEqual !== undefined) {
    return typeof value === 'number' && Number.isFinite(value) && value <= condition.lessThanOrEqual;
  }
  return condition.notEquals !== undefined ? String(value).toLowerCase() !== String(condition.notEquals).toLowerCase()
    : String(value).toLowerCase() === String(condition.equals).toLowerCase();
}
export type ExpandedActivityField = ActivityField & { baseKey: string; repeatIndex: number };
export function expandedActivityFields(form: ActivityForm, answers: ActivityAnswers): ExpandedActivityField[] {
  const result: ExpandedActivityField[] = [];
  const groups = new Set<string>();
  for (const phase of ['before', 'after'] as const) for (const field of form.fields.filter((item) => item.phase === phase)) {
    if (field.repeatGroup) {
      const groupId = `${phase}:${field.section}:${field.repeatGroup}`;
      if (groups.has(groupId)) continue;
      groups.add(groupId);
      for (let index = 0; index < activityRepeatCount(form, answers, field.repeatGroup); index++) {
        for (const member of form.fields.filter((item) => item.phase === phase && item.section === field.section && item.repeatGroup === field.repeatGroup)) {
          if (fieldConditionMet(member.condition, answers, form, member.repeatGroup, index)) result.push({ ...member, key: activityRepeatKey(member.key, index), baseKey: member.key, repeatIndex: index });
        }
      }
    } else if (fieldConditionMet(field.condition, answers, form)) result.push({ ...field, baseKey: field.key, repeatIndex: 0 });
  }
  return result;
}
export function boundActivityDeclaration(declaration: ActivityDeclaration, answers: ActivityAnswers) {
  return declaration.text.replace(/\{\{([^{}]+)\}\}/g, (token, key: string) => {
    const value = answers[`binding.${key}`];
    return value === undefined || value === '' ? token : String(value);
  });
}

export type ActivityWizardStep = { key: string; kind: 'field'; field: ExpandedActivityField } | { key: string; kind: 'signature'; declaration: ActivityDeclaration } | { key: 'review'; kind: 'review' };
const visibleActivityWizardFields = (form: ActivityForm, answers: ActivityAnswers) => expandedActivityFields(form, answers)
  .filter((field) => field.presentation !== 'derived'
    && !/^job\.(?:assignee|trade|credential|credentialType)\./.test(field.autofill || ''));

export function activityWizardSteps(form: ActivityForm, answers: ActivityAnswers): ActivityWizardStep[] {
  const steps: ActivityWizardStep[] = [];
  const fields = visibleActivityWizardFields(form, answers);
  for (const phase of ['before', 'after'] as const) {
    steps.push(...fields.filter((field) => field.phase === phase).map((field): ActivityWizardStep => ({ key: field.key, kind: 'field', field })));
    for (const declaration of form.declarations.filter((item) => item.phase === phase && fieldConditionMet(item.condition, answers))) {
      steps.push({ key: declaration.key, kind: 'signature', declaration });
    }
  }
  return [...steps, { key: 'review', kind: 'review' }];
}

export const ACTIVITY_WIZARD_PAGE_FIELD_LIMIT = 5;
export type ActivityWizardPage =
  | { key: string; kind: 'fields'; phase: ActivityField['phase']; section: string;
    fields: ExpandedActivityField[]; legacyStepKeys: string[] }
  | { key: string; kind: 'signature'; phase: ActivityDeclaration['phase']; declaration: ActivityDeclaration;
    legacyStepKeys: string[] }
  | { key: 'review'; kind: 'review'; legacyStepKeys: ['review'] };

/**
 * Groups the existing conditional/repeating field stream into short pages without
 * changing field keys. A repeated item remains together where its field count
 * allows, and declarations and final review always keep their own pages.
 */
export function activityWizardPages(form: ActivityForm, answers: ActivityAnswers): ActivityWizardPage[] {
  const pages: ActivityWizardPage[] = [];
  const fields = visibleActivityWizardFields(form, answers);
  for (const phase of ['before', 'after'] as const) {
    let pageFields: ExpandedActivityField[] = [];
    let pageIdentity = '';
    const flush = () => {
      if (!pageFields.length) return;
      pages.push({ key: pageFields[0].key, kind: 'fields', phase, section: pageFields[0].section,
        fields: pageFields, legacyStepKeys: pageFields.map((field) => field.key) });
      pageFields = [];
      pageIdentity = '';
    };
    for (const field of fields.filter((item) => item.phase === phase)) {
      const identity = field.repeatGroup
        ? `${field.section}\u0000${field.repeatGroup}\u0000${field.repeatIndex}`
        : `${field.section}\u0000single`;
      if (pageFields.length && (pageIdentity !== identity || pageFields.length >= ACTIVITY_WIZARD_PAGE_FIELD_LIMIT)) flush();
      if (!pageFields.length) pageIdentity = identity;
      pageFields.push(field);
    }
    flush();
    for (const declaration of form.declarations.filter((item) => item.phase === phase && fieldConditionMet(item.condition, answers))) {
      pages.push({ key: declaration.key, kind: 'signature', phase, declaration, legacyStepKeys: [declaration.key] });
    }
  }
  return [...pages, { key: 'review', kind: 'review', legacyStepKeys: ['review'] }];
}

/** Resolves both current page keys and the former one-question step keys. */
export function activityWizardPageForStepKey(pages: readonly ActivityWizardPage[], requestedStepKey: string) {
  const declarationKey = requestedStepKey.replace(/:read:\d+$/, '');
  return pages.find((page) => page.key === requestedStepKey
    || page.legacyStepKeys.some((key) => key === requestedStepKey)
    || page.kind === 'signature' && page.key === declarationKey);
}
