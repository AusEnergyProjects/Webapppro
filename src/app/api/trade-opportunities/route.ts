import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { parseJsonList } from "@/lib/admin-server";
import {
  allocateNearestInstallers,
  expireStaleOpportunities,
  syncMarketplaceEnquiries,
} from "@/lib/opportunity-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";
import { normalizePlatformQuote, parseStoredJson } from "@/lib/customer-projects.mjs";
import { adminNotificationStatement, createAdminNotification } from "@/lib/admin-notifications";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";

export const runtime = "edge";
const PARTNER_STATUSES = new Set(["viewed", "interested", "declined"]);

function distanceBand(value: unknown) {
  const kilometres = Number(value || 0) / 1000;
  if (kilometres < 10) return "Within 10 km of your service base";
  if (kilometres < 25) return "10 to 25 km from your service base";
  if (kilometres < 50) return "25 to 50 km from your service base";
  if (kilometres < 100) return "50 to 100 km from your service base";
  return "More than 100 km from your service base";
}

async function productSnapshot(installerUid: string, productListId: string) {
  if (!productListId) return { products: [], subtotalCentsExGst: 0 };
  const db = getD1();
  const list = await db.prepare("SELECT id FROM installer_product_lists WHERE id = ? AND firebase_uid = ?")
    .bind(productListId, installerUid).first();
  if (!list) throw new Error("PRODUCT_LIST_REQUIRED");
  const allItems = await db.prepare("SELECT COUNT(*) count FROM installer_product_list_items WHERE list_id = ?")
    .bind(productListId).first<{ count: number }>();
  const rows = await db.prepare(`SELECT i.product_id, i.quantity, i.unit_price_cents_ex_gst,
    p.model_number, p.brand, p.name, p.unit_label
    FROM installer_product_list_items i
    JOIN supplier_products p ON p.id = i.product_id
    JOIN trade_accounts a ON a.firebase_uid = i.supplier_uid
    WHERE i.list_id = ? AND p.listing_status = 'published' AND p.review_status = 'approved'
      AND a.partner_type = 'supplier' AND a.account_status = 'active' AND a.verification_status = 'approved'
      ORDER BY p.brand, p.name`).bind(productListId).all<Record<string, unknown>>();
  if (!rows.results.length || rows.results.length !== Number(allItems?.count || 0)) throw new Error("PRODUCT_LIST_UNAVAILABLE");
  const products = rows.results.map((row: Record<string, unknown>) => ({
    productId: row.product_id,
    brand: row.brand,
    name: row.name,
    modelNumber: row.model_number,
    unitLabel: row.unit_label,
    quantity: Number(row.quantity || 0),
    unitPriceCentsExGst: Number(row.unit_price_cents_ex_gst || 0),
  }));
  return { products, subtotalCentsExGst: products.reduce((sum: number, item: { quantity: number; unitPriceCentsExGst: number }) => sum + item.quantity * item.unitPriceCentsExGst, 0) };
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const db = getD1();
  const account = await db
    .prepare(
      "SELECT account_status, partner_type, billing_status, business_name FROM trade_accounts WHERE firebase_uid = ?",
    )
    .bind(user.uid)
    .first<Record<string, unknown>>();
  if (!account)
    return json(
      { ok: false, error: "Complete the business profile first." },
      404,
    );
  if (account.partner_type !== "installer")
    return json(
      {
        ok: false,
        error:
          "Household opportunities are never available to wholesaler accounts.",
      },
      403,
    );
  if (account.account_status !== "active")
    return json(
      { ok: false, error: "This business account is not active." },
      403,
    );
  if (!await accountHasFeature(user.uid, "installer", account.billing_status, "installer_leads"))
    return json(
      { ok: false, error: "Complete trade verification before opening marketplace opportunities." },
      403,
    );
  await expireStaleOpportunities();
  const rows = await db
    .prepare(
      `SELECT m.id match_id, m.status match_status, m.matched_categories,
    m.distance_metres, m.allocation_rank, m.contact_attempt_count, m.last_contact_at, m.connected_at, m.matched_at, m.updated_at,
    o.id, o.title, o.project_type, o.postcode, o.state, o.service_categories, o.priority, o.timing, o.summary, o.status,
    o.contact_limit, o.maximum_connected_installers, o.expires_at, o.source_reference,
    q.id quote_id, q.product_list_id, q.inclusions quote_inclusions, q.product_snapshot,
    q.product_subtotal_cents_ex_gst, q.labour_cents_ex_gst, q.other_cents_ex_gst, q.total_cents_ex_gst,
    q.quote_type, q.start_window, q.duration_weeks, q.workmanship_warranty_years, q.status quote_status,
    q.customer_decision, q.submitted_at quote_submitted_at
    FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
    LEFT JOIN customer_project_quotes q ON q.opportunity_match_id = m.id AND q.installer_uid = m.firebase_uid
    WHERE m.firebase_uid = ? AND o.status IN ('open', 'paused') AND m.status IN ('offered', 'viewed', 'interested', 'connected')
    ORDER BY CASE m.status WHEN 'offered' THEN 0 WHEN 'viewed' THEN 1 WHEN 'interested' THEN 2 WHEN 'connected' THEN 3 ELSE 4 END, m.updated_at DESC
    LIMIT 100`,
    )
    .bind(user.uid)
    .all<Record<string, unknown>>();
  return json({
    ok: true,
    opportunities: rows.results.map((row: Record<string, unknown>) => ({
      matchId: row.match_id,
      matchStatus: row.match_status,
      matchedCategories: parseJsonList(row.matched_categories),
      distanceBand: distanceBand(row.distance_metres),
      allocationRank: Number(row.allocation_rank || 0),
      contactAttemptCount: Number(row.contact_attempt_count || 0),
      contactLimit: Number(row.contact_limit || 2),
      lastContactAt: row.last_contact_at,
      connectedAt: row.connected_at,
      expiresAt: row.expires_at,
      matchedAt: row.matched_at,
      updatedAt: row.updated_at,
      id: row.id,
      title: row.title,
      projectType: row.project_type,
      postcode: "",
      state: row.state,
      serviceCategories: parseJsonList(row.service_categories),
      priority: row.priority,
      timing: row.timing,
      summary: row.summary,
      opportunityStatus: row.status,
      platformOnly: String(row.source_reference || "").startsWith("customer-project:"),
      quote: row.quote_id ? {
        id: row.quote_id,
        productListId: row.product_list_id,
        inclusions: parseStoredJson(row.quote_inclusions, []),
        products: parseStoredJson(row.product_snapshot, []),
        productSubtotalCentsExGst: Number(row.product_subtotal_cents_ex_gst || 0),
        labourCentsExGst: Number(row.labour_cents_ex_gst || 0),
        otherCentsExGst: Number(row.other_cents_ex_gst || 0),
        totalCentsExGst: Number(row.total_cents_ex_gst || 0),
        quoteType: row.quote_type,
        startWindow: row.start_window,
        durationWeeks: Number(row.duration_weeks || 0),
        workmanshipWarrantyYears: Number(row.workmanship_warranty_years || 0),
        status: row.quote_status,
        customerDecision: row.customer_decision,
        submittedAt: row.quote_submitted_at,
      } : null,
    })),
  });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid opportunity response." }, 400);
  }
  const matchId =
    typeof body.matchId === "string" ? body.matchId.trim().slice(0, 180) : "";
  const action = typeof body.action === "string" ? body.action : "respond";
  const status = typeof body.status === "string" ? body.status : "";
  if (!matchId)
    return json({ ok: false, error: "Choose a valid opportunity." }, 400);
  const db = getD1();
  const account = await db
    .prepare(
      "SELECT account_status, partner_type, billing_status, business_name FROM trade_accounts WHERE firebase_uid = ?",
    )
    .bind(user.uid)
    .first<Record<string, unknown>>();
  if (!account || account.account_status !== "active")
    return json(
      { ok: false, error: "An active installer account is required." },
      403,
    );
  if (account.partner_type !== "installer")
    return json(
      {
        ok: false,
        error:
          "Wholesalers cannot access or respond to household opportunities.",
      },
      403,
    );
  if (!await accountHasFeature(user.uid, "installer", account.billing_status, "installer_leads"))
    return json(
      { ok: false, error: "Complete trade verification before responding to marketplace opportunities." },
      403,
    );
  await expireStaleOpportunities();
  const now = new Date().toISOString();
  if (action === "record_contact") {
    return json({ ok: false, error: "Direct customer contact is not available. Respond through the structured platform workflow." }, 409);
  }
  if (action === "submit_quote") {
    const normalized = normalizePlatformQuote(body);
    if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
    const quote = normalized.quote;
    if (!quote) return json({ ok: false, error: "Invalid structured quote option." }, 400);
    const match = await db.prepare(`SELECT m.opportunity_id, m.status, o.source_reference, o.status opportunity_status,
      p.id project_id FROM trade_opportunity_matches m
      JOIN trade_opportunities o ON o.id = m.opportunity_id
      JOIN customer_projects p ON p.opportunity_id = o.id
      WHERE m.id = ? AND m.firebase_uid = ?`).bind(matchId, user.uid).first<Record<string, unknown>>();
    if (!match) return json({ ok: false, error: "This platform project is not available." }, 404);
    if (!String(match.source_reference || "").startsWith("customer-project:") || match.opportunity_status !== "open") {
      return json({ ok: false, error: "Structured quotes are available only for active customer projects." }, 409);
    }
    if (!['interested', 'connected'].includes(String(match.status))) {
      return json({ ok: false, error: "Record your interest before preparing a quote option." }, 409);
    }
    let snapshot;
    try {
      snapshot = await productSnapshot(user.uid, quote.productListId);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return json({ ok: false, error: code === "PRODUCT_LIST_REQUIRED"
        ? "Choose one of your saved product lists."
        : "Every quoted product must still be approved and supplied by a verified wholesaler." }, 409);
    }
    const totalCentsExGst = snapshot.subtotalCentsExGst + quote.labourCentsExGst + quote.otherCentsExGst;
    if (totalCentsExGst <= 0) return json({ ok: false, error: "Add a product, labour or service amount." }, 400);
    const quoteId = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO customer_project_quotes
        (id, project_id, opportunity_id, opportunity_match_id, installer_uid, product_list_id, inclusions,
         product_snapshot, product_subtotal_cents_ex_gst, labour_cents_ex_gst, other_cents_ex_gst,
         total_cents_ex_gst, quote_type, start_window, duration_weeks, workmanship_warranty_years,
         status, customer_decision, submitted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'reviewing', ?, ?)
        ON CONFLICT(opportunity_match_id) DO UPDATE SET product_list_id = excluded.product_list_id,
          inclusions = excluded.inclusions, product_snapshot = excluded.product_snapshot,
          product_subtotal_cents_ex_gst = excluded.product_subtotal_cents_ex_gst,
          labour_cents_ex_gst = excluded.labour_cents_ex_gst, other_cents_ex_gst = excluded.other_cents_ex_gst,
          total_cents_ex_gst = excluded.total_cents_ex_gst, quote_type = excluded.quote_type,
          start_window = excluded.start_window, duration_weeks = excluded.duration_weeks,
          workmanship_warranty_years = excluded.workmanship_warranty_years, status = 'submitted',
          customer_decision = 'reviewing', submitted_at = excluded.submitted_at, updated_at = excluded.updated_at`)
        .bind(quoteId, match.project_id, match.opportunity_id, matchId, user.uid, quote.productListId,
          JSON.stringify(quote.inclusions), JSON.stringify(snapshot.products), snapshot.subtotalCentsExGst,
          quote.labourCentsExGst, quote.otherCentsExGst, totalCentsExGst,
          quote.quoteType, quote.startWindow, quote.durationWeeks,
          quote.workmanshipWarrantyYears, now, now),
      db.prepare("UPDATE customer_projects SET status = 'quote_review', updated_at = ? WHERE id = ? AND status = 'matching'")
        .bind(now, match.project_id),
      adminNotificationStatement(db, {
        eventKey: `installer-quote:${matchId}:${now}`,
        eventType: "installer.quote_submitted",
        category: "response",
        priority: "high",
        title: "Installer submitted a quote option",
        summary: `${String(account.business_name || "An installer").slice(0, 160)} submitted a structured platform quote for a customer enquiry.`,
        entityType: "customer_project_quote",
        entityId: quoteId,
        actorType: "installer",
        actorUid: user.uid,
        requiresAction: true,
        metadata: { matchId, opportunityId: match.opportunity_id, projectId: match.project_id, totalCentsExGst },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
    return json({ ok: true, quote: { totalCentsExGst, productSubtotalCentsExGst: snapshot.subtotalCentsExGst, submittedAt: now } });
  }
  if (action === "withdraw_quote") {
    const result = await db.prepare(`UPDATE customer_project_quotes SET status = 'withdrawn', customer_decision = 'reviewing', updated_at = ?
      WHERE opportunity_match_id = ? AND installer_uid = ? AND status = 'submitted'`).bind(now, matchId, user.uid).run();
    if (!result.meta.changes) return json({ ok: false, error: "No active quote option was found." }, 404);
    await createAdminNotification({
      eventKey: `installer-quote-withdrawn:${matchId}:${now}`,
      eventType: "installer.quote_withdrawn",
      category: "response",
      priority: "normal",
      title: "Installer withdrew a quote option",
      summary: `${String(account.business_name || "An installer").slice(0, 160)} withdrew a structured quote from a customer enquiry.`,
      entityType: "trade_opportunity_match",
      entityId: matchId,
      actorType: "installer",
      actorUid: user.uid,
      requiresAction: false,
      occurredAt: now,
    });
    return json({ ok: true });
  }
  if (!PARTNER_STATUSES.has(status))
    return json(
      { ok: false, error: "Choose a valid opportunity response." },
      400,
    );
  const current = await db.prepare(`SELECT m.status, m.opportunity_id, o.title FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
    WHERE m.id = ? AND m.firebase_uid = ? AND o.status = 'open' AND o.expires_at > ?`)
    .bind(matchId, user.uid, now).first<{ status: string; opportunity_id: string; title: string }>();
  if (!current) return json({ ok: false, error: "The opportunity could not be updated." }, 404);
  const transitions: Record<string, Set<string>> = {
    offered: new Set(["viewed", "interested", "declined"]),
    viewed: new Set(["interested", "declined"]),
    interested: new Set(["declined"]),
  };
  if (current.status === status) return json({ ok: true });
  if (!transitions[current.status]?.has(status)) return json({ ok: false, error: "This opportunity response cannot be reversed." }, 409);
  const result = await db
    .prepare(
      `UPDATE trade_opportunity_matches SET status = ?, partner_note = '', updated_at = ?
    WHERE id = ? AND firebase_uid = ? AND status = ?
      AND opportunity_id IN (SELECT id FROM trade_opportunities WHERE status = 'open' AND expires_at > ?)`,
    )
    .bind(status, now, matchId, user.uid, current.status, now)
    .run();
  if (!result.meta.changes)
    return json(
      { ok: false, error: "The opportunity could not be updated." },
      404,
    );
  await syncMarketplaceEnquiries(db, current.opportunity_id, user.uid);
  if (status === "declined") {
    if (current.opportunity_id)
      await allocateNearestInstallers(
        current.opportunity_id,
        "automatic-decline-refill",
      ).catch(() => null);
  }
  await createAdminNotification({
    eventKey: `installer-response:${matchId}:${status}`,
    eventType: `installer.lead_${status}`,
    category: "response",
    priority: status === "interested" ? "high" : status === "declined" ? "normal" : "low",
    title: status === "interested" ? "Installer is interested in a lead" : status === "declined" ? "Installer declined a lead" : "Installer viewed a lead",
    summary: `${String(account.business_name || "An installer").slice(0, 160)} marked ${String(current.title).slice(0, 160)} as ${status}.`,
    entityType: "trade_opportunity_match",
    entityId: matchId,
    actorType: "installer",
    actorUid: user.uid,
    requiresAction: status === "interested",
    metadata: { opportunityId: current.opportunity_id, status },
    occurredAt: now,
  });
  return json({ ok: true });
}
