import { getD1 } from "../../db";

export const ADMIN_NOTIFICATION_CATEGORIES = [
  "approval",
  "customer",
  "trade",
  "response",
  "catalogue",
  "platform",
] as const;

export const ADMIN_NOTIFICATION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type AdminNotificationInput = {
  eventKey: string;
  eventType: string;
  category: typeof ADMIN_NOTIFICATION_CATEGORIES[number];
  priority?: typeof ADMIN_NOTIFICATION_PRIORITIES[number];
  title: string;
  summary: string;
  entityType: string;
  entityId: string;
  actorType?: "customer" | "installer" | "supplier" | "admin" | "system";
  actorUid?: string;
  requiresAction?: boolean;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

function metadataJson(value: Record<string, unknown> | undefined) {
  try {
    return JSON.stringify(value || {}).slice(0, 4000);
  } catch {
    return "{}";
  }
}

export function adminNotificationStatement(db: ReturnType<typeof getD1>, input: AdminNotificationInput) {
  const now = input.occurredAt || new Date().toISOString();
  return db.prepare(`INSERT INTO admin_notifications
    (id, event_key, event_type, category, priority, title, summary, entity_type, entity_id,
     actor_type, actor_uid, requires_action, status, read_at, read_by_uid, resolved_at,
     resolved_by_uid, resolution_note, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', '', '', '', '', '', ?, ?, ?)
    ON CONFLICT(event_key) DO NOTHING`)
    .bind(
      crypto.randomUUID(),
      bounded(input.eventKey, 240),
      bounded(input.eventType, 100),
      input.category,
      input.priority || "normal",
      bounded(input.title, 180),
      bounded(input.summary, 600),
      bounded(input.entityType, 80),
      bounded(input.entityId, 180),
      input.actorType || "system",
      bounded(input.actorUid || "", 180),
      input.requiresAction ? 1 : 0,
      metadataJson(input.metadata),
      now,
      now,
    );
}

export async function createAdminNotification(input: AdminNotificationInput) {
  return adminNotificationStatement(getD1(), input).run();
}

export async function backfillActionableAdminNotifications() {
  const db = getD1();
  const marker = await db.prepare("SELECT id FROM admin_notifications WHERE event_key = 'platform:notification-backfill:v1'").first();
  if (marker) return;
  const [projects, evidence, products, referrals, quotes, responses] = await Promise.all([
    db.prepare(`SELECT id, firebase_uid, title, opportunity_id, submitted_at, status
      FROM customer_projects WHERE status IN ('matching', 'quote_review') ORDER BY updated_at DESC LIMIT 100`).all<Record<string, unknown>>(),
    db.prepare(`SELECT d.id, d.firebase_uid, d.category, d.expiry_date, d.created_at, a.partner_type, a.business_name
      FROM verification_documents d JOIN trade_accounts a ON a.firebase_uid = d.firebase_uid
      WHERE d.status = 'uploaded' AND a.verification_status != 'approved' ORDER BY d.created_at DESC LIMIT 100`).all<Record<string, unknown>>(),
    db.prepare(`SELECT p.id, p.firebase_uid, p.brand, p.name, p.model_number, p.updated_at, a.business_name
      FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
      WHERE p.review_status = 'pending' AND p.listing_status = 'published' ORDER BY p.updated_at DESC LIMIT 100`).all<Record<string, unknown>>(),
    db.prepare(`SELECT r.id, r.referred_uid, r.risk_reason, r.updated_at, a.business_name
      FROM trade_referrals r JOIN trade_accounts a ON a.firebase_uid = r.referred_uid
      WHERE r.status IN ('review_required', 'reward_failed') ORDER BY r.updated_at DESC LIMIT 100`).all<Record<string, unknown>>(),
    db.prepare(`SELECT q.id, q.opportunity_match_id, q.installer_uid, q.opportunity_id, q.project_id,
      q.total_cents_ex_gst, q.submitted_at, a.business_name
      FROM customer_project_quotes q LEFT JOIN trade_accounts a ON a.firebase_uid = q.installer_uid
      WHERE q.status = 'submitted' ORDER BY q.submitted_at DESC LIMIT 100`).all<Record<string, unknown>>(),
    db.prepare(`SELECT m.id, m.firebase_uid, m.opportunity_id, m.updated_at, a.business_name, o.title
      FROM trade_opportunity_matches m JOIN trade_accounts a ON a.firebase_uid = m.firebase_uid
      JOIN trade_opportunities o ON o.id = m.opportunity_id
      WHERE m.status = 'interested' AND o.status = 'open' ORDER BY m.updated_at DESC LIMIT 100`).all<Record<string, unknown>>(),
  ]);
  const statements = [
    ...projects.results.map((row: Record<string, unknown>) => adminNotificationStatement(db, {
      eventKey: `customer-enquiry:${row.id}`,
      eventType: "customer.enquiry_submitted",
      category: "customer",
      priority: "high",
      title: "Customer enquiry submitted",
      summary: `${String(row.title).slice(0, 120)} is active in the anonymised installer workflow.`,
      entityType: "customer_project",
      entityId: String(row.id),
      actorType: "customer",
      actorUid: String(row.firebase_uid),
      requiresAction: true,
      metadata: { opportunityId: row.opportunity_id, status: row.status },
      occurredAt: String(row.submitted_at),
    })),
    ...evidence.results.map((row: Record<string, unknown>) => adminNotificationStatement(db, {
      eventKey: `verification-evidence:${row.id}`,
      eventType: "trade.verification_evidence_uploaded",
      category: "approval",
      priority: "high",
      title: "Verification evidence uploaded",
      summary: `${String(row.business_name).slice(0, 160)} uploaded ${String(row.category).replaceAll("-", " ")} evidence for review.`,
      entityType: "verification_document",
      entityId: String(row.id),
      actorType: row.partner_type === "supplier" ? "supplier" : "installer",
      actorUid: String(row.firebase_uid),
      requiresAction: true,
      metadata: { category: row.category, expiryDate: row.expiry_date },
      occurredAt: String(row.created_at),
    })),
    ...products.results.map((row: Record<string, unknown>) => adminNotificationStatement(db, {
      eventKey: `supplier-product-review:${row.id}:${row.updated_at}`,
      eventType: "supplier.product_review_required",
      category: "catalogue",
      priority: "high",
      title: "Wholesaler product awaiting review",
      summary: `${String(row.business_name).slice(0, 160)} has a published ${String(row.brand).slice(0, 80)} ${String(row.name).slice(0, 120)} listing awaiting approval.`,
      entityType: "supplier_product",
      entityId: String(row.id),
      actorType: "supplier",
      actorUid: String(row.firebase_uid),
      requiresAction: true,
      metadata: { modelNumber: row.model_number },
      occurredAt: String(row.updated_at),
    })),
    ...referrals.results.map((row: Record<string, unknown>) => adminNotificationStatement(db, {
      eventKey: `referral-review:${row.id}`,
      eventType: "trade.referral_review_required",
      category: "approval",
      priority: "high",
      title: "Referral eligibility needs review",
      summary: `${String(row.business_name).slice(0, 160)} has a referral eligibility or reward item requiring review.`,
      entityType: "trade_referral",
      entityId: String(row.id),
      actorType: "system",
      actorUid: String(row.referred_uid),
      requiresAction: true,
      metadata: { riskReason: row.risk_reason },
      occurredAt: String(row.updated_at),
    })),
    ...quotes.results.map((row: Record<string, unknown>) => adminNotificationStatement(db, {
      eventKey: `installer-quote:${row.opportunity_match_id}:${row.submitted_at}`,
      eventType: "installer.quote_submitted",
      category: "response",
      priority: "high",
      title: "Installer submitted a quote option",
      summary: `${String(row.business_name || "An installer").slice(0, 160)} submitted a structured platform quote for a customer enquiry.`,
      entityType: "customer_project_quote",
      entityId: String(row.id),
      actorType: "installer",
      actorUid: String(row.installer_uid),
      requiresAction: true,
      metadata: { opportunityId: row.opportunity_id, projectId: row.project_id, totalCentsExGst: row.total_cents_ex_gst },
      occurredAt: String(row.submitted_at),
    })),
    ...responses.results.map((row: Record<string, unknown>) => adminNotificationStatement(db, {
      eventKey: `installer-response:${row.id}:interested`,
      eventType: "installer.lead_interested",
      category: "response",
      priority: "high",
      title: "Installer is interested in a lead",
      summary: `${String(row.business_name).slice(0, 160)} marked ${String(row.title).slice(0, 160)} as interested.`,
      entityType: "trade_opportunity_match",
      entityId: String(row.id),
      actorType: "installer",
      actorUid: String(row.firebase_uid),
      requiresAction: true,
      metadata: { opportunityId: row.opportunity_id, status: "interested" },
      occurredAt: String(row.updated_at),
    })),
  ];
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO admin_notifications
    (id, event_key, event_type, category, priority, title, summary, entity_type, entity_id,
     actor_type, actor_uid, requires_action, status, read_at, read_by_uid, resolved_at,
     resolved_by_uid, resolution_note, metadata, created_at, updated_at)
    VALUES (?, 'platform:notification-backfill:v1', 'platform.backfill_marker', 'platform', 'low',
      'Notification history prepared', 'Existing actionable items were added to the operations inbox.',
      'platform', 'notification-backfill-v1', 'system', '', 0, 'resolved', ?, 'system', ?, 'system',
      'Automatic migration marker.', '{}', ?, ?)
    ON CONFLICT(event_key) DO NOTHING`).bind(crypto.randomUUID(), now, now, now, now).run();
}
