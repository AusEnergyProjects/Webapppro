import { verifiedTradeAccountPredicate } from "./trade-access-server";

function expression(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("A static qualified SQL column is required.");
  return value;
}
/** Rechecked at allocation, disclosure and notification claim, including old matches.
 * Ordinary enquiries require a verified TLink business and offered service/state
 * coverage. Creditex onboarding and activity training apply to programme work,
 * never to ordinary enquiries, questions or quotes. The allocator separately
 * checks configured service-area distance and availability. Historical AEA-only
 * consent is enforced by the opportunity owner scope.
 * Consent and customer-contact disclosure remain separate checks at each caller.
 */
export function certificateLeadEligibilitySql(ownerColumn: string, categoriesColumn: string, stateColumn: string) {
  const owner = expression(ownerColumn); const categories = expression(categoriesColumn); const state = expression(stateColumn);
  return `EXISTS (SELECT 1 FROM trade_accounts offered_business
        WHERE offered_business.firebase_uid = ${owner}
          AND (${verifiedTradeAccountPredicate("offered_business")})
          AND ${state} IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')
          AND CASE WHEN json_valid(offered_business.service_states) THEN
            json_type(offered_business.service_states) = 'array'
            AND EXISTS (SELECT 1 FROM json_each(offered_business.service_states) offered_state
              WHERE offered_state.type = 'text' AND offered_state.value = ${state})
          ELSE 0 END
          AND CASE WHEN (json_valid(${categories}),json_valid(offered_business.capabilities)) = (1,1) THEN
            (json_type(${categories}),json_type(offered_business.capabilities)) = ('array','array')
            AND json_array_length(${categories}) > 0
            AND NOT EXISTS (SELECT 1 FROM json_each(${categories}) matched_category
              WHERE NOT EXISTS (
                SELECT 1 FROM json_each(offered_business.capabilities) offered_category
                WHERE (offered_category.type,offered_category.value,matched_category.type) = ('text',matched_category.value,'text')))
          ELSE 0 END)`;
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
