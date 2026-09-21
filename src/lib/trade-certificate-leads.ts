import { aeaTradeOwnerSql } from "./aea-trade-owner-server";
import { aeaDeliveredServiceScopeSql } from "./aea-trade-routing.mjs";

function expression(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("A static qualified SQL column is required.");
  return value;
}
/** Rechecked at allocation, disclosure and notification claim, including old matches.
 * Receiving an opportunity requires current business onboarding and service/location
 * coverage. Verified AEA owners receive reserved assessment leads nationwide.
 * Training and installer credentials are enforced when booking the work.
 * Consent and customer-contact disclosure remain separate checks at each caller.
 */
export function certificateLeadEligibilitySql(ownerColumn: string, categoriesColumn: string, stateColumn: string) {
  const owner = expression(ownerColumn); const categories = expression(categoriesColumn); const state = expression(stateColumn);
  const [categoryAlias, categoryColumn] = categories.split(".");
  return `(CASE WHEN ${aeaDeliveredServiceScopeSql(categoryAlias, categoryColumn)} THEN
    ${aeaTradeOwnerSql(owner)} ELSE
    EXISTS (SELECT 1 FROM creditex_current_business_jurisdictions approved_business
    WHERE (approved_business.owner_uid,approved_business.state) = (${owner},${state})
      AND EXISTS (SELECT 1 FROM trade_accounts offered_business
        WHERE offered_business.firebase_uid = ${owner}
          AND CASE WHEN (json_valid(${categories}),json_valid(offered_business.capabilities)) = (1,1) THEN
            (json_type(${categories}),json_type(offered_business.capabilities)) = ('array','array')
            AND json_array_length(${categories}) > 0
            AND NOT EXISTS (SELECT 1 FROM json_each(${categories}) matched_category
              WHERE NOT EXISTS (
                SELECT 1 FROM json_each(offered_business.capabilities) offered_category
                WHERE (offered_category.type,offered_category.value,matched_category.type) = ('text',matched_category.value,'text')))
          ELSE 0 END)) END)`;
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
