/** Home and its Jobs drill-down suggest approved work, independently of permission to book a quote visit.
 * Bind the business-local current date (YYYY-MM-DD) to the single placeholder.
 */
export function tradeJobNeedsSchedulingSql(workOrderAlias: string, jobDetailAlias: string) {
  return `${workOrderAlias}.stage NOT IN ('imported', 'completed', 'cancelled')
    AND ${workOrderAlias}.source_type <> 'opportunity'
    AND COALESCE(${jobDetailAlias}.customer_source, 'internal') <> 'platform_private'
    AND COALESCE(${jobDetailAlias}.pipeline_stage, '') NOT IN ('imported', 'lost', 'complete', 'invoiced', 'paid')
    AND (
      (${jobDetailAlias}.quote_status = 'accepted' AND EXISTS (
        SELECT 1 FROM trade_crm_quotes attention_quote
        JOIN trade_crm_quote_versions attention_version
          ON attention_version.quote_id = attention_quote.id
          AND attention_version.firebase_uid = attention_quote.firebase_uid
          AND attention_version.version_number = attention_quote.current_version_number
        JOIN trade_crm_quote_acceptances attention_acceptance
          ON attention_acceptance.quote_id = attention_quote.id
          AND attention_acceptance.quote_version_id = attention_version.id
          AND attention_acceptance.work_order_id = attention_quote.work_order_id
          AND attention_acceptance.firebase_uid = attention_quote.firebase_uid
          AND attention_acceptance.crm_customer_id = attention_quote.crm_customer_id
          AND attention_acceptance.decision = 'accepted'
        WHERE attention_quote.work_order_id = ${workOrderAlias}.id
          AND attention_quote.firebase_uid = ${workOrderAlias}.firebase_uid
          AND attention_quote.crm_customer_id = ${jobDetailAlias}.crm_customer_id
          AND attention_quote.status = 'accepted' AND attention_version.status = 'accepted'
      )) OR (
        COALESCE(${jobDetailAlias}.customer_source, 'internal') <> 'public_lead_released'
        AND ${workOrderAlias}.source_type <> 'public_lead'
        AND ${jobDetailAlias}.pipeline_stage IN ('approved', 'scheduled', 'in_progress')
        AND COALESCE(NULLIF(${jobDetailAlias}.quote_status, ''), 'not_started') IN ('not_started', 'accepted')
        AND NOT EXISTS (SELECT 1 FROM trade_crm_quotes attention_quote
          WHERE attention_quote.work_order_id = ${workOrderAlias}.id
            AND attention_quote.firebase_uid = ${workOrderAlias}.firebase_uid)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM trade_crm_appointments attention_visit
      WHERE attention_visit.work_order_id = ${workOrderAlias}.id
        AND attention_visit.firebase_uid = ${workOrderAlias}.firebase_uid
        AND attention_visit.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
        AND date(attention_visit.starts_at) IS NOT NULL AND substr(attention_visit.starts_at, 1, 10) >= ?
    )`;
}
