import { jobAnswerValue, type JobAnswerForm, type JobAnswerRow, type JobAnswerSection } from './trade-job-answer-view.ts';
import type { SwmsPayload } from './trade-swms.ts';
import { rentalAssessorFields, rentalObservationResponseLabel, RENTAL_QUOTATION_FIELDS } from './rental-quotation.mjs';
import { rentalAssessorCheckPresentation } from './rental-assessor-workflow.mjs';

export type SwmsAnswerPayload = SwmsPayload;
type AssessmentField = {
  key: string; label: string; type?: string; source?: string;
  options?: readonly { value: string; label: string }[];
};
type AssessmentCheck = {
  key: string; prompt: string; responseType?: string; repeatBy?: string;
  responseFields?: Array<{ key: string; label: string; required: boolean }>;
};
type AssessmentItem = {
  id: string; moduleId: string; sectionKey: string; checkKey: string;
  instanceKey: string; locationLabel: string; outcome: string;
  response: Record<string, unknown>; publicNotes?: string; internalNotes?: string;
};
type AssessmentFinding = {
  id: string; moduleId: string; itemId: string; title: string; description?: string;
  severity?: string; status?: string; recommendedAction?: string; scopeSummary?: string;
  quantityMilli?: number; unitLabel?: string; internalNotes?: string;
  details?: Record<string, unknown>;
};
export type RentalInspectionAnswerPayload = {
  inspection?: { id: string; status: string };
  modules?: Array<{
    id: string; title: string; status: string; templateVersion?: number; completedAt?: string; updatedAt?: string;
    template: { assessmentScope?: string; templateVersion?: number; metadataFields: AssessmentField[];
      sections: Array<{ key: string; title: string; checks: AssessmentCheck[] }> };
    answers: Record<string, unknown>;
  }>;
  items?: AssessmentItem[];
  findings?: AssessmentFinding[];
  evidence?: Array<{ id: string; moduleId: string; itemId: string; status: string; fileName: string; purpose?: string; caption?: string }>;
};

function hasAnswer(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
}
function labels(options?: readonly { value: string; label: string }[]): Record<string, string> {
  return Object.fromEntries((options || []).map(option => [option.value, option.label]));
}
function textValue(value: unknown, options?: readonly { value: string; label: string }[], unit = ''): string {
  if (!hasAnswer(value)) return 'Not answered';
  const answer = jobAnswerValue(value, labels(options));
  return unit && (typeof value === 'number' || typeof value === 'string') ? `${answer} ${unit}` : answer;
}
function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/^\w/, character => character.toUpperCase());
}

/** The GET payload contains the saved template and the immutable context for a signed SWMS. */
export function swmsAnswers(payload: SwmsAnswerPayload): JobAnswerForm | null {
  const record = payload.record;
  if (!record) return null;
  const context = record.context;
  const signature = record.signature;
  return {
    key: `swms:${record.id}`, title: record.templateName, source: 'Safe work method statement',
    status: record.status === 'complete' ? 'Signed' : 'Draft', version: record.templateVersion,
    recordedAt: record.completedAt || record.updatedAt,
    sections: [
      { key: 'context', title: 'Job details', rows: [
        { key: 'business', question: 'Business', answer: textValue(context.businessName) },
        { key: 'abn', question: 'ABN', answer: textValue(context.abn) },
        { key: 'job', question: 'Job', answer: textValue([context.workNumber, context.jobTitle].filter(Boolean).join(' · ')) },
        { key: 'address', question: 'Site address', answer: textValue(context.siteAddress) },
        { key: 'worker', question: 'Assigned worker', answer: textValue(context.scheduledWorker.name) },
      ] },
      { key: 'questions', title: 'Questions', rows: payload.template.fields.map(field => ({
        key: field.key, question: field.label, answer: textValue(record.answers[field.key]),
      })) },
      { key: 'declaration', title: 'Declaration', rows: [{
        key: 'signature', question: payload.template.declaration, answer: signature ? 'Signed' : 'Not signed',
        signatures: signature ? [{ id: `${record.id}:signature`, name: signature.signerName,
          signedAt: signature.signedAt, strokes: signature.strokes }] : [],
      }] },
    ],
  };
}

function findingRows(finding: AssessmentFinding): JobAnswerRow[] {
  const details = finding.details || {};
  const entries: Array<[string, string, unknown]> = [
    ['title', 'Finding', finding.title], ['description', 'Finding description', finding.description],
    ['severity', 'Severity', finding.severity ? humanize(finding.severity) : undefined],
    ['status', 'Finding status', finding.status ? humanize(finding.status) : undefined],
    ['action', 'Recommended action', finding.recommendedAction], ['scope', 'Scope of work', finding.scopeSummary],
    ['quantity', 'Quantity', finding.quantityMilli === undefined ? undefined : `${finding.quantityMilli / 1000}${finding.unitLabel ? ` ${finding.unitLabel}` : ''}`],
    ['immediateAction', 'Make-safe or isolation action', details.immediateAction],
    ['notificationRecipient', 'Who was notified', details.notificationRecipient],
    ['notificationTime', 'When they were notified', details.notificationTime],
    ['internalNotes', 'Internal finding note', finding.internalNotes],
  ];
  const quotation = details.quotation;
  if (quotation && typeof quotation === 'object' && !Array.isArray(quotation)) {
    for (const field of RENTAL_QUOTATION_FIELDS) {
      if (field.key in quotation) entries.push([`quotation:${field.key}`, field.label, Reflect.get(quotation, field.key)]);
    }
    if ('missingInformation' in quotation) entries.push(['quotation:missingInformation', 'Recorded assessment limitation', quotation.missingInformation]);
  }
  return entries.filter(([, , value]) => hasAnswer(value)).map(([key, question, value]) => ({
    key: `finding:${finding.id}:${key}`, question, answer: textValue(value),
  }));
}

/** Read stored observations directly. Never initialise an assessment or synthesise completed answers. */
export function rentalInspectionAnswers(payload: RentalInspectionAnswerPayload): JobAnswerForm[] {
  const inspection = payload.inspection;
  if (!inspection) return [];
  return (payload.modules || []).map(module => {
    const moduleItems = (payload.items || []).filter(item => item.moduleId === module.id);
    const frozen = module.status === 'complete' || ['issuing', 'issued', 'superseded', 'withdrawn'].includes(inspection.status);
    const sections: JobAnswerSection[] = [];
    if (module.template.metadataFields.length) sections.push({ key: 'details', title: 'Assessment details',
      rows: module.template.metadataFields.map(field => ({
        key: field.key, question: field.label, answer: textValue(module.answers[field.key], field.options),
        note: !frozen && field.source === 'team_profile' ? 'Current team profile detail.'
          : !frozen && field.source === 'automatic' ? 'Automatically provided assessment date.' : undefined,
      })),
    });
    for (const section of module.template.sections) {
      const rows: JobAnswerRow[] = [];
      for (const check of section.checks) {
        const items = moduleItems.filter(item => item.sectionKey === section.key && item.checkKey === check.key);
        if (!items.length) {
          rows.push({ key: check.key, question: check.prompt, answer: 'Not answered',
            note: check.repeatBy && check.repeatBy !== 'property' ? 'No items recorded.' : undefined });
          continue;
        }
        items.forEach((item, index) => {
          const prefix = `${check.key}:${item.id}`;
          const location = item.locationLabel || (items.length > 1 ? `Item ${index + 1}` : '');
          const presentation = rentalAssessorCheckPresentation(check, {
            assessmentScope: module.template.assessmentScope, outcome: item.outcome, publicNotes: item.publicNotes, response: item.response,
          });
          rows.push({ key: prefix, question: `${check.prompt}${location ? ` (${location})` : ''}`,
            answer: textValue(item.outcome, presentation.outcomeOptions) });
          const responseFields = rentalAssessorFields(check);
          const knownKeys = new Set(responseFields.map(field => field.key));
          for (const field of responseFields) {
            const value = item.response[field.key];
            const applicable = (!field.showForOutcomes || field.showForOutcomes.includes(item.outcome))
              && (!field.showIf || field.showIf.values.includes(String(item.response[field.showIf.key] ?? '')));
            if ((!applicable || field.legacy) && !hasAnswer(value)) continue;
            rows.push({ key: `${prefix}:${field.key}`, question: field.label, answer: textValue(value, field.options, field.unit),
              note: !applicable ? 'Saved answer from an earlier selection.' : undefined });
          }
          for (const [key, value] of Object.entries(item.response)) {
            if (!knownKeys.has(key) && !['roomId', 'showerCaptureVersion'].includes(key) && hasAnswer(value)) rows.push({ key: `${prefix}:extra:${key}`,
              question: rentalObservationResponseLabel(key), answer: textValue(value) });
          }
          if (hasAnswer(item.publicNotes)) rows.push({ key: `${prefix}:notes`, question: 'Report detail', answer: textValue(item.publicNotes) });
          if (hasAnswer(item.internalNotes)) rows.push({ key: `${prefix}:internal`, question: 'Internal assessment note', answer: textValue(item.internalNotes) });
          for (const finding of (payload.findings || []).filter(entry => entry.moduleId === module.id && entry.itemId === item.id)) {
            rows.push(...findingRows(finding));
          }
          const evidence = (payload.evidence || []).filter(entry => entry.moduleId === module.id && entry.itemId === item.id && entry.status === 'active');
          if (evidence.length) rows.push({ key: `${prefix}:evidence`, question: 'Attached evidence',
            answer: evidence.map(entry => [entry.fileName, entry.purpose, entry.caption].filter(Boolean).join(' · ')).join('\n') });
        });
      }
      sections.push({ key: section.key, title: section.title, rows });
    }
    return { key: `rental:${module.id}`, title: module.title, source: 'Rental assessment',
      status: module.status === 'complete' ? 'Complete' : humanize(module.status),
      version: module.templateVersion || module.template.templateVersion, recordedAt: module.completedAt || module.updatedAt, sections };
  });
}
