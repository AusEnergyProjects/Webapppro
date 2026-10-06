import type { BusinessFormField } from './trade-business-form-design';

export type BusinessFormAiDraft = { name: string; description: string; guidance: string; fields: BusinessFormField[] };
export type BusinessFormAiResult = { kind: 'clarify'; questions: string[]; form: null } | { kind: 'draft'; questions: []; form: BusinessFormAiDraft };
const fieldProperties = {
  key: { type: 'string', pattern: '^[a-z0-9]+(?:_[a-z0-9]+)*$', maxLength: 80 },
  label: { type: 'string', minLength: 1, maxLength: 180 },
  type: { type: 'string', enum: ['checkbox', 'text', 'textarea', 'date', 'select'] },
  required: { type: 'boolean' }, maxLength: { type: 'integer', minimum: 20, maximum: 2000 },
  options: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } },
  section: { type: 'string', minLength: 1, maxLength: 160 }, phase: { type: 'string', enum: ['before', 'after'] },
};
export const businessFormAiSchema: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['kind', 'questions', 'form'],
  properties: {
    kind: { type: 'string', enum: ['clarify', 'draft'] },
    questions: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 240 } },
    form: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      required: ['name', 'description', 'guidance', 'fields'], properties: {
        name: { type: 'string', minLength: 1, maxLength: 140 }, description: { type: 'string', minLength: 1, maxLength: 800 },
        guidance: { type: 'string', minLength: 1, maxLength: 1200 },
        fields: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false,
          required: Object.keys(fieldProperties), properties: fieldProperties } },
      } }] },
  },
};
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('WORKFLOW_AI_INCOMPLETE');
}
function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('WORKFLOW_AI_INCOMPLETE');
  return value.trim();
}
export function parseBusinessFormAiResult(value: unknown): BusinessFormAiResult {
  if (!record(value)) throw new Error('WORKFLOW_AI_INCOMPLETE');
  exact(value, ['kind', 'questions', 'form']);
  if (!Array.isArray(value.questions) || value.questions.length > 3) throw new Error('WORKFLOW_AI_INCOMPLETE');
  const questions = value.questions.map(question => text(question, 240));
  if (value.kind === 'clarify') {
    if (!questions.length || value.form !== null) throw new Error('WORKFLOW_AI_INCOMPLETE');
    return { kind: 'clarify', questions, form: null };
  }
  if (value.kind !== 'draft' || questions.length || !record(value.form)) throw new Error('WORKFLOW_AI_INCOMPLETE');
  exact(value.form, ['name', 'description', 'guidance', 'fields']);
  if (!Array.isArray(value.form.fields) || !value.form.fields.length || value.form.fields.length > 12) throw new Error('WORKFLOW_AI_INCOMPLETE');
  const fields = value.form.fields.map((field): BusinessFormField => {
    if (!record(field)) throw new Error('WORKFLOW_AI_INCOMPLETE');
    exact(field, Object.keys(fieldProperties));
    const key = text(field.key, 80), label = text(field.label, 180), section = text(field.section, 160);
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || typeof field.required !== 'boolean'
      || typeof field.maxLength !== 'number' || !Number.isInteger(field.maxLength) || field.maxLength < 20 || field.maxLength > 2000
      || !Array.isArray(field.options) || field.options.length > 20 || (field.phase !== 'before' && field.phase !== 'after')) throw new Error('WORKFLOW_AI_INCOMPLETE');
    const options = field.options.map(option => text(option, 100));
    if (new Set(options).size !== options.length) throw new Error('WORKFLOW_AI_INCOMPLETE');
    const type = field.type;
    if (type !== 'checkbox' && type !== 'text' && type !== 'textarea' && type !== 'date' && type !== 'select') throw new Error('WORKFLOW_AI_INCOMPLETE');
    if (type === 'select' ? options.length < 2 : options.length !== 0) throw new Error('WORKFLOW_AI_INCOMPLETE');
    return { key, label, type, required: field.required, maxLength: field.maxLength, options, section, phase: field.phase };
  });
  if (new Set(fields.map(field => field.key)).size !== fields.length) throw new Error('WORKFLOW_AI_INCOMPLETE');
  return { kind: 'draft', questions: [], form: { name: text(value.form.name, 140), description: text(value.form.description, 800), guidance: text(value.form.guidance, 1200), fields } };
}
