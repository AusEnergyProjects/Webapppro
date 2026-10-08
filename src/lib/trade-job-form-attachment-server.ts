import type { TeamAccess } from './trade-team-server';
import { messageActorGuard } from './trade-message-media-access';
import { publishedTradeFormTemplatesFor, type TradeFormTemplate } from './trade-form-templates-server';
import { normalizeRentalAssessmentModules, RENTAL_ASSESSMENT_MODULE_KEYS, RENTAL_INSPECTION_SERVICE_CATEGORY } from './trade-rental-assessment.mjs';

export class TradeFormSelectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function initialRentalAssessmentModules(value: unknown, serviceCategory: string): string[] {
  if (value === undefined || value === "") return serviceCategory === RENTAL_INSPECTION_SERVICE_CATEGORY
    ? normalizeRentalAssessmentModules(undefined) : [];
  const invalid = () => new TradeFormSelectionError("Choose rental assessment forms from the form library.");
  if (typeof value !== "string" || value.length > 2048) throw invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw invalid(); }
  if (!Array.isArray(parsed) || parsed.length > RENTAL_ASSESSMENT_MODULE_KEYS.length
    || parsed.some(key => typeof key !== "string" || !RENTAL_ASSESSMENT_MODULE_KEYS.some(moduleKey => moduleKey === key))
    || new Set(parsed).size !== parsed.length) throw invalid();
  return parsed.length ? normalizeRentalAssessmentModules(parsed) : [];
}

export function initialVeuElectricalAssessmentSelection(value: unknown): boolean {
  if (value === undefined || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  throw new TradeFormSelectionError("Choose whether to add the insulation electrical safety assessment.");
}

export function tradeFormTemplateMetadata(template: TradeFormTemplate) {
  return { key: template.key, version: template.version, name: template.name, jurisdiction: template.jurisdiction,
    description: template.description, guidance: template.guidance, fieldCount: template.fields.length };
}

export function tradeFormAttachmentAccessGuard(access: TeamAccess, creatingJob = false) {
  const actor = messageActorGuard(access);
  return { sql: `${actor.sql} AND EXISTS (SELECT 1 FROM trade_team_members form_actor
    WHERE form_actor.id = ? AND form_actor.owner_uid = ? AND (form_actor.member_uid = form_actor.owner_uid
      OR (form_actor.can_view_field_evidence = 1 AND form_actor.can_manage_field_evidence = 1
        ${creatingJob ? "AND form_actor.can_create_jobs = 1" : ""})))`,
  values: [...actor.values, access.memberId, access.ownerUid] };
}

export async function assertTradeFormAttachmentAccess(access: TeamAccess, database: D1Database, creatingJob = false) {
  if (!access.canViewFieldEvidence || !access.canManageFieldEvidence
    || (access.fieldSessionId && access.actorUid !== `field-member:${access.memberId}`)) {
    throw new TradeFormSelectionError("Your team access does not allow adding field forms.", 403);
  }
  const guard = tradeFormAttachmentAccessGuard(access, creatingJob);
  if (!await database.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.values).first()) {
    throw new TradeFormSelectionError("Your current team access does not allow adding field forms.", 403);
  }
}

export async function initialTradeJobForms(value: unknown, serviceCategory: string, ownerUid: string, database: D1Database) {
  if (value === undefined || value === "") return [];
  const invalid = () => new TradeFormSelectionError("Choose up to 20 available forms before saving this job.");
  if (typeof value !== "string" || value.length > 8192) throw invalid();
  let selections: unknown;
  try { selections = JSON.parse(value); } catch { throw invalid(); }
  if (!Array.isArray(selections) || selections.length > 20) throw invalid();
  const keys = new Set<string>();
  const selected: { templateKey: string; templateVersion: number }[] = [];
  for (const selection of selections) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)
      || Object.keys(selection).some(key => key !== "templateKey" && key !== "templateVersion")
      || typeof selection.templateKey !== "string" || selection.templateKey.length > 100
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selection.templateKey)
      || !Number.isInteger(selection.templateVersion) || selection.templateVersion < 1 || selection.templateVersion > 1000
      || keys.has(selection.templateKey)) throw invalid();
    keys.add(selection.templateKey);
    selected.push({ templateKey: selection.templateKey, templateVersion: selection.templateVersion });
  }
  if (!selected.length) return [];
  const templates = await publishedTradeFormTemplatesFor(serviceCategory, database, ownerUid);
  return selected.map(selection => {
    const template = templates.find(item => item.key === selection.templateKey && item.version === selection.templateVersion);
    if (!template) throw new TradeFormSelectionError("A selected form is no longer published for this work type. Refresh the form library.");
    return template;
  });
}

// Repeat publication and snapshot checks inside the job creation transaction.
export function tradeFormPublicationGuard(template: TradeFormTemplate, ownerUid: string) {
  if (template.governed === undefined) return {
    sql: `NOT EXISTS (SELECT 1 FROM trade_form_templates WHERE template_key = ?
      AND (scope_owner_uid = '' OR scope_owner_uid = ?) AND status <> 'draft')`,
    values: [template.key, ownerUid],
  };
  return { sql: `EXISTS (SELECT 1 FROM trade_form_templates selected WHERE selected.template_key = ?
    AND selected.scope_owner_uid = ? AND selected.version = ? AND selected.status = 'published'
    AND selected.name = ? AND selected.jurisdiction = ? AND json(selected.categories) = json(?)
    AND selected.description = ? AND selected.guidance = ? AND json(selected.fields) = json(?)
    AND NOT EXISTS (SELECT 1 FROM trade_form_templates newer WHERE newer.template_key = selected.template_key
      AND newer.scope_owner_uid = selected.scope_owner_uid AND newer.status <> 'draft' AND newer.version > selected.version))`,
  values: [template.key, template.governed ? "" : ownerUid, template.version, template.name, template.jurisdiction,
    JSON.stringify(template.categories), template.description, template.guidance, JSON.stringify(template.fields)] };
}
