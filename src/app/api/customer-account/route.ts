import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { postcodeMatchesState } from "@/lib/australian-postcodes.mjs";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import { adminNotificationStatement } from "@/lib/admin-notifications";
import {
  CUSTOMER_NOTICE_VERSION,
  validateCustomerProfile,
} from "@/lib/customer-projects.mjs";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
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
    profile: record ? {
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
    } : null,
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
