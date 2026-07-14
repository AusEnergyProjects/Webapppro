import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { postcodeMatchesState } from "@/lib/australian-postcodes.mjs";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import { allocateNearestInstallers, DEFAULT_CONNECTED_INSTALLERS, DEFAULT_CONTACT_LIMIT, opportunityExpiry } from "@/lib/opportunity-server";
import { adminNotificationStatement, createAdminNotification } from "@/lib/admin-notifications";
import {
  buildAnonymizedOpportunity,
  CUSTOMER_NOTICE_VERSION,
  MAX_CUSTOMER_PROJECTS,
  MAX_OPEN_CUSTOMER_OPPORTUNITIES,
  normalizeCustomerProject,
  parseStoredJson,
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

function projectShape(row: Record<string, unknown>, progress: Record<string, unknown> | undefined, quotes: Record<string, unknown>[]) {
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
      submittedAt: quote.submitted_at,
      updatedAt: quote.updated_at,
    })),
  };
}

async function ownedProject(firebaseUid: string, id: string) {
  return getD1().prepare("SELECT * FROM customer_projects WHERE id = ? AND firebase_uid = ?")
    .bind(id, firebaseUid).first<Record<string, unknown>>();
}

async function projectsForOwner(firebaseUid: string) {
  const db = getD1();
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
  const quoteRows = projectIds.length ? await db.prepare(`SELECT id, project_id, inclusions, product_snapshot,
    product_subtotal_cents_ex_gst, labour_cents_ex_gst, other_cents_ex_gst, total_cents_ex_gst,
    quote_type, start_window, duration_weeks, workmanship_warranty_years, customer_decision, submitted_at, updated_at
    FROM customer_project_quotes WHERE project_id IN (${projectIds.map(() => "?").join(",")}) AND status = 'submitted'
    ORDER BY submitted_at, id`).bind(...projectIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  return rows.results.map((row: Record<string, unknown>) => projectShape(
    row,
    progressRows.results.find((progress: Record<string, unknown>) => progress.opportunity_id === row.opportunity_id),
    quoteRows.results.filter((quote: Record<string, unknown>) => quote.project_id === row.id),
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
  const account = await db.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid = ?")
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
     private_notes, plan_snapshot, completed_plan_items, status, opportunity_id, submitted_at, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'draft', '', '', '', ?, ?)`)
    .bind(id, user.uid, project.title, project.homeNickname, project.postcode, project.addressState,
      project.propertyType, project.householdSituation, project.goal, project.pace,
      JSON.stringify(project.existingFeatures), JSON.stringify(project.serviceCategories), JSON.stringify(project.priorities),
      project.projectStage, project.timing, project.budgetRange, project.privateNotes,
      JSON.stringify(project.planSnapshot), now, now).run();
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
    if (!user.emailVerified) return json({ ok: false, error: "Verify your account email before requesting installer responses." }, 403);
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
    const open = await db.prepare("SELECT COUNT(*) count FROM customer_projects WHERE firebase_uid = ? AND status IN ('matching', 'quote_review')")
      .bind(user.uid).first<{ count: number }>();
    if (Number(open?.count || 0) >= MAX_OPEN_CUSTOMER_OPPORTUNITIES) return json({ ok: false, error: "Finish or withdraw an active enquiry before submitting another one." }, 409);
    const opportunity = buildAnonymizedOpportunity(stored, id);
    const opportunityId = `customer-project:${id}`;
    const submittedAt = now;
    await db.batch([
      db.prepare(`INSERT INTO trade_opportunities
        (id, title, project_type, postcode, state, service_categories, priority, timing, summary, status,
         source_reference, contact_limit, maximum_connected_installers, expires_at, expired_at, created_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, '', 'customer-platform', ?, ?)
        ON CONFLICT(id) DO NOTHING`)
        .bind(opportunityId, opportunity.title, opportunity.projectType, opportunity.postcode, opportunity.state,
          JSON.stringify(opportunity.serviceCategories), opportunity.priority, opportunity.timing, opportunity.summary,
          opportunity.sourceReference, DEFAULT_CONTACT_LIMIT, DEFAULT_CONNECTED_INSTALLERS, opportunityExpiry(), submittedAt, submittedAt),
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
    await allocateNearestInstallers(opportunityId, "customer-platform").catch(() => null);
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
       private_notes, plan_snapshot, completed_plan_items, status, opportunity_id, submitted_at, archived_at, created_at, updated_at)
      SELECT ?, firebase_uid, substr(title || ' copy', 1, 120), home_nickname, postcode, address_state, property_type,
       household_situation, goal, pace, existing_features, service_categories, priorities, project_stage, timing,
       budget_range, private_notes, plan_snapshot, '[]', 'draft', '', '', '', ?, ?
      FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
      .bind(duplicateId, now, now, id, user.uid).run();
    return json({ ok: true, id: duplicateId, projects: await projectsForOwner(user.uid) }, 201);
  } else if (action === "withdraw" || action === "complete") {
    if (!current.opportunity_id) return json({ ok: false, error: "This project has not been submitted." }, 409);
    const nextStatus = action === "complete" ? "completed" : "withdrawn";
    await db.batch([
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
    ]);
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
