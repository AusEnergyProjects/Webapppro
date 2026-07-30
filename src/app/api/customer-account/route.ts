import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { postcodeMatchesState } from "@/lib/australian-postcodes.mjs";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import { adminNotificationStatement } from "@/lib/admin-notifications";
import {
  CUSTOMER_NOTICE_VERSION,
  customerContactReadiness,
  validateCustomerProfile,
} from "@/lib/customer-projects.mjs";

export const runtime = "edge";

type CustomerAccountRecord = Record<string, unknown> & {
  firebase_uid?: unknown;
  email?: unknown;
  display_name?: unknown;
  phone?: unknown;
  address_line_1?: unknown;
  address_line_2?: unknown;
  suburb?: unknown;
  postcode?: unknown;
  address_state?: unknown;
  property_type?: unknown;
  household_situation?: unknown;
  account_updates?: unknown;
  account_status?: unknown;
  consent_version?: unknown;
  consent_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function customerProfileShape(record: CustomerAccountRecord) {
  return {
    displayName: record.display_name,
    phone: record.phone,
    addressLine1: record.address_line_1,
    addressLine2: record.address_line_2,
    suburb: record.suburb,
    postcode: record.postcode,
    addressState: record.address_state,
    propertyType: record.property_type,
    householdSituation: record.household_situation,
    accountUpdates: Boolean(record.account_updates),
    accountStatus: record.account_status,
    accountTier: "Always free",
    consentVersion: record.consent_version,
    consentAt: record.consent_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function profileRevisionConflict(updatedAt = "") {
  return json({
    ok: false,
    code: "PROFILE_REVISION_CONFLICT",
    error: "Your private profile changed in another tab. Review the latest details before trying again.",
    updatedAt,
  }, 409);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
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

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const db = getD1();
  const [record, trade] = await Promise.all([
    db.prepare(`SELECT display_name, phone, address_line_1, address_line_2, suburb, postcode, address_state, property_type, household_situation,
      account_updates, account_status, consent_version, consent_at, is_synthetic, created_at, updated_at
      FROM customer_accounts WHERE firebase_uid = ?`).bind(user.uid).first<Record<string, unknown>>(),
    db.prepare("SELECT partner_type FROM trade_accounts WHERE firebase_uid = ?").bind(user.uid).first<Record<string, unknown>>(),
  ]);
  return json({
    ok: true,
    email: user.email,
    emailVerified: user.emailVerified || Boolean(record?.is_synthetic),
    tradeWorkspace: trade ? { partnerType: trade.partner_type } : null,
    profile: record ? customerProfileShape(record) : null,
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (Number(request.headers.get("content-length") || 0) > 20_000) {
    return json({ ok: false, error: "The account update was too large." }, 413);
  }
  let raw: Record<string, unknown>;
  try {
    raw = await request.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid account details." }, 400);
  }
  const validated = validateCustomerProfile(raw);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400);
  const profile = validated.profile;
  if (!profile) return json({ ok: false, error: "Invalid account details." }, 400);
  if (!postcodeCoordinate(profile.postcode)) {
    return json({ ok: false, error: "Enter a recognised Australian postcode." }, 400);
  }
  if (!postcodeMatchesState(profile.postcode, profile.addressState)) {
    return json({ ok: false, error: "The postcode does not match the selected state or territory." }, 400);
  }
  const db = getD1();
  const existing = await db.prepare("SELECT consent_version FROM customer_accounts WHERE firebase_uid = ?")
    .bind(user.uid).first<{ consent_version: string }>();
  const now = new Date().toISOString();
  const receiptId = crypto.randomUUID();
  const statements = [db.prepare(`INSERT INTO customer_accounts
    (firebase_uid, email, display_name, phone, address_line_1, address_line_2, suburb, postcode, address_state, property_type, household_situation,
     account_updates, account_status, consent_version, consent_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    ON CONFLICT(firebase_uid) DO UPDATE SET email = excluded.email, display_name = excluded.display_name,
      phone = excluded.phone, address_line_1 = excluded.address_line_1, address_line_2 = excluded.address_line_2,
      suburb = excluded.suburb,
      postcode = excluded.postcode, address_state = excluded.address_state, property_type = excluded.property_type,
      household_situation = excluded.household_situation, account_updates = excluded.account_updates,
      account_status = 'active', consent_version = excluded.consent_version, consent_at = excluded.consent_at,
      updated_at = excluded.updated_at`)
    .bind(user.uid, user.email, profile.displayName, profile.phone, profile.addressLine1, profile.addressLine2,
      profile.suburb, profile.postcode,
      profile.addressState, profile.propertyType, profile.householdSituation,
      profile.accountUpdates ? 1 : 0, CUSTOMER_NOTICE_VERSION, now, now, now)];
  if (!existing || existing.consent_version !== CUSTOMER_NOTICE_VERSION) {
    statements.push(db.prepare(`INSERT INTO customer_consent_receipts
      (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
      VALUES (?, ?, '', 'customer_account', ?, ?, '', ?)`)
      .bind(receiptId, user.uid, CUSTOMER_NOTICE_VERSION, now, now));
  }
  if (!existing) {
    statements.push(adminNotificationStatement(db, {
      eventKey: `customer-signup:${user.uid}`,
      eventType: "customer.signup",
      category: "customer",
      priority: "low",
      title: "New customer account",
      summary: "A customer created a private, always-free household account.",
      entityType: "customer_account",
      entityId: user.uid,
      actorType: "customer",
      actorUid: user.uid,
      requiresAction: false,
      occurredAt: now,
    }));
  }
  await db.batch(statements);
  return json({
    ok: true,
    profile: { ...profile, accountStatus: "active", accountTier: "Always free", updatedAt: now },
  });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (Number(request.headers.get("content-length") || 0) > 20_000) {
    return json({ ok: false, error: "The private contact update was too large." }, 413);
  }
  let raw: Record<string, unknown>;
  try {
    raw = await request.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid private contact details." }, 400);
  }
  if (raw.confirmPrivateProfileSave !== true) {
    return json({
      ok: false,
      error: "Confirm that these contact details can be saved to your private profile.",
    }, 400);
  }
  const confirmSubmittedProjectContactUpdate =
    raw.confirmSubmittedProjectContactUpdate === true;
  const projectId = cleanId(raw.projectId);
  const expectedUpdatedAt = typeof raw.expectedUpdatedAt === "string"
    ? raw.expectedUpdatedAt.trim().slice(0, 40)
    : "";
  if (!projectId) return json({ ok: false, error: "Choose a valid project." }, 400);
  if (!expectedUpdatedAt) {
    return json({
      ok: false,
      error: "Refresh your private profile before saving these contact details.",
    }, 400);
  }

  const db = getD1();
  const [account, project] = await Promise.all([
    db.prepare(`SELECT firebase_uid, email, display_name, phone, address_line_1, address_line_2,
      suburb, postcode, address_state, property_type, household_situation, account_updates,
      account_status, consent_version, consent_at, created_at, updated_at
      FROM customer_accounts WHERE firebase_uid = ?`)
      .bind(user.uid)
      .first<CustomerAccountRecord>(),
    db.prepare(`SELECT id, postcode, address_state, status
      FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
      .bind(projectId, user.uid)
      .first<Record<string, unknown>>(),
  ]);
  if (!account) {
    return json({ ok: false, error: "Complete your private household profile first." }, 404);
  }
  if (account.account_status !== "active") {
    return json({ ok: false, error: "This customer account is not active." }, 403);
  }
  if (!project) return json({ ok: false, error: "Project not found." }, 404);
  const projectStatus = String(project.status || "");
  const projectStatusAllowsContactUpdate =
    projectStatus === "draft"
    || (
      confirmSubmittedProjectContactUpdate
      && ["matching", "quote_review"].includes(projectStatus)
    );
  if (!projectStatusAllowsContactUpdate) {
    return json({
      ok: false,
      error: "Private contact details cannot be updated for this project's current status.",
    }, 409);
  }
  if (expectedUpdatedAt !== String(account.updated_at || "")) {
    return profileRevisionConflict(String(account.updated_at || ""));
  }

  const validated = validateCustomerProfile({
    displayName: account.display_name,
    phone: raw.phone,
    addressLine1: raw.addressLine1,
    addressLine2: typeof raw.addressLine2 === "string"
      ? raw.addressLine2
      : account.address_line_2,
    suburb: raw.suburb,
    postcode: project.postcode,
    addressState: project.address_state,
    propertyType: account.property_type,
    householdSituation: account.household_situation,
    accountUpdates: Boolean(account.account_updates),
    consent: true,
  });
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400);
  const profile = validated.profile;
  if (!profile) return json({ ok: false, error: "Invalid private contact details." }, 400);
  if (!postcodeCoordinate(profile.postcode)) {
    return json({ ok: false, error: "Enter a recognised Australian postcode." }, 400);
  }
  if (!postcodeMatchesState(profile.postcode, profile.addressState)) {
    return json({ ok: false, error: "The project postcode does not match its state or territory." }, 400);
  }
  const contactReadiness = customerContactReadiness(profile, project);
  if (!contactReadiness.ok) {
    return json({ ok: false, error: contactReadiness.error }, 400);
  }

  const updatedAt = nextUpdatedAt(account.updated_at);
  const updated = await db.prepare(`UPDATE customer_accounts
    SET phone = ?, address_line_1 = ?, address_line_2 = ?, suburb = ?,
      postcode = ?, address_state = ?, updated_at = ?
    WHERE firebase_uid = ? AND updated_at = ?
      AND EXISTS (
        SELECT 1 FROM customer_projects
        WHERE id = ? AND firebase_uid = ?
          AND (
            status = 'draft'
            OR (? = 1 AND status IN ('matching', 'quote_review'))
          )
      )`)
    .bind(
      profile.phone,
      profile.addressLine1,
      profile.addressLine2,
      profile.suburb,
      profile.postcode,
      profile.addressState,
      updatedAt,
      user.uid,
      expectedUpdatedAt,
      projectId,
      user.uid,
      confirmSubmittedProjectContactUpdate ? 1 : 0,
    )
    .run();
  // D1 reports sqlite3_total_changes(), which also counts the delete and
  // insert performed by the customer search-index trigger. A successful
  // contact update can therefore report more than one changed row.
  if (Number(updated.meta.changes || 0) < 1) {
    const [latestAccount, latestProject] = await Promise.all([
      db.prepare("SELECT updated_at FROM customer_accounts WHERE firebase_uid = ?")
        .bind(user.uid)
        .first<{ updated_at: string }>(),
      db.prepare("SELECT status FROM customer_projects WHERE id = ? AND firebase_uid = ?")
        .bind(projectId, user.uid)
        .first<{ status: string }>(),
    ]);
    if (!latestAccount) {
      return json({ ok: false, error: "Complete your private household profile first." }, 404);
    }
    if (!latestProject) return json({ ok: false, error: "Project not found." }, 404);
    const latestProjectStatus = String(latestProject.status || "");
    const latestProjectAllowsContactUpdate =
      latestProjectStatus === "draft"
      || (
        confirmSubmittedProjectContactUpdate
        && ["matching", "quote_review"].includes(latestProjectStatus)
      );
    if (!latestProjectAllowsContactUpdate) {
      return json({
        ok: false,
        error: "Private contact details cannot be updated for this project's current status.",
      }, 409);
    }
    return profileRevisionConflict(String(latestAccount.updated_at || ""));
  }

  return json({
    ok: true,
    profile: customerProfileShape({
      ...account,
      phone: profile.phone,
      address_line_1: profile.addressLine1,
      address_line_2: profile.addressLine2,
      suburb: profile.suburb,
      postcode: profile.postcode,
      address_state: profile.addressState,
      updated_at: updatedAt,
    }),
  });
}
