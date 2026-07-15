import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "@/lib/trade-integration-crypto";
import { providerSetting, requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";

function paymentError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "INSTALLER_ONLY" || code === "FULL_ACCESS_REQUIRED" || code === "ACCOUNT_INACTIVE") {
    return adminJson({ ok: false, error: "Payment requests are not available to this account." }, 403);
  }
  if (code === "DIRECT_CUSTOMER_REQUIRED") return adminJson({ ok: false, error: "Payment links can only be created for customers who contacted your business directly. AEA protected customers remain inside the protected AEA process." }, 403);
  if (code === "INTEGRATION_REQUIRED") return adminJson({ ok: false, error: "Connect this payment provider in Integrations first." }, 409);
  if (code === "PROVIDER_PAYMENT_FAILED") return adminJson({ ok: false, error: "The payment provider could not create the checkout link. Check the connection and try again." }, 502);
  return adminJson({ ok: false, error: "The payment request could not be created." }, 500);
}

async function activeSquareCredentials(connection: Record<string, unknown>) {
  const credentials = await decryptIntegrationCredentials(String(connection.encrypted_credentials || ""));
  const expiresAt = Date.parse(String(connection.token_expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 24 * 60 * 60 * 1000) return credentials;
  const setting = providerSetting("square");
  if (!credentials.refresh_token) throw new Error("INTEGRATION_REQUIRED");
  const response = await fetch(setting.tokenUrl, {
    method: "POST", headers: { "Content-Type": "application/json", "Square-Version": "2026-05-20" },
    body: JSON.stringify({ client_id: setting.clientId, client_secret: setting.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refresh_token }),
  });
  const refreshed = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !refreshed.access_token) throw new Error("INTEGRATION_REQUIRED");
  const next = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || credentials.refresh_token,
    token_type: refreshed.token_type || "bearer",
    location_id: credentials.location_id,
  };
  const now = new Date().toISOString();
  await getD1().prepare(`UPDATE trade_crm_integrations SET encrypted_credentials = ?, token_expires_at = ?, updated_at = ?
    WHERE id = ? AND firebase_uid = ?`).bind(await encryptIntegrationCredentials(next), cleanAdminText(refreshed.expires_at, 60), now,
      connection.id, connection.firebase_uid).run();
  return next;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid payment request." }, 400); }
    const provider = cleanAdminText(body.provider, 20).toLowerCase();
    if (provider !== "stripe" && provider !== "square") return adminJson({ ok: false, error: "Choose Stripe or Square." }, 400);
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const amountCents = Number(body.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000_000_00) {
      return adminJson({ ok: false, error: "Enter a payment amount of at least $1.00." }, 400);
    }
    const db = getD1();
    const job = await db.prepare(`SELECT w.id, w.work_number, w.title, w.source_type, d.customer_source,
        c.email, c.first_name, c.last_name, c.business_name
      FROM trade_work_orders w
      JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
      WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
      .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
    if (!job || job.source_type !== "internal" || job.customer_source !== "trade_owned") throw new Error("DIRECT_CUSTOMER_REQUIRED");
    const connection = await db.prepare(`SELECT * FROM trade_crm_integrations
      WHERE firebase_uid = ? AND provider = ? AND status = 'connected'`).bind(identity.uid, provider).first<Record<string, unknown>>();
    if (!connection) throw new Error("INTEGRATION_REQUIRED");
    const id = crypto.randomUUID();
    const idempotencyKey = `aea-payment-${id}`;
    let externalId = "";
    let providerOrderId = "";
    let checkoutUrl = "";
    if (provider === "stripe") {
      const setting = providerSetting("stripe");
      if (!setting.clientSecret) throw new Error("INTEGRATION_REQUIRED");
      const origin = new URL(request.url).origin;
      const params = new URLSearchParams({
        mode: "payment",
        "line_items[0][price_data][currency]": "aud",
        "line_items[0][price_data][product_data][name]": `${String(job.work_number)} | ${String(job.title)}`.slice(0, 180),
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][quantity]": "1",
        client_reference_id: String(job.id),
        "metadata[aea_payment_link_id]": id,
        "metadata[aea_work_order_id]": String(job.id),
        "payment_intent_data[metadata][aea_payment_link_id]": id,
        "payment_intent_data[metadata][aea_work_order_id]": String(job.id),
        success_url: `${origin}/direct-trade/dashboard?payment_status=returned#business-hub`,
        cancel_url: `${origin}/direct-trade/dashboard?payment_status=cancelled#business-hub`,
      });
      const email = cleanAdminText(job.email, 180);
      if (email) params.set("customer_email", email);
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${setting.clientSecret}`,
          "Stripe-Account": String(connection.external_account_id),
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": idempotencyKey,
        },
        body: params,
      });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok || !result.id || !result.url) throw new Error("PROVIDER_PAYMENT_FAILED");
      externalId = String(result.id); checkoutUrl = String(result.url);
    } else {
      const setting = providerSetting("square");
      const credentials = await activeSquareCredentials(connection);
      if (!credentials.access_token || !credentials.location_id) throw new Error("INTEGRATION_REQUIRED");
      const origin = new URL(request.url).origin;
      const response = await fetch(setting.tokenUrl.replace("/oauth2/token", "/v2/online-checkout/payment-links"), {
        method: "POST",
        headers: { Authorization: `Bearer ${String(credentials.access_token)}`, "Content-Type": "application/json", "Square-Version": "2026-05-20" },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          order: {
            location_id: credentials.location_id,
            reference_id: id.slice(0, 40),
            metadata: { aea_payment_link_id: id, aea_work_order_id: String(job.id).slice(0, 255) },
            line_items: [{
              name: `${String(job.work_number)} | ${String(job.title)}`.slice(0, 180),
              quantity: "1",
              base_price_money: { amount: amountCents, currency: "AUD" },
            }],
          },
          checkout_options: { redirect_url: `${origin}/direct-trade/dashboard?payment_status=returned#business-hub` },
        }),
      });
      const result = await response.json().catch(() => ({})) as { payment_link?: Record<string, unknown> };
      if (!response.ok || !result.payment_link?.id || !result.payment_link?.order_id || !result.payment_link?.url) throw new Error("PROVIDER_PAYMENT_FAILED");
      externalId = String(result.payment_link.id); providerOrderId = String(result.payment_link.order_id); checkoutUrl = String(result.payment_link.url);
    }
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO trade_crm_payment_links
      (id, work_order_id, firebase_uid, provider, external_id, provider_order_id, amount_cents,
       checkout_url, status, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
      .bind(id, workOrderId, identity.uid, provider, externalId, providerOrderId, amountCents, checkoutUrl, idempotencyKey, now, now).run();
    return adminJson({ ok: true, paymentLink: { id, workOrderId, provider, externalId, amountCents, checkoutUrl, status: "open", createdAt: now } }, 201);
  } catch (error) { return paymentError(error); }
}
