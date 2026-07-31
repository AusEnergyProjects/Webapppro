import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { postcodeMatchesState } from "@/lib/australian-postcodes.mjs";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import { DEFAULT_CONNECTED_INSTALLERS, DEFAULT_CONTACT_LIMIT, opportunityExpiry } from "@/lib/opportunity-server";
import { adminNotificationStatement, createAdminNotification } from "@/lib/admin-notifications";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";
import { queueAppointmentNotifications } from "@/lib/appointment-notification-server";
import { CUSTOMER_OPPORTUNITY_DISPATCH_HEADER } from "@/lib/customer-opportunity-dispatch-server";
import {
  CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER,
  customerProjectActivityStatements,
} from "@/lib/customer-project-activity-notification-server";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import {
  buildAnonymizedOpportunity,
  buildInstallerPropertyContext,
  CUSTOMER_CONTACT_RELEASE_FIELDS,
  CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION,
  CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
  CUSTOMER_NOTICE_VERSION,
  MAX_CUSTOMER_PROJECTS,
  MAX_OPEN_CUSTOMER_OPPORTUNITIES,
  normalizeCustomerAdvisorProfile,
  normalizeCustomerProject,
  parseStoredJson,
  reconcileCompletedPlanItems,
  customerContactReadiness,
  submissionReadiness,
  validateCustomerProfile,
} from "@/lib/customer-projects.mjs";
import {
  prepareCustomerPlanRevisionRestore,
} from "@/lib/customer-plan-revisions.mjs";
import {
  deleteCustomerProjectEvidenceObjects,
  type CustomerProjectEvidenceUploadCleanup,
} from "@/lib/customer-project-evidence-bucket";
import { parseArrivalWindows, selectedArrivalWindow } from "@/lib/customer-project-arrivals.mjs";

export const runtime = "edge";

const COMFORT_OUTCOMES = new Set(["better", "about-the-same", "worse", "not-sure"]);
const ENERGY_OUTCOMES = new Set(["lower", "about-the-same", "higher", "not-checked"]);
const PLAN_REVISION_READ_LIMIT = 20;
const PLAN_REVISION_RETENTION_LIMIT = 50;
const OUTCOME_CHECKIN_READ_LIMIT = 24;
const OUTCOME_CHECKIN_RETENTION_LIMIT = 48;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function dispatchJson(body: object, dispatchJobId: string, status = 202) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      [CUSTOMER_OPPORTUNITY_DISPATCH_HEADER]: dispatchJobId,
    },
  });
}

function activityDispatchJson(body: object, deliveryId: string, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      [CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER]: deliveryId,
    },
  });
}

function projectPhotoSharingStatements(
  db: ReturnType<typeof getD1>,
  {
    projectId,
    customerUid,
    occurredAt,
  }: {
    projectId: string;
    customerUid: string;
    occurredAt: string;
  },
) {
  return [
    db.prepare(`INSERT OR IGNORE INTO customer_project_evidence_events
      (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
      SELECT 'installer-photo-share:' || id || ':' || revision, id, project_id, customer_uid,
        '', 'customer', ?, 'shared_with_allocated_installers', ?
      FROM customer_project_evidence
      WHERE project_id = ? AND customer_uid = ? AND status = 'active'
        AND LOWER(content_type) LIKE 'image/%'
        AND updated_at <= ?
        AND sharing_scope <> 'allocated-installers'`)
      .bind(customerUid, occurredAt, projectId, customerUid, occurredAt),
    db.prepare(`UPDATE customer_project_evidence
      SET sharing_scope = 'allocated-installers', revision = revision + 1, updated_at = ?
      WHERE project_id = ? AND customer_uid = ? AND status = 'active'
        AND LOWER(content_type) LIKE 'image/%'
        AND updated_at <= ?
        AND sharing_scope <> 'allocated-installers'`)
      .bind(occurredAt, projectId, customerUid, occurredAt),
    db.prepare(`INSERT INTO customer_consent_receipts
      (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
      SELECT ?, ?, ?, 'installer_evidence_sharing', ?, ?, '', ?
      WHERE EXISTS (
        SELECT 1 FROM customer_projects
        WHERE id = ? AND firebase_uid = ? AND status IN ('matching', 'quote_review')
      ) AND EXISTS (
        SELECT 1 FROM customer_project_evidence
        WHERE project_id = ? AND customer_uid = ? AND status = 'active'
          AND LOWER(content_type) LIKE 'image/%'
          AND updated_at <= ?
      )
      ON CONFLICT(id) DO UPDATE SET notice_version = excluded.notice_version,
        granted_at = excluded.granted_at, withdrawn_at = ''`)
      .bind(
        `customer-evidence-share:${projectId}`,
        customerUid,
        projectId,
        CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
        occurredAt,
        occurredAt,
        projectId,
        customerUid,
        projectId,
        customerUid,
        occurredAt,
      ),
  ];
}

function planRevisionConflict(error: string) {
  return json({
    ok: false,
    code: "PLAN_REVISION_CONFLICT",
    error,
  }, 409);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

function cleanPlanRevision(value: unknown) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= 1_000_000
    ? value
    : 0;
}

function nextUpdatedAt(current: unknown) {
  const currentMillis = Date.parse(String(current || ""));
  return new Date(Math.max(
    Date.now(),
    Number.isFinite(currentMillis) ? currentMillis + 1 : 0,
  )).toISOString();
}

async function identity(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch {
    return null;
  }
}

function projectShape(
  row: Record<string, unknown>,
  progress: Record<string, unknown> | undefined,
  quotes: Record<string, unknown>[],
  handovers: Record<string, unknown>[],
  evidence: Record<string, unknown>[],
  planRevisions: Record<string, unknown>[],
  outcomeCheckins: Record<string, unknown>[],
  hasRetainedAssetHistory: boolean,
  contactReady: boolean,
  evidenceSharingConsent: boolean,
) {
  const storedStatus = String(row.status);
  const status = storedStatus === "deleting" ? "draft" : storedStatus;
  const responseCount = Number(progress?.response_count || 0);
  const quoteCount = quotes.length;
  const displayStatus = status === "matching" && quoteCount
    ? "quote_review"
    : status === "matching" && responseCount
      ? "responses"
      : status;
  const storedGoals = parseStoredJson(row.goals, []);
  const goals = Array.isArray(storedGoals) && storedGoals.length
    ? storedGoals
    : row.goal
      ? [String(row.goal)]
      : ["lower-bills"];
  const storedPropertyContext = buildInstallerPropertyContext(
    parseStoredJson(row.property_context, {}),
  );
  const storedHomeFeatures = parseStoredJson(row.existing_features, []);
  return {
    id: row.id,
    title: row.title,
    homeNickname: row.home_nickname,
    postcode: row.postcode,
    addressState: row.address_state,
    propertyType: row.property_type,
    householdSituation: row.household_situation,
    goal: row.goal,
    goals,
    pace: row.pace,
    existingFeatures: storedHomeFeatures,
    serviceCategories: parseStoredJson(row.service_categories, []),
    priorities: parseStoredJson(row.priorities, []),
    projectStage: row.project_stage,
    timing: row.timing,
    budgetRange: row.budget_range,
    propertyContext: storedPropertyContext,
    privateNotes: row.private_notes,
    advisorProfile: normalizeCustomerAdvisorProfile(
      parseStoredJson(row.advisor_profile, {}),
      {
        postcode: row.postcode,
        addressState: row.address_state,
        householdSituation: row.household_situation,
        approvalContext: storedPropertyContext.approvalContext,
        homeFeatures: storedHomeFeatures,
        propertyContext: storedPropertyContext,
      },
    ),
    planSnapshot: parseStoredJson(row.plan_snapshot, {}),
    completedPlanItems: parseStoredJson(row.completed_plan_items, []),
    planRevision: Number(row.plan_revision || 1),
    status,
    deletionPending: storedStatus === "deleting",
    displayStatus,
    submittedAt: row.submitted_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasRetainedAssetHistory,
    contactReady,
    progress: {
      installerCount: Number(progress?.installer_count || 0),
      reviewingCount: Number(progress?.reviewing_count || 0),
      responseCount,
      quoteCount,
      opportunityStatus: progress?.opportunity_status || "",
      expiresAt: progress?.expires_at || "",
    },
    quotes: quotes.map((quote, index) => ({
      id: quote.id,
      optionLabel: `Verified installer option ${String.fromCharCode(65 + index)}`,
      installerBusinessName: quote.installer_business_name,
      installerVerified: quote.installer_verification_status === "approved",
      inclusions: parseStoredJson(quote.inclusions, []),
      products: parseStoredJson(quote.product_snapshot, []),
      productSubtotalCentsExGst: Number(quote.product_subtotal_cents_ex_gst || 0),
      labourCentsExGst: Number(quote.labour_cents_ex_gst || 0),
      otherCentsExGst: Number(quote.other_cents_ex_gst || 0),
      totalCentsExGst: Number(quote.total_cents_ex_gst || 0),
      quoteType: quote.quote_type,
      startWindow: quote.start_window,
      durationWeeks: Number(quote.duration_weeks || 0),
      workmanshipWarrantyYears: Number(quote.workmanship_warranty_years || 0),
      customerDecision: quote.customer_decision,
      contactRelease: quote.contact_release_status ? {
        status: quote.contact_release_status,
        grantedAt: quote.contact_granted_at,
        withdrawnAt: quote.contact_withdrawn_at,
      } : null,
      arrivalProposal: quote.arrival_proposal_id ? {
        id: quote.arrival_proposal_id,
        status: quote.arrival_status,
        windows: parseArrivalWindows(quote.arrival_windows),
        installerNote: quote.arrival_installer_note,
        selectedWindow: parseStoredJson(quote.arrival_selected_window, null),
        directContact: quote.arrival_status === "direct_contact" ? parseStoredJson(quote.arrival_direct_contact_snapshot, null) : null,
        directContactSelectedAt: quote.arrival_direct_contact_selected_at,
        crmWorkOrderId: quote.arrival_crm_work_order_id,
        crmAppointmentId: quote.arrival_crm_appointment_id,
        preparationAcknowledgedAt: quote.arrival_preparation_acknowledged_at,
        revision: Number(quote.arrival_revision || 1),
        proposedAt: quote.arrival_proposed_at,
        selectedAt: quote.arrival_selected_at,
      } : null,
      submittedAt: quote.submitted_at,
      updatedAt: quote.updated_at,
    })),
    evidence: evidence.map((item) => ({
      id: item.id,
      category: item.category,
      captureSlot: item.capture_slot || "",
      factKeys: parseStoredJson(item.fact_keys, []),
      sharingScope: item.sharing_scope === "private-plan"
        ? "private-plan"
        : "allocated-installers",
      fileName: item.file_name,
      contentType: item.content_type,
      sizeBytes: Number(item.size_bytes || 0),
      privacyStatus: item.privacy_status || "not-recorded",
      revision: Number(item.revision || 1),
      previewUrl: String(item.content_type || "").startsWith("image/")
        ? `/api/customer-project-evidence?preview=${encodeURIComponent(String(item.id))}`
        : "",
      thumbnailUrl: String(item.content_type || "").startsWith("image/")
        ? `/api/customer-project-evidence?preview=${encodeURIComponent(String(item.id))}`
        : "",
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
    planRevisions: planRevisions.map((revision) => ({
      id: revision.id,
      revisionNumber: Number(revision.revision_number || 0),
      eventType: revision.event_type,
      planVersion: revision.plan_version,
      goals: parseStoredJson(revision.goals, []),
      homeFeatures: parseStoredJson(revision.home_features, []),
      pace: revision.pace,
      budgetRange: revision.budget_range,
      planSnapshot: parseStoredJson(revision.plan_snapshot, {}),
      restoredFromRevision: Number(revision.restored_from_revision || 0),
      createdAt: revision.created_at,
    })),
    outcomeCheckins: outcomeCheckins.map((checkin) => ({
      id: checkin.id,
      comfortOutcome: checkin.comfort_outcome,
      energyOutcome: checkin.energy_outcome,
      completedItemIds: parseStoredJson(checkin.completed_item_ids, []),
      note: checkin.note,
      recordedAt: checkin.recorded_at,
    })),
    evidenceSharingConsent,
    handoverPacks: handovers.map((handover) => ({
      id: handover.id,
      workNumber: handover.work_number,
      serviceCategory: handover.service_category,
      publishedAt: handover.published_at,
      updatedAt: handover.updated_at,
      assets: handover.assets || [],
      complianceItems: handover.complianceItems || [],
      documents: handover.documents || [],
      corrections: handover.corrections || [],
    })),
  };
}

async function ownedProject(firebaseUid: string, id: string) {
  return getD1().prepare("SELECT * FROM customer_projects WHERE id = ? AND firebase_uid = ?")
    .bind(id, firebaseUid).first<Record<string, unknown>>();
}

function storedProjectDraft(row: Record<string, unknown>) {
  return {
    title: row.title,
    homeNickname: row.home_nickname,
    postcode: row.postcode,
    addressState: row.address_state,
    propertyType: row.property_type,
    householdSituation: row.household_situation,
    goal: row.goal,
    goals: parseStoredJson(row.goals, []),
    pace: row.pace,
    existingFeatures: parseStoredJson(row.existing_features, []),
    serviceCategories: parseStoredJson(row.service_categories, []),
    priorities: parseStoredJson(row.priorities, []),
    projectStage: row.project_stage,
    timing: row.timing,
    budgetRange: row.budget_range,
    propertyContext: parseStoredJson(row.property_context, {}),
    privateNotes: row.private_notes,
    advisorProfile: parseStoredJson(row.advisor_profile, {}),
    planSnapshot: parseStoredJson(row.plan_snapshot, {}),
    completedPlanItems: parseStoredJson(row.completed_plan_items, []),
  };
}

async function projectsForOwner(firebaseUid: string) {
  const db = getD1();
  const [account, rows] = await Promise.all([
    db.prepare(`SELECT display_name, email, phone,
      address_line_1 AS addressLine1, address_line_2 AS addressLine2,
      suburb, postcode, address_state AS addressState
      FROM customer_accounts WHERE firebase_uid = ?`)
      .bind(firebaseUid).first<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM customer_projects
      WHERE firebase_uid = ? ORDER BY archived_at = '', updated_at DESC LIMIT 100`)
      .bind(firebaseUid).all<Record<string, unknown>>(),
  ]);
  const opportunityIds = rows.results.map((row: Record<string, unknown>) => String(row.opportunity_id || "")).filter(Boolean);
  const projectIds = rows.results.map((row: Record<string, unknown>) => String(row.id));
  const emptyRows = { results: [] as Record<string, unknown>[] };
  const [
    progressRows,
    quoteRows,
    retainedHandoverRows,
    handoverRows,
    evidenceRows,
    planRevisionRows,
    outcomeRows,
    evidenceConsentRows,
  ] = await Promise.all([
    opportunityIds.length ? db.prepare(`SELECT o.id opportunity_id, o.status opportunity_status, o.expires_at,
      COUNT(m.id) installer_count,
      SUM(CASE WHEN m.status IN ('offered', 'viewed') THEN 1 ELSE 0 END) reviewing_count,
      SUM(CASE WHEN m.status IN ('interested', 'connected') THEN 1 ELSE 0 END) response_count
      FROM trade_opportunities o LEFT JOIN trade_opportunity_matches m ON m.opportunity_id = o.id
      WHERE o.id IN (${opportunityIds.map(() => "?").join(",")}) GROUP BY o.id`)
      .bind(...opportunityIds).all<Record<string, unknown>>() : emptyRows,
    projectIds.length ? db.prepare(`SELECT q.id, q.project_id, q.inclusions, q.product_snapshot,
      product_subtotal_cents_ex_gst, labour_cents_ex_gst, other_cents_ex_gst, total_cents_ex_gst,
      quote_type, start_window, duration_weeks, workmanship_warranty_years, customer_decision, q.submitted_at, q.updated_at,
      a.business_name installer_business_name,
      CASE WHEN ${verifiedTradeAccountPredicate("a")} THEN 'approved' ELSE 'unavailable' END installer_verification_status,
      r.status contact_release_status, r.granted_at contact_granted_at, r.withdrawn_at contact_withdrawn_at,
      ap.id arrival_proposal_id, ap.status arrival_status, ap.windows arrival_windows,
      ap.installer_note arrival_installer_note, ap.selected_window arrival_selected_window,
      ap.direct_contact_snapshot arrival_direct_contact_snapshot,
      ap.direct_contact_selected_at arrival_direct_contact_selected_at,
      ap.crm_work_order_id arrival_crm_work_order_id, ap.crm_appointment_id arrival_crm_appointment_id,
      ap.preparation_acknowledged_at arrival_preparation_acknowledged_at,
      ap.revision arrival_revision, ap.proposed_at arrival_proposed_at, ap.selected_at arrival_selected_at
      FROM customer_project_quotes q
      JOIN trade_accounts a ON a.firebase_uid = q.installer_uid
      LEFT JOIN customer_project_contact_releases r ON r.opportunity_match_id = q.opportunity_match_id
      LEFT JOIN customer_project_arrival_proposals ap ON ap.opportunity_match_id = q.opportunity_match_id
      WHERE q.project_id IN (${projectIds.map(() => "?").join(",")}) AND q.status = 'submitted'
      ORDER BY q.submitted_at, q.id`).bind(...projectIds).all<Record<string, unknown>>() : emptyRows,
    projectIds.length ? db.prepare(`SELECT DISTINCT customer_project_id
      FROM trade_handover_packs WHERE customer_project_id IN (${projectIds.map(() => "?").join(",")})
        AND status = 'published'`).bind(...projectIds).all<Record<string, unknown>>() : emptyRows,
    projectIds.length ? db.prepare(`SELECT p.id, p.customer_project_id, p.service_category,
      p.published_at, p.updated_at, w.work_number
      FROM trade_handover_packs p JOIN trade_work_orders w ON w.id = p.work_order_id
      WHERE p.customer_project_id IN (${projectIds.map(() => "?").join(",")}) AND p.status = 'published'
        AND (NOT EXISTS (SELECT 1 FROM customer_asset_ownerships history WHERE history.handover_pack_id = p.id)
          OR EXISTS (SELECT 1 FROM customer_asset_ownerships ownership
            WHERE ownership.handover_pack_id = p.id AND ownership.customer_uid = ? AND ownership.status = 'active'))
      ORDER BY p.published_at DESC`).bind(...projectIds, firebaseUid).all<Record<string, unknown>>() : emptyRows,
    projectIds.length ? db.prepare(`SELECT id, project_id, category, capture_slot,
        fact_keys, sharing_scope, file_name, content_type, size_bytes, privacy_status,
        revision, created_at, updated_at
      FROM customer_project_evidence WHERE customer_uid = ? AND status = 'active'
        AND project_id IN (${projectIds.map(() => "?").join(",")}) ORDER BY created_at DESC`)
      .bind(firebaseUid, ...projectIds).all<Record<string, unknown>>() : emptyRows,
    projectIds.length ? db.prepare(`WITH ranked_revisions AS (
        SELECT id, project_id, revision_number, event_type, plan_version, goals, home_features,
          pace, budget_range, plan_snapshot, restored_from_revision, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY project_id
            ORDER BY revision_number DESC, created_at DESC, id DESC
          ) row_rank
        FROM customer_project_plan_revisions
        WHERE customer_uid = ? AND project_id IN (${projectIds.map(() => "?").join(",")})
      )
      SELECT id, project_id, revision_number, event_type, plan_version, goals, home_features,
        pace, budget_range, plan_snapshot, restored_from_revision, created_at
      FROM ranked_revisions WHERE row_rank <= ${PLAN_REVISION_READ_LIMIT}
      ORDER BY project_id, revision_number DESC`)
      .bind(firebaseUid, ...projectIds).all<Record<string, unknown>>() : emptyRows,
    projectIds.length ? db.prepare(`WITH ranked_outcomes AS (
        SELECT id, project_id, comfort_outcome, energy_outcome, completed_item_ids, note, recorded_at,
          ROW_NUMBER() OVER (
            PARTITION BY project_id
            ORDER BY recorded_at DESC, id DESC
          ) row_rank
        FROM customer_project_outcome_checkins
        WHERE customer_uid = ? AND project_id IN (${projectIds.map(() => "?").join(",")})
      )
      SELECT id, project_id, comfort_outcome, energy_outcome, completed_item_ids, note, recorded_at
      FROM ranked_outcomes WHERE row_rank <= ${OUTCOME_CHECKIN_READ_LIMIT}
      ORDER BY project_id, recorded_at DESC`)
      .bind(firebaseUid, ...projectIds).all<Record<string, unknown>>() : emptyRows,
    projectIds.length ? db.prepare(`SELECT project_id
      FROM customer_consent_receipts
      WHERE firebase_uid = ? AND purpose = 'installer_evidence_sharing' AND withdrawn_at = ''
        AND project_id IN (${projectIds.map(() => "?").join(",")})`)
      .bind(firebaseUid, ...projectIds).all<Record<string, unknown>>() : emptyRows,
  ]);
  const handoverIds = handoverRows.results.map((row: Record<string, unknown>) => String(row.id));
  const [assetRows, complianceRows, documentRows, correctionRows] = await Promise.all([
    handoverIds.length ? db.prepare(`SELECT handover_pack_id, id, asset_category, brand,
      model_number, serial_number, quantity, installed_at, warranty_provider, warranty_reference,
      warranty_start, warranty_end FROM trade_installed_assets
      WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")}) AND record_status = 'active'
      ORDER BY created_at`).bind(...handoverIds).all<Record<string, unknown>>() : emptyRows,
    handoverIds.length ? db.prepare(`SELECT handover_pack_id, id, label, status, completed_at
      FROM trade_compliance_items WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")})
      ORDER BY created_at`).bind(...handoverIds).all<Record<string, unknown>>() : emptyRows,
    handoverIds.length ? db.prepare(`SELECT handover_pack_id, id, category, file_name,
      content_type, size_bytes, created_at FROM trade_handover_documents
      WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")}) AND customer_visible = 1
      ORDER BY created_at DESC`).bind(...handoverIds).all<Record<string, unknown>>() : emptyRows,
    handoverIds.length ? db.prepare(`SELECT handover_pack_id, id, asset_id, version_number,
      field_key, previous_value, proposed_value, reason, published_at
      FROM trade_handover_corrections WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")})
        AND status = 'published' ORDER BY version_number DESC`)
      .bind(...handoverIds).all<Record<string, unknown>>() : emptyRows,
  ]);
  const shapedHandovers = handoverRows.results.map((handover: Record<string, unknown>) => ({
    ...handover,
    assets: assetRows.results.filter((item: Record<string, unknown>) => item.handover_pack_id === handover.id).map((item: Record<string, unknown>) => ({
      id: item.id,
      assetCategory: item.asset_category,
      brand: item.brand,
      modelNumber: item.model_number,
      serialNumber: item.serial_number,
      quantity: Number(item.quantity || 1),
      installedAt: item.installed_at,
      warrantyProvider: item.warranty_provider,
      warrantyReference: item.warranty_reference,
      warrantyStart: item.warranty_start,
      warrantyEnd: item.warranty_end,
    })),
    complianceItems: complianceRows.results.filter((item: Record<string, unknown>) => item.handover_pack_id === handover.id).map((item: Record<string, unknown>) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      completedAt: item.completed_at,
    })),
    documents: documentRows.results.filter((item: Record<string, unknown>) => item.handover_pack_id === handover.id).map((item: Record<string, unknown>) => ({
      id: item.id,
      category: item.category,
      fileName: item.file_name,
      contentType: item.content_type,
      sizeBytes: Number(item.size_bytes || 0),
      createdAt: item.created_at,
    })),
    corrections: correctionRows.results.filter((item: Record<string, unknown>) => item.handover_pack_id === handover.id).map((item: Record<string, unknown>) => ({
      id: item.id,
      assetId: item.asset_id,
      versionNumber: Number(item.version_number),
      fieldKey: item.field_key,
      previousValue: item.previous_value,
      approvedValue: item.proposed_value,
      reason: item.reason,
      publishedAt: item.published_at,
    })),
  }));
  return rows.results.map((row: Record<string, unknown>) => projectShape(
    row,
    progressRows.results.find((progress: Record<string, unknown>) => progress.opportunity_id === row.opportunity_id),
    quoteRows.results.filter((quote: Record<string, unknown>) => quote.project_id === row.id),
    shapedHandovers.filter((handover: Record<string, unknown>) => handover.customer_project_id === row.id),
    evidenceRows.results.filter((item: Record<string, unknown>) => item.project_id === row.id),
    planRevisionRows.results.filter((item: Record<string, unknown>) => item.project_id === row.id),
    outcomeRows.results.filter((item: Record<string, unknown>) => item.project_id === row.id),
    retainedHandoverRows.results.some((handover: Record<string, unknown>) => handover.customer_project_id === row.id),
    Boolean(account && customerContactReadiness(account, row).ok),
    evidenceConsentRows.results.some((consent: Record<string, unknown>) => consent.project_id === row.id),
  ));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const account = await getD1().prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid = ?")
    .bind(user.uid).first<Record<string, unknown>>();
  if (!account) return json({ ok: false, error: "Complete your private household profile first." }, 404);
  if (account.account_status !== "active") return json({ ok: false, error: "This customer account is not active." }, 403);
  return json({ ok: true, projects: await projectsForOwner(user.uid) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (Number(request.headers.get("content-length") || 0) > 40_000) return json({ ok: false, error: "The project draft was too large." }, 413);
  let raw: Record<string, unknown>;
  try { raw = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: "Invalid project details." }, 400); }
  const clientCreateId = cleanId(raw.clientCreateId);
  if (clientCreateId && !UUID_PATTERN.test(clientCreateId)) {
    return json({ ok: false, error: "Refresh this project before saving it." }, 400);
  }
  const db = getD1();
  const account = await db.prepare(`SELECT account_status, COALESCE(is_synthetic, 0) is_synthetic,
    phone, address_line_1, suburb, postcode, address_state FROM customer_accounts WHERE firebase_uid = ?`)
    .bind(user.uid).first<Record<string, unknown>>();
  if (!account) return json({ ok: false, error: "Complete your private household profile first." }, 404);
  if (account.account_status !== "active") return json({ ok: false, error: "This customer account is not active." }, 403);
  const normalized = normalizeCustomerProject(raw);
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
  const project = normalized.project;
  if (!project) return json({ ok: false, error: "Invalid project details." }, 400);
  if (!postcodeCoordinate(project.postcode)) return json({ ok: false, error: "Enter a recognised Australian project postcode." }, 400);
  if (!postcodeMatchesState(project.postcode, project.addressState)) {
    return json({ ok: false, error: "The project postcode does not match the selected state or territory." }, 400);
  }
  if (clientCreateId) {
    const existing = await db.prepare(
      "SELECT firebase_uid FROM customer_projects WHERE id = ?",
    ).bind(clientCreateId).first<{ firebase_uid: string }>();
    if (existing) {
      if (existing.firebase_uid !== user.uid) {
        return json({ ok: false, error: "Refresh this project before saving it." }, 409);
      }
      return json({
        ok: true,
        id: clientCreateId,
        created: false,
        projects: await projectsForOwner(user.uid),
      });
    }
  }
  const count = await db.prepare("SELECT COUNT(*) count FROM customer_projects WHERE firebase_uid = ? AND status != 'archived'")
    .bind(user.uid).first<{ count: number }>();
  if (Number(count?.count || 0) >= MAX_CUSTOMER_PROJECTS) return json({ ok: false, error: "Archive an older project before creating another one." }, 409);
  const id = clientCreateId || crypto.randomUUID();
  const now = new Date().toISOString();
  const storedPlan = JSON.stringify(project.planSnapshot);
  const revisionId = clientCreateId ? `${id}:created` : crypto.randomUUID();
  const insertResults = await db.batch([
    db.prepare(`${clientCreateId ? "INSERT OR IGNORE" : "INSERT"} INTO customer_projects
      (id, firebase_uid, title, home_nickname, postcode, address_state, property_type, household_situation,
       goal, goals, pace, existing_features, service_categories, priorities, project_stage, timing, budget_range,
         property_context, private_notes, advisor_profile, plan_snapshot, completed_plan_items, status, opportunity_id, submitted_at, archived_at, is_synthetic, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'draft', '', '', '', ?, ?, ?)`)
      .bind(id, user.uid, project.title, project.homeNickname, project.postcode, project.addressState,
        project.propertyType, project.householdSituation, project.goal, JSON.stringify(project.goals), project.pace,
        JSON.stringify(project.existingFeatures), JSON.stringify(project.serviceCategories), JSON.stringify(project.priorities),
        project.projectStage, project.timing, project.budgetRange, JSON.stringify(project.propertyContext), project.privateNotes,
        JSON.stringify(project.advisorProfile), storedPlan, Number(account.is_synthetic || 0), now, now),
    db.prepare(`${clientCreateId ? "INSERT OR IGNORE" : "INSERT"} INTO customer_project_plan_revisions
      (id, project_id, customer_uid, revision_number, event_type, plan_version, goals,
       home_features, pace, budget_range, plan_snapshot, created_at)
      VALUES (?, ?, ?, 1, 'created', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(revisionId, id, user.uid, String(project.planSnapshot?.version || ""),
        JSON.stringify(project.goals), JSON.stringify(project.existingFeatures), project.pace,
        project.budgetRange, storedPlan, now),
  ]);
  const created = Number(insertResults[0]?.meta.changes || 0) === 1;
  if (!created) {
    const existing = await db.prepare(
      "SELECT firebase_uid FROM customer_projects WHERE id = ?",
    ).bind(id).first<{ firebase_uid: string }>();
    if (!existing || existing.firebase_uid !== user.uid) {
      return json({ ok: false, error: "Refresh this project before saving it." }, 409);
    }
  }
  return json({
    ok: true,
    id,
    created,
    projects: await projectsForOwner(user.uid),
  }, created ? 201 : 200);
}

export async function PATCH(request: Request) {
  return customerProjectMutation(request);
}

export async function DELETE(request: Request) {
  return customerProjectMutation(request, "delete_draft");
}

async function customerProjectMutation(
  request: Request,
  forcedAction = "",
) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (Number(request.headers.get("content-length") || 0) > 40_000) return json({ ok: false, error: "The project update was too large." }, 413);
  let raw: Record<string, unknown>;
  try { raw = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: "Invalid project update." }, 400); }
  const requestedAction = typeof raw.action === "string" ? raw.action : "update";
  const action = forcedAction || requestedAction;
  if (!forcedAction && action === "delete_draft") {
    return json({ ok: false, error: "Choose a valid project action." }, 400);
  }
  const id = cleanId(raw.id);
  if (!id) return json({ ok: false, error: "Choose a valid project." }, 400);
  const db = getD1();
  const account = await db.prepare(
    "SELECT account_status FROM customer_accounts WHERE firebase_uid = ?",
  ).bind(user.uid).first<Record<string, unknown>>();
  if (!account) {
    return json({ ok: false, error: "Complete your private household profile first." }, 404);
  }
  if (account.account_status !== "active") {
    return json({ ok: false, error: "This customer account is not active." }, 403);
  }
  const current = await ownedProject(user.uid, id);
  if (!current) return json({ ok: false, error: "Project not found." }, 404);
  const now = new Date().toISOString();
  let responseProfile: Record<string, unknown> | null = null;
  let activityDeliveryId = "";
  if (current.status === "deleting" && action !== "delete_draft") {
    return json({
      ok: false,
      error: "This draft is already being deleted. Wait for that cleanup to finish.",
    }, 409);
  }

  if (action === "delete_draft") {
    if (raw.confirmDelete !== true) {
      return json({
        ok: false,
        error: "Confirm that you want to permanently delete this draft.",
      }, 400);
    }
    const resumingDeletion = current.status === "deleting";
    if (!["draft", "deleting"].includes(String(current.status))) {
      return json({
        ok: false,
        error: "Only a private draft can be permanently deleted. Close or archive an active project instead.",
      }, 409);
    }
    const expectedPlanRevision = cleanPlanRevision(raw.expectedPlanRevision);
    const expectedUpdatedAt = typeof raw.expectedUpdatedAt === "string"
      ? raw.expectedUpdatedAt.trim().slice(0, 40)
      : "";
    if (!expectedPlanRevision || !expectedUpdatedAt) {
      return json({
        ok: false,
        error: "Refresh this draft before deleting it.",
      }, 400);
    }
    if (
      expectedPlanRevision !== Number(current.plan_revision || 1)
      || expectedUpdatedAt !== String(current.updated_at || "")
    ) {
      return json({
        ok: false,
        code: "PROJECT_DELETE_CONFLICT",
        error: "This draft changed after you opened it. Review the latest version before deleting it.",
      }, 409);
    }
    if (current.opportunity_id || current.submitted_at) {
      return json({
        ok: false,
        error: "This project already has enquiry activity and cannot be permanently deleted.",
      }, 409);
    }
    const hasLinkedLifecycle = async () => {
      const lifecycle = await db.prepare(`SELECT
        EXISTS (SELECT 1 FROM customer_project_quotes WHERE project_id = ?) linked_quotes,
        EXISTS (SELECT 1 FROM customer_project_contact_releases WHERE project_id = ?) linked_contact_releases,
        EXISTS (SELECT 1 FROM customer_project_contact_release_events WHERE project_id = ?) linked_contact_events,
        EXISTS (SELECT 1 FROM customer_project_arrival_proposals WHERE project_id = ?) linked_arrivals,
        EXISTS (SELECT 1 FROM customer_project_arrival_events WHERE project_id = ?) linked_arrival_events,
        EXISTS (SELECT 1 FROM appointment_notification_events WHERE project_id = ?) linked_appointment_events,
        EXISTS (SELECT 1 FROM trade_handover_packs WHERE customer_project_id = ?) linked_handovers,
        EXISTS (
          SELECT 1 FROM trade_opportunities
          WHERE id = ? OR source_reference = ?
        ) linked_opportunities`)
        .bind(
          id,
          id,
          id,
          id,
          id,
          id,
          id,
          String(current.opportunity_id || ""),
          `customer-project:${id}`,
        )
        .first<Record<string, unknown>>();
      return Boolean(
        lifecycle
        && Object.values(lifecycle).some((value) => Number(value || 0) > 0),
      );
    };
    if (await hasLinkedLifecycle()) {
      return json({
        ok: false,
        error: "This project is linked to enquiry, appointment or handover activity and cannot be permanently deleted.",
      }, 409);
    }

    const deletionLockedAt = expectedUpdatedAt;
    if (!resumingDeletion) {
      let locked;
      try {
        locked = await db.prepare(`UPDATE customer_projects
          SET status = 'deleting'
          WHERE id = ? AND firebase_uid = ? AND status = 'draft'
            AND opportunity_id = '' AND submitted_at = ''
            AND plan_revision = ? AND updated_at = ?`)
          .bind(
            id,
            user.uid,
            expectedPlanRevision,
            expectedUpdatedAt,
          )
          .run();
      } catch {
        return json({
          ok: false,
          code: "PROJECT_DELETE_CLEANUP_RETRY",
          error: "Draft deletion could not start. Refresh and try delete again.",
        }, 503);
      }
      if (Number(locked.meta.changes || 0) !== 1) {
        return json({
          ok: false,
          code: "PROJECT_DELETE_CONFLICT",
          error: "This draft changed after you opened it. Review the latest version before deleting it.",
        }, 409);
      }
    }

    const restoreDeletionLock = async () => {
      await db.prepare(`UPDATE customer_projects
        SET status = 'draft'
        WHERE id = ? AND firebase_uid = ? AND status = 'deleting'
          AND plan_revision = ? AND updated_at = ?`)
        .bind(
          id,
          user.uid,
          expectedPlanRevision,
          deletionLockedAt,
        )
        .run();
    };
    if (await hasLinkedLifecycle()) {
      await restoreDeletionLock();
      return json({
        ok: false,
        error: "This project became linked to enquiry, appointment or handover activity and was not deleted.",
      }, 409);
    }

    const ownedLockedDraft = `EXISTS (
      SELECT 1 FROM customer_projects
      WHERE id = ? AND firebase_uid = ? AND status = 'deleting'
        AND opportunity_id = '' AND submitted_at = ''
        AND plan_revision = ? AND updated_at = ?
    )`;
    try {
      await db.prepare(`UPDATE customer_project_evidence_upload_sessions
        SET status = 'abandoning', last_error = 'project_deletion_started',
          updated_at = ?
        WHERE project_id = ? AND customer_uid = ?
          AND status IN ('initiated', 'uploading', 'completing', 'finalising')
          AND ${ownedLockedDraft}`)
        .bind(
          now,
          id,
          user.uid,
          id,
          user.uid,
          expectedPlanRevision,
          deletionLockedAt,
        )
        .run();
    } catch {
      if (!resumingDeletion) await restoreDeletionLock();
      return json({
        ok: false,
        code: "PROJECT_DELETE_CLEANUP_RETRY",
        error: "Draft deletion paused before file cleanup. Refresh and try delete again.",
      }, 503);
    }

    let evidenceObjects: string[] = [];
    let uploadRecords: Record<string, unknown>[] = [];
    try {
      const evidenceRows = await db.prepare(`SELECT object_key
        FROM customer_project_evidence
        WHERE project_id = ? AND customer_uid = ?`)
        .bind(id, user.uid)
        .all<Record<string, unknown>>();
      const uploadRows = await db.prepare(`SELECT staging_object_key, upload_id,
          replacement_object_key
        FROM customer_project_evidence_upload_sessions
        WHERE project_id = ? AND customer_uid = ? AND status = 'abandoning'`)
        .bind(id, user.uid)
        .all<Record<string, unknown>>();
      evidenceObjects = evidenceRows.results.map(
        (item) => String(item.object_key || ""),
      );
      uploadRecords = uploadRows.results;
    } catch {
      return json({
        ok: false,
        code: "PROJECT_DELETE_CLEANUP_RETRY",
        error: "File cleanup could not be prepared. Refresh and delete this draft again.",
      }, 503);
    }
    const uploadCleanups: CustomerProjectEvidenceUploadCleanup[] =
      uploadRecords.flatMap((item) => {
        const stagingObjectKey = String(item.staging_object_key || "");
        const uploadId = String(item.upload_id || "");
        return stagingObjectKey && uploadId
          ? [{ stagingObjectKey, uploadId }]
          : [];
      });
    try {
      await deleteCustomerProjectEvidenceObjects(
        [
          ...evidenceObjects,
          ...uploadRecords.map(
            (item) => String(item.replacement_object_key || ""),
          ),
        ],
        uploadCleanups,
      );
    } catch {
      return json({
        ok: false,
        code: "PROJECT_DELETE_CLEANUP_RETRY",
        error: "File cleanup did not finish. Refresh and delete this draft again.",
      }, 503);
    }

    let deletionResults;
    try {
      deletionResults = await db.batch([
        db.prepare(`UPDATE customer_project_evidence_upload_sessions
          SET status = 'abandoned', privacy_status = 'not-stored',
            last_error = 'project_deleted', updated_at = ?
          WHERE project_id = ? AND customer_uid = ? AND status = 'abandoning'
            AND ${ownedLockedDraft}`)
          .bind(
            now,
            id,
            user.uid,
            id,
            user.uid,
            expectedPlanRevision,
            deletionLockedAt,
          ),
        db.prepare(`DELETE FROM customer_project_evidence_events
          WHERE project_id = ? AND customer_uid = ? AND ${ownedLockedDraft}`)
          .bind(id, user.uid, id, user.uid, expectedPlanRevision, deletionLockedAt),
        db.prepare(`DELETE FROM customer_project_evidence
          WHERE project_id = ? AND customer_uid = ? AND ${ownedLockedDraft}`)
          .bind(id, user.uid, id, user.uid, expectedPlanRevision, deletionLockedAt),
        db.prepare(`DELETE FROM customer_project_plan_revisions
          WHERE project_id = ? AND customer_uid = ? AND ${ownedLockedDraft}`)
          .bind(id, user.uid, id, user.uid, expectedPlanRevision, deletionLockedAt),
        db.prepare(`DELETE FROM customer_project_outcome_checkins
          WHERE project_id = ? AND customer_uid = ? AND ${ownedLockedDraft}`)
          .bind(id, user.uid, id, user.uid, expectedPlanRevision, deletionLockedAt),
        db.prepare(`DELETE FROM customer_consent_receipts
          WHERE project_id = ? AND firebase_uid = ? AND ${ownedLockedDraft}`)
          .bind(id, user.uid, id, user.uid, expectedPlanRevision, deletionLockedAt),
        db.prepare(`DELETE FROM customer_projects
          WHERE id = ? AND firebase_uid = ? AND status = 'deleting'
            AND opportunity_id = '' AND submitted_at = ''
            AND plan_revision = ? AND updated_at = ?`)
          .bind(
            id,
            user.uid,
            expectedPlanRevision,
            deletionLockedAt,
          ),
      ]);
    } catch {
      return json({
        ok: false,
        code: "PROJECT_DELETE_CLEANUP_RETRY",
        error: "Final draft cleanup did not finish. Refresh and delete this draft again.",
      }, 503);
    }
    if (
      Number(
        deletionResults[deletionResults.length - 1]?.meta.changes || 0,
      ) !== 1
    ) {
      return json({
        ok: false,
        code: "PROJECT_DELETE_CLEANUP_RETRY",
        error: "Final draft cleanup paused. Refresh and delete this draft again.",
      }, 503);
    }
  } else if (action === "update") {
    if (current.status !== "draft") return json({ ok: false, error: "Submitted projects are locked. Duplicate this project to revise its installer scope." }, 409);
    const expectedPlanRevision = cleanPlanRevision(raw.expectedPlanRevision);
    const currentPlanRevision = Number(current.plan_revision || 1);
    const currentUpdatedAt = String(current.updated_at || "");
    const expectedUpdatedAtProvided = Object.prototype.hasOwnProperty.call(
      raw,
      "expectedUpdatedAt",
    );
    const expectedUpdatedAt = typeof raw.expectedUpdatedAt === "string"
      ? raw.expectedUpdatedAt.trim().slice(0, 40)
      : "";
    if (!expectedPlanRevision) {
      return json({ ok: false, error: "Refresh this project before saving it again." }, 400);
    }
    if (expectedPlanRevision !== currentPlanRevision) {
      return planRevisionConflict("This plan changed in another tab. Review the latest version before saving.");
    }
    if (
      expectedUpdatedAtProvided
      && (!expectedUpdatedAt || expectedUpdatedAt !== currentUpdatedAt)
    ) {
      return planRevisionConflict(
        "This draft changed in another tab. Review the latest version before saving.",
      );
    }
    const normalized = normalizeCustomerProject(raw);
    if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
    const project = normalized.project;
    if (!project) return json({ ok: false, error: "Invalid project update." }, 400);
    if (!postcodeCoordinate(project.postcode)) return json({ ok: false, error: "Enter a recognised Australian project postcode." }, 400);
    if (!postcodeMatchesState(project.postcode, project.addressState)) {
      return json({ ok: false, error: "The project postcode does not match the selected state or territory." }, 400);
    }
    const completedPlanItems = reconcileCompletedPlanItems(
      parseStoredJson(current.completed_plan_items, []),
      project.planSnapshot,
    );
    const nextGoals = JSON.stringify(project.goals);
    const nextFeatures = JSON.stringify(project.existingFeatures);
    const nextServices = JSON.stringify(project.serviceCategories);
    const nextPropertyContext = JSON.stringify(project.propertyContext);
    const nextPlan = JSON.stringify(project.planSnapshot);
    const roadmapChanged = (
      String(current.goals || "[]") !== nextGoals
      || String(current.existing_features || "[]") !== nextFeatures
      || String(current.service_categories || "[]") !== nextServices
      || String(current.pace || "") !== project.pace
      || String(current.budget_range || "") !== project.budgetRange
      || String(current.plan_snapshot || "{}") !== nextPlan
    );
    if (roadmapChanged) {
      const nextPlanRevision = currentPlanRevision + 1;
      const revisionId = crypto.randomUUID();
      const results = await db.batch([
        db.prepare(`INSERT INTO customer_project_plan_revisions
          (id, project_id, customer_uid, revision_number, event_type, plan_version, goals,
           home_features, pace, budget_range, plan_snapshot, restored_from_revision, created_at)
          SELECT ?, ?, ?, ?, 'saved', ?, ?, ?, ?, ?, ?, 0, ?
          WHERE EXISTS (
            SELECT 1 FROM customer_projects
            WHERE id = ? AND firebase_uid = ? AND status = 'draft'
              AND plan_revision = ? AND updated_at = ?
          )`)
          .bind(revisionId, id, user.uid, nextPlanRevision,
            String(project.planSnapshot?.version || ""), nextGoals, nextFeatures,
            project.pace, project.budgetRange, nextPlan, now,
            id, user.uid, expectedPlanRevision, currentUpdatedAt),
        db.prepare(`UPDATE customer_projects SET title = ?, home_nickname = ?, postcode = ?, address_state = ?,
          property_type = ?, household_situation = ?, goal = ?, goals = ?, pace = ?, existing_features = ?, service_categories = ?,
          priorities = ?, project_stage = ?, timing = ?, budget_range = ?, property_context = ?, private_notes = ?, plan_snapshot = ?,
          advisor_profile = ?, completed_plan_items = ?, plan_revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status = 'draft'
            AND plan_revision = ? AND updated_at = ?
            AND EXISTS (
              SELECT 1 FROM customer_project_plan_revisions
              WHERE id = ? AND project_id = ? AND customer_uid = ?
            )`)
          .bind(project.title, project.homeNickname, project.postcode, project.addressState, project.propertyType,
            project.householdSituation, project.goal, nextGoals, project.pace, nextFeatures,
            nextServices, JSON.stringify(project.priorities), project.projectStage,
            project.timing, project.budgetRange, nextPropertyContext, project.privateNotes,
            nextPlan, JSON.stringify(project.advisorProfile), JSON.stringify(completedPlanItems),
            nextPlanRevision, now, id, user.uid, expectedPlanRevision, currentUpdatedAt,
            revisionId, id, user.uid),
        db.prepare(`DELETE FROM customer_project_plan_revisions
        WHERE project_id = ? AND customer_uid = ? AND id NOT IN (
          SELECT id FROM customer_project_plan_revisions
          WHERE project_id = ? AND customer_uid = ?
          ORDER BY revision_number DESC, created_at DESC, id DESC
          LIMIT ${PLAN_REVISION_RETENTION_LIMIT}
        ) AND EXISTS (
          SELECT 1 FROM customer_project_plan_revisions
          WHERE id = ? AND project_id = ? AND customer_uid = ?
        )`).bind(id, user.uid, id, user.uid, revisionId, id, user.uid),
      ]);
      if (
        Number(results[0]?.meta.changes || 0) !== 1
        || Number(results[1]?.meta.changes || 0) !== 1
      ) {
        return planRevisionConflict("This plan changed in another tab. Review the latest version before saving.");
      }
    } else {
      const updated = await db.prepare(`UPDATE customer_projects SET title = ?, home_nickname = ?, postcode = ?, address_state = ?,
        property_type = ?, household_situation = ?, goal = ?, goals = ?, pace = ?, existing_features = ?, service_categories = ?,
        priorities = ?, project_stage = ?, timing = ?, budget_range = ?, property_context = ?, private_notes = ?, plan_snapshot = ?,
        advisor_profile = ?, completed_plan_items = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'draft'
          AND plan_revision = ? AND updated_at = ?`)
        .bind(project.title, project.homeNickname, project.postcode, project.addressState, project.propertyType,
          project.householdSituation, project.goal, nextGoals, project.pace, nextFeatures,
          nextServices, JSON.stringify(project.priorities), project.projectStage,
          project.timing, project.budgetRange, nextPropertyContext, project.privateNotes,
          nextPlan, JSON.stringify(project.advisorProfile), JSON.stringify(completedPlanItems),
          now, id, user.uid, expectedPlanRevision, currentUpdatedAt)
        .run();
      if (Number(updated.meta.changes || 0) !== 1) {
        return planRevisionConflict("This plan changed in another tab. Review the latest version before saving.");
      }
    }
  } else if (action === "restore_plan_revision") {
    if (current.status !== "draft") {
      return json({ ok: false, error: "Submitted projects are locked. Restore an earlier plan only in a private draft." }, 409);
    }
    if (raw.confirmRestore !== true) {
      return json({ ok: false, error: "Confirm that you want to restore this saved plan as a new version." }, 400);
    }
    const sourceRevisionNumber = cleanPlanRevision(raw.sourceRevisionNumber);
    const expectedPlanRevision = cleanPlanRevision(raw.expectedPlanRevision);
    const currentPlanRevision = Number(current.plan_revision || 1);
    const currentUpdatedAt = String(current.updated_at || "");
    if (!sourceRevisionNumber || !expectedPlanRevision) {
      return json({ ok: false, error: "Choose a valid saved plan version and try again." }, 400);
    }
    if (expectedPlanRevision !== currentPlanRevision) {
      return planRevisionConflict("This plan changed in another tab. Review the latest version before restoring.");
    }
    if (sourceRevisionNumber === currentPlanRevision) {
      return json({ ok: false, error: "That saved version is already the current plan." }, 409);
    }
    const sourceRevision = await db.prepare(`SELECT revision_number, plan_version, goals, home_features,
      pace, budget_range, plan_snapshot
      FROM customer_project_plan_revisions
      WHERE project_id = ? AND customer_uid = ? AND revision_number = ?`)
      .bind(id, user.uid, sourceRevisionNumber)
      .first<Record<string, unknown>>();
    if (!sourceRevision) {
      return json({ ok: false, error: "That saved plan version is no longer available." }, 404);
    }
    const storedGoals = parseStoredJson(sourceRevision.goals, null);
    const storedHomeFeatures = parseStoredJson(sourceRevision.home_features, null);
    const storedPlanSnapshot = parseStoredJson(sourceRevision.plan_snapshot, null);
    if (
      !Array.isArray(storedGoals)
      || !Array.isArray(storedHomeFeatures)
      || !storedPlanSnapshot
      || typeof storedPlanSnapshot !== "object"
      || Array.isArray(storedPlanSnapshot)
    ) {
      return json({ ok: false, error: "That saved plan version could not be restored safely." }, 409);
    }
    const prepared = prepareCustomerPlanRevisionRestore(
      storedProjectDraft(current),
      {
        revisionNumber: Number(sourceRevision.revision_number),
        planVersion: sourceRevision.plan_version,
        goals: storedGoals,
        homeFeatures: storedHomeFeatures,
        pace: sourceRevision.pace,
        budgetRange: sourceRevision.budget_range,
        planSnapshot: storedPlanSnapshot,
      },
    );
    if (!prepared.ok || !("project" in prepared) || !prepared.project) {
      const error = "error" in prepared
        ? prepared.error
        : "That saved plan version could not be restored safely.";
      return json({ ok: false, error }, 409);
    }
    const restored = prepared.project;
    const nextGoals = JSON.stringify(restored.goals);
    const nextFeatures = JSON.stringify(restored.existingFeatures);
    const nextServices = JSON.stringify(restored.serviceCategories);
    const nextPriorities = JSON.stringify(restored.priorities);
    const nextPropertyContext = JSON.stringify(restored.propertyContext);
    const nextPlan = JSON.stringify(restored.planSnapshot);
    const nextCompleted = JSON.stringify(prepared.completedPlanItems || []);
    if (
      String(current.goals || "[]") === nextGoals
      && String(current.existing_features || "[]") === nextFeatures
      && String(current.service_categories || "[]") === nextServices
      && String(current.property_context || "{}") === nextPropertyContext
      && String(current.pace || "") === restored.pace
      && String(current.budget_range || "") === restored.budgetRange
      && String(current.plan_snapshot || "{}") === nextPlan
    ) {
      return json({ ok: false, error: "That saved version already matches the current plan." }, 409);
    }
    const nextPlanRevision = currentPlanRevision + 1;
    const revisionId = crypto.randomUUID();
    const results = await db.batch([
      db.prepare(`INSERT INTO customer_project_plan_revisions
        (id, project_id, customer_uid, revision_number, event_type, plan_version, goals,
         home_features, pace, budget_range, plan_snapshot, restored_from_revision, created_at)
        SELECT ?, ?, ?, ?, 'restored', ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM customer_projects
          WHERE id = ? AND firebase_uid = ? AND status = 'draft'
            AND plan_revision = ? AND updated_at = ?
        )`)
        .bind(revisionId, id, user.uid, nextPlanRevision,
          String(restored.planSnapshot?.version || ""), nextGoals, nextFeatures,
          restored.pace, restored.budgetRange, nextPlan, sourceRevisionNumber, now,
          id, user.uid, expectedPlanRevision, currentUpdatedAt),
      db.prepare(`UPDATE customer_projects SET goal = ?, goals = ?, pace = ?, existing_features = ?,
        service_categories = ?, priorities = ?, budget_range = ?, property_context = ?,
        plan_snapshot = ?, completed_plan_items = ?, plan_revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'draft'
          AND plan_revision = ? AND updated_at = ?
          AND EXISTS (
            SELECT 1 FROM customer_project_plan_revisions
            WHERE id = ? AND project_id = ? AND customer_uid = ?
              AND revision_number = ? AND restored_from_revision = ?
          )`)
        .bind(restored.goal, nextGoals, restored.pace, nextFeatures,
          nextServices, nextPriorities, restored.budgetRange,
          nextPropertyContext, nextPlan, nextCompleted, nextPlanRevision, now,
          id, user.uid, expectedPlanRevision, currentUpdatedAt,
          revisionId, id, user.uid,
          nextPlanRevision, sourceRevisionNumber),
      db.prepare(`DELETE FROM customer_project_plan_revisions
        WHERE project_id = ? AND customer_uid = ? AND id NOT IN (
          SELECT id FROM customer_project_plan_revisions
          WHERE project_id = ? AND customer_uid = ?
          ORDER BY revision_number DESC, created_at DESC, id DESC
          LIMIT ${PLAN_REVISION_RETENTION_LIMIT}
        ) AND EXISTS (
          SELECT 1 FROM customer_project_plan_revisions
          WHERE id = ? AND project_id = ? AND customer_uid = ?
        )`).bind(id, user.uid, id, user.uid, revisionId, id, user.uid),
    ]);
    if (
      Number(results[0]?.meta.changes || 0) !== 1
      || Number(results[1]?.meta.changes || 0) !== 1
    ) {
      return planRevisionConflict("This plan changed in another tab. Review the latest version before restoring.");
    }
    return json({
      ok: true,
      id,
      restoredFromRevision: sourceRevisionNumber,
      planRevision: nextPlanRevision,
      projects: await projectsForOwner(user.uid),
    });
  } else if (action === "share_all_photos") {
    if (!["matching", "quote_review"].includes(String(current.status))) {
      return json({
        ok: false,
        error: "Photos can be shared only for an active installer enquiry.",
      }, 409);
    }
    if (raw.confirmAllProjectPhotoSharing !== true) {
      return json({
        ok: false,
        error: "Confirm that all active project photos can be shared with the verified installers allocated to this enquiry.",
      }, 400);
    }
    const photos = await db.prepare(`SELECT COUNT(*) photo_count,
      SUM(CASE WHEN sharing_scope <> 'allocated-installers' THEN 1 ELSE 0 END) private_photo_count
      FROM customer_project_evidence
      WHERE project_id = ? AND customer_uid = ? AND status = 'active'
        AND LOWER(content_type) LIKE 'image/%'
        AND updated_at <= ?`)
      .bind(id, user.uid, now)
      .first<{ photo_count: number; private_photo_count: number }>();
    const photoCount = Number(photos?.photo_count || 0);
    if (!photoCount) {
      return json({
        ok: false,
        error: "Add at least one project photo before sharing photos with installers.",
      }, 409);
    }
    const results = await db.batch(projectPhotoSharingStatements(db, {
      projectId: id,
      customerUid: user.uid,
      occurredAt: now,
    }));
    return json({
      ok: true,
      id,
      sharedPhotoCount: Number(results[1]?.meta.changes || 0),
      totalPhotoCount: photoCount,
    });
  } else if (action === "submit") {
    if (!user.emailVerified && !Boolean(current.is_synthetic)) return json({ ok: false, error: "Verify your account email before requesting installer responses." }, 403);
    const activeSubmitRetry = ["matching", "quote_review"].includes(
      String(current.status),
    );
    if (current.status !== "draft" && !activeSubmitRetry) {
      return json({
        ok: false,
        error: "This project is no longer open for installer matching.",
      }, 409);
    }
    const expectedPlanRevision = cleanPlanRevision(raw.expectedPlanRevision);
    const currentPlanRevision = Number(current.plan_revision || 1);
    const currentUpdatedAt = String(current.updated_at || "");
    if (current.status === "draft" && !expectedPlanRevision) {
      return json({ ok: false, error: "Refresh this project before requesting installer responses." }, 400);
    }
    if (
      current.status === "draft"
      && expectedPlanRevision !== currentPlanRevision
    ) {
      return planRevisionConflict("This plan changed in another tab. Review the latest version before submitting.");
    }
    const contactAccount = await db.prepare(`SELECT display_name, phone,
      address_line_1, address_line_2, suburb, postcode, address_state,
      property_type, household_situation, account_updates, account_status,
      consent_version, consent_at, created_at, updated_at
      FROM customer_accounts
      WHERE firebase_uid = ? AND account_status = 'active'`)
      .bind(user.uid).first<Record<string, unknown>>();
    if (!contactAccount) {
      return json({ ok: false, error: "Complete your private household profile first." }, 404);
    }
    const submittedContact =
      raw.contact && typeof raw.contact === "object" && !Array.isArray(raw.contact)
        ? raw.contact as Record<string, unknown>
        : null;
    if (!submittedContact) {
      return json({
        ok: false,
        error: "Add the service contact details shown in this request.",
      }, 400);
    }
    const validatedContact = validateCustomerProfile({
      displayName: contactAccount.display_name,
      phone: submittedContact.phone,
      addressLine1: submittedContact.addressLine1,
      addressLine2: submittedContact.addressLine2,
      suburb: submittedContact.suburb,
      postcode: current.postcode,
      addressState: current.address_state,
      propertyType: contactAccount.property_type,
      householdSituation: contactAccount.household_situation,
      accountUpdates: Boolean(contactAccount.account_updates),
      consent: true,
    });
    if (!validatedContact.ok || !validatedContact.profile) {
      return json({
        ok: false,
        error: validatedContact.error || "Enter valid service contact details.",
      }, 400);
    }
    const authoritativeContact = validatedContact.profile;
    const contactReadiness = customerContactReadiness(
      authoritativeContact,
      current,
    );
    if (!contactReadiness.ok) {
      return json({ ok: false, error: contactReadiness.error }, 400);
    }
    const contactUpdatedAt = nextUpdatedAt(contactAccount.updated_at);
    responseProfile = {
      ...authoritativeContact,
      accountStatus: "active",
      accountTier: "Always free",
      consentVersion: contactAccount.consent_version,
      consentAt: contactAccount.consent_at,
      createdAt: contactAccount.created_at,
      updatedAt: contactUpdatedAt,
    };
    const photos = await db.prepare(`SELECT COUNT(*) photo_count,
      SUM(CASE WHEN sharing_scope <> 'allocated-installers' THEN 1 ELSE 0 END) private_photo_count
      FROM customer_project_evidence
      WHERE project_id = ? AND customer_uid = ? AND status = 'active'
        AND LOWER(content_type) LIKE 'image/%'
        AND updated_at <= ?`)
      .bind(id, user.uid, now)
      .first<{ photo_count: number; private_photo_count: number }>();
    const photoCount = Number(photos?.photo_count || 0);
    const privatePhotoCount = Number(photos?.private_photo_count || 0);
    const evidenceConsent = await db.prepare(`SELECT id FROM customer_consent_receipts
      WHERE firebase_uid = ? AND project_id = ? AND purpose = 'installer_evidence_sharing'
        AND notice_version = ? AND withdrawn_at = '' LIMIT 1`)
      .bind(user.uid, id, CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION)
      .first<{ id: string }>();
    const photoConfirmationRequired = (
      photoCount > 0
      && (privatePhotoCount > 0 || !evidenceConsent)
    );
    if (
      photoConfirmationRequired
      && raw.confirmAllProjectPhotoSharing !== true
    ) {
      return json({
        ok: false,
        error: "Confirm that all active project photos can be shared with the verified installers allocated to this enquiry.",
      }, 400);
    }
    const opportunityId = String(current.opportunity_id || `customer-project:${id}`);
    const existingAdminNotification = await db.prepare(
      "SELECT id FROM admin_notifications WHERE event_key = ? LIMIT 1",
    ).bind(`customer-enquiry:${id}`).first<{ id: string }>();
    const adminNotificationId = existingAdminNotification?.id
      || `customer-enquiry-notification:${id}`;
    const dispatchJobId = `customer-opportunity-dispatch:${id}`;
    if (activeSubmitRetry) {
      const retryStatements = [
        db.prepare(`UPDATE customer_accounts
          SET phone = ?, address_line_1 = ?, address_line_2 = ?, suburb = ?,
            postcode = ?, address_state = ?, updated_at = ?
          WHERE firebase_uid = ? AND account_status = 'active'
            AND EXISTS (
              SELECT 1 FROM customer_projects
              WHERE id = ? AND firebase_uid = ?
                AND status IN ('matching', 'quote_review')
            )`)
          .bind(
            authoritativeContact.phone,
            authoritativeContact.addressLine1,
            authoritativeContact.addressLine2,
            authoritativeContact.suburb,
            authoritativeContact.postcode,
            authoritativeContact.addressState,
            contactUpdatedAt,
            user.uid,
            id,
            user.uid,
          ),
        adminNotificationStatement(db, {
          eventKey: `customer-enquiry:${id}`,
          eventType: "customer.enquiry_submitted",
          category: "customer",
          priority: "high",
          title: "Customer enquiry submitted",
          summary: `${String(current.title).slice(0, 120)} is ready for anonymised installer matching and operations oversight.`,
          entityType: "customer_project",
          entityId: id,
          actorType: "customer",
          actorUid: user.uid,
          requiresAction: true,
          metadata: { opportunityId },
          occurredAt: String(current.submitted_at || now),
        }, adminNotificationId),
        db.prepare(`INSERT INTO customer_opportunity_dispatch_jobs
          (id, opportunity_id, admin_notification_id, status, attempts, next_attempt_at,
           claimed_at, completed_at, failed_at, last_error, created_at, updated_at)
          SELECT ?, ?, ?, 'pending', 0, '', '', '', '', '', ?, ?
          WHERE EXISTS (
            SELECT 1 FROM customer_projects
            WHERE id = ? AND firebase_uid = ? AND status IN ('matching', 'quote_review')
              AND opportunity_id = ?
          )
          ON CONFLICT(opportunity_id) DO UPDATE SET
            admin_notification_id = excluded.admin_notification_id,
            status = CASE
              WHEN customer_opportunity_dispatch_jobs.status IN ('completed', 'processing')
                THEN customer_opportunity_dispatch_jobs.status
              ELSE 'pending'
            END,
            next_attempt_at = CASE
              WHEN customer_opportunity_dispatch_jobs.status IN ('completed', 'processing')
                THEN customer_opportunity_dispatch_jobs.next_attempt_at
              ELSE ''
            END,
            attempts = CASE
              WHEN customer_opportunity_dispatch_jobs.status IN ('completed', 'processing')
                THEN customer_opportunity_dispatch_jobs.attempts
              ELSE 0
            END,
            claimed_at = CASE
              WHEN customer_opportunity_dispatch_jobs.status IN ('completed', 'processing')
                THEN customer_opportunity_dispatch_jobs.claimed_at
              ELSE ''
            END,
            completed_at = CASE
              WHEN customer_opportunity_dispatch_jobs.status IN ('completed', 'processing')
                THEN customer_opportunity_dispatch_jobs.completed_at
              ELSE ''
            END,
            failed_at = CASE
              WHEN customer_opportunity_dispatch_jobs.status IN ('completed', 'processing')
                THEN customer_opportunity_dispatch_jobs.failed_at
              ELSE ''
            END,
            last_error = CASE
              WHEN customer_opportunity_dispatch_jobs.status IN ('completed', 'processing')
                THEN customer_opportunity_dispatch_jobs.last_error
              ELSE ''
            END,
            updated_at = excluded.updated_at`)
          .bind(
            dispatchJobId,
            opportunityId,
            adminNotificationId,
            now,
            now,
            id,
            user.uid,
            opportunityId,
          ),
      ];
      if (
        photoCount > 0
        && raw.confirmAllProjectPhotoSharing === true
      ) {
        retryStatements.push(...projectPhotoSharingStatements(db, {
          projectId: id,
          customerUid: user.uid,
          occurredAt: now,
        }));
      }
      const retryResults = await db.batch(retryStatements);
      if (Number(retryResults[0]?.meta.changes || 0) < 1) {
        return json({
          ok: false,
          error: "Your service contact details could not be saved. Try again.",
        }, 503);
      }
      return dispatchJson({
        ok: true,
        project: {
          id,
          status: String(current.status),
          submittedAt: String(current.submitted_at || now),
          planRevision: currentPlanRevision,
        },
        profile: responseProfile,
        dispatch: { status: "queued" },
      }, dispatchJobId);
    }
    const stored = {
      ...current,
      goals: (() => {
        const storedGoals = parseStoredJson(current.goals, []);
        return Array.isArray(storedGoals) && storedGoals.length ? storedGoals : [String(current.goal || "lower-bills")];
      })(),
      existingFeatures: parseStoredJson(current.existing_features, []),
      serviceCategories: parseStoredJson(current.service_categories, []),
      priorities: parseStoredJson(current.priorities, []),
      propertyContext: parseStoredJson(current.property_context, {}),
      projectStage: current.project_stage,
      budgetRange: current.budget_range,
      householdSituation: current.household_situation,
      propertyType: current.property_type,
      addressState: current.address_state,
      advisorProfile: normalizeCustomerAdvisorProfile(
        parseStoredJson(current.advisor_profile, {}),
        {
          postcode: current.postcode,
          addressState: current.address_state,
          householdSituation: current.household_situation,
          approvalContext: buildInstallerPropertyContext(
            parseStoredJson(current.property_context, {}),
          ).approvalContext,
        },
      ),
    };
    const readiness = submissionReadiness(stored);
    if (!readiness.ok) return json({ ok: false, error: readiness.error }, 400);
    const open = await db.prepare("SELECT COUNT(*) count FROM customer_projects WHERE firebase_uid = ? AND status IN ('matching', 'quote_review')")
      .bind(user.uid).first<{ count: number }>();
    if (Number(open?.count || 0) >= MAX_OPEN_CUSTOMER_OPPORTUNITIES) return json({ ok: false, error: "Finish or withdraw an active enquiry before submitting another one." }, 409);
    const opportunity = buildAnonymizedOpportunity(stored, id);
    const submittedAt = now;
    const submitStatements = [
      db.prepare(`UPDATE customer_accounts
        SET phone = ?, address_line_1 = ?, address_line_2 = ?, suburb = ?,
          postcode = ?, address_state = ?, updated_at = ?
        WHERE firebase_uid = ? AND account_status = 'active'
          AND EXISTS (
            SELECT 1 FROM customer_projects
            WHERE id = ? AND firebase_uid = ? AND status = 'draft'
              AND plan_revision = ? AND updated_at = ?
              AND NOT EXISTS (
                SELECT 1 FROM trade_opportunities WHERE id = ?
              )
          )`)
        .bind(
          authoritativeContact.phone,
          authoritativeContact.addressLine1,
          authoritativeContact.addressLine2,
          authoritativeContact.suburb,
          authoritativeContact.postcode,
          authoritativeContact.addressState,
          contactUpdatedAt,
          user.uid,
          id,
          user.uid,
          expectedPlanRevision,
          currentUpdatedAt,
          opportunityId,
        ),
      db.prepare(`UPDATE customer_projects
        SET status = 'matching', opportunity_id = ?, submitted_at = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'draft'
          AND plan_revision = ? AND updated_at = ?
          AND NOT EXISTS (SELECT 1 FROM trade_opportunities WHERE id = ?)
          AND EXISTS (
            SELECT 1 FROM customer_accounts
            WHERE firebase_uid = ? AND account_status = 'active'
              AND phone = ? AND address_line_1 = ? AND address_line_2 = ?
              AND suburb = ? AND postcode = ? AND address_state = ?
              AND updated_at = ?
          )`)
        .bind(opportunityId, submittedAt, submittedAt, id, user.uid,
          expectedPlanRevision, currentUpdatedAt, opportunityId,
          user.uid, authoritativeContact.phone,
          authoritativeContact.addressLine1,
          authoritativeContact.addressLine2,
          authoritativeContact.suburb,
          authoritativeContact.postcode,
          authoritativeContact.addressState,
          contactUpdatedAt),
      db.prepare(`INSERT INTO trade_opportunities
        (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status,
         source_reference, contact_limit, maximum_connected_installers, expires_at, expired_at, created_by_uid, is_synthetic, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, '', 'customer-platform', ?, ?, ?
        FROM customer_projects
        WHERE id = ? AND firebase_uid = ? AND status = 'matching'
          AND opportunity_id = ? AND submitted_at = ?
          AND plan_revision = ? AND updated_at = ?
        ON CONFLICT(id) DO NOTHING`)
        .bind(opportunityId, opportunity.title, opportunity.projectType, opportunity.postcode, opportunity.state,
          JSON.stringify(opportunity.serviceCategories), opportunity.priority, opportunity.timing, opportunity.summary,
          opportunity.sourceReference, DEFAULT_CONTACT_LIMIT, DEFAULT_CONNECTED_INSTALLERS, opportunityExpiry(),
          Number(current.is_synthetic || 0), submittedAt, submittedAt,
          id, user.uid, opportunityId, submittedAt, expectedPlanRevision, submittedAt),
      db.prepare(`INSERT INTO customer_consent_receipts
        (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
        SELECT ?, ?, ?, 'anonymized_installer_matching', ?, ?, '', ?
        FROM customer_projects
        WHERE id = ? AND firebase_uid = ? AND status = 'matching'
          AND opportunity_id = ? AND submitted_at = ?
          AND plan_revision = ? AND updated_at = ?
        ON CONFLICT(id) DO NOTHING`)
        .bind(`customer-project-submit:${id}`, user.uid, id, CUSTOMER_NOTICE_VERSION,
          submittedAt, submittedAt, id, user.uid, opportunityId, submittedAt,
          expectedPlanRevision, submittedAt),
      adminNotificationStatement(db, {
        eventKey: `customer-enquiry:${id}`,
        eventType: "customer.enquiry_submitted",
        category: "customer",
        priority: "high",
        title: "Customer enquiry submitted",
        summary: `${String(current.title).slice(0, 120)} is ready for anonymised installer matching and operations oversight.`,
        entityType: "customer_project",
        entityId: id,
        actorType: "customer",
        actorUid: user.uid,
        requiresAction: true,
        metadata: {
          opportunityId,
          state: opportunity.state,
          serviceCategories: opportunity.serviceCategories,
        },
        occurredAt: submittedAt,
      }, adminNotificationId),
      db.prepare(`INSERT INTO customer_opportunity_dispatch_jobs
        (id, opportunity_id, admin_notification_id, status, attempts, next_attempt_at,
         claimed_at, completed_at, failed_at, last_error, created_at, updated_at)
        SELECT ?, ?, ?, 'pending', 0, '', '', '', '', '', ?, ?
        FROM customer_projects
        WHERE id = ? AND firebase_uid = ? AND status = 'matching'
          AND opportunity_id = ? AND submitted_at = ?
          AND plan_revision = ? AND updated_at = ?
        ON CONFLICT(opportunity_id) DO NOTHING`)
        .bind(
          dispatchJobId,
          opportunityId,
          adminNotificationId,
          submittedAt,
          submittedAt,
          id,
          user.uid,
          opportunityId,
          submittedAt,
          expectedPlanRevision,
          submittedAt,
        ),
    ];
    if (
      photoCount > 0
      && raw.confirmAllProjectPhotoSharing === true
    ) {
      submitStatements.push(...projectPhotoSharingStatements(db, {
        projectId: id,
        customerUid: user.uid,
        occurredAt: submittedAt,
      }));
    }
    const submitResults = await db.batch(submitStatements);
    if (
      Number(submitResults[0]?.meta.changes || 0) < 1
      || Number(submitResults[1]?.meta.changes || 0) < 1
      || Number(submitResults[2]?.meta.changes || 0) < 1
    ) {
      return planRevisionConflict("This plan changed in another tab. Review the latest version before submitting.");
    }
    return dispatchJson({
      ok: true,
      project: {
        id,
        status: "matching",
        submittedAt,
        planRevision: currentPlanRevision,
      },
      profile: responseProfile,
      dispatch: { status: "queued" },
    }, dispatchJobId);
  } else if (action === "release_contact") {
    if (!user.emailVerified && !Boolean(current.is_synthetic)) {
      return json({ ok: false, error: "Verify your account email before sharing contact details with an installer." }, 403);
    }
    if (raw.confirmContactRelease !== true) {
      return json({ ok: false, error: "Confirm the named installer contact release before continuing." }, 400);
    }
    if (!["matching", "quote_review"].includes(String(current.status))) {
      return json({ ok: false, error: "Contact details can be shared only for an active project." }, 409);
    }
    const quoteId = cleanId(raw.quoteId);
    const releaseSource = await db.prepare(`SELECT q.id quote_id, q.installer_uid, q.opportunity_match_id,
      q.customer_decision, q.status quote_status, m.status match_status, o.status opportunity_status,
      a.business_name,
      c.display_name, c.phone, c.address_line_1,
      c.address_line_1 AS addressLine1, c.address_line_2, c.suburb, c.postcode,
      c.address_state, c.address_state AS addressState
      FROM customer_project_quotes q
      JOIN trade_opportunity_matches m ON m.id = q.opportunity_match_id AND m.firebase_uid = q.installer_uid
      JOIN trade_opportunities o ON o.id = q.opportunity_id
      JOIN trade_accounts a ON a.firebase_uid = q.installer_uid
        AND a.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("a")}
      JOIN customer_accounts c ON c.firebase_uid = ?
      WHERE q.id = ? AND q.project_id = ? AND q.opportunity_id = ?`)
      .bind(user.uid, quoteId, id, current.opportunity_id).first<Record<string, unknown>>();
    if (!releaseSource) return json({ ok: false, error: "Choose a valid installer quote." }, 404);
    if (releaseSource.quote_status !== "submitted" || releaseSource.customer_decision !== "shortlisted") {
      return json({ ok: false, error: "Shortlist this installer before choosing to share your contact details." }, 409);
    }
    if (!["interested", "connected"].includes(String(releaseSource.match_status)) || releaseSource.opportunity_status !== "open") {
      return json({ ok: false, error: "This installer match is no longer available for contact release." }, 409);
    }
    const contactReadiness = customerContactReadiness(releaseSource, current);
    if (!contactReadiness.ok) return json({ ok: false, error: contactReadiness.error }, 400);
    const existingRelease = await db.prepare(`SELECT id, status FROM customer_project_contact_releases
      WHERE opportunity_match_id = ? AND customer_uid = ? AND installer_uid = ?`)
      .bind(releaseSource.opportunity_match_id, user.uid, releaseSource.installer_uid)
      .first<{ id: string; status: string }>();
    if (existingRelease?.status === "active") return json({ ok: true, id, projects: await projectsForOwner(user.uid) });
    const releaseId = existingRelease?.id || `customer-contact-release:${releaseSource.opportunity_match_id}`;
    const eventId = crypto.randomUUID();
    const consentReceiptId = crypto.randomUUID();
    const disclosedFields = JSON.stringify(CUSTOMER_CONTACT_RELEASE_FIELDS);
    await db.batch([
      db.prepare(`INSERT INTO customer_project_contact_releases
        (id, project_id, opportunity_id, opportunity_match_id, quote_id, customer_uid, installer_uid,
         status, notice_version, disclosed_fields, customer_name, customer_email, customer_phone,
         address_line_1, address_line_2, suburb, address_state, postcode, granted_at, withdrawn_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
        ON CONFLICT(opportunity_match_id) DO UPDATE SET quote_id = excluded.quote_id, status = 'active',
          notice_version = excluded.notice_version, disclosed_fields = excluded.disclosed_fields,
          customer_name = excluded.customer_name, customer_email = excluded.customer_email,
          customer_phone = excluded.customer_phone, address_line_1 = excluded.address_line_1,
          address_line_2 = excluded.address_line_2, suburb = excluded.suburb,
          address_state = excluded.address_state, postcode = excluded.postcode,
          granted_at = excluded.granted_at, withdrawn_at = '', updated_at = excluded.updated_at`)
        .bind(releaseId, id, current.opportunity_id, releaseSource.opportunity_match_id, quoteId, user.uid,
          releaseSource.installer_uid, CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, disclosedFields,
          releaseSource.display_name, user.email, releaseSource.phone, releaseSource.address_line_1,
          releaseSource.address_line_2, releaseSource.suburb, releaseSource.address_state,
          releaseSource.postcode, now, now, now),
      db.prepare(`INSERT INTO customer_project_contact_release_events
        (id, release_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
         actor_uid, event_type, notice_version, disclosed_fields, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'granted', ?, ?, ?)`)
        .bind(eventId, releaseId, id, releaseSource.opportunity_match_id, user.uid, releaseSource.installer_uid,
          user.uid, CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, disclosedFields, now),
      db.prepare(`INSERT INTO customer_consent_receipts
        (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '', ?)`)
        .bind(consentReceiptId, user.uid, id, `matched_installer_contact_release:${releaseSource.opportunity_match_id}`,
          CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, now, now),
      db.prepare(`UPDATE trade_opportunity_matches SET status = 'connected', connected_at = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status IN ('interested', 'connected')`)
        .bind(now, now, releaseSource.opportunity_match_id, releaseSource.installer_uid),
      adminNotificationStatement(db, {
        eventKey: `customer-contact-release:${releaseSource.opportunity_match_id}:${now}`,
        eventType: "customer.contact_released",
        category: "customer",
        priority: "high",
        title: "Customer connected with a matched installer",
        summary: `A customer deliberately released contact details to ${String(releaseSource.business_name).slice(0, 160)}.`,
        entityType: "customer_project_contact_release",
        entityId: releaseId,
        actorType: "customer",
        actorUid: user.uid,
        requiresAction: true,
        metadata: { projectId: id, quoteId, opportunityMatchId: releaseSource.opportunity_match_id },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
  } else if (action === "withdraw_contact") {
    const quoteId = cleanId(raw.quoteId);
    const release = await db.prepare(`SELECT id, opportunity_match_id, installer_uid, notice_version, disclosed_fields
      FROM customer_project_contact_releases
      WHERE quote_id = ? AND project_id = ? AND customer_uid = ? AND status = 'active'`)
      .bind(quoteId, id, user.uid).first<Record<string, unknown>>();
    if (!release) return json({ ok: false, error: "No active contact release was found for this installer." }, 404);
    await db.batch([
      db.prepare(`UPDATE customer_project_contact_releases SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
        WHERE id = ? AND customer_uid = ? AND status = 'active'`).bind(now, now, release.id, user.uid),
      db.prepare(`INSERT INTO customer_project_contact_release_events
        (id, release_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
         actor_uid, event_type, notice_version, disclosed_fields, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'withdrawn', ?, ?, ?)`)
        .bind(crypto.randomUUID(), release.id, id, release.opportunity_match_id, user.uid, release.installer_uid,
          user.uid, release.notice_version, release.disclosed_fields, now),
      db.prepare(`UPDATE customer_consent_receipts SET withdrawn_at = ?
        WHERE firebase_uid = ? AND project_id = ? AND purpose = ? AND withdrawn_at = ''`)
        .bind(now, user.uid, id, `matched_installer_contact_release:${release.opportunity_match_id}`),
      adminNotificationStatement(db, {
        eventKey: `customer-contact-withdrawn:${release.id}:${now}`,
        eventType: "customer.contact_withdrawn",
        category: "customer",
        priority: "normal",
        title: "Customer withdrew future contact visibility",
        summary: "A customer withdrew future platform access to previously released contact details.",
        entityType: "customer_project_contact_release",
        entityId: String(release.id),
        actorType: "customer",
        actorUid: user.uid,
        requiresAction: true,
        metadata: { projectId: id, quoteId, opportunityMatchId: release.opportunity_match_id },
        occurredAt: now,
      }),
    ]);
  } else if (action === "record_outcome") {
    if (current.status === "archived") {
      return json({ ok: false, error: "Restore or duplicate this project before recording another check-in." }, 409);
    }
    const comfortOutcome = typeof raw.comfortOutcome === "string" ? raw.comfortOutcome : "";
    const energyOutcome = typeof raw.energyOutcome === "string" ? raw.energyOutcome : "";
    const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 500) : "";
    if (!COMFORT_OUTCOMES.has(comfortOutcome) || !ENERGY_OUTCOMES.has(energyOutcome)) {
      return json({ ok: false, error: "Choose valid comfort and energy-use observations." }, 400);
    }
    const completedItemIds = reconcileCompletedPlanItems(
      parseStoredJson(current.completed_plan_items, []),
      parseStoredJson(current.plan_snapshot, {}),
    );
    await db.batch([
      db.prepare(`INSERT INTO customer_project_outcome_checkins
        (id, project_id, customer_uid, comfort_outcome, energy_outcome,
         completed_item_ids, note, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, user.uid, comfortOutcome, energyOutcome,
          JSON.stringify(completedItemIds), note, now),
      db.prepare(`DELETE FROM customer_project_outcome_checkins
        WHERE project_id = ? AND customer_uid = ? AND id NOT IN (
          SELECT id FROM customer_project_outcome_checkins
          WHERE project_id = ? AND customer_uid = ?
          ORDER BY recorded_at DESC, id DESC
          LIMIT ${OUTCOME_CHECKIN_RETENTION_LIMIT}
        )`).bind(id, user.uid, id, user.uid),
      db.prepare("UPDATE customer_projects SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(now, id, user.uid),
    ]);
  } else if (action === "toggle_milestone") {
    if (current.status === "archived") return json({ ok: false, error: "Restore or duplicate this project before changing its roadmap." }, 409);
    const expectedPlanRevision = cleanPlanRevision(raw.expectedPlanRevision);
    const currentPlanRevision = Number(current.plan_revision || 1);
    if (!expectedPlanRevision) {
      return json({ ok: false, error: "Refresh this project before changing its roadmap." }, 400);
    }
    if (expectedPlanRevision !== currentPlanRevision) {
      return planRevisionConflict("This plan changed in another tab. Review the latest version before changing its progress.");
    }
    const plan = parseStoredJson(current.plan_snapshot, { items: [] });
    const allowed = new Set(Array.isArray(plan.items) ? plan.items.map((item: Record<string, unknown>) => String(item.id)) : []);
    const itemId = cleanId(raw.itemId);
    if (!allowed.has(itemId)) return json({ ok: false, error: "Choose a valid roadmap step." }, 400);
    const completed = new Set<string>(parseStoredJson(current.completed_plan_items, []));
    if (raw.complete === true) completed.add(itemId); else completed.delete(itemId);
    const toggled = await db.prepare(`UPDATE customer_projects
      SET completed_plan_items = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND plan_revision = ? AND updated_at = ?`)
      .bind(JSON.stringify([...completed]), now, id, user.uid,
        expectedPlanRevision, String(current.updated_at || "")).run();
    if (Number(toggled.meta.changes || 0) !== 1) {
      return planRevisionConflict("This plan changed in another tab. Review the latest version before changing its progress.");
    }
  } else if (action === "duplicate") {
    const count = await db.prepare("SELECT COUNT(*) count FROM customer_projects WHERE firebase_uid = ? AND status != 'archived'")
      .bind(user.uid).first<{ count: number }>();
    if (Number(count?.count || 0) >= MAX_CUSTOMER_PROJECTS) return json({ ok: false, error: "Archive an older project before duplicating this one." }, 409);
    const duplicateId = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO customer_projects
        (id, firebase_uid, title, home_nickname, postcode, address_state, property_type, household_situation,
         goal, goals, pace, existing_features, service_categories, priorities, project_stage, timing, budget_range,
         property_context, private_notes, advisor_profile, plan_snapshot, completed_plan_items, status, opportunity_id, submitted_at, archived_at, is_synthetic, created_at, updated_at)
        SELECT ?, firebase_uid, substr(title || ' copy', 1, 120), home_nickname, postcode, address_state, property_type,
         household_situation, goal, goals, pace, existing_features, service_categories, priorities, project_stage, timing,
         budget_range, property_context, private_notes, advisor_profile, plan_snapshot, '[]', 'draft', '', '', '', is_synthetic, ?, ?
        FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
        .bind(duplicateId, now, now, id, user.uid),
      db.prepare(`INSERT INTO customer_project_plan_revisions
        (id, project_id, customer_uid, revision_number, event_type, plan_version, goals,
         home_features, pace, budget_range, plan_snapshot, created_at)
        SELECT ?, ?, firebase_uid, 1, 'duplicated',
          COALESCE(CAST(json_extract(plan_snapshot, '$.version') AS text), ''),
          goals, existing_features,
          pace, budget_range, plan_snapshot, ?
        FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
        .bind(crypto.randomUUID(), duplicateId, now, id, user.uid),
    ]);
    return json({ ok: true, id: duplicateId, projects: await projectsForOwner(user.uid) }, 201);
  } else if (action === "withdraw" || action === "complete") {
    if (!current.opportunity_id) return json({ ok: false, error: "This project has not been submitted." }, 409);
    const nextStatus = action === "complete" ? "completed" : "withdrawn";
    const activeReleases = await db.prepare(`SELECT id, opportunity_match_id, installer_uid, notice_version, disclosed_fields
      FROM customer_project_contact_releases WHERE project_id = ? AND customer_uid = ? AND status = 'active'`)
      .bind(id, user.uid).all<Record<string, unknown>>();
    const closeStatements = [
      db.prepare("UPDATE customer_projects SET status = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(nextStatus, now, id, user.uid),
      db.prepare("UPDATE trade_opportunities SET status = 'closed', updated_at = ? WHERE id = ?")
        .bind(now, current.opportunity_id),
      db.prepare(`UPDATE trade_opportunity_matches SET status = 'closed', updated_at = ?
        WHERE opportunity_id = ? AND status IN ('offered', 'viewed', 'interested', 'connected')`)
        .bind(now, current.opportunity_id),
      db.prepare("UPDATE customer_project_quotes SET status = 'closed', updated_at = ? WHERE project_id = ?")
        .bind(now, id),
      db.prepare(`UPDATE customer_project_arrival_proposals SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
        WHERE project_id = ? AND customer_uid = ? AND status IN ('proposed', 'selected', 'direct_contact')`).bind(now, now, id, user.uid),
      db.prepare(`UPDATE customer_consent_receipts SET withdrawn_at = ?
        WHERE project_id = ? AND purpose IN ('anonymized_installer_matching', 'installer_evidence_sharing')
          AND withdrawn_at = ''`)
        .bind(now, id),
    ];
    for (const release of activeReleases.results) {
      closeStatements.push(
        db.prepare(`UPDATE customer_project_contact_releases SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
          WHERE id = ? AND customer_uid = ? AND status = 'active'`).bind(now, now, release.id, user.uid),
        db.prepare(`INSERT INTO customer_project_contact_release_events
          (id, release_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
           actor_uid, event_type, notice_version, disclosed_fields, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'project_closed', ?, ?, ?)`)
          .bind(crypto.randomUUID(), release.id, id, release.opportunity_match_id, user.uid, release.installer_uid,
            user.uid, release.notice_version, release.disclosed_fields, now),
        db.prepare(`UPDATE customer_consent_receipts SET withdrawn_at = ?
          WHERE firebase_uid = ? AND project_id = ? AND purpose = ? AND withdrawn_at = ''`)
          .bind(now, user.uid, id, `matched_installer_contact_release:${release.opportunity_match_id}`),
      );
    }
    await db.batch(closeStatements);
    await createAdminNotification({
      eventKey: `customer-project-${action}:${id}:${now}`,
      eventType: `customer.project_${action === "complete" ? "completed" : "withdrawn"}`,
      category: "customer",
      priority: action === "complete" ? "low" : "normal",
      title: action === "complete" ? "Customer completed a project" : "Customer withdrew an enquiry",
      summary: `${String(current.title).slice(0, 120)} was marked ${nextStatus} by the customer.`,
      entityType: "customer_project",
      entityId: id,
      actorType: "customer",
      actorUid: user.uid,
      requiresAction: false,
      metadata: { opportunityId: current.opportunity_id, status: nextStatus },
      occurredAt: now,
    });
  } else if (action === "archive") {
    if (!["draft", "withdrawn", "completed"].includes(String(current.status))) return json({ ok: false, error: "Withdraw or complete an active enquiry before archiving it." }, 409);
    const publishedHandover = await db.prepare(`SELECT id FROM trade_handover_packs
      WHERE customer_project_id = ? AND status = 'published' LIMIT 1`).bind(id).first();
    if (publishedHandover) return json({ ok: false, error: "Projects with an approved asset and handover history stay available in your completed project library." }, 409);
    await db.prepare("UPDATE customer_projects SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
      .bind(now, now, id, user.uid).run();
  } else if (action === "select_arrival_window") {
    const proposalId = cleanId(raw.proposalId);
    const windowId = cleanId(raw.windowId);
    const expectedRevision = Number(raw.expectedRevision);
    const proposal = await db.prepare(`SELECT ap.*, q.customer_decision, q.status quote_status,
      r.status contact_release_status
      FROM customer_project_arrival_proposals ap
      JOIN customer_project_quotes q ON q.id = ap.quote_id AND q.project_id = ap.project_id
      JOIN customer_project_contact_releases r ON r.opportunity_match_id = ap.opportunity_match_id
        AND r.customer_uid = ap.customer_uid AND r.installer_uid = ap.installer_uid
      JOIN trade_accounts a ON a.firebase_uid = ap.installer_uid
        AND a.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("a")}
      WHERE ap.id = ? AND ap.project_id = ? AND ap.customer_uid = ?`)
      .bind(proposalId, id, user.uid).first<Record<string, unknown>>();
    if (!proposal) return json({ ok: false, error: "Arrival window proposal not found." }, 404);
    if (proposal.customer_decision !== "accepted" || proposal.quote_status !== "submitted"
      || proposal.contact_release_status !== "active" || proposal.status !== "proposed") {
      return json({ ok: false, error: "This arrival window proposal is no longer available." }, 409);
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(proposal.revision)) {
      return json({ ok: false, error: "The installer updated these arrival windows. Refresh before choosing one." }, 409);
    }
    const selected = selectedArrivalWindow(proposal.windows, windowId);
    if (!selected) return json({ ok: false, error: "Choose one of the current installer arrival windows." }, 400);
    const nextRevision = Number(proposal.revision) + 1;
    const selectedJson = JSON.stringify(selected);
    await db.batch([
      db.prepare(`UPDATE customer_project_arrival_proposals SET status = 'selected', selected_window = ?,
        selected_at = ?, revision = ?, updated_at = ? WHERE id = ? AND customer_uid = ? AND revision = ? AND status = 'proposed'`)
        .bind(selectedJson, now, nextRevision, now, proposalId, user.uid, proposal.revision),
      db.prepare(`INSERT INTO customer_project_arrival_events
        (id, proposal_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
         actor_uid, event_type, proposal_revision, windows, selected_window, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'selected', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), proposalId, id, proposal.opportunity_match_id, user.uid, proposal.installer_uid,
          user.uid, nextRevision, proposal.windows, selectedJson, now),
      adminNotificationStatement(db, {
        eventKey: `customer-arrival-selected:${proposalId}:${nextRevision}`,
        eventType: "customer.arrival_window_selected",
        category: "customer",
        priority: "high",
        title: "Customer selected an installer arrival window",
        summary: `${String(current.title).slice(0, 120)} has a customer-selected arrival window ready for installer scheduling.`,
        entityType: "customer_project_arrival_proposal",
        entityId: proposalId,
        actorType: "customer",
        actorUid: user.uid,
        requiresAction: true,
        metadata: { projectId: id, opportunityMatchId: proposal.opportunity_match_id, selected },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
  } else if (action === "select_installer_contact") {
    const proposalId = cleanId(raw.proposalId);
    const expectedRevision = Number(raw.expectedRevision);
    const proposal = await db.prepare(`SELECT ap.*, q.customer_decision, q.status quote_status,
      r.status contact_release_status, a.business_name, a.phone installer_phone, a.email installer_email,
      a.abn installer_abn
      FROM customer_project_arrival_proposals ap
      JOIN customer_project_quotes q ON q.id = ap.quote_id AND q.project_id = ap.project_id
      JOIN customer_project_contact_releases r ON r.opportunity_match_id = ap.opportunity_match_id
        AND r.customer_uid = ap.customer_uid AND r.installer_uid = ap.installer_uid
      JOIN trade_accounts a ON a.firebase_uid = ap.installer_uid
        AND a.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("a")}
      WHERE ap.id = ? AND ap.project_id = ? AND ap.customer_uid = ?`)
      .bind(proposalId, id, user.uid).first<Record<string, unknown>>();
    if (!proposal) return json({ ok: false, error: "Arrival window proposal not found." }, 404);
    if (proposal.customer_decision !== "accepted" || proposal.quote_status !== "submitted"
      || proposal.contact_release_status !== "active" || proposal.status !== "proposed") {
      return json({ ok: false, error: "This installer contact option is no longer available." }, 409);
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(proposal.revision)) {
      return json({ ok: false, error: "The installer updated these options. Refresh before continuing." }, 409);
    }
    const directContact = {
      businessName: String(proposal.business_name || "").trim(),
      phone: String(proposal.installer_phone || "").trim(),
      email: String(proposal.installer_email || "").trim(),
      abn: String(proposal.installer_abn || "").trim(),
    };
    if (!directContact.businessName || directContact.phone.replace(/\D/g, "").length < 8
      || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(directContact.email) || !/^\d{11}$/.test(directContact.abn)) {
      return json({ ok: false, error: "This installer must complete its business name, contact number, email and ABN before direct contact can be shown." }, 409);
    }
    const nextRevision = Number(proposal.revision) + 1;
    const contactJson = JSON.stringify(directContact);
    await db.batch([
      db.prepare(`UPDATE customer_project_arrival_proposals SET status = 'direct_contact',
        direct_contact_snapshot = ?, direct_contact_selected_at = ?, selected_at = ?, revision = ?, updated_at = ?
        WHERE id = ? AND customer_uid = ? AND revision = ? AND status = 'proposed'`)
        .bind(contactJson, now, now, nextRevision, now, proposalId, user.uid, proposal.revision),
      db.prepare(`INSERT INTO customer_project_arrival_events
        (id, proposal_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
         actor_uid, event_type, proposal_revision, windows, selected_window, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'direct_contact_selected', ?, ?, '{}', ?)`)
        .bind(crypto.randomUUID(), proposalId, id, proposal.opportunity_match_id, user.uid, proposal.installer_uid,
          user.uid, nextRevision, proposal.windows, now),
      adminNotificationStatement(db, {
        eventKey: `customer-installer-direct-contact:${proposalId}:${nextRevision}`,
        eventType: "customer.installer_direct_contact_selected",
        category: "customer",
        priority: "normal",
        title: "Customer chose direct installer contact",
        summary: `${String(current.title).slice(0, 120)} may continue directly with ${directContact.businessName}.`,
        entityType: "customer_project_arrival_proposal",
        entityId: proposalId,
        actorType: "customer",
        actorUid: user.uid,
        requiresAction: false,
        metadata: { projectId: id, opportunityMatchId: proposal.opportunity_match_id, installerUid: proposal.installer_uid },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
  } else if (action === "acknowledge_arrival_preparation") {
    const proposalId = cleanId(raw.proposalId);
    if (raw.confirmAccessClear !== true || raw.confirmAdultPresent !== true || raw.confirmPetsManaged !== true) {
      return json({ ok: false, error: "Confirm each preparation item before continuing." }, 400);
    }
    const proposal = await db.prepare(`SELECT proposal.*, appointment.revision appointment_revision
      FROM customer_project_arrival_proposals proposal
      JOIN trade_crm_appointments appointment ON appointment.id = proposal.crm_appointment_id
        AND appointment.firebase_uid = proposal.installer_uid AND appointment.status = 'scheduled'
      JOIN trade_accounts account ON account.firebase_uid = proposal.installer_uid
        AND account.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("account")}
      WHERE proposal.id = ? AND proposal.project_id = ? AND proposal.customer_uid = ?
        AND proposal.status = 'selected' AND proposal.crm_appointment_id <> ''`)
      .bind(proposalId, id, user.uid).first<Record<string, unknown>>();
    if (!proposal) return json({ ok: false, error: "The CRM appointment must be prepared by the installer before confirming site readiness." }, 409);
    if (proposal.preparation_acknowledged_at) return json({ ok: true, id, projects: await projectsForOwner(user.uid) });
    await db.batch([
      db.prepare(`UPDATE customer_project_arrival_proposals SET preparation_acknowledged_at = ?, updated_at = ?
        WHERE id = ? AND customer_uid = ? AND preparation_acknowledged_at = ''`).bind(now, now, proposalId, user.uid),
      db.prepare(`INSERT INTO customer_project_arrival_events
        (id, proposal_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
         actor_uid, event_type, proposal_revision, windows, selected_window, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'preparation_acknowledged', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), proposalId, id, proposal.opportunity_match_id, user.uid, proposal.installer_uid,
          user.uid, proposal.revision, proposal.windows, proposal.selected_window, now),
    ]);
    await queueAppointmentNotifications({ appointmentId: String(proposal.crm_appointment_id), ownerUid: String(proposal.installer_uid),
      eventType: "preparation_confirmed", appointmentRevision: Number(proposal.appointment_revision || 1),
      origin: new URL(request.url).origin, occurredAt: now });
  } else if (action === "quote_decision") {
    const quoteId = cleanId(raw.quoteId);
    const decision = typeof raw.decision === "string" ? raw.decision : "";
    if (!quoteId || !["reviewing", "shortlisted", "declined", "accepted"].includes(decision)) return json({ ok: false, error: "Choose a valid quote option and decision." }, 400);
    const quote = await db.prepare(`SELECT q.id, q.installer_uid, q.opportunity_match_id, q.customer_decision,
      m.status match_status, o.status opportunity_status,
      r.id contact_release_id, r.status contact_release_status,
      a.business_name,
      c.display_name, c.phone, c.address_line_1,
      c.address_line_1 AS addressLine1, c.address_line_2, c.suburb, c.postcode,
      c.address_state, c.address_state AS addressState
      FROM customer_project_quotes q
      JOIN trade_opportunity_matches m ON m.id = q.opportunity_match_id AND m.firebase_uid = q.installer_uid
      JOIN trade_opportunities o ON o.id = q.opportunity_id
      JOIN trade_accounts a ON a.firebase_uid = q.installer_uid
        AND a.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("a")}
      JOIN customer_accounts c ON c.firebase_uid = ?
      LEFT JOIN customer_project_contact_releases r ON r.opportunity_match_id = q.opportunity_match_id
        AND r.customer_uid = c.firebase_uid AND r.installer_uid = q.installer_uid
      WHERE q.id = ? AND q.project_id = ? AND q.status = 'submitted'`)
      .bind(user.uid, quoteId, id).first<Record<string, unknown>>();
    if (!quote) return json({ ok: false, error: "Quote option not found." }, 404);
    const acceptedChoice = await db.prepare(`SELECT claim.quote_id, quote.customer_decision
      FROM customer_project_quote_acceptance_claims claim
      JOIN customer_project_quotes quote ON quote.id = claim.quote_id
        AND quote.project_id = claim.project_id
      WHERE claim.project_id = ? AND claim.customer_uid = ? LIMIT 1`)
      .bind(id, user.uid).first<Record<string, unknown>>();
    if (acceptedChoice) {
      if (
        decision === "accepted"
        && acceptedChoice.quote_id === quoteId
        && acceptedChoice.customer_decision === "accepted"
      ) {
        return json({ ok: true, id, projects: await projectsForOwner(user.uid) });
      }
      return json({
        ok: false,
        error: "This project is already connected with an installer. That contact choice is locked.",
      }, 409);
    }
    if (
      decision === "accepted"
      && quote.customer_decision === "accepted"
      && quote.contact_release_status === "active"
    ) {
      return json({ ok: true, id, projects: await projectsForOwner(user.uid) });
    }
    if (quote.customer_decision === "accepted") {
      return json({
        ok: false,
        error: "You are already connected with this installer.",
      }, 409);
    }
    const statements = [];
    let acceptanceActivity: Awaited<ReturnType<typeof customerProjectActivityStatements>> | null = null;
    if (decision === "shortlisted") {
      statements.push(db.prepare(`UPDATE customer_project_quotes
        SET customer_decision = 'reviewing', updated_at = ?
        WHERE project_id = ? AND status = 'submitted'
          AND NOT EXISTS (
            SELECT 1 FROM customer_project_quote_acceptance_claims claim
            WHERE claim.project_id = ? AND claim.customer_uid = ?
          )`).bind(now, id, id, user.uid));
    }
    if (decision === "accepted") {
      if (!user.emailVerified && !Boolean(current.is_synthetic)) {
        return json({ ok: false, error: "Verify your account email before sharing contact details with an installer." }, 403);
      }
      const legacyAcceptanceAfterRelease = raw.confirmInstallerAcceptance === true
        && quote.contact_release_status === "active"
        && quote.match_status === "connected";
      if (raw.confirmInstallerContact !== true && !legacyAcceptanceAfterRelease) {
        return json({ ok: false, error: "Confirm that you want to share your contact details with this business." }, 400);
      }
      if (!["reviewing", "shortlisted"].includes(String(quote.customer_decision))
        || !["interested", "connected"].includes(String(quote.match_status))
        || !["open", "paused"].includes(String(quote.opportunity_status))) {
        return json({ ok: false, error: "This installer is no longer available for a contact handover." }, 409);
      }
      const contactReadiness = customerContactReadiness(quote, current);
      if (!contactReadiness.ok) return json({ ok: false, error: contactReadiness.error }, 400);
      const releaseId = String(quote.contact_release_id || `customer-contact-release:${quote.opportunity_match_id}`);
      const releaseIsActive = quote.contact_release_status === "active";
      const disclosedFields = JSON.stringify(CUSTOMER_CONTACT_RELEASE_FIELDS);
      if (!releaseIsActive) {
        statements.push(
          db.prepare(`INSERT INTO customer_project_contact_releases
            (id, project_id, opportunity_id, opportunity_match_id, quote_id, customer_uid, installer_uid,
             status, notice_version, disclosed_fields, customer_name, customer_email, customer_phone,
             address_line_1, address_line_2, suburb, address_state, postcode, granted_at, withdrawn_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
            ON CONFLICT(opportunity_match_id) DO UPDATE SET quote_id = excluded.quote_id, status = 'active',
              notice_version = excluded.notice_version, disclosed_fields = excluded.disclosed_fields,
              customer_name = excluded.customer_name, customer_email = excluded.customer_email,
              customer_phone = excluded.customer_phone, address_line_1 = excluded.address_line_1,
              address_line_2 = excluded.address_line_2, suburb = excluded.suburb,
              address_state = excluded.address_state, postcode = excluded.postcode,
              granted_at = excluded.granted_at, withdrawn_at = '', updated_at = excluded.updated_at`)
            .bind(releaseId, id, current.opportunity_id, quote.opportunity_match_id, quoteId, user.uid,
              quote.installer_uid, CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, disclosedFields,
              quote.display_name, user.email, quote.phone, quote.address_line_1,
              quote.address_line_2, quote.suburb, quote.address_state,
              quote.postcode, now, now, now),
          db.prepare(`INSERT INTO customer_project_contact_release_events
            (id, release_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
             actor_uid, event_type, notice_version, disclosed_fields, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'granted', ?, ?, ?)`)
            .bind(crypto.randomUUID(), releaseId, id, quote.opportunity_match_id, user.uid, quote.installer_uid,
              user.uid, CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, disclosedFields, now),
          db.prepare(`INSERT INTO customer_consent_receipts
            (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, '', ?)`)
            .bind(crypto.randomUUID(), user.uid, id, `matched_installer_contact_release:${quote.opportunity_match_id}`,
              CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, now, now),
          db.prepare(`UPDATE trade_opportunity_matches SET status = 'connected', connected_at = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND status IN ('interested', 'connected')`)
            .bind(now, now, quote.opportunity_match_id, quote.installer_uid),
          adminNotificationStatement(db, {
            eventKey: `customer-contact-release:${quote.opportunity_match_id}`,
            eventType: "customer.contact_released",
            category: "customer",
            priority: "high",
            title: "Customer chose a business to contact",
            summary: `A customer deliberately released contact details to ${String(quote.business_name).slice(0, 160)}.`,
            entityType: "customer_project_contact_release",
            entityId: releaseId,
            actorType: "customer",
            actorUid: user.uid,
            requiresAction: true,
            metadata: { projectId: id, quoteId, opportunityMatchId: quote.opportunity_match_id },
            occurredAt: now,
          }),
        );
      }
      const otherReleases = await db.prepare(`SELECT id, opportunity_match_id, installer_uid, notice_version, disclosed_fields
        FROM customer_project_contact_releases WHERE project_id = ? AND customer_uid = ? AND status = 'active'
          AND opportunity_match_id != ?`).bind(id, user.uid, quote.opportunity_match_id).all<Record<string, unknown>>();
      statements.push(
        db.prepare(`INSERT INTO customer_project_quote_acceptance_claims
          (project_id, customer_uid, quote_id, opportunity_match_id,
           contact_release_id, accepted_at, created_at)
          VALUES (?, ?, COALESCE((
            SELECT candidate.id
            FROM customer_project_quotes candidate
            JOIN trade_opportunity_matches candidate_match
              ON candidate_match.id = candidate.opportunity_match_id
              AND candidate_match.firebase_uid = candidate.installer_uid
            JOIN trade_opportunities candidate_opportunity
              ON candidate_opportunity.id = candidate.opportunity_id
            JOIN customer_project_contact_releases candidate_release
              ON candidate_release.id = ?
              AND candidate_release.project_id = candidate.project_id
              AND candidate_release.quote_id = candidate.id
              AND candidate_release.customer_uid = ?
              AND candidate_release.installer_uid = candidate.installer_uid
              AND candidate_release.status = 'active'
            WHERE candidate.id = ? AND candidate.project_id = ?
              AND candidate.installer_uid = ?
              AND candidate.status = 'submitted'
              AND candidate.customer_decision IN ('reviewing', 'shortlisted')
              AND candidate_match.status IN ('interested', 'connected')
              AND candidate_opportunity.status IN ('open', 'paused')
              AND NOT EXISTS (
                SELECT 1 FROM customer_project_quotes accepted
                WHERE accepted.project_id = candidate.project_id
                  AND accepted.status = 'submitted'
                  AND accepted.customer_decision = 'accepted'
              )
          ), ''), ?, ?, ?, ?)`)
          .bind(id, user.uid, releaseId, user.uid, quoteId, id,
            quote.installer_uid, quote.opportunity_match_id,
            releaseId, now, now),
        db.prepare(`UPDATE customer_project_quotes SET customer_decision = 'declined', updated_at = ?
          WHERE project_id = ? AND status = 'submitted' AND id != ?`).bind(now, id, quoteId),
        db.prepare("UPDATE trade_opportunities SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'open'")
          .bind(now, current.opportunity_id),
        db.prepare(`UPDATE trade_opportunity_matches SET status = 'closed', updated_at = ?
          WHERE opportunity_id = ? AND id != ? AND status IN ('offered', 'viewed', 'interested', 'connected')`)
          .bind(now, current.opportunity_id, quote.opportunity_match_id),
      );
      for (const release of otherReleases.results) {
        statements.push(
          db.prepare(`UPDATE customer_project_contact_releases SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
            WHERE id = ? AND customer_uid = ? AND status = 'active'`).bind(now, now, release.id, user.uid),
          db.prepare(`INSERT INTO customer_project_contact_release_events
            (id, release_id, project_id, opportunity_match_id, customer_uid, installer_uid, actor_type,
             actor_uid, event_type, notice_version, disclosed_fields, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'customer', ?, 'installer_not_selected', ?, ?, ?)`)
            .bind(crypto.randomUUID(), release.id, id, release.opportunity_match_id, user.uid, release.installer_uid,
              user.uid, release.notice_version, release.disclosed_fields, now),
          db.prepare(`UPDATE customer_consent_receipts SET withdrawn_at = ?
            WHERE firebase_uid = ? AND project_id = ? AND purpose = ? AND withdrawn_at = ''`)
            .bind(now, user.uid, id, `matched_installer_contact_release:${release.opportunity_match_id}`),
        );
      }
      acceptanceActivity = await customerProjectActivityStatements(db, {
        eventKey: `platform-installer-accepted:${quoteId}`,
        projectId: id,
        quoteId,
        opportunityMatchId: String(quote.opportunity_match_id),
        customerUid: user.uid,
        installerUid: String(quote.installer_uid),
        eventType: "customer_installer_accepted",
        audience: "installer",
        actorType: "customer",
        actorUid: user.uid,
        occurredAt: now,
      });
      statements.push(...acceptanceActivity.statements);
    }
    const decisionMutationIndex = statements.length;
    statements.push(decision === "accepted"
      ? db.prepare(`UPDATE customer_project_quotes
          SET customer_decision = 'accepted', updated_at = ?
          WHERE id = ? AND project_id = ? AND customer_decision IN ('reviewing', 'shortlisted')
            AND EXISTS (
              SELECT 1 FROM customer_project_quote_acceptance_claims claim
              WHERE claim.project_id = ? AND claim.customer_uid = ? AND claim.quote_id = ?
            )`).bind(now, quoteId, id, id, user.uid, quoteId)
      : db.prepare(`UPDATE customer_project_quotes
          SET customer_decision = ?, updated_at = ?
          WHERE id = ? AND project_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM customer_project_quote_acceptance_claims claim
              WHERE claim.project_id = ? AND claim.customer_uid = ?
            )`).bind(decision, now, quoteId, id, id, user.uid));
    statements.push(decision === "accepted"
      ? db.prepare(`UPDATE customer_projects SET updated_at = ?
          WHERE id = ? AND firebase_uid = ?
            AND EXISTS (
              SELECT 1 FROM customer_project_quote_acceptance_claims claim
              WHERE claim.project_id = ? AND claim.customer_uid = ? AND claim.quote_id = ?
            )`).bind(now, id, user.uid, id, user.uid, quoteId)
      : db.prepare(`UPDATE customer_projects SET updated_at = ?
          WHERE id = ? AND firebase_uid = ?
            AND NOT EXISTS (
              SELECT 1 FROM customer_project_quote_acceptance_claims claim
              WHERE claim.project_id = ? AND claim.customer_uid = ?
            )`).bind(now, id, user.uid, id, user.uid));
    const adminInput: Parameters<typeof createAdminNotification>[0] = {
      eventKey: decision === "accepted"
        ? `customer-quote-decision:${quoteId}:accepted`
        : `customer-quote-decision:${quoteId}:${decision}:${now}`,
      eventType: `customer.quote_${decision}`,
      category: "customer",
      priority: ["shortlisted", "accepted"].includes(decision) ? "high" : "normal",
      title: decision === "accepted" ? "Customer chose a business to contact" : decision === "shortlisted" ? "Customer shortlisted a quote" : "Customer updated a quote decision",
      summary: decision === "accepted"
        ? `${String(current.title).slice(0, 120)} is connected with the chosen business.`
        : `${String(current.title).slice(0, 120)} has a quote marked ${decision}.`,
      entityType: "customer_project_quote",
      entityId: quoteId,
      actorType: "customer",
      actorUid: user.uid,
      requiresAction: ["shortlisted", "accepted"].includes(decision),
      metadata: { projectId: id, decision },
      occurredAt: now,
    };
    if (decision === "accepted") {
      statements.push(adminNotificationStatement(db, adminInput));
    }
    let decisionResults;
    try {
      decisionResults = await db.batch(statements);
    } catch {
      const winner = await db.prepare(`SELECT claim.quote_id, quote.customer_decision
        FROM customer_project_quote_acceptance_claims claim
        JOIN customer_project_quotes quote ON quote.id = claim.quote_id
        WHERE claim.project_id = ? AND claim.customer_uid = ? LIMIT 1`)
        .bind(id, user.uid).first<Record<string, unknown>>();
      if (
        decision === "accepted"
        && winner?.quote_id === quoteId
        && winner.customer_decision === "accepted"
      ) {
        return json({ ok: true, id, projects: await projectsForOwner(user.uid) });
      }
      if (winner) {
        return json({
          ok: false,
          error: "This project is already connected with an installer. That contact choice is locked.",
        }, 409);
      }
      return json({ ok: false, error: "The quote decision could not be saved." }, 500);
    }
    if (Number(decisionResults[decisionMutationIndex]?.meta.changes || 0) !== 1) {
      return json({
        ok: false,
        error: "This project is already connected with an installer. That contact choice is locked.",
      }, 409);
    }
    if (decision !== "accepted") await createAdminNotification(adminInput);
    if (acceptanceActivity) activityDeliveryId = acceptanceActivity.deliveryId;
  } else {
    return json({ ok: false, error: "Choose a valid project action." }, 400);
  }
  const responseBody = {
    ok: true,
    id,
    ...(responseProfile ? { profile: responseProfile } : {}),
    projects: await projectsForOwner(user.uid),
  };
  return activityDeliveryId
    ? activityDispatchJson(responseBody, activityDeliveryId)
    : json(responseBody);
}
