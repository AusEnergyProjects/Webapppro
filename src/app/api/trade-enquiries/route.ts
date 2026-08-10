import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import {
  requireVerifiedTradeAccess,
  TradeAccessError,
  verifiedTradeAccountPredicate,
} from "@/lib/trade-access-server";
import { findDirectCustomerDuplicates } from "@/lib/trade-customer-dedup-server";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "@/lib/public-plan-enquiry.mjs";

export const runtime = "edge";

const ENQUIRY_STATUSES = new Set(["new", "contacted", "site_visit", "quote_required", "quoted", "booked", "won", "lost"]);
const CUSTOMER_TYPES = new Set(["residential", "business"]);
const STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const SERVICE_CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "draught-proofing", "insulation", "glazing", "window-coverings", "ev-charging", "electrical", "plumbing", "mounting-hardware", "controls", "other"]);
const currentPublicMarketplaceAccessSql = (enquiryAlias: string) => `(
  ${enquiryAlias}.source_type <> 'tlink_marketplace'
  OR NOT EXISTS (
    SELECT 1
    FROM trade_opportunity_matches identified_public_match
    JOIN public_trade_lead_contact_releases identified_public_release
      ON identified_public_release.opportunity_id = identified_public_match.opportunity_id
    WHERE identified_public_match.id = ${enquiryAlias}.opportunity_match_id
  )
  OR EXISTS (
    SELECT 1
    FROM trade_opportunity_matches current_public_match
    JOIN trade_opportunities current_public_opportunity
      ON current_public_opportunity.id = current_public_match.opportunity_id
    JOIN trade_accounts current_public_account
      ON current_public_account.firebase_uid = current_public_match.firebase_uid
    JOIN public_trade_lead_contact_releases current_public_release
      ON current_public_release.opportunity_id = current_public_opportunity.id
    WHERE current_public_match.id = ${enquiryAlias}.opportunity_match_id
      AND current_public_match.firebase_uid = ${enquiryAlias}.firebase_uid
      AND current_public_release.status = 'active'
      AND current_public_release.notice_version = '${PUBLIC_PLAN_CONSENT_NOTICE_VERSION}'
      AND current_public_release.consent_purpose = '${PUBLIC_PLAN_CONSENT_PURPOSE}'
      AND datetime(current_public_release.granted_at) IS NOT NULL
      AND current_public_release.withdrawn_at = ''
      AND current_public_release.postcode = current_public_opportunity.postcode
      AND current_public_account.partner_type = 'installer'
      AND ${verifiedTradeAccountPredicate("current_public_account")}
  )
)`;

async function installerIdentity(request: Request) {
  const access = await requireVerifiedTradeAccess(request, { partnerTypes: ["installer"] });
  const entitlements = await accountEntitlements(access.identity.uid, "installer");
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  return { uid: access.identity.uid };
}

function errorResponse(error: unknown) {
  const code = error instanceof TradeAccessError ? error.code : error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the business profile first." }, 404);
  if (code === "INSTALLER_ONLY" || code === "TRADE_ROLE_REQUIRED") return adminJson({ ok: false, error: "The enquiry inbox is available to installer accounts only." }, 403);
  if (code === "ACCOUNT_INACTIVE" || code === "FULL_ACCESS_REQUIRED" || code === "ABN_REVIEW_REQUIRED" || code === "EMAIL_VERIFICATION_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using the enquiry inbox." }, 403);
  if (code === "ENQUIRY_NOT_FOUND") return adminJson({ ok: false, error: "Enquiry not found." }, 404);
  if (code === "PROTECTED_CUSTOMER_BOUNDARY") return adminJson({ ok: false, error: "Protected marketplace details cannot be copied into private customer records. Continue in the marketplace workflow." }, 409);
  return adminJson({ ok: false, error: "The private enquiry request could not be completed." }, 500);
}

function parseRows(result: D1Result<Record<string, unknown>>) {
  return result.results.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value])));
}

function parseRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
}

async function ownedEnquiry(uid: string, id: string) {
  const row = await getD1().prepare(`SELECT enquiry.* FROM trade_crm_enquiries enquiry
    WHERE enquiry.id = ? AND enquiry.firebase_uid = ? AND enquiry.record_status = 'active'
      AND ${currentPublicMarketplaceAccessSql("enquiry")}`).bind(id, uid).first<Record<string, unknown>>();
  if (!row) throw new Error("ENQUIRY_NOT_FOUND");
  return row;
}

function enquiryValues(body: Record<string, unknown>) {
  const customerType = cleanAdminText(body.customerType, 20).toLowerCase() || "residential";
  const addressState = cleanAdminText(body.addressState, 10).toUpperCase();
  const serviceCategory = cleanAdminText(body.serviceCategory, 60).toLowerCase() || "other";
  if (!CUSTOMER_TYPES.has(customerType) || (addressState && !STATES.has(addressState)) || !SERVICE_CATEGORIES.has(serviceCategory)) throw new Error("INVALID_ENQUIRY");
  return {
    customerType, firstName: cleanAdminText(body.firstName, 80), lastName: cleanAdminText(body.lastName, 80),
    businessName: cleanAdminText(body.businessName, 140), businessNumber: cleanAdminText(body.businessNumber, 30),
    email: cleanAdminText(body.email, 180).toLowerCase(), phone: cleanAdminText(body.phone, 40),
    addressLine1: cleanAdminText(body.addressLine1, 140), addressLine2: cleanAdminText(body.addressLine2, 140),
    suburb: cleanAdminText(body.suburb, 80), addressState, postcode: cleanAdminText(body.postcode, 12),
    serviceCategory, description: cleanAdminText(body.description, 3000), urgency: cleanAdminText(body.urgency, 20) || "standard",
    preferredDate: cleanAdminText(body.preferredDate, 10), externalRecordId: cleanAdminText(body.externalRecordId, 120),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { uid } = await installerIdentity(request);
    const url = new URL(request.url);
    const id = cleanAdminText(url.searchParams.get("id"), 180);
    const db = getD1();
    if (id) {
      const enquiry = await ownedEnquiry(uid, id);
      const [messages, attachments, events, candidates] = await Promise.all([
        db.prepare("SELECT * FROM trade_crm_enquiry_messages WHERE enquiry_id = ? AND firebase_uid = ? ORDER BY occurred_at DESC").bind(id, uid).all<Record<string, unknown>>(),
        db.prepare("SELECT * FROM trade_crm_enquiry_attachments WHERE enquiry_id = ? AND firebase_uid = ? ORDER BY created_at DESC").bind(id, uid).all<Record<string, unknown>>(),
        db.prepare("SELECT * FROM trade_crm_enquiry_events WHERE enquiry_id = ? AND firebase_uid = ? ORDER BY created_at DESC").bind(id, uid).all<Record<string, unknown>>(),
        Number(enquiry.protected_source) ? Promise.resolve([]) : findDirectCustomerDuplicates(db, uid, {
          email: enquiry.email, phone: enquiry.phone, businessNumber: enquiry.business_number,
          addressLine1: enquiry.address_line_1, suburb: enquiry.suburb, addressState: enquiry.address_state, postcode: enquiry.postcode,
        }),
      ]);
      return adminJson({ ok: true, enquiry: parseRow(enquiry), messages: parseRows(messages), attachments: parseRows(attachments), events: parseRows(events), duplicateCandidates: candidates });
    }
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const source = cleanAdminText(url.searchParams.get("source"), 40);
    const search = cleanAdminText(url.searchParams.get("search"), 120).toLowerCase();
    const rows = await db.prepare(`SELECT enquiry.* FROM trade_crm_enquiries enquiry WHERE enquiry.firebase_uid = ? AND enquiry.record_status = 'active'
      AND ${currentPublicMarketplaceAccessSql("enquiry")}
      AND (? = '' OR enquiry.status = ?) AND (? = '' OR enquiry.source_type = ?)
      AND (? = '' OR LOWER(enquiry.first_name || ' ' || enquiry.last_name || ' ' || enquiry.business_name || ' ' || enquiry.email || ' ' || enquiry.phone || ' ' || enquiry.description || ' ' || enquiry.source_reference) LIKE '%' || ? || '%')
      ORDER BY CASE enquiry.status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'site_visit' THEN 2 WHEN 'quote_required' THEN 3 WHEN 'quoted' THEN 4 WHEN 'booked' THEN 5 ELSE 6 END, enquiry.updated_at DESC LIMIT 250`)
      .bind(uid, status, status, source, source, search, search).all<Record<string, unknown>>();
    return adminJson({ ok: true, enquiries: parseRows(rows) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { uid } = await installerIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();
    if (action === "create") {
      const values = enquiryValues(body);
      if (!values.businessName && !values.firstName && !values.lastName) return adminJson({ ok: false, error: "Add a person or business name." }, 400);
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO trade_crm_enquiries
          (id, firebase_uid, source_type, source_reference, external_record_id, status, customer_type, first_name, last_name,
           business_name, business_number, email, phone, address_line_1, address_line_2, suburb, address_state, postcode,
           service_category, service_categories, description, urgency, preferred_date, protected_source, duplicate_decision, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unchecked', 'active', ?, ?)`)
          .bind(id, uid, cleanAdminText(body.sourceType, 40) || "direct", id, values.externalRecordId, values.customerType, values.firstName, values.lastName, values.businessName, values.businessNumber, values.email, values.phone, values.addressLine1, values.addressLine2, values.suburb, values.addressState, values.postcode, values.serviceCategory, JSON.stringify([values.serviceCategory]), values.description, values.urgency, values.preferredDate, now, now),
        db.prepare("INSERT INTO trade_crm_enquiry_events (id, enquiry_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'created', 'Direct enquiry recorded.', ?)").bind(crypto.randomUUID(), id, uid, now),
      ]);
      return adminJson({ ok: true, id }, 201);
    }
    const enquiryId = cleanAdminText(body.enquiryId, 180);
    const enquiry = await ownedEnquiry(uid, enquiryId);
    if (action === "update_status") {
      const status = cleanAdminText(body.status, 30);
      if (!ENQUIRY_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid enquiry status." }, 400);
      await db.batch([
        db.prepare("UPDATE trade_crm_enquiries SET status = ?, lost_reason = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(status, status === "lost" ? cleanAdminText(body.lostReason, 300) : "", now, enquiryId, uid),
        db.prepare("INSERT INTO trade_crm_enquiry_events (id, enquiry_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'status_changed', ?, ?)").bind(crypto.randomUUID(), enquiryId, uid, `Status changed to ${status.replaceAll("_", " ")}.`, now),
      ]);
      return adminJson({ ok: true });
    }
    if (action === "add_message") {
      const message = cleanAdminText(body.message, 4000);
      if (!message) return adminJson({ ok: false, error: "Add a conversation note." }, 400);
      const channel = Number(enquiry.protected_source) ? "note" : cleanAdminText(body.channel, 30) || "note";
      const direction = Number(enquiry.protected_source) ? "internal" : cleanAdminText(body.direction, 30) || "internal";
      await db.prepare(`INSERT INTO trade_crm_enquiry_messages
        (id, enquiry_id, firebase_uid, channel, direction, subject, body, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`)
        .bind(crypto.randomUUID(), enquiryId, uid, channel, direction, message, now, now).run();
      await db.prepare("UPDATE trade_crm_enquiries SET updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(now, enquiryId, uid).run();
      return adminJson({ ok: true });
    }
    if (action !== "convert") return adminJson({ ok: false, error: "Unsupported enquiry action." }, 400);
    if (Number(enquiry.protected_source)) throw new Error("PROTECTED_CUSTOMER_BOUNDARY");
    const decision = cleanAdminText(body.duplicateDecision, 30);
    if (!new Set(["create_new", "use_existing"]).has(decision)) return adminJson({ ok: false, error: "Choose a new customer or an existing duplicate before converting." }, 400);
    let customerId = "";
    let contactId = "";
    let serviceSiteId = "";
    const statements: D1PreparedStatement[] = [];
    if (decision === "use_existing") {
      customerId = cleanAdminText(body.customerId, 180);
      const requestedServiceSiteSupplied = Object.prototype.hasOwnProperty.call(body, "serviceSiteId");
      const requestedServiceSiteId = cleanAdminText(body.serviceSiteId, 180);
      const customer = await db.prepare("SELECT id FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'").bind(customerId, uid).first();
      if (!customer) return adminJson({ ok: false, error: "Choose an existing customer from the duplicate review." }, 400);
      const primaryContact = await db.prepare(`SELECT id FROM trade_crm_customer_contacts
        WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active'
        ORDER BY is_primary DESC, created_at LIMIT 1`)
        .bind(customerId, uid)
        .first<Record<string, unknown>>();
      contactId = String(primaryContact?.id || "");
      if (requestedServiceSiteId) {
        const selectedSite = await db.prepare(`SELECT id FROM trade_crm_service_sites
          WHERE id = ? AND customer_id = ? AND firebase_uid = ? AND record_status = 'active'`)
          .bind(requestedServiceSiteId, customerId, uid)
          .first<Record<string, unknown>>();
        if (!selectedSite) {
          return adminJson({ ok: false, error: "Choose a service site that belongs to the selected customer." }, 400);
        }
        serviceSiteId = String(selectedSite.id);
      } else if (!requestedServiceSiteSupplied) {
        const primarySite = await db.prepare(`SELECT id FROM trade_crm_service_sites
          WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active'
          ORDER BY is_primary DESC, created_at LIMIT 1`)
          .bind(customerId, uid)
          .first<Record<string, unknown>>();
        serviceSiteId = String(primarySite?.id || "");
      }
    } else {
      customerId = crypto.randomUUID(); contactId = crypto.randomUUID(); serviceSiteId = crypto.randomUUID();
      const siteContactId = crypto.randomUUID();
      const customerNumber = `CUS-${now.slice(2, 7).replace("-", "")}-${customerId.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
      statements.push(
        db.prepare(`INSERT INTO trade_crm_customers
          (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, business_number, email, phone,
           address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'active', ?, ?)`)
          .bind(customerId, uid, customerNumber, enquiry.customer_type, enquiry.first_name, enquiry.last_name, enquiry.business_name, enquiry.business_number, enquiry.email, enquiry.phone, enquiry.address_line_1, enquiry.address_line_2, enquiry.suburb, enquiry.address_state, enquiry.postcode, `Created from ${String(enquiry.source_type).replaceAll("_", " ")} enquiry ${String(enquiry.source_reference)}.`, now, now),
        db.prepare(`INSERT INTO trade_crm_customer_contacts
          (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'Primary contact', ?, ?, 1, 'active', ?, ?)`)
          .bind(contactId, uid, customerId, enquiry.first_name, enquiry.last_name, enquiry.email, enquiry.phone, now, now),
        db.prepare(`INSERT INTO trade_crm_service_sites
          (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
           access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, 'Primary site', ?, ?, ?, ?, ?, '', '', '', 1, 'active', ?, ?)`)
          .bind(serviceSiteId, uid, customerId, enquiry.address_line_1, enquiry.address_line_2, enquiry.suburb, enquiry.address_state, enquiry.postcode, now, now),
        db.prepare(`INSERT INTO trade_crm_site_contacts
          (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'Primary service contact', 1, 'active', ?, ?)`)
          .bind(siteContactId, uid, serviceSiteId, contactId, now, now),
      );
    }
    statements.push(
      db.prepare(`UPDATE trade_crm_enquiries SET customer_id = ?, customer_contact_id = ?, service_site_id = ?,
        duplicate_decision = ?, status = CASE WHEN status = 'lost' THEN status ELSE 'won' END, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(customerId, contactId, serviceSiteId, decision, now, enquiryId, uid),
      db.prepare("INSERT INTO trade_crm_enquiry_events (id, enquiry_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'converted', ?, ?)")
        .bind(crypto.randomUUID(), enquiryId, uid, decision === "create_new" ? "Converted into a new customer and primary service site." : "Linked to an existing customer after duplicate review.", now),
    );
    await db.batch(statements);
    return adminJson({ ok: true, customerId, customerContactId: contactId, serviceSiteId });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_ENQUIRY") return adminJson({ ok: false, error: "Check the customer type, state and service category." }, 400);
    return errorResponse(error);
  }
}
