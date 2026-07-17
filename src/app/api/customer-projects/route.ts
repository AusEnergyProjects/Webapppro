import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { postcodeMatchesState } from "@/lib/australian-postcodes.mjs";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import { allocateNearestInstallers, DEFAULT_CONNECTED_INSTALLERS, DEFAULT_CONTACT_LIMIT, opportunityExpiry } from "@/lib/opportunity-server";
import { adminNotificationStatement, createAdminNotification } from "@/lib/admin-notifications";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";
import {
  buildAnonymizedOpportunity,
  CUSTOMER_CONTACT_RELEASE_FIELDS,
  CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION,
  CUSTOMER_NOTICE_VERSION,
  MAX_CUSTOMER_PROJECTS,
  MAX_OPEN_CUSTOMER_OPPORTUNITIES,
  normalizeCustomerProject,
  parseStoredJson,
  customerContactReadiness,
  submissionReadiness,
} from "@/lib/customer-projects.mjs";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
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
  hasRetainedAssetHistory: boolean,
  contactReady: boolean,
) {
  const status = String(row.status);
  const responseCount = Number(progress?.response_count || 0);
  const quoteCount = quotes.length;
  const displayStatus = status === "matching" && quoteCount
    ? "quote_review"
    : status === "matching" && responseCount
      ? "responses"
      : status;
  return {
    id: row.id,
    title: row.title,
    homeNickname: row.home_nickname,
    postcode: row.postcode,
    addressState: row.address_state,
    propertyType: row.property_type,
    householdSituation: row.household_situation,
    goal: row.goal,
    pace: row.pace,
    existingFeatures: parseStoredJson(row.existing_features, []),
    serviceCategories: parseStoredJson(row.service_categories, []),
    priorities: parseStoredJson(row.priorities, []),
    projectStage: row.project_stage,
    timing: row.timing,
    budgetRange: row.budget_range,
    privateNotes: row.private_notes,
    planSnapshot: parseStoredJson(row.plan_snapshot, {}),
    completedPlanItems: parseStoredJson(row.completed_plan_items, []),
    status,
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
      submittedAt: quote.submitted_at,
      updatedAt: quote.updated_at,
    })),
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

async function projectsForOwner(firebaseUid: string) {
  const db = getD1();
  const account = await db.prepare(`SELECT display_name, email, phone, address_line_1, address_line_2,
    suburb, postcode, address_state FROM customer_accounts WHERE firebase_uid = ?`)
    .bind(firebaseUid).first<Record<string, unknown>>();
  const rows = await db.prepare("SELECT * FROM customer_projects WHERE firebase_uid = ? ORDER BY archived_at = '', updated_at DESC LIMIT 100")
    .bind(firebaseUid).all<Record<string, unknown>>();
  const opportunityIds = rows.results.map((row: Record<string, unknown>) => String(row.opportunity_id || "")).filter(Boolean);
  const projectIds = rows.results.map((row: Record<string, unknown>) => String(row.id));
  const progressRows = opportunityIds.length ? await db.prepare(`SELECT o.id opportunity_id, o.status opportunity_status, o.expires_at,
    COUNT(m.id) installer_count,
    SUM(CASE WHEN m.status IN ('offered', 'viewed') THEN 1 ELSE 0 END) reviewing_count,
    SUM(CASE WHEN m.status IN ('interested', 'connected') THEN 1 ELSE 0 END) response_count
    FROM trade_opportunities o LEFT JOIN trade_opportunity_matches m ON m.opportunity_id = o.id
    WHERE o.id IN (${opportunityIds.map(() => "?").join(",")}) GROUP BY o.id`)
    .bind(...opportunityIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const quoteRows = projectIds.length ? await db.prepare(`SELECT q.id, q.project_id, q.inclusions, q.product_snapshot,
    product_subtotal_cents_ex_gst, labour_cents_ex_gst, other_cents_ex_gst, total_cents_ex_gst,
    quote_type, start_window, duration_weeks, workmanship_warranty_years, customer_decision, q.submitted_at, q.updated_at,
    a.business_name installer_business_name, a.verification_status installer_verification_status,
    r.status contact_release_status, r.granted_at contact_granted_at, r.withdrawn_at contact_withdrawn_at
    FROM customer_project_quotes q
    JOIN trade_accounts a ON a.firebase_uid = q.installer_uid
    LEFT JOIN customer_project_contact_releases r ON r.opportunity_match_id = q.opportunity_match_id
    WHERE q.project_id IN (${projectIds.map(() => "?").join(",")}) AND q.status = 'submitted'
    ORDER BY q.submitted_at, q.id`).bind(...projectIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const retainedHandoverRows = projectIds.length ? await db.prepare(`SELECT DISTINCT customer_project_id
    FROM trade_handover_packs WHERE customer_project_id IN (${projectIds.map(() => "?").join(",")})
      AND status = 'published'`).bind(...projectIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const handoverRows = projectIds.length ? await db.prepare(`SELECT p.id, p.customer_project_id, p.service_category,
    p.published_at, p.updated_at, w.work_number
    FROM trade_handover_packs p JOIN trade_work_orders w ON w.id = p.work_order_id
    WHERE p.customer_project_id IN (${projectIds.map(() => "?").join(",")}) AND p.status = 'published'
      AND (NOT EXISTS (SELECT 1 FROM customer_asset_ownerships history WHERE history.handover_pack_id = p.id)
        OR EXISTS (SELECT 1 FROM customer_asset_ownerships ownership
          WHERE ownership.handover_pack_id = p.id AND ownership.customer_uid = ? AND ownership.status = 'active'))
    ORDER BY p.published_at DESC`).bind(...projectIds, firebaseUid).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const handoverIds = handoverRows.results.map((row: Record<string, unknown>) => String(row.id));
  const assetRows = handoverIds.length ? await db.prepare(`SELECT handover_pack_id, id, asset_category, brand,
    model_number, serial_number, quantity, installed_at, warranty_provider, warranty_reference,
    warranty_start, warranty_end FROM trade_installed_assets
    WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")}) AND record_status = 'active'
    ORDER BY created_at`).bind(...handoverIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const complianceRows = handoverIds.length ? await db.prepare(`SELECT handover_pack_id, id, label, status, completed_at
    FROM trade_compliance_items WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")})
    ORDER BY created_at`).bind(...handoverIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const documentRows = handoverIds.length ? await db.prepare(`SELECT handover_pack_id, id, category, file_name,
    content_type, size_bytes, created_at FROM trade_handover_documents
    WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")}) AND customer_visible = 1
    ORDER BY created_at DESC`).bind(...handoverIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const correctionRows = handoverIds.length ? await db.prepare(`SELECT handover_pack_id, id, asset_id, version_number,
    field_key, previous_value, proposed_value, reason, published_at
    FROM trade_handover_corrections WHERE handover_pack_id IN (${handoverIds.map(() => "?").join(",")})
      AND status = 'published' ORDER BY version_number DESC`)
    .bind(...handoverIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
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
    retainedHandoverRows.results.some((handover: Record<string, unknown>) => handover.customer_project_id === row.id),
    Boolean(account && customerContactReadiness(account, row).ok),
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
  const db = getD1();
  const account = await db.prepare(`SELECT account_status, COALESCE(is_synthetic, 0) is_synthetic,
    phone, address_line_1, suburb, postcode, address_state FROM customer_accounts WHERE firebase_uid = ?`)
    .bind(user.uid).first<Record<string, unknown>>();
  if (!account) return json({ ok: false, error: "Complete your private household profile first." }, 404);
  if (account.account_status !== "active") return json({ ok: false, error: "This customer account is not active." }, 403);
  const count = await db.prepare("SELECT COUNT(*) count FROM customer_projects WHERE firebase_uid = ? AND status != 'archived'")
    .bind(user.uid).first<{ count: number }>();
  if (Number(count?.count || 0) >= MAX_CUSTOMER_PROJECTS) return json({ ok: false, error: "Archive an older project before creating another one." }, 409);
  const normalized = normalizeCustomerProject(raw);
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
  const project = normalized.project;
  if (!project) return json({ ok: false, error: "Invalid project details." }, 400);
  if (!postcodeCoordinate(project.postcode)) return json({ ok: false, error: "Enter a recognised Australian project postcode." }, 400);
  if (!postcodeMatchesState(project.postcode, project.addressState)) {
    return json({ ok: false, error: "The project postcode does not match the selected state or territory." }, 400);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO customer_projects
    (id, firebase_uid, title, home_nickname, postcode, address_state, property_type, household_situation,
     goal, pace, existing_features, service_categories, priorities, project_stage, timing, budget_range,
     private_notes, plan_snapshot, completed_plan_items, status, opportunity_id, submitted_at, archived_at, is_synthetic, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'draft', '', '', '', ?, ?, ?)`)
    .bind(id, user.uid, project.title, project.homeNickname, project.postcode, project.addressState,
      project.propertyType, project.householdSituation, project.goal, project.pace,
      JSON.stringify(project.existingFeatures), JSON.stringify(project.serviceCategories), JSON.stringify(project.priorities),
      project.projectStage, project.timing, project.budgetRange, project.privateNotes,
      JSON.stringify(project.planSnapshot), Number(account.is_synthetic || 0), now, now).run();
  return json({ ok: true, id, projects: await projectsForOwner(user.uid) }, 201);
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (Number(request.headers.get("content-length") || 0) > 40_000) return json({ ok: false, error: "The project update was too large." }, 413);
  let raw: Record<string, unknown>;
  try { raw = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: "Invalid project update." }, 400); }
  const action = typeof raw.action === "string" ? raw.action : "update";
  const id = cleanId(raw.id);
  if (!id) return json({ ok: false, error: "Choose a valid project." }, 400);
  const db = getD1();
  const current = await ownedProject(user.uid, id);
  if (!current) return json({ ok: false, error: "Project not found." }, 404);
  const now = new Date().toISOString();

  if (action === "update") {
    if (current.status !== "draft") return json({ ok: false, error: "Submitted projects are locked. Duplicate this project to revise its installer scope." }, 409);
    const normalized = normalizeCustomerProject(raw);
    if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
    const project = normalized.project;
    if (!project) return json({ ok: false, error: "Invalid project update." }, 400);
    if (!postcodeCoordinate(project.postcode)) return json({ ok: false, error: "Enter a recognised Australian project postcode." }, 400);
    if (!postcodeMatchesState(project.postcode, project.addressState)) {
      return json({ ok: false, error: "The project postcode does not match the selected state or territory." }, 400);
    }
    await db.prepare(`UPDATE customer_projects SET title = ?, home_nickname = ?, postcode = ?, address_state = ?,
      property_type = ?, household_situation = ?, goal = ?, pace = ?, existing_features = ?, service_categories = ?,
      priorities = ?, project_stage = ?, timing = ?, budget_range = ?, private_notes = ?, plan_snapshot = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = 'draft'`)
      .bind(project.title, project.homeNickname, project.postcode, project.addressState, project.propertyType,
        project.householdSituation, project.goal, project.pace, JSON.stringify(project.existingFeatures),
        JSON.stringify(project.serviceCategories), JSON.stringify(project.priorities), project.projectStage,
        project.timing, project.budgetRange, project.privateNotes, JSON.stringify(project.planSnapshot), now, id, user.uid).run();
  } else if (action === "submit") {
    if (!user.emailVerified && !Boolean(current.is_synthetic)) return json({ ok: false, error: "Verify your account email before requesting installer responses." }, 403);
    if (current.status !== "draft") return json({ ok: true, id, projects: await projectsForOwner(user.uid) });
    const stored = {
      ...current,
      existingFeatures: parseStoredJson(current.existing_features, []),
      serviceCategories: parseStoredJson(current.service_categories, []),
      priorities: parseStoredJson(current.priorities, []),
      projectStage: current.project_stage,
      budgetRange: current.budget_range,
      householdSituation: current.household_situation,
      propertyType: current.property_type,
      addressState: current.address_state,
    };
    const readiness = submissionReadiness(stored);
    if (!readiness.ok) return json({ ok: false, error: readiness.error }, 400);
    const contactAccount = await db.prepare(`SELECT phone, address_line_1, suburb, postcode, address_state
      FROM customer_accounts WHERE firebase_uid = ? AND account_status = 'active'`)
      .bind(user.uid).first<Record<string, unknown>>();
    const contactReadiness = customerContactReadiness(contactAccount || {}, current);
    if (!contactReadiness.ok) return json({ ok: false, error: contactReadiness.error }, 400);
    const open = await db.prepare("SELECT COUNT(*) count FROM customer_projects WHERE firebase_uid = ? AND status IN ('matching', 'quote_review')")
      .bind(user.uid).first<{ count: number }>();
    if (Number(open?.count || 0) >= MAX_OPEN_CUSTOMER_OPPORTUNITIES) return json({ ok: false, error: "Finish or withdraw an active enquiry before submitting another one." }, 409);
    const opportunity = buildAnonymizedOpportunity(stored, id);
    const opportunityId = `customer-project:${id}`;
    const submittedAt = now;
    await db.batch([
      db.prepare(`INSERT INTO trade_opportunities
        (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status,
         source_reference, contact_limit, maximum_connected_installers, expires_at, expired_at, created_by_uid, is_synthetic, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, '', 'customer-platform', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`)
        .bind(opportunityId, opportunity.title, opportunity.projectType, opportunity.postcode, opportunity.state,
          JSON.stringify(opportunity.serviceCategories), opportunity.priority, opportunity.timing, opportunity.summary,
          opportunity.sourceReference, DEFAULT_CONTACT_LIMIT, DEFAULT_CONNECTED_INSTALLERS, opportunityExpiry(), Number(current.is_synthetic || 0), submittedAt, submittedAt),
      db.prepare(`UPDATE customer_projects SET status = 'matching', opportunity_id = ?, submitted_at = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'draft'`).bind(opportunityId, submittedAt, submittedAt, id, user.uid),
      db.prepare(`INSERT INTO customer_consent_receipts
        (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
        VALUES (?, ?, ?, 'anonymized_installer_matching', ?, ?, '', ?) ON CONFLICT(id) DO NOTHING`)
        .bind(`customer-project-submit:${id}`, user.uid, id, CUSTOMER_NOTICE_VERSION, submittedAt, submittedAt),
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
        metadata: { opportunityId, state: opportunity.state, serviceCategories: opportunity.serviceCategories },
        occurredAt: submittedAt,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
    await allocateNearestInstallers(opportunityId, "customer-platform").catch(() => null);
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
      a.business_name, a.verification_status, a.account_status,
      c.display_name, c.phone, c.address_line_1, c.address_line_2, c.suburb, c.postcode, c.address_state
      FROM customer_project_quotes q
      JOIN trade_opportunity_matches m ON m.id = q.opportunity_match_id AND m.firebase_uid = q.installer_uid
      JOIN trade_opportunities o ON o.id = q.opportunity_id
      JOIN trade_accounts a ON a.firebase_uid = q.installer_uid
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
    if (releaseSource.verification_status !== "approved" || releaseSource.account_status !== "active") {
      return json({ ok: false, error: "Contact details can be shared only with an active verified installer." }, 409);
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
  } else if (action === "toggle_milestone") {
    if (current.status === "archived") return json({ ok: false, error: "Restore or duplicate this project before changing its roadmap." }, 409);
    const plan = parseStoredJson(current.plan_snapshot, { items: [] });
    const allowed = new Set(Array.isArray(plan.items) ? plan.items.map((item: Record<string, unknown>) => String(item.id)) : []);
    const itemId = cleanId(raw.itemId);
    if (!allowed.has(itemId)) return json({ ok: false, error: "Choose a valid roadmap step." }, 400);
    const completed = new Set<string>(parseStoredJson(current.completed_plan_items, []));
    if (raw.complete === true) completed.add(itemId); else completed.delete(itemId);
    await db.prepare("UPDATE customer_projects SET completed_plan_items = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
      .bind(JSON.stringify([...completed]), now, id, user.uid).run();
  } else if (action === "duplicate") {
    const count = await db.prepare("SELECT COUNT(*) count FROM customer_projects WHERE firebase_uid = ? AND status != 'archived'")
      .bind(user.uid).first<{ count: number }>();
    if (Number(count?.count || 0) >= MAX_CUSTOMER_PROJECTS) return json({ ok: false, error: "Archive an older project before duplicating this one." }, 409);
    const duplicateId = crypto.randomUUID();
    await db.prepare(`INSERT INTO customer_projects
      (id, firebase_uid, title, home_nickname, postcode, address_state, property_type, household_situation,
       goal, pace, existing_features, service_categories, priorities, project_stage, timing, budget_range,
       private_notes, plan_snapshot, completed_plan_items, status, opportunity_id, submitted_at, archived_at, is_synthetic, created_at, updated_at)
      SELECT ?, firebase_uid, substr(title || ' copy', 1, 120), home_nickname, postcode, address_state, property_type,
       household_situation, goal, pace, existing_features, service_categories, priorities, project_stage, timing,
       budget_range, private_notes, plan_snapshot, '[]', 'draft', '', '', '', is_synthetic, ?, ?
      FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
      .bind(duplicateId, now, now, id, user.uid).run();
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
      db.prepare("UPDATE customer_consent_receipts SET withdrawn_at = ? WHERE project_id = ? AND purpose = 'anonymized_installer_matching' AND withdrawn_at = ''")
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
  } else if (action === "quote_decision") {
    const quoteId = cleanId(raw.quoteId);
    const decision = typeof raw.decision === "string" ? raw.decision : "";
    if (!quoteId || !["reviewing", "shortlisted", "declined"].includes(decision)) return json({ ok: false, error: "Choose a valid quote option and decision." }, 400);
    const quote = await db.prepare("SELECT id FROM customer_project_quotes WHERE id = ? AND project_id = ? AND status = 'submitted'")
      .bind(quoteId, id).first();
    if (!quote) return json({ ok: false, error: "Quote option not found." }, 404);
    const statements = [];
    if (decision === "shortlisted") statements.push(db.prepare("UPDATE customer_project_quotes SET customer_decision = 'reviewing', updated_at = ? WHERE project_id = ? AND status = 'submitted'").bind(now, id));
    statements.push(db.prepare("UPDATE customer_project_quotes SET customer_decision = ?, updated_at = ? WHERE id = ? AND project_id = ?").bind(decision, now, quoteId, id));
    await db.batch(statements);
    await createAdminNotification({
      eventKey: `customer-quote-decision:${quoteId}:${decision}:${now}`,
      eventType: `customer.quote_${decision}`,
      category: "customer",
      priority: decision === "shortlisted" ? "high" : "normal",
      title: decision === "shortlisted" ? "Customer shortlisted a quote" : "Customer updated a quote decision",
      summary: `${String(current.title).slice(0, 120)} has a quote marked ${decision}.`,
      entityType: "customer_project_quote",
      entityId: quoteId,
      actorType: "customer",
      actorUid: user.uid,
      requiresAction: decision === "shortlisted",
      metadata: { projectId: id, decision },
      occurredAt: now,
    });
  } else {
    return json({ ok: false, error: "Choose a valid project action." }, 400);
  }
  return json({ ok: true, id, projects: await projectsForOwner(user.uid) });
}
