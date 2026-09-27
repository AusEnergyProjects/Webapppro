import { getD1 } from '../../db';
import type { TeamAccess } from './trade-team-server';
import { tradeOpportunityOwnerScopeSql, isAeaTradeOwner } from './aea-trade-owner-server';
import { certificateLeadEligibilitySql } from './trade-certificate-leads';
import { publicTradeContactForMatchedLead } from './public-trade-lead-access.mjs';
import { customerProjectContactForMatchedLead, platformQuoteForMatchedLead } from './trade-opportunity-read-projection.mjs';

type Target = { customerId?: string; workOrderId?: string; enquiryId?: string };
type Row = Record<string, unknown>;
export function tradeEmailTarget(body: Record<string, unknown>): Target {
  const keys = ['customerId', 'workOrderId', 'enquiryId'] as const;
  const selected = keys.filter(key => body[key] !== undefined && body[key] !== '');
  if (selected.length !== 1) throw new Error('EMAIL_INPUT_INVALID');
  const key = selected[0]; const value = body[key];
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(value)) throw new Error('EMAIL_INPUT_INVALID');
  return { [key]: value };
}
function email(value: unknown) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (candidate.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate)) throw new Error('EMAIL_RECIPIENT_UNAVAILABLE');
  return candidate;
}

async function leadRecipient(access: TeamAccess, matchId: string, db: D1Database) {
  // Marketplace lead access is currently owner-only; connecting a sender must not expand it.
  if (!access.isOwner) throw new Error('EMAIL_ACCESS_REQUIRED');
  const base = await db.prepare(`SELECT m.id match_id, m.firebase_uid installer_uid, o.id, o.source_reference,
    o.postcode opportunity_postcode, o.state, o.service_categories opportunity_service_categories,
    p.id customer_project_id, p.firebase_uid customer_uid, p.postcode customer_postcode, p.address_state customer_address_state
    FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
    LEFT JOIN customer_projects p ON p.opportunity_id = o.id AND o.source_reference = 'customer-project:' || p.id
    WHERE m.id = ? AND m.firebase_uid = ? AND o.status IN ('open','paused')
      AND m.status IN ('offered','viewed','interested','connected')
      AND ((o.expires_at <> '' AND datetime(o.expires_at) > datetime('now'))
        OR (o.expires_at = '' AND datetime(o.created_at, '+30 days') > datetime('now')))
      AND ${tradeOpportunityOwnerScopeSql('o', 'm.firebase_uid')}
      AND ${certificateLeadEligibilitySql('m.firebase_uid', 'm.matched_categories', 'o.state')}
      AND (p.id IS NULL OR EXISTS (SELECT 1 FROM customer_consent_receipts c WHERE c.project_id = p.id
        AND c.firebase_uid = p.firebase_uid AND c.purpose = 'anonymized_installer_matching' AND c.withdrawn_at = ''))`)
    .bind(matchId, access.ownerUid).first<Row>();
  if (!base) throw new Error('EMAIL_RECIPIENT_UNAVAILABLE');
  if (String(base.source_reference).startsWith('customer-project:')) {
    const quote = await db.prepare(`SELECT id quote_id, opportunity_match_id quote_match_id, project_id quote_project_id,
      opportunity_id quote_opportunity_id, opportunity_match_id quote_opportunity_match_id, installer_uid quote_installer_uid
      FROM customer_project_quotes WHERE opportunity_match_id = ? AND installer_uid = ? ORDER BY updated_at DESC, id DESC LIMIT 1`)
      .bind(matchId, access.ownerUid).first<Row>();
    const release = await db.prepare(`SELECT id contact_release_id, opportunity_match_id contact_match_id,
      project_id contact_project_id, opportunity_id contact_opportunity_id, opportunity_match_id contact_opportunity_match_id,
      quote_id contact_quote_id, customer_uid contact_customer_uid, installer_uid contact_installer_uid,
      status contact_release_status, notice_version contact_notice_version, disclosed_fields contact_disclosed_fields,
      customer_name, customer_email, customer_phone, address_line_1 contact_address_line_1, address_line_2 contact_address_line_2,
      suburb contact_suburb, address_state contact_address_state, postcode contact_postcode,
      granted_at contact_granted_at, withdrawn_at contact_withdrawn_at
      FROM customer_project_contact_releases WHERE opportunity_match_id = ? AND installer_uid = ?
      ORDER BY datetime(updated_at) DESC, datetime(granted_at) DESC, id DESC LIMIT 1`)
      .bind(matchId, access.ownerUid).first<Row>();
    const authoritativeQuote = platformQuoteForMatchedLead(base, base, quote);
    const contact = customerProjectContactForMatchedLead(base, base, authoritativeQuote, release);
    if (!contact) throw new Error('EMAIL_RECIPIENT_UNAVAILABLE');
    return email(contact.email);
  }
  const release = await db.prepare(`SELECT id public_contact_release_id, status public_contact_status,
    source_reference public_contact_source_reference, withdrawn_at public_contact_withdrawn_at,
    disclosed_fields public_contact_disclosed_fields, customer_first_name public_customer_first_name,
    customer_last_name public_customer_last_name, customer_email public_customer_email, customer_phone public_customer_phone,
    customer_unit_number public_customer_unit_number, customer_street_address public_customer_street_address,
    customer_suburb public_customer_suburb, customer_address_state public_customer_address_state,
    postcode public_contact_postcode, customer_message public_customer_message, notice_version public_contact_notice_version,
    consent_purpose public_contact_consent_purpose, granted_at public_contact_granted_at
    FROM public_trade_lead_contact_releases WHERE opportunity_id = ? AND source_reference = ?
    ORDER BY datetime(updated_at) DESC, datetime(granted_at) DESC, id DESC LIMIT 1`)
    .bind(base.id, base.source_reference).first<Row>();
  const contact = publicTradeContactForMatchedLead({ ...base, ...release }, await isAeaTradeOwner(db, access.ownerUid));
  if (!contact) throw new Error('EMAIL_RECIPIENT_UNAVAILABLE');
  return email(contact.email);
}

export async function resolveTradeEmailRecipient(access: TeamAccess, target: Target, db: D1Database = getD1()) {
  if (!access.canViewCustomers || !(access.isOwner || access.canManageCustomers || access.canManageJobs || access.canSendQuotes || access.canManageInvoices)) throw new Error('EMAIL_ACCESS_REQUIRED');
  if (target.enquiryId) return leadRecipient(access, target.enquiryId, db);
  if (target.workOrderId) {
    const row = await db.prepare(`SELECT c.email FROM trade_work_orders w
      JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
      WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
        AND w.source_type <> 'opportunity' AND d.customer_source <> 'platform_private'
        AND (? = 1 OR w.assignee_member_id = ?)`)
      .bind(target.workOrderId, access.ownerUid, access.isOwner || access.jobScope === 'team' ? 1 : 0, access.memberId).first<{ email: string }>();
    if (!row) throw new Error('EMAIL_RECIPIENT_UNAVAILABLE');
    return email(row.email);
  }
  const row = await db.prepare(`SELECT c.email FROM trade_crm_customers c WHERE c.id = ? AND c.firebase_uid = ? AND c.record_status = 'active'
    AND (? = 1 OR EXISTS (SELECT 1 FROM trade_crm_job_details d JOIN trade_work_orders w ON w.id = d.work_order_id AND w.firebase_uid = d.firebase_uid
      WHERE d.crm_customer_id = c.id AND w.firebase_uid = c.firebase_uid AND w.partner_type = 'installer'
        AND w.record_status = 'active' AND w.assignee_member_id = ? AND w.source_type <> 'opportunity' AND d.customer_source <> 'platform_private'))`)
    .bind(target.customerId || '', access.ownerUid, access.isOwner || access.canSearchCustomers ? 1 : 0, access.memberId).first<{ email: string }>();
  if (!row) throw new Error('EMAIL_RECIPIENT_UNAVAILABLE');
  return email(row.email);
}
