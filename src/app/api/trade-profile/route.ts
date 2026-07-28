import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import { adminNotificationStatement } from "@/lib/admin-notifications";
import {
  resolveEntitlements,
  type PartnerType,
} from "@/lib/direct-trade-entitlements";
import { AUSTRALIAN_STATE_CODES, canonicalAustralianState } from "@/lib/australian-postcodes.mjs";
import { isValidAbn, normalizeAbn } from "@/lib/trade-abn";
import {
  approvedAbnAccess,
  approvedTradeReviewPredicate,
  requireVerifiedTradeIdentity,
} from "@/lib/trade-access-server";

export const runtime = "edge";

const NOTICE_VERSION = "2026-07-14";
const STATES = new Set(AUSTRALIAN_STATE_CODES);
const CAPABILITIES = new Set([
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "insulation-draughts",
  "ev-charging",
  "other",
]);

type ProfilePayload = {
  businessName?: unknown;
  abn?: unknown;
  addressLine1?: unknown;
  suburb?: unknown;
  addressState?: unknown;
  postcode?: unknown;
  contactName?: unknown;
  phone?: unknown;
  partnerType?: unknown;
  businessWebsite?: unknown;
  serviceStates?: unknown;
  capabilities?: unknown;
  summary?: unknown;
  consent?: unknown;
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanList(value: unknown, allowed: Set<string>) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))]
    : [];
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function identityOrResponse(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);

  const db = getD1();
  const record = await db.prepare(`
    SELECT account.business_name, account.abn, account.address_line_1,
           account.suburb, account.address_state, account.postcode,
           account.contact_name, account.phone, account.partner_type,
           account.business_website, account.service_states, account.capabilities,
           account.summary, account.account_status, account.verification_status,
           account.verified_abn, account.verification_review_id,
           account.verification_reviewed_at, account.verification_reviewed_by_uid,
           account.availability_status, account.service_base_postcode,
           account.service_radius_km, account.email_opportunities,
           account.email_weekly_summary, account.settings_updated_at,
           CASE WHEN ${approvedTradeReviewPredicate("account")}
             THEN 1 ELSE 0 END approval_review_exists
    FROM trade_accounts account
    WHERE account.firebase_uid = ?
  `).bind(identity.uid).first<Record<string, unknown>>();

  if (!record) return json({ ok: true, profile: null });
  const accessApproved = approvedAbnAccess({
    abn: String(record.abn || ""),
    partnerType: String(record.partner_type),
    accountStatus: String(record.account_status),
    verificationStatus: String(record.verification_status),
    verifiedAbn: String(record.verified_abn || ""),
    verificationReviewId: String(record.verification_review_id || ""),
    verificationReviewedAt: String(record.verification_reviewed_at || ""),
    verificationReviewedByUid: String(record.verification_reviewed_by_uid || ""),
    approvalReviewExists: Boolean(record.approval_review_exists),
  });
  const entitlements = resolveEntitlements(
    String(record.partner_type) as PartnerType,
    accessApproved && identity.emailVerified,
  );
  return json({
    ok: true,
    profile: {
      businessName: record.business_name,
      abn: record.abn,
      addressLine1: record.address_line_1,
      suburb: record.suburb,
      addressState: record.address_state,
      postcode: record.postcode,
      contactName: record.contact_name,
      phone: record.phone,
      partnerType: record.partner_type,
      businessWebsite: record.business_website,
      serviceStates: JSON.parse(String(record.service_states || "[]")),
      capabilities: JSON.parse(String(record.capabilities || "[]")),
      summary: record.summary,
      accountStatus: record.account_status,
      verificationStatus: record.verification_status,
      verifiedAbn: record.verified_abn,
      verificationReviewId: record.verification_review_id,
      verificationReviewedAt: record.verification_reviewed_at,
      verificationReviewedByUid: record.verification_reviewed_by_uid,
      accessApproved: accessApproved && identity.emailVerified,
      availabilityStatus: record.availability_status,
      serviceBasePostcode: record.service_base_postcode || record.postcode,
      serviceRadiusKm: Number(record.service_radius_km || 50),
      emailOpportunities: Boolean(record.email_opportunities),
      emailWeeklySummary: Boolean(record.email_weekly_summary),
      settingsUpdatedAt: record.settings_updated_at,
      entitlements,
    },
  });
}

type SettingsPayload = {
  availabilityStatus?: unknown;
  serviceBasePostcode?: unknown;
  serviceRadiusKm?: unknown;
  emailOpportunities?: unknown;
  emailWeeklySummary?: unknown;
};

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  try {
    await requireVerifiedTradeIdentity(identity);
  } catch (error) {
    return json({
      ok: false,
      code: error instanceof Error && "code" in error ? String(error.code) : "ABN_REVIEW_REQUIRED",
      error: error instanceof Error ? error.message : "ABN review and approval are required.",
    }, 403);
  }

  let raw: SettingsPayload;
  try {
    raw = await request.json() as SettingsPayload;
  } catch {
    return json({ ok: false, error: "Invalid dashboard settings." }, 400);
  }

  const availabilityStatus = typeof raw.availabilityStatus === "string" ? raw.availabilityStatus : "";
  if (!["open", "limited", "paused"].includes(availabilityStatus)) {
    return json({ ok: false, error: "Choose a valid availability setting." }, 400);
  }
  if (typeof raw.emailOpportunities !== "boolean" || typeof raw.emailWeeklySummary !== "boolean") {
    return json({ ok: false, error: "Choose valid email preferences." }, 400);
  }

  const account = await getD1().prepare("SELECT partner_type, postcode, service_base_postcode, service_radius_km FROM trade_accounts WHERE firebase_uid = ?")
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!account) return json({ ok: false, error: "Complete the business profile first." }, 404);
  const requestedBase = cleanText(raw.serviceBasePostcode, 4);
  const requestedRadius = Number(raw.serviceRadiusKm);
  const serviceBasePostcode = account.partner_type === "installer" ? (requestedBase || String(account.service_base_postcode || account.postcode)) : String(account.service_base_postcode || account.postcode);
  const serviceRadiusKm = account.partner_type === "installer" ? requestedRadius : Number(account.service_radius_km || 50);
  if (account.partner_type === "installer" && (!/^\d{4}$/.test(serviceBasePostcode) || !postcodeCoordinate(serviceBasePostcode))) {
    return json({ ok: false, error: "Enter a recognised Australian service-base postcode." }, 400);
  }
  if (account.partner_type === "installer" && (!Number.isInteger(serviceRadiusKm) || serviceRadiusKm < 10 || serviceRadiusKm > 1000)) {
    return json({ ok: false, error: "Choose a service radius from 10 to 1,000 kilometres." }, 400);
  }

  const now = new Date().toISOString();
  const result = await getD1().prepare(`
    UPDATE trade_accounts
    SET availability_status = ?, service_base_postcode = ?, service_radius_km = ?, email_opportunities = ?, email_weekly_summary = ?,
        settings_updated_at = ?, updated_at = ?
    WHERE firebase_uid = ?
  `).bind(
    availabilityStatus,
    serviceBasePostcode,
    serviceRadiusKm,
    raw.emailOpportunities ? 1 : 0,
    raw.emailWeeklySummary ? 1 : 0,
    now,
    now,
    identity.uid,
  ).run();

  if (!result.meta.changes) return json({ ok: false, error: "Complete the business profile first." }, 404);
  return json({
    ok: true,
    settings: { availabilityStatus, serviceBasePostcode, serviceRadiusKm, emailOpportunities: raw.emailOpportunities, emailWeeklySummary: raw.emailWeeklySummary, settingsUpdatedAt: now },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);

  let raw: ProfilePayload;
  try {
    raw = await request.json() as ProfilePayload;
  } catch {
    return json({ ok: false, error: "Invalid account details." }, 400);
  }

  const businessName = cleanText(raw.businessName, 160);
  const abn = normalizeAbn(raw.abn);
  const addressLine1 = cleanText(raw.addressLine1, 180);
  const suburb = cleanText(raw.suburb, 100);
  const addressState = canonicalAustralianState(raw.addressState) || "";
  const postcode = cleanText(raw.postcode, 4);
  const contactName = cleanText(raw.contactName, 120);
  const phone = cleanText(raw.phone, 40);
  const partnerType = raw.partnerType === "supplier" ? "supplier" : "installer";
  const businessWebsite = cleanText(raw.businessWebsite, 300);
  const serviceStates = [...new Set(Array.isArray(raw.serviceStates)
    ? raw.serviceStates.map(canonicalAustralianState).filter((value): value is string => Boolean(value))
    : [])];
  const capabilities = cleanList(raw.capabilities, CAPABILITIES);
  const summary = cleanText(raw.summary, 800);
  const consent = raw.consent === true;

  if (!businessName) return json({ ok: false, error: "Enter the business name." }, 400);
  if (!isValidAbn(abn)) return json({ ok: false, error: "Enter a valid 11 digit Australian Business Number." }, 400);
  if (!addressLine1) return json({ ok: false, error: "Enter the business street address." }, 400);
  if (!suburb) return json({ ok: false, error: "Enter the business suburb or locality." }, 400);
  if (!STATES.has(addressState)) return json({ ok: false, error: "Choose the business state or territory." }, 400);
  if (!/^\d{4}$/.test(postcode)) return json({ ok: false, error: "Enter a four digit business postcode." }, 400);
  if (!contactName) return json({ ok: false, error: "Enter the contact name." }, 400);
  if (phone.replace(/\D/g, "").length < 8) return json({ ok: false, error: "Enter the business contact number." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identity.email)) return json({ ok: false, error: "A valid business account email is required." }, 400);
  if (!serviceStates.length) return json({ ok: false, error: "Choose at least one service area." }, 400);
  if (!capabilities.length) return json({ ok: false, error: "Choose at least one capability." }, 400);
  if (!consent) return json({ ok: false, error: "Confirm the account and contact consent." }, 400);

  const now = new Date().toISOString();
  const db = getD1();
  const existingAccount = await db.prepare(
    "SELECT firebase_uid, business_name, abn, partner_type FROM trade_accounts WHERE firebase_uid = ?",
  ).bind(identity.uid).first<{ firebase_uid: string; business_name: string; abn: string; partner_type: string }>();
  const materialIdentityChanged = Boolean(
    existingAccount &&
    (
      normalizeAbn(existingAccount.abn) !== abn ||
      existingAccount.business_name !== businessName ||
      existingAccount.partner_type !== partnerType
    ),
  );
  const profileStatement = db.prepare(`
    INSERT INTO trade_accounts (
      firebase_uid, email, business_name, abn, address_line_1, suburb, address_state,
      postcode, contact_name, phone, partner_type,
      business_website, service_states, capabilities, summary, account_status,
      verification_status, verified_abn, verification_review_id, verification_reviewed_at,
      verification_reviewed_by_uid, consent_version,
      service_base_postcode, service_radius_km, consent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'submitted', '', '', '', '', ?, ?, 50, ?, ?, ?)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      email = excluded.email,
      business_name = excluded.business_name,
      abn = excluded.abn,
      address_line_1 = excluded.address_line_1,
      suburb = excluded.suburb,
      address_state = excluded.address_state,
      postcode = excluded.postcode,
      contact_name = excluded.contact_name,
      phone = excluded.phone,
      partner_type = excluded.partner_type,
      business_website = excluded.business_website,
      service_states = excluded.service_states,
      capabilities = excluded.capabilities,
      summary = excluded.summary,
      verification_status = CASE
        WHEN trade_accounts.abn = excluded.abn
          AND trade_accounts.business_name = excluded.business_name
          AND trade_accounts.partner_type = excluded.partner_type
        THEN trade_accounts.verification_status ELSE 'submitted' END,
      verified_abn = CASE
        WHEN trade_accounts.abn = excluded.abn
          AND trade_accounts.business_name = excluded.business_name
          AND trade_accounts.partner_type = excluded.partner_type
        THEN trade_accounts.verified_abn ELSE '' END,
      verification_review_id = CASE
        WHEN trade_accounts.abn = excluded.abn
          AND trade_accounts.business_name = excluded.business_name
          AND trade_accounts.partner_type = excluded.partner_type
        THEN trade_accounts.verification_review_id ELSE '' END,
      verification_reviewed_at = CASE
        WHEN trade_accounts.abn = excluded.abn
          AND trade_accounts.business_name = excluded.business_name
          AND trade_accounts.partner_type = excluded.partner_type
        THEN trade_accounts.verification_reviewed_at ELSE '' END,
      verification_reviewed_by_uid = CASE
        WHEN trade_accounts.abn = excluded.abn
          AND trade_accounts.business_name = excluded.business_name
          AND trade_accounts.partner_type = excluded.partner_type
        THEN trade_accounts.verification_reviewed_by_uid ELSE '' END,
      consent_version = excluded.consent_version,
      consent_at = excluded.consent_at,
      updated_at = excluded.updated_at
  `).bind(
    identity.uid,
    identity.email,
    businessName,
    abn,
    addressLine1,
    suburb,
    addressState,
    postcode,
    contactName,
    phone,
    partnerType,
    businessWebsite,
    JSON.stringify(serviceStates),
    JSON.stringify(capabilities),
    summary,
    NOTICE_VERSION,
    postcode,
    now,
    now,
    now,
  );
  const statements = [profileStatement];
  if (!existingAccount) {
    statements.push(adminNotificationStatement(db, {
      eventKey: `trade-signup:${identity.uid}`,
      eventType: "trade.signup",
      category: "approval",
      priority: "high",
      title: partnerType === "supplier" ? "New wholesaler account" : "New installer account",
      summary: `${businessName} created a ${partnerType === "supplier" ? "wholesaler" : "installer"} profile and is ready for operations review.`,
      entityType: "trade_account",
      entityId: identity.uid,
      actorType: partnerType,
      actorUid: identity.uid,
      requiresAction: true,
      metadata: { partnerType, addressState, postcode },
      occurredAt: now,
    }));
  } else if (materialIdentityChanged) {
    statements.push(adminNotificationStatement(db, {
      eventKey: `trade-identity-review:${identity.uid}:${now}`,
      eventType: "trade.identity_review_required",
      category: "approval",
      priority: "high",
      title: `${businessName} requires a fresh ABN review`,
      summary:
        "The business changed its ABN, registered name or account type. Protected access remains blocked until a new official ABN review is recorded.",
      entityType: "trade_account",
      entityId: identity.uid,
      actorType: partnerType,
      actorUid: identity.uid,
      requiresAction: true,
      metadata: { partnerType, abn, addressState, postcode },
      occurredAt: now,
    }));
  }
  await db.batch(statements);

  const saved = await db.prepare(`SELECT account.account_status, account.verification_status,
      account.verified_abn, account.verification_review_id,
      account.verification_reviewed_at, account.verification_reviewed_by_uid,
      CASE WHEN ${approvedTradeReviewPredicate("account")}
        THEN 1 ELSE 0 END approval_review_exists
      FROM trade_accounts account WHERE account.firebase_uid = ?`)
    .bind(identity.uid).first<Record<string, unknown>>();
  const accessApproved = approvedAbnAccess({
    abn,
    partnerType,
    accountStatus: String(saved?.account_status || ""),
    verificationStatus: String(saved?.verification_status || ""),
    verifiedAbn: String(saved?.verified_abn || ""),
    verificationReviewId: String(saved?.verification_review_id || ""),
    verificationReviewedAt: String(saved?.verification_reviewed_at || ""),
    verificationReviewedByUid: String(saved?.verification_reviewed_by_uid || ""),
    approvalReviewExists: Boolean(saved?.approval_review_exists),
  }) && identity.emailVerified;
  return json({
    ok: true,
    profile: {
      email: identity.email,
      emailVerified: identity.emailVerified,
      accountStatus: saved?.account_status || "active",
      verificationStatus: saved?.verification_status || "submitted",
      verifiedAbn: saved?.verified_abn || "",
      verificationReviewId: saved?.verification_review_id || "",
      verificationReviewedAt: saved?.verification_reviewed_at || "",
      verificationReviewedByUid: saved?.verification_reviewed_by_uid || "",
      accessApproved,
    },
  });
}
