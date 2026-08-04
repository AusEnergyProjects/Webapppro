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
import {
  DEFAULT_QUOTE_EMAIL_INTRO,
  DEFAULT_QUOTE_EMAIL_SUBJECT,
  DEFAULT_TRADE_BRAND_BORDER,
  DEFAULT_TRADE_BRAND_THEME,
  QUOTE_SUBJECT_PLACEHOLDERS,
  TRADE_BRAND_BORDER_STYLES,
  TRADE_BRAND_THEME_KEYS,
} from "@/lib/trade-business-branding";

export const runtime = "edge";

const NOTICE_VERSION = "2026-07-14";
const ACCOUNT_CLOSURE_RETENTION_NOTICE_VERSION = "2026-08-04";
const ACCOUNT_CLOSURE_RECENT_AUTH_SECONDS = 15 * 60;
const ACCOUNT_CLOSURE_CLOCK_SKEW_SECONDS = 60;
const STATES = new Set(AUSTRALIAN_STATE_CODES);
const BRAND_THEMES = new Set<string>(TRADE_BRAND_THEME_KEYS);
const BRAND_BORDERS = new Set<string>(TRADE_BRAND_BORDER_STYLES);
const CAPABILITIES = new Set([
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "draught-proofing",
  "insulation",
  "glazing",
  "window-coverings",
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

function cleanSingleLine(value: unknown, maximum: number) {
  return cleanText(value, maximum).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
}

function canonicalHttpsWebsite(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return "";
  if (candidate.length > 300 || /[\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    const website = new URL(candidate);
    if (
      website.protocol !== "https:"
      || !website.hostname
      || website.username
      || website.password
    ) return null;
    const canonical = website.toString();
    return canonical.length <= 300 ? canonical : null;
  } catch {
    return null;
  }
}

function cleanList(value: unknown, allowed: Set<string>) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))]
    : [];
}

function parseStringList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

type ServiceArea = {
  postcode: string;
  radiusKm: number;
};

function parseServiceAreas(value: unknown): ServiceArea[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return null;
  const serviceAreas: ServiceArea[] = [];
  const postcodes = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const area = item as Record<string, unknown>;
    const postcode = cleanText(area.postcode, 4);
    const radiusKm = Number(area.radiusKm);
    if (
      !/^\d{4}$/.test(postcode)
      || !postcodeCoordinate(postcode)
      || !Number.isInteger(radiusKm)
      || radiusKm < 10
      || radiusKm > 1000
      || postcodes.has(postcode)
    ) return null;
    postcodes.add(postcode);
    serviceAreas.push({ postcode, radiusKm });
  }
  return serviceAreas;
}

function validateQuoteSubjectTemplate(value: string) {
  if (!value || !value.includes("{business_name}")) return false;
  const placeholders = [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  const unmatchedBraces = value.replace(/\{[^{}]+\}/g, "").match(/[{}]/);
  return !unmatchedBraces
    && placeholders.every((placeholder) => QUOTE_SUBJECT_PLACEHOLDERS.has(placeholder));
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function hasRecentFirebaseAuthentication(authTime: number, nowSeconds = Math.floor(Date.now() / 1000)) {
  return Number.isFinite(authTime)
    && authTime > 0
    && authTime <= nowSeconds + ACCOUNT_CLOSURE_CLOCK_SKEW_SECONDS
    && nowSeconds - authTime <= ACCOUNT_CLOSURE_RECENT_AUTH_SECONDS;
}

async function stableAccountClosureId(firebaseUid: string, closureCycle: number) {
  const cycle = Math.max(0, Math.trunc(closureCycle));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`tlink-trade-account-closure:v1:${firebaseUid}:${cycle}`),
  );
  return `closure_${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
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
           account.brand_theme_key, account.brand_border_style,
           account.logo_object_key, account.logo_content_type,
           account.banner_object_key, account.banner_content_type,
           account.quote_email_subject_template, account.quote_email_intro,
           account.quote_default_terms, account.account_closed_at,
           CASE WHEN ${approvedTradeReviewPredicate("account")}
             THEN 1 ELSE 0 END approval_review_exists
    FROM trade_accounts account
    WHERE account.firebase_uid = ?
  `).bind(identity.uid).first<Record<string, unknown>>();

  if (!record) return json({ ok: true, profile: null });
  const businessWebsite = canonicalHttpsWebsite(record.business_website) || "";
  const serviceAreaRows = await db.prepare(`
    SELECT postcode, radius_km
    FROM trade_account_service_areas
    WHERE firebase_uid = ? AND record_status = 'active'
    ORDER BY position, created_at, id
    LIMIT 6
  `).bind(identity.uid).all<{ postcode: string; radius_km: number }>();
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
      businessWebsite,
      serviceStates: parseStringList(record.service_states),
      capabilities: parseStringList(record.capabilities),
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
      brandThemeKey: record.brand_theme_key || DEFAULT_TRADE_BRAND_THEME,
      brandBorderStyle: record.brand_border_style || DEFAULT_TRADE_BRAND_BORDER,
      hasLogo: Boolean(record.logo_object_key && record.logo_content_type),
      hasBanner: Boolean(record.banner_object_key && record.banner_content_type),
      logoMediaUrl: record.logo_object_key ? "/api/trade-profile-media?kind=logo" : "",
      bannerMediaUrl: record.banner_object_key ? "/api/trade-profile-media?kind=banner" : "",
      quoteEmailSubjectTemplate: record.quote_email_subject_template || DEFAULT_QUOTE_EMAIL_SUBJECT,
      quoteEmailIntro: record.quote_email_intro || DEFAULT_QUOTE_EMAIL_INTRO,
      quoteDefaultTerms: record.quote_default_terms || "",
      serviceAreas: serviceAreaRows.results.map((area) => ({
        postcode: area.postcode,
        radiusKm: Number(area.radius_km),
      })),
      accountClosedAt: record.account_closed_at || "",
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
  serviceAreas?: unknown;
  brandThemeKey?: unknown;
  brandBorderStyle?: unknown;
  quoteEmailSubjectTemplate?: unknown;
  quoteEmailIntro?: unknown;
  quoteDefaultTerms?: unknown;
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

  const db = getD1();
  const account = await db.prepare(`SELECT partner_type, postcode, service_base_postcode,
      service_radius_km, availability_status, email_opportunities,
      email_weekly_summary, brand_theme_key, brand_border_style,
      quote_email_subject_template, quote_email_intro, quote_default_terms
    FROM trade_accounts WHERE firebase_uid = ?`)
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!account) return json({ ok: false, error: "Complete the business profile first." }, 404);

  const availabilityStatus = raw.availabilityStatus === undefined
    ? String(account.availability_status || "open")
    : typeof raw.availabilityStatus === "string"
      ? raw.availabilityStatus
      : "";
  if (!["open", "limited", "paused"].includes(availabilityStatus)) {
    return json({ ok: false, error: "Choose a valid availability setting." }, 400);
  }
  if (
    (raw.emailOpportunities !== undefined && typeof raw.emailOpportunities !== "boolean")
    || (raw.emailWeeklySummary !== undefined && typeof raw.emailWeeklySummary !== "boolean")
  ) {
    return json({ ok: false, error: "Choose valid email preferences." }, 400);
  }
  const emailOpportunities = raw.emailOpportunities === undefined
    ? Boolean(account.email_opportunities)
    : raw.emailOpportunities;
  const emailWeeklySummary = raw.emailWeeklySummary === undefined
    ? Boolean(account.email_weekly_summary)
    : raw.emailWeeklySummary;

  const currentAreaRows = await db.prepare(`
    SELECT postcode, radius_km
    FROM trade_account_service_areas
    WHERE firebase_uid = ? AND record_status = 'active'
    ORDER BY position, created_at, id
    LIMIT 6
  `).bind(identity.uid).all<{ postcode: string; radius_km: number }>();
  const currentAreas = currentAreaRows.results.map((area) => ({
    postcode: area.postcode,
    radiusKm: Number(area.radius_km),
  }));
  const requestedAreas = raw.serviceAreas === undefined
    ? null
    : parseServiceAreas(raw.serviceAreas);
  if (raw.serviceAreas !== undefined && !requestedAreas) {
    return json({
      ok: false,
      error: "Add from one to six recognised Australian postcodes, each with a service radius from 10 to 1,000 kilometres.",
    }, 400);
  }

  const hasLegacyAreaChange = raw.serviceBasePostcode !== undefined || raw.serviceRadiusKm !== undefined;
  let serviceAreas = requestedAreas || currentAreas;
  if (!requestedAreas && hasLegacyAreaChange) {
    const postcode = cleanText(raw.serviceBasePostcode, 4)
      || currentAreas[0]?.postcode
      || String(account.service_base_postcode || account.postcode);
    const requestedRadius = raw.serviceRadiusKm === undefined
      ? currentAreas[0]?.radiusKm || Number(account.service_radius_km || 50)
      : Number(raw.serviceRadiusKm);
    const legacyArea = parseServiceAreas([{ postcode, radiusKm: requestedRadius }]);
    if (!legacyArea) {
      return json({
        ok: false,
        error: "Enter a recognised Australian service postcode and choose a radius from 10 to 1,000 kilometres.",
      }, 400);
    }
    serviceAreas = [legacyArea[0], ...currentAreas.filter((area) => area.postcode !== postcode)].slice(0, 6);
  } else if (!serviceAreas.length && account.partner_type === "installer") {
    const fallbackArea = parseServiceAreas([{
      postcode: String(account.service_base_postcode || account.postcode),
      radiusKm: Number(account.service_radius_km || 50),
    }]);
    if (!fallbackArea) {
      return json({
        ok: false,
        error: "Add at least one recognised Australian service postcode before saving business settings.",
      }, 400);
    }
    serviceAreas = fallbackArea;
  }

  const brandThemeKey = raw.brandThemeKey === undefined
    ? String(account.brand_theme_key || DEFAULT_TRADE_BRAND_THEME)
    : cleanText(raw.brandThemeKey, 40);
  if (!BRAND_THEMES.has(brandThemeKey)) {
    return json({ ok: false, error: "Choose an available business colour theme." }, 400);
  }
  const brandBorderStyle = raw.brandBorderStyle === undefined
    ? String(account.brand_border_style || DEFAULT_TRADE_BRAND_BORDER)
    : cleanText(raw.brandBorderStyle, 24);
  if (!BRAND_BORDERS.has(brandBorderStyle)) {
    return json({ ok: false, error: "Choose an available document border style." }, 400);
  }
  const quoteEmailSubjectTemplate = raw.quoteEmailSubjectTemplate === undefined
    ? String(account.quote_email_subject_template || DEFAULT_QUOTE_EMAIL_SUBJECT)
    : cleanSingleLine(raw.quoteEmailSubjectTemplate, 180);
  if (!validateQuoteSubjectTemplate(quoteEmailSubjectTemplate)) {
    return json({
      ok: false,
      error: "The quote email subject must include {business_name} and may use {quote_number}, {customer_name} or {work_title}.",
    }, 400);
  }
  const quoteEmailIntro = raw.quoteEmailIntro === undefined
    ? String(account.quote_email_intro || DEFAULT_QUOTE_EMAIL_INTRO)
    : cleanText(raw.quoteEmailIntro, 1200);
  if (!quoteEmailIntro) {
    return json({ ok: false, error: "Add the standard introduction shown in quote emails." }, 400);
  }
  const quoteDefaultTerms = raw.quoteDefaultTerms === undefined
    ? String(account.quote_default_terms || "")
    : cleanText(raw.quoteDefaultTerms, 5000);

  const serviceBasePostcode = serviceAreas[0]?.postcode
    || String(account.service_base_postcode || account.postcode);
  const serviceRadiusKm = serviceAreas[0]?.radiusKm
    || Number(account.service_radius_km || 50);
  const now = new Date().toISOString();
  const statements = [db.prepare(`
    UPDATE trade_accounts
    SET availability_status = ?, service_base_postcode = ?, service_radius_km = ?,
        email_opportunities = ?, email_weekly_summary = ?,
        brand_theme_key = ?, brand_border_style = ?,
        quote_email_subject_template = ?, quote_email_intro = ?, quote_default_terms = ?,
        settings_updated_at = ?, updated_at = ?
    WHERE firebase_uid = ?
  `).bind(
    availabilityStatus,
    serviceBasePostcode,
    serviceRadiusKm,
    emailOpportunities ? 1 : 0,
    emailWeeklySummary ? 1 : 0,
    brandThemeKey,
    brandBorderStyle,
    quoteEmailSubjectTemplate,
    quoteEmailIntro,
    quoteDefaultTerms,
    now,
    now,
    identity.uid,
  )];

  if (requestedAreas || hasLegacyAreaChange || (!currentAreas.length && serviceAreas.length)) {
    statements.push(
      db.prepare("DELETE FROM trade_account_service_areas WHERE firebase_uid = ?")
        .bind(identity.uid),
    );
    serviceAreas.forEach((area, index) => {
      statements.push(db.prepare(`
        INSERT INTO trade_account_service_areas
          (id, firebase_uid, position, postcode, radius_km, record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(
        crypto.randomUUID(),
        identity.uid,
        index + 1,
        area.postcode,
        area.radiusKm,
        now,
        now,
      ));
    });
  }

  const [result] = await db.batch(statements);
  if (!result.meta.changes) return json({ ok: false, error: "Complete the business profile first." }, 404);
  return json({
    ok: true,
    settings: {
      availabilityStatus,
      serviceBasePostcode,
      serviceRadiusKm,
      emailOpportunities,
      emailWeeklySummary,
      serviceAreas,
      brandThemeKey,
      brandBorderStyle,
      quoteEmailSubjectTemplate,
      quoteEmailIntro,
      quoteDefaultTerms,
      settingsUpdatedAt: now,
    },
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
  const requestedPartnerType = raw.partnerType === "supplier"
    ? "supplier"
    : raw.partnerType === "installer"
      ? "installer"
      : "";
  const businessWebsite = canonicalHttpsWebsite(raw.businessWebsite);
  const serviceStates = [...new Set(Array.isArray(raw.serviceStates)
    ? raw.serviceStates.map(canonicalAustralianState).filter((value): value is string => Boolean(value))
    : [])];
  const capabilities = cleanList(raw.capabilities, CAPABILITIES);
  const summary = cleanText(raw.summary, 800);
  const consent = raw.consent === true;
  const db = getD1();
  const existingAccount = await db.prepare(
    "SELECT firebase_uid, business_name, abn, partner_type, account_status FROM trade_accounts WHERE firebase_uid = ?",
  ).bind(identity.uid).first<{
    firebase_uid: string;
    business_name: string;
    abn: string;
    partner_type: string;
    account_status: string;
  }>();
  if (existingAccount?.account_status === "closed") {
    return json({
      ok: false,
      code: "ACCOUNT_CLOSED",
      error:
        "This TLink account is closed. Restoring access requires a separate authorised administrator recovery process.",
    }, 409);
  }
  if (
    existingAccount
    && requestedPartnerType
    && existingAccount.partner_type !== requestedPartnerType
  ) {
    return json({
      ok: false,
      code: "ACCOUNT_TYPE_LOCKED",
      error: "The account type is fixed after setup. Contact TLink support if the business was registered incorrectly.",
    }, 409);
  }
  const partnerType = (existingAccount?.partner_type === "supplier"
    ? "supplier"
    : existingAccount?.partner_type === "installer"
      ? "installer"
      : requestedPartnerType || "installer") as PartnerType;

  if (!businessName) return json({ ok: false, error: "Enter the business name." }, 400);
  if (businessWebsite === null) {
    return json({
      ok: false,
      error: "Enter a complete HTTPS business website without sign-in details, or leave it blank.",
    }, 400);
  }
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
  const materialIdentityChanged = Boolean(
    existingAccount &&
    (
      normalizeAbn(existingAccount.abn) !== abn ||
      existingAccount.business_name !== businessName
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
        "The business changed its ABN or registered name. Protected access remains blocked until a new official ABN review is recorded.",
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

type CloseAccountPayload = {
  confirmation?: unknown;
  reason?: unknown;
};

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (!hasRecentFirebaseAuthentication(identity.authTime)) {
    return json({
      ok: false,
      code: "RECENT_AUTH_REQUIRED",
      error:
        "For security, sign out and sign in again before closing this account, then retry within 15 minutes.",
    }, 401);
  }

  let raw: CloseAccountPayload;
  try {
    raw = await request.json() as CloseAccountPayload;
  } catch {
    return json({ ok: false, error: "The account closure request could not be read." }, 400);
  }
  if (cleanSingleLine(raw.confirmation, 40) !== "CLOSE ACCOUNT") {
    return json({
      ok: false,
      code: "ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED",
      error: "Type CLOSE ACCOUNT to confirm that TLink access and editable settings should be closed.",
    }, 400);
  }
  const reason = cleanText(raw.reason, 800);
  const db = getD1();
  const account = await db.prepare(`
    SELECT business_name, partner_type, account_status, account_closed_at
    FROM trade_accounts
    WHERE firebase_uid = ?
  `).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) return json({ ok: false, error: "Complete the business profile first." }, 404);

  const existingClosure = await db.prepare(`
    SELECT id, requested_at, completed_at
    FROM trade_account_closure_requests
    WHERE firebase_uid = ? AND status = 'closed'
    ORDER BY requested_at, id
    LIMIT 1
  `).bind(identity.uid).first<Record<string, unknown>>();
  const closureCountRecord = await db.prepare(`
    SELECT COUNT(*) closure_count
    FROM trade_account_closure_requests
    WHERE firebase_uid = ?
  `).bind(identity.uid).first<Record<string, unknown>>();
  const rawClosureCount = Number(closureCountRecord?.closure_count || 0);
  const closureCycle = Number.isFinite(rawClosureCount) ? rawClosureCount : 0;
  const now = new Date().toISOString();
  const existingClosureId = cleanSingleLine(existingClosure?.id, 100);
  const closureId = existingClosureId
    || await stableAccountClosureId(identity.uid, closureCycle);
  const priorClosedAt = cleanSingleLine(account.account_closed_at, 60);
  const closureRequestedAt = cleanSingleLine(existingClosure?.requested_at, 60)
    || priorClosedAt
    || now;
  const accountClosedAt = cleanSingleLine(existingClosure?.completed_at, 60)
    || priorClosedAt
    || now;
  await db.batch([
    db.prepare(`
      UPDATE trade_accounts
      SET account_status = 'closed',
          availability_status = 'paused',
          service_base_postcode = '',
          service_radius_km = 50,
          email_opportunities = 0,
          email_weekly_summary = 0,
          brand_theme_key = ?,
          brand_border_style = ?,
          logo_object_key = '',
          logo_content_type = '',
          banner_object_key = '',
          banner_content_type = '',
          quote_email_subject_template = ?,
          quote_email_intro = ?,
          quote_default_terms = '',
          account_closed_at = ?,
          settings_updated_at = ?,
          updated_at = ?
      WHERE firebase_uid = ? AND account_status <> 'closed'
    `).bind(
      DEFAULT_TRADE_BRAND_THEME,
      DEFAULT_TRADE_BRAND_BORDER,
      DEFAULT_QUOTE_EMAIL_SUBJECT,
      DEFAULT_QUOTE_EMAIL_INTRO,
      now,
      now,
      now,
      identity.uid,
    ),
    db.prepare("DELETE FROM trade_account_service_areas WHERE firebase_uid = ?")
      .bind(identity.uid),
    db.prepare(`
      UPDATE trade_crm_quote_links
      SET status = 'revoked',
          token_hash = '',
          encrypted_token = '',
          revoked_at = CASE WHEN revoked_at = '' THEN ? ELSE revoked_at END,
          updated_at = ?
      WHERE firebase_uid = ? AND status = 'active'
    `).bind(now, now, identity.uid),
    db.prepare(`
      UPDATE trade_team_members
      SET status = 'suspended',
          updated_at = ?
      WHERE owner_uid = ? AND status = 'active'
    `).bind(now, identity.uid),
    db.prepare(`
      INSERT OR IGNORE INTO trade_account_closure_requests
        (id, firebase_uid, status, reason, retention_notice_version,
         requested_at, completed_at, recovered_at, recovered_by_uid, created_at, updated_at)
      VALUES (?, ?, 'closed', ?, ?, ?, ?, '', '', ?, ?)
    `).bind(
      closureId,
      identity.uid,
      reason,
      ACCOUNT_CLOSURE_RETENTION_NOTICE_VERSION,
      closureRequestedAt,
      accountClosedAt,
      now,
      now,
    ),
    adminNotificationStatement(db, {
      eventKey: `trade-account-closed:${identity.uid}`,
      eventType: "trade.account_closed",
      category: "account",
      priority: "normal",
      title: `${String(account.business_name || "Trade business")} closed its TLink account`,
      summary:
        "Trade access and editable settings were closed. Regulated, compliance, customer, job and audit records remain retained for authorised review. Restoring access requires a separate authorised recovery process.",
      entityType: "trade_account",
      entityId: identity.uid,
      actorType: account.partner_type === "supplier" ? "supplier" : "installer",
      actorUid: identity.uid,
      requiresAction: false,
      metadata: {
        closureId,
        retentionNoticeVersion: ACCOUNT_CLOSURE_RETENTION_NOTICE_VERSION,
      },
      occurredAt: closureRequestedAt,
    }),
  ]);
  return json({
    ok: true,
    accountStatus: "closed",
    accountClosedAt,
    closureRequestId: closureId,
    alreadyClosed: account.account_status === "closed" || Boolean(existingClosureId),
    recovery:
      "Restoring access requires a separate authorised administrator recovery process after a verified business request.",
    retainedRecords:
      "Government program, compliance, customer, job, quote, invoice and audit records remain retained for authorised administration and legal obligations.",
  });
}
