import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";

const NOTICE_VERSION = "2026-07-14";
const STATES = new Set(["ACT", "NSW", "NT", "Qld", "SA", "Tas", "Vic", "WA"]);
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

  const record = await getD1().prepare(`
    SELECT business_name, contact_name, phone, partner_type, business_website,
           service_states, capabilities, summary, account_status,
           verification_status, plan_key, free_leads_remaining
    FROM trade_accounts
    WHERE firebase_uid = ?
  `).bind(identity.uid).first<Record<string, unknown>>();

  if (!record) return json({ ok: true, profile: null });
  return json({
    ok: true,
    profile: {
      businessName: record.business_name,
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
      freeLeadsRemaining: record.free_leads_remaining,
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
  const contactName = cleanText(raw.contactName, 120);
  const phone = cleanText(raw.phone, 40);
  const partnerType = raw.partnerType === "supplier" ? "supplier" : "installer";
  const businessWebsite = cleanText(raw.businessWebsite, 300);
  const serviceStates = cleanList(raw.serviceStates, STATES);
  const capabilities = cleanList(raw.capabilities, CAPABILITIES);
  const summary = cleanText(raw.summary, 800);
  const consent = raw.consent === true;

  if (!businessName) return json({ ok: false, error: "Enter the business name." }, 400);
  if (!contactName) return json({ ok: false, error: "Enter the contact name." }, 400);
  if (!serviceStates.length) return json({ ok: false, error: "Choose at least one service area." }, 400);
  if (!capabilities.length) return json({ ok: false, error: "Choose at least one capability." }, 400);
  if (!consent) return json({ ok: false, error: "Confirm the account and contact consent." }, 400);

  const now = new Date().toISOString();
  await getD1().prepare(`
    INSERT INTO trade_accounts (
      firebase_uid, email, business_name, contact_name, phone, partner_type,
      business_website, service_states, capabilities, summary, account_status,
      verification_status, plan_key, free_leads_remaining, consent_version,
      consent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'not_started', 'try_one_lead', 1, ?, ?, ?, ?)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      email = excluded.email,
      business_name = excluded.business_name,
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
    contactName,
    phone,
    partnerType,
    businessWebsite,
    JSON.stringify(serviceStates),
    JSON.stringify(capabilities),
    summary,
    NOTICE_VERSION,
    now,
    now,
    now,
  ).run();

  return json({
    ok: true,
    profile: {
      email: identity.email,
      emailVerified: identity.emailVerified,
      accountStatus: "active",
      verificationStatus: "not_started",
      planKey: "try_one_lead",
      freeLeadsRemaining: 1,
    },
  });
}
