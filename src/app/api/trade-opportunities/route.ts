import { getD1 } from "../../../../db";
import { parseJsonList } from "@/lib/admin-server";
import {
  allocateNearestInstallers,
  expireStaleOpportunities,
  syncMarketplaceEnquiries,
} from "@/lib/opportunity-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";
import {
  requireVerifiedTradeAccess,
  TradeAccessError,
  verifiedTradeAccountPredicate,
} from "@/lib/trade-access-server";
import {
  buildInstallerPropertyContext,
  normalizePlatformQuote,
  parseStoredJson,
} from "@/lib/customer-projects.mjs";
import {
  CUSTOMER_MATCHING_NOTICE_VERSION,
  matchingLocalityDisclosure,
} from "@/lib/customer-matching-locality.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "@/lib/public-plan-enquiry.mjs";
import { publicTradeContactForMatchedLead } from "@/lib/public-trade-lead-access.mjs";
import { startPublicLeadQuoteWorkflow } from "@/lib/public-lead-quote-workflow-server";
import {
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  publicPlanQuoteAnswersForMatchedCategories,
  publicPlanQuoteCategoryIntersection,
  strictPublicPlanQuoteServiceCategories,
} from "@/lib/public-plan-quote-preparation.mjs";
import { createInstallerEnquiryPack } from "@/lib/customer-plan-document.mjs";
import { normaliseArrivalWindows, parseArrivalWindows } from "@/lib/customer-project-arrivals.mjs";
import { adminNotificationStatement, createAdminNotification } from "@/lib/admin-notifications";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";
import {
  CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER,
  customerProjectActivityStatements,
} from "@/lib/customer-project-activity-notification-server";
import { customerProjectQuoteId } from "@/lib/customer-project-activity-notifications";
import {
  arrivalProposalForMatchedLead,
  customerProjectContactForMatchedLead,
  customerProjectContextMatchesBase,
  platformQuoteForMatchedLead,
} from "@/lib/trade-opportunity-read-projection.mjs";

export const runtime = "edge";
const PARTNER_STATUSES = new Set(["viewed", "interested", "declined"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function distanceBand(value: unknown) {
  const kilometres = Number(value || 0) / 1000;
  if (kilometres < 10) return "Within 10 km of your service base";
  if (kilometres < 25) return "10 to 25 km from your service base";
  if (kilometres < 50) return "25 to 50 km from your service base";
  if (kilometres < 100) return "50 to 100 km from your service base";
  return "More than 100 km from your service base";
}

function installerEvidenceName(item: Record<string, unknown>) {
  const extension = item.content_type === "application/pdf" ? "pdf"
    : item.content_type === "image/png" ? "png"
      : item.content_type === "image/webp" ? "webp" : "jpg";
  const category = String(item.category || "project-evidence").replace(/[^a-z0-9-]/g, "");
  return `${category || "project-evidence"}.${extension}`;
}

function installerEnquiryPack(
  row: Record<string, unknown>,
  evidence: Array<Record<string, unknown>>,
) {
  if (!row.customer_project_id) return null;
  return createInstallerEnquiryPack({
    goal: row.customer_goal,
    goals: row.customer_goals,
    pace: row.customer_pace,
    postcode: row.customer_postcode,
    address_state: row.customer_address_state,
    property_type: row.customer_property_type,
    household_situation: row.customer_household_situation,
    existing_features: row.customer_existing_features,
    service_categories: row.customer_service_categories,
    budget_range: row.customer_budget_range,
    property_context: row.property_context,
    advisor_profile: row.customer_advisor_profile,
    plan_snapshot: row.customer_plan_snapshot,
    completed_plan_items: row.customer_completed_plan_items,
  }, {
    preparedAt: String(row.customer_project_updated_at || new Date().toISOString()),
    evidence,
  });
}

async function productSnapshot(installerUid: string, productListId: string) {
  if (!productListId) return { products: [], subtotalCentsExGst: 0 };
  const db = getD1();
  const list = await db.prepare("SELECT id FROM installer_product_lists WHERE id = ? AND firebase_uid = ?")
    .bind(productListId, installerUid).first();
  if (!list) throw new Error("PRODUCT_LIST_REQUIRED");
  const allItems = await db.prepare("SELECT COUNT(*) count FROM installer_product_list_items WHERE list_id = ?")
    .bind(productListId).first<{ count: number }>();
  const rows = await db.prepare(`SELECT i.product_id, i.quantity, i.unit_price_cents_ex_gst,
    p.model_number, p.brand, p.name, p.unit_label
    FROM installer_product_list_items i
    JOIN supplier_products p ON p.id = i.product_id
    JOIN trade_accounts a ON a.firebase_uid = i.supplier_uid
    WHERE i.list_id = ? AND p.listing_status = 'published' AND p.review_status = 'approved'
      AND p.firebase_uid = i.supplier_uid
      AND ${verifiedTradeAccountPredicate("a")} AND a.partner_type = 'supplier'
      ORDER BY p.brand, p.name`).bind(productListId).all<Record<string, unknown>>();
  if (!rows.results.length || rows.results.length !== Number(allItems?.count || 0)) throw new Error("PRODUCT_LIST_UNAVAILABLE");
  const products = rows.results.map((row: Record<string, unknown>) => ({
    productId: row.product_id,
    brand: row.brand,
    name: row.name,
    modelNumber: row.model_number,
    unitLabel: row.unit_label,
    quantity: Number(row.quantity || 0),
    unitPriceCentsExGst: Number(row.unit_price_cents_ex_gst || 0),
  }));
  return { products, subtotalCentsExGst: products.reduce((sum: number, item: { quantity: number; unitPriceCentsExGst: number }) => sum + item.quantity * item.unitPriceCentsExGst, 0) };
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function publicLeadQuoteWorkflowOutcome(
  db: D1Database,
  installerUid: string,
  matchId: string,
  now: string,
) {
  return {
    quoteWorkflow: await startPublicLeadQuoteWorkflow(
        db,
        installerUid,
        matchId,
        now,
    ),
    warning: "",
  };
}

function activityDispatchJson(
  body: object,
  deliveryId: string,
  status = 200,
) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      [CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER]: deliveryId,
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function tradeAccessCode(error: unknown) {
  return error instanceof TradeAccessError ? error.code : error instanceof Error ? error.message : "";
}

function platformQuoteResponse(row: Record<string, unknown> | null) {
  if (!row?.quote_id) return null;
  return {
    id: String(row.quote_id),
    productListId: String(row.product_list_id || ""),
    inclusions: parseStoredJson(row.quote_inclusions, []),
    products: parseStoredJson(row.product_snapshot, []),
    productSubtotalCentsExGst: Number(row.product_subtotal_cents_ex_gst || 0),
    labourCentsExGst: Number(row.labour_cents_ex_gst || 0),
    otherCentsExGst: Number(row.other_cents_ex_gst || 0),
    totalCentsExGst: Number(row.total_cents_ex_gst || 0),
    quoteType: String(row.quote_type || "indicative"),
    startWindow: String(row.start_window || "to_confirm"),
    durationWeeks: Number(row.duration_weeks || 0),
    workmanshipWarrantyYears: Number(row.workmanship_warranty_years || 0),
    status: String(row.quote_status || "submitted"),
    customerDecision: String(row.customer_decision || "reviewing"),
    submittedAt: String(row.quote_submitted_at || ""),
    submissionRevision: Number(row.quote_submission_revision || 0),
  };
}

async function authoritativePlatformQuote(
  db: ReturnType<typeof getD1>,
  opportunityMatchId: string,
  installerUid: string,
) {
  const row = await db.prepare(`SELECT id quote_id, product_list_id,
    inclusions quote_inclusions, product_snapshot,
    product_subtotal_cents_ex_gst, labour_cents_ex_gst, other_cents_ex_gst,
    total_cents_ex_gst, quote_type, start_window, duration_weeks,
    workmanship_warranty_years, status quote_status, customer_decision,
    submitted_at quote_submitted_at, submission_revision quote_submission_revision
    FROM customer_project_quotes
    WHERE opportunity_match_id = ? AND installer_uid = ? LIMIT 1`)
    .bind(opportunityMatchId, installerUid)
    .first<Record<string, unknown>>();
  return platformQuoteResponse(row);
}

export async function GET(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  let access: Awaited<ReturnType<typeof requireVerifiedTradeAccess>>;
  try {
    access = await requireVerifiedTradeAccess(request, { partnerTypes: ["installer"] });
  } catch (error) {
    const code = tradeAccessCode(error);
    if (code === "AUTH_REQUIRED") return json({ ok: false, error: "Sign in to continue." }, 401);
    if (code === "PROFILE_REQUIRED") return json({ ok: false, error: "Complete the business profile first." }, 404);
    if (code === "TRADE_ROLE_REQUIRED") return json({ ok: false, error: "Household opportunities are never available to wholesaler accounts." }, 403);
    if (code === "ACCOUNT_INACTIVE") return json({ ok: false, error: "This business account is not active." }, 403);
    return json({ ok: false, error: "Complete trade verification before opening marketplace opportunities." }, 403);
  }
  const user = access.identity;
  const db = getD1();
  if (!await accountHasFeature(user.uid, "installer", "installer_leads"))
    return json(
      { ok: false, error: "Complete trade verification before opening marketplace opportunities." },
      403,
    );
  const matchParameters = new URL(request.url).searchParams.getAll("matchId");
  if (
    matchParameters.length > 1
    || (matchParameters.length === 1 && !UUID_PATTERN.test(matchParameters[0].trim()))
  ) {
    return json({ ok: false, error: "Choose one valid opportunity." }, 400);
  }
  const requestedMatchId = matchParameters[0]?.trim() || "";
  await expireStaleOpportunities();
  const boundedLeadMatchesSql = `WITH authoritative_matches AS (
      SELECT bounded_match.id match_id,
        bounded_match.opportunity_id opportunity_id,
        bounded_match.firebase_uid installer_uid,
        bounded_match.matched_categories matched_categories,
        bounded_opportunity.source_reference source_reference
      FROM trade_opportunity_matches bounded_match
      JOIN trade_opportunities bounded_opportunity
        ON bounded_opportunity.id = bounded_match.opportunity_id
      LEFT JOIN customer_projects bounded_project
        ON bounded_project.opportunity_id = bounded_opportunity.id
        AND bounded_opportunity.source_reference = 'customer-project:' || bounded_project.id
      WHERE bounded_match.firebase_uid = ?
        AND (? = '' OR bounded_match.id = ?)
        AND bounded_opportunity.status IN ('open', 'paused')
        AND bounded_match.status IN ('offered', 'viewed', 'interested', 'connected')
        AND (
          bounded_project.id IS NULL OR EXISTS (
            SELECT 1 FROM customer_consent_receipts bounded_matching_consent
            WHERE bounded_matching_consent.project_id = bounded_project.id
              AND bounded_matching_consent.firebase_uid = bounded_project.firebase_uid
              AND bounded_matching_consent.purpose = 'anonymized_installer_matching'
              AND bounded_matching_consent.withdrawn_at = ''
          )
        )
      ORDER BY CASE bounded_match.status WHEN 'offered' THEN 0 WHEN 'viewed' THEN 1
        WHEN 'interested' THEN 2 WHEN 'connected' THEN 3 ELSE 4 END,
        bounded_match.updated_at DESC, bounded_match.id ASC
      LIMIT 100
    )`;
  const baseLeadStatement = db.prepare(`SELECT
      m.id match_id, m.firebase_uid installer_uid, m.status match_status,
      m.matched_categories, m.distance_metres, m.allocation_rank,
      m.contact_attempt_count, m.last_contact_at, m.connected_at,
      m.matched_at, m.updated_at,
      o.id, o.title, o.project_type, o.suburb opportunity_suburb,
      o.postcode opportunity_postcode, o.state, o.service_categories,
      o.priority, o.timing, o.summary, o.status, o.contact_limit,
      o.expires_at, o.source_reference,
      p.id customer_project_id, p.firebase_uid customer_uid
    FROM trade_opportunity_matches m
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    LEFT JOIN customer_projects p ON p.opportunity_id = o.id
      AND o.source_reference = 'customer-project:' || p.id
    WHERE m.firebase_uid = ? AND (? = '' OR m.id = ?)
      AND o.status IN ('open', 'paused')
      AND m.status IN ('offered', 'viewed', 'interested', 'connected')
      AND (
        p.id IS NULL OR EXISTS (
          SELECT 1 FROM customer_consent_receipts matching_consent
          WHERE matching_consent.project_id = p.id
            AND matching_consent.firebase_uid = p.firebase_uid
            AND matching_consent.purpose = 'anonymized_installer_matching'
            AND matching_consent.withdrawn_at = ''
        )
      )
    ORDER BY CASE m.status WHEN 'offered' THEN 0 WHEN 'viewed' THEN 1
      WHEN 'interested' THEN 2 WHEN 'connected' THEN 3 ELSE 4 END,
      m.updated_at DESC, m.id ASC
    LIMIT 100`).bind(user.uid, requestedMatchId, requestedMatchId);
  const projectContextStatement = db.prepare(`SELECT
      m.id project_match_id, p.id customer_project_id, p.firebase_uid customer_uid,
      p.property_context, p.goal customer_goal, p.goals customer_goals,
      p.pace customer_pace, p.postcode customer_postcode,
      p.address_state customer_address_state, p.property_type customer_property_type,
      p.household_situation customer_household_situation,
      p.existing_features customer_existing_features,
      p.service_categories customer_service_categories,
      p.budget_range customer_budget_range, p.advisor_profile customer_advisor_profile,
      p.plan_snapshot customer_plan_snapshot,
      p.completed_plan_items customer_completed_plan_items,
      p.updated_at customer_project_updated_at
    FROM customer_projects p
    JOIN trade_opportunity_matches m ON m.opportunity_id = p.opportunity_id AND m.firebase_uid = ?
      AND (? = '' OR m.id = ?)
    JOIN trade_opportunities o ON o.id = p.opportunity_id
      AND o.source_reference = 'customer-project:' || p.id
    WHERE o.status IN ('open', 'paused')
      AND m.status IN ('offered', 'viewed', 'interested', 'connected')
      AND EXISTS (
        SELECT 1 FROM customer_consent_receipts matching_consent
        WHERE matching_consent.project_id = p.id
          AND matching_consent.firebase_uid = p.firebase_uid
          AND matching_consent.purpose = 'anonymized_installer_matching'
          AND matching_consent.withdrawn_at = ''
      )
    ORDER BY CASE m.status WHEN 'offered' THEN 0 WHEN 'viewed' THEN 1
      WHEN 'interested' THEN 2 WHEN 'connected' THEN 3 ELSE 4 END,
      m.updated_at DESC, m.id ASC
    LIMIT 100`).bind(user.uid, requestedMatchId, requestedMatchId);
  const matchingLocalityStatement = db.prepare(`${boundedLeadMatchesSql}
    SELECT
      authorized_match.match_id locality_match_id,
      receipt.purpose matching_consent_purpose,
      receipt.notice_version matching_notice_version,
      receipt.granted_at matching_granted_at,
      receipt.withdrawn_at matching_withdrawn_at
    FROM authoritative_matches authorized_match
    JOIN trade_opportunities o ON o.id = authorized_match.opportunity_id
    JOIN customer_projects p ON p.opportunity_id = o.id
      AND o.source_reference = 'customer-project:' || p.id
    JOIN customer_consent_receipts receipt ON receipt.project_id = p.id
      AND receipt.firebase_uid = p.firebase_uid
    WHERE receipt.purpose = 'anonymized_installer_matching'
      AND receipt.notice_version = '${CUSTOMER_MATCHING_NOTICE_VERSION}'
      AND receipt.granted_at <> '' AND receipt.withdrawn_at = ''
    ORDER BY receipt.granted_at DESC, receipt.id DESC`).bind(
    user.uid,
    requestedMatchId,
    requestedMatchId,
  );
  const quoteStatement = db.prepare(`${boundedLeadMatchesSql}
    SELECT
      authorized_match.match_id quote_match_id,
      q.id quote_id, q.project_id quote_project_id,
      q.opportunity_id quote_opportunity_id,
      q.opportunity_match_id quote_opportunity_match_id,
      q.installer_uid quote_installer_uid, q.product_list_id,
      q.inclusions quote_inclusions, q.product_snapshot,
      q.product_subtotal_cents_ex_gst, q.labour_cents_ex_gst,
      q.other_cents_ex_gst, q.total_cents_ex_gst, q.quote_type,
      q.start_window, q.duration_weeks, q.workmanship_warranty_years,
      q.status quote_status, q.customer_decision,
      q.submitted_at quote_submitted_at,
      q.submission_revision quote_submission_revision
    FROM authoritative_matches authorized_match
    JOIN customer_project_quotes q
      ON q.opportunity_match_id = authorized_match.match_id
      AND q.installer_uid = authorized_match.installer_uid`).bind(
    user.uid,
    requestedMatchId,
    requestedMatchId,
  );
  const customerContactStatement = db.prepare(`${boundedLeadMatchesSql}
    SELECT
      authorized_match.match_id contact_match_id,
      r.id contact_release_id,
      r.project_id contact_project_id, r.opportunity_id contact_opportunity_id,
      r.opportunity_match_id contact_opportunity_match_id,
      r.quote_id contact_quote_id, r.customer_uid contact_customer_uid,
      r.installer_uid contact_installer_uid, r.status contact_release_status,
      r.notice_version contact_notice_version,
      r.disclosed_fields contact_disclosed_fields,
      r.customer_name, r.customer_email, r.customer_phone,
      r.address_line_1 contact_address_line_1,
      r.address_line_2 contact_address_line_2, r.suburb contact_suburb,
      r.address_state contact_address_state, r.postcode contact_postcode,
      r.granted_at contact_granted_at, r.withdrawn_at contact_withdrawn_at
    FROM authoritative_matches authorized_match
    JOIN customer_project_contact_releases r
      ON r.opportunity_match_id = authorized_match.match_id
      AND r.installer_uid = authorized_match.installer_uid`).bind(
    user.uid,
    requestedMatchId,
    requestedMatchId,
  );
  const arrivalStatement = db.prepare(`${boundedLeadMatchesSql}
    SELECT
      authorized_match.match_id arrival_match_id,
      ap.id arrival_proposal_id,
      ap.project_id arrival_project_id, ap.quote_id arrival_quote_id,
      ap.opportunity_match_id arrival_opportunity_match_id,
      ap.customer_uid arrival_customer_uid, ap.installer_uid arrival_installer_uid,
      ap.status arrival_status, ap.windows arrival_windows,
      ap.installer_note arrival_installer_note,
      ap.selected_window arrival_selected_window,
      ap.crm_work_order_id arrival_crm_work_order_id,
      ap.crm_appointment_id arrival_crm_appointment_id,
      ap.preparation_acknowledged_at arrival_preparation_acknowledged_at,
      ap.revision arrival_revision, ap.proposed_at arrival_proposed_at,
      ap.selected_at arrival_selected_at, ap.withdrawn_at arrival_withdrawn_at
    FROM authoritative_matches authorized_match
    JOIN customer_project_arrival_proposals ap
      ON ap.opportunity_match_id = authorized_match.match_id
      AND ap.installer_uid = authorized_match.installer_uid`).bind(
    user.uid,
    requestedMatchId,
    requestedMatchId,
  );
  const publicLeadContextStatement = db.prepare(`${boundedLeadMatchesSql}
    SELECT
      authorized_match.match_id opportunity_match_id, o.source_reference,
      o.postcode opportunity_postcode, o.state,
      public_contact.id public_contact_release_id,
      public_contact.status public_contact_status,
      public_contact.source_reference public_contact_source_reference,
      public_contact.withdrawn_at public_contact_withdrawn_at,
      public_contact.disclosed_fields public_contact_disclosed_fields,
      public_contact.customer_first_name public_customer_first_name,
      public_contact.customer_last_name public_customer_last_name,
      public_contact.customer_email public_customer_email,
      public_contact.customer_phone public_customer_phone,
      public_contact.customer_unit_number public_customer_unit_number,
      public_contact.customer_street_address public_customer_street_address,
      public_contact.customer_suburb public_customer_suburb,
      public_contact.customer_address_state public_customer_address_state,
      public_contact.postcode public_contact_postcode,
      public_contact.customer_message public_customer_message,
      public_contact.notice_version public_contact_notice_version,
      public_contact.consent_purpose public_contact_consent_purpose,
      public_contact.granted_at public_contact_granted_at,
      public_quote_preparation.id public_quote_preparation_id,
      public_quote_preparation.question_answers public_quote_answers
    FROM authoritative_matches authorized_match
    JOIN trade_opportunities o ON o.id = authorized_match.opportunity_id
    JOIN public_trade_lead_contact_releases public_contact
      ON public_contact.id = (
        SELECT current_release.id
        FROM public_trade_lead_contact_releases current_release
        WHERE current_release.opportunity_id = o.id
          AND current_release.source_reference = o.source_reference
        ORDER BY datetime(current_release.updated_at) DESC,
          datetime(current_release.granted_at) DESC,
          current_release.id DESC
        LIMIT 1
      )
    LEFT JOIN public_trade_lead_quote_preparations public_quote_preparation
      ON public_quote_preparation.opportunity_id = o.id
        AND public_quote_preparation.source_reference = o.source_reference
        AND public_quote_preparation.status = 'active'
        AND public_quote_preparation.notice_version = '${PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION}'
        AND public_quote_preparation.consent_purpose = '${PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE}'
        AND datetime(public_quote_preparation.granted_at) IS NOT NULL
        AND public_quote_preparation.withdrawn_at = ''
        AND public_contact.notice_version = '${PUBLIC_PLAN_CONSENT_NOTICE_VERSION}'
        AND public_contact.consent_purpose = '${PUBLIC_PLAN_CONSENT_PURPOSE}'
    ORDER BY public_contact.granted_at DESC, public_contact.id DESC`).bind(
    user.uid,
    requestedMatchId,
    requestedMatchId,
  );
  const evidenceStatement = db.prepare(`${boundedLeadMatchesSql}
    SELECT e.id, e.project_id, e.category, e.content_type,
      e.size_bytes, e.created_at, e.fact_keys, e.sharing_scope,
      authorized_match.match_id opportunity_match_id
    FROM authoritative_matches authorized_match
    JOIN customer_projects p
      ON p.opportunity_id = authorized_match.opportunity_id
      AND authorized_match.source_reference = 'customer-project:' || p.id
    JOIN customer_project_evidence e ON e.project_id = p.id AND e.customer_uid = p.firebase_uid
    WHERE e.status = 'active' AND e.sharing_scope = 'allocated-installers'
      AND EXISTS (
        SELECT 1 FROM customer_consent_receipts consent
        WHERE consent.project_id = p.id AND consent.firebase_uid = p.firebase_uid
          AND consent.purpose = 'installer_evidence_sharing' AND consent.withdrawn_at = ''
      )
    ORDER BY e.created_at DESC`).bind(user.uid, requestedMatchId, requestedMatchId);
  const publicPhotoStatement = db.prepare(`${boundedLeadMatchesSql}
    SELECT photo.id, photo.prompt_id,
      photo.prompt_label, photo.service_categories, photo.content_type,
      photo.size_bytes, photo.created_at,
      authorized_match.match_id opportunity_match_id,
      authorized_match.matched_categories
    FROM authoritative_matches authorized_match
    JOIN public_trade_lead_quote_photos photo
      ON photo.opportunity_id = authorized_match.opportunity_id
    JOIN public_trade_lead_quote_preparations preparation
      ON preparation.opportunity_id = photo.opportunity_id
      AND preparation.status = 'active'
      AND preparation.notice_version = '${PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION}'
      AND preparation.consent_purpose = '${PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE}'
      AND datetime(preparation.granted_at) IS NOT NULL
      AND preparation.withdrawn_at = ''
    JOIN public_trade_lead_contact_releases contact
      ON contact.id = (
        SELECT current_release.id
        FROM public_trade_lead_contact_releases current_release
        WHERE current_release.opportunity_id = authorized_match.opportunity_id
          AND current_release.source_reference = authorized_match.source_reference
        ORDER BY datetime(current_release.updated_at) DESC,
          datetime(current_release.granted_at) DESC,
          current_release.id DESC
        LIMIT 1
      )
      AND preparation.source_reference = authorized_match.source_reference
      AND contact.status = 'active'
      AND contact.notice_version = '${PUBLIC_PLAN_CONSENT_NOTICE_VERSION}'
      AND contact.consent_purpose = '${PUBLIC_PLAN_CONSENT_PURPOSE}'
      AND datetime(contact.granted_at) IS NOT NULL
      AND contact.withdrawn_at = ''
    WHERE photo.status = 'active'
    ORDER BY photo.created_at DESC`).bind(user.uid, requestedMatchId, requestedMatchId);
  const [
    rows,
    projectRows,
    localityRows,
    quoteRows,
    customerContactRows,
    arrivalRows,
    publicLeadContextRows,
    evidenceRows,
    publicPhotoRows,
  ] = await db.batch<Record<string, unknown>>([
    baseLeadStatement,
    projectContextStatement,
    matchingLocalityStatement,
    quoteStatement,
    customerContactStatement,
    arrivalStatement,
    publicLeadContextStatement,
    evidenceStatement,
    publicPhotoStatement,
  ]);
  const projectByMatch = new Map<string, Record<string, unknown>>();
  for (const item of projectRows.results) {
    const matchId = String(item.project_match_id || "");
    if (matchId && !projectByMatch.has(matchId)) projectByMatch.set(matchId, item);
  }
  const localityByMatch = new Map<string, Record<string, unknown>>();
  for (const item of localityRows.results) {
    const matchId = String(item.locality_match_id || "");
    if (matchId && !localityByMatch.has(matchId)) localityByMatch.set(matchId, item);
  }
  const quoteByMatch = new Map<string, Record<string, unknown>>();
  for (const item of quoteRows.results) {
    const matchId = String(item.quote_match_id || "");
    if (matchId && !quoteByMatch.has(matchId)) quoteByMatch.set(matchId, item);
  }
  const customerContactByMatch = new Map<string, Record<string, unknown>>();
  for (const item of customerContactRows.results) {
    const matchId = String(item.contact_match_id || "");
    if (matchId && !customerContactByMatch.has(matchId)) customerContactByMatch.set(matchId, item);
  }
  const arrivalByMatch = new Map<string, Record<string, unknown>>();
  for (const item of arrivalRows.results) {
    const matchId = String(item.arrival_match_id || "");
    if (matchId && !arrivalByMatch.has(matchId)) arrivalByMatch.set(matchId, item);
  }
  const publicReleaseMatches = new Set<string>();
  const publicLeadContextByMatch = new Map<string, Record<string, unknown>>();
  const publicContactByMatch = new Map<string, NonNullable<ReturnType<typeof publicTradeContactForMatchedLead>>>();
  for (const item of publicLeadContextRows.results) {
    const matchId = String(item.opportunity_match_id || "");
    if (!matchId || publicReleaseMatches.has(matchId)) continue;
    publicReleaseMatches.add(matchId);
    const contact = publicTradeContactForMatchedLead(item);
    if (!contact) continue;
    publicLeadContextByMatch.set(matchId, item);
    publicContactByMatch.set(matchId, contact);
  }
  const evidenceByMatch = new Map<string, Array<Record<string, unknown>>>();
  for (const item of evidenceRows.results) {
    const matchId = String(item.opportunity_match_id || "");
    if (!matchId) continue;
    const current = evidenceByMatch.get(matchId) || [];
    current.push(item);
    evidenceByMatch.set(matchId, current);
  }
  const publicPhotosByMatch = new Map<string, Array<Record<string, unknown>>>();
  for (const item of publicPhotoRows.results) {
    const matchId = String(item.opportunity_match_id || "");
    const visibleCategories = publicPlanQuoteCategoryIntersection(
      item.service_categories,
      item.matched_categories,
    );
    if (!matchId || !visibleCategories.length) continue;
    const current = publicPhotosByMatch.get(matchId) || [];
    current.push({ ...item, service_categories: visibleCategories });
    publicPhotosByMatch.set(matchId, current);
  }
  return json({
    ok: true,
    opportunities: rows.results.flatMap((baseRow: Record<string, unknown>) => {
      const matchId = String(baseRow.match_id || "");
      const publicLeadContext = publicLeadContextByMatch.get(matchId);
      if (publicReleaseMatches.has(matchId) && !publicLeadContext) return [];
      const publicContact = publicContactByMatch.get(matchId) || null;
      const platformOnly = String(baseRow.source_reference || "")
        .startsWith("customer-project:");
      const projectContext = projectByMatch.get(matchId) || null;
      if (platformOnly && !customerProjectContextMatchesBase(baseRow, projectContext)) return [];
      const quoteContext = platformQuoteForMatchedLead(
        baseRow,
        projectContext,
        quoteByMatch.get(matchId),
      );
      const customerContact = customerProjectContactForMatchedLead(
        baseRow,
        projectContext,
        quoteContext,
        customerContactByMatch.get(matchId),
      );
      const arrivalContext = arrivalProposalForMatchedLead(
        baseRow,
        projectContext,
        quoteContext,
        arrivalByMatch.get(matchId),
      );
      const row = {
        ...baseRow,
        ...(projectContext || {}),
        ...(localityByMatch.get(matchId) || {}),
        ...(quoteContext || {}),
        ...(customerContact ? customerContactByMatch.get(matchId) : {}),
        ...(arrivalContext || {}),
      };
      const sharedEvidence = evidenceByMatch.get(matchId) || [];
      const publicPhotos = publicPhotosByMatch.get(matchId) || [];
      const matchedCategories = strictPublicPlanQuoteServiceCategories(row.matched_categories);
      const quoteAnswers = publicPlanQuoteAnswersForMatchedCategories(
        publicLeadContext?.public_quote_answers,
        matchedCategories,
      );
      const matchingLocality = matchingLocalityDisclosure({
        suburb: row.opportunity_suburb,
        postcode: row.opportunity_postcode,
        state: row.state,
      }, {
        purpose: row.matching_consent_purpose,
        noticeVersion: row.matching_notice_version,
        grantedAt: row.matching_granted_at,
        withdrawnAt: row.matching_withdrawn_at,
      });
      const evidence = sharedEvidence.map((item: Record<string, unknown>) => ({
        id: String(item.id || ""),
        category: String(item.category || ""),
        fileName: installerEvidenceName(item),
        contentType: String(item.content_type || ""),
        sizeBytes: Number(item.size_bytes || 0),
        createdAt: String(item.created_at || ""),
        sharingScope: "allocated-installers",
        promptLabel: "",
        downloadHref: `/api/customer-project-evidence?download=${encodeURIComponent(String(item.id || ""))}`,
      })).concat(publicPhotos.map((item: Record<string, unknown>) => ({
        id: String(item.id || ""),
        category: "quote-photo",
        fileName: "customer-quote-photo",
        contentType: String(item.content_type || ""),
        sizeBytes: Number(item.size_bytes || 0),
        createdAt: String(item.created_at || ""),
        sharingScope: "allocated-installers",
        promptLabel: String(item.prompt_label || ""),
        downloadHref: `/api/public-plan-quote-preparation?download=${encodeURIComponent(String(item.id || ""))}`,
      })));
      return [{
        matchId: row.match_id,
        matchStatus: row.match_status,
        matchedCategories,
        distanceBand: distanceBand(row.distance_metres),
        allocationRank: Number(row.allocation_rank || 0),
        contactAttemptCount: Number(row.contact_attempt_count || 0),
        contactLimit: Number(row.contact_limit || 2),
        lastContactAt: row.last_contact_at,
        connectedAt: row.connected_at,
        expiresAt: row.expires_at,
        matchedAt: row.matched_at,
        updatedAt: row.updated_at,
        id: row.id,
        title: row.title,
        projectType: row.project_type,
        suburb: matchingLocality.suburb,
        postcode: matchingLocality.postcode,
        state: matchingLocality.state,
        serviceCategories: parseJsonList(row.service_categories),
        priority: row.priority,
        timing: row.timing,
        summary: row.summary,
        propertyContext: buildInstallerPropertyContext(
          parseStoredJson(row.property_context, {}),
        ),
        enquiryPack: platformOnly
          ? installerEnquiryPack(row, sharedEvidence)
          : null,
        quotePreparation: publicLeadContext?.public_quote_preparation_id
          && (quoteAnswers.length || publicPhotos.length) ? {
          answers: quoteAnswers,
          expectedPhotoCount: publicPhotos.length,
          availablePhotoCount: publicPhotos.length,
        } : null,
        approvedSharedFileCount: evidence.length,
        opportunityStatus: row.status,
        platformOnly,
        customerContact: row.contact_release_id ? customerContact : publicContact,
        evidence,
        arrivalProposal: row.arrival_proposal_id ? {
          id: row.arrival_proposal_id,
          status: row.arrival_status,
          windows: parseArrivalWindows(row.arrival_windows),
          installerNote: row.arrival_installer_note,
          selectedWindow: parseStoredJson(row.arrival_selected_window, null),
          crmWorkOrderId: row.arrival_crm_work_order_id,
          crmAppointmentId: row.arrival_crm_appointment_id,
          preparationAcknowledgedAt: row.arrival_preparation_acknowledged_at,
          revision: Number(row.arrival_revision || 1),
          proposedAt: row.arrival_proposed_at,
          selectedAt: row.arrival_selected_at,
        } : null,
        quote: platformQuoteResponse(row),
      }];
    }),
  });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  let access: Awaited<ReturnType<typeof requireVerifiedTradeAccess>>;
  try {
    access = await requireVerifiedTradeAccess(request, { partnerTypes: ["installer"] });
  } catch (error) {
    const code = tradeAccessCode(error);
    if (code === "AUTH_REQUIRED") return json({ ok: false, error: "Sign in to continue." }, 401);
    if (code === "TRADE_ROLE_REQUIRED") return json({ ok: false, error: "Wholesalers cannot access or respond to household opportunities." }, 403);
    if (code === "PROFILE_REQUIRED" || code === "ACCOUNT_INACTIVE") {
      return json({ ok: false, error: "An active installer account is required." }, 403);
    }
    return json({ ok: false, error: "Complete trade verification before responding to marketplace opportunities." }, 403);
  }
  const user = access.identity;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid opportunity response." }, 400);
  }
  const matchId =
    typeof body.matchId === "string" ? body.matchId.trim().slice(0, 180) : "";
  const action = typeof body.action === "string" ? body.action : "respond";
  const status = typeof body.status === "string" ? body.status : "";
  if (!matchId)
    return json({ ok: false, error: "Choose a valid opportunity." }, 400);
  const db = getD1();
  const account = { business_name: access.businessName };
  if (!await accountHasFeature(user.uid, "installer", "installer_leads"))
    return json(
      { ok: false, error: "Complete trade verification before responding to marketplace opportunities." },
      403,
    );
  await expireStaleOpportunities();
  const now = new Date().toISOString();
  if (action === "record_contact") {
    return json({ ok: false, error: "Contact attempts cannot be self-recorded. Customer details appear only after that customer releases them to this exact match." }, 409);
  }
  if (action === "propose_arrival_windows") {
    const source = await db.prepare(`SELECT q.id quote_id, q.project_id, q.customer_decision,
      p.firebase_uid customer_uid, p.address_state, m.opportunity_id, m.status match_status, o.status opportunity_status,
      r.status contact_release_status, ap.id proposal_id, ap.status proposal_status, ap.revision proposal_revision
      FROM trade_opportunity_matches m
      JOIN trade_opportunities o ON o.id = m.opportunity_id
      JOIN customer_project_quotes q ON q.opportunity_match_id = m.id AND q.installer_uid = m.firebase_uid
      JOIN customer_projects p ON p.id = q.project_id AND p.opportunity_id = m.opportunity_id
      JOIN customer_project_contact_releases r ON r.opportunity_match_id = m.id
        AND r.customer_uid = p.firebase_uid AND r.installer_uid = m.firebase_uid AND r.status = 'active'
      LEFT JOIN customer_project_arrival_proposals ap ON ap.opportunity_match_id = m.id
      WHERE m.id = ? AND m.firebase_uid = ? AND q.status = 'submitted'`)
      .bind(matchId, user.uid).first<Record<string, unknown>>();
    if (!source) return json({ ok: false, error: "This accepted customer project is not available." }, 404);
    if (source.customer_decision !== "accepted" || source.match_status !== "connected"
      || !["open", "paused"].includes(String(source.opportunity_status)) || source.contact_release_status !== "active") {
      return json({ ok: false, error: "The customer must accept this installer before arrival windows can be proposed." }, 409);
    }
    if (["selected", "direct_contact"].includes(String(source.proposal_status))) {
      return json({ ok: false, error: "The customer already chose an arrival pathway. Use the reviewed workflow for later changes." }, 409);
    }
    const currentRevision = Number(source.proposal_revision || 0);
    if (source.proposal_id && Number(body.expectedRevision) !== currentRevision) {
      return json({ ok: false, error: "These arrival windows changed. Refresh before updating them." }, 409);
    }
    const nextRevision = currentRevision + 1;
    let windows;
    try { windows = normaliseArrivalWindows(body.windows, nextRevision, "", String(source.address_state || "NSW")); }
    catch { return json({ ok: false, error: "Add one to three future arrival windows between 30 minutes and four hours." }, 400); }
    const installerNote = typeof body.installerNote === "string" ? body.installerNote.trim().replace(/\s+/g, " ").slice(0, 300) : "";
    const proposalId = String(source.proposal_id || crypto.randomUUID());
    const windowsJson = JSON.stringify(windows);
    await db.batch([
      db.prepare(`INSERT INTO customer_project_arrival_proposals
        (id, project_id, quote_id, opportunity_match_id, customer_uid, installer_uid, status, windows,
         installer_note, selected_window, revision, proposed_at, selected_at, withdrawn_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, '{}', ?, ?, '', '', ?, ?)
        ON CONFLICT(opportunity_match_id) DO UPDATE SET status = 'proposed', windows = excluded.windows,
          installer_note = excluded.installer_note, selected_window = '{}', revision = excluded.revision,
          proposed_at = excluded.proposed_at, selected_at = '', withdrawn_at = '', updated_at = excluded.updated_at`)
        .bind(proposalId, source.project_id, source.quote_id, matchId, source.customer_uid, user.uid,
          windowsJson, installerNote, nextRevision, now, now, now),
      db.prepare(`INSERT INTO customer_project_arrival_events
        (id, proposal_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
         actor_uid, event_type, proposal_revision, windows, selected_window, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'installer', ?, 'proposed', ?, ?, '{}', ?)`)
        .bind(crypto.randomUUID(), proposalId, source.project_id, matchId, source.customer_uid, user.uid,
          user.uid, nextRevision, windowsJson, now),
      adminNotificationStatement(db, {
        eventKey: `installer-arrival-proposed:${proposalId}:${nextRevision}`,
        eventType: "installer.arrival_windows_proposed",
        category: "response",
        priority: "high",
        title: "Installer proposed customer arrival windows",
        summary: `${String(account.business_name || "An installer").slice(0, 160)} proposed arrival windows for an accepted customer project.`,
        entityType: "customer_project_arrival_proposal",
        entityId: proposalId,
        actorType: "installer",
        actorUid: user.uid,
        requiresAction: true,
        metadata: { projectId: source.project_id, matchId, revision: nextRevision },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
    return json({ ok: true, proposal: { id: proposalId, status: "proposed", windows,
      installerNote, selectedWindow: null, revision: nextRevision, proposedAt: now, selectedAt: "" } });
  }
  if (action === "submit_quote") {
    const normalized = normalizePlatformQuote(body);
    if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
    const quote = normalized.quote;
    if (!quote) return json({ ok: false, error: "Invalid structured quote option." }, 400);
    const submissionRequestId = String(body.submissionRequestId || "").trim();
    if (!UUID_PATTERN.test(submissionRequestId)) {
      return json({ ok: false, error: "Start a fresh quote submission and try again." }, 400);
    }
    const expectedSubmissionRevision = Number(body.expectedSubmissionRevision);
    if (
      !Number.isInteger(expectedSubmissionRevision)
      || expectedSubmissionRevision < 0
      || expectedSubmissionRevision > 1_000_000
    ) {
      return json({ ok: false, error: "Refresh the quote before submitting this change." }, 400);
    }
    const match = await db.prepare(`SELECT m.opportunity_id, m.status, o.source_reference, o.status opportunity_status,
      p.id project_id, p.firebase_uid customer_uid
      FROM trade_opportunity_matches m
      JOIN trade_opportunities o ON o.id = m.opportunity_id
      JOIN customer_projects p ON p.opportunity_id = o.id
      WHERE m.id = ? AND m.firebase_uid = ?`).bind(matchId, user.uid).first<Record<string, unknown>>();
    if (!match) return json({ ok: false, error: "This platform project is not available." }, 404);
    if (!String(match.source_reference || "").startsWith("customer-project:") || match.opportunity_status !== "open") {
      return json({ ok: false, error: "Structured quotes are available only for active customer projects." }, 409);
    }
    if (!['interested', 'connected'].includes(String(match.status))) {
      return json({ ok: false, error: "Record your interest before preparing a quote option." }, 409);
    }
    const [replay, currentQuote] = await Promise.all([
      db.prepare(`SELECT submission_revision, quote_snapshot
        FROM customer_project_quote_submissions
        WHERE installer_uid = ? AND opportunity_match_id = ? AND submission_request_id = ?
        LIMIT 1`)
        .bind(user.uid, matchId, submissionRequestId)
        .first<Record<string, unknown>>(),
      authoritativePlatformQuote(db, matchId, user.uid),
    ]);
    if (replay) {
      return json({
        ok: true,
        replayed: true,
        requestRevision: Number(replay.submission_revision || 0),
        quote: currentQuote || parseStoredJson(replay.quote_snapshot, null),
      });
    }
    if (currentQuote?.customerDecision === "accepted") {
      return json({ ok: false, error: "This option is locked after the customer chose to get in touch. Use the reviewed customer change workflow for later scope changes." }, 409);
    }
    const currentSubmissionRevision = currentQuote?.submissionRevision || 0;
    if (currentSubmissionRevision !== expectedSubmissionRevision) {
      return json({
        ok: false,
        code: "QUOTE_REVISION_CHANGED",
        error: "This quote changed in another tab. The latest saved version is shown.",
        quote: currentQuote,
      }, 409);
    }
    let snapshot;
    try {
      snapshot = await productSnapshot(user.uid, quote.productListId);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return json({ ok: false, error: code === "PRODUCT_LIST_REQUIRED"
        ? "Choose one of your saved product lists."
        : "Every quoted product must still be approved and supplied by a verified wholesaler." }, 409);
    }
    const totalCentsExGst = snapshot.subtotalCentsExGst + quote.labourCentsExGst + quote.otherCentsExGst;
    if (totalCentsExGst <= 0) return json({ ok: false, error: "Add a product, labour or service amount." }, 400);
    const quoteId = String(
      currentQuote?.id
      || await customerProjectQuoteId(matchId, user.uid),
    );
    const submissionRevision = expectedSubmissionRevision + 1;
    const submittedQuote = {
      id: quoteId,
      productListId: quote.productListId,
      inclusions: quote.inclusions,
      products: snapshot.products,
      productSubtotalCentsExGst: snapshot.subtotalCentsExGst,
      labourCentsExGst: quote.labourCentsExGst,
      otherCentsExGst: quote.otherCentsExGst,
      totalCentsExGst,
      quoteType: quote.quoteType,
      startWindow: quote.startWindow,
      durationWeeks: quote.durationWeeks,
      workmanshipWarrantyYears: quote.workmanshipWarrantyYears,
      status: "submitted",
      customerDecision: "reviewing",
      submittedAt: now,
      submissionRevision,
    };
    const activity = await customerProjectActivityStatements(db, {
      eventKey: `platform-quote-submitted:${matchId}:${submissionRequestId}`,
      projectId: String(match.project_id),
      quoteId,
      opportunityMatchId: matchId,
      customerUid: String(match.customer_uid),
      installerUid: user.uid,
      eventType: "installer_quote_submitted",
      audience: "customer",
      actorType: "installer",
      actorUid: user.uid,
      occurredAt: now,
    });
    try {
      const mutationResults = await db.batch([
        db.prepare(`INSERT INTO customer_project_quotes
          (id, project_id, opportunity_id, opportunity_match_id, installer_uid,
           submission_request_id, submission_revision, product_list_id, inclusions,
           product_snapshot, product_subtotal_cents_ex_gst, labour_cents_ex_gst, other_cents_ex_gst,
           total_cents_ex_gst, quote_type, start_window, duration_weeks, workmanship_warranty_years,
           status, customer_decision, submitted_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'reviewing', ?, ?)
          ON CONFLICT(opportunity_match_id) DO UPDATE SET
            submission_request_id = excluded.submission_request_id,
            submission_revision = excluded.submission_revision,
            product_list_id = excluded.product_list_id,
            inclusions = excluded.inclusions, product_snapshot = excluded.product_snapshot,
            product_subtotal_cents_ex_gst = excluded.product_subtotal_cents_ex_gst,
            labour_cents_ex_gst = excluded.labour_cents_ex_gst, other_cents_ex_gst = excluded.other_cents_ex_gst,
            total_cents_ex_gst = excluded.total_cents_ex_gst, quote_type = excluded.quote_type,
            start_window = excluded.start_window, duration_weeks = excluded.duration_weeks,
            workmanship_warranty_years = excluded.workmanship_warranty_years, status = 'submitted',
            customer_decision = 'reviewing', submitted_at = excluded.submitted_at, updated_at = excluded.updated_at
          WHERE customer_project_quotes.installer_uid = excluded.installer_uid
            AND customer_project_quotes.submission_revision = ?
            AND customer_project_quotes.customer_decision != 'accepted'`)
          .bind(quoteId, match.project_id, match.opportunity_id, matchId, user.uid,
            submissionRequestId, submissionRevision, quote.productListId,
            JSON.stringify(quote.inclusions), JSON.stringify(snapshot.products), snapshot.subtotalCentsExGst,
            quote.labourCentsExGst, quote.otherCentsExGst, totalCentsExGst,
            quote.quoteType, quote.startWindow, quote.durationWeeks,
            quote.workmanshipWarrantyYears, now, now, expectedSubmissionRevision),
        db.prepare(`INSERT INTO customer_project_quote_submissions
          (id, opportunity_match_id, installer_uid, submission_request_id, quote_id,
           submission_revision, quote_snapshot, submitted_at, created_at)
          VALUES (?, ?, ?, ?, ?, COALESCE((
            SELECT submission_revision FROM customer_project_quotes
            WHERE opportunity_match_id = ? AND installer_uid = ?
              AND submission_request_id = ? AND submission_revision = ?
          ), 0), ?, ?, ?)`)
          .bind(crypto.randomUUID(), matchId, user.uid, submissionRequestId, quoteId,
            matchId, user.uid, submissionRequestId, submissionRevision,
            JSON.stringify(submittedQuote), now, now),
        db.prepare("UPDATE customer_projects SET status = 'quote_review', updated_at = ? WHERE id = ? AND status = 'matching'")
          .bind(now, match.project_id),
        adminNotificationStatement(db, {
          eventKey: `installer-quote:${matchId}:${submissionRequestId}`,
          eventType: "installer.quote_submitted",
          category: "response",
          priority: "high",
          title: "Installer submitted a quote option",
          summary: `${String(account.business_name || "An installer").slice(0, 160)} submitted a structured platform quote for a customer enquiry.`,
          entityType: "customer_project_quote",
          entityId: quoteId,
          actorType: "installer",
          actorUid: user.uid,
          requiresAction: true,
          metadata: { matchId, opportunityId: match.opportunity_id, projectId: match.project_id, totalCentsExGst, submissionRevision },
          occurredAt: now,
        }),
        ...activity.statements,
      ]);
      if (Number(mutationResults[0]?.meta.changes || 0) !== 1) {
        throw new Error("QUOTE_REVISION_CHANGED");
      }
    } catch {
      const [recordedReplay, latestQuote] = await Promise.all([
        db.prepare(`SELECT submission_revision, quote_snapshot
          FROM customer_project_quote_submissions
          WHERE installer_uid = ? AND opportunity_match_id = ? AND submission_request_id = ?
          LIMIT 1`)
          .bind(user.uid, matchId, submissionRequestId)
          .first<Record<string, unknown>>(),
        authoritativePlatformQuote(db, matchId, user.uid),
      ]);
      if (recordedReplay) {
        return json({
          ok: true,
          replayed: true,
          requestRevision: Number(recordedReplay.submission_revision || 0),
          quote: latestQuote || parseStoredJson(recordedReplay.quote_snapshot, null),
        });
      }
      if (
        latestQuote
        && (
          latestQuote.submissionRevision !== expectedSubmissionRevision
          || latestQuote.customerDecision === "accepted"
        )
      ) {
        return json({
          ok: false,
          code: "QUOTE_REVISION_CHANGED",
          error: "This quote changed in another tab. The latest saved version is shown.",
          quote: latestQuote,
        }, 409);
      }
      return json({ ok: false, error: "The quote option could not be submitted." }, 500);
    }
    return activityDispatchJson({
      ok: true,
      quote: submittedQuote,
    }, activity.deliveryId);
  }
  if (action === "withdraw_quote") {
    const result = await db.prepare(`UPDATE customer_project_quotes SET status = 'withdrawn', customer_decision = 'reviewing', updated_at = ?
      WHERE opportunity_match_id = ? AND installer_uid = ? AND status = 'submitted' AND customer_decision != 'accepted'`).bind(now, matchId, user.uid).run();
    if (!result.meta.changes) return json({ ok: false, error: "No active quote option was found." }, 404);
    await createAdminNotification({
      eventKey: `installer-quote-withdrawn:${matchId}:${now}`,
      eventType: "installer.quote_withdrawn",
      category: "response",
      priority: "normal",
      title: "Installer withdrew a quote option",
      summary: `${String(account.business_name || "An installer").slice(0, 160)} withdrew a structured quote from a customer enquiry.`,
      entityType: "trade_opportunity_match",
      entityId: matchId,
      actorType: "installer",
      actorUid: user.uid,
      requiresAction: false,
      occurredAt: now,
    });
    return json({ ok: true });
  }
  if (!PARTNER_STATUSES.has(status))
    return json(
      { ok: false, error: "Choose a valid opportunity response." },
      400,
    );
  const current = await db.prepare(`SELECT m.status, m.opportunity_id, o.title, o.source_reference
    FROM trade_opportunity_matches m
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    WHERE m.id = ? AND m.firebase_uid = ?
      AND o.status = 'open' AND o.expires_at > ?`)
    .bind(matchId, user.uid, now).first<Record<string, unknown>>();
  if (!current) return json({ ok: false, error: "The opportunity could not be updated." }, 404);
  const currentPublicContact = await db.prepare(`SELECT
      public_contact.id public_contact_release_id,
      public_contact.status public_contact_status,
      public_contact.source_reference public_contact_source_reference,
      public_contact.withdrawn_at public_contact_withdrawn_at,
      public_contact.disclosed_fields public_contact_disclosed_fields,
      public_contact.customer_first_name public_customer_first_name,
      public_contact.customer_last_name public_customer_last_name,
      public_contact.customer_email public_customer_email,
      public_contact.customer_phone public_customer_phone,
      public_contact.customer_unit_number public_customer_unit_number,
      public_contact.customer_street_address public_customer_street_address,
      public_contact.customer_suburb public_customer_suburb,
      public_contact.customer_address_state public_customer_address_state,
      public_contact.postcode public_contact_postcode,
      public_contact.customer_message public_customer_message,
      public_contact.notice_version public_contact_notice_version,
      public_contact.consent_purpose public_contact_consent_purpose,
      public_contact.granted_at public_contact_granted_at,
      public_contact.updated_at public_contact_updated_at,
      o.source_reference, o.postcode opportunity_postcode, o.state
    FROM trade_opportunity_matches m
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    JOIN public_trade_lead_contact_releases public_contact
      ON public_contact.id = (
        SELECT current_release.id
        FROM public_trade_lead_contact_releases current_release
        WHERE current_release.opportunity_id = o.id
          AND current_release.source_reference = o.source_reference
        ORDER BY datetime(current_release.updated_at) DESC,
          datetime(current_release.granted_at) DESC,
          current_release.id DESC
        LIMIT 1
      )
    WHERE m.id = ? AND m.firebase_uid = ?
    ORDER BY public_contact.granted_at DESC, public_contact.id DESC
    LIMIT 1`)
    .bind(matchId, user.uid).first<Record<string, unknown>>();
  if (currentPublicContact && !publicTradeContactForMatchedLead(currentPublicContact)) {
    return json({ ok: false, error: "The opportunity could not be updated." }, 404);
  }
  const projectSourceReference = String(current.source_reference || "");
  const isCustomerProject = projectSourceReference.startsWith("customer-project:");
  const currentProjectConsent = isCustomerProject
    ? await db.prepare(`SELECT p.id customer_project_id, p.firebase_uid customer_uid
        FROM customer_projects p
        WHERE p.opportunity_id = ? AND ? = 'customer-project:' || p.id
          AND EXISTS (
            SELECT 1 FROM customer_consent_receipts current_matching_consent
            WHERE current_matching_consent.project_id = p.id
              AND current_matching_consent.firebase_uid = p.firebase_uid
              AND current_matching_consent.purpose = 'anonymized_installer_matching'
              AND current_matching_consent.withdrawn_at = ''
          )
        LIMIT 1`)
      .bind(current.opportunity_id, projectSourceReference)
      .first<Record<string, unknown>>()
    : null;
  if (isCustomerProject && (!currentProjectConsent || currentPublicContact)) {
    return json({ ok: false, error: "The opportunity could not be updated." }, 404);
  }
  const transitions: Record<string, Set<string>> = {
    offered: new Set(["viewed", "interested", "declined"]),
    viewed: new Set(["interested", "declined"]),
    interested: new Set(["declined"]),
  };
  const currentStatus = String(current.status || "");
  if (status === "interested" && currentPublicContact) {
    if (currentStatus !== status && !transitions[currentStatus]?.has(status)) {
      return json({ ok: false, error: "This opportunity response cannot be reversed." }, 409);
    }
    try {
      await syncMarketplaceEnquiries(db, String(current.opportunity_id || ""), user.uid);
      const quoteWorkflow = await startPublicLeadQuoteWorkflow(
        db, user.uid, matchId, now, currentStatus,
      );
      try {
        await createAdminNotification({
          eventKey: `installer-response:${matchId}:interested`,
          eventType: "installer.lead_interested", category: "response", priority: "high",
          title: "Installer is interested in a lead",
          summary: `${String(account.business_name || "An installer").slice(0, 160)} marked ${String(current.title || "").slice(0, 160)} as interested.`,
          entityType: "trade_opportunity_match", entityId: matchId, actorType: "installer",
          actorUid: user.uid, requiresAction: true,
          metadata: { opportunityId: String(current.opportunity_id || ""), status: "interested" },
          occurredAt: now,
        });
      } catch (error) {
        console.error("Public lead interest notification failed after handoff", {
          code: error instanceof Error ? error.message : "ADMIN_NOTIFICATION_FAILED",
          matchId, installerUid: user.uid,
        });
      }
      return json({ ok: true, quoteWorkflow, warning: "" });
    } catch (error) {
      console.error("Public lead interest handoff failed", {
        code: error instanceof Error ? error.message : "PUBLIC_LEAD_QUOTE_WORKFLOW_FAILED",
        matchId, installerUid: user.uid,
      });
      return json({ ok: false, error: "The job and customer files could not be prepared. No interest was recorded. Try again." }, 409);
    }
  }
  if (currentStatus === status) {
    return json({ ok: true });
  }
  if (!transitions[currentStatus]?.has(status)) return json({ ok: false, error: "This opportunity response cannot be reversed." }, 409);
  const result = currentPublicContact
    ? await db.prepare(`UPDATE trade_opportunity_matches
        SET status = ?, partner_note = '', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = ? AND opportunity_id = ?
          AND EXISTS (
            SELECT 1 FROM trade_opportunities available_opportunity
            JOIN public_trade_lead_contact_releases active_public_contact
              ON active_public_contact.opportunity_id = available_opportunity.id
            WHERE available_opportunity.id = ?
              AND available_opportunity.status = 'open'
              AND available_opportunity.expires_at > ?
              AND available_opportunity.source_reference = ?
              AND available_opportunity.postcode = ?
              AND available_opportunity.state = ?
              AND active_public_contact.id = ?
              AND active_public_contact.source_reference = available_opportunity.source_reference
              AND active_public_contact.status = 'active'
              AND active_public_contact.withdrawn_at = ''
              AND active_public_contact.postcode = available_opportunity.postcode
              AND active_public_contact.disclosed_fields = ?
              AND active_public_contact.updated_at = ?
          )`)
      .bind(
        status,
        now,
        matchId,
        user.uid,
        currentStatus,
        current.opportunity_id,
        current.opportunity_id,
        now,
        currentPublicContact.source_reference,
        currentPublicContact.opportunity_postcode,
        currentPublicContact.state,
        currentPublicContact.public_contact_release_id,
        currentPublicContact.public_contact_disclosed_fields,
        currentPublicContact.public_contact_updated_at,
      )
      .run()
    : currentProjectConsent
      ? await db.prepare(`UPDATE trade_opportunity_matches
          SET status = ?, partner_note = '', updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status = ? AND opportunity_id = ?
            AND EXISTS (
              SELECT 1 FROM trade_opportunities available_opportunity
              JOIN customer_projects current_project
                ON current_project.opportunity_id = available_opportunity.id
              JOIN customer_consent_receipts current_matching_consent
                ON current_matching_consent.project_id = current_project.id
                AND current_matching_consent.firebase_uid = current_project.firebase_uid
              WHERE available_opportunity.id = ?
                AND available_opportunity.status = 'open'
                AND available_opportunity.expires_at > ?
                AND available_opportunity.source_reference = ?
                AND current_project.id = ?
                AND current_project.firebase_uid = ?
                AND current_matching_consent.purpose = 'anonymized_installer_matching'
                AND current_matching_consent.withdrawn_at = ''
            )
            AND NOT EXISTS (
              SELECT 1 FROM public_trade_lead_contact_releases any_public_contact
              WHERE any_public_contact.opportunity_id = ?
            )`)
        .bind(
          status,
          now,
          matchId,
          user.uid,
          currentStatus,
          current.opportunity_id,
          current.opportunity_id,
          now,
          projectSourceReference,
          currentProjectConsent.customer_project_id,
          currentProjectConsent.customer_uid,
          current.opportunity_id,
        )
        .run()
      : await db.prepare(`UPDATE trade_opportunity_matches
        SET status = ?, partner_note = '', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = ? AND opportunity_id = ?
          AND EXISTS (
            SELECT 1 FROM trade_opportunities available_opportunity
            WHERE available_opportunity.id = ?
              AND available_opportunity.status = 'open'
              AND available_opportunity.expires_at > ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM public_trade_lead_contact_releases any_public_contact
            WHERE any_public_contact.opportunity_id = ?
          )`)
      .bind(
        status,
        now,
        matchId,
        user.uid,
        currentStatus,
        current.opportunity_id,
        current.opportunity_id,
        now,
        current.opportunity_id,
      )
      .run();
  if (!result.meta.changes) {
    const raced = await db.prepare(`SELECT status FROM trade_opportunity_matches
      WHERE id = ? AND firebase_uid = ? AND opportunity_id = ? LIMIT 1`)
      .bind(matchId, user.uid, current.opportunity_id)
      .first<Record<string, unknown>>();
    if (String(raced?.status || "") === status) {
      if (status === "interested" && currentPublicContact) {
        await syncMarketplaceEnquiries(db, String(current.opportunity_id || ""), user.uid);
        const outcome = await publicLeadQuoteWorkflowOutcome(
          db,
          user.uid,
          matchId,
          now,
        );
        return json({ ok: true, ...outcome });
      }
      return json({ ok: true });
    }
    return json(
      { ok: false, error: "The opportunity could not be updated." },
      404,
    );
  }
  await syncMarketplaceEnquiries(db, String(current.opportunity_id || ""), user.uid);
  const quoteWorkflowOutcome = status === "interested" && currentPublicContact
    ? await publicLeadQuoteWorkflowOutcome(db, user.uid, matchId, now)
    : { quoteWorkflow: null, warning: "" };
  if (status === "declined") {
    if (current.opportunity_id)
      await allocateNearestInstallers(
        String(current.opportunity_id),
        "automatic-decline-refill",
      ).catch(() => null);
  }
  await createAdminNotification({
    eventKey: `installer-response:${matchId}:${status}`,
    eventType: `installer.lead_${status}`,
    category: "response",
    priority: status === "interested" ? "high" : status === "declined" ? "normal" : "low",
    title: status === "interested" ? "Installer is interested in a lead" : status === "declined" ? "Installer declined a lead" : "Installer viewed a lead",
    summary: `${String(account.business_name || "An installer").slice(0, 160)} marked ${String(current.title || "").slice(0, 160)} as ${status}.`,
    entityType: "trade_opportunity_match",
    entityId: matchId,
    actorType: "installer",
    actorUid: user.uid,
    requiresAction: status === "interested",
    metadata: { opportunityId: String(current.opportunity_id || ""), status },
    occurredAt: now,
  });
  return json({ ok: true, ...quoteWorkflowOutcome });
}
