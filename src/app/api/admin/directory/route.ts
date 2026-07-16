import { getD1 } from "../../../../../db";
import { postcodeMatchesState } from "@/lib/australian-postcodes.mjs";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import {
  adminError,
  adminJson,
  cleanAdminText,
  parseJsonList,
  requireAdminIdentity,
  sameOrigin,
  writeAdminAudit,
} from "@/lib/admin-server";

export const runtime = "edge";

const ACCOUNT_TYPES = new Set(["customer", "installer", "supplier", "admin"]);
const CUSTOMER_STATUSES = new Set(["active", "suspended", "closed"]);
const STATES = new Set(["ACT", "NSW", "NT", "Qld", "SA", "Tas", "Vic", "WA"]);
const PROPERTY_TYPES = new Set(["house", "townhouse", "apartment", "new-build", "other"]);
const HOUSEHOLD_SITUATIONS = new Set(["owner", "renter", "strata", "planning-building"]);
const PAGE_SIZES = new Set([25, 50, 100]);

function directoryItem(row: Record<string, unknown>, revealCustomer: boolean) {
  const accountType = String(row.account_type);
  const customer = accountType === "customer";
  return {
    accountKey: `${accountType}:${row.firebase_uid}`,
    firebaseUid: row.firebase_uid,
    accountType,
    name: customer && !revealCustomer ? "Private customer account" : row.name,
    email: customer && !revealCustomer ? "" : row.email,
    secondary: row.secondary,
    addressState: customer && !revealCustomer ? "" : row.address_state,
    postcode: customer && !revealCustomer ? "" : row.postcode,
    accountStatus: row.account_status,
    verificationStatus: row.verification_status,
    planKey: row.plan_key,
    isSynthetic: Boolean(row.is_synthetic),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request);
    const url = new URL(request.url);
    const uid = cleanAdminText(url.searchParams.get("uid"), 180);
    const requestedType = cleanAdminText(url.searchParams.get("type"), 30);
    const db = getD1();

    if (uid && requestedType) {
      if (!ACCOUNT_TYPES.has(requestedType)) return adminJson({ ok: false, error: "Choose a valid account type." }, 400);
      if (requestedType === "customer") {
        if (!["owner", "admin", "support"].includes(admin.role)) {
          return adminJson({ ok: false, error: "Your operations role cannot open private customer records." }, 403);
        }
        const account = await db.prepare(`SELECT firebase_uid, email, display_name, postcode, address_state,
          property_type, household_situation, account_updates, account_status, consent_version, consent_at,
          is_synthetic, created_at, updated_at FROM customer_accounts WHERE firebase_uid = ?`).bind(uid).first<Record<string, unknown>>();
        if (!account) return adminJson({ ok: false, error: "Customer account not found." }, 404);
        const includePrivateNotes = ["owner", "admin"].includes(admin.role);
        const [projects, quotes, notes] = await Promise.all([
          db.prepare(`SELECT id, title, home_nickname, postcode, address_state, property_type, household_situation,
            goal, pace, service_categories, priorities, project_stage, timing, budget_range,
            ${includePrivateNotes ? "private_notes" : "'' AS private_notes"}, completed_plan_items, status,
            opportunity_id, submitted_at, archived_at, created_at, updated_at
            FROM customer_projects WHERE firebase_uid = ? ORDER BY updated_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
          db.prepare(`SELECT q.id, q.project_id, q.opportunity_id, q.installer_uid, q.total_cents_ex_gst,
            q.quote_type, q.start_window, q.duration_weeks, q.workmanship_warranty_years, q.status,
            q.customer_decision, q.submitted_at, q.updated_at, COALESCE(a.business_name, 'Installer option') installer_business
            FROM customer_project_quotes q LEFT JOIN trade_accounts a ON a.firebase_uid = q.installer_uid
            WHERE q.project_id IN (SELECT id FROM customer_projects WHERE firebase_uid = ?)
            ORDER BY q.updated_at DESC LIMIT 200`).bind(uid).all<Record<string, unknown>>(),
          db.prepare(`SELECT n.id, n.note, n.created_at, COALESCE(a.display_name, a.email, 'Operations team') author
            FROM customer_account_notes n LEFT JOIN admin_users a ON a.firebase_uid = n.created_by_uid
            WHERE n.firebase_uid = ? ORDER BY n.created_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>(),
        ]);
        await writeAdminAudit(admin, "customer_account.view", "customer_account", uid, "Opened a private customer support record.", { role: admin.role });
        return adminJson({
          ok: true,
          accountType: "customer",
          canEdit: ["owner", "admin"].includes(admin.role),
          impersonationAllowed: false,
          account: {
            firebaseUid: account.firebase_uid,
            email: account.email,
            displayName: account.display_name,
            postcode: account.postcode,
            addressState: account.address_state,
            propertyType: account.property_type,
            householdSituation: account.household_situation,
            accountUpdates: Boolean(account.account_updates),
            accountStatus: account.account_status,
            isSynthetic: Boolean(account.is_synthetic),
            consentVersion: account.consent_version,
            consentAt: account.consent_at,
            createdAt: account.created_at,
            updatedAt: account.updated_at,
          },
          projects: projects.results.map((project: Record<string, unknown>) => ({
            id: project.id,
            title: project.title,
            homeNickname: project.home_nickname,
            postcode: project.postcode,
            addressState: project.address_state,
            propertyType: project.property_type,
            householdSituation: project.household_situation,
            goal: project.goal,
            pace: project.pace,
            serviceCategories: parseJsonList(project.service_categories),
            priorities: parseJsonList(project.priorities),
            projectStage: project.project_stage,
            timing: project.timing,
            budgetRange: project.budget_range,
            privateNotes: project.private_notes,
            completedPlanItems: parseJsonList(project.completed_plan_items),
            status: project.status,
            opportunityId: project.opportunity_id,
            submittedAt: project.submitted_at,
            archivedAt: project.archived_at,
            createdAt: project.created_at,
            updatedAt: project.updated_at,
            quotes: quotes.results.filter((quote: Record<string, unknown>) => quote.project_id === project.id).map((quote: Record<string, unknown>) => ({
              id: quote.id,
              installerBusiness: quote.installer_business,
              totalCentsExGst: Number(quote.total_cents_ex_gst || 0),
              quoteType: quote.quote_type,
              startWindow: quote.start_window,
              durationWeeks: Number(quote.duration_weeks || 0),
              workmanshipWarrantyYears: Number(quote.workmanship_warranty_years || 0),
              status: quote.status,
              customerDecision: quote.customer_decision,
              submittedAt: quote.submitted_at,
              updatedAt: quote.updated_at,
            })),
          })),
          notes: notes.results,
        });
      }

      if (requestedType === "installer" || requestedType === "supplier") {
        const account = await db.prepare(`SELECT firebase_uid, email, business_name, contact_name, phone, partner_type,
          business_website, address_line_1, suburb, address_state, postcode, service_states, capabilities, summary,
          account_status, verification_status, plan_key, billing_status, availability_status, is_synthetic, created_at, updated_at
          FROM trade_accounts WHERE firebase_uid = ? AND partner_type = ?`).bind(uid, requestedType).first<Record<string, unknown>>();
        if (!account) return adminJson({ ok: false, error: "Business account not found." }, 404);
        return adminJson({ ok: true, accountType: requestedType, canEdit: false, impersonationAllowed: false, account: {
          firebaseUid: account.firebase_uid,
          email: account.email,
          name: account.business_name,
          contactName: account.contact_name,
          phone: account.phone,
          businessWebsite: account.business_website,
          addressLine1: account.address_line_1,
          suburb: account.suburb,
          addressState: account.address_state,
          postcode: account.postcode,
          serviceStates: parseJsonList(account.service_states),
          capabilities: parseJsonList(account.capabilities),
          summary: account.summary,
          accountStatus: account.account_status,
          verificationStatus: account.verification_status,
          planKey: account.plan_key,
          billingStatus: account.billing_status,
          availabilityStatus: account.availability_status,
          isSynthetic: Boolean(account.is_synthetic),
          createdAt: account.created_at,
          updatedAt: account.updated_at,
        } });
      }

      if (admin.role !== "owner") return adminJson({ ok: false, error: "Only an owner can open operations account records." }, 403);
      const account = await db.prepare(`SELECT id, firebase_uid, email, display_name, role, status, last_login_at, created_at, updated_at
        FROM admin_users WHERE firebase_uid = ? OR id = ? LIMIT 1`).bind(uid, uid).first<Record<string, unknown>>();
      if (!account) return adminJson({ ok: false, error: "Operations account not found." }, 404);
      return adminJson({ ok: true, accountType: "admin", canEdit: false, impersonationAllowed: false, account });
    }

    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const type = cleanAdminText(url.searchParams.get("type"), 30);
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const synthetic = cleanAdminText(url.searchParams.get("synthetic"), 20);
    const requestedPage = Number(url.searchParams.get("page"));
    const requestedPageSize = Number(url.searchParams.get("pageSize"));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
    const revealCustomer = ["owner", "admin", "support"].includes(admin.role);
    const union = `(SELECT firebase_uid, email, display_name name, 'Household profile' secondary, 'customer' account_type,
        address_state, postcode, account_status, '' verification_status, 'always_free' plan_key, is_synthetic, created_at, updated_at
        FROM customer_accounts
      UNION ALL
      SELECT firebase_uid, email, business_name name, contact_name secondary, partner_type account_type,
        address_state, postcode, account_status, verification_status, plan_key, is_synthetic, created_at, updated_at
        FROM trade_accounts
      UNION ALL
      SELECT id firebase_uid, email, COALESCE(NULLIF(display_name, ''), email) name, role secondary,
        'admin' account_type, '' address_state, '' postcode, status account_status, '' verification_status,
        role plan_key, 0 is_synthetic, created_at, updated_at FROM admin_users)`;
    const conditions = ["1 = 1"];
    const bindings: unknown[] = [];
    if (type) { conditions.push("account_type = ?"); bindings.push(type); }
    if (status) { conditions.push("account_status = ?"); bindings.push(status); }
    if (synthetic !== "exclude") {
      if (synthetic === "only") conditions.push("is_synthetic = 1");
    } else conditions.push("is_synthetic = 0");
    if (search) {
      if (!revealCustomer) conditions.push("account_type <> 'customer'");
      conditions.push("LOWER(name || ' ' || email || ' ' || secondary || ' ' || postcode) LIKE ?");
      bindings.push(`%${search}%`);
    }
    const where = conditions.join(" AND ");
    const [filteredCount, accountRows, globalCounts] = await Promise.all([
      db.prepare(`SELECT COUNT(*) total FROM ${union} directory WHERE ${where}`).bind(...bindings).first<Record<string, unknown>>(),
      db.prepare(`SELECT * FROM ${union} directory WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .bind(...bindings, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN account_type = 'customer' THEN 1 ELSE 0 END) customers,
        SUM(CASE WHEN account_type = 'installer' THEN 1 ELSE 0 END) installers,
        SUM(CASE WHEN account_type = 'supplier' THEN 1 ELSE 0 END) suppliers,
        SUM(CASE WHEN account_type = 'admin' THEN 1 ELSE 0 END) admins
        FROM ${union} directory`).first<Record<string, unknown>>(),
    ]);
    const total = Number(filteredCount?.total || 0);
    return adminJson({
      ok: true,
      accounts: accountRows.results.map((row: Record<string, unknown>) => directoryItem(row, revealCustomer)),
      counts: {
        total: Number(globalCounts?.total || 0),
        customers: Number(globalCounts?.customers || 0),
        installers: Number(globalCounts?.installers || 0),
        suppliers: Number(globalCounts?.suppliers || 0),
        admins: Number(globalCounts?.admins || 0),
      },
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid customer account update." }, 400); }
    if (body.accountType !== "customer") {
      return adminJson({ ok: false, error: "Use the partner or access workspace for this account type." }, 400);
    }
    const uid = cleanAdminText(body.firebaseUid, 180);
    const displayName = cleanAdminText(body.displayName, 120);
    const postcode = cleanAdminText(body.postcode, 4);
    const addressState = cleanAdminText(body.addressState, 12);
    const propertyType = cleanAdminText(body.propertyType, 30);
    const householdSituation = cleanAdminText(body.householdSituation, 30);
    const accountStatus = cleanAdminText(body.accountStatus, 30);
    const note = cleanAdminText(body.note, 1200);
    if (!uid || !displayName || !postcodeCoordinate(postcode) || !STATES.has(addressState) ||
      !postcodeMatchesState(postcode, addressState) || !PROPERTY_TYPES.has(propertyType) ||
      !HOUSEHOLD_SITUATIONS.has(householdSituation) || !CUSTOMER_STATUSES.has(accountStatus)) {
      return adminJson({ ok: false, error: "One or more customer account settings are invalid." }, 400);
    }
    const db = getD1();
    const current = await db.prepare(`SELECT display_name, postcode, address_state, property_type, household_situation, account_status
      FROM customer_accounts WHERE firebase_uid = ?`).bind(uid).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Customer account not found." }, 404);
    const now = new Date().toISOString();
    const statements = [db.prepare(`UPDATE customer_accounts SET display_name = ?, postcode = ?, address_state = ?,
      property_type = ?, household_situation = ?, account_status = ?, updated_at = ? WHERE firebase_uid = ?`)
      .bind(displayName, postcode, addressState, propertyType, householdSituation, accountStatus, now, uid)];
    if (note) statements.push(db.prepare(`INSERT INTO customer_account_notes
      (id, firebase_uid, note, created_by_uid, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), uid, note, admin.uid, now));
    if (accountStatus === "suspended") {
      statements.push(db.prepare(`UPDATE trade_opportunities SET status = 'paused', updated_at = ?
        WHERE status = 'open' AND id IN (SELECT opportunity_id FROM customer_projects WHERE firebase_uid = ? AND opportunity_id != '')`)
        .bind(now, uid));
    }
    if (accountStatus === "closed") {
      statements.push(
        db.prepare(`UPDATE trade_opportunities SET status = 'closed', updated_at = ?
          WHERE id IN (SELECT opportunity_id FROM customer_projects WHERE firebase_uid = ? AND opportunity_id != '')`).bind(now, uid),
        db.prepare(`UPDATE trade_opportunity_matches SET status = 'closed', updated_at = ?
          WHERE opportunity_id IN (SELECT opportunity_id FROM customer_projects WHERE firebase_uid = ? AND opportunity_id != '')
            AND status IN ('offered', 'viewed', 'interested', 'connected')`).bind(now, uid),
        db.prepare(`UPDATE customer_project_quotes SET status = 'closed', updated_at = ?
          WHERE project_id IN (SELECT id FROM customer_projects WHERE firebase_uid = ?) AND status = 'submitted'`).bind(now, uid),
        db.prepare(`UPDATE customer_projects SET status = 'withdrawn', updated_at = ?
          WHERE firebase_uid = ? AND status IN ('matching', 'quote_review')`).bind(now, uid),
      );
    }
    await db.batch(statements);
    await writeAdminAudit(admin, "customer_account.update", "customer_account", uid, "Updated a private customer support record.", {
      before: current,
      after: { displayName, postcode, addressState, propertyType, householdSituation, accountStatus },
      noteAdded: Boolean(note),
    });
    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error);
  }
}
