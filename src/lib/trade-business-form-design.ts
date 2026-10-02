import type { ActivityForm, ActivityCondition } from './trade-activity-form-types';

export type BusinessFormField = {
  key: string; label: string; type: 'checkbox' | 'text' | 'textarea' | 'date' | 'select';
  required: boolean; maxLength?: number; options?: string[];
  section?: string; phase?: 'before' | 'after'; condition?: ActivityCondition;
};
export type BusinessFormTemplate = {
  id: string; version: number; updatedAt: string; name: string; description: string;
  guidance: string; categories: string[]; jurisdiction: string; fields: BusinessFormField[];
};
export function businessFormDesign(template: BusinessFormTemplate): ActivityForm {
  return { id: template.id || 'business-draft', title: template.name || 'New form', version: template.version,
    activityTemplateId: 'business-form', programCode: 'Business', variantId: '', variantOptions: [],
    fields: template.fields.map(field => ({ key: field.key, label: field.label, section: field.section || 'Questions',
      phase: field.phase || 'before', type: field.type === 'checkbox' ? 'boolean' : field.type === 'textarea' ? 'text' : field.type,
      required: field.required, options: field.options || [], help: '', condition: field.condition })),
    declarations: [], sources: [], reviewNotes: [] };
}
export function businessFormPreview(template: BusinessFormTemplate): ActivityForm {
  const form = businessFormDesign(template);
  return { ...form, fields: form.fields.map(field => field.type === 'boolean' && field.required ? { ...field, requiredValue: true } : field) };
}
export function applyBusinessFormDesign(template: BusinessFormTemplate, form: ActivityForm): BusinessFormTemplate {
  const previous = new Map(template.fields.map(field => [field.key, field]));
  return { ...template, fields: form.fields.map(field => {
    const old = previous.get(field.key);
    return { ...old, key: field.key, label: field.label, type: old?.type || 'text', required: field.required,
      section: field.section, phase: field.phase, condition: field.condition, ...(field.type === 'select' ? { options: field.options } : {}) };
  }) };
}
export function businessFormPages(fields: BusinessFormField[]) {
  const pages: { key: string; title: string; fields: BusinessFormField[] }[] = [];
  for (const phase of ['before', 'after']) {
    const sections = [...new Set(fields.filter(field => (field.phase || 'before') === phase).map(field => field.section || 'Questions'))];
    for (const section of sections) {
      const items = fields.filter(field => (field.phase || 'before') === phase && (field.section || 'Questions') === section);
      for (let index = 0; index < items.length; index += 8) pages.push({ key: items[index].key,
        title: `${section}${phase === 'after' ? ' / After work' : ''}`, fields: items.slice(index, index + 8) });
    }
  }
  return pages;
}
