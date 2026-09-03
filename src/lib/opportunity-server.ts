import { getD1 } from "../../db";
import { parseJsonList } from "@/lib/admin-server";
import { postcodeDistanceKm } from "@/lib/postcode-distance";
import { canonicalAustralianState } from "@/lib/australian-postcodes.mjs";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import { matchedServiceCategories } from "@/lib/trade-service-matching.mjs";
import { selectEveryQualifiedTradeRecipient } from "@/lib/direct-trade-matching.mjs";
import { closestQualifyingTradeServiceArea } from "@/lib/trade-service-area-matching.mjs";
import { persistLeadOpportunity } from "@/lib/opportunity-source-write.mjs";
import { ensureOpportunityNotificationDeliveries } from "@/lib/opportunity-notification-server";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import {
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
  publicPlanContactReleaseDisclosedFieldsAreValid,
  publicPlanContactReleaseAccessSql,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "@/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
} from "@/lib/public-plan-quote-preparation.mjs";
import {
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
  QUICK_UPGRADE_SOURCE_JOURNEY,
} from "@/lib/quick-upgrade-enquiry.mjs";

export const DEFAULT_CONNECTED_INSTALLERS = 3;
export const DEFAULT_CONTACT_LIMIT = 2;
export const OPPORTUNITY_LIFETIME_DAYS = 30;
const D1_ALLOCATION_WRITE_BATCH_SIZE = 50;

export async function syncMarketplaceEnquiries(db: D1Database, opportunityId: string, firebaseUid = "") {
  await db.prepare(`INSERT INTO trade_crm_enquiries
    (id, firebase_uid, source_type, source_reference, external_record_id, opportunity_match_id, status,
     customer_type, first_name, last_name, email, phone, address_line_1, address_line_2, suburb,
     address_state, postcode,
     service_category, service_categories, description, urgency, service_region, protected_source,
     duplicate_decision, record_status, created_at, updated_at)
    SELECT 'marketplace-' || m.id, m.firebase_uid, 'tlink_marketplace', m.id, '', m.id,
      CASE WHEN m.status IN ('interested', 'connected') THEN 'contacted'
           WHEN m.status IN ('declined', 'closed') THEN 'lost' ELSE 'new' END,
      'residential', '', '', '', '', '', '', '', '', '',
      COALESCE(json_extract(m.matched_categories, '$[0]'), 'other'), m.matched_categories,
      o.summary,
      o.priority, o.state, 1,
      'protected',
      'active', m.matched_at, m.updated_at
    FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
    LEFT JOIN public_trade_lead_contact_releases contact
      ON contact.opportunity_id = o.id
        AND contact.source_reference = o.source_reference
        AND contact.status = 'active'
        AND ${publicPlanContactReleaseAccessSql("contact")}
        AND datetime(contact.granted_at) IS NOT NULL
        AND contact.withdrawn_at = ''
        AND contact.postcode = o.postcode
        AND m.status IN ('interested', 'connected')
        AND o.status = 'open'
        AND datetime(o.expires_at) > datetime('now')
        AND EXISTS (
          SELECT 1 FROM json_each(CASE WHEN json_valid(contact.disclosed_fields) THEN contact.disclosed_fields ELSE '[]' END) required_email
          WHERE required_email.value = 'customer_email'
        )
        AND EXISTS (
          SELECT 1 FROM json_each(CASE WHEN json_valid(contact.disclosed_fields) THEN contact.disclosed_fields ELSE '[]' END) required_postcode
          WHERE required_postcode.value = 'postcode'
        )
        AND EXISTS (
          SELECT 1 FROM json_each(CASE WHEN json_valid(contact.disclosed_fields) THEN contact.disclosed_fields ELSE '[]' END) required_services
          WHERE required_services.value = 'service_categories'
        )
        AND EXISTS (
          SELECT 1 FROM trade_accounts current_trade_account
          WHERE current_trade_account.firebase_uid = m.firebase_uid
            AND current_trade_account.partner_type = 'installer'
            AND ${verifiedTradeAccountPredicate("current_trade_account")}
        )
    WHERE m.opportunity_id = ? AND (? = '' OR m.firebase_uid = ?)
    ON CONFLICT(firebase_uid, source_type, source_reference) DO UPDATE SET
      status = excluded.status, service_category = excluded.service_category,
      service_categories = excluded.service_categories, description = excluded.description,
      urgency = excluded.urgency, service_region = excluded.service_region,
      first_name = excluded.first_name, last_name = excluded.last_name,
      email = excluded.email, phone = excluded.phone,
      address_line_1 = excluded.address_line_1, address_line_2 = excluded.address_line_2,
      suburb = excluded.suburb, address_state = excluded.address_state, postcode = excluded.postcode,
      protected_source = excluded.protected_source,
      duplicate_decision = excluded.duplicate_decision, updated_at = excluded.updated_at`)
    .bind(opportunityId, firebaseUid, firebaseUid).run();
}

const ACTIVE_MATCH_STATUSES = new Set([
  "offered",
  "viewed",
  "interested",
  "connected",
]);
const CATEGORY_LABELS = ENERGY_SERVICE_LABELS as Readonly<Record<string, string>>;

export function canonicalMarketplaceState(value: unknown) {
  return canonicalAustralianState(value) || "";
}

export function opportunityExpiry(createdAt = new Date()) {
  return new Date(
    createdAt.getTime() + OPPORTUNITY_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export async function expireStaleOpportunities() {
  const db = getD1();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE trade_opportunities SET status = 'expired', expired_at = ?, updated_at = ?
      WHERE status IN ('open', 'paused') AND (
        (expires_at != '' AND expires_at <= ?)
        OR (expires_at = '' AND datetime(created_at, '+30 days') <= ?)
      )`,
      )
      .bind(now, now, now, now),
    db
      .prepare(
        `UPDATE trade_opportunity_matches SET status = 'closed', updated_at = ?
      WHERE status IN ('offered', 'viewed', 'interested', 'connected')
      AND opportunity_id IN (SELECT id FROM trade_opportunities WHERE status = 'expired')`,
      )
      .bind(now),
  ]);
}

type DirectTradeLead = {
  eventType?: string;
  sourceJourney?: string;
  reference?: string;
  submittedAt?: string;
  name?: string;
  customerFirstName?: string;
  customerLastName?: string;
  email?: string;
  phone?: string;
  customerUnitNumber?: string;
  customerStreetAddress?: string;
  customerSuburb?: string;
  customerState?: string;
  postcode?: string;
  state?: string;
  projectCategories?: string[];
  propertyType?: string;
  projectStage?: string;
  projectPriorities?: string[];
  projectNotes?: string;
  tradeSharing?: {
    email?: boolean;
    postcode?: boolean;
    name?: boolean;
    phone?: boolean;
    address?: boolean;
  };
  quotePreparation?: {
    version?: string;
    answers?: Array<{
      questionId?: string;
      label?: string;
      answer?: string;
      services?: string[];
    }>;
    photoPromptIds?: string[];
    expectedPhotoCount?: number;
    uploadKeyHash?: string;
  };
  timeframe?: string;
  directTradeTriage?: {
    status?: string;
    autoSend?: boolean;
    contactConsentReceipt?: {
      accepted?: boolean;
      purpose?: string;
      noticeVersion?: string;
      grantedAt?: string;
    };
  };
};

type PublicQuoteConsentReceipt = {
  accepted?: boolean;
  purpose?: string;
  noticeVersion?: string;
  grantedAt?: string;
};

async function persistPublicQuotePreparation(
  db: D1Database,
  opportunityId: string,
  sourceReference: string,
  preparation: DirectTradeLead["quotePreparation"],
  consent: PublicQuoteConsentReceipt | undefined,
  createdAt: string,
) {
  if (!preparation || preparation.version !== PUBLIC_PLAN_QUOTE_PREPARATION_VERSION) {
    return;
  }
  const answers = Array.isArray(preparation.answers) ? preparation.answers : [];
  const photoPromptIds = Array.isArray(preparation.photoPromptIds)
    ? preparation.photoPromptIds
    : [];
  const expectedPhotoCount = Number(preparation.expectedPhotoCount || 0);
  const uploadKeyHash = String(preparation.uploadKeyHash || "");
  const grantedAt = String(consent?.grantedAt || "");
  if (
    consent?.accepted !== true
    || consent.noticeVersion !== PUBLIC_PLAN_CONSENT_NOTICE_VERSION
    || consent.purpose !== PUBLIC_PLAN_CONSENT_PURPOSE
    || !Number.isFinite(Date.parse(grantedAt))
  ) {
    throw new Error("PUBLIC_QUOTE_PREPARATION_CONSENT_REQUIRED");
  }
  const canonicalGrantedAt = new Date(grantedAt).toISOString();
  const answersJson = JSON.stringify(answers);
  const promptIdsJson = JSON.stringify(photoPromptIds);
  await db.prepare(`INSERT INTO public_trade_lead_quote_preparations
    (id, opportunity_id, source_reference, status, version, question_answers,
     photo_prompt_ids, expected_photo_count, upload_key_hash, notice_version,
     consent_purpose, granted_at, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`)
    .bind(
      crypto.randomUUID(),
      opportunityId,
      sourceReference,
      PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
      answersJson,
      promptIdsJson,
      expectedPhotoCount,
      uploadKeyHash,
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
      canonicalGrantedAt,
      createdAt,
      createdAt,
    )
    .run();
  const stored = await db.prepare(`SELECT *
    FROM public_trade_lead_quote_preparations
    WHERE opportunity_id = ? AND source_reference = ? LIMIT 1`)
    .bind(opportunityId, sourceReference)
    .first<Record<string, unknown>>();
  if (
    !stored
    || stored.status !== "active"
    || stored.version !== PUBLIC_PLAN_QUOTE_PREPARATION_VERSION
    || stored.question_answers !== answersJson
    || stored.photo_prompt_ids !== promptIdsJson
    || Number(stored.expected_photo_count) !== expectedPhotoCount
    || stored.upload_key_hash !== uploadKeyHash
    || stored.notice_version !== PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION
    || stored.consent_purpose !== PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE
    || stored.granted_at !== canonicalGrantedAt
  ) {
    throw new Error("OPPORTUNITY_SOURCE_REFERENCE_MISMATCH");
  }
}

function publicContactRelease(payload: DirectTradeLead) {
  const publicPlanJourney = payload.sourceJourney === "public-home-energy-plan";
  const assistantJourney = payload.sourceJourney === "energy-assistant";
  const quickUpgradeJourney = payload.sourceJourney === QUICK_UPGRADE_SOURCE_JOURNEY;
  if (!publicPlanJourney && !assistantJourney && !quickUpgradeJourney) return null;
  const receipt = payload.directTradeTriage?.contactConsentReceipt;
  const sourceReference = String(payload.reference || "").trim();
  const customerFirstName = String(payload.customerFirstName || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const customerLastName = String(payload.customerLastName || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const customerEmail = String(payload.email || "").trim().toLowerCase().slice(0, 254);
  const customerPhone = String(payload.phone || "").trim().slice(0, 40);
  const customerUnitNumber = String(payload.customerUnitNumber || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  const customerStreetAddress = String(payload.customerStreetAddress || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const customerSuburb = String(payload.customerSuburb || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const customerAddressState = canonicalAustralianState(payload.customerState) || "";
  const tradeSharing = payload.tradeSharing;
  const noticeVersion = String(receipt?.noticeVersion || "").trim().slice(0, 120);
  const consentPurpose = String(receipt?.purpose || "").trim().slice(0, 160);
  const grantedAt = String(receipt?.grantedAt || "");
  const assistantDisclosedFields = [
    "customer_email",
    "postcode",
    "state",
    "service_categories",
    "quote_brief",
    "customer_name",
    ...(tradeSharing?.phone ? ["customer_phone"] : []),
  ];
  if (assistantJourney) {
    if (
      receipt?.accepted !== true
      || !sourceReference
      || !customerFirstName
      || !customerLastName
      || !customerEmail
      || !customerSuburb
      || !customerAddressState
      || customerAddressState !== canonicalAustralianState(payload.state)
      || tradeSharing?.email !== true
      || tradeSharing?.postcode !== true
      || tradeSharing?.name !== true
      || tradeSharing?.address === true
      || (tradeSharing?.phone === true && !customerPhone)
      || noticeVersion !== ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION
      || consentPurpose !== ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE
      || !publicPlanContactReleaseDisclosedFieldsAreValid(
        noticeVersion,
        consentPurpose,
        assistantDisclosedFields,
      )
      || !Number.isFinite(Date.parse(grantedAt))
    ) return null;
    return {
      customerFirstName,
      customerLastName,
      customerEmail,
      customerPhone: tradeSharing?.phone ? customerPhone : "",
      customerUnitNumber: "",
      customerStreetAddress: "",
      customerSuburb,
      customerAddressState,
      customerMessage: "",
      noticeVersion,
      consentPurpose,
      grantedAt: new Date(grantedAt).toISOString(),
      disclosedFields: assistantDisclosedFields,
    };
  }
  if (quickUpgradeJourney) {
    const customerMessage = String(payload.projectNotes || "").trim().slice(0, 500);
    const disclosedFields = [
      "customer_email",
      "postcode",
      "service_categories",
      "customer_address",
      ...(tradeSharing?.name ? ["customer_name"] : []),
      ...(tradeSharing?.phone ? ["customer_phone"] : []),
      ...(customerMessage ? ["customer_message"] : []),
    ];
    if (
      receipt?.accepted !== true
      || !sourceReference
      || !customerEmail
      || !customerStreetAddress
      || !customerSuburb
      || !customerAddressState
      || customerAddressState !== canonicalAustralianState(payload.state)
      || tradeSharing?.email !== true
      || tradeSharing?.postcode !== true
      || tradeSharing?.address !== true
      || typeof tradeSharing?.name !== "boolean"
      || typeof tradeSharing?.phone !== "boolean"
      || (tradeSharing.name && (!customerFirstName || !customerLastName))
      || (tradeSharing.phone && !customerPhone)
      || noticeVersion !== QUICK_UPGRADE_CONSENT_NOTICE_VERSION
      || consentPurpose !== QUICK_UPGRADE_CONSENT_PURPOSE
      || !publicPlanContactReleaseDisclosedFieldsAreValid(
        noticeVersion,
        consentPurpose,
        disclosedFields,
      )
      || !Number.isFinite(Date.parse(grantedAt))
    ) return null;
    return {
      customerFirstName,
      customerLastName,
      customerEmail,
      customerPhone,
      customerUnitNumber,
      customerStreetAddress,
      customerSuburb,
      customerAddressState,
      customerMessage,
      noticeVersion,
      consentPurpose,
      grantedAt: new Date(grantedAt).toISOString(),
      disclosedFields,
    };
  }
  if (
    receipt?.accepted !== true
    || !sourceReference
    || !customerFirstName
    || !customerLastName
    || !customerEmail
    || !customerPhone
    || !customerStreetAddress
    || !customerSuburb
    || !customerAddressState
    || customerAddressState !== canonicalAustralianState(payload.state)
    || tradeSharing?.email !== true
    || tradeSharing?.postcode !== true
    || noticeVersion !== PUBLIC_PLAN_CONSENT_NOTICE_VERSION
    || consentPurpose !== PUBLIC_PLAN_CONSENT_PURPOSE
    || !Number.isFinite(Date.parse(grantedAt))
  ) return null;
  const customerMessage = String(payload.projectNotes || "").trim().slice(0, 500);
  const disclosedFields = [
    "customer_email",
    "postcode",
    "service_categories",
    ...(tradeSharing.name ? ["customer_name"] : []),
    ...(tradeSharing.phone ? ["customer_phone"] : []),
    ...(tradeSharing.address ? ["customer_address"] : []),
    ...(customerMessage ? ["customer_message"] : []),
  ];
  return {
    customerFirstName,
    customerLastName,
    customerEmail,
    customerPhone,
    customerUnitNumber,
    customerStreetAddress,
    customerSuburb,
    customerAddressState,
    customerMessage,
    noticeVersion,
    consentPurpose,
    grantedAt: new Date(grantedAt).toISOString(),
    disclosedFields,
  };
}

function readable(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function createOpportunityFromLead(payload: DirectTradeLead) {
  if (payload.eventType !== "direct_trade.project") return null;
  const postcode = String(payload.postcode || "");
  const state = canonicalMarketplaceState(payload.state);
  const categories = Array.isArray(payload.projectCategories)
    ? payload.projectCategories.filter((item) => CATEGORY_LABELS[item])
    : [];
  if (!/^\d{4}$/.test(postcode) || !state || !categories.length) return null;

  const reference = String(payload.reference || "").slice(0, 80);
  const db = getD1();
  const submittedAt = Number.isFinite(
    Date.parse(String(payload.submittedAt || "")),
  )
    ? new Date(String(payload.submittedAt))
    : new Date();
  const categoryNames = categories.map((item) => CATEGORY_LABELS[item]);
  const priorities = Array.isArray(payload.projectPriorities)
    ? payload.projectPriorities.slice(0, 7).map(readable)
    : [];
  const property = readable(String(payload.propertyType || "home"));
  const stage = readable(String(payload.projectStage || "planning"));
  const summary = `${property} project at the ${stage.toLowerCase()} stage. ${priorities.length ? `Priorities: ${priorities.join(", ")}. ` : ""}${payload.sourceJourney === "public-home-energy-plan"
    ? "Only the contact fields the customer consented to share are available to approved matching TLink trades. The private home plan and PDF are not shared with trades."
    : payload.sourceJourney === QUICK_UPGRADE_SOURCE_JOURNEY
      ? "The customer requested upgrade options without completing a home plan. Only the request and contact fields they consented to share are available to approved matching TLink trades."
    : payload.sourceJourney === "energy-assistant"
      ? `${String(payload.projectNotes || "").trim().slice(0, 1_500)} Only the immutable quote brief and contact fields explicitly consented for trade sharing are available. Chat history, documents, bills, photos, NMI and account identifiers are not shared.`
    : "Detailed household notes and contact details remain in the protected enquiry record and are not displayed in the opportunity feed."}`;
  const title =
    categoryNames.length === 1
      ? `${readable(categoryNames[0])} project`
      : `${readable(categoryNames.slice(0, -1).join(", "))} and ${readable(categoryNames.at(-1) || "upgrade")} project`;
  const timing =
    payload.timeframe === "urgent"
      ? "urgent"
      : payload.timeframe === "one-three-months"
        ? "within_3_months"
        : "planning";
  const priority = payload.timeframe === "urgent" ? "urgent" : "standard";
  const id = crypto.randomUUID();
  const createdAt = submittedAt.toISOString();
  const contactRelease = publicContactRelease(payload);
  const protectedPublicLead = payload.sourceJourney === "public-home-energy-plan"
    || payload.sourceJourney === "energy-assistant"
    || payload.sourceJourney === QUICK_UPGRADE_SOURCE_JOURNEY;
  const assistantDurableDispatch = payload.sourceJourney === "energy-assistant";
  const opportunityStatus =
    assistantDurableDispatch
    || payload.directTradeTriage?.autoSend === false
    || (protectedPublicLead && !contactRelease)
      ? "draft"
      : "open";
  const stored = await persistLeadOpportunity(db, {
    id,
    title,
    projectType: `${property} | ${stage}`,
    postcode,
    state,
    serviceCategories: JSON.stringify(categories),
    priority,
    timing,
    summary,
    requestedStatus: opportunityStatus,
    sourceReference: reference,
    contactLimit: DEFAULT_CONTACT_LIMIT,
    maximumConnectedInstallers: DEFAULT_CONNECTED_INSTALLERS,
    expiresAt: opportunityExpiry(submittedAt),
    createdAt,
    publicPlanEnquiry: protectedPublicLead,
  }, contactRelease ? {
    id: crypto.randomUUID(),
    ...contactRelease,
  } : null, {
    noticeVersion: payload.sourceJourney === "energy-assistant"
      ? ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION
      : payload.sourceJourney === QUICK_UPGRADE_SOURCE_JOURNEY
        ? QUICK_UPGRADE_CONSENT_NOTICE_VERSION
        : PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    purpose: payload.sourceJourney === "energy-assistant"
      ? ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE
      : payload.sourceJourney === QUICK_UPGRADE_SOURCE_JOURNEY
        ? QUICK_UPGRADE_CONSENT_PURPOSE
        : PUBLIC_PLAN_CONSENT_PURPOSE,
  });
  if (payload.sourceJourney === "public-home-energy-plan") {
    await persistPublicQuotePreparation(
      db,
      stored.id,
      reference,
      payload.quotePreparation,
      payload.directTradeTriage?.contactConsentReceipt,
      createdAt,
    );
  }
  const allocation = assistantDurableDispatch
    ? {
        allocated: [],
        activeCount: 0,
        eligibleCount: 0,
        dispatchRequired: true,
      }
    : stored.status === "open" && stored.contactIsCurrent
      ? await allocateNearestInstallers(stored.id, "automatic-lead-intake")
      : { allocated: [], activeCount: 0, eligibleCount: 0 };
  return { id: stored.id, allocation };
}

export type InstallerCandidate = {
  firebaseUid: string;
  businessName: string;
  distanceKm: number;
  distanceBand: number;
  matchedCategories: string[];
  radiusKm: number;
  recentAssignments: number;
  activeAssignments: number;
  fairnessLoad: number;
};

export function qualifyingServiceArea(
  row: Record<string, unknown>,
  opportunityPostcode: string,
) {
  return closestQualifyingTradeServiceArea({
    activeServiceAreas: row.active_service_areas,
    legacyPostcode: row.service_base_postcode || row.postcode,
    legacyRadiusKm: row.service_radius_km,
    destinationPostcode: opportunityPostcode,
  }, postcodeDistanceKm) as {
    postcode: string;
    radiusKm: number;
    distanceKm: number;
  } | null;
}

function candidateFromRow(
  row: Record<string, unknown>,
  opportunity: Record<string, unknown>,
): InstallerCandidate | null {
  const serviceStates = parseJsonList(row.service_states).map(canonicalMarketplaceState).filter(Boolean);
  const capabilities = parseJsonList(row.capabilities);
  const categories = parseJsonList(opportunity.service_categories);
  const state = canonicalMarketplaceState(opportunity.state);
  const matchedCategories = matchedServiceCategories(categories, capabilities);
  if (!serviceStates.includes(state) || !matchedCategories.length) return null;
  const serviceArea = qualifyingServiceArea(
    row,
    String(opportunity.postcode || ""),
  );
  if (!serviceArea) return null;
  const { distanceKm, radiusKm } = serviceArea;
  const recentAssignments = Number(row.recent_assignments || 0);
  const activeAssignments = Number(row.active_assignments || 0);
  return {
    firebaseUid: String(row.firebase_uid),
    businessName: String(row.business_name),
    distanceKm,
    distanceBand: Math.floor(distanceKm / 10),
    matchedCategories,
    radiusKm,
    recentAssignments,
    activeAssignments,
    fairnessLoad:
      recentAssignments +
      activeAssignments * 2 +
      (row.availability_status === "limited" ? 2 : 0),
  };
}

export async function allocateNearestInstallers(
  opportunityId: string,
  matchedByUid: string,
) {
  await expireStaleOpportunities();
  const db = getD1();
  const opportunity = await db
    .prepare(
      `SELECT id, title, postcode, state, service_categories, status, expires_at, COALESCE(is_synthetic, 0) is_synthetic
    FROM trade_opportunities WHERE id = ?`,
    )
    .bind(opportunityId)
    .first<Record<string, unknown>>();
  if (!opportunity) throw new Error("OPPORTUNITY_NOT_FOUND");
  if (opportunity.status !== "open") throw new Error("OPPORTUNITY_NOT_OPEN");
  if (
    postcodeDistanceKm(
      String(opportunity.postcode),
      String(opportunity.postcode),
    ) === null
  )
    throw new Error("POSTCODE_CENTROID_UNAVAILABLE");

  const existing = await db
    .prepare(
      `SELECT firebase_uid, status, matched_categories
      FROM trade_opportunity_matches WHERE opportunity_id = ?`,
    )
    .bind(opportunityId)
    .all<Record<string, unknown>>();
  const previouslyMatched = new Set(
    existing.results.map((item: Record<string, unknown>) => String(item.firebase_uid)),
  );
  const activeCount = existing.results.filter((item: Record<string, unknown>) =>
    ACTIVE_MATCH_STATUSES.has(String(item.status)),
  ).length;
  const lifetimeRecipientCount = existing.results.length;

  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(
      `SELECT a.firebase_uid, a.business_name, a.postcode, a.service_base_postcode,
    a.service_radius_km, a.service_states, a.capabilities, a.availability_status,
    COALESCE((
      SELECT json_group_array(json_object(
        'postcode', service_area.postcode,
        'radiusKm', service_area.radius_km
      ))
      FROM trade_account_service_areas service_area
      WHERE service_area.firebase_uid = a.firebase_uid
        AND service_area.record_status = 'active'
    ), '[]') active_service_areas,
    (SELECT COUNT(*) FROM trade_opportunity_matches rm WHERE rm.firebase_uid = a.firebase_uid AND rm.matched_at >= ?) recent_assignments,
    (SELECT COUNT(*) FROM trade_opportunity_matches am JOIN trade_opportunities ao ON ao.id = am.opportunity_id
      WHERE am.firebase_uid = a.firebase_uid AND am.status IN ('offered', 'viewed', 'interested', 'connected') AND ao.status = 'open') active_assignments
    FROM trade_accounts a
    WHERE ${verifiedTradeAccountPredicate("a")} AND a.partner_type = 'installer'
      AND COALESCE(a.is_synthetic, 0) = ?
      AND a.availability_status IN ('open', 'limited')`,
    )
    .bind(cutoff, Number(opportunity.is_synthetic || 0))
    .all<Record<string, unknown>>();

  const qualifiedCandidates = rows.results
    .map((row: Record<string, unknown>) => candidateFromRow(row, opportunity))
    .filter((item: InstallerCandidate | null): item is InstallerCandidate => Boolean(item));
  const candidates = qualifiedCandidates
    .filter((candidate: InstallerCandidate) => !previouslyMatched.has(candidate.firebaseUid))
    .sort(
      (left: InstallerCandidate, right: InstallerCandidate) =>
        left.distanceBand - right.distanceBand ||
        left.fairnessLoad - right.fairnessLoad ||
        left.distanceKm - right.distanceKm ||
        left.businessName.localeCompare(right.businessName),
    );

  const selected = selectEveryQualifiedTradeRecipient(
    candidates,
  ) as InstallerCandidate[];
  const allocated: InstallerCandidate[] = [];
  for (
    let offset = 0;
    offset < selected.length;
    offset += D1_ALLOCATION_WRITE_BATCH_SIZE
  ) {
    const batch = selected.slice(offset, offset + D1_ALLOCATION_WRITE_BATCH_SIZE);
    const results = await db.batch(
      batch.map((candidate: InstallerCandidate, index: number) =>
        db
          .prepare(
            `INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, admin_note, partner_note, matched_categories,
     distance_metres, allocation_rank, match_source, contact_attempt_count, last_contact_at, connected_at,
     matched_by_uid, matched_at, updated_at)
    VALUES (?, ?, ?, 'offered', '', '', ?, ?, ?, 'automatic', 0, '', '', ?, ?, ?)
    ON CONFLICT(opportunity_id, firebase_uid) DO NOTHING`,
          )
          .bind(
            crypto.randomUUID(),
            opportunityId,
            candidate.firebaseUid,
            JSON.stringify(candidate.matchedCategories),
            Math.round(candidate.distanceKm * 1000),
            lifetimeRecipientCount + offset + index + 1,
            matchedByUid,
            now,
            now,
          ),
      ),
    );
    results.forEach((result, index) => {
      if (Number(result.meta.changes || 0) > 0) allocated.push(batch[index]);
    });
  }
  if (allocated.length || existing.results.length) {
    await syncMarketplaceEnquiries(db, opportunityId);
  }
  await ensureOpportunityNotificationDeliveries(opportunityId);
  return {
    allocated,
    activeCount: activeCount + allocated.length,
    eligibleCount: qualifiedCandidates.length,
    alreadyAllocatedCount: qualifiedCandidates.length - candidates.length,
  };
}
