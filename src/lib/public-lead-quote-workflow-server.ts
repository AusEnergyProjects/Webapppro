import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "@/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
} from "@/lib/public-plan-quote-preparation.mjs";
import {
  publicLeadQuoteWorkflowIds,
  publicLeadQuoteWorkflowSnapshot,
} from "@/lib/public-lead-quote-workflow.mjs";
import { nextTlinkJobNumber } from "@/lib/trade-job-number-server";

type Row = Record<string, unknown>;

export type PublicLeadQuoteWorkflow = {
  workOrderId: string;
  workNumber: string;
  customerId: string;
  quoteId: string;
  quoteVersionId: string;
  replayed: boolean;
};

async function existingWorkflow(
  db: D1Database,
  installerUid: string,
  matchId: string,
  ids: {
    customerId: string;
    contactId: string;
    serviceSiteId: string;
    siteContactId: string;
    workOrderId: string;
    jobDetailId: string;
    quoteId: string;
    quoteVersionId: string;
  },
) {
  return db.prepare(`SELECT w.id work_order_id, w.work_number, w.record_status,
      d.crm_customer_id, q.id quote_id, v.id quote_version_id
    FROM trade_work_orders w
    JOIN trade_crm_job_details d
      ON d.id = ? AND d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      AND d.customer_source = 'public_lead_released'
      AND d.crm_customer_id = ? AND d.service_site_id = ?
    JOIN trade_crm_customers customer
      ON customer.id = d.crm_customer_id AND customer.firebase_uid = w.firebase_uid
      AND customer.record_status = 'active'
      AND customer.first_name = '' AND customer.last_name = ''
      AND customer.business_name = '' AND customer.email = ''
      AND customer.phone = '' AND customer.address_line_1 = ''
      AND customer.address_line_2 = '' AND customer.suburb = ''
      AND customer.address_state = '' AND customer.postcode = ''
    JOIN trade_crm_customer_contacts contact
      ON contact.id = ? AND contact.customer_id = customer.id
      AND contact.firebase_uid = w.firebase_uid AND contact.record_status = 'active'
      AND contact.first_name = '' AND contact.last_name = ''
      AND contact.email = '' AND contact.phone = ''
    JOIN trade_crm_service_sites site
      ON site.id = d.service_site_id AND site.customer_id = customer.id
      AND site.firebase_uid = w.firebase_uid AND site.record_status = 'active'
      AND site.site_label = 'Customer property'
      AND site.address_line_1 = '' AND site.address_line_2 = ''
      AND site.suburb = '' AND site.address_state = '' AND site.postcode = ''
    JOIN trade_crm_site_contacts site_contact
      ON site_contact.id = ? AND site_contact.service_site_id = site.id
      AND site_contact.customer_contact_id = contact.id
      AND site_contact.firebase_uid = w.firebase_uid
      AND site_contact.record_status = 'active'
    JOIN trade_crm_quotes q
      ON q.id = ? AND q.work_order_id = w.id AND q.firebase_uid = w.firebase_uid
      AND q.crm_customer_id = customer.id AND q.service_site_id = site.id
    JOIN trade_crm_quote_versions v
      ON v.id = ? AND v.quote_id = q.id AND v.firebase_uid = q.firebase_uid
      AND v.version_number = q.current_version_number
    WHERE w.id = ? AND w.firebase_uid = ? AND w.source_type = 'public_lead'
      AND w.source_reference = ?
    LIMIT 1`)
    .bind(ids.jobDetailId, ids.customerId, ids.serviceSiteId, ids.contactId,
      ids.siteContactId, ids.quoteId, ids.quoteVersionId, ids.workOrderId,
      installerUid, matchId)
    .first<Row>();
}

function workflowResponse(row: Row, replayed: boolean): PublicLeadQuoteWorkflow {
  if (String(row.record_status || "") !== "active") {
    throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_ARCHIVED");
  }
  return {
    workOrderId: String(row.work_order_id || ""),
    workNumber: String(row.work_number || ""),
    customerId: String(row.crm_customer_id || ""),
    quoteId: String(row.quote_id || ""),
    quoteVersionId: String(row.quote_version_id || ""),
    replayed,
  };
}

export async function startPublicLeadQuoteWorkflow(
  db: D1Database,
  installerUid: string,
  matchId: string,
  now: string,
): Promise<PublicLeadQuoteWorkflow> {
  const ids = publicLeadQuoteWorkflowIds(matchId);
  if (!ids) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_INVALID");
  const row = await db.prepare(`SELECT m.id match_id, m.matched_categories,
      o.id opportunity_id, o.title, o.summary, o.priority, o.source_reference,
      o.postcode opportunity_postcode, o.state,
      contact.id public_contact_release_id,
      contact.status public_contact_status,
      contact.source_reference public_contact_source_reference,
      contact.withdrawn_at public_contact_withdrawn_at,
      contact.disclosed_fields public_contact_disclosed_fields,
      contact.customer_first_name public_customer_first_name,
      contact.customer_last_name public_customer_last_name,
      contact.customer_email public_customer_email,
      contact.customer_phone public_customer_phone,
      contact.customer_unit_number public_customer_unit_number,
      contact.customer_street_address public_customer_street_address,
      contact.customer_suburb public_customer_suburb,
      contact.customer_address_state public_customer_address_state,
      contact.postcode public_contact_postcode,
      contact.customer_message public_customer_message,
      contact.notice_version public_contact_notice_version,
      contact.consent_purpose public_contact_consent_purpose,
      contact.granted_at public_contact_granted_at,
      preparation.question_answers public_quote_answers
    FROM trade_opportunity_matches m
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    JOIN public_trade_lead_contact_releases contact
      ON contact.id = (
        SELECT current_release.id
        FROM public_trade_lead_contact_releases current_release
        WHERE current_release.opportunity_id = o.id
          AND current_release.source_reference = o.source_reference
        ORDER BY datetime(current_release.updated_at) DESC,
          datetime(current_release.granted_at) DESC,
          current_release.id DESC
        LIMIT 1
      )
      AND contact.status = 'active'
      AND contact.notice_version = ?
      AND contact.consent_purpose = ?
      AND datetime(contact.granted_at) IS NOT NULL
      AND contact.withdrawn_at = ''
    LEFT JOIN public_trade_lead_quote_preparations preparation
      ON preparation.opportunity_id = o.id
      AND preparation.source_reference = o.source_reference
      AND preparation.status = 'active'
      AND preparation.notice_version = ?
      AND preparation.consent_purpose = ?
      AND datetime(preparation.granted_at) IS NOT NULL
      AND preparation.withdrawn_at = ''
    WHERE m.id = ? AND m.firebase_uid = ? AND m.status = 'interested'
      AND o.status = 'open' AND o.expires_at > ?
    LIMIT 1`)
    .bind(
      PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
      PUBLIC_PLAN_CONSENT_PURPOSE,
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
      matchId,
      installerUid,
      now,
    )
    .first<Row>();
  const snapshot = publicLeadQuoteWorkflowSnapshot(row);
  if (!row || !snapshot) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_UNAVAILABLE");

  const existing = await existingWorkflow(db, installerUid, matchId, ids);
  if (existing) return workflowResponse(existing, true);
  const incomplete = await db.prepare(`SELECT 1 found FROM trade_crm_customers WHERE id = ?
    UNION ALL SELECT 1 FROM trade_crm_customer_contacts WHERE id = ?
    UNION ALL SELECT 1 FROM trade_crm_service_sites WHERE id = ?
    UNION ALL SELECT 1 FROM trade_work_orders WHERE id = ?
    UNION ALL SELECT 1 FROM trade_crm_job_details WHERE id = ?
    UNION ALL SELECT 1 FROM trade_crm_quotes WHERE id = ?
    UNION ALL SELECT 1 FROM trade_crm_quote_versions WHERE id = ?
    LIMIT 1`)
    .bind(ids.customerId, ids.contactId, ids.serviceSiteId, ids.workOrderId,
      ids.jobDetailId, ids.quoteId, ids.quoteVersionId)
    .first<Row>();
  if (incomplete) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_INCOMPLETE");

  const enquiryId = `marketplace-${matchId}`;
  const enquiry = await db.prepare(`SELECT id FROM trade_crm_enquiries
    WHERE id = ? AND firebase_uid = ? AND source_type = 'tlink_marketplace'
      AND source_reference = ? AND opportunity_match_id = ?
      AND record_status = 'active'
    LIMIT 1`)
    .bind(enquiryId, installerUid, matchId, matchId)
    .first<Row>();
  if (!enquiry) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_UNAVAILABLE");

  const workNumber = await nextTlinkJobNumber(db, now);
  const customerNumber = `CUS-AEA-${matchId.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const primaryCategory = snapshot.categories[0] || "other";
  const siteLabel = "Customer property";
  const requestDescription = snapshot.summary.slice(0, 3000);
  const account = await db.prepare(`SELECT quote_email_intro, quote_default_terms
    FROM trade_accounts WHERE firebase_uid = ? AND partner_type = 'installer' LIMIT 1`)
    .bind(installerUid).first<Row>();
  const quoteNumber = `Q-${workNumber.replace(/^JOB-/, "")}`;

  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_crm_customers
      (id, firebase_uid, customer_number, customer_type, first_name, last_name,
       business_name, business_number, email, phone, address_line_1, address_line_2,
       suburb, address_state, postcode, tags, private_notes, record_status, created_at, updated_at)
      VALUES (?, ?, ?, 'residential', '', '', '', '', '', '', '', '', '', '', '', ?, '', 'active', ?, ?)`)
      .bind(ids.customerId, installerUid, customerNumber,
        JSON.stringify(["aea-public-lead"]), now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_customer_contacts
      (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone,
       is_primary, record_status, created_at, updated_at)
      VALUES (?, ?, ?, '', '', 'Released lead contact', '', '', 1, 'active', ?, ?)`)
      .bind(ids.contactId, installerUid, ids.customerId, now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_service_sites
      (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2,
       suburb, address_state, postcode, address_entry_mode, address_provider,
       address_provider_reference, address_formatted, address_verified_at,
       access_instructions, parking_instructions, hazard_notes, is_primary,
       record_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', '', '', '', '', 'manual_pending_review', '', '', '', '',
       '', '', '', 1, 'active', ?, ?)`)
      .bind(ids.serviceSiteId, installerUid, ids.customerId, siteLabel, now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_site_contacts
      (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary,
       record_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Primary service contact', 1, 'active', ?, ?)`)
      .bind(ids.siteContactId, installerUid, ids.serviceSiteId, ids.contactId, now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_work_orders
      (id, firebase_uid, partner_type, work_type, source_type, source_reference,
       work_number, title, service_category, service_categories, site_area, stage,
       priority, scheduled_start, scheduled_end, assignee_member_id, assignee_label,
       record_status, created_at, updated_at)
      VALUES (?, ?, 'installer', 'job', 'public_lead', ?, ?, ?, ?, ?, '', 'backlog', ?,
       '', '', '', '', 'active', ?, ?)`)
      .bind(ids.workOrderId, installerUid, matchId, workNumber, snapshot.title,
        primaryCategory, JSON.stringify(snapshot.categories), snapshot.priority,
        now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_job_details
      (id, work_order_id, firebase_uid, crm_customer_id, service_site_id,
       customer_source, pipeline_stage, building_type, description, customer_reference,
       next_action, tags, estimated_value_cents, quoted_value_cents, invoiced_value_cents,
       paid_value_cents, quote_status, invoice_status, payment_due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'public_lead_released', 'quoting', 'not_sure', ?, ?,
       'Review the customer request and prepare the quote.', ?, 0, 0, 0, 0,
       'draft', 'not_started', '', ?, ?)`)
      .bind(ids.jobDetailId, ids.workOrderId, installerUid, ids.customerId,
        ids.serviceSiteId, requestDescription, snapshot.reference,
        JSON.stringify(["aea-public-lead", ...snapshot.categories]), now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_work_order_events
      (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, 'public_lead_quote_started', ?, ?)`)
      .bind(ids.eventId, ids.workOrderId, installerUid,
        `${workNumber} quote workspace created from enquiry ${snapshot.reference || matchId}.`, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_quotes
      (id, work_order_id, firebase_uid, crm_customer_id, service_site_id,
       quote_number, current_version_number, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?)`)
      .bind(ids.quoteId, ids.workOrderId, installerUid, ids.customerId,
        ids.serviceSiteId, quoteNumber, now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_versions
      (id, quote_id, firebase_uid, version_number, status, acceptance_email,
       subtotal_cents, tax_cents, total_cents, terms, customer_message, valid_until,
       consent_statement, issued_at, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'draft', '', 0, 0, 0, ?, ?, '', '', '', ?, ?)`)
      .bind(ids.quoteVersionId, ids.quoteId, installerUid,
        String(account?.quote_default_terms || ""), String(account?.quote_email_intro || ""),
        now, now),
    db.prepare(`UPDATE trade_crm_enquiries SET customer_id = ?, customer_contact_id = ?,
      service_site_id = ?, status = 'contacted', duplicate_decision = 'converted',
      updated_at = ? WHERE id = ? AND firebase_uid = ?`)
      .bind(ids.customerId, ids.contactId, ids.serviceSiteId, now, enquiryId, installerUid),
  ]);

  const created = await existingWorkflow(db, installerUid, matchId, ids);
  if (!created) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_UNAVAILABLE");
  return workflowResponse(created, false);
}
