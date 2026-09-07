import { cleanAdminText } from "./admin-server";
import { ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";

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
  const fields = rawFields.map((field) => {
    const key = cleanAdminText(field.key, 80).toLowerCase();
    const label = cleanAdminText(field.label, 180);
    const type = cleanAdminText(field.type, 20);
    const required = field.required === true;
    const maxLength = Number(field.maxLength ?? (type === "textarea" ? 1200 : 240));
    const options = Array.isArray(field.options) ? [...new Set(field.options.map((item) => cleanAdminText(item, 100)).filter(Boolean))] : [];
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || !label || !TYPES.has(type) || (type === "select" && (options.length < 2 || options.length > 20))
      || !Number.isInteger(maxLength) || maxLength < 20 || maxLength > 2000) throw new Error("INVALID_FIELDS");
    return { key, label, type, required, ...(type === "text" || type === "textarea" ? { maxLength } : {}), ...(type === "select" ? { options } : {}) };
  });
  if (new Set(fields.map((field) => field.key)).size !== fields.length) throw new Error("DUPLICATE_FIELDS");
  return { templateKey, version, name, jurisdiction, categories, description, guidance, sourceNotes, fields };
}
