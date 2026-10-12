/** A second, reviewer-only questionnaire. Installer answers and approvals are separate. */
export type FormComplianceScope = 'business' | 'creditex';
export type FormComplianceQuestion = { key: string; label: string; required: boolean; sourceFieldKey?: string };
export type FormComplianceAnswer = { key: string; response: 'pass' | 'fail' | 'na' | 'unchecked'; note: string };
export type FormComplianceTemplate = { formKey: string; title: string; revision: number; questions: FormComplianceQuestion[] };
export type FormComplianceReview = { revision: number; status: 'draft' | 'complete'; answers: FormComplianceAnswer[];
  actorName: string; createdAt: string; sourceHash: string; templateRevision: number };
export type FormComplianceWorkspace = { template: FormComplianceTemplate;
  source: { id: string; title: string; revision: number; hash: string; answers: Array<{ key: string; label: string; value: unknown }> };
  review: FormComplianceReview | null; canReview: boolean; stale: boolean };
export type FormComplianceQueueItem = { formId: string; workOrderId: string; title: string; jobNumber: string;
  status: 'not_started' | 'draft' | 'complete' | 'stale' };
export type FormComplianceQueuePage = { items: FormComplianceQueueItem[]; nextCursor: string | null };
export function cleanComplianceQueueQuery(q: unknown = '', cursor: unknown = '') {
  if (typeof q !== 'string' || q.trim().length > 160 || typeof cursor !== 'string' || cursor.length > 512
    || cursor && !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new FormComplianceError('COMPLIANCE_INPUT', 'Use a search up to 160 characters and a valid review page.');
  return { q: q.trim(), cursor };
}
export type FormComplianceContext = { scope: 'business'; workOrderId: string; formId: string }
  | { scope: 'creditex'; intentId: string; recordId: string; recordKind: 'field' | 'work_pack' | 'job_form' };
export type FormComplianceTemplateInput = { action: 'save_template'; scope: FormComplianceScope; formKey: string;
  expectedRevision: number; questions: FormComplianceQuestion[] };
export type FormComplianceReviewInput = FormComplianceContext & { action: 'save_review'; expectedRevision: number;
  expectedSourceHash: string; templateRevision: number; answers: FormComplianceAnswer[]; status: 'draft' | 'complete' };
export function initialComplianceAnswers(workspace: FormComplianceWorkspace): FormComplianceAnswer[] {
  const current = new Map(workspace.stale ? [] : workspace.review?.answers.map(answer => [answer.key, answer]));
  return workspace.template.questions.map(question => { const saved = current.get(question.key); return saved ? { ...saved }
    : { key: question.key, response: 'unchecked', note: '' }; });
}
export class FormComplianceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = 'FormComplianceError'; this.code = code; this.status = status; }
}
const fail = (message: string): never => { throw new FormComplianceError('COMPLIANCE_INPUT', message); };
export function complianceIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 180
    || /[\u0000-\u001f]/.test(value)) return fail('Choose a valid form or job.');
  return value;
}
export function complianceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Send a valid compliance request.');
  return Object.fromEntries(Object.entries(value));
}
export function complianceKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) return fail('This request contains unsupported fields.');
}
function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail('Reload the current version before saving.');
  return value;
}
export function complianceFormKey(value: unknown, scope: FormComplianceScope) {
  const key = complianceIdentifier(value);
  const valid = scope === 'business' ? /^business:[A-Za-z0-9_.-]+$/ : /^(activity:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]*|work-pack:[A-Za-z0-9_.-]+|creditex-job-form:[A-Za-z0-9_.-]+)$/;
  if (!valid.test(key)) return fail('Choose a form from this workspace.');
  return key;
}
export function cleanComplianceQuestions(value: unknown): FormComplianceQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 60) return fail('Add between 1 and 60 compliance questions.');
  const seen = new Set<string>();
  return value.map(item => {
    const row = complianceObject(item); complianceKeys(row, ['key', 'label', 'required', 'sourceFieldKey']);
    const key = complianceIdentifier(row.key);
    if (!/^[A-Za-z0-9_.:-]+$/.test(key) || seen.has(key)) return fail('Each compliance question needs a unique key.');
    seen.add(key);
    if (typeof row.label !== 'string' || !row.label.trim() || row.label.length > 500 || typeof row.required !== 'boolean') return fail('Add a question and choose whether an answer is required.');
    return { key, label: row.label.trim(), required: row.required,
      ...(row.sourceFieldKey !== undefined ? { sourceFieldKey: complianceIdentifier(row.sourceFieldKey) } : {}) };
  });
}
export function cleanComplianceContext(value: Record<string, unknown>): FormComplianceContext {
  if (value.scope === 'business') return { scope: 'business', workOrderId: complianceIdentifier(value.workOrderId), formId: complianceIdentifier(value.formId) };
  if (value.scope === 'creditex' && ['field', 'work_pack', 'job_form'].includes(String(value.recordKind))) {
    const recordKind = value.recordKind;
    if (recordKind !== 'field' && recordKind !== 'work_pack' && recordKind !== 'job_form') return fail('Choose a valid record.');
    return { scope: 'creditex', intentId: complianceIdentifier(value.intentId), recordId: complianceIdentifier(value.recordId), recordKind };
  }
  return fail('Choose a valid compliance workspace.');
}
export function cleanComplianceTemplateInput(value: unknown): FormComplianceTemplateInput {
  const row = complianceObject(value); complianceKeys(row, ['action', 'scope', 'formKey', 'expectedRevision', 'questions']);
  if (row.action !== 'save_template' || (row.scope !== 'business' && row.scope !== 'creditex')) return fail('Choose a valid compliance questionnaire.');
  return { action: 'save_template', scope: row.scope, formKey: complianceFormKey(row.formKey, row.scope),
    expectedRevision: revision(row.expectedRevision), questions: cleanComplianceQuestions(row.questions) };
}
export function cleanComplianceReviewInput(value: unknown): FormComplianceReviewInput {
  const row = complianceObject(value), context = cleanComplianceContext(row);
  complianceKeys(row, ['action', 'scope', 'expectedRevision', 'expectedSourceHash', 'templateRevision', 'answers', 'status',
    ...(context.scope === 'business' ? ['workOrderId', 'formId'] : ['intentId', 'recordId', 'recordKind'])]);
  if (row.action !== 'save_review' || (row.status !== 'draft' && row.status !== 'complete') || typeof row.expectedSourceHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(row.expectedSourceHash)) return fail('Reload the form and choose a valid review status.');
  if (!Array.isArray(row.answers) || row.answers.length > 60) return fail('Answer the current compliance questions.');
  const seen = new Set<string>();
  const answers = row.answers.map((item): FormComplianceAnswer => {
    const answer = complianceObject(item); complianceKeys(answer, ['key', 'response', 'note']);
    const key = complianceIdentifier(answer.key), response = answer.response;
    if (seen.has(key) || (response !== 'pass' && response !== 'fail' && response !== 'na' && response !== 'unchecked')
      || typeof answer.note !== 'string' || answer.note.length > 2000) return fail('Choose a valid answer and keep notes within 2,000 characters.');
    seen.add(key);
    if (response === 'na' && !answer.note.trim()) return fail('Explain why a question does not apply.');
    return { key, response, note: answer.note.trim() };
  });
  return { ...context, action: 'save_review', expectedRevision: revision(row.expectedRevision), expectedSourceHash: row.expectedSourceHash,
    templateRevision: revision(row.templateRevision), answers, status: row.status };
}
export function assertComplianceCompletion(questions: readonly FormComplianceQuestion[], answers: readonly FormComplianceAnswer[], complete: boolean) {
  if (answers.length !== questions.length || questions.some(question => !answers.some(answer => answer.key === question.key))) return fail('Answer the current version of every compliance question.');
  if (complete && questions.some(question => {
    const answer = answers.find(item => item.key === question.key);
    return answer?.response === 'fail' || question.required && answer?.response === 'unchecked';
  })) throw new FormComplianceError('COMPLIANCE_INCOMPLETE', 'Resolve failed checks and answer every required question before completing the review.');
}
const commonQuestions: FormComplianceQuestion[] = [
  { key: 'customer_name', label: 'Does the customer name match the job and signed documents?', required: true },
  { key: 'site_address', label: 'Does the work address match the job and evidence?', required: true },
  { key: 'activity_date', label: 'Do the work date and evidence dates agree?', required: true },
  { key: 'phone_audit', label: 'Has the customer phone audit been completed, or a reason recorded if it does not apply?', required: true },
  { key: 'customer_confirmation', label: 'Has the customer confirmed the work that was carried out?', required: true },
  { key: 'technician_identity', label: 'Does the technician photo clearly show their face and identification?', required: true },
  { key: 'technician_details', label: 'Do the technician details match the recorded worker?', required: true },
  { key: 'work_scope', label: 'Does the work recorded match the assigned form and job?', required: true },
  { key: 'required_answers', label: 'Have all applicable installer questions been answered?', required: true },
  { key: 'before_evidence', label: 'Do the before-work photos show the original equipment or site?', required: true },
  { key: 'after_evidence', label: 'Do the after-work photos show the completed work?', required: true },
  { key: 'evidence_readable', label: 'Are the submitted photos and documents clear enough to review?', required: true },
  { key: 'equipment_details', label: 'Do the equipment details match the photos and supporting documents?', required: true },
  { key: 'signatures', label: 'Are the applicable declarations signed by the correct people?', required: true },
  { key: 'supporting_documents', label: 'Have the applicable supporting documents been checked?', required: true },
  { key: 'no_unresolved_issues', label: 'Have discrepancies and customer concerns been resolved?', required: true },
];
export function defaultComplianceQuestions(fields: readonly { key: string; label: string }[]): FormComplianceQuestion[] {
  const unique = fields.filter((field, index) => field.key && field.label && fields.findIndex(item => item.key === field.key) === index);
  const checks = unique.slice(0, 9).map((field, index) => ({ key: `field_check_${index + 1}`, label: `Does the recorded answer for "${field.label.slice(0, 400)}" agree with the job evidence?`, required: true, sourceFieldKey: field.key }));
  return [...commonQuestions.map(question => ({ ...question })), ...checks];
}
