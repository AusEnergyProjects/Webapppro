import {
  publicPlanContactReleaseAccessSql,
} from "@/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  strictPublicPlanQuoteServiceCategories,
} from "@/lib/public-plan-quote-preparation.mjs";
import {
  getCustomerProjectEvidenceBucket,
  type CustomerProjectEvidenceBucket,
} from "@/lib/customer-project-evidence-bucket";
import {
  publicLeadAcceptedDisclosure,
  publicLeadQuoteWorkflowIds,
  publicLeadQuoteWorkflowSnapshot,
} from "@/lib/public-lead-quote-workflow.mjs";
import { nextTlinkJobNumber } from "@/lib/trade-job-number-server";

type Row = Record<string, unknown>;

type AcceptedPhoto = {
  id: string;
  sourcePhotoId: string;
  sourceOpportunityId: string;
  sourcePreparationId: string;
  sourceReleaseId: string;
  promptId: string;
  label: string;
  serviceCategories: string[];
  serviceCategoriesJson: string;
  contentType: "image/jpeg" | "image/png";
  sizeBytes: number;
  objectKey: string;
  sha256: string;
  privacyStatus: "metadata-stripped";
};

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function acceptedPhotoId(matchId: string, sourcePhotoId: string) {
  return `accepted-${matchId}-${sourcePhotoId}`.slice(0, 240);
}

function acceptedPhotoObjectKey(
  tenantHash: string,
  matchId: string,
  attemptId: string,
  sourcePhotoId: string,
  sha256: string,
  contentType: string,
) {
  const extension = contentType === "image/png" ? "png" : "jpg";
  return `crm-job-media/accepted-public-lead/${tenantHash}/public-lead-work-${matchId}/${sourcePhotoId}/${attemptId}/${sha256}.${extension}`;
}

async function sourceAcceptedPhotos(
  db: D1Database,
  row: Row,
  installerUid: string,
  matchId: string,
  expectedMatchStatus: string,
) {
  if (!row.public_quote_preparation_id) return [];
  const photos = await db.prepare(`SELECT photo.id, photo.opportunity_id,
      photo.prompt_id, photo.prompt_label, photo.service_categories,
      photo.content_type, photo.size_bytes, photo.object_key, photo.sha256,
      photo.privacy_status
    FROM public_trade_lead_quote_photos photo
    JOIN public_trade_lead_quote_preparations preparation
      ON preparation.id = ?
      AND preparation.opportunity_id = photo.opportunity_id
      AND preparation.status = 'active'
      AND preparation.withdrawn_at = ''
      AND EXISTS (SELECT 1 FROM json_each(preparation.photo_prompt_ids)
        WHERE CAST(value AS text) = photo.prompt_id)
    JOIN trade_opportunity_matches opportunity_match
      ON opportunity_match.id = ? AND opportunity_match.opportunity_id = photo.opportunity_id
      AND opportunity_match.firebase_uid = ? AND opportunity_match.status = ?
    WHERE photo.opportunity_id = ? AND photo.status = 'active'
    ORDER BY photo.created_at, photo.id`)
    .bind(row.public_quote_preparation_id, matchId, installerUid, expectedMatchStatus,
      row.opportunity_id)
    .all<Row>();
  if (photos.results.length > 12) throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_INVALID");
  return photos.results;
}

async function stageAcceptedPhotoObjects(
  db: D1Database,
  bucket: CustomerProjectEvidenceBucket,
  installerUid: string,
  matchId: string,
  row: Row,
  sourcePhotos: Row[],
  now: string,
) {
  const tenantHash = (await sha256Text(installerUid)).slice(0, 32);
  const attemptId = crypto.randomUUID();
  const cleanupLeaseAt = new Date(Date.parse(now) + 15 * 60 * 1000).toISOString();
  const staged: AcceptedPhoto[] = [];
  try {
    for (const source of sourcePhotos) {
    const contentType = String(source.content_type || "");
    const sourcePhotoId = String(source.id || "");
    const sourceSha256 = String(source.sha256 || "");
    const sizeBytes = Number(source.size_bytes || 0);
    if (!sourcePhotoId || !/^[0-9a-f]{64}$/.test(sourceSha256)
      || !["image/jpeg", "image/png"].includes(contentType)
      || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 8 * 1024 * 1024
      || String(source.privacy_status || "") !== "metadata-stripped") {
      throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_INVALID");
    }
    const sourceObject = await bucket.get(String(source.object_key || ""));
    if (!sourceObject) throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_UNAVAILABLE");
    const bytes = await sourceObject.arrayBuffer();
    if (bytes.byteLength !== sizeBytes || await sha256Bytes(bytes) !== sourceSha256) {
      throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_INVALID");
    }
    const objectKey = acceptedPhotoObjectKey(
      tenantHash,
      matchId,
      attemptId,
      sourcePhotoId,
      sourceSha256,
      contentType,
    );
    await db.prepare(`INSERT INTO trade_crm_job_media_cleanup
      (object_key, firebase_uid, work_order_id, attempt_id, claim_token, status, attempts,
       next_attempt_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'staged', 0, ?, '', ?, ?)
      ON CONFLICT(object_key) DO UPDATE SET
        attempt_id = excluded.attempt_id, claim_token = '', status = 'staged', next_attempt_at = excluded.next_attempt_at,
        last_error = '', updated_at = excluded.updated_at
      WHERE firebase_uid = excluded.firebase_uid AND work_order_id = excluded.work_order_id
        AND status <> 'claimed'
        AND NOT EXISTS (SELECT 1 FROM trade_crm_job_media accepted
          WHERE accepted.object_key = excluded.object_key)`)
      .bind(objectKey, installerUid, `public-lead-work-${matchId}`, attemptId,
        cleanupLeaseAt, now, now)
      .run();
    const ownsIntent = await db.prepare(`SELECT 1 owned FROM trade_crm_job_media_cleanup
      WHERE object_key = ? AND attempt_id = ? AND status = 'staged'`)
      .bind(objectKey, attemptId).first<Row>();
    if (!ownsIntent) throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_CLEANUP_BUSY");
    const serviceCategoriesJson = String(source.service_categories || "[]");
    const serviceCategories = strictPublicPlanQuoteServiceCategories(serviceCategoriesJson);
    if (!serviceCategories.length) throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_INVALID");
    const photo: AcceptedPhoto = {
      id: acceptedPhotoId(matchId, sourcePhotoId),
      sourcePhotoId,
      sourceOpportunityId: String(source.opportunity_id || ""),
      sourcePreparationId: String(row.public_quote_preparation_id || ""),
      sourceReleaseId: String(row.public_contact_release_id || ""),
      promptId: String(source.prompt_id || ""),
      label: String(source.prompt_label || "").slice(0, 180),
      serviceCategories,
      serviceCategoriesJson,
      contentType: contentType as AcceptedPhoto["contentType"],
      sizeBytes,
      objectKey,
      sha256: sourceSha256,
      privacyStatus: "metadata-stripped",
    };
    staged.push(photo);
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: {
        acceptedPurpose: "customer-shared-quote-photo",
        sourceSha256,
        workOrderId: `public-lead-work-${matchId}`,
      },
    });
    const stored = await bucket.get(objectKey);
    if (!stored) throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_UNAVAILABLE");
    const storedBytes = await stored.arrayBuffer();
    if (storedBytes.byteLength !== sizeBytes || await sha256Bytes(storedBytes) !== sourceSha256) {
      throw new Error("PUBLIC_LEAD_QUOTE_PHOTO_INVALID");
    }
    }
  } catch (error) {
    await cleanupStagedAcceptedPhotos(db, bucket, attemptId, staged, now);
    throw error;
  }
  return { attemptId, staged };
}

async function cleanupStagedAcceptedPhotos(
  db: D1Database,
  bucket: CustomerProjectEvidenceBucket,
  attemptId: string,
  photos: AcceptedPhoto[],
  now: string,
) {
  for (const photo of photos) {
    const referenced = await db.prepare(`SELECT 1 referenced
      FROM trade_crm_job_media WHERE object_key = ? LIMIT 1`)
      .bind(photo.objectKey).first<Row>();
    if (referenced) {
      await db.prepare(`DELETE FROM trade_crm_job_media_cleanup
        WHERE object_key = ? AND attempt_id = ?`).bind(photo.objectKey, attemptId).run();
      continue;
    }
    const retryAt = new Date(Date.parse(now) + 15 * 60 * 1000).toISOString();
    await db.prepare(`UPDATE trade_crm_job_media_cleanup
      SET status = 'retry', next_attempt_at = ?, last_error = 'acceptance_aborted', updated_at = ?
      WHERE object_key = ? AND attempt_id = ? AND status = 'staged'
        AND NOT EXISTS (SELECT 1 FROM trade_crm_job_media media
          WHERE media.object_key = trade_crm_job_media_cleanup.object_key)`)
      .bind(retryAt, now, photo.objectKey, attemptId).run();
  }
}

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
      AND json_extract(d.accepted_disclosure_snapshot, '$.contract') =
        'tlink-public-lead-accepted-disclosure-v1'
      AND length(d.accepted_disclosure_sha256) = 64
      AND datetime(d.accepted_disclosure_at) IS NOT NULL
    JOIN trade_crm_customers customer
      ON customer.id = d.crm_customer_id AND customer.firebase_uid = w.firebase_uid
      AND customer.record_status = 'active'
    JOIN trade_crm_customer_contacts contact
      ON contact.id = ? AND contact.customer_id = customer.id
      AND contact.firebase_uid = w.firebase_uid AND contact.record_status = 'active'
    JOIN trade_crm_service_sites site
      ON site.id = d.service_site_id AND site.customer_id = customer.id
      AND site.firebase_uid = w.firebase_uid AND site.record_status = 'active'
      AND site.site_label = 'Customer property'
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
  expectedMatchStatus = "interested",
): Promise<PublicLeadQuoteWorkflow> {
  const ids = publicLeadQuoteWorkflowIds(matchId);
  if (!ids) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_INVALID");
  const existing = await existingWorkflow(db, installerUid, matchId, ids);
  if (existing) return workflowResponse(existing, true);
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
      preparation.id public_quote_preparation_id,
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
      AND ${publicPlanContactReleaseAccessSql("contact")}
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
    WHERE m.id = ? AND m.firebase_uid = ? AND m.status = ?
      AND o.status = 'open' AND o.expires_at > ?
    LIMIT 1`)
    .bind(
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
      matchId,
      installerUid,
      expectedMatchStatus,
      now,
    )
    .first<Row>();
  const snapshot = publicLeadQuoteWorkflowSnapshot(row);
  if (!row || !snapshot) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_UNAVAILABLE");
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
  const requestDescription = [
    snapshot.summary,
    snapshot.contact.message ? `Customer message: ${snapshot.contact.message}` : "",
    ...snapshot.answers.map((answer) => `${answer.label}: ${answer.answer}`),
  ].filter(Boolean).join("\n").slice(0, 3000);
  const bucket = getCustomerProjectEvidenceBucket();
  const sourcePhotos = await sourceAcceptedPhotos(
    db,
    row,
    installerUid,
    matchId,
    expectedMatchStatus,
  );
  const stagedPhotos = await stageAcceptedPhotoObjects(
    db,
    bucket,
    installerUid,
    matchId,
    row,
    sourcePhotos,
    now,
  );
  const acceptedDisclosure = publicLeadAcceptedDisclosure(
    snapshot,
    row,
    now,
    stagedPhotos.staged,
  );
  if (!acceptedDisclosure) {
    await cleanupStagedAcceptedPhotos(db, bucket, stagedPhotos.attemptId, stagedPhotos.staged, now);
    throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_UNAVAILABLE");
  }
  const acceptedDisclosureJson = JSON.stringify(acceptedDisclosure);
  const acceptedDisclosureSha256 = await sha256Text(acceptedDisclosureJson);
  const account = await db.prepare(`SELECT quote_email_intro, quote_default_terms
    FROM trade_accounts WHERE firebase_uid = ? AND partner_type = 'installer' LIMIT 1`)
    .bind(installerUid).first<Row>();
  const quoteNumber = `Q-${workNumber.replace(/^JOB-/, "")}`;

  const acceptedPhotoStatements = stagedPhotos.staged.map((photo) => {
    const extension = photo.contentType === "image/png" ? "png" : "jpg";
    const evidenceEnvelope = JSON.stringify({
      contract: "tlink-accepted-public-lead-job-file-v1",
      privacyStatus: photo.privacyStatus,
      provenance: {
        sourcePhotoId: photo.sourcePhotoId,
        sourceOpportunityId: photo.sourceOpportunityId,
        sourcePreparationId: photo.sourcePreparationId,
        sourceReleaseId: photo.sourceReleaseId,
        promptId: photo.promptId,
        serviceCategories: photo.serviceCategories,
      },
    });
    return db.prepare(`INSERT INTO trade_crm_job_media
      (id, work_order_id, firebase_uid, category, file_name, content_type, size_bytes,
       object_key, caption, source, photo_request_id, photo_requirement_id,
       request_revision, checklist_version, customer_acknowledged_at,
       evidence_envelope, original_sha256, accepted_lead_source_photo_id,
       accepted_lead_source_opportunity_id, accepted_lead_source_preparation_id,
       accepted_lead_source_release_id, accepted_lead_prompt_id,
       accepted_lead_service_categories, accepted_disclosure_sha256, created_at, updated_at)
      SELECT ?, ?, ?, 'before', ?, ?, ?, ?, ?, 'accepted_public_lead', '', '', 0, '',
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM trade_crm_job_media_cleanup cleanup
        WHERE cleanup.object_key = ? AND cleanup.attempt_id = ?
          AND cleanup.status IN ('staged', 'retry'))`)
      .bind(photo.id, ids.workOrderId, installerUid,
        `customer-quote-photo-${photo.sourcePhotoId}.${extension}`, photo.contentType,
        photo.sizeBytes, photo.objectKey, photo.label, now, evidenceEnvelope, photo.sha256,
        photo.sourcePhotoId, photo.sourceOpportunityId, photo.sourcePreparationId,
        photo.sourceReleaseId, photo.promptId, JSON.stringify(photo.serviceCategories),
        acceptedDisclosureSha256, now, now, photo.objectKey, stagedPhotos.attemptId);
  });
  const acceptedPhotoCleanupStatements = stagedPhotos.staged.map((photo) => db.prepare(`DELETE FROM trade_crm_job_media_cleanup
    WHERE object_key = ? AND attempt_id = ? AND status IN ('staged', 'retry')`)
    .bind(photo.objectKey, stagedPhotos.attemptId));
  try {
    await db.batch([
    db.prepare(`UPDATE trade_opportunity_matches
      SET status = 'interested', partner_note = '', updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = ? AND opportunity_id = ?
        AND EXISTS (SELECT 1 FROM trade_opportunities opportunity
          WHERE opportunity.id = trade_opportunity_matches.opportunity_id
            AND opportunity.status = 'open' AND opportunity.expires_at > ?)`)
      .bind(now, matchId, installerUid, expectedMatchStatus, row.opportunity_id, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_customers
      (id, firebase_uid, customer_number, customer_type, first_name, last_name,
       business_name, business_number, email, phone, address_line_1, address_line_2,
       suburb, address_state, postcode, tags, private_notes, record_status, created_at, updated_at)
      VALUES (?, ?, ?, 'residential', ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, '', 'active', ?, ?)`)
      .bind(ids.customerId, installerUid, customerNumber,
        snapshot.contact.firstName, snapshot.contact.lastName,
        snapshot.contact.email, snapshot.contact.phone,
        snapshot.contact.addressLine1, snapshot.contact.addressLine2,
        snapshot.contact.suburb, snapshot.contact.addressState,
        snapshot.contact.postcode, JSON.stringify(["aea-public-lead"]), now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_customer_contacts
      (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone,
       is_primary, record_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Released lead contact', ?, ?, 1, 'active', ?, ?)`)
      .bind(ids.contactId, installerUid, ids.customerId,
        snapshot.contact.firstName, snapshot.contact.lastName,
        snapshot.contact.email, snapshot.contact.phone, now, now),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_service_sites
      (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2,
       suburb, address_state, postcode, address_entry_mode, address_provider,
       address_provider_reference, address_formatted, address_verified_at,
       access_instructions, parking_instructions, hazard_notes, is_primary,
       record_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_pending_review', '', '', '', '',
       '', '', '', 1, 'active', ?, ?)`)
      .bind(ids.serviceSiteId, installerUid, ids.customerId, siteLabel,
        snapshot.contact.addressLine1, snapshot.contact.addressLine2,
        snapshot.contact.suburb, snapshot.contact.addressState,
        snapshot.contact.postcode, now, now),
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
    ...acceptedPhotoStatements,
    db.prepare(`INSERT OR IGNORE INTO trade_crm_job_details
      (id, work_order_id, firebase_uid, crm_customer_id, service_site_id,
       customer_source, pipeline_stage, building_type, description, customer_reference,
       next_action, tags, estimated_value_cents, quoted_value_cents, invoiced_value_cents,
       paid_value_cents, quote_status, invoice_status, payment_due_at,
       accepted_disclosure_snapshot, accepted_disclosure_sha256, accepted_disclosure_at,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'public_lead_released', 'quoting', 'not_sure', ?, ?,
       'Review the customer request and prepare the quote.', ?, 0, 0, 0, 0,
       'draft', 'not_started', '', ?, ?, ?, ?, ?)`)
      .bind(ids.jobDetailId, ids.workOrderId, installerUid, ids.customerId,
        ids.serviceSiteId, requestDescription, snapshot.reference,
        JSON.stringify(["aea-public-lead", ...snapshot.categories]),
        acceptedDisclosureJson, acceptedDisclosureSha256, now, now, now),
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
    ...acceptedPhotoCleanupStatements,
    ]);
  } catch (error) {
    await cleanupStagedAcceptedPhotos(
      db,
      bucket,
      stagedPhotos.attemptId,
      stagedPhotos.staged,
      now,
    );
    const replay = await existingWorkflow(db, installerUid, matchId, ids);
    if (replay) return workflowResponse(replay, true);
    throw error;
  }

  const created = await existingWorkflow(db, installerUid, matchId, ids);
  if (!created) throw new Error("PUBLIC_LEAD_QUOTE_WORKFLOW_UNAVAILABLE");
  return workflowResponse(created, false);
}
