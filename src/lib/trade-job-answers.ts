import type { BusinessFormField } from './trade-business-form-design.ts';
import type { ActivityRecord, ActivityEvidence } from './trade-activity-form-types.ts';
import { boundActivityDeclaration, expandedActivityFields, fieldConditionMet } from './trade-activity-form-flow.ts';
import { visibleTradeFormFields } from './trade-form-library.mjs';
import { CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT, creditexActivityWorkPackVisibilityMatches } from './creditex-activity-work-pack.ts';
import type { CreditexAssignedActivityWorkPackProjection } from './creditex-activity-work-pack-server.ts';
import { rentalInspectionAnswers, swmsAnswers, type RentalInspectionAnswerPayload, type SwmsAnswerPayload } from './trade-job-assessment-answers.ts';
import { ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET } from './trade-activity-field-policy.ts';
import { jobAnswerValue, type JobAnswerForm, type JobAnswerRow, type JobAnswerSection } from './trade-job-answer-view.ts';
export { jobAnswerValue, type JobAnswerForm, type JobAnswerRow, type JobAnswerSection } from './trade-job-answer-view.ts';

export type SavedBusinessForm = {
  id: string; templateName: string; templateVersion: number; status: string;
  completedAt?: string; updatedAt?: string;
  template: { fields: BusinessFormField[] };
  answers: Record<string, string | boolean>;
};
export type ActivityAnswerSummary = {
  id: string; intentId: string; title: string; programCode: string; status: string;
};
export type SavedActivityAnswers = Omit<ActivityRecord, 'evidence'> & {
  evidence: Omit<ActivityEvidence, 'objectKey' | 'previewObjectKey'>[];
};
export type JobAnswersResult = { forms: JobAnswerForm[]; errors: string[] };
export type JobAnswersRequest = <T>(path: string) => Promise<T>;
export class JobAnswersHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function addRow(sections: JobAnswerSection[], key: string, title: string, row: JobAnswerRow) {
  let section = sections.find(item => item.key === key);
  if (!section) { section = { key, title, rows: [] }; sections.push(section); }
  section.rows.push(row);
}

export function businessFormAnswers(form: SavedBusinessForm): JobAnswerForm {
  const sections: JobAnswerSection[] = [];
  for (const field of visibleTradeFormFields(form.template, form.answers) as BusinessFormField[]) {
    const title = `${field.section || 'Questions'}${field.phase === 'after' ? ' / After work' : ''}`;
    addRow(sections, `${field.phase || 'before'}:${field.section || 'Questions'}`, title, {
      key: field.key, question: field.label, answer: jobAnswerValue(form.answers[field.key]),
    });
  }
  return { key: `business:${form.id}`, title: form.templateName, source: 'Business form',
    status: form.status === 'complete' ? 'Complete' : 'Draft', version: form.templateVersion,
    recordedAt: form.completedAt || form.updatedAt, sections };
}

export function activityFormAnswers(record: SavedActivityAnswers): JobAnswerForm {
  const sections: JobAnswerSection[] = [];
  const afterSigned = record.signatures.some(signature => signature.phase === 'after');
  const beforeSigned = afterSigned || record.signatures.some(signature => signature.phase === 'before');
  for (const field of expandedActivityFields(record.form, record.answers)) {
    // Delivery receipts are machine-generated transport metadata, not form questions.
    if (ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET.has(field.baseKey)) continue;
    const title = `${field.section || 'Questions'}${field.phase === 'after' ? ' / After work' : ''}`;
    const files = record.evidence.filter(item => item.fieldKey === field.key);
    const refreshedProfile = record.status === 'draft' && field.presentation === 'derived'
      && /^(job|creditex)\./.test(field.autofill || '')
      && !(field.phase === 'before' ? beforeSigned : afterSigned)
      && jobAnswerValue(record.answers[field.key]) !== 'Not answered';
    addRow(sections, `${field.phase}:${field.section}`, title, {
      key: field.key,
      question: `${field.label}${field.repeatGroup ? ` (item ${field.repeatIndex + 1})` : ''}`,
      answer: field.type === 'photo' || field.type === 'document'
        ? files.map(item => item.fileName).join('\n') || 'No file attached'
        : jobAnswerValue(record.answers[field.key], field.optionLabels),
      note: [refreshedProfile ? 'Automatically supplied from job or profile details.' : '', field.help].filter(Boolean).join('\n') || undefined,
    });
  }
  for (const declaration of record.form.declarations) {
    if (!fieldConditionMet(declaration.condition, record.answers, record.form)) continue;
    const signatures = record.signatures.filter(item => item.declarationKey === declaration.key);
    addRow(sections, `declarations:${declaration.phase}`, `Declarations${declaration.phase === 'after' ? ' / After work' : ''}`, {
      key: declaration.key, question: declaration.title,
      note: boundActivityDeclaration(declaration, record.answers),
      answer: signatures.length ? 'Signed' : 'Not signed',
      signatures: signatures.map(item => ({ id: item.id, name: item.signerName, signedAt: item.signedAt, strokes: item.strokes })),
    });
  }
  return { key: `activity:${record.id}`, title: record.form.title, source: 'Activity form',
    status: record.status === 'submitted_for_creditex_review' ? 'Submitted for review' : 'Draft',
    version: record.form.version, recordedAt: record.submittedAt || record.updatedAt, sections };
}

export function workPackAnswers(pack: CreditexAssignedActivityWorkPackProjection): JobAnswerForm {
  const sections: JobAnswerSection[] = [];
  for (const section of [...pack.definition.schema.sections].sort((left, right) => left.order - right.order)) {
    if (!creditexActivityWorkPackVisibilityMatches(section.visibility, pack.response.answers)) continue;
    const instances = section.repeatability ? pack.response.repeatableSections[section.sectionKey] || []
      : [{ instanceKey: '', answers: pack.response.answers }];
    if (!instances.length) sections.push({ key: section.sectionKey, title: section.title, rows: [], emptyMessage: 'No items recorded.' });
    instances.forEach((instance, index) => {
      const rows: JobAnswerRow[] = [];
      for (const prompt of [...section.prompts].sort((left, right) => left.order - right.order)) {
        if (!creditexActivityWorkPackVisibilityMatches(prompt.visibility, pack.response.answers, instance.answers)) continue;
        const key = section.repeatability ? `${section.sectionKey}[${instance.instanceKey}].${prompt.promptKey}` : prompt.promptKey;
        const value = instance.answers[prompt.promptKey];
        const labels = Object.fromEntries(prompt.options.map(option => [option.value, option.label]));
        const row: JobAnswerRow = { key, question: prompt.label, note: prompt.attestation?.text || prompt.instructions || undefined,
          answer: jobAnswerValue(value, labels, prompt.unit) };
        if (prompt.type === 'photo' || prompt.type === 'document') {
          const ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
          row.answer = ids.map(id => pack.artifacts.find(item => item.id === id && item.promptKey === key)?.originalFileName
            || 'Saved file details unavailable').join('\n') || 'No file attached';
        } else if (prompt.type === 'signature') {
          const signatures = pack.signatures.filter(item => item.promptKey === key && item.signerRole === prompt.signerRoleKey && item.action === 'captured');
          row.answer = signatures.length ? 'Signed' : 'Not signed';
          row.signatures = signatures.map(item => ({ id: item.id, name: item.signerName, signedAt: item.signedAt, strokes: item.signaturePayload.strokes }));
        } else if (prompt.type === 'reference_document') {
          const references = pack.referenceDocuments.filter(item => item.responseKey === key);
          row.answer = references.length ? references.map(item => {
            const acknowledged = typeof value === 'object' && value !== null && !Array.isArray(value)
              && 'acknowledged' in value && value.acknowledged === true
              && 'contract' in value && value.contract === CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT
              && 'sourceArtifactId' in value && value.sourceArtifactId === item.sourceArtifactId;
            return `${item.title}${item.version ? ` (${item.version})` : ''}${item.acknowledgementMode === 'none' ? '' : acknowledged ? '\nAcknowledgement recorded' : '\nNot acknowledged'}`;
          }).join('\n')
            : 'No reference document attached';
        }
        rows.push(row);
      }
      if (rows.length) sections.push({ key: `${section.sectionKey}:${instance.instanceKey}`,
        title: section.repeatability ? `${section.title} / ${section.repeatability.itemLabel} ${index + 1}` : section.title, rows });
    });
  }
  const statuses = { not_started: 'Not started', in_progress: 'In progress', ready_to_sign: 'Ready to sign', completed: 'Complete', void: 'Void' };
  return { key: `pack:${pack.instance.id}`, title: pack.definition.title, source: 'Activity work pack',
    status: statuses[pack.instance.status], version: pack.definition.version, sections };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Please try again.';
}

/** Only existing records are read. Reviewing an unstarted activity must never open/create a draft. */
export async function loadJobAnswers(request: JobAnswersRequest, workOrderId: string): Promise<JobAnswersResult> {
  const id = encodeURIComponent(workOrderId);
  const sources = await Promise.allSettled([
    request<{ forms: SavedBusinessForm[] }>(`/api/trade-job-forms?workOrderId=${id}`),
    request<{ instances: CreditexAssignedActivityWorkPackProjection[] }>(`/api/trade-team/work-packs?workOrderId=${id}`),
    request<{ records: ActivityAnswerSummary[] }>(`/api/trade-activity-forms?workOrderId=${id}`),
    request<RentalInspectionAnswerPayload>(`/api/trade-rental-inspections?workOrderId=${id}`),
    request<SwmsAnswerPayload>(`/api/trade-swms?workOrderId=${id}`),
  ]);
  const forms: JobAnswerForm[] = [], errors: string[] = [];
  const [business, packs, activities, rental, swms] = sources;
  if (business.status === 'fulfilled' && Array.isArray(business.value.forms)) {
    for (const form of business.value.forms) {
      try { forms.push(businessFormAnswers(form)); }
      catch { errors.push(`A business form could not be displayed${form.templateName ? `: ${form.templateName}` : '.'}`); }
    }
  } else errors.push(`Business forms could not be loaded. ${business.status === 'rejected' ? failureMessage(business.reason) : 'Please try again.'}`);
  const packIntents = new Set<string>();
  if (packs.status === 'fulfilled' && Array.isArray(packs.value.instances)) {
    for (const pack of packs.value.instances) {
      try { forms.push(workPackAnswers(pack)); packIntents.add(pack.instance.complianceIntentId); }
      catch { errors.push('An activity work pack could not be displayed. Please try again.'); }
    }
  } else errors.push(`Activity work packs could not be loaded. ${packs.status === 'rejected' ? failureMessage(packs.reason) : 'Please try again.'}`);
  if (activities.status === 'fulfilled' && Array.isArray(activities.value.records)) {
    const results = await Promise.allSettled(activities.value.records.map(async summary => {
      if (!summary.id) return packIntents.has(summary.intentId) ? null : {
        key: `planned:${summary.intentId}`, title: summary.title, source: 'Activity form', status: 'Not started', sections: [],
        emptyMessage: 'This activity is attached to the job, but no form answers have been saved yet.',
      } satisfies JobAnswerForm;
      const detail = await request<{ record: SavedActivityAnswers }>(`/api/trade-activity-forms?recordId=${encodeURIComponent(summary.id)}`);
      if (!detail.record || detail.record.id !== summary.id || detail.record.workOrderId !== workOrderId) throw new Error('The saved form did not match this job.');
      return activityFormAnswers(detail.record);
    }));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') { if (result.value) forms.push(result.value); }
      else errors.push(`${activities.value.records[index].title || 'Activity form'} could not be loaded. ${failureMessage(result.reason)}`);
    });
  } else errors.push(`Activity forms could not be loaded. ${activities.status === 'rejected' ? failureMessage(activities.reason) : 'Please try again.'}`);
  if (rental.status === 'fulfilled') {
    try {
      if (!rental.value.inspection || !Array.isArray(rental.value.modules)) throw new Error('Please try again.');
      forms.push(...rentalInspectionAnswers(rental.value));
    } catch (error) { errors.push(`Assessment answers could not be displayed. ${failureMessage(error)}`); }
  } else if (!(rental.reason instanceof JobAnswersHttpError && rental.reason.status === 404 && rental.reason.message === 'Rental inspection not found.')) {
    errors.push(`Assessment forms could not be loaded. ${failureMessage(rental.reason)}`);
  }
  if (swms.status === 'fulfilled') {
    try {
      if (!('record' in swms.value)) throw new Error('Please try again.');
      const form = swmsAnswers(swms.value);
      if (form) forms.push(form);
    } catch (error) { errors.push(`Safe work method statement could not be displayed. ${failureMessage(error)}`); }
  } else errors.push(`Safe work method statement could not be loaded. ${failureMessage(swms.reason)}`);
  return { forms, errors };
}
