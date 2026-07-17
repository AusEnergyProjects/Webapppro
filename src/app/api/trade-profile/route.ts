import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { postcodeCoordinate } from "@/lib/postcode-distance";
import { normalizeReferralCode } from "@/lib/direct-trade-referrals";
import { createAdminNotification } from "@/lib/admin-notifications";
import {
  resolveEntitlements,
  type FeatureGrant,
  type PartnerType,
} from "@/lib/direct-trade-entitlements";
import { AUSTRALIAN_STATE_CODES, canonicalAustralianState } from "@/lib/australian-postcodes.mjs";

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
  referralCode?: unknown;
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function isValidAbn(value: string) {
  if (!/^\d{11}$/.test(value)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return value.split("").reduce((total, digit, index) => total + (Number(digit) - (index === 0 ? 1 : 0)) * weights[index], 0) % 89 === 0;
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
    SELECT business_name, abn, address_line_1, suburb, address_state, postcode,
           contact_name, phone, partner_type, business_website,
           service_states, capabilities, summary, account_status,
           verification_status, plan_key, billing_status, availability_status,
           service_base_postcode, service_radius_km,
           email_opportunities, email_weekly_summary, settings_updated_at
    FROM trade_accounts
    WHERE firebase_uid = ?
  `).bind(identity.uid).first<Record<string, unknown>>();

  if (!record) return json({ ok: true, profile: null });
  const grantRows = await db.prepare(`SELECT feature_key, status, expires_at, note, updated_at
    FROM trade_account_feature_grants WHERE firebase_uid = ? ORDER BY feature_key`)
    .bind(identity.uid).all<Record<string, unknown>>();
  const featureGrants = grantRows.results.map((grant: Record<string, unknown>) => ({
    featureKey: grant.feature_key,
    status: grant.status,
    expiresAt: grant.expires_at,
    note: grant.note,
    updatedAt: grant.updated_at,
  })) as FeatureGrant[];
  const entitlements = resolveEntitlements(
    String(record.partner_type) as PartnerType,
    record.billing_status,
    featureGrants,
    record.verification_status === "approved",
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
      planKey: record.plan_key,
      billingStatus: record.billing_status,
      availabilityStatus: record.availability_status,
      serviceBasePostcode: record.service_base_postcode || record.postcode,
      serviceRadiusKm: Number(record.service_radius_km || 50),
      emailOpportunities: Boolean(record.email_opportunities),
      emailWeeklySummary: Boolean(record.email_weekly_summary),
      settingsUpdatedAt: record.settings_updated_at,
      featureGrants,
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
  const abn = cleanText(raw.abn, 20).replace(/\D/g, "");
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
  const referralCode = normalizeReferralCode(raw.referralCode);

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
    "SELECT firebase_uid FROM trade_accounts WHERE firebase_uid = ?",
  ).bind(identity.uid).first<{ firebase_uid: string }>();
  await db.prepare(`
    INSERT INTO trade_accounts (
      firebase_uid, email, business_name, abn, address_line_1, suburb, address_state,
      postcode, contact_name, phone, partner_type,
      business_website, service_states, capabilities, summary, account_status,
      verification_status, plan_key, billing_status, consent_version,
      service_base_postcode, service_radius_km, consent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'not_started', 'unselected', 'not_connected', ?, ?, 50, ?, ?, ?)
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
  ).run();

  if (!existingAccount) {
    await createAdminNotification({
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
    });
  }

  let referral: { accepted: boolean; message: string } | null = null;
  if (cleanText(raw.referralCode, 40)) {
    if (existingAccount) {
      referral = {
        accepted: false,
        message: "Referral rewards apply only when a new business profile is first created.",
      };
    } else if (!referralCode) {
      referral = { accepted: false, message: "The referral code was not recognised." };
    } else {
      const codeOwner = await db.prepare(`
        SELECT c.firebase_uid, c.status,
          EXISTS(
            SELECT 1 FROM stripe_memberships m
            WHERE m.firebase_uid = c.firebase_uid
              AND m.status IN ('active', 'active_cancels_at_period_end')
          ) paying
        FROM trade_referral_codes c
        WHERE c.code = ?
      `).bind(referralCode).first<{ firebase_uid: string; status: string; paying: number }>();
      if (!codeOwner || codeOwner.status !== "active") {
        referral = { accepted: false, message: "The referral link is no longer active." };
      } else if (codeOwner.firebase_uid === identity.uid) {
        referral = { accepted: false, message: "A business cannot refer its own account." };
      } else if (!codeOwner.paying) {
        referral = {
          accepted: false,
          message: "The referring membership must be active when the new profile is created.",
        };
      } else {
        const duplicate = await db.prepare(`
          SELECT firebase_uid FROM trade_accounts
          WHERE firebase_uid <> ? AND LOWER(TRIM(business_name)) = LOWER(TRIM(?)) AND postcode = ?
          LIMIT 1
        `).bind(identity.uid, businessName, postcode).first<{ firebase_uid: string }>();
        const referralStatus = duplicate ? "review_required" : "registered";
        const riskReason = duplicate
          ? "An existing business profile has the same business name and postcode."
          : "";
        const referralId = crypto.randomUUID();
        const inserted = await db.prepare(`
          INSERT INTO trade_referrals
          (id, referral_code, referrer_uid, referred_uid, status, risk_reason,
           referred_subscription_id, registered_at, first_paid_at, rewarded_at,
           reviewed_by_uid, reviewed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, '', ?, '', '', '', '', ?, ?)
          ON CONFLICT(referred_uid) DO NOTHING
        `).bind(
          referralId,
          referralCode,
          codeOwner.firebase_uid,
          identity.uid,
          referralStatus,
          riskReason,
          now,
          now,
          now,
        ).run();
        if (inserted.meta.changes && referralStatus === "review_required") {
          await createAdminNotification({
            eventKey: `referral-review:${referralId}`,
            eventType: "trade.referral_review_required",
            category: "approval",
            priority: "high",
            title: "Referral eligibility needs review",
            summary: `${businessName} matched an existing business name and postcode during referral registration.`,
            entityType: "trade_referral",
            entityId: referralId,
            actorType: partnerType,
            actorUid: identity.uid,
            requiresAction: true,
            metadata: { riskReason },
            occurredAt: now,
          });
        }
        referral = inserted.meta.changes
          ? {
              accepted: true,
              message: duplicate
                ? "Referral saved. Eligibility review is required before either free month is applied."
                : "Referral saved. Both free months will be applied after the first membership payment clears.",
            }
          : {
              accepted: false,
              message: "This business account already has a referral recorded.",
            };
      }
    }
  }

  return json({
    ok: true,
    profile: {
      email: identity.email,
      emailVerified: identity.emailVerified,
      accountStatus: "active",
      verificationStatus: "not_started",
      planKey: "unselected",
      billingStatus: "not_connected",
    },
    referral,
  });
}
