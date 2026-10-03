import { hubParticipantContactJoins } from "./customer-quote-hub-server";
import { ensureCustomerHubForReleasedLead } from "./customer-hub-links";
import { decryptProtectedPayload } from "./trade-integration-crypto";
import { hashQuoteLinkSecret } from "./trade-quote-links";

type QuoteRecipient = { ownerUid: string; workOrderId: string; customerId: string; recipientEmail: string };
type HubEmailScope = {
  opportunity_id: string; release_id: string; recipient_email: string;
  hub_id: string | null; encrypted_token: string | null; token_hash: string | null;
  email_hash: string | null; revoked_at: string | null; expires_at: string | null;
};

/** Server-only email content. Never return this capability in a trade response.
 * Retries only read existing authority; the frozen email checksum binds its URL.
 * An ended invitation never blocks a separately authorised standalone quote.
 */
export async function tradeQuoteCustomerHubEmailUrl(db: D1Database, input: QuoteRecipient, provisionMissing = false) {
  const work = await db.prepare("SELECT source_type FROM trade_work_orders WHERE id=? AND firebase_uid=? AND record_status='active'")
    .bind(input.workOrderId, input.ownerUid).first<{ source_type: string }>();
  if (!work) return undefined;
  if (work.source_type !== "public_lead") return undefined;
  const email = input.recipientEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  const disclosure = "CASE WHEN json_valid(detail.accepted_disclosure_snapshot) THEN detail.accepted_disclosure_snapshot ELSE '{}' END";
  const currentScope = () => db.prepare(`SELECT opportunity.id opportunity_id,contact.id release_id,
      lower(trim(contact.customer_email)) recipient_email,hub.id hub_id,hub.encrypted_token,hub.token_hash,hub.email_hash,hub.revoked_at,hub.expires_at
    ${hubParticipantContactJoins}
    JOIN trade_work_orders work ON work.source_type='public_lead' AND work.source_reference=match.id AND work.firebase_uid=match.firebase_uid
      AND work.record_status='active' AND work.stage<>'cancelled'
    JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid
      AND detail.customer_source='public_lead_released' AND detail.pipeline_stage<>'lost'
    JOIN trade_crm_customers customer ON customer.id=detail.crm_customer_id AND customer.firebase_uid=work.firebase_uid AND customer.record_status='active'
    LEFT JOIN customer_quote_hubs hub ON hub.opportunity_id=opportunity.id AND hub.release_id=contact.id AND hub.recipient_email=lower(trim(contact.customer_email))
    WHERE match.status IN ('offered','viewed','interested','connected') AND match.firebase_uid=? AND work.id=? AND customer.id=?
      AND lower(trim(customer.email))=? AND lower(trim(contact.customer_email))=?
      AND length(detail.accepted_disclosure_sha256)=64 AND detail.accepted_disclosure_sha256 NOT GLOB '*[^0-9a-f]*'
      AND json_extract(${disclosure},'$.contract')='tlink-public-lead-accepted-disclosure-v1'
      AND json_extract(${disclosure},'$.source.opportunityMatchId')=match.id
      AND json_extract(${disclosure},'$.source.sourceReference')=opportunity.source_reference
      AND json_extract(${disclosure},'$.source.releaseId')=contact.id
      AND lower(trim(json_extract(${disclosure},'$.customer.email')))=? LIMIT 1`)
    .bind(input.ownerUid, input.workOrderId, input.customerId, email, email, email).first<HubEmailScope>();
  let scope = await currentScope();
  if (!scope) return undefined;
  if (!scope.hub_id && provisionMissing) {
    try { await ensureCustomerHubForReleasedLead(db, scope.opportunity_id, scope.release_id, email); }
    catch (error) {
      if (error instanceof Error && error.message === "CUSTOMER_HUB_ACCESS_ENDED") return undefined;
      throw error;
    }
    scope = await currentScope();
  }
  if (!scope?.hub_id || scope.revoked_at || !scope.expires_at || !(Date.parse(scope.expires_at) > Date.now())
    || !scope.encrypted_token || !scope.token_hash || scope.email_hash !== await hashQuoteLinkSecret(email)) return undefined;
  const payload = await decryptProtectedPayload(scope.encrypted_token).catch(() => null);
  if (!payload || payload.kind !== "customer_quote_hub" || payload.id !== scope.hub_id || typeof payload.secret !== "string"
    || await hashQuoteLinkSecret(payload.secret) !== scope.token_hash) return undefined;
  const current = await currentScope();
  if (!current || current.hub_id !== scope.hub_id || current.token_hash !== scope.token_hash || current.email_hash !== scope.email_hash
    || current.release_id !== scope.release_id || current.revoked_at || !current.expires_at || !(Date.parse(current.expires_at) > Date.now())) return undefined;
  return `https://ausenergyassessments.com/customer-hub/${encodeURIComponent(`${scope.hub_id}.${payload.secret}`)}`;
}
