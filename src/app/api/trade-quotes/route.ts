import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { normaliseTradeQuoteLines } from "@/lib/trade-quote";
import { priceBookItemsForQuote, resolvePriceBookQuoteLines } from "@/lib/trade-price-book-server";

export const runtime = "edge";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function installerIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status FROM trade_accounts WHERE firebase_uid = ?`)
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_ONLY");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  return identity;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the business profile first." }, 404);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Direct customer quotes are available to installer accounts only." }, 403);
  if (code === "ACCOUNT_INACTIVE" || code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using customer quotes." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Choose a direct customer job with an authoritative service site." }, 404);
  if (code === "QUOTE_NOT_FOUND") return adminJson({ ok: false, error: "Quote not found." }, 404);
  if (code === "IMMUTABLE_VERSION") return adminJson({ ok: false, error: "Issued quote versions cannot be changed. Create the next version instead." }, 409);
  if (code === "PRICE_BOOK_ITEM_UNAVAILABLE") return adminJson({ ok: false, error: "A saved item is no longer active. Remove it or add its replacement from the price book." }, 409);
  if (["INVALID_LINES", "INVALID_DECIMAL", "INVALID_QUANTITY", "INVALID_MONEY", "INVALID_TAX", "INVALID_TOTAL", "QUOTE_TOTAL_TOO_LARGE"].includes(code))
    return adminJson({ ok: false, error: "Check every line description, quantity, price and tax selection." }, 400);
  return adminJson({ ok: false, error: "The private quote request could not be completed." }, 500);
}

async function directJob(uid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id, w.work_number, w.title, d.crm_customer_id, d.service_site_id,
      c.customer_number, c.first_name, c.last_name, c.business_name, c.email customer_email,
      s.site_label, s.address_line_1, s.suburb, s.address_state, s.postcode
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
    JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.customer_id = c.id AND s.firebase_uid = w.firebase_uid AND s.record_status = 'active'
    WHERE w.id = ? AND w.firebase_uid = ? AND w.record_status = 'active' AND d.customer_source = 'trade_owned'`)
    .bind(workOrderId, uid).first<Record<string, unknown>>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  return row;
}

async function authorisedEmails(uid: string, customerId: string) {
  const rows = await getD1().prepare(`SELECT email FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND email != ''
    UNION SELECT email FROM trade_crm_customer_contacts WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' AND email != ''`)
    .bind(customerId, uid, customerId, uid).all<Record<string, unknown>>();
  return [...new Set(rows.results.map((row) => String(row.email || "").trim().toLowerCase()).filter(Boolean))].sort();
}

async function quotePayload(uid: string, workOrderId: string) {
  const db = getD1();
  const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`)
    .bind(workOrderId, uid).first<Record<string, unknown>>();
  if (!quote) return null;
  const versions = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? ORDER BY version_number DESC`)
    .bind(quote.id, uid).all<Record<string, unknown>>();
  const versionIds = versions.results.map((row) => String(row.id));
  const items = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE firebase_uid = ? AND quote_version_id IN (${versionIds.map(() => "?").join(",")}) ORDER BY quote_version_id, position`)
    .bind(uid, ...versionIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const acceptances = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_acceptances WHERE firebase_uid = ? AND quote_version_id IN (${versionIds.map(() => "?").join(",")})`)
    .bind(uid, ...versionIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  return {
    id: String(quote.id), workOrderId: String(quote.work_order_id), customerId: String(quote.crm_customer_id), serviceSiteId: String(quote.service_site_id),
    quoteNumber: String(quote.quote_number), currentVersionNumber: Number(quote.current_version_number), status: String(quote.status),
    versions: versions.results.map((version) => ({
      id: String(version.id), versionNumber: Number(version.version_number), status: String(version.status), customerEmail: String(version.acceptance_email || ""),
      subtotalCents: Number(version.subtotal_cents), taxCents: Number(version.tax_cents), totalCents: Number(version.total_cents), terms: String(version.terms || ""),
      validUntil: String(version.valid_until || ""), consentStatement: String(version.consent_statement || ""), issuedAt: String(version.issued_at || ""),
      createdAt: String(version.created_at), updatedAt: String(version.updated_at),
      items: items.results.filter((item) => item.quote_version_id === version.id).map((item) => ({
        id: String(item.id), position: Number(item.position), lineType: String(item.line_type), description: String(item.description),
        quantityMilli: Number(item.quantity_milli), unitPriceCents: Number(item.unit_price_cents), taxCode: String(item.tax_code),
        subtotalCents: Number(item.subtotal_cents), taxCents: Number(item.tax_cents), totalCents: Number(item.total_cents),
        priceBookItemId: String(item.price_book_item_id || ""), priceBookItemType: String(item.price_book_item_type || ""),
      })),
      acceptance: acceptances.results.find((item) => item.quote_version_id === version.id) ? (() => {
        const acceptance = acceptances.results.find((item) => item.quote_version_id === version.id)!;
        return { decision: String(acceptance.decision), actorEmail: String(acceptance.actor_email), decidedAt: String(acceptance.decided_at), consentStatement: String(acceptance.consent_statement) };
      })() : null,
    })),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await installerIdentity(request); const url = new URL(request.url);
    const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180); const job = await directJob(identity.uid, workOrderId);
    const emails = await authorisedEmails(identity.uid, String(job.crm_customer_id));
    return adminJson({ ok: true, job: { workNumber: job.work_number, title: job.title, customerNumber: job.customer_number,
      customerName: job.business_name || [job.first_name, job.last_name].filter(Boolean).join(" "), siteLabel: job.site_label,
      siteSummary: [job.address_line_1, job.suburb, job.address_state, job.postcode].filter(Boolean).join(", ") }, authorisedEmails: emails,
      priceBookItems: await priceBookItemsForQuote(identity.uid), quote: await quotePayload(identity.uid, workOrderId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await installerIdentity(request); const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40); const workOrderId = cleanAdminText(body.workOrderId, 180); const job = await directJob(identity.uid, workOrderId);
    const db = getD1(); const now = new Date().toISOString();
    if (action === "save_draft") {
      const resolvedPriceBook = await resolvePriceBookQuoteLines(identity.uid, body.lines);
      const calculated = normaliseTradeQuoteLines(resolvedPriceBook.lines, (value) => cleanAdminText(value, 500));
      const customerEmail = cleanAdminText(body.customerEmail, 180).toLowerCase(); const emails = await authorisedEmails(identity.uid, String(job.crm_customer_id));
      if (customerEmail && !emails.includes(customerEmail)) return adminJson({ ok: false, error: "Choose an email from this customer's authorised contacts." }, 400);
      const validUntil = cleanAdminText(body.validUntil, 10); if (validUntil && !DATE_PATTERN.test(validUntil)) return adminJson({ ok: false, error: "Choose a valid quote expiry date." }, 400);
      const terms = cleanAdminText(body.terms, 4000);
      const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, identity.uid).first<Record<string, unknown>>();
      const quoteId = String(quote?.id || crypto.randomUUID()); let versionNumber = Number(quote?.current_version_number || 1); let versionId = "";
      const statements = [];
      if (!quote) {
        const quoteNumber = `Q-${String(job.work_number).replace(/^JOB-/, "")}`;
        statements.push(db.prepare(`INSERT INTO trade_crm_quotes
          (id, work_order_id, firebase_uid, crm_customer_id, service_site_id, quote_number, current_version_number, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?)`).bind(quoteId, workOrderId, identity.uid, job.crm_customer_id, job.service_site_id, quoteNumber, now, now));
        versionId = crypto.randomUUID();
        statements.push(db.prepare(`INSERT INTO trade_crm_quote_versions
          (id, quote_id, firebase_uid, version_number, status, acceptance_email, subtotal_cents, tax_cents, total_cents, terms, valid_until, consent_statement, issued_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, '', '', ?, ?)`)
          .bind(versionId, quoteId, identity.uid, customerEmail, calculated.subtotalCents, calculated.taxCents, calculated.totalCents, terms, validUntil, now, now));
      } else {
        const current = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? AND version_number = ?`)
          .bind(quoteId, identity.uid, versionNumber).first<Record<string, unknown>>();
        if (!current) throw new Error("QUOTE_NOT_FOUND");
        if (current.status === "draft") {
          versionId = String(current.id);
          statements.push(db.prepare(`UPDATE trade_crm_quote_versions SET acceptance_email = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?,
            terms = ?, valid_until = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'draft'`)
            .bind(customerEmail, calculated.subtotalCents, calculated.taxCents, calculated.totalCents, terms, validUntil, now, versionId, identity.uid));
          statements.push(db.prepare(`DELETE FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ?`).bind(versionId, identity.uid));
        } else {
          versionNumber += 1; versionId = crypto.randomUUID();
          if (current.status === "issued") statements.push(db.prepare(`UPDATE trade_crm_quote_versions SET status = 'superseded', updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'issued'`).bind(now, current.id, identity.uid));
          statements.push(db.prepare(`INSERT INTO trade_crm_quote_versions
            (id, quote_id, firebase_uid, version_number, status, acceptance_email, subtotal_cents, tax_cents, total_cents, terms, valid_until, consent_statement, issued_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, '', '', ?, ?)`)
            .bind(versionId, quoteId, identity.uid, versionNumber, customerEmail, calculated.subtotalCents, calculated.taxCents, calculated.totalCents, terms, validUntil, now, now));
          statements.push(db.prepare(`UPDATE trade_crm_quotes SET current_version_number = ?, status = 'draft', crm_customer_id = ?, service_site_id = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
            .bind(versionNumber, job.crm_customer_id, job.service_site_id, now, quoteId, identity.uid));
        }
      }
      calculated.lines.forEach((line, position) => {
        const reference = resolvedPriceBook.references[position];
        statements.push(db.prepare(`INSERT INTO trade_crm_quote_items
          (id, quote_version_id, firebase_uid, position, line_type, description, quantity_milli, unit_price_cents, tax_code,
          subtotal_cents, tax_cents, total_cents, price_book_item_id, price_book_item_type, unit_cost_cents_ex_gst,
          markup_basis_points, margin_basis_points, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), versionId, identity.uid, position + 1, line.lineType, line.description, line.quantityMilli,
            line.unitPriceCents, line.taxCode, line.subtotalCents, line.taxCents, line.totalCents, reference?.id || "",
            reference?.itemType || "", reference?.unitCostCentsExGst || 0, reference?.markupBasisPoints || 0,
            reference?.marginBasisPoints || 0, now));
      });
      statements.push(db.prepare(`UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = 'draft', updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(calculated.totalCents, now, workOrderId, identity.uid));
      await db.batch(statements);
      return adminJson({ ok: true, quote: await quotePayload(identity.uid, workOrderId) });
    }
    if (action === "issue_quote") {
      const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, identity.uid).first<Record<string, unknown>>();
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      const version = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? AND version_number = ? AND status = 'draft'`)
        .bind(quote.id, identity.uid, quote.current_version_number).first<Record<string, unknown>>();
      if (!version) throw new Error("IMMUTABLE_VERSION");
      const customerEmail = String(version.acceptance_email || ""); const emails = await authorisedEmails(identity.uid, String(job.crm_customer_id));
      if (!customerEmail || !emails.includes(customerEmail)) return adminJson({ ok: false, error: "Choose an authorised customer email before issuing this quote." }, 400);
      if (!String(version.terms || "").trim()) return adminJson({ ok: false, error: "Record the quote scope, exclusions and completion terms before issuing." }, 400);
      if (version.valid_until && String(version.valid_until) < now.slice(0, 10)) return adminJson({ ok: false, error: "The quote expiry date must not be in the past." }, 400);
      const itemCount = await db.prepare(`SELECT COUNT(*) count FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ?`).bind(version.id, identity.uid).first<Record<string, unknown>>();
      if (!Number(itemCount?.count)) return adminJson({ ok: false, error: "Add at least one quote line before issuing." }, 400);
      const consentStatement = `I accept quote ${quote.quote_number} version ${version.version_number} for AUD ${(Number(version.total_cents) / 100).toFixed(2)} and authorise the described work subject to its recorded terms.`;
      await db.batch([
        db.prepare(`UPDATE trade_crm_quote_versions SET status = 'superseded', updated_at = ? WHERE quote_id = ? AND firebase_uid = ? AND status = 'issued'`).bind(now, quote.id, identity.uid),
        db.prepare(`UPDATE trade_crm_quote_versions SET status = 'issued', consent_statement = ?, issued_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'draft'`).bind(consentStatement, now, now, version.id, identity.uid),
        db.prepare(`UPDATE trade_crm_quotes SET status = 'issued', crm_customer_id = ?, service_site_id = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(job.crm_customer_id, job.service_site_id, now, quote.id, identity.uid),
        db.prepare(`UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = 'sent', updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(version.total_cents, now, workOrderId, identity.uid),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'quote_issued', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, identity.uid, `${quote.quote_number} version ${version.version_number} issued for authenticated customer review.`, now),
      ]);
      return adminJson({ ok: true, quote: await quotePayload(identity.uid, workOrderId) });
    }
    return adminJson({ ok: false, error: "Unsupported quote action." }, 400);
  } catch (error) { return errorResponse(error); }
}
