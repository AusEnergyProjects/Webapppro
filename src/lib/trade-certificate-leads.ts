import { TRAINING_MODULES } from "../data/creditex-training-curriculum.ts";
import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from "./australian-government-program-catalogue.ts";
import { getTrainingModuleHash } from "./trade-training-server.ts";

function expression(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("A static qualified SQL column is required.");
  return value;
}
function literal(value: string) { return `'${value.replaceAll("'", "''")}'`; }
const programs = new Map(GOVERNMENT_PROGRAM_TEMPLATES.map((program) => [program.programCode, program]));
const governmentCategories = [...new Set(GOVERNMENT_ACTIVITY_TEMPLATES.map((activity) => activity.serviceCategory))];
const states = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
const requiredCourses = GOVERNMENT_ACTIVITY_TEMPLATES.flatMap((activity) => {
  const program = programs.get(activity.programCode);
  if (!program || !["current", "limited"].includes(program.catalogueState)
    || !["current", "limited"].includes(activity.catalogueState)) return [];
  const course = TRAINING_MODULES.find((item) => item.activityTemplateIds.includes(activity.templateId));
  return [{ moduleId: course?.id || activity.templateId, version: course?.version || "",
    hash: course ? getTrainingModuleHash(course) : "", category: activity.serviceCategory,
    jurisdiction: program.jurisdiction, complete: course && course.sourceCoverage.status !== "partial" ? 1 : 0,
    external: activity.templateId === "veu-48" ? 1 : 0 }];
});
// Missing, incomplete and non-applicable courses remain blocking rows. The
// immutable deployed catalogue is supplied at runtime, never copied into SQL
// migrations or cached as mutable business eligibility.
const requiredCourseRows = [
  ...requiredCourses,
  ...governmentCategories.flatMap((category) => states.flatMap((state) =>
    requiredCourses.some((course) => course.category === category && ["AU", state].includes(course.jurisdiction)) ? []
      : [{ moduleId: "", version: "", hash: "", category, jurisdiction: state, complete: 0, external: 0 }])),
].map((course) => `(${[course.moduleId, course.version, course.hash, course.category, course.jurisdiction].map(literal).join(",")},${course.complete},${course.external})`).join(",\n");

/** Enforced at allocation, disclosure and notification claim, including old matches.
 * Every current applicable course is required for the owner and active staff
 * declaring that category. Live views recheck approvals, expiry, revocations,
 * external credentials and current service checkboxes on the same SQL statement.
 * Closed, future and specialist routes cannot enable automatic matching.
 */
export function certificateLeadEligibilitySql(ownerColumn: string, categoriesColumn: string, stateColumn: string) {
  const owner = expression(ownerColumn); const categories = expression(categoriesColumn); const state = expression(stateColumn);
  return `(EXISTS (WITH required_course(module_id,version,content_hash,category,jurisdiction,source_complete,external_required)
    AS (VALUES ${requiredCourseRows})
    SELECT 1 FROM creditex_current_business_approvals approved_business
    WHERE approved_business.owner_uid = ${owner}
      AND json_valid(${categories}) AND json_type(${categories}) = 'array' AND json_array_length(${categories}) > 0
      AND ${state} IN (${states.map(literal).join(",")})
      AND NOT EXISTS (SELECT 1 FROM required_course
        JOIN json_each(${categories}) training_category ON training_category.value = required_course.category
        WHERE required_course.jurisdiction IN ('AU', ${state})
          AND (required_course.source_complete = 0 OR NOT EXISTS (
            SELECT 1 FROM trade_training_current_category_qualifications qualification
            WHERE (qualification.owner_uid, qualification.category, qualification.module_id,
              qualification.version, qualification.content_hash, qualification.external_required) =
              (${owner}, required_course.category, required_course.module_id,
                required_course.version, required_course.content_hash, required_course.external_required))))))`;
}

export async function certificateLeadEligible(db: D1Database, ownerUid: string, categories: readonly string[], state: string) {
  const predicate = certificateLeadEligibilitySql("lead.owner_uid", "lead.categories", "lead.state");
  return Boolean(await db.prepare(`SELECT 1 FROM (SELECT ? owner_uid, ? categories, ? state) lead WHERE ${predicate}`)
    .bind(ownerUid, JSON.stringify(categories), state).first());
}

export async function certificateLeadEligibleOwners(db: D1Database,
  candidates: readonly { firebaseUid: string; matchedCategories: readonly string[] }[], state: string) {
  const eligible = new Set<string>();
  const predicate = certificateLeadEligibilitySql("lead.owner_uid", "lead.categories", "lead.state");
  // One bounded query per group avoids an unbounded concurrent request per trade.
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const batch = candidates.slice(offset, offset + 100)
      .map(({ firebaseUid, matchedCategories }) => ({ firebaseUid, matchedCategories }));
    const rows = await db.prepare(`WITH lead AS (
      SELECT json_extract(value,'$.firebaseUid') owner_uid,
        json_extract(value,'$.matchedCategories') categories, ? state FROM json_each(?)
      ) SELECT lead.owner_uid FROM lead WHERE ${predicate}`)
      .bind(state, JSON.stringify(batch)).all<{ owner_uid: string }>();
    for (const row of rows.results) eligible.add(row.owner_uid);
  }
  return eligible;
}
