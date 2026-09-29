import { getD1 } from "../../db";
import { encryptProtectedPayload, decryptProtectedPayload, integrationStateHash } from "./trade-integration-crypto";
import { adminNotificationStatement } from "./admin-notifications";
import { ClickSendProviderError, clickSendCredentials, searchAustralianClickSendNumbers, createClickSendSubaccount, findClickSendSubaccount,
  buyAustralianClickSendNumber, listPurchasedClickSendNumbers, listClickSendInboundRules, listClickSendReceiptRules,
  createClickSendInboundRule, createClickSendReceiptRule, type ClickSendCredentials, type ClickSendSubaccount } from "./trade-clicksend-provider";
import { SMS_PART_PRICE_MICRO, SMS_PRICE_LABEL, nextSmsRentalDate, smsRegistration, smsRequestId } from "./trade-sms-billing";
import { smsEnvironment, smsPublicOrigin } from "./trade-sms-environment";
import { smsWallet, syncSmsPayments } from "./trade-sms-wallet-server";
import type { SmsActor } from "./trade-sms-server";

type Account = { owner_uid: string; status: string; subaccount_id: string; encrypted_credentials: string; encrypted_registration: string; callback_token_hash: string; provisioning_order_id: string };
export type SmsNumberOrder = { id: string; owner_uid: string; request_id: string; number: string; status: string; setup_micro: number; monthly_micro: number; connection_id: string;
  renewal_at: string; inbound_rule_id: string; receipt_rule_id: string; error: string; created_at: string; updated_at: string; lease_token: string; lease_expires_at: string;
  purchase_attempted_at: string; provider_owned_at: string; inbound_rule_attempted_at: string; receipt_rule_attempted_at: string; initial_reserved_micro: number; initial_charge_micro: number };
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
function owner(actor: SmsActor) { if (!actor.isOwner) throw new Error("SMS_OWNER_REQUIRED"); }
function parentCredentials() {
  const { username, apiKey } = smsEnvironment();
  if (!username || !apiKey) throw new Error("SMS_ADMIN_SETUP_REQUIRED");
  return clickSendCredentials(username, apiKey);
}
export async function managedSmsCredentials(ownerUid: string, db: D1Database = getD1()): Promise<{ credentials: ClickSendCredentials; subaccountId: string }> {
  const account = await db.prepare("SELECT * FROM trade_sms_accounts WHERE owner_uid=?").bind(ownerUid).first<Account>();
  if (!account || account.status !== "ready" || !account.encrypted_credentials || !account.subaccount_id) throw new Error("SMS_ACCOUNT_NOT_READY");
  const stored = await decryptProtectedPayload(account.encrypted_credentials);
  return { credentials: clickSendCredentials(stored.username, stored.apiKey), subaccountId: account.subaccount_id };
}
function publicOrder(row: SmsNumberOrder | null) {
  return row ? { id: row.id, status: row.status, number: row.number, monthlyMicro: row.monthly_micro, setupMicro: row.setup_micro, initialReservedMicro: row.initial_reserved_micro,
    initialChargeMicro: row.initial_charge_micro >= 0 ? row.initial_charge_micro : null,
    initialChargeSettled: row.initial_charge_micro >= 0 && row.initial_charge_micro <= row.initial_reserved_micro && (Boolean(row.renewal_at) || row.status === "cancelled"), renewalAt: row.renewal_at, error: row.error } : null;
}
async function currentOrder(ownerUid: string, db: D1Database) {
  return db.prepare("SELECT * FROM trade_sms_number_orders WHERE owner_uid=? ORDER BY CASE WHEN status NOT IN ('cancelled','rejected') THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 1").bind(ownerUid).first<SmsNumberOrder>();
}
function operations(db: D1Database, order: SmsNumberOrder, event: "release" | "reconcile" | "registration", reason: string, now: string) {
  return adminNotificationStatement(db, { eventKey: `sms-rental-${event}:${order.id}`, eventType: `sms_rental_${event}`, category: "platform", priority: "high",
    title: event === "release" ? "SMS number release needs confirmation" : event === "registration" ? "SMS number registration needs attention" : "SMS number setup needs reconciliation",
    summary: reason, entityType: "sms_number_order", entityId: order.id, actorType: "system", actorUid: order.owner_uid, requiresAction: true,
    metadata: { ownerUid: order.owner_uid, number: order.number, orderId: order.id }, occurredAt: now });
}
export async function managedSmsAccount(actor: SmsActor, db: D1Database = getD1()) {
  owner(actor); const environment = smsEnvironment();
  const connection = await db.prepare("SELECT phone_number AS number,status,provider,account_label AS accountLabel,account_type AS accountType,daily_limit AS dailyLimit FROM trade_sms_connections WHERE firebase_uid=? AND status IN ('connecting','connected')").bind(actor.ownerUid).first();
  const setup = await db.prepare("SELECT business_name AS businessName,contact_name AS contactName,email,phone,address_line_1 AS address,suburb,address_state AS state,postcode FROM trade_accounts WHERE firebase_uid=?").bind(actor.ownerUid).first();
  const ledger = (await db.prepare("SELECT id,kind,amount_micro AS amountMicro,description,created_at AS createdAt FROM trade_sms_ledger WHERE owner_uid=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(actor.ownerUid).all()).results;
  return { configured: Boolean(environment.username && environment.apiKey && environment.origin), billingConfigured: Boolean(environment.stripeKey && environment.stripeWebhookSecret && environment.origin), urlsEnabled: environment.urlsEnabled,
    pricing: { partPriceMicro: SMS_PART_PRICE_MICRO, taxLabel: SMS_PRICE_LABEL, minimumTopUpCents: 5000 }, wallet: await smsWallet(actor.ownerUid, db),
    connection: connection ? { ...connection, usedSegments: 0 } : null, order: publicOrder(await currentOrder(actor.ownerUid, db)), ledger, setup };
}
export async function managedSmsNumbers(actor: SmsActor, fetchImpl: typeof fetch = fetch) {
  owner(actor); return searchAustralianClickSendNumbers(parentCredentials(), fetchImpl);
}
export async function rentManagedSmsNumber(actor: SmsActor, input: Record<string, unknown>, db: D1Database = getD1(), fetchImpl: typeof fetch = fetch) {
  owner(actor);
  const requestId = smsRequestId(input.requestId), registration = smsRegistration(input.registration), parent = parentCredentials(), origin = smsPublicOrigin();
  if (registration.businessName.length < 2 || registration.businessName.length > 100 || registration.address.length < 5 || registration.address.length > 150
    || registration.suburb.length < 2 || registration.suburb.length > 50 || registration.contactName.length < 2) throw new Error("SMS_REGISTRATION_INVALID");
  if (input.termsAccepted !== true || typeof input.number !== "string" || !/^\+614\d{8}$/.test(input.number)) throw new Error("SMS_RENTAL_CONFIRMATION_REQUIRED");
  const previous = await db.prepare("SELECT * FROM trade_sms_number_orders WHERE owner_uid=? AND request_id=?").bind(actor.ownerUid, requestId).first<SmsNumberOrder>();
  if (previous) {
    if (previous.number !== input.number || previous.setup_micro !== input.acceptedSetupMicro || previous.monthly_micro !== input.acceptedMonthlyMicro
      || previous.initial_reserved_micro !== input.acceptedInitialReservedMicro) throw new Error("SMS_REQUEST_CONFLICT");
    return { order: publicOrder(previous) };
  }
  const existing = await currentOrder(actor.ownerUid, db);
  if (existing && !["rejected", "cancelled"].includes(existing.status)) throw new Error("SMS_RENTAL_ALREADY_EXISTS");
  const account = await db.prepare("SELECT * FROM trade_sms_accounts WHERE owner_uid=?").bind(actor.ownerUid).first<Account>();
  if (account?.status === "payment_review") throw new Error("SMS_PAYMENT_REVIEW_REQUIRED");
  if (account?.status === "provisioning") {
    // Cancelling a number order does not prove an earlier account creation failed.
    // Recover that original identity before reserving credit for another order.
    const original = await db.prepare("SELECT * FROM trade_sms_number_orders WHERE id=? AND owner_uid=? AND status IN ('cancelled','rejected')")
      .bind(account.provisioning_order_id, actor.ownerUid).first<SmsNumberOrder>();
    if (!original) throw new Error("SMS_ACCOUNT_NOT_READY");
    const recovered = await findClickSendSubaccount(parent, `tlink_${original.id.replaceAll("-", "")}`, fetchImpl);
    if (!recovered) throw new Error("SMS_ACCOUNT_NOT_READY");
    await storeSubaccount(db, original, recovered, new Date().toISOString());
    const resolved = await db.prepare("SELECT status FROM trade_sms_accounts WHERE owner_uid=?").bind(actor.ownerUid).first<{status:string}>();
    if (resolved?.status === "payment_review") throw new Error("SMS_PAYMENT_REVIEW_REQUIRED");
    if (resolved?.status !== "ready") throw new Error("SMS_ACCOUNT_NOT_READY");
  }
  const quote = (await searchAustralianClickSendNumbers(parent, fetchImpl)).find(item => item.number === input.number);
  if (!quote || quote.monthlyMicro !== input.acceptedMonthlyMicro || quote.setupMicro !== input.acceptedSetupMicro) throw new Error("SMS_NUMBER_PRICE_CHANGED");
  const total = Math.max(quote.totalMicro, quote.setupMicro + quote.monthlyMicro);
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error("SMS_NUMBER_PRICE_CHANGED");
  if (input.acceptedInitialReservedMicro !== total) throw new Error("SMS_NUMBER_PRICE_CHANGED");
  const now = new Date().toISOString(), id = crypto.randomUUID(), registrationEncrypted = await encryptProtectedPayload(registration);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_sms_number_orders(id,owner_uid,request_id,number,setup_micro,monthly_micro,initial_reserved_micro,connection_id,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(amount_micro),0) FROM trade_sms_ledger WHERE owner_uid=?)>=?
      AND NOT EXISTS(SELECT 1 FROM trade_sms_connections WHERE firebase_uid=? AND status IN ('connecting','connected'))
      AND NOT EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE owner_uid=? AND status NOT IN ('rejected','cancelled'))
      AND NOT EXISTS(SELECT 1 FROM trade_sms_accounts WHERE owner_uid=? AND status='payment_review')`)
      .bind(id, actor.ownerUid, requestId, quote.number, quote.setupMicro, quote.monthlyMicro, total, `sms-${id}`, now, now, actor.ownerUid, total, actor.ownerUid, actor.ownerUid, actor.ownerUid),
    db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
      SELECT ?,owner_uid,'number_rental',-?,'Number setup and initial rental reserve',? FROM trade_sms_number_orders WHERE id=?`)
      .bind(`rental:${id}`, total, now, id),
    db.prepare(`INSERT INTO trade_sms_accounts(owner_uid,encrypted_registration,created_at,updated_at)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE id=?) ON CONFLICT(owner_uid) DO UPDATE SET
      encrypted_registration=excluded.encrypted_registration,updated_at=excluded.updated_at WHERE trade_sms_accounts.status IN ('new','ready')`)
      .bind(actor.ownerUid, registrationEncrypted, now, now, id),
  ]);
  const order = await db.prepare("SELECT * FROM trade_sms_number_orders WHERE owner_uid=? AND request_id=?").bind(actor.ownerUid, requestId).first<SmsNumberOrder>();
  if (!order) {
    if (await db.prepare("SELECT 1 FROM trade_sms_accounts WHERE owner_uid=? AND status='payment_review'").bind(actor.ownerUid).first()) throw new Error("SMS_PAYMENT_REVIEW_REQUIRED");
    if (await db.prepare("SELECT 1 FROM trade_sms_number_orders WHERE owner_uid=? AND status NOT IN ('rejected','cancelled')").bind(actor.ownerUid).first()) throw new Error("SMS_RENTAL_ALREADY_EXISTS");
    throw new Error("SMS_CREDIT_REQUIRED");
  }
  if (order.number !== input.number || order.setup_micro !== input.acceptedSetupMicro || order.monthly_micro !== input.acceptedMonthlyMicro
    || order.initial_reserved_micro !== input.acceptedInitialReservedMicro) throw new Error("SMS_REQUEST_CONFLICT");
  if (order.id === id) await syncManagedSmsNumber(actor.ownerUid, db, fetchImpl, origin);
  return { order: publicOrder(await currentOrder(actor.ownerUid, db)) };
}
async function rejectPurchase(db: D1Database, order: SmsNumberOrder, now: string) {
  await db.batch([
    db.prepare("UPDATE trade_sms_number_orders SET status='rejected',error='The provider did not accept this order. Credit was returned.',updated_at=? WHERE id=? AND provider_owned_at='' AND status NOT IN ('cancel_requested','cancelled')").bind(now, order.id),
    db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
      SELECT ?,owner_uid,'rental_refund',initial_reserved_micro,'Number purchase not accepted',? FROM trade_sms_number_orders WHERE id=? AND status='rejected'`)
      .bind(`rental-refund:${order.id}`, now, order.id),
    db.prepare("UPDATE trade_sms_accounts SET status='new',provisioning_order_id='' WHERE owner_uid=? AND status='provisioning' AND encrypted_credentials=''").bind(order.owner_uid),
  ]);
}
async function storeSubaccount(db: D1Database, order: SmsNumberOrder, sub: ClickSendSubaccount, now: string) {
  const secret = token(), encrypted = await encryptProtectedPayload({ ...sub.credentials, callbackToken: secret });
  await db.prepare("UPDATE trade_sms_accounts SET status='ready',subaccount_id=?,encrypted_credentials=?,callback_token_hash=?,updated_at=? WHERE owner_uid=? AND status='provisioning' AND provisioning_order_id=?")
    .bind(sub.subaccountId, encrypted, await integrationStateHash(secret), now, order.owner_uid, order.id).run();
}
async function provisionAccount(db: D1Database, order: SmsNumberOrder, fetchImpl: typeof fetch, now: string) {
  let account = await db.prepare("SELECT * FROM trade_sms_accounts WHERE owner_uid=?").bind(order.owner_uid).first<Account>();
  if (!account) throw new Error("SMS_ACCOUNT_NOT_READY");
  if (account.status === "ready") return;
  if (account.status === "new") {
    const claimed = await db.prepare("UPDATE trade_sms_accounts SET status='provisioning',provisioning_order_id=?,updated_at=? WHERE owner_uid=? AND status='new'")
      .bind(order.id, now, order.owner_uid).run();
    if (claimed.meta.changes) {
      const registration = smsRegistration(await decryptProtectedPayload(account.encrypted_registration));
      try {
        const sub = await createClickSendSubaccount(parentCredentials(), { username: `tlink_${order.id.replaceAll("-", "")}`, password: `Aa1!${token()}`, email: registration.email, phone: registration.phone,
          firstName: registration.contactName.split(" ")[0], lastName: registration.contactName.split(" ").slice(1).join(" ") || registration.businessName }, fetchImpl);
        await storeSubaccount(db, order, sub, now); return;
      } catch (error) {
        if (error instanceof ClickSendProviderError && error.definitiveRejection) await rejectPurchase(db, order, now);
        throw error;
      }
    }
    account = await db.prepare("SELECT * FROM trade_sms_accounts WHERE owner_uid=?").bind(order.owner_uid).first<Account>();
  }
  if (!account || account.status !== "provisioning" || account.provisioning_order_id !== order.id) throw new Error("SMS_ACCOUNT_RECONCILIATION_REQUIRED");
  const recovered = await findClickSendSubaccount(parentCredentials(), `tlink_${order.id.replaceAll("-", "")}`, fetchImpl);
  if (!recovered) throw new Error("SMS_ACCOUNT_RECONCILIATION_REQUIRED");
  await storeSubaccount(db, order, recovered, now);
}
async function orderStillProvisioning(db: D1Database, order: SmsNumberOrder, lease: string) {
  return db.prepare("SELECT 1 FROM trade_sms_number_orders WHERE id=? AND lease_token=? AND status NOT IN ('cancel_requested','cancelled','suspended','rejected')")
    .bind(order.id, lease).first();
}
export async function syncManagedSmsNumber(ownerUid: string, db: D1Database = getD1(), fetchImpl: typeof fetch = fetch, origin = smsPublicOrigin(), at = new Date()) {
  const initial = await currentOrder(ownerUid, db);
  if (!initial || ["rejected", "cancelled", "active", "price_review_required"].includes(initial.status)) return;
  let order = initial;
  const now = at.toISOString(), lease = crypto.randomUUID();
  const claim = await db.prepare("UPDATE trade_sms_number_orders SET lease_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND (lease_token='' OR lease_expires_at<=?) AND status NOT IN ('rejected','cancelled','active')")
    .bind(lease, new Date(at.getTime() + 180000).toISOString(), now, order.id, now).run();
  if (!claim.meta.changes) return;
  try {
    order = await db.prepare("SELECT * FROM trade_sms_number_orders WHERE id=?").bind(order.id).first<SmsNumberOrder>() || order;
    if (["cancel_requested", "suspended"].includes(order.status) && !order.purchase_attempted_at && !order.provider_owned_at) {
      await db.batch([
        db.prepare("UPDATE trade_sms_number_orders SET status='cancelled',error='Cancelled before a number purchase was attempted.',updated_at=? WHERE id=? AND purchase_attempted_at='' AND status IN ('cancel_requested','suspended')").bind(now, order.id),
        db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at) SELECT ?,owner_uid,'rental_refund',initial_reserved_micro,'Number order cancelled before purchase',?
          FROM trade_sms_number_orders WHERE id=? AND status='cancelled'`).bind(`rental-refund:${order.id}`, now, order.id),
      ]); return;
    }
    await provisionAccount(db, order, fetchImpl, now);
    const { credentials, subaccountId } = await managedSmsCredentials(ownerUid, db);
    if (!order.purchase_attempted_at && await orderStillProvisioning(db, order, lease)) {
      const account = await db.prepare("SELECT * FROM trade_sms_accounts WHERE owner_uid=?").bind(ownerUid).first<Account>();
      if (!account) throw new Error("SMS_ACCOUNT_NOT_READY");
      const registration = smsRegistration(await decryptProtectedPayload(account.encrypted_registration));
      const attempt = await db.prepare("UPDATE trade_sms_number_orders SET status='purchasing',purchase_attempted_at=?,updated_at=? WHERE id=? AND lease_token=? AND purchase_attempted_at='' AND status NOT IN ('cancel_requested','cancelled','suspended','rejected')")
        .bind(now, now, order.id, lease).run();
      if (attempt.meta.changes) {
        let purchase;
        try {
          purchase = await buyAustralianClickSendNumber(credentials, { number: order.number, registration: { business_name: registration.businessName, business_address: registration.address, suburb: registration.suburb,
            postcode: registration.postcode, state: registration.state, contact_name: registration.contactName, contact_number: registration.phone, country: "AU" } }, fetchImpl);
        } catch (error) {
          if (error instanceof ClickSendProviderError && error.definitiveRejection) await rejectPurchase(db, order, now);
          throw error;
        }
        await db.prepare("UPDATE trade_sms_number_orders SET provider_owned_at=?,initial_charge_micro=?,status=CASE WHEN status IN ('cancel_requested','suspended') THEN status ELSE 'registering' END,updated_at=? WHERE id=? AND lease_token=?")
          .bind(now, purchase.totalMicro, now, order.id, lease).run();
        if (purchase.monthlyMicro !== order.monthly_micro || purchase.setupMicro !== order.setup_micro) {
          await db.prepare("UPDATE trade_sms_number_orders SET status='price_review_required',error='The provider rental price changed. TLink support must review it before activation.',updated_at=? WHERE id=? AND status NOT IN ('cancel_requested','cancelled','suspended')").bind(now, order.id).run();
          throw new Error("SMS_RENTAL_PRICE_RECONCILIATION_REQUIRED");
        }
      }
    }
    const refreshed = await db.prepare("SELECT * FROM trade_sms_number_orders WHERE id=?").bind(order.id).first<SmsNumberOrder>();
    if (!refreshed) throw new Error("SMS_RENTAL_REQUIRED");
    order = refreshed;
    const number = (await listPurchasedClickSendNumbers(credentials, fetchImpl)).find(item => item.number === order.number);
    if (["cancel_requested", "suspended"].includes(order.status)) {
      if (!number && order.provider_owned_at) {
        if (order.initial_charge_micro < 0 || order.initial_charge_micro > order.initial_reserved_micro) {
          await db.batch([
            db.prepare("UPDATE trade_sms_number_orders SET error='ClickSend confirmed number release. The initial rental cost still needs a TLink review; the reserved credit remains held.',updated_at=? WHERE id=? AND status IN ('cancel_requested','suspended')").bind(now, order.id),
            operations(db, order, "reconcile", "Number release is confirmed, but the initial rental charge is unconfirmed or exceeds the accepted reservation. Verify the charge and settle the held credit before completing cancellation.", now),
          ]);
          return;
        }
        await db.batch([
          db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
            SELECT ?,owner_uid,'rental_refund',initial_reserved_micro-initial_charge_micro,'Verified initial number rental adjustment',? FROM trade_sms_number_orders
            WHERE id=? AND status IN ('cancel_requested','suspended') AND initial_charge_micro>=0 AND initial_charge_micro<initial_reserved_micro`)
            .bind(`rental-adjustment:${order.id}`, now, order.id),
          db.prepare("UPDATE trade_sms_number_orders SET status='cancelled',error='Number release and initial rental settlement confirmed.',updated_at=? WHERE id=? AND status IN ('cancel_requested','suspended') AND initial_charge_micro>=0 AND initial_charge_micro<=initial_reserved_micro").bind(now, order.id),
          db.prepare("UPDATE trade_sms_connections SET status='disconnected',updated_at=? WHERE id=? AND firebase_uid=? AND EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE id=? AND status='cancelled')").bind(now, order.connection_id, ownerUid, order.id),
        ]);
      }
      else {
        if (number && !order.provider_owned_at) await db.prepare("UPDATE trade_sms_number_orders SET provider_owned_at=? WHERE id=? AND provider_owned_at=''").bind(now, order.id).run();
        await operations(db, order, "release", "Sending and TLink renewal charges are stopped. Confirm release in ClickSend, then refresh the order. A cancellation API is not available.", now).run();
      }
      return;
    }
    if (!number) throw new Error("SMS_PURCHASE_RECONCILIATION_REQUIRED");
    await db.prepare("UPDATE trade_sms_number_orders SET provider_owned_at=CASE WHEN provider_owned_at='' THEN ? ELSE provider_owned_at END WHERE id=?")
      .bind(now, order.id).run();
    if (!number.ready) {
      const action = number.registrationStatus === 3 || at.getTime() - Date.parse(order.created_at) > 86400000;
      await db.prepare("UPDATE trade_sms_number_orders SET status='registering',error=?,updated_at=? WHERE id=? AND status NOT IN ('cancel_requested','cancelled','suspended')")
        .bind(action ? "Number registration needs a provider review. TLink support has been notified." : "ClickSend is reviewing this number registration. Sending starts after approval.", now, order.id).run();
      if (action) await operations(db, order, "registration", "Review the Australian number registration with ClickSend. Customer action is required or registration has been pending for over a day.", now).run();
      return;
    }
    // Inventory does not establish the charged pro-rata amount. Keep the reservation when the buy response was lost.
    if (order.initial_charge_micro < 0 || order.initial_charge_micro > order.initial_reserved_micro) throw new Error("SMS_RENTAL_PRICE_RECONCILIATION_REQUIRED");
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
        SELECT ?,owner_uid,'rental_refund',initial_reserved_micro-initial_charge_micro,'Verified initial number rental adjustment',? FROM trade_sms_number_orders
        WHERE id=? AND initial_charge_micro>=0 AND initial_charge_micro<initial_reserved_micro`)
        .bind(`rental-adjustment:${order.id}`, now, order.id),
      db.prepare("UPDATE trade_sms_number_orders SET renewal_at=CASE WHEN renewal_at='' THEN ? ELSE renewal_at END WHERE id=?")
        .bind(nextSmsRentalDate(now), order.id),
    ]);
    if (!await orderStillProvisioning(db, order, lease)) return;
    const account = await db.prepare("SELECT * FROM trade_sms_accounts WHERE owner_uid=?").bind(ownerUid).first<Account>();
    if (!account) throw new Error("SMS_ACCOUNT_NOT_READY");
    const encrypted = await decryptProtectedPayload(account.encrypted_credentials);
    if (typeof encrypted.callbackToken !== "string") throw new Error("SMS_ACCOUNT_NOT_READY");
    const priorConnection = await db.prepare("SELECT id,firebase_uid,status FROM trade_sms_connections WHERE account_sid=? AND number_sid=?")
      .bind(subaccountId, order.number).first<{id:string;firebase_uid:string;status:string}>();
    if (priorConnection && priorConnection.firebase_uid !== ownerUid) throw new Error("SMS_NUMBER_ALREADY_CONNECTED");
    const connectionId = priorConnection?.id || order.connection_id || `sms-${order.id}`, callback = `${origin}/api/trade-sms/clicksend/${connectionId}?token=${encrypted.callbackToken}`;
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO trade_sms_connections(id,firebase_uid,provider,account_sid,account_label,account_type,number_sid,phone_number,encrypted_credentials,callback_url,status,daily_limit,created_at,updated_at)
        SELECT ?,?,'clicksend',?,'TLink SMS','managed',?,?,?,?,'connecting',1000,?,? WHERE EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE id=? AND lease_token=? AND status NOT IN ('cancel_requested','cancelled','suspended','rejected'))
        ON CONFLICT(id) DO UPDATE SET status='connecting',encrypted_credentials=excluded.encrypted_credentials,callback_url=excluded.callback_url,updated_at=excluded.updated_at
        WHERE trade_sms_connections.firebase_uid=excluded.firebase_uid AND trade_sms_connections.status='disconnected'`)
        .bind(connectionId, ownerUid, subaccountId, order.number, order.number, account.encrypted_credentials, callback, now, now, order.id, lease),
      db.prepare("UPDATE trade_sms_number_orders SET connection_id=?,status='routing',updated_at=? WHERE id=? AND lease_token=? AND status NOT IN ('cancel_requested','cancelled','suspended','rejected')")
        .bind(connectionId, now, order.id, lease),
    ]);
    const inboundRules = await listClickSendInboundRules(credentials, fetchImpl);
    let inbound = inboundRules.find(rule => rule.number === order.number && rule.callbackUrl === callback && rule.enabled && rule.action === "URL" && rule.matchType === 0 && rule.searchTerm === "" && rule.webhookType === "json");
    if (!inbound) {
      if (inboundRules.some(rule => rule.enabled && rule.number === order.number)) throw new Error("SMS_ROUTING_CONFLICT");
      const attempt = await db.prepare("UPDATE trade_sms_number_orders SET inbound_rule_attempted_at=? WHERE id=? AND lease_token=? AND status='routing' AND inbound_rule_attempted_at=''").bind(now, order.id, lease).run();
      if (!attempt.meta.changes) throw new Error("SMS_ROUTING_RECONCILIATION_REQUIRED");
      inbound = await createClickSendInboundRule(credentials, { number: order.number, callbackUrl: callback, ruleName: `TLink ${connectionId}` }, fetchImpl);
    }
    await db.prepare("UPDATE trade_sms_number_orders SET inbound_rule_id=? WHERE id=? AND lease_token=?").bind(inbound.id, order.id, lease).run();
    const receiptCallback = `${callback}&kind=receipt`, receipts = await listClickSendReceiptRules(credentials, fetchImpl);
    let receipt = receipts.find(rule => rule.callbackUrl === receiptCallback && rule.enabled && rule.action === "URL" && rule.matchType === 0);
    if (!receipt) {
      if (receipts.some(rule => rule.enabled)) throw new Error("SMS_ROUTING_CONFLICT");
      const attempt = await db.prepare("UPDATE trade_sms_number_orders SET receipt_rule_attempted_at=? WHERE id=? AND lease_token=? AND status='routing' AND receipt_rule_attempted_at=''").bind(now, order.id, lease).run();
      if (!attempt.meta.changes) throw new Error("SMS_ROUTING_RECONCILIATION_REQUIRED");
      receipt = await createClickSendReceiptRule(credentials, { callbackUrl: receiptCallback, ruleName: `TLink ${connectionId}` }, fetchImpl);
    }
    await db.batch([
      db.prepare("UPDATE trade_sms_number_orders SET status='active',inbound_rule_id=?,receipt_rule_id=?,error='',updated_at=? WHERE id=? AND lease_token=? AND status='routing'").bind(inbound.id, receipt.id, now, order.id, lease),
      db.prepare("UPDATE trade_sms_connections SET status='connected',updated_at=? WHERE id=? AND firebase_uid=? AND EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE id=? AND status='active' AND renewal_at>?)")
        .bind(now, connectionId, ownerUid, order.id, now),
    ]);
  } catch {
    const state = await db.prepare("SELECT status FROM trade_sms_number_orders WHERE id=?").bind(order.id).first<{status:string}>();
    if (state?.status === "rejected") return;
    await db.batch([
      db.prepare("UPDATE trade_sms_number_orders SET status='reconciliation_required',error='Setup or initial rental cost needs a provider check. Do not order another number.',updated_at=? WHERE id=? AND status NOT IN ('rejected','cancelled','cancel_requested','suspended','price_review_required')").bind(now, order.id),
      operations(db, order, "reconcile", "Reconcile this existing order with ClickSend. Do not repurchase the number or repeat an unconfirmed provider mutation.", now),
    ]);
  } finally {
    await db.prepare("UPDATE trade_sms_number_orders SET lease_token='',lease_expires_at='' WHERE id=? AND lease_token=?").bind(order.id, lease).run();
  }
}
export async function cancelManagedSmsRental(actor: SmsActor, db: D1Database = getD1()) {
  owner(actor); const order = await currentOrder(actor.ownerUid, db);
  if (!order || ["rejected", "cancelled"].includes(order.status)) throw new Error("SMS_RENTAL_REQUIRED");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE trade_sms_number_orders SET status='cancel_requested',error='Cancellation requested. TLink support must confirm release with ClickSend. Sending and renewals are stopped.',updated_at=? WHERE id=? AND status NOT IN ('cancelled','rejected')").bind(now, order.id),
    db.prepare("UPDATE trade_sms_connections SET status='connecting',updated_at=? WHERE id=? AND firebase_uid=?").bind(now, order.connection_id, actor.ownerUid),
    operations(db, order, "release", "The business requested cancellation. Release the dedicated number with ClickSend and confirm the provider no longer lists it. Sending and TLink renewal charges are stopped.", now),
  ]);
  return { order: publicOrder(await currentOrder(actor.ownerUid, db)) };
}
export async function processManagedSmsRentals(db: D1Database, fetchImpl: typeof fetch = fetch, at = new Date()) {
  const now = at.toISOString();
  const due = await db.prepare("SELECT * FROM trade_sms_number_orders WHERE status='active' AND renewal_at<>'' AND renewal_at<=? ORDER BY renewal_at,id LIMIT 20").bind(now).all<SmsNumberOrder>();
  for (const order of due.results) {
    const ledgerId = `rental-renewal:${order.id}:${order.renewal_at}`, next = nextSmsRentalDate(order.renewal_at);
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
        SELECT ?,owner_uid,'number_rental',-monthly_micro,'Monthly SMS number rental',? FROM trade_sms_number_orders
        WHERE id=? AND status='active' AND renewal_at=? AND (SELECT COALESCE(SUM(amount_micro),0) FROM trade_sms_ledger WHERE owner_uid=trade_sms_number_orders.owner_uid)>=monthly_micro
        AND EXISTS(SELECT 1 FROM trade_sms_accounts WHERE owner_uid=trade_sms_number_orders.owner_uid AND status='ready')`)
        .bind(ledgerId, now, order.id, order.renewal_at),
      db.prepare("UPDATE trade_sms_number_orders SET renewal_at=?,updated_at=? WHERE id=? AND status='active' AND renewal_at=? AND EXISTS(SELECT 1 FROM trade_sms_ledger WHERE id=? AND owner_uid=? AND amount_micro=?)")
        .bind(next, now, order.id, order.renewal_at, ledgerId, order.owner_uid, -order.monthly_micro),
      db.prepare("UPDATE trade_sms_number_orders SET status='suspended',error='Number renewal could not be funded. Sending is paused and TLink support has been asked to release this number.',updated_at=? WHERE id=? AND status='active' AND renewal_at=? AND NOT EXISTS(SELECT 1 FROM trade_sms_ledger WHERE id=?)")
        .bind(now, order.id, order.renewal_at, ledgerId),
      db.prepare("UPDATE trade_sms_connections SET status='connecting',updated_at=? WHERE id=? AND firebase_uid=? AND EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE id=? AND status='suspended')")
        .bind(now, order.connection_id, order.owner_uid, order.id),
      db.prepare("UPDATE trade_sms_connections SET status='connected',updated_at=? WHERE id=? AND firebase_uid=? AND EXISTS(SELECT 1 FROM trade_sms_number_orders WHERE id=? AND status='active' AND renewal_at>? AND inbound_rule_id<>'' AND receipt_rule_id<>'')")
        .bind(now, order.connection_id, order.owner_uid, order.id, now),
    ]);
    const current = await db.prepare("SELECT status FROM trade_sms_number_orders WHERE id=?").bind(order.id).first<{ status: string }>();
    if (current?.status === "suspended") await operations(db, order, "release", "The wallet could not fund monthly number rental. Sending is paused. Release the number with ClickSend and confirm the provider no longer lists it; no further TLink renewal charges will be taken.", now).run();
  }
  if (!smsEnvironment().username || !smsEnvironment().apiKey || !smsEnvironment().origin) return;
  const pending = await db.prepare("SELECT owner_uid FROM trade_sms_number_orders WHERE status NOT IN ('active','cancelled','rejected','price_review_required') AND (lease_token='' OR lease_expires_at<=?) ORDER BY updated_at,id LIMIT 6")
    .bind(now).all<{ owner_uid: string }>();
  for (const order of pending.results) await syncManagedSmsNumber(order.owner_uid, db, fetchImpl, smsPublicOrigin(), at);
}
export async function syncManagedSmsAccount(actor: SmsActor, db: D1Database = getD1(), fetchImpl: typeof fetch = fetch) {
  owner(actor); await syncSmsPayments(actor.ownerUid, db, fetchImpl);
  if (smsEnvironment().username) await syncManagedSmsNumber(actor.ownerUid, db, fetchImpl);
}
