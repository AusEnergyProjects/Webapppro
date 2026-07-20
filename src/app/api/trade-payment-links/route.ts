import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "@/lib/trade-integration-crypto";
import { providerConfigured, providerSetting, requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";

function paymentError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "INSTALLER_ONLY" || code === "FULL_ACCESS_REQUIRED" || code === "ACCOUNT_INACTIVE") {
    return adminJson({ ok: false, error: "Payment requests are not available to this account." }, 403);
  }
  if (code === "DIRECT_CUSTOMER_REQUIRED") return adminJson({ ok: false, error: "Payment links can only be created for customers who contacted your business directly. AEA protected customers remain inside the protected AEA process." }, 403);
  if (code === "ACCEPTED_HANDOFF_REQUIRED") return adminJson({ ok: false, error: "Accept a current quote before requesting its deposit." }, 409);
  if (code === "QUICK_INVOICE_REQUIRED") return adminJson({ ok: false, error: "Create the TLink quick invoice before requesting its payment." }, 409);
  if (code === "INTEGRATION_REQUIRED") return adminJson({ ok: false, error: "Connect this payment provider in Integrations first." }, 409);
  if (code === "PREVIOUS_PAYMENT_PROVIDER_REQUIRED") return adminJson({ ok: false, error: "Reconnect the previous payment provider so TLink can close its failed checkout before issuing another one." }, 409);
  if (code === "PAYMENT_REQUEST_IN_PROGRESS") return adminJson({ ok: false, error: "Another checkout is already being prepared. Wait a moment, then try again." }, 409);
  if (code === "PAYMENT_REISSUE_BLOCKED") return adminJson({ ok: false, error: "The failed checkout could not be closed safely. Review it with the payment provider before issuing another request." }, 409);
  if (code === "PAYMENT_ACTIVATION_LOST") return adminJson({ ok: false, error: "The payment status changed while this checkout was prepared. TLink closed the new checkout; refresh the job before trying again." }, 409);
  if (code === "PAYMENT_ALREADY_RECEIVED") return adminJson({ ok: false, error: "The payment provider reports that this checkout was paid. Refresh the job before issuing another request." }, 409);
  if (code === "PAYMENT_PROVIDER_REJECTED") return adminJson({ ok: false, error: "The payment provider rejected this checkout. Check the provider connection or choose another connected provider." }, 422);
  if (code === "PAYMENT_PROVIDER_UNCERTAIN") return adminJson({ ok: false, error: "The provider response was interrupted. Retry with the same provider so TLink can safely finish the original checkout." }, 502);
  if (code === "PROVIDER_PAYMENT_FAILED") return adminJson({ ok: false, error: "The payment provider could not create the checkout link. Check the connection and try again." }, 502);
  return adminJson({ ok: false, error: "The payment request could not be created." }, 500);
}

class ProviderCheckoutFailure extends Error {
  constructor(readonly terminal: boolean, readonly failureCode: string) {
    super(terminal ? "PAYMENT_PROVIDER_REJECTED" : "PAYMENT_PROVIDER_UNCERTAIN");
  }
}

async function providerCheckoutResponse(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ProviderCheckoutFailure(false, "checkout_transport_uncertain");
  }
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const terminal = response.status >= 400 && response.status < 500;
    throw new ProviderCheckoutFailure(terminal, terminal ? `checkout_rejected_${response.status}` : `checkout_response_${response.status}`);
  }
  return result;
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

function paymentLinkJson(row: Record<string, unknown>, workOrderId: string, purpose: string) {
  return {
    id: String(row.id), workOrderId, commercialReference: String(row.commercial_reference), purpose,
    provider: String(row.provider), externalId: String(row.external_id || ""),
    amountCents: Number(row.amount_cents), paidAmountCents: Number(row.paid_amount_cents || 0),
    checkoutUrl: String(row.checkout_url || ""), status: String(row.status),
    paidAt: String(row.paid_at || ""), lastEventAt: String(row.last_event_at || ""),
    createdAt: String(row.created_at),
  };
}

async function connectedPaymentProvider(firebaseUid: string, provider: string) {
  return getD1().prepare(`SELECT * FROM trade_crm_integrations
    WHERE firebase_uid = ? AND provider = ? AND status = 'connected'`)
    .bind(firebaseUid, provider).first<Record<string, unknown>>();
}

async function stripeCheckoutState(connection: Record<string, unknown>, externalId: string) {
  const setting = providerSetting("stripe");
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(externalId)}`, {
    headers: { Authorization: `Bearer ${setting.clientSecret}`, "Stripe-Account": String(connection.external_account_id), Accept: "application/json" },
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error("PAYMENT_REISSUE_BLOCKED");
  return { status: cleanAdminText(result.status, 30), paymentStatus: cleanAdminText(result.payment_status, 30) };
}

async function deactivateFailedCheckout(firebaseUid: string, link: Record<string, unknown>) {
  const externalId = cleanAdminText(link.external_id, 180);
  if (!externalId) return;
  const provider = cleanAdminText(link.provider, 20).toLowerCase();
  if (provider !== "stripe" && provider !== "square") throw new Error("PAYMENT_REISSUE_BLOCKED");
  const connection = await connectedPaymentProvider(firebaseUid, provider);
  if (!connection) throw new Error("PREVIOUS_PAYMENT_PROVIDER_REQUIRED");
  if (provider === "stripe") {
    const setting = providerSetting("stripe");
    let state = await stripeCheckoutState(connection, externalId);
    if (["paid", "no_payment_required"].includes(state.paymentStatus)) throw new Error("PAYMENT_ALREADY_RECEIVED");
    if (state.status === "open") {
      const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(externalId)}/expire`, {
        method: "POST",
        headers: { Authorization: `Bearer ${setting.clientSecret}`, "Stripe-Account": String(connection.external_account_id) },
      });
      if (!response.ok) {
        state = await stripeCheckoutState(connection, externalId);
        if (state.status !== "expired") throw new Error("PAYMENT_REISSUE_BLOCKED");
      } else state = { ...state, status: "expired" };
    }
    if (state.status === "expired" || (state.status === "complete" && state.paymentStatus === "unpaid")) return;
    throw new Error("PAYMENT_REISSUE_BLOCKED");
  }
  const setting = providerSetting("square");
  const credentials = await activeSquareCredentials(connection);
  if (!credentials.access_token) throw new Error("PREVIOUS_PAYMENT_PROVIDER_REQUIRED");
  const response = await fetch(`${setting.tokenUrl.replace("/oauth2/token", "/v2/online-checkout/payment-links")}/${encodeURIComponent(externalId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${String(credentials.access_token)}`, "Content-Type": "application/json", "Square-Version": "2026-05-20" },
  });
  if (!response.ok && response.status !== 404) throw new Error("PAYMENT_REISSUE_BLOCKED");
}

async function closeUnclaimedCheckout(input: {
  firebaseUid: string;
  id: string;
  provider: string;
  externalId: string;
  providerOrderId: string;
  checkoutUrl: string;
}) {
  const db = getD1();
  let status = "failed";
  let failureCode = "checkout_activation_claim_lost";
  try {
    await deactivateFailedCheckout(input.firebaseUid, { provider: input.provider, external_id: input.externalId });
  } catch (error) {
    status = "review_required";
    failureCode = error instanceof Error && error.message === "PAYMENT_ALREADY_RECEIVED"
      ? "checkout_paid_before_activation"
      : "checkout_deactivation_failed";
  }
  const now = new Date().toISOString();
  await db.prepare(`UPDATE trade_crm_payment_links SET external_id = ?, provider_order_id = ?, checkout_url = ?,
    status = ?, failure_code = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'creating'`)
    .bind(input.externalId, input.providerOrderId, input.checkoutUrl, status, failureCode, now, input.id, input.firebaseUid).run();
  return status;
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
    if (!providerConfigured(provider)) throw new Error("INTEGRATION_REQUIRED");
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const purpose = cleanAdminText(body.purpose, 20).toLowerCase() === "invoice" ? "invoice" : "deposit";
    const db = getD1();
    const job = await db.prepare(`SELECT w.id, w.work_number, w.title, w.source_type, d.customer_source,
        c.email, c.first_name, c.last_name, c.business_name
      FROM trade_work_orders w
      JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
      WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
      .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
    if (!job || job.source_type !== "internal" || job.customer_source !== "trade_owned") throw new Error("DIRECT_CUSTOMER_REQUIRED");
    const source = purpose === "invoice"
      ? await db.prepare(`SELECT id, invoice_number commercial_reference,
          total_cents
            - COALESCE((SELECT SUM(credit.total_cents) FROM trade_crm_quick_invoice_credits credit
              WHERE credit.invoice_id = trade_crm_quick_invoices.id AND credit.status = 'issued'), 0)
            - COALESCE((SELECT SUM(allocation.amount_cents) FROM trade_crm_invoice_payment_allocations allocation
              WHERE allocation.invoice_id = trade_crm_quick_invoices.id), 0) amount_cents
          FROM trade_crm_quick_invoices WHERE firebase_uid = ? AND work_order_id = ?
            AND status IN ('issued', 'part_credited') LIMIT 1`)
        .bind(identity.uid, workOrderId).first<Record<string, unknown>>()
      : await db.prepare(`SELECT id, commercial_reference, deposit_amount_cents amount_cents, total_cents
          FROM trade_crm_commercial_handovers
          WHERE firebase_uid = ? AND work_order_id = ? AND status IN ('accepted', 'deposit_requested', 'deposit_paid')
          ORDER BY accepted_at DESC LIMIT 1`).bind(identity.uid, workOrderId).first<Record<string, unknown>>();
    if (!source) throw new Error(purpose === "invoice" ? "QUICK_INVOICE_REQUIRED" : "ACCEPTED_HANDOFF_REQUIRED");
    const amountCents = Number(source.amount_cents);
    if (!Number.isInteger(amountCents) || amountCents < 100 || (purpose === "deposit" && amountCents > Number(source.total_cents))) {
      throw new Error(purpose === "invoice" ? "QUICK_INVOICE_REQUIRED" : "ACCEPTED_HANDOFF_REQUIRED");
    }
    const commercialReference = String(source.commercial_reference);
    const latest = await db.prepare(`SELECT * FROM trade_crm_payment_links
      WHERE firebase_uid = ? AND commercial_reference = ? AND purpose = ?
      ORDER BY attempt_number DESC, created_at DESC LIMIT 1`)
      .bind(identity.uid, commercialReference, purpose).first<Record<string, unknown>>();
    const unresolvedReview = await db.prepare(`SELECT * FROM trade_crm_payment_links
      WHERE firebase_uid = ? AND commercial_reference = ? AND purpose = ? AND status = 'review_required'
      ORDER BY attempt_number DESC LIMIT 1`)
      .bind(identity.uid, commercialReference, purpose).first<Record<string, unknown>>();
    if (unresolvedReview) {
      return adminJson({ ok: true, duplicate: true, paymentLink: paymentLinkJson(unresolvedReview, workOrderId, purpose) });
    }
    if (latest && !["creating", "failed", "superseded"].includes(String(latest.status))) {
      return adminJson({ ok: true, duplicate: true, paymentLink: paymentLinkJson(latest, workOrderId, purpose) });
    }
    const connection = await connectedPaymentProvider(identity.uid, provider);
    if (!connection) throw new Error("INTEGRATION_REQUIRED");
    const checkoutSetting = providerSetting(provider);
    let checkoutCredentials: Record<string, unknown> = {};
    if (provider === "stripe") {
      if (!checkoutSetting.clientSecret || !cleanAdminText(connection.external_account_id, 180)) throw new Error("INTEGRATION_REQUIRED");
    } else {
      checkoutCredentials = await activeSquareCredentials(connection);
      if (!checkoutCredentials.access_token || !checkoutCredentials.location_id) throw new Error("INTEGRATION_REQUIRED");
    }
    let previousFailed = latest?.status === "failed" ? latest : undefined;
    let claimed = latest?.status === "creating" ? latest : undefined;
    let resumed = Boolean(claimed);
    if (claimed && String(claimed.provider) !== provider) throw new Error("PAYMENT_REQUEST_IN_PROGRESS");
    if (claimed && !previousFailed) {
      previousFailed = (await db.prepare(`SELECT * FROM trade_crm_payment_links
        WHERE firebase_uid = ? AND commercial_reference = ? AND purpose = ? AND status = 'failed'
          AND attempt_number < ? ORDER BY attempt_number DESC LIMIT 1`)
        .bind(identity.uid, commercialReference, purpose, Number(claimed.attempt_number || 1))
        .first<Record<string, unknown>>()) || undefined;
    }
    if (previousFailed) await deactivateFailedCheckout(identity.uid, previousFailed);
    if (!claimed) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const attemptNumber = Number(latest?.attempt_number || 0) + 1;
      await db.prepare(`INSERT OR IGNORE INTO trade_crm_payment_links
        (id, work_order_id, firebase_uid, commercial_handoff_id, commercial_reference, purpose, provider, external_id,
         provider_order_id, amount_cents, checkout_url, status, attempt_number, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, '', 'creating', ?, ?, ?, ?)`).bind(
        id, workOrderId, identity.uid, purpose === "deposit" ? source.id : "", commercialReference, purpose,
        provider, amountCents, attemptNumber, `tlink-${id}`, now, now,
      ).run();
      claimed = (await db.prepare(`SELECT * FROM trade_crm_payment_links
        WHERE firebase_uid = ? AND commercial_reference = ? AND purpose = ?
          AND status IN ('creating', 'open', 'processing', 'paid')
        ORDER BY attempt_number DESC LIMIT 1`)
        .bind(identity.uid, commercialReference, purpose).first<Record<string, unknown>>()) || undefined;
      if (!claimed) throw new Error("PAYMENT_REQUEST_IN_PROGRESS");
      if (String(claimed.status) !== "creating") {
        return adminJson({ ok: true, duplicate: true, paymentLink: paymentLinkJson(claimed, workOrderId, purpose) });
      }
      if (String(claimed.provider) !== provider) throw new Error("PAYMENT_REQUEST_IN_PROGRESS");
      resumed = String(claimed.id) !== id;
    }
    const id = String(claimed.id);
    const idempotencyKey = String(claimed.idempotency_key);
    const checkoutAmountCents = Number(claimed.amount_cents);
    if (!idempotencyKey || !Number.isInteger(checkoutAmountCents) || checkoutAmountCents < 100) throw new Error("PROVIDER_PAYMENT_FAILED");
    const paymentLabel = purpose === "invoice" ? "Invoice payment" : "Deposit";
    let externalId = "";
    let providerOrderId = "";
    let checkoutUrl = "";
    try {
      if (provider === "stripe") {
        const origin = new URL(request.url).origin;
        const params = new URLSearchParams({
          mode: "payment",
          "line_items[0][price_data][currency]": "aud",
          "line_items[0][price_data][product_data][name]": `${paymentLabel} | ${commercialReference}`.slice(0, 180),
          "line_items[0][price_data][unit_amount]": String(checkoutAmountCents),
          "line_items[0][quantity]": "1",
          client_reference_id: String(job.id),
          "metadata[aea_payment_link_id]": id,
          "metadata[aea_work_order_id]": String(job.id),
          "metadata[aea_commercial_reference]": commercialReference,
          "metadata[aea_payment_purpose]": purpose,
          "payment_intent_data[metadata][aea_payment_link_id]": id,
          "payment_intent_data[metadata][aea_work_order_id]": String(job.id),
          "payment_intent_data[metadata][aea_commercial_reference]": commercialReference,
          "payment_intent_data[metadata][aea_payment_purpose]": purpose,
          success_url: `${origin}/direct-trade/dashboard?payment_status=returned#business-hub`,
          cancel_url: `${origin}/direct-trade/dashboard?payment_status=cancelled#business-hub`,
        });
        const email = cleanAdminText(job.email, 180);
        if (email) params.set("customer_email", email);
        const result = await providerCheckoutResponse("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${checkoutSetting.clientSecret}`,
            "Stripe-Account": String(connection.external_account_id),
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
          },
          body: params,
        });
        if (!result.id || !result.url) throw new ProviderCheckoutFailure(false, "checkout_response_incomplete");
        externalId = String(result.id); checkoutUrl = String(result.url);
      } else {
        const origin = new URL(request.url).origin;
        const result = await providerCheckoutResponse(checkoutSetting.tokenUrl.replace("/oauth2/token", "/v2/online-checkout/payment-links"), {
          method: "POST",
          headers: { Authorization: `Bearer ${String(checkoutCredentials.access_token)}`, "Content-Type": "application/json", "Square-Version": "2026-05-20" },
          body: JSON.stringify({
            idempotency_key: idempotencyKey,
            order: {
              location_id: checkoutCredentials.location_id,
              reference_id: commercialReference.slice(0, 40),
              metadata: { aea_payment_link_id: id, aea_work_order_id: String(job.id).slice(0, 255), aea_commercial_reference: commercialReference.slice(0, 255), aea_payment_purpose: purpose },
              line_items: [{
                name: `${paymentLabel} | ${commercialReference}`.slice(0, 180),
                quantity: "1",
                base_price_money: { amount: checkoutAmountCents, currency: "AUD" },
              }],
            },
            checkout_options: { redirect_url: `${origin}/direct-trade/dashboard?payment_status=returned#business-hub` },
          }),
        });
        const paymentLink = result.payment_link as Record<string, unknown> | undefined;
        if (!paymentLink?.id || !paymentLink.order_id || !paymentLink.url) throw new ProviderCheckoutFailure(false, "checkout_response_incomplete");
        externalId = String(paymentLink.id); providerOrderId = String(paymentLink.order_id); checkoutUrl = String(paymentLink.url);
      }
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failure = error instanceof ProviderCheckoutFailure
        ? error
        : new ProviderCheckoutFailure(false, "checkout_runtime_uncertain");
      await db.prepare(`UPDATE trade_crm_payment_links SET status = ?, failure_code = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'creating'`)
        .bind(failure.terminal ? "failed" : "creating", failure.failureCode, failedAt, id, identity.uid).run();
      throw new Error(failure.message);
    }
    const now = new Date().toISOString();
    const priorId = previousFailed ? String(previousFailed.id) : "";
    const priorClaim = previousFailed ? [db.prepare(`UPDATE trade_crm_payment_links SET status = 'superseded',
        superseded_by_id = ?, superseded_at = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = 'failed'
        AND EXISTS (SELECT 1 FROM trade_crm_payment_links replacement
          WHERE replacement.id = ? AND replacement.firebase_uid = ? AND replacement.status = 'creating')
        AND NOT EXISTS (SELECT 1 FROM trade_crm_payment_links review
          WHERE review.firebase_uid = ? AND review.commercial_reference = ? AND review.purpose = ?
            AND review.id <> ? AND review.status = 'review_required')`)
      .bind(id, now, now, priorId, identity.uid, id, identity.uid,
        identity.uid, commercialReference, purpose, id)] : [];
    const activationIndex = priorClaim.length;
    let activationResults;
    try {
      activationResults = await db.batch([
        ...priorClaim,
        db.prepare(`UPDATE trade_crm_payment_links SET external_id = ?, provider_order_id = ?, checkout_url = ?,
          status = 'open', failure_code = '', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'creating'
          AND NOT EXISTS (SELECT 1 FROM trade_crm_payment_links review
            WHERE review.firebase_uid = ? AND review.commercial_reference = ? AND review.purpose = ?
              AND review.id <> ? AND review.status = 'review_required')
          AND (? = '' OR EXISTS (SELECT 1 FROM trade_crm_payment_links prior
            WHERE prior.id = ? AND prior.firebase_uid = ? AND prior.status = 'superseded'
              AND prior.superseded_by_id = ?))`)
          .bind(externalId, providerOrderId, checkoutUrl, now, id, identity.uid,
            identity.uid, commercialReference, purpose, id, priorId, priorId, identity.uid, id),
        db.prepare(`INSERT OR IGNORE INTO trade_work_order_events
          (id, work_order_id, firebase_uid, event_type, summary, created_at)
          SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM trade_crm_payment_links
            WHERE id = ? AND firebase_uid = ? AND status = 'open')`)
          .bind(`payment-request:${id}`, workOrderId, identity.uid, purpose === "invoice" ? "invoice_payment_requested" : "deposit_requested",
            purpose === "invoice" ? "Provider-hosted full invoice payment request created from the TLink quick invoice." : "Provider-hosted deposit request created from the accepted quote.",
            now, id, identity.uid),
        ...(purpose === "deposit" ? [db.prepare(`UPDATE trade_crm_commercial_handovers SET status = 'deposit_requested', updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status = 'accepted'
            AND EXISTS (SELECT 1 FROM trade_crm_payment_links WHERE id = ? AND firebase_uid = ? AND status = 'open')`)
          .bind(now, source.id, identity.uid, id, identity.uid)] : []),
      ]);
    } catch {
      const closedStatus = await closeUnclaimedCheckout({ firebaseUid: identity.uid, id, provider, externalId, providerOrderId, checkoutUrl });
      throw new Error(closedStatus === "failed" ? "PAYMENT_ACTIVATION_LOST" : "PAYMENT_REISSUE_BLOCKED");
    }
    if (Number(activationResults[activationIndex]?.meta.changes || 0) !== 1) {
      const closedStatus = await closeUnclaimedCheckout({ firebaseUid: identity.uid, id, provider, externalId, providerOrderId, checkoutUrl });
      throw new Error(closedStatus === "failed" ? "PAYMENT_ACTIVATION_LOST" : "PAYMENT_REISSUE_BLOCKED");
    }
    const paymentLink = await db.prepare("SELECT * FROM trade_crm_payment_links WHERE id = ? AND firebase_uid = ?")
      .bind(id, identity.uid).first<Record<string, unknown>>();
    if (!paymentLink) throw new Error("PROVIDER_PAYMENT_FAILED");
    return adminJson({ ok: true, resumed, paymentLink: paymentLinkJson(paymentLink, workOrderId, purpose) }, resumed ? 200 : 201);
  } catch (error) { return paymentError(error); }
}
