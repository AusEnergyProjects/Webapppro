import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, parseJsonList, sameOrigin } from "@/lib/admin-server";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import {
  publicLeadIssueAccessGuard,
  publicLeadQuoteAccessFingerprint,
} from "@/lib/public-lead-quote-workflow.mjs";
import { normaliseTradeQuoteLineGroup } from "@/lib/trade-quote";
import { normaliseQuoteChoices } from "@/lib/trade-quote-options";
import { lowersAuthoritativeTotal, quoteInputAppliesDiscount, quoteInputDiscountMagnitude } from "@/lib/trade-discount-permissions";
import { priceBookItemsForQuote, resolvePriceBookQuoteLines } from "@/lib/trade-price-book-server";
import { jobPacketsForQuote, resolveJobPacketQuoteLines } from "@/lib/trade-job-packet-server";
import {
  assignedJob,
  canManageQuotes,
  canSendQuotes,
  canViewQuotes,
  requireInstallerTeamAccess,
  type TeamAccess,
} from "@/lib/trade-team-server";
import { newQuoteLinkSecret, hashQuoteLinkSecret, protectQuoteLinkSecret, quoteReviewPath, recoverQuoteLinkSecret } from "@/lib/trade-quote-links";
import { maskPhotoRequestEmail } from "@/lib/trade-photo-request-delivery";
import {
  latestTradeQuoteDeliveryStatus,
  tradeQuoteDeliveryStatus,
  tradeQuoteRecipientEmailSha256,
} from "@/lib/trade-quote-delivery-server";
import {
  assertTradeQuoteIssueDeliveryAccess,
  tradeQuoteDeliveryPresentation,
  tradeQuoteDeliveryPublicOrigin,
} from "@/lib/trade-quote-delivery-policy.mjs";
import { buildQuoteExecutionSnapshot } from "@/lib/trade-quote-execution-server";
import {
  buildTradeQuoteDocumentSnapshot,
  parseTradeQuoteDocumentSnapshot,
} from "@/lib/trade-quote-review-server";
import {
  buildTradeQuoteEmail,
  tradeQuoteEmailContentSha256,
} from "@/lib/trade-quote-email";
import {
  renderTradeQuotePdf,
  tradeQuotePdfFilename,
} from "@/lib/trade-quote-pdf-server";
import {
  deleteTradeQuoteIssuedPdf,
  issuedTradeQuotePdf,
  prepareTradeQuoteIssuedPdfReference,
  storeTradeQuoteIssuedPdf,
  verifyTradeQuoteIssuedPdf,
} from "@/lib/trade-quote-issued-pdf-server";
import {
  activateTradeIssuedDocumentCleanup,
  stageTradeIssuedDocumentCleanup,
} from "@/lib/trade-issued-document-cleanup";

export const runtime = "edge";

type Row = Record<string, unknown>;
type ResolvedGroup = Awaited<ReturnType<typeof resolveLineGroup>>;
type StagedQuoteError = Error & { stage?: string };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stagedQuoteError(code: string, stage: string) {
  const error = new Error(code) as StagedQuoteError;
  error.stage = stage;
  return error;
}

async function installerAccess(request: Request, permission: "view" | "manage" | "send") {
  const access = await requireInstallerTeamAccess(request);
  if (permission === "view" && !canViewQuotes(access)) throw new Error("QUOTE_VIEW_REQUIRED");
  if (permission === "manage" && !canManageQuotes(access)) throw new Error("QUOTE_MANAGEMENT_REQUIRED");
  if (permission === "send" && !canSendQuotes(access)) throw new Error("QUOTE_SEND_REQUIRED");
  return access;
}

async function revokeOwnedQuoteLink(
  ownerUid: string,
  workOrderId: string,
  now: string,
) {
  const db = getD1();
  const row = await db.prepare(`SELECT link.id link_id, link.token_issue,
      quote.id quote_id, version.id quote_version_id
    FROM trade_work_orders work
    JOIN trade_crm_job_details detail
      ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      AND detail.customer_source IN ('trade_owned', 'public_lead_released')
    JOIN trade_crm_quotes quote
      ON quote.work_order_id = work.id AND quote.firebase_uid = work.firebase_uid
    JOIN trade_crm_quote_versions version
      ON version.quote_id = quote.id AND version.firebase_uid = quote.firebase_uid
      AND version.version_number = quote.current_version_number
    JOIN trade_crm_quote_links link
      ON link.quote_version_id = version.id AND link.firebase_uid = work.firebase_uid
      AND link.work_order_id = work.id
    WHERE work.id = ? AND work.firebase_uid = ? AND work.record_status = 'active'
    LIMIT 1`)
    .bind(workOrderId, ownerUid)
    .first<Row>();
  if (!row) throw new Error("QUOTE_NOT_FOUND");
  const revoked = await db.batch([
    db.prepare(`UPDATE trade_crm_quote_links
      SET status = 'revoked', token_hash = '', encrypted_token = '',
        revoked_at = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND token_issue = ?
        AND NOT EXISTS (
          SELECT 1 FROM trade_crm_quote_deliveries delivery
          WHERE delivery.quote_link_id = trade_crm_quote_links.id
            AND delivery.firebase_uid = trade_crm_quote_links.firebase_uid
            AND (
              delivery.status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
              OR (delivery.status = 'failed' AND delivery.next_attempt_at <> '')
            )
        )`)
      .bind(now, now, row.link_id, ownerUid, row.token_issue),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events
      (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid,
       event_type, actor_type, summary, evidence_key, occurred_at)
      SELECT ?, ?, ?, ?, ?, ?, 'revoked', 'office',
        'Secure quote link revoked.', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM trade_crm_quote_links current_link
        WHERE current_link.id = ? AND current_link.firebase_uid = ?
          AND current_link.status = 'revoked' AND current_link.token_hash = ''
          AND current_link.updated_at = ?
      )`)
      .bind(crypto.randomUUID(), row.link_id, row.quote_id, row.quote_version_id,
        workOrderId, ownerUid,
        `revoked:${row.quote_version_id}:${row.token_issue}`, now,
        row.link_id, ownerUid, now),
  ]);
  if (Number(revoked[0]?.meta.changes || 0) !== 1) {
    throw new Error("QUOTE_DELIVERY_PENDING");
  }
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
  if (code === "QUOTE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not include customer quotes." }, 403);
  if (code === "QUOTE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow quote changes." }, 403);
  if (code === "QUOTE_SEND_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow customer quote delivery." }, 403);
  if (code === "QUOTE_DELIVERY_CONSENT_REQUIRED") return adminJson({ ok: false, error: "Confirm that this customer asked to receive the current quote by email." }, 400);
  if (code === "DISCOUNT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow discounts or price reductions." }, 403);
  if (code === "PRICE_BOOK_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow saved price-book or common-job items." }, 403);
  if (code === "CUSTOMER_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow customer contact changes." }, 403);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This quote belongs to a job outside your assigned work." }, 403);
  if (code === "PUBLIC_LEAD_QUOTE_ACCESS_ENDED") return adminJson({ ok: false, error: "The accepted customer disclosure could not be verified. No quote was sent. Refresh the job or contact support." }, 409);
  if (code === "QUOTE_ISSUE_IN_PROGRESS") return adminJson({ ok: false, error: "This quote is already being issued. Wait for it to finish before trying again." }, 409);
  if (code === "QUOTE_DELIVERY_PENDING") return adminJson({ ok: false, error: "The current quote email is still being delivered. Wait for its delivery status before creating a replacement quote." }, 409);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Choose a direct customer job with an authoritative service site." }, 404);
  if (code === "QUOTE_NOT_FOUND") return adminJson({ ok: false, error: "Quote not found." }, 404);
  if (code === "IMMUTABLE_VERSION") return adminJson({ ok: false, error: "Issued quote versions cannot be changed. Create the next version instead." }, 409);
  if (code === "QUOTE_DOCUMENT_INVALID") return adminJson({ ok: false, error: "The issued quote document snapshot could not be verified. Create a replacement version before sending." }, 409);
  if (code === "QUOTE_DOCUMENT_TOO_LARGE") return adminJson({ ok: false, error: "This quote is too large to issue as one customer document." }, 400);
  if (["QUOTE_ISSUED_PDF_MISMATCH", "QUOTE_ISSUED_PDF_UNAVAILABLE"].includes(code)) return adminJson({ ok: false, error: "The exact issued quote PDF could not be verified. Create and issue a replacement quote version before sending." }, 409);
  if (code === "PRICE_BOOK_ITEM_UNAVAILABLE") return adminJson({ ok: false, error: "A saved item is no longer active. Remove it or add its replacement from the price book." }, 409);
  if (["JOB_PACKET_UNAVAILABLE", "JOB_PACKET_DUPLICATE_LINE"].includes(code)) return adminJson({ ok: false, error: "That job packet changed or is no longer ready. Apply its current version again." }, 409);
  if (code === "INVALID_QUOTE_CHOICES") return adminJson({ ok: false, error: "Each customer choice needs a clear name, valid group and at least one priced line." }, 400);
  if (["INVALID_LINES", "INVALID_DECIMAL", "INVALID_QUANTITY", "INVALID_MONEY", "INVALID_TAX", "INVALID_TOTAL", "QUOTE_TOTAL_TOO_LARGE"].includes(code)) return adminJson({ ok: false, error: "Check every line description, quantity, price and tax selection." }, 400);
  const requestId = crypto.randomUUID();
  if (["QUOTE_ISSUE_STORAGE_FAILED", "QUOTE_ISSUE_DELIVERY_MISSING"].includes(code)) {
    console.error("Trade quote issue failed", {
      code,
      requestId,
      stage: String((error as StagedQuoteError | null)?.stage || "issue"),
    });
    const response = adminJson({
      ok: false,
      error: code === "QUOTE_ISSUE_DELIVERY_MISSING"
        ? "The quote was issued but its email delivery record is missing. No email was submitted. Contact support with this reference."
        : "The quote could not be issued and no email was submitted. Try again. If it still fails, contact support with this reference.",
      errorCode: code,
      deliveryState: "not_queued",
      retryable: code === "QUOTE_ISSUE_STORAGE_FAILED",
      requestId,
    }, code === "QUOTE_ISSUE_STORAGE_FAILED" ? 503 : 409);
    response.headers.set("X-TLink-Request-Id", requestId);
    return response;
  }
  console.error("Trade quote private request failed", {
    code: code === "QUOTE_PDF_UNAVAILABLE" ? code : "QUOTE_PRIVATE_REQUEST_FAILED",
    requestId,
    stage: String((error as StagedQuoteError | null)?.stage || "request"),
  });
  const response = code === "QUOTE_PDF_UNAVAILABLE"
    ? adminJson({
        ok: false,
        error: "The quote PDF could not be prepared. No customer email was submitted. Try again.",
        requestId,
      }, 503)
    : adminJson({
        ok: false,
        error: "The private quote request could not be completed.",
        requestId,
      }, 500);
  response.headers.set("X-TLink-Request-Id", requestId);
  return response;
}

async function renderQuotePdfOrThrow(
  snapshot: Parameters<typeof renderTradeQuotePdf>[0],
  origin: string,
  stage: string,
) {
  try {
    return await renderTradeQuotePdf(snapshot, { origin });
  } catch {
    const error = new Error("QUOTE_PDF_UNAVAILABLE") as StagedQuoteError;
    error.stage = stage;
    throw error;
  }
}

async function directJob(ownerUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id, w.work_number, w.title, w.service_categories,
      w.source_type, w.source_reference work_source_reference,
      d.crm_customer_id, d.service_site_id, d.description, d.customer_reference, d.customer_source,
      d.accepted_disclosure_snapshot, d.accepted_disclosure_sha256, d.accepted_disclosure_at,
      c.customer_number, c.first_name, c.last_name, c.business_name, c.email customer_email,
      s.site_label, s.address_line_1, s.address_line_2, s.suburb, s.address_state, s.postcode
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
    JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.customer_id = c.id AND s.firebase_uid = w.firebase_uid AND s.record_status = 'active'
    WHERE w.id = ? AND w.firebase_uid = ? AND w.record_status = 'active'
      AND d.customer_source IN ('trade_owned', 'public_lead_released')`)
    .bind(workOrderId, ownerUid).first<Row>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  if (String(row.source_type || "") === "public_lead") {
    if (String(row.customer_source || "") !== "public_lead_released"
      || !publicLeadQuoteAccessFingerprint(row)) {
      throw new Error("PUBLIC_LEAD_QUOTE_ACCESS_ENDED");
    }
    return {
      ...row,
      public_authorised_email: String(row.customer_email || ""),
      public_lead_enquiry: 1,
    };
  }
  return row;
}

async function currentPublicLeadJob(
  ownerUid: string,
  workOrderId: string,
  priorJob: Row,
) {
  if (!priorJob.public_lead_enquiry) return priorJob;
  const current = await directJob(ownerUid, workOrderId);
  if (
    !current.public_lead_enquiry
    || !publicLeadQuoteAccessFingerprint(current)
    || publicLeadQuoteAccessFingerprint(current)
      !== publicLeadQuoteAccessFingerprint(priorJob)
  ) {
    throw new Error("PUBLIC_LEAD_QUOTE_ACCESS_ENDED");
  }
  return current;
}

async function authorisedEmails(ownerUid: string, customerId: string, acceptedPublicEmail = "") {
  const acceptedEmail = acceptedPublicEmail.trim().toLowerCase();
  if (acceptedEmail) {
    return EMAIL_PATTERN.test(acceptedEmail) ? [acceptedEmail] : [];
  }
  const rows = await getD1().prepare(`SELECT email FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND email != ''
    UNION SELECT email FROM trade_crm_customer_contacts WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' AND email != ''`)
    .bind(customerId, ownerUid, customerId, ownerUid).all<Row>();
  return [...new Set([
    ...rows.results.map((row) => String(row.email || "").trim().toLowerCase()),
    acceptedEmail,
  ].filter((email) => EMAIL_PATTERN.test(email)))].sort();
}

function acceptedPublicEmail(job: Row) {
  return String(job.public_authorised_email || "");
}

function acceptedQuoteSnapshotOverrides(job: Row) {
  if (!job.public_lead_enquiry) return {};
  return {
    releasedCustomer: {
      name: [job.first_name, job.last_name].filter(Boolean).join(" ") || "Customer",
      email: acceptedPublicEmail(job),
    },
    releasedSite: {
      label: String(job.site_label || "Customer property"),
      addressLine1: String(job.address_line_1 || ""),
      addressLine2: String(job.address_line_2 || ""),
      suburb: String(job.suburb || ""),
      state: String(job.address_state || ""),
      postcode: String(job.postcode || ""),
    },
  };
}

function itemPayload(item: Row, includeInternal: boolean) {
  const payload: Row = {
    id: String(item.id), position: Number(item.position), lineType: String(item.line_type), description: String(item.description),
    quantityMilli: Number(item.quantity_milli), unitPriceCents: Number(item.unit_price_cents), taxCode: String(item.tax_code),
    subtotalCents: Number(item.subtotal_cents), taxCents: Number(item.tax_cents), totalCents: Number(item.total_cents),
    priceBookItemId: String(item.price_book_item_id || ""), priceBookItemType: String(item.price_book_item_type || ""),
    jobPacketId: String(item.job_packet_id || ""), jobPacketRevision: Number(item.job_packet_revision || 0), jobPacketLineId: String(item.job_packet_line_id || ""),
    sectionHeading: String(item.section_heading || "Included work"), quoteChoiceId: String(item.quote_choice_id || ""),
  };
  if (includeInternal) {
    payload.unitCostCentsExGst = Number(item.unit_cost_cents_ex_gst || 0);
    payload.marginBasisPoints = Number(item.margin_basis_points || 0);
  }
  return payload;
}

async function quotePayload(ownerUid: string, workOrderId: string, includeInternal = true, origin = "") {
  const db = getD1();
  const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, ownerUid).first<Row>();
  if (!quote) return null;
  const versions = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? ORDER BY version_number DESC`).bind(quote.id, ownerUid).all<Row>();
  const versionIds = versions.results.map((row) => String(row.id));
  const placeholders = versionIds.map(() => "?").join(",");
  const items = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE firebase_uid = ? AND quote_version_id IN (${placeholders}) ORDER BY quote_version_id, position`).bind(ownerUid, ...versionIds).all<Row>() : { results: [] as Row[] };
  const choices = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_choices WHERE firebase_uid = ? AND quote_version_id IN (${placeholders}) ORDER BY quote_version_id, position`).bind(ownerUid, ...versionIds).all<Row>() : { results: [] as Row[] };
  const acceptances = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_acceptances WHERE firebase_uid = ? AND quote_version_id IN (${placeholders})`).bind(ownerUid, ...versionIds).all<Row>() : { results: [] as Row[] };
  const currentVersion = versions.results.find((row) => Number(row.version_number) === Number(quote.current_version_number));
  const editableDraft = versions.results.find((row) => row.status === "draft");
  let link = currentVersion ? await db.prepare("SELECT * FROM trade_crm_quote_links WHERE quote_version_id = ? AND firebase_uid = ?").bind(currentVersion.id, ownerUid).first<Row>() : null;
  if (link && link.status === "active" && String(link.expires_at) <= new Date().toISOString()) {
    const expiredAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE trade_crm_quote_links SET status = 'expired', token_hash = '', encrypted_token = '', updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'active'")
        .bind(expiredAt, link.id, ownerUid),
      db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, 'expired', 'system', 'Secure quote link expired.', ?, ?)`)
        .bind(crypto.randomUUID(), link.id, link.quote_id, link.quote_version_id, link.work_order_id, ownerUid, `expired:${link.id}:${link.token_issue}`, expiredAt),
    ]);
    link = { ...link, status: "expired", token_hash: "", encrypted_token: "", updated_at: expiredAt };
  }
  const [events, questions, deliveries] = currentVersion ? await Promise.all([
    db.prepare("SELECT event_type, actor_type, summary, occurred_at FROM trade_crm_quote_events WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY occurred_at DESC LIMIT 100").bind(currentVersion.id, ownerUid).all<Row>(),
    db.prepare("SELECT id, question, answer, status, asked_at, answered_at FROM trade_crm_quote_questions WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY asked_at").bind(currentVersion.id, ownerUid).all<Row>(),
    db.prepare("SELECT id, channel, provider, status, recipient_preview, attempts, provider_status, last_error, sent_at, delivered_at, next_attempt_at, failure_code, retry_of_delivery_id, delivery_generation, updated_at, created_at FROM trade_crm_quote_deliveries WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY delivery_generation DESC, created_at DESC, id DESC").bind(currentVersion.id, ownerUid).all<Row>(),
  ]) : [{ results: [] as Row[] }, { results: [] as Row[] }, { results: [] as Row[] }];
  let shareUrl = ""; let pdfUrl = "";
  if (link && link.status === "active" && link.token_hash && origin) {
    try {
      const secret = await recoverQuoteLinkSecret(String(link.encrypted_token), String(link.id), Number(link.token_issue), String(link.token_hash));
      const token = encodeURIComponent(`${String(link.id)}.${secret}`);
      shareUrl = `${origin}${quoteReviewPath(String(link.id), secret)}`;
      pdfUrl = `${origin}/api/quote-review/${token}/pdf`;
    } catch { shareUrl = ""; pdfUrl = ""; }
  }
  return {
    id: String(quote.id), workOrderId: String(quote.work_order_id), customerId: String(quote.crm_customer_id), serviceSiteId: String(quote.service_site_id),
    quoteNumber: String(quote.quote_number), currentVersionNumber: Number(quote.current_version_number), status: String(quote.status),
    editableDraft: editableDraft ? {
      id: String(editableDraft.id),
      versionNumber: Number(editableDraft.version_number),
      updatedAt: String(editableDraft.updated_at),
    } : null,
    link: link ? { id: String(link.id), status: String(link.status), expiresAt: String(link.expires_at), tokenIssue: Number(link.token_issue), shareUrl, pdfUrl,
      recipientPreview: maskPhotoRequestEmail(String(currentVersion?.acceptance_email || "")) } : null,
    timeline: events.results.map((event) => ({ type: String(event.event_type), actorType: String(event.actor_type), summary: String(event.summary), occurredAt: String(event.occurred_at) })),
    questions: questions.results.map((question) => ({ id: String(question.id), question: String(question.question), answer: String(question.answer || ""), status: String(question.status), askedAt: String(question.asked_at), answeredAt: String(question.answered_at || "") })),
    deliveries: deliveries.results.map((delivery) => ({ id: String(delivery.id), channel: String(delivery.channel), provider: String(delivery.provider), status: String(delivery.status), recipientPreview: String(delivery.recipient_preview), attempts: Number(delivery.attempts), generation: Number(delivery.delivery_generation || 1), retryOfDeliveryId: String(delivery.retry_of_delivery_id || ""), providerStatus: String(delivery.provider_status || ""), lastError: String(delivery.last_error || ""), sentAt: String(delivery.sent_at || ""), deliveredAt: String(delivery.delivered_at || ""), nextAttemptAt: String(delivery.next_attempt_at || ""), updatedAt: String(delivery.updated_at || ""), createdAt: String(delivery.created_at), presentation: tradeQuoteDeliveryPresentation(String(delivery.status), Number(delivery.attempts), String(delivery.next_attempt_at || ""), String(delivery.failure_code || ""), Number(delivery.delivery_generation || 1)) })),
    versions: versions.results.map((version) => {
      const versionItems = items.results.filter((item) => item.quote_version_id === version.id);
      const versionChoices = choices.results.filter((choice) => choice.quote_version_id === version.id);
      const acceptance = acceptances.results.find((item) => item.quote_version_id === version.id);
      const internalCostCents = versionItems.reduce((sum, item) => sum + Math.round(Number(item.quantity_milli) * Number(item.unit_cost_cents_ex_gst || 0) / 1000), 0);
      return {
        id: String(version.id), versionNumber: Number(version.version_number), status: String(version.status), customerEmail: String(version.acceptance_email || ""),
        subtotalCents: Number(version.subtotal_cents), taxCents: Number(version.tax_cents), totalCents: Number(version.total_cents), terms: String(version.terms || ""), customerMessage: String(version.customer_message || ""),
        validUntil: String(version.valid_until || ""), consentStatement: String(version.consent_statement || ""), issuedAt: String(version.issued_at || ""),
        createdAt: String(version.created_at), updatedAt: String(version.updated_at),
        items: versionItems.filter((item) => !item.quote_choice_id).map((item) => itemPayload(item, includeInternal)),
        choices: versionChoices.map((choice) => ({ id: String(choice.id), clientKey: String(choice.choice_key), kind: String(choice.choice_kind),
          groupKey: String(choice.group_key), name: String(choice.name), summary: String(choice.summary || ""), recommended: Boolean(choice.recommended),
          subtotalCents: Number(choice.subtotal_cents), taxCents: Number(choice.tax_cents), totalCents: Number(choice.total_cents),
          items: versionItems.filter((item) => item.quote_choice_id === choice.id).map((item) => itemPayload(item, includeInternal)) })),
        ...(includeInternal ? { internalSummary: { costCentsExGst: internalCostCents,
          sellCentsExGst: versionItems.reduce((sum, item) => sum + Number(item.subtotal_cents), 0),
          marginCentsExGst: versionItems.reduce((sum, item) => sum + Number(item.subtotal_cents), 0) - internalCostCents } } : {}),
        acceptance: acceptance ? { decision: String(acceptance.decision), actorEmail: String(acceptance.actor_email), decidedAt: String(acceptance.decided_at),
          actorType: String(acceptance.actor_type || "verified_account"), signerName: String(acceptance.signer_name || ""), consentStatement: String(acceptance.consent_statement),
          selectionSummary: String(acceptance.selection_summary || ""), selectedTotalCents: Number(acceptance.selected_total_cents || 0) } : null,
      };
    }),
  };
}

async function resolveLineGroup(ownerUid: string, rawLines: unknown, allowEmpty = false) {
  const packet = await resolveJobPacketQuoteLines(ownerUid, rawLines);
  const priceBook = await resolvePriceBookQuoteLines(ownerUid, packet.lines);
  const calculated = normaliseTradeQuoteLineGroup(priceBook.lines, (value) => cleanAdminText(value, 500), allowEmpty);
  const raw = Array.isArray(priceBook.lines) ? priceBook.lines as Row[] : [];
  return { calculated, priceReferences: priceBook.references, packetReferences: packet.references,
    sectionHeadings: raw.map((line) => cleanAdminText(line.sectionHeading, 120) || "Included work") };
}

function choiceDefaultTotal(base: ResolvedGroup, choices: Array<{ input: ReturnType<typeof normaliseQuoteChoices>[number]; resolved: ResolvedGroup }>) {
  const selected = new Map<string, typeof choices[number]>();
  for (const choice of choices.filter((item) => item.input.kind !== "addon")) {
    const key = `${choice.input.kind}:${choice.input.groupKey}`;
    const current = selected.get(key);
    if (!current || choice.input.recommended) selected.set(key, choice);
  }
  return base.calculated.totalCents + [...selected.values()].reduce((sum, item) => sum + item.resolved.calculated.totalCents, 0);
}

function appendItems(db: D1Database, statements: D1PreparedStatement[], ownerUid: string,
  versionId: string, choiceId: string, resolved: ResolvedGroup, startPosition: number, now: string) {
  resolved.calculated.lines.forEach((line, index) => {
    const price = resolved.priceReferences[index]; const packet = resolved.packetReferences[index];
    statements.push(db.prepare(`INSERT INTO trade_crm_quote_items
      (id, quote_version_id, firebase_uid, position, line_type, description, quantity_milli, unit_price_cents, tax_code,
       subtotal_cents, tax_cents, total_cents, price_book_item_id, price_book_item_type, unit_cost_cents_ex_gst,
       markup_basis_points, margin_basis_points, job_packet_id, job_packet_revision, job_packet_line_id, section_heading, quote_choice_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM trade_crm_quote_versions version
        WHERE version.id = ? AND version.firebase_uid = ? AND version.status = 'draft' AND version.updated_at = ?)`)
      .bind(crypto.randomUUID(), versionId, ownerUid, startPosition + index, line.lineType, line.description, line.quantityMilli,
        line.unitPriceCents, line.taxCode, line.subtotalCents, line.taxCents, line.totalCents, price?.id || "", price?.itemType || "",
        price?.unitCostCentsExGst || 0, price?.markupBasisPoints || 0, price?.marginBasisPoints || 0, packet?.packetId || "",
        packet?.packetRevision || 0, packet?.packetLineId || "", resolved.sectionHeadings[index], choiceId, now,
        versionId, ownerUid, now));
  });
  return startPosition + resolved.calculated.lines.length;
}

function quoteAccessPayload(access: TeamAccess) {
  return {
    canManageQuotes: access.isOwner || access.canManageQuotes,
    canSendQuotes: access.isOwner || access.canSendQuotes,
    canManageCustomers: access.isOwner || access.canManageCustomers,
    canViewPriceBook: access.isOwner || access.canViewPriceBook,
    canViewInternal: access.isOwner || access.canViewPriceBook,
    canApplyDiscounts: access.isOwner || access.canApplyDiscounts,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await installerAccess(request, "view"); const url = new URL(request.url); const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180);
    await assignedJob(access, workOrderId);
    const job = await directJob(access.ownerUid, workOrderId); const emails = await authorisedEmails(access.ownerUid, String(job.crm_customer_id), acceptedPublicEmail(job));
    const business = await getD1().prepare(`SELECT business_name, brand_theme_key, brand_border_style, logo_object_key, banner_object_key,
        quote_email_subject_template, quote_email_intro, quote_default_terms
      FROM trade_accounts WHERE firebase_uid = ? AND partner_type = 'installer' LIMIT 1`).bind(access.ownerUid).first<Row>();
    const serviceCategories = parseJsonList(job.service_categories);
    const canViewInternal = access.isOwner || access.canViewPriceBook;
    return adminJson({ ok: true, access: quoteAccessPayload(access), job: {
      customerId: String(job.crm_customer_id), workNumber: job.work_number, title: job.title,
      customerNumber: job.customer_number,
      customerName: job.business_name || [job.first_name, job.last_name].filter(Boolean).join(" ") || (job.public_lead_enquiry ? "Customer" : job.customer_number),
      siteLabel: job.site_label,
      siteSummary: [job.address_line_1, job.address_line_2, job.suburb, job.address_state, job.postcode].filter(Boolean).join(", "),
      publicLead: Boolean(job.public_lead_enquiry),
      enquiryReference: job.public_lead_enquiry ? String(job.customer_reference || "") : "",
      enquiryServices: job.public_lead_enquiry ? serviceCategories.map((category) => ENERGY_SERVICE_LABELS[category] || category.replaceAll("-", " ")) : [],
      enquiryBrief: job.public_lead_enquiry ? String(job.description || "") : "" },
      business: { businessName: String(business?.business_name || ""), brandThemeKey: String(business?.brand_theme_key || "emerald_navy"),
        brandBorderStyle: String(business?.brand_border_style || "soft"), hasLogo: Boolean(business?.logo_object_key), hasBanner: Boolean(business?.banner_object_key),
        quoteEmailSubjectTemplate: String(business?.quote_email_subject_template || "{business_name} sent quote {quote_number}"),
        quoteEmailIntro: String(business?.quote_email_intro || "Thank you for the opportunity to quote for your project. Review the scope, choices and total below."),
        quoteDefaultTerms: String(business?.quote_default_terms || "") },
      authorisedEmails: emails,
      priceBookItems: canViewInternal ? await priceBookItemsForQuote(access.ownerUid) : [],
      jobPackets: canViewInternal ? await jobPacketsForQuote(access.ownerUid) : [],
      quote: await quotePayload(access.ownerUid, workOrderId, canViewInternal, new URL(request.url).origin) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const body = await request.json() as Row;
    const action = cleanAdminText(body.action, 40); const workOrderId = cleanAdminText(body.workOrderId, 180);
    if (["issue_quote", "send_quote", "retry_quote_delivery"].includes(action)) {
      assertTradeQuoteIssueDeliveryAccess(
        canManageQuotes(access),
        canSendQuotes(access),
        body.consentConfirmed,
      );
    } else if (!canManageQuotes(access)) throw new Error("QUOTE_MANAGEMENT_REQUIRED");
    await assignedJob(access, workOrderId);
    const db = getD1(); const now = new Date().toISOString();
    if (action === "revoke_link") {
      await revokeOwnedQuoteLink(access.ownerUid, workOrderId, now);
      return adminJson({ ok: true, revoked: true });
    }
    const job = await directJob(access.ownerUid, workOrderId);
    if (action === "add_quote_recipient") {
      if (!access.isOwner && !access.canManageCustomers) throw new Error("CUSTOMER_MANAGEMENT_REQUIRED");
      if (job.public_lead_enquiry) {
        return adminJson({ ok: false, error: "Use the email currently released by this customer for this lead." }, 409);
      }
      const firstName = cleanAdminText(body.firstName, 80); const lastName = cleanAdminText(body.lastName, 80);
      const email = cleanAdminText(body.email, 180).toLowerCase();
      if (!firstName && !lastName) return adminJson({ ok: false, error: "Add the quote recipient's name." }, 400);
      if (!EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the quote recipient's email address." }, 400);
      const existing = await db.prepare(`SELECT id FROM trade_crm_customer_contacts
        WHERE firebase_uid = ? AND customer_id = ? AND LOWER(email) = ? AND record_status = 'active' LIMIT 1`)
        .bind(access.ownerUid, job.crm_customer_id, email).first<Row>();
      const primaryEmailMatch = String(job.customer_email || "").trim().toLowerCase() === email;
      if (!existing && !primaryEmailMatch) {
        await db.prepare(`INSERT INTO trade_crm_customer_contacts
          (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'Quote recipient', ?, '', 0, 'active', ?, ?)`)
          .bind(crypto.randomUUID(), access.ownerUid, job.crm_customer_id, firstName, lastName, email, now, now).run();
      }
      return adminJson({ ok: true, authorisedEmails: await authorisedEmails(access.ownerUid, String(job.crm_customer_id), acceptedPublicEmail(job)) }, existing || primaryEmailMatch ? 200 : 201);
    }
    if (action === "save_draft") {
      const choiceInputs = normaliseQuoteChoices(body.choices, (value, maximum = 500) => cleanAdminText(value, maximum));
      const base = await resolveLineGroup(access.ownerUid, body.lines, choiceInputs.length > 0);
      const choices = await Promise.all(choiceInputs.map(async (input) => ({ input, resolved: await resolveLineGroup(access.ownerUid, input.lines) })));
      if (!base.calculated.lines.length && !choices.length) throw new Error("INVALID_LINES");
      const groups = [base, ...choices.map((choice) => choice.resolved)];
      const usesSavedLibrary = groups.some((group) => group.priceReferences.some(Boolean) || group.packetReferences.some(Boolean));
      if (usesSavedLibrary && !access.canViewPriceBook) throw new Error("PRICE_BOOK_VIEW_REQUIRED");
      const proposedDisplayTotal = choiceDefaultTotal(base, choices);
      const proposedDiscountMagnitude = quoteInputDiscountMagnitude(groups);
      const quote = await db.prepare(`SELECT quote.*, details.quoted_value_cents current_display_total,
          (SELECT version.total_cents FROM trade_crm_quote_versions version
            WHERE version.quote_id = quote.id AND version.firebase_uid = quote.firebase_uid
              AND version.version_number = quote.current_version_number) current_base_total
        FROM trade_crm_quotes quote
        LEFT JOIN trade_crm_job_details details ON details.work_order_id = quote.work_order_id
          AND details.firebase_uid = quote.firebase_uid
        WHERE quote.work_order_id = ? AND quote.firebase_uid = ?`)
        .bind(workOrderId, access.ownerUid).first<Row>();
      if (!access.canApplyDiscounts) {
        if (!quote && quoteInputAppliesDiscount(groups)) throw new Error("DISCOUNT_REQUIRED");
        if (quote) {
          const [currentReduction, currentChoices] = await Promise.all([db.prepare(`SELECT COALESCE(SUM(CASE
              WHEN item.subtotal_cents < 0 THEN -item.subtotal_cents
              WHEN item.price_book_item_type IN ('discount', 'rebate') THEN ABS(item.subtotal_cents)
              ELSE 0 END), 0) reduction_cents
            FROM trade_crm_quote_items item JOIN trade_crm_quote_versions version
              ON version.id = item.quote_version_id AND version.firebase_uid = item.firebase_uid
            WHERE version.quote_id = ? AND version.firebase_uid = ? AND version.version_number = ?`)
            .bind(quote.id, access.ownerUid, quote.current_version_number).first<Row>(),
          db.prepare(`SELECT choice.choice_key, choice.total_cents FROM trade_crm_quote_choices choice
            JOIN trade_crm_quote_versions version ON version.id = choice.quote_version_id
              AND version.firebase_uid = choice.firebase_uid
            WHERE version.quote_id = ? AND version.firebase_uid = ? AND version.version_number = ?`)
            .bind(quote.id, access.ownerUid, quote.current_version_number).all<Row>()]);
          const currentChoiceTotals = new Map(currentChoices.results.map((choice) => [String(choice.choice_key), Number(choice.total_cents)]));
          const loweredChoice = choices.some((choice) => {
            const currentTotal = currentChoiceTotals.get(choice.input.clientKey);
            return currentTotal !== undefined && choice.resolved.calculated.totalCents < currentTotal;
          });
          const currentSortedChoiceTotals = currentChoices.results.map((choice) => Number(choice.total_cents)).sort((a, b) => a - b);
          const proposedSortedChoiceTotals = choices.map((choice) => choice.resolved.calculated.totalCents).sort((a, b) => a - b);
          const replacedWithCheaperChoice = proposedSortedChoiceTotals.length < currentSortedChoiceTotals.length
            || currentSortedChoiceTotals.some((currentTotal, index) => proposedSortedChoiceTotals[index] < currentTotal);
          if (proposedDiscountMagnitude > Number(currentReduction?.reduction_cents || 0)
            || lowersAuthoritativeTotal(base.calculated.totalCents, quote.current_base_total)
            || lowersAuthoritativeTotal(proposedDisplayTotal, quote.current_display_total)
            || loweredChoice || replacedWithCheaperChoice) {
            throw new Error("DISCOUNT_REQUIRED");
          }
        }
      }
      const customerEmail = cleanAdminText(body.customerEmail, 180).toLowerCase(); const emails = await authorisedEmails(access.ownerUid, String(job.crm_customer_id), acceptedPublicEmail(job));
      if (customerEmail && !emails.includes(customerEmail)) return adminJson({ ok: false, error: "Choose an email from this customer's authorised contacts." }, 400);
      const storedCustomerEmail = job.public_lead_enquiry ? "" : customerEmail;
      const validUntil = cleanAdminText(body.validUntil, 10); if (validUntil && !DATE_PATTERN.test(validUntil)) return adminJson({ ok: false, error: "Choose a valid quote expiry date." }, 400);
      const terms = cleanAdminText(body.terms, 4000); const customerMessage = cleanAdminText(body.customerMessage, 1200);
      const quoteId = String(quote?.id || crypto.randomUUID()); let versionNumber = Number(quote?.current_version_number || 1); let versionId = ""; const statements: D1PreparedStatement[] = [];
      let draftClaimIndex = -1;
      if (!quote) {
        const quoteNumber = `Q-${String(job.work_number).replace(/^JOB-/, "")}`;
        statements.push(db.prepare(`INSERT INTO trade_crm_quotes (id, work_order_id, firebase_uid, crm_customer_id, service_site_id, quote_number, current_version_number, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?)`).bind(quoteId, workOrderId, access.ownerUid, job.crm_customer_id, job.service_site_id, quoteNumber, now, now));
        versionId = crypto.randomUUID();
        statements.push(db.prepare(`INSERT INTO trade_crm_quote_versions (id, quote_id, firebase_uid, version_number, status, acceptance_email, subtotal_cents, tax_cents, total_cents, terms, customer_message, valid_until, consent_statement, issued_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`).bind(versionId, quoteId, access.ownerUid, storedCustomerEmail, base.calculated.subtotalCents, base.calculated.taxCents, base.calculated.totalCents, terms, customerMessage, validUntil, now, now));
      } else {
        const current = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? AND version_number = ?`).bind(quoteId, access.ownerUid, versionNumber).first<Row>();
        if (!current) throw new Error("QUOTE_NOT_FOUND");
        if (current.status === "issuing") throw new Error("QUOTE_ISSUE_IN_PROGRESS");
        const pendingDraft = current.status === "issued"
          ? await db.prepare(`SELECT * FROM trade_crm_quote_versions
              WHERE quote_id = ? AND firebase_uid = ? AND status IN ('draft','issuing')
                AND version_number > ?
              ORDER BY version_number DESC LIMIT 1`)
              .bind(quoteId, access.ownerUid, current.version_number).first<Row>()
          : null;
        if (pendingDraft?.status === "issuing") throw new Error("QUOTE_ISSUE_IN_PROGRESS");
        const editableVersion = current.status === "draft" ? current : pendingDraft;
        if (editableVersion) {
          versionId = String(editableVersion.id);
          versionNumber = Number(editableVersion.version_number);
          draftClaimIndex = statements.length;
          statements.push(db.prepare(`UPDATE trade_crm_quote_versions SET acceptance_email = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, terms = ?, customer_message = ?, valid_until = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND status = 'draft' AND updated_at = ?
              AND EXISTS (
                SELECT 1 FROM trade_crm_quote_versions authoritative
                JOIN trade_crm_quotes parent ON parent.id = authoritative.quote_id
                  AND parent.firebase_uid = authoritative.firebase_uid
                WHERE authoritative.quote_id = trade_crm_quote_versions.quote_id
                  AND authoritative.firebase_uid = trade_crm_quote_versions.firebase_uid
                  AND authoritative.version_number = parent.current_version_number
                  AND authoritative.status <> 'issuing'
              )`)
            .bind(storedCustomerEmail, base.calculated.subtotalCents, base.calculated.taxCents, base.calculated.totalCents,
              terms, customerMessage, validUntil, now, versionId, access.ownerUid, editableVersion.updated_at));
          statements.push(db.prepare(`DELETE FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ?
            AND EXISTS (SELECT 1 FROM trade_crm_quote_versions version WHERE version.id = trade_crm_quote_items.quote_version_id
              AND version.firebase_uid = trade_crm_quote_items.firebase_uid AND version.status = 'draft' AND version.updated_at = ?)`)
            .bind(versionId, access.ownerUid, now));
          statements.push(db.prepare(`DELETE FROM trade_crm_quote_choices WHERE quote_version_id = ? AND firebase_uid = ?
            AND EXISTS (SELECT 1 FROM trade_crm_quote_versions version WHERE version.id = trade_crm_quote_choices.quote_version_id
              AND version.firebase_uid = trade_crm_quote_choices.firebase_uid AND version.status = 'draft' AND version.updated_at = ?)`)
            .bind(versionId, access.ownerUid, now));
        } else {
          const unsettledDelivery = await db.prepare(`SELECT 1 pending
            FROM trade_crm_quote_deliveries
            WHERE quote_version_id = ? AND firebase_uid = ? AND channel = 'email'
              AND (
                status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
                OR (status = 'failed' AND next_attempt_at <> '')
              )
            LIMIT 1`)
            .bind(current.id, access.ownerUid).first<Row>();
          if (current.status === "issued" && unsettledDelivery) throw new Error("QUOTE_DELIVERY_PENDING");
          versionNumber = Number(current.version_number) + 1; versionId = crypto.randomUUID();
          draftClaimIndex = statements.length;
          statements.push(db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_versions
            (id, quote_id, firebase_uid, version_number, status, acceptance_email,
             subtotal_cents, tax_cents, total_cents, terms, customer_message,
             valid_until, consent_statement, issued_at, created_at, updated_at)
            SELECT ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?
            WHERE EXISTS (
              SELECT 1 FROM trade_crm_quotes parent
              JOIN trade_crm_quote_versions authoritative
                ON authoritative.quote_id = parent.id
                AND authoritative.firebase_uid = parent.firebase_uid
                AND authoritative.version_number = parent.current_version_number
              WHERE parent.id = ? AND parent.firebase_uid = ?
                AND authoritative.id = ? AND authoritative.status = ?
                AND authoritative.updated_at = ?
                AND NOT EXISTS (
                  SELECT 1 FROM trade_crm_quote_deliveries pending_delivery
                  WHERE pending_delivery.quote_version_id = authoritative.id
                    AND pending_delivery.firebase_uid = authoritative.firebase_uid
                    AND pending_delivery.channel = 'email'
                    AND (
                      pending_delivery.status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
                      OR (pending_delivery.status = 'failed' AND pending_delivery.next_attempt_at <> '')
                    )
                )
            )`).bind(versionId, quoteId, access.ownerUid, versionNumber,
              storedCustomerEmail, base.calculated.subtotalCents,
              base.calculated.taxCents, base.calculated.totalCents, terms,
              customerMessage, validUntil, now, now, quoteId, access.ownerUid,
              current.id, current.status, current.updated_at));
          if (current.status !== "issued") statements.push(db.prepare(`UPDATE trade_crm_quotes SET current_version_number = ?, status = 'draft', crm_customer_id = ?, service_site_id = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(versionNumber, job.crm_customer_id, job.service_site_id, now, quoteId, access.ownerUid));
        }
      }
      let position = appendItems(db, statements, access.ownerUid, versionId, "", base, 1, now);
      choices.forEach(({ input, resolved }, index) => {
        const choiceId = crypto.randomUUID();
        statements.push(db.prepare(`INSERT INTO trade_crm_quote_choices (id, quote_version_id, firebase_uid, position, choice_key, choice_kind, group_key, name, summary, recommended, subtotal_cents, tax_cents, total_cents, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM trade_crm_quote_versions version
            WHERE version.id = ? AND version.firebase_uid = ? AND version.status = 'draft' AND version.updated_at = ?)`)
          .bind(choiceId, versionId, access.ownerUid, index + 1, input.clientKey, input.kind, input.groupKey, input.name,
            input.summary, input.recommended ? 1 : 0, resolved.calculated.subtotalCents, resolved.calculated.taxCents,
            resolved.calculated.totalCents, now, versionId, access.ownerUid, now));
        position = appendItems(db, statements, access.ownerUid, versionId, choiceId, resolved, position, now);
      });
      statements.push(draftClaimIndex >= 0
        ? db.prepare(`UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = 'draft', updated_at = ?
            WHERE work_order_id = ? AND firebase_uid = ? AND EXISTS (SELECT 1 FROM trade_crm_quote_versions version
              WHERE version.id = ? AND version.firebase_uid = ? AND version.status = 'draft' AND version.updated_at = ?)`)
          .bind(proposedDisplayTotal, now, workOrderId, access.ownerUid, versionId, access.ownerUid, now)
        : db.prepare(`UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = 'draft', updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
          .bind(proposedDisplayTotal, now, workOrderId, access.ownerUid));
      if (body.saveAsBusinessDefault === true) statements.push(draftClaimIndex >= 0
        ? db.prepare(`UPDATE trade_accounts SET quote_email_intro = ?, quote_default_terms = ?, settings_updated_at = ?, updated_at = ?
            WHERE firebase_uid = ? AND partner_type = 'installer' AND EXISTS (SELECT 1 FROM trade_crm_quote_versions version
              WHERE version.id = ? AND version.firebase_uid = ? AND version.status = 'draft' AND version.updated_at = ?)`)
          .bind(customerMessage, terms, now, now, access.ownerUid, versionId, access.ownerUid, now)
        : db.prepare(`UPDATE trade_accounts SET quote_email_intro = ?, quote_default_terms = ?, settings_updated_at = ?, updated_at = ? WHERE firebase_uid = ? AND partner_type = 'installer'`)
          .bind(customerMessage, terms, now, now, access.ownerUid));
      const writeResults = await db.batch(statements);
      if (draftClaimIndex >= 0 && !writeResults[draftClaimIndex]?.meta.changes) {
        const racedVersion = versionId
          ? await db.prepare(`SELECT status FROM trade_crm_quote_versions
              WHERE id = ? AND quote_id = ? AND firebase_uid = ? LIMIT 1`)
              .bind(versionId, quoteId, access.ownerUid).first<Row>()
          : null;
        if (racedVersion?.status === "issuing") throw new Error("QUOTE_ISSUE_IN_PROGRESS");
        const racedDelivery = await db.prepare(`SELECT 1 pending
          FROM trade_crm_quote_deliveries delivery
          JOIN trade_crm_quote_links link
            ON link.id = delivery.quote_link_id
            AND link.firebase_uid = delivery.firebase_uid
          WHERE link.quote_id = ? AND delivery.firebase_uid = ?
            AND (
              delivery.status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
              OR (delivery.status = 'failed' AND delivery.next_attempt_at <> '')
            ) LIMIT 1`)
          .bind(quoteId, access.ownerUid).first<Row>();
        if (racedDelivery) throw new Error("QUOTE_DELIVERY_PENDING");
        throw new Error("IMMUTABLE_VERSION");
      }
      return adminJson({
        ok: true,
        draftVersionId: versionId,
        draftVersionNumber: versionNumber,
        access: quoteAccessPayload(access),
        quote: await quotePayload(access.ownerUid, workOrderId,
          access.isOwner || access.canViewPriceBook, new URL(request.url).origin),
      });
    }
    if (action === "issue_quote") {
      const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, access.ownerUid).first<Row>();
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      const requestedVersionId = cleanAdminText(body.quoteVersionId, 180);
      if (!requestedVersionId) {
        return adminJson({ ok: false, error: "Save this exact quote version before issuing it." }, 400);
      }
      const requestedVersion = await db.prepare(`SELECT version.*,
          (SELECT MAX(candidate.version_number) FROM trade_crm_quote_versions candidate
            WHERE candidate.quote_id = version.quote_id
              AND candidate.firebase_uid = version.firebase_uid) latest_version_number
        FROM trade_crm_quote_versions version
        WHERE version.id = ? AND version.quote_id = ? AND version.firebase_uid = ? LIMIT 1`)
        .bind(requestedVersionId, quote.id, access.ownerUid).first<Row>();
      if (!requestedVersion) throw new Error("QUOTE_NOT_FOUND");
      if (requestedVersion.status === "issued") {
        const delivery = await latestTradeQuoteDeliveryStatus(
          db,
          requestedVersionId,
          access.ownerUid,
        );
        if (!delivery) {
          throw stagedQuoteError(
            "QUOTE_ISSUE_DELIVERY_MISSING",
            "issue_replay_delivery_status",
          );
        }
        const accepted = ["provider_accepted", "sent", "delivered"].includes(delivery.status);
        return adminJson({
          ok: true,
          quoteIssued: true,
          deliveryAccepted: accepted,
          deliveryState: delivery.status,
          delivery,
          access: quoteAccessPayload(access),
          quote: await quotePayload(access.ownerUid, workOrderId,
            access.isOwner || access.canViewPriceBook, new URL(request.url).origin),
        }, accepted ? 200 : 202);
      }
      if (requestedVersion.status !== "draft" && requestedVersion.status !== "issuing") {
        throw new Error("IMMUTABLE_VERSION");
      }
      if (Number(requestedVersion.version_number) !== Number(requestedVersion.latest_version_number)) {
        throw new Error("IMMUTABLE_VERSION");
      }
      const staleIssueBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      await db.prepare(`UPDATE trade_crm_quote_versions
        SET status = 'draft', updated_at = ?
        WHERE id = ? AND quote_id = ? AND firebase_uid = ?
          AND status = 'issuing' AND updated_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM trade_crm_quote_links link
            WHERE link.quote_version_id = trade_crm_quote_versions.id
              AND link.firebase_uid = trade_crm_quote_versions.firebase_uid
          )`)
        .bind(now, requestedVersionId, quote.id, access.ownerUid,
          staleIssueBefore)
        .run();
      const version = await db.prepare(`SELECT * FROM trade_crm_quote_versions
        WHERE id = ? AND quote_id = ? AND firebase_uid = ? AND status = 'draft'`)
        .bind(requestedVersionId, quote.id, access.ownerUid).first<Row>();
      if (!version) throw new Error("IMMUTABLE_VERSION");
      const customerEmail = job.public_lead_enquiry
        ? acceptedPublicEmail(job).trim().toLowerCase()
        : String(version.acceptance_email || "").trim().toLowerCase();
      const emails = await authorisedEmails(access.ownerUid, String(job.crm_customer_id), acceptedPublicEmail(job));
      if (!customerEmail || !emails.includes(customerEmail)) return adminJson({ ok: false, error: "Choose an authorised customer email before issuing this quote." }, 400);
      const priorOptOut = await db.prepare(`SELECT 1 stopped
        FROM trade_crm_quote_deliveries
        WHERE firebase_uid = ? AND crm_customer_id = ? AND channel = 'email'
          AND status IN ('complained', 'opted_out') LIMIT 1`)
        .bind(access.ownerUid, job.crm_customer_id).first<Row>();
      if (priorOptOut) return adminJson({ ok: false, error: "This customer has opted out of quote email delivery." }, 409);
      if (!String(version.terms || "").trim()) return adminJson({ ok: false, error: "Record the quote scope, exclusions and completion terms before issuing." }, 400);
      if (version.valid_until && String(version.valid_until) < now.slice(0, 10)) return adminJson({ ok: false, error: "The quote expiry date must not be in the past." }, 400);
      const itemCount = await db.prepare(`SELECT COUNT(*) count FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ?`).bind(version.id, access.ownerUid).first<Row>();
      if (!Number(itemCount?.count)) return adminJson({ ok: false, error: "Add at least one quote line before issuing." }, 400);
      const issueTimestamp = String(version.issued_at || "").trim() || now;
      const consentStatement = `I accept quote ${quote.quote_number} version ${version.version_number}, including my recorded choices and final server-calculated total, subject to its recorded terms.`;
      const issueClaimToken = `issuing:${crypto.randomUUID()}`;
      const issueClaim = await db.prepare(`UPDATE trade_crm_quote_versions
        SET status = 'issuing', consent_statement = ?,
          issued_at = CASE WHEN issued_at = '' THEN ? ELSE issued_at END,
          updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'draft'
          AND updated_at = ?`)
        .bind(issueClaimToken, issueTimestamp, now, version.id, access.ownerUid,
          version.updated_at)
        .run();
      if (Number(issueClaim.meta.changes || 0) !== 1) {
        throw new Error("QUOTE_ISSUE_IN_PROGRESS");
      }
      const origin = new URL(request.url).origin;
      let issuedPdf: Awaited<ReturnType<typeof storeTradeQuoteIssuedPdf>> | null = null;
      try {
        const execution = await buildQuoteExecutionSnapshot(access.ownerUid, String(version.id));
        const documentSnapshot = await buildTradeQuoteDocumentSnapshot(
          access.ownerUid,
          String(version.id),
          {
            capturedAt: issueTimestamp,
            consentStatement,
            issuedAt: issueTimestamp,
            acceptanceEmail: customerEmail,
            ...acceptedQuoteSnapshotOverrides(job),
          },
        );
        const documentSnapshotJson = JSON.stringify(documentSnapshot);
        if (new TextEncoder().encode(documentSnapshotJson).byteLength > 1_000_000) {
          throw new Error("QUOTE_DOCUMENT_TOO_LARGE");
        }
        await currentPublicLeadJob(access.ownerUid, workOrderId, job);
        const issuedPdfBytes = await renderQuotePdfOrThrow(documentSnapshot, origin, "issue_pdf_preflight");
        try {
          issuedPdf = await prepareTradeQuoteIssuedPdfReference({
            quoteVersionId: String(version.id),
            versionNumber: Number(version.version_number),
            bytes: issuedPdfBytes,
          });
        } catch {
          const error = new Error("QUOTE_PDF_UNAVAILABLE") as StagedQuoteError;
          error.stage = "issue_pdf_store";
          throw error;
        }
        const linkId = crypto.randomUUID(); const secret = newQuoteLinkSecret(); const tokenIssue = 1;
        const validExpiry = version.valid_until ? new Date(`${version.valid_until}T23:59:59.999Z`) : new Date(Date.now() + 30 * 86400000);
        const expiresAt = new Date(Math.min(validExpiry.getTime(), Date.now() + 30 * 86400000)).toISOString();
        const publicOrigin = tradeQuoteDeliveryPublicOrigin(origin);
        const shareUrl = `${publicOrigin}${quoteReviewPath(linkId, secret)}`;
        const emailContent = buildTradeQuoteEmail({ snapshot: documentSnapshot, shareUrl, expiresAt });
        const emailContentSha256 = await tradeQuoteEmailContentSha256(emailContent);
        const attachmentFilename = tradeQuotePdfFilename(documentSnapshot);
        const idempotencyKey = `quote:${version.id}:${tokenIssue}:email:initial`;
        const providerIdempotencyKey = await tradeQuoteRecipientEmailSha256(idempotencyKey);
        const deliveryId = crypto.randomUUID();
        const recipientRole = String(job.customer_email || "").trim().toLowerCase() === customerEmail
          ? "primary_customer"
          : "authorised_contact";
        await currentPublicLeadJob(access.ownerUid, workOrderId, job);
        await stageTradeIssuedDocumentCleanup({
          kind: "quote",
          documentId: String(quote.id),
          revision: Number(version.version_number),
          ...issuedPdf,
        });
        const storedPdf = await storeTradeQuoteIssuedPdf({
          quoteVersionId: String(version.id),
          versionNumber: Number(version.version_number),
          bytes: issuedPdfBytes,
        });
        if (
          storedPdf.objectKey !== issuedPdf.objectKey
          || storedPdf.sha256 !== issuedPdf.sha256
          || storedPdf.sizeBytes !== issuedPdf.sizeBytes
        ) throw new Error("QUOTE_ISSUED_PDF_MISMATCH");
        await currentPublicLeadJob(access.ownerUid, workOrderId, job);
        const publicAccessHeld = publicLeadIssueAccessGuard(
          access.ownerUid,
          job,
        );
        const priorDeliverySettled = `NOT EXISTS (
          SELECT 1 FROM trade_crm_quote_deliveries pending_delivery
          JOIN trade_crm_quote_links pending_link
            ON pending_link.id = pending_delivery.quote_link_id
            AND pending_link.firebase_uid = pending_delivery.firebase_uid
          WHERE pending_link.quote_id = ? AND pending_link.firebase_uid = ?
            AND pending_delivery.quote_version_id <> ?
            AND (
              pending_delivery.status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
              OR (pending_delivery.status = 'failed' AND pending_delivery.next_attempt_at <> '')
            )
        )`;
        const claimStillHeld = `EXISTS (
          SELECT 1 FROM trade_crm_quote_versions claimed
          WHERE claimed.id = ? AND claimed.firebase_uid = ?
            AND claimed.status = 'issuing' AND claimed.consent_statement = ?
        ) AND ${priorDeliverySettled} AND ${publicAccessHeld.sql}`;
        const claimBindings = [
          version.id,
          access.ownerUid,
          issueClaimToken,
          quote.id,
          access.ownerUid,
          version.id,
          ...publicAccessHeld.bindings,
        ];
        const issueResults = await db.batch([
          db.prepare(`INSERT INTO trade_crm_quote_execution_snapshots
            (id, quote_version_id, firebase_uid, source_kind, packets_json, expected_duration_minutes, suggested_crew_size, required_capabilities_json, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${claimStillHeld}`)
            .bind(crypto.randomUUID(), version.id, access.ownerUid, execution.sourceKind,
              JSON.stringify(execution.packets), execution.expectedDurationMinutes,
              execution.suggestedCrewSize, JSON.stringify(execution.requiredCapabilities),
              now, ...claimBindings),
          db.prepare(`UPDATE trade_crm_quote_versions SET status = 'superseded', updated_at = ?
            WHERE quote_id = ? AND firebase_uid = ? AND status = 'issued'
              AND ${claimStillHeld}`)
            .bind(now, quote.id, access.ownerUid, ...claimBindings),
          db.prepare(`UPDATE trade_crm_quote_links
            SET status = 'superseded', token_hash = '', encrypted_token = '', updated_at = ?
            WHERE quote_id = ? AND firebase_uid = ? AND status = 'active'
              AND quote_version_id <> ? AND ${claimStillHeld}`)
            .bind(now, quote.id, access.ownerUid, version.id, ...claimBindings),
          db.prepare(`UPDATE trade_crm_quotes
            SET current_version_number = ?, status = 'issued', crm_customer_id = ?,
              service_site_id = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND ${claimStillHeld}`)
            .bind(version.version_number, job.crm_customer_id, job.service_site_id,
              now, quote.id,
              access.ownerUid, ...claimBindings),
          db.prepare(`UPDATE trade_crm_job_details SET quote_status = 'issued', updated_at = ?
            WHERE work_order_id = ? AND firebase_uid = ? AND ${claimStillHeld}`)
            .bind(now, workOrderId, access.ownerUid, ...claimBindings),
          db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at)
            SELECT ?, ?, ?, 'quote_issued', ?, ? WHERE ${claimStillHeld}`)
            .bind(crypto.randomUUID(), workOrderId, access.ownerUid,
              `${quote.quote_number} version ${version.version_number} issued with secure customer review.`,
              now, ...claimBindings),
          db.prepare(`INSERT INTO trade_crm_quote_links
            (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id,
             token_hash, encrypted_token, token_issue, status, expires_at, revoked_at,
             created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '', ?, ?
            WHERE ${claimStillHeld}`)
            .bind(linkId, quote.id, version.id, workOrderId, access.ownerUid,
              job.crm_customer_id, await hashQuoteLinkSecret(secret),
              await protectQuoteLinkSecret(linkId, tokenIssue, secret), tokenIssue,
              expiresAt, now, now, ...claimBindings),
          db.prepare(`INSERT INTO trade_crm_quote_events
            (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid,
             event_type, actor_type, summary, evidence_key, occurred_at)
            SELECT ?, ?, ?, ?, ?, ?, 'issued', 'office', 'Secure quote link issued.', ?, ?
            WHERE ${claimStillHeld}`)
            .bind(crypto.randomUUID(), linkId, quote.id, version.id, workOrderId,
              access.ownerUid, `issued:${version.id}`, now,
              ...claimBindings),
          db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_deliveries
            (id, quote_link_id, quote_version_id, work_order_id, firebase_uid,
             crm_customer_id, channel, provider, status, recipient_preview,
             recipient_role, consent_basis, idempotency_key, provider_message_id,
             provider_status, attempts, last_error, sent_at, delivered_at,
             subject_snapshot, email_content_sha256, attachment_filename,
             attachment_sha256, recipient_email_sha256, provider_idempotency_key,
             public_origin, queued_at,
             next_attempt_at, last_attempt_at, lease_expires_at, failure_code,
             created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, 'email', 'resend', 'queued', ?, ?,
              'installer_confirmed_current_quote', ?, '', '', 0, '', '', '',
              ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', ?, ?
            WHERE ${claimStillHeld}`)
            .bind(deliveryId, linkId, version.id, workOrderId, access.ownerUid,
              job.crm_customer_id, maskPhotoRequestEmail(customerEmail), recipientRole,
              idempotencyKey, emailContent.subject, emailContentSha256,
              attachmentFilename, issuedPdf.sha256,
              await tradeQuoteRecipientEmailSha256(customerEmail), providerIdempotencyKey,
              publicOrigin,
              now, now, now, now, ...claimBindings),
          db.prepare(`INSERT INTO trade_crm_quote_events
            (id, quote_link_id, quote_id, quote_version_id, work_order_id,
             firebase_uid, event_type, actor_type, summary, evidence_key,
             occurred_at)
            SELECT ?, ?, ?, ?, ?, ?, 'delivery_queued', 'office',
              'Quote email queued for delivery.', ?, ?
            WHERE ${claimStillHeld}`)
            .bind(crypto.randomUUID(), linkId, quote.id, version.id, workOrderId,
              access.ownerUid, `delivery_queued:${idempotencyKey}`, now,
              ...claimBindings),
          db.prepare(`UPDATE trade_crm_quote_versions
            SET status = 'issued', acceptance_email = ?, consent_statement = ?, issued_at = ?,
              document_snapshot_json = ?, issued_pdf_object_key = ?, issued_pdf_sha256 = ?,
              issued_pdf_size_bytes = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND status = 'issuing'
              AND consent_statement = ?
              AND ${priorDeliverySettled} AND ${publicAccessHeld.sql}`)
            .bind(customerEmail, consentStatement, issueTimestamp,
              documentSnapshotJson, issuedPdf.objectKey, issuedPdf.sha256,
              issuedPdf.sizeBytes, now, version.id, access.ownerUid,
              issueClaimToken, quote.id, access.ownerUid, version.id,
              ...publicAccessHeld.bindings),
        ]).catch(() => {
          throw stagedQuoteError("QUOTE_ISSUE_STORAGE_FAILED", "issue_transaction");
        });
        if (Number(issueResults[issueResults.length - 1]?.meta.changes || 0) !== 1) {
          throw new Error("QUOTE_DELIVERY_PENDING");
        }
        try {
          await verifyTradeQuoteIssuedPdf({
            quoteVersionId: String(version.id),
            versionNumber: Number(version.version_number),
            reference: issuedPdf,
          });
        } catch { throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE"); }
        const canonical = await db.prepare(`SELECT version.status, link.id link_id,
            version.issued_pdf_object_key, version.issued_pdf_sha256,
            version.issued_pdf_size_bytes
          FROM trade_crm_quote_versions version
          JOIN trade_crm_quote_links link
            ON link.quote_version_id = version.id
            AND link.firebase_uid = version.firebase_uid
          WHERE version.id = ? AND version.firebase_uid = ?
            AND version.status = 'issued' AND link.status = 'active'
          LIMIT 1`).bind(version.id, access.ownerUid).first<Row>();
        if (
          !canonical
          || String(canonical.issued_pdf_object_key || "") !== issuedPdf.objectKey
          || String(canonical.issued_pdf_sha256 || "") !== issuedPdf.sha256
          || Number(canonical.issued_pdf_size_bytes || 0) !== issuedPdf.sizeBytes
        ) throw new Error("QUOTE_ISSUE_IN_PROGRESS");
        const delivery = await latestTradeQuoteDeliveryStatus(
          db,
          String(version.id),
          access.ownerUid,
        );
        if (!delivery) {
          throw stagedQuoteError(
            "QUOTE_ISSUE_DELIVERY_MISSING",
            "issue_delivery_status",
          );
        }
        return adminJson({
          ok: true,
          quoteIssued: true,
          deliveryAccepted: false,
          deliveryState: delivery.status,
          delivery,
          access: quoteAccessPayload(access),
          quote: await quotePayload(access.ownerUid, workOrderId, access.isOwner || access.canViewPriceBook, origin),
        }, 202);
      } catch (error) {
        const canonical = await db.prepare(`SELECT version.status, link.id link_id,
            link.status link_status, version.issued_pdf_object_key,
            version.issued_pdf_sha256, version.issued_pdf_size_bytes
          FROM trade_crm_quote_versions version
          LEFT JOIN trade_crm_quote_links link
            ON link.quote_version_id = version.id
            AND link.firebase_uid = version.firebase_uid
          WHERE version.id = ? AND version.firebase_uid = ? LIMIT 1`)
          .bind(version.id, access.ownerUid).first<Row>();
        if (
          canonical?.status === "issued"
          && canonical.link_id
          && canonical.link_status === "active"
          && issuedPdf
          && String(canonical.issued_pdf_object_key || "") === issuedPdf.objectKey
          && String(canonical.issued_pdf_sha256 || "") === issuedPdf.sha256
          && Number(canonical.issued_pdf_size_bytes || 0) === issuedPdf.sizeBytes
        ) {
          try {
            await verifyTradeQuoteIssuedPdf({
              quoteVersionId: String(version.id),
              versionNumber: Number(version.version_number),
              reference: issuedPdf,
            });
            const delivery = await latestTradeQuoteDeliveryStatus(
              db,
              String(version.id),
              access.ownerUid,
            );
            if (!delivery) {
              throw stagedQuoteError(
                "QUOTE_ISSUE_DELIVERY_MISSING",
                "issue_recovery_delivery_status",
              );
            }
            return adminJson({
              ok: true,
              quoteIssued: true,
              deliveryAccepted: ["provider_accepted", "sent", "delivered"]
                .includes(delivery.status),
              deliveryState: delivery.status,
              delivery,
              access: quoteAccessPayload(access),
              quote: await quotePayload(access.ownerUid, workOrderId,
                access.isOwner || access.canViewPriceBook, origin),
            }, 202);
          } catch (recoveryError) {
            if (
              recoveryError instanceof Error
              && recoveryError.message === "QUOTE_ISSUE_DELIVERY_MISSING"
            ) throw recoveryError;
            throw error;
          }
        }
        if (issuedPdf) {
          await activateTradeIssuedDocumentCleanup(issuedPdf.objectKey)
            .catch(() => undefined);
          const referenced = await db.prepare(`SELECT 1 referenced
            FROM trade_crm_quote_versions
            WHERE issued_pdf_object_key = ? AND issued_pdf_sha256 = ?
              AND issued_pdf_size_bytes = ? AND status = 'issued'
            LIMIT 1`)
            .bind(issuedPdf.objectKey, issuedPdf.sha256, issuedPdf.sizeBytes)
            .first<Row>();
          if (!referenced) {
            try {
              await deleteTradeQuoteIssuedPdf({
                quoteVersionId: String(version.id),
                versionNumber: Number(version.version_number),
                reference: issuedPdf,
              });
            } catch { /* The pre-written cleanup intent remains pending for the scheduled drain. */ }
          }
        }
        await db.prepare(`UPDATE trade_crm_quote_versions
          SET status = 'draft', updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status = 'issuing'
            AND consent_statement = ?`)
          .bind(new Date().toISOString(), version.id, access.ownerUid,
            issueClaimToken)
          .run();
        throw error;
      }
    }
    if (["replace_link", "revoke_link", "send_quote", "retry_quote_delivery", "answer_question"].includes(action)) {
      const quote = await db.prepare("SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?").bind(workOrderId, access.ownerUid).first<Row>();
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      const version = await db.prepare("SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? AND version_number = ? AND status = 'issued'").bind(quote.id, access.ownerUid, quote.current_version_number).first<Row>();
      if (!version) throw new Error("IMMUTABLE_VERSION");
      const link = await db.prepare("SELECT * FROM trade_crm_quote_links WHERE quote_version_id = ? AND firebase_uid = ?").bind(version.id, access.ownerUid).first<Row>();
      if (!link) throw new Error("QUOTE_NOT_FOUND");
      if (action === "replace_link") {
        const unsettled = await db.prepare(`SELECT 1 pending
          FROM trade_crm_quote_deliveries WHERE quote_link_id = ? AND firebase_uid = ?
            AND (
              status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
              OR (status = 'failed' AND next_attempt_at <> '')
            ) LIMIT 1`)
          .bind(link.id, access.ownerUid).first<Row>();
        if (unsettled) throw new Error("QUOTE_DELIVERY_PENDING");
        const secret = newQuoteLinkSecret(); const tokenIssue = Number(link.token_issue) + 1;
        const validExpiry = version.valid_until ? new Date(`${version.valid_until}T23:59:59.999Z`) : new Date(Date.now() + 30 * 86400000);
        const expiresAt = new Date(Math.min(validExpiry.getTime(), Date.now() + 30 * 86400000)).toISOString();
        const replacement = await db.batch([
          db.prepare(`UPDATE trade_crm_quote_links
            SET token_hash = ?, encrypted_token = ?, token_issue = ?, status = 'active',
              expires_at = ?, revoked_at = '', updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND token_issue = ? AND updated_at = ?
              AND NOT EXISTS (
                SELECT 1 FROM trade_crm_quote_deliveries delivery
                WHERE delivery.quote_link_id = trade_crm_quote_links.id
                  AND delivery.firebase_uid = trade_crm_quote_links.firebase_uid
                  AND (
                    delivery.status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
                    OR (delivery.status = 'failed' AND delivery.next_attempt_at <> '')
                  )
              )`)
            .bind(await hashQuoteLinkSecret(secret), await protectQuoteLinkSecret(String(link.id), tokenIssue, secret), tokenIssue, expiresAt, now, link.id, access.ownerUid, link.token_issue, link.updated_at),
          db.prepare(`UPDATE trade_crm_quote_deliveries
            SET status = 'replaced', next_attempt_at = '', lease_expires_at = '', updated_at = ?
            WHERE quote_link_id = ? AND EXISTS (
              SELECT 1 FROM trade_crm_quote_links current_link
              WHERE current_link.id = ? AND current_link.firebase_uid = ?
                AND current_link.token_issue = ? AND current_link.updated_at = ?
            ) AND (
              status IN ('queued','sending','waiting_for_channel')
              OR (status = 'failed' AND next_attempt_at <> '')
            )`).bind(now, link.id, link.id, access.ownerUid, tokenIssue, now),
          db.prepare(`INSERT INTO trade_crm_quote_events
            (id, quote_link_id, quote_id, quote_version_id, work_order_id,
             firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
            SELECT ?, ?, ?, ?, ?, ?, 'replaced', 'office',
              'Secure quote link replaced.', ?, ?
            WHERE EXISTS (
              SELECT 1 FROM trade_crm_quote_links current_link
              WHERE current_link.id = ? AND current_link.firebase_uid = ?
                AND current_link.token_issue = ? AND current_link.updated_at = ?
            )`)
            .bind(crypto.randomUUID(), link.id, quote.id, version.id, workOrderId,
              access.ownerUid, `replaced:${version.id}:${tokenIssue}`, now,
              link.id, access.ownerUid, tokenIssue, now),
        ]);
        if (Number(replacement[0]?.meta.changes || 0) !== 1) {
          return adminJson({
            ok: false,
            error: "The quote link changed while it was being replaced. Refresh and try again.",
          }, 409);
        }
      } else if (action === "answer_question") {
        const questionId = cleanAdminText(body.questionId, 180); const answer = cleanAdminText(body.answer, 1000); if (!questionId || answer.length < 2) return adminJson({ ok: false, error: "Enter a clear response." }, 400);
        const result = await db.prepare("UPDATE trade_crm_quote_questions SET answer = ?, status = 'answered', answered_at = ?, answered_by_uid = ? WHERE id = ? AND quote_version_id = ? AND firebase_uid = ? AND status = 'open'")
          .bind(answer, now, access.actorUid, questionId, version.id, access.ownerUid).run(); if (Number(result.meta.changes || 0) !== 1) return adminJson({ ok: false, error: "That question is no longer awaiting a response." }, 409);
        await db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, 'question_answered', 'office', 'Trade office answered the customer question.', ?, ?)`)
          .bind(crypto.randomUUID(), link.id, quote.id, version.id, workOrderId, access.ownerUid, `answer:${questionId}`, now).run();
      } else {
        const channel = cleanAdminText(body.channel, 20) || "email";
        if (channel === "sms") {
          if (process.env.TLINK_SMS_SENDER_APPROVED !== "true") return adminJson({ ok: false, error: "Quote SMS stays unavailable until the approved sender gate is enabled." }, 409);
          return adminJson({ ok: false, error: "Quote SMS delivery is not enabled for this release." }, 409);
        }
        if (channel !== "email") return adminJson({ ok: false, error: "Choose email delivery or copy the secure link." }, 400);
        if (body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm that this customer asked to receive the current quote by email." }, 400);
        if (link.status !== "active" || !link.token_hash) return adminJson({ ok: false, error: "Replace the secure link before sending it." }, 409);
        const priorOptOut = await db.prepare("SELECT 1 stopped FROM trade_crm_quote_deliveries WHERE firebase_uid = ? AND crm_customer_id = ? AND channel = 'email' AND status IN ('complained', 'opted_out') LIMIT 1").bind(access.ownerUid, job.crm_customer_id).first<Row>();
        if (priorOptOut) return adminJson({ ok: false, error: "This customer has opted out of quote email delivery." }, 409);
        const email = String(version.acceptance_email || "").trim().toLowerCase();
        const currentEmails = await authorisedEmails(access.ownerUid, String(job.crm_customer_id), acceptedPublicEmail(job));
        if (!email || !currentEmails.includes(email)) {
          return adminJson({ ok: false, error: "The quote recipient is no longer an authorised customer contact. Create a replacement quote version with the current address." }, 409);
        }
        const idempotencyKey = `quote:${version.id}:${link.token_issue}:email:initial`;
        const requestedDeliveryId = cleanAdminText(body.deliveryId, 180);
        if (action === "retry_quote_delivery" && !requestedDeliveryId) {
          return adminJson({ ok: false, error: "Choose the quote delivery that needs attention." }, 400);
        }
        let existing = await db.prepare(`SELECT id, status, attempts, next_attempt_at,
            failure_code, retry_of_delivery_id, delivery_generation, updated_at
          FROM trade_crm_quote_deliveries
          WHERE idempotency_key = ? AND firebase_uid = ?
            AND quote_version_id = ? AND quote_link_id = ?`)
          .bind(idempotencyKey, access.ownerUid, version.id, link.id).first<Row>();
        const existingLeaf = existing
          ? await db.prepare(`SELECT id, status, attempts, next_attempt_at,
              failure_code, retry_of_delivery_id, delivery_generation, updated_at
            FROM trade_crm_quote_deliveries
            WHERE firebase_uid = ? AND (
              id = ? OR retry_of_delivery_id = ?
            ) ORDER BY delivery_generation DESC, created_at DESC, id DESC LIMIT 1`)
              .bind(access.ownerUid, existing.id, existing.id).first<Row>()
          : null;
        let predecessor: Row | null = null;
        if (action === "retry_quote_delivery") {
          predecessor = await db.prepare(`SELECT id, status, attempts, failure_code,
              retry_of_delivery_id, delivery_generation
            FROM trade_crm_quote_deliveries
            WHERE id = ? AND firebase_uid = ? AND quote_version_id = ?
              AND quote_link_id = ? AND idempotency_key = ? LIMIT 1`)
            .bind(requestedDeliveryId, access.ownerUid, version.id, link.id,
              idempotencyKey).first<Row>();
        }
        if (action === "retry_quote_delivery" && !predecessor) {
          return adminJson({ ok: false, error: "That delivery does not belong to this current quote version." }, 409);
        }
        const existingRetry = predecessor
          ? await db.prepare(`SELECT id, status, attempts, next_attempt_at FROM trade_crm_quote_deliveries
              WHERE firebase_uid = ? AND retry_of_delivery_id = ?
                AND delivery_generation = 2 LIMIT 1`)
              .bind(access.ownerUid, predecessor.id).first<Row>()
          : null;
        if (existingRetry) {
          const retryDelivery = await tradeQuoteDeliveryStatus(
            db,
            String(existingRetry.id),
            access.ownerUid,
          );
          const retryAccepted = ["provider_accepted", "sent", "delivered"]
            .includes(String(existingRetry.status));
          const retryActive = ["queued", "sending", "waiting_for_channel"]
            .includes(String(existingRetry.status))
            || (existingRetry.status === "failed"
              && Boolean(String(existingRetry.next_attempt_at || "")));
          if (!retryAccepted && !retryActive) {
            return adminJson({
              ok: false,
              error: "This quote email still needs attention and its one retry is complete.",
              delivery: retryDelivery,
            }, 409);
          }
          return adminJson({
            ok: true,
            deliveryAccepted: retryAccepted,
            delivery: retryDelivery,
            access: quoteAccessPayload(access),
            quote: await quotePayload(access.ownerUid, workOrderId,
              access.isOwner || access.canViewPriceBook, new URL(request.url).origin),
          }, retryAccepted ? 200 : 202);
        }
        if (action === "send_quote" && existingLeaf
          && String(existingLeaf.id) !== String(existing?.id || "")) {
          const leafDelivery = await tradeQuoteDeliveryStatus(
            db,
            String(existingLeaf.id),
            access.ownerUid,
          );
          const leafAccepted = ["provider_accepted", "sent", "delivered"]
            .includes(String(existingLeaf.status));
          const leafActive = ["queued", "sending", "waiting_for_channel"]
            .includes(String(existingLeaf.status))
            || (existingLeaf.status === "failed"
              && Boolean(String(existingLeaf.next_attempt_at || "")));
          if (!leafAccepted && !leafActive) {
            return adminJson({
              ok: false,
              error: "This quote email still needs attention and its one retry is complete.",
              delivery: leafDelivery,
            }, 409);
          }
          return adminJson({
            ok: true,
            deliveryAccepted: leafAccepted,
            delivery: leafDelivery,
            access: quoteAccessPayload(access),
            quote: await quotePayload(access.ownerUid, workOrderId,
              access.isOwner || access.canViewPriceBook, new URL(request.url).origin),
          }, leafAccepted ? 200 : 202);
        }
        if (existing && ["provider_accepted", "sent", "delivered"].includes(String(existing.status))) {
          return adminJson({ ok: true, delivery: await tradeQuoteDeliveryStatus(db, String(existing.id), access.ownerUid), access: quoteAccessPayload(access), quote: await quotePayload(access.ownerUid, workOrderId, access.isOwner || access.canViewPriceBook, new URL(request.url).origin) });
        }
        if (
          action === "send_quote"
          && existing
          && (
            ["queued", "waiting_for_channel"].includes(String(existing.status))
            || (existing.status === "failed" && Boolean(String(existing.next_attempt_at || "")))
          )
        ) {
          return adminJson({
            ok: true,
            deliveryAccepted: false,
            delivery: await tradeQuoteDeliveryStatus(db, String(existing.id), access.ownerUid),
            access: quoteAccessPayload(access),
            quote: await quotePayload(access.ownerUid, workOrderId,
              access.isOwner || access.canViewPriceBook, new URL(request.url).origin),
          }, 202);
        }
        if (existing && existing.status === "sending" && Date.parse(String(existing.updated_at || "")) > Date.now() - 10 * 60 * 1000) {
          return adminJson({ ok: true, delivery: await tradeQuoteDeliveryStatus(db, String(existing.id), access.ownerUid), access: quoteAccessPayload(access), quote: await quotePayload(access.ownerUid, workOrderId, access.isOwner || access.canViewPriceBook, new URL(request.url).origin) }, 202);
        }
        if (action === "send_quote" && existing?.status === "failed" && !existing.next_attempt_at) {
          return adminJson({
            ok: false,
            error: "This delivery needs attention. Use Retry once after confirming the recipient.",
            delivery: await tradeQuoteDeliveryStatus(db, String(existing.id), access.ownerUid),
          }, 409);
        }

        let snapshot = parseTradeQuoteDocumentSnapshot(version.document_snapshot_json);
        if (!snapshot) {
          if (String(version.document_snapshot_json || "").trim()) throw new Error("QUOTE_DOCUMENT_INVALID");
          snapshot = await buildTradeQuoteDocumentSnapshot(
            access.ownerUid,
            String(version.id),
            acceptedQuoteSnapshotOverrides(job),
          );
          await db.prepare("UPDATE trade_crm_quote_versions SET document_snapshot_json = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'issued' AND document_snapshot_json = ''")
            .bind(JSON.stringify(snapshot), now, version.id, access.ownerUid).run();
        }
        if (
          snapshot.quoteVersionId !== String(version.id)
          || snapshot.quoteId !== String(quote.id)
          || snapshot.work.id !== workOrderId
          || snapshot.acceptanceEmail.toLowerCase() !== email
        ) throw new Error("QUOTE_DOCUMENT_INVALID");
        const secret = await recoverQuoteLinkSecret(String(link.encrypted_token), String(link.id), Number(link.token_issue), String(link.token_hash));
        const origin = tradeQuoteDeliveryPublicOrigin(new URL(request.url).origin);
        const shareUrl = `${origin}${quoteReviewPath(String(link.id), secret)}`;
        const emailContent = buildTradeQuoteEmail({ snapshot, shareUrl, expiresAt: String(link.expires_at) });
        const issuedPdf = await issuedTradeQuotePdf({
          ownerUid: access.ownerUid,
          quoteVersionId: String(version.id),
          snapshot,
          origin,
        });
        const emailContentSha256 = await tradeQuoteEmailContentSha256(emailContent);
        const attachmentSha256 = issuedPdf.reference.sha256;
        const attachmentFilename = tradeQuotePdfFilename(snapshot);
        const recipientRole = String(job.customer_email || "").trim().toLowerCase() === email
          ? "primary_customer"
          : "authorised_contact";
        const manualRetryRequested = action === "retry_quote_delivery";
        if (manualRetryRequested && (
          Number(predecessor?.delivery_generation || 1) !== 1
          || predecessor?.retry_of_delivery_id
          || predecessor?.status !== "failed"
          || !(
            predecessor?.failure_code === "QUOTE_DELIVERY_LEGACY_RETRY_REQUIRED"
            || predecessor?.failure_code === "QUOTE_DELIVERY_PROVIDER_TERMINAL"
            || Number(predecessor?.attempts || 0) >= 5
          )
        )) {
          return adminJson({
            ok: false,
            error: "This delivery is already sending or no longer allows a retry.",
            delivery: await tradeQuoteDeliveryStatus(db, requestedDeliveryId, access.ownerUid),
          }, 409);
        }
        const deliveryId = crypto.randomUUID();
        const generation = manualRetryRequested ? 2 : 1;
        const generationIdempotencyKey = manualRetryRequested
          ? `${idempotencyKey}:retry:2`
          : idempotencyKey;
        const generationProviderKey = await tradeQuoteRecipientEmailSha256(generationIdempotencyKey);
        const insertDelivery = await db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_deliveries
          (id, quote_link_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id,
           channel, provider, status, recipient_preview, recipient_role, consent_basis,
           idempotency_key, provider_message_id, provider_status, attempts, last_error,
           sent_at, delivered_at, subject_snapshot, email_content_sha256,
           attachment_filename, attachment_sha256, recipient_email_sha256,
           provider_idempotency_key,
           public_origin, queued_at, next_attempt_at, last_attempt_at,
           lease_expires_at, failure_code, retry_of_delivery_id,
            delivery_generation, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, 'email', 'resend', 'queued', ?, ?,
            'installer_confirmed_current_quote', ?, '', '', 0, '', '', '', ?, ?, ?, ?,
            ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM trade_crm_quote_links current_link
            WHERE current_link.id = ? AND current_link.firebase_uid = ?
              AND current_link.quote_version_id = ? AND current_link.status = 'active'
              AND current_link.token_issue = ? AND current_link.token_hash = ?
              AND current_link.updated_at = ?
          )`)
          .bind(deliveryId, link.id, version.id, workOrderId, access.ownerUid, job.crm_customer_id,
            maskPhotoRequestEmail(email), recipientRole, generationIdempotencyKey, emailContent.subject,
            emailContentSha256, attachmentFilename, attachmentSha256,
            await tradeQuoteRecipientEmailSha256(email), generationProviderKey,
            origin, now, now, manualRetryRequested ? requestedDeliveryId : "",
            generation, now, now, link.id, access.ownerUid, version.id,
            link.token_issue, link.token_hash, link.updated_at).run();
        existing = await db.prepare(`SELECT id, status, attempts, next_attempt_at,
            failure_code, retry_of_delivery_id, delivery_generation, updated_at
          FROM trade_crm_quote_deliveries
          WHERE idempotency_key = ? AND firebase_uid = ?
            AND quote_version_id = ? AND quote_link_id = ? LIMIT 1`)
          .bind(generationIdempotencyKey, access.ownerUid, version.id,
            link.id).first<Row>();
        if (!existing) {
          return adminJson({
            ok: false,
            error: "The quote link changed before delivery was queued. Refresh and try again.",
          }, 409);
        }
        const currentLink = await db.prepare(`SELECT token_issue, token_hash, updated_at
          FROM trade_crm_quote_links
          WHERE id = ? AND firebase_uid = ? AND quote_version_id = ?
            AND status = 'active' LIMIT 1`)
          .bind(link.id, access.ownerUid, version.id).first<Row>();
        if (
          !currentLink
          || Number(currentLink.token_issue) !== Number(link.token_issue)
          || String(currentLink.token_hash) !== String(link.token_hash)
          || String(currentLink.updated_at) !== String(link.updated_at)
        ) {
          if (Number(insertDelivery.meta.changes || 0) === 1) {
            await db.prepare(`UPDATE trade_crm_quote_deliveries
              SET status = 'replaced', next_attempt_at = '', lease_expires_at = '',
                failure_code = 'QUOTE_DELIVERY_REVISION_INACTIVE',
                last_error = 'The secure quote link changed before delivery began.',
                updated_at = ?
              WHERE id = ? AND firebase_uid = ? AND status = 'queued' AND attempts = 0`)
              .bind(new Date().toISOString(), existing.id, access.ownerUid).run();
          }
          return adminJson({
            ok: false,
            error: "The quote link changed before delivery was queued. Refresh and try again.",
          }, 409);
        }
        const authoritativeDeliveryId = String(existing.id);
        await currentPublicLeadJob(access.ownerUid, workOrderId, job);
        const delivery = await tradeQuoteDeliveryStatus(db, authoritativeDeliveryId, access.ownerUid);
        const status = delivery?.status || "queued";
        const accepted = ["provider_accepted", "sent", "delivered"].includes(status);
        return adminJson({
          ok: true,
          deliveryAccepted: accepted,
          delivery,
          access: quoteAccessPayload(access),
          quote: await quotePayload(access.ownerUid, workOrderId,
            access.isOwner || access.canViewPriceBook, origin),
        }, accepted ? 200 : 202);
      }
      return adminJson({ ok: true, access: quoteAccessPayload(access), quote: await quotePayload(access.ownerUid, workOrderId, access.isOwner || access.canViewPriceBook, new URL(request.url).origin) });
    }
    return adminJson({ ok: false, error: "Unsupported quote action." }, 400);
  } catch (error) { return errorResponse(error); }
}
