import { cleanAdminText } from "./admin-server";
import { ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";
import type { BusinessFormField } from './trade-business-form-design';

const TYPES = new Set(["checkbox", "text", "textarea", "date", "select"]);
const JURISDICTIONS = new Set(["AU", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const CATEGORIES = new Set<string>([...ENERGY_SERVICE_IDS, "rental-inspection", "electrical", "plumbing", "mounting-hardware", "controls"]);

export function cleanTradeFormTemplateInput(body: Record<string, unknown>) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_TEMPLATE");
  const templateKey = cleanAdminText(body.templateKey, 100).toLowerCase();
  const version = Number(body.version);
  const name = cleanAdminText(body.name, 140);
  const jurisdiction = cleanAdminText(body.jurisdiction, 10).toUpperCase();
  const description = cleanAdminText(body.description, 800);
  const guidance = cleanAdminText(body.guidance, 1200);
  const sourceNotes = cleanAdminText(body.sourceNotes, 1200);
  const categories = Array.isArray(body.categories) ? [...new Set(body.categories.map((item) => cleanAdminText(item, 60)))] : [];
  if (!Array.isArray(body.fields) || body.fields.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("INVALID_FIELDS");
  const rawFields = body.fields as Record<string, unknown>[];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateKey) || !Number.isInteger(version) || version < 1 || version > 1000) throw new Error("INVALID_IDENTITY");
  if (!name || !description || !guidance || !JURISDICTIONS.has(jurisdiction) || !categories.length || categories.some((item) => !CATEGORIES.has(item))) throw new Error("INVALID_TEMPLATE");
  if (!rawFields.length || rawFields.length > 30) throw new Error("INVALID_FIELDS");
  const fields: BusinessFormField[] = rawFields.map((field) => {
    const key = cleanAdminText(field.key, 80).toLowerCase();
    const label = cleanAdminText(field.label, 180);
    const type = cleanAdminText(field.type, 20);
    const required = field.required === true;
    const maxLength = Number(field.maxLength ?? (type === "textarea" ? 1200 : 240));
    const options = Array.isArray(field.options) ? [...new Set(field.options.map((item) => cleanAdminText(item, 100)).filter(Boolean))] : [];
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || !label || !TYPES.has(type) || (type === "select" && (options.length < 2 || options.length > 20))
      || !Number.isInteger(maxLength) || maxLength < 20 || maxLength > 2000) throw new Error("INVALID_FIELDS");
    if (type !== 'checkbox' && type !== 'text' && type !== 'textarea' && type !== 'date' && type !== 'select') throw new Error('INVALID_FIELDS');
    const section = field.section === undefined ? undefined : cleanAdminText(field.section, 160);
    const phase = field.phase;
    if (section === '' || (phase !== undefined && phase !== 'before' && phase !== 'after')) throw new Error('INVALID_FIELDS');
    return { key, label, type, required, ...(section ? { section } : {}), ...(phase ? { phase } : {}), ...(type === "text" || type === "textarea" ? { maxLength } : {}), ...(type === "select" ? { options } : {}) };
  });
  if (new Set(fields.map((field) => field.key)).size !== fields.length) throw new Error("DUPLICATE_FIELDS");
  const presentationOrder: string[] = [];
  for (const phase of ['before', 'after']) {
    const samePhase = fields.filter(field => (field.phase || 'before') === phase);
    for (const section of new Set(samePhase.map(field => field.section || 'Questions'))) {
      presentationOrder.push(...samePhase.filter(field => (field.section || 'Questions') === section).map(field => field.key));
    }
  }
  fields.forEach((field, index) => {
    const condition = rawFields[index].condition;
    if (condition === undefined) return;
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new Error('INVALID_CONDITION');
    const input = Object.fromEntries(Object.entries(condition));
    const equals = Object.hasOwn(input, 'equals'), notEquals = Object.hasOwn(input, 'notEquals');
    const source = fields.slice(0, index).find(item => item.key === input.fieldKey);
    const value = equals ? input.equals : input.notEquals;
    if (equals === notEquals || Object.keys(input).some(key => !['fieldKey', 'equals', 'notEquals'].includes(key))
      || !source || presentationOrder.indexOf(source.key) >= presentationOrder.indexOf(field.key) || (source.phase === 'after' && field.phase !== 'after')
      || (source.type !== 'checkbox' && source.type !== 'select')
      || (source.type === 'checkbox' ? typeof value !== 'boolean' : typeof value !== 'string' || !source.options?.includes(value))) throw new Error('INVALID_CONDITION');
    if (typeof value !== 'string' && typeof value !== 'boolean') throw new Error('INVALID_CONDITION');
    field.condition = equals ? { fieldKey: source.key, equals: value } : { fieldKey: source.key, notEquals: value };
  });
  return { templateKey, version, name, jurisdiction, categories, description, guidance, sourceNotes, fields };
}
