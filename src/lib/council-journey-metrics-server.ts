import { isCouncilJourneyMetrics, type CouncilJourneyMetrics } from "./council-journey-metrics";

export type CouncilJourneyContext = {
  councilId: string;
  state: string;
  postcodes: string[];
  campaignId: string | null;
  campaignStatus: string | null;
  enabled: boolean;
};

type ContextRow = {
  id: string; state: string; public_campaign_id: string | null;
  campaign_id: string | null; campaign_status: string | null;
  public_journey_enabled: number; postcodes_json: string;
};

/** Read membership, configured journey and approved area together, without contact data. */
export async function readCouncilJourneyContext(db: D1Database, councilId: string, actorUid: string): Promise<CouncilJourneyContext | null> {
  const row = await db.prepare(`SELECT c.id, c.state, c.public_campaign_id,
    c.public_journey_enabled, campaign.id AS campaign_id, campaign.status AS campaign_status,
    (SELECT json_group_array(postcode) FROM
      (SELECT p.postcode FROM council_postcodes p
       WHERE p.council_id = c.id AND p.state = c.state ORDER BY p.postcode)) AS postcodes_json
    FROM council_organisations c
    JOIN council_memberships m ON m.council_id = c.id
    LEFT JOIN council_campaigns campaign ON campaign.id = c.public_campaign_id AND campaign.council_id = c.id
    WHERE c.id = ? AND c.status = 'active' AND m.firebase_uid = ? AND m.status = 'active'
      AND m.role IN ('owner', 'editor', 'viewer')`).bind(councilId, actorUid).first<ContextRow>();
  if (!row) return null;
  const postcodes: unknown = JSON.parse(row.postcodes_json);
  if (!Array.isArray(postcodes) || postcodes.length < 1 || postcodes.length > 100
    || postcodes.some(code => typeof code !== "string" || !/^\d{4}$/.test(code))
    || new Set(postcodes).size !== postcodes.length
    || (row.public_campaign_id && row.public_campaign_id !== row.campaign_id)) {
    throw new Error("COUNCIL_JOURNEY_SCOPE_UNAVAILABLE");
  }
  return { councilId: row.id, state: row.state, postcodes,
    campaignId: row.campaign_id, campaignStatus: row.campaign_status,
    enabled: row.public_journey_enabled === 1 };
}

export function councilJourneyContextKey(context: CouncilJourneyContext): string {
  return JSON.stringify([context.councilId, context.state, [...context.postcodes].sort(),
    context.campaignId, context.campaignStatus, context.enabled]);
}

/** All-time own-journey totals. No time, postcode or customer breakdown is exposed. */
export async function loadCouncilJourneyMetrics(db: D1Database, context: CouncilJourneyContext, now = new Date()): Promise<CouncilJourneyMetrics> {
  const checkedAt = now.toISOString();
  if (!context.campaignId) return { submittedEnquiries: 0, enquiriesQuoted: 0, quotesSent: 0, checkedAt };
  const row = await db.prepare(`WITH submitted AS (
      SELECT o.id FROM council_attributions a
      JOIN trade_opportunities o ON o.id = a.opportunity_id
      WHERE a.council_id = ? AND a.campaign_id = ? AND a.source = 'explicit_referral'
        AND o.state = ? AND o.postcode IN (SELECT value FROM json_each(?))
        AND o.is_synthetic = 0 AND o.created_by_uid = 'lead-intake' AND o.source_reference <> ''
    ), confirmed AS (
      SELECT DISTINCT submitted.id AS opportunity_id, version.id AS quote_version_id
      FROM submitted
      JOIN trade_opportunity_matches match ON match.opportunity_id = submitted.id
      JOIN trade_work_orders work ON work.source_type = 'public_lead'
        AND work.source_reference = match.id AND work.firebase_uid = match.firebase_uid
      JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
        AND detail.customer_source = 'public_lead_released'
        AND CASE WHEN json_valid(detail.accepted_disclosure_snapshot)
          THEN json_extract(detail.accepted_disclosure_snapshot, '$.contract') END = 'tlink-public-lead-accepted-disclosure-v1'
        AND length(detail.accepted_disclosure_sha256) = 64 AND datetime(detail.accepted_disclosure_at) IS NOT NULL
      JOIN trade_crm_quotes quote ON quote.work_order_id = work.id AND quote.firebase_uid = work.firebase_uid
        AND quote.crm_customer_id = detail.crm_customer_id AND quote.service_site_id = detail.service_site_id
      JOIN trade_crm_quote_versions version ON version.quote_id = quote.id AND version.firebase_uid = quote.firebase_uid
        AND version.status <> 'draft' AND datetime(version.issued_at) IS NOT NULL
      JOIN trade_crm_quote_links link ON link.quote_id = quote.id AND link.quote_version_id = version.id
        AND link.firebase_uid = quote.firebase_uid AND link.work_order_id = work.id AND link.crm_customer_id = quote.crm_customer_id
      JOIN trade_crm_quote_deliveries delivery ON delivery.quote_link_id = link.id
        AND delivery.quote_version_id = version.id AND delivery.work_order_id = work.id
        AND delivery.firebase_uid = work.firebase_uid AND delivery.crm_customer_id = quote.crm_customer_id
      WHERE delivery.channel = 'email' AND delivery.recipient_role = 'acceptance'
        AND delivery.status IN ('provider_accepted', 'sent', 'delivered', 'bounced', 'complained', 'opted_out', 'failed')
        AND trim(delivery.provider) <> '' AND trim(delivery.provider_message_id) <> ''
        AND datetime(delivery.updated_at) IS NOT NULL
        AND EXISTS (SELECT 1 FROM trade_crm_quote_events accepted
          WHERE accepted.quote_link_id = link.id AND accepted.quote_id = quote.id
            AND accepted.quote_version_id = version.id AND accepted.work_order_id = work.id
            AND accepted.firebase_uid = work.firebase_uid AND accepted.event_type = 'provider_accepted'
            AND accepted.actor_type = 'system'
            AND accepted.evidence_key = 'provider_accepted:' || delivery.idempotency_key
            AND datetime(accepted.occurred_at) IS NOT NULL)
    ) SELECT (SELECT COUNT(*) FROM submitted) AS submittedEnquiries,
      (SELECT COUNT(DISTINCT opportunity_id) FROM confirmed) AS enquiriesQuoted,
      (SELECT COUNT(DISTINCT quote_version_id) FROM confirmed) AS quotesSent`)
    .bind(context.councilId, context.campaignId, context.state, JSON.stringify(context.postcodes))
    .first<Omit<CouncilJourneyMetrics, "checkedAt">>();
  const metrics = row && { ...row, checkedAt };
  if (!isCouncilJourneyMetrics(metrics)) throw new Error("COUNCIL_JOURNEY_METRICS_UNAVAILABLE");
  return metrics;
}
