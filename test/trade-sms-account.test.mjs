import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as billing from "../src/lib/trade-sms-billing.ts";
import { ClickSendProviderError } from "../src/lib/trade-clicksend-provider.ts";

const NUMBER = "+61400000000", MONTHLY = 20_900_000, ORIGIN = "https://tlink.example.test";
const actor = { ownerUid: "owner", actorUid: "owner", isOwner: true, businessName: "Example Trade" };
const registration = { businessName: "Example Trade", address: "10 Test Street", suburb: "Sydney", state: "NSW", postcode: "2000", contactName: "Alex Smith", phone: "+61400000001", email: "owner@example.test", useCase: "Appointment updates" };
const input = (changes = {}) => ({ requestId: "rental-request-12345", termsAccepted: true, number: NUMBER, acceptedSetupMicro: 0, acceptedMonthlyMicro: MONTHLY, acceptedInitialReservedMicro: MONTHLY, registration, ...changes });
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0182_trade_sms.sql", import.meta.url), "utf8"));
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0220_trade_managed_sms.sql", import.meta.url), "utf8"));
  sqlite.exec("CREATE TABLE admin_notifications(event_key TEXT PRIMARY KEY,event_type TEXT,summary TEXT,metadata TEXT)");
  const prepare = (sql, values = []) => {
    const run = () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } });
    return { bind: (...args) => prepare(sql, args), first: async () => sqlite.prepare(sql).get(...values) || null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }), run: async () => run(), syncRun: run };
  };
  const db = { prepare, batch: async statements => { sqlite.exec("BEGIN"); try { const results = statements.map(statement => statement.syncRun()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  sqlite.prepare("INSERT INTO trade_sms_ledger VALUES('topup','owner','top_up',50000000,'Test credit',?)").run(new Date().toISOString());
  const state = { creates: 0, buys: 0, finds: 0, inboundCreates: 0, receiptCreates: 0, sub: null, owned: [], inbound: [], receipts: [], calls: [], createLost: false, findMissing: false, findLost: false, buyLost: false, buyMissing: false, buyRejected: false, inboundLost: false, receiptLost: false, registrationPending: false, env: true, quotedTotal: MONTHLY, actualInitial: MONTHLY, actualMonthly: MONTHLY };
  const provider = {
    ClickSendProviderError, clickSendCredentials: (username, apiKey) => ({ username, apiKey }),
    searchAustralianClickSendNumbers: async () => [{ number: NUMBER, setupMicro: 0, monthlyMicro: MONTHLY, totalMicro: state.quotedTotal, currency: "AUD" }],
    createClickSendSubaccount: async (_parent, value) => { state.creates++; state.sub = { subaccountId: "123", credentials: { username: value.username, apiKey: "fake-subaccount-key" } }; if (state.createLost) throw new ClickSendProviderError("SMS_PROVIDER_OUTCOME_UNKNOWN"); return state.sub; },
    findClickSendSubaccount: async (_parent, username) => { state.finds++; assert.equal(username, state.sub?.credentials.username); if (state.findLost) throw new ClickSendProviderError("SMS_PROVIDER_OUTCOME_UNKNOWN"); return state.findMissing ? null : state.sub; },
    buyAustralianClickSendNumber: async (_credentials, value) => { state.buys++; state.calls.push(value); if (state.buyRejected) throw new ClickSendProviderError("SMS_PROVIDER_REJECTED", true); if (!state.buyMissing) state.owned = [{ number: NUMBER, ready: !state.registrationPending, registrationStatus: state.registrationPending ? 3 : 5 }]; if (state.buyLost) throw new ClickSendProviderError("SMS_PROVIDER_OUTCOME_UNKNOWN"); return { number: NUMBER, monthlyMicro: state.actualMonthly, setupMicro: 0, totalMicro: state.actualInitial, currency: "AUD" }; },
    listPurchasedClickSendNumbers: async () => state.owned,
    listClickSendInboundRules: async () => state.inbound,
    listClickSendReceiptRules: async () => state.receipts,
    createClickSendInboundRule: async (_credentials, value) => { state.inboundCreates++; const rule = { ...value, id: "1", enabled: true, action: "URL", matchType: 0, searchTerm: "", webhookType: "json" }; state.inbound.push(rule); if (state.inboundLost) throw new ClickSendProviderError("SMS_PROVIDER_OUTCOME_UNKNOWN"); return rule; },
    createClickSendReceiptRule: async (_credentials, value) => { state.receiptCreates++; const rule = { ...value, id: "2", enabled: true, action: "URL", matchType: 0 }; state.receipts.push(rule); if (state.receiptLost) throw new ClickSendProviderError("SMS_PROVIDER_OUTCOME_UNKNOWN"); return rule; },
  };
  const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/lib/trade-sms-account-server.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const dependencies = {
    "../../db": { getD1: () => db }, "./trade-clicksend-provider": provider, "./trade-sms-billing": billing,
    "./trade-integration-crypto": { encryptProtectedPayload: async value => JSON.stringify(value), decryptProtectedPayload: async value => JSON.parse(value), integrationStateHash: async value => `hash-${value}` },
    "./trade-sms-environment": { smsEnvironment: () => ({ username: state.env ? "parent" : "", apiKey: state.env ? "fake-parent-key" : "", origin: ORIGIN, registrationsEnabled: false }), smsPublicOrigin: () => ORIGIN },
    "./trade-sms-wallet-server": { smsWallet: async ownerUid => ({ balanceMicro: sqlite.prepare("SELECT COALESCE(SUM(amount_micro),0) n FROM trade_sms_ledger WHERE owner_uid=?").get(ownerUid).n }), syncSmsPayments: async () => {} },
    "./admin-notifications": { adminNotificationStatement: (database, value) => database.prepare("INSERT OR IGNORE INTO admin_notifications VALUES(?,?,?,?)").bind(value.eventKey, value.eventType, value.summary, JSON.stringify(value.metadata)) },
  };
  const api = {}; Function("require", "exports", compiled)(id => { if (!dependencies[id]) throw new Error(`Unexpected dependency ${id}`); return dependencies[id]; }, api);
  const order = () => sqlite.prepare("SELECT * FROM trade_sms_number_orders ORDER BY created_at DESC,id DESC LIMIT 1").get();
  const balance = () => sqlite.prepare("SELECT SUM(amount_micro) n FROM trade_sms_ledger").get().n;
  const notifications = () => sqlite.prepare("SELECT * FROM admin_notifications").all();
  const rent = (value = input()) => api.rentManagedSmsNumber(actor, value, db, async () => { throw new Error("Real fetch forbidden"); });
  const sync = () => api.syncManagedSmsNumber(actor.ownerUid, db, async () => { throw new Error("Real fetch forbidden"); }, ORIGIN);
  return { sqlite, db, api, state, rent, sync, order, balance, notifications };
}
test("rental reserves one charge, creates one restricted account and connects exact stable callback routes", async t => {
  const f = fixture(t); const result = await f.rent();
  assert.equal(result.order.status, "active"); assert.equal(f.balance(), 50_000_000 - MONTHLY);
  assert.equal(f.state.creates, 1); assert.equal(f.state.buys, 1); assert.equal(f.state.inboundCreates, 1); assert.equal(f.state.receiptCreates, 1);
  assert.equal(f.order().connection_id, `sms-${f.order().id}`); assert.match(f.state.inbound[0].callbackUrl, new RegExp(`/clicksend/sms-${f.order().id}\\?token=`));
  await f.rent(); assert.equal(f.state.buys, 1); assert.equal(f.balance(), 50_000_000 - MONTHLY);
});
test("concurrent rent requests cannot reserve or purchase two numbers for one business", async t => {
  const f = fixture(t); const results = await Promise.allSettled([f.rent(), f.rent(input({ requestId: "different-request-12345" }))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(f.state.buys, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_number_orders").get().n, 1); assert.equal(f.balance(), 50_000_000 - MONTHLY);
});
test("insufficient funds and mismatched accepted pricing never create a provider account", async t => {
  const f = fixture(t); await assert.rejects(() => f.rent(input({ acceptedMonthlyMicro: 1 })), /SMS_NUMBER_PRICE_CHANGED/);
  f.sqlite.exec("UPDATE trade_sms_ledger SET amount_micro=1"); await assert.rejects(() => f.rent(), /SMS_CREDIT_REQUIRED/); assert.equal(f.state.creates, 0);
});
test("lost subaccount creation recovers deterministic username without duplicate creation", async t => {
  const f = fixture(t); f.state.createLost = true; await f.rent(); assert.equal(f.order().status, "reconciliation_required"); assert.equal(f.state.buys, 0);
  await f.sync(); assert.equal(f.order().status, "active"); assert.equal(f.state.creates, 1); assert.equal(f.state.finds, 1); assert.equal(f.state.buys, 1);
  assert.ok(f.notifications().some(note => note.event_type === "sms_rental_reconcile"));
});
test("renting after cancellation of an uncertain subaccount creation recovers the original account before reserving again", async t => {
  const f = fixture(t); f.state.createLost = true;
  await f.rent(); const originalId = f.order().id;
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_accounts").get().status, "provisioning");
  await f.api.cancelManagedSmsRental(actor, f.db); await f.sync();
  assert.equal(f.order().status, "cancelled"); assert.equal(f.balance(), 50_000_000); assert.equal(f.state.buys, 0);
  const result = await f.rent(input({ requestId: "recovered-rental-request" }));
  assert.equal(result.order.status, "active"); assert.notEqual(result.order.id, originalId);
  assert.equal(f.state.creates, 1); assert.equal(f.state.finds, 1); assert.equal(f.state.buys, 1);
  assert.equal(f.balance(), 50_000_000 - MONTHLY);
  const account = f.sqlite.prepare("SELECT status,subaccount_id,provisioning_order_id FROM trade_sms_accounts").get();
  assert.equal(account.status, "ready"); assert.equal(account.subaccount_id, "123"); assert.equal(account.provisioning_order_id, originalId);
  await f.rent(input({ requestId: "recovered-rental-request" }));
  assert.equal(f.state.creates, 1); assert.equal(f.state.buys, 1); assert.equal(f.balance(), 50_000_000 - MONTHLY);
});
test("unconfirmed original subaccount recovery never reserves fresh credit or repeats creation and remains recoverable", async t => {
  const f = fixture(t); f.state.createLost = true;
  await f.rent(); await f.api.cancelManagedSmsRental(actor, f.db); await f.sync();
  const request = input({ requestId: "waiting-recovery-request" });
  f.state.findMissing = true;
  await assert.rejects(() => f.rent(request), /SMS_ACCOUNT_NOT_READY/);
  f.state.findMissing = false; f.state.findLost = true;
  await assert.rejects(() => f.rent(request), /SMS_PROVIDER_OUTCOME_UNKNOWN/);
  assert.equal(f.balance(), 50_000_000); assert.equal(f.state.creates, 1); assert.equal(f.state.buys, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_number_orders").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE kind='number_rental'").get().n, 1);
  f.state.findLost = false;
  assert.equal((await f.rent(request)).order.status, "active");
  assert.equal(f.state.creates, 1); assert.equal(f.state.buys, 1); assert.equal(f.balance(), 50_000_000 - MONTHLY);
});
test("ambiguous purchase finds the number but keeps initial cost unconfirmed and never repurchases", async t => {
  const f = fixture(t); f.state.buyLost = true; await f.rent(); assert.equal(f.order().status, "reconciliation_required");
  await f.sync(); assert.equal(f.order().status, "reconciliation_required"); assert.equal(f.order().initial_charge_micro, -1); assert.equal(f.state.buys, 1); assert.equal(f.balance(), 50_000_000 - MONTHLY);
});
test("an absent number after purchase timeout is not proof of failure and does not refund or repurchase", async t => {
  const f = fixture(t); f.state.buyLost = true; f.state.buyMissing = true; await f.rent(); await f.sync(); await f.sync();
  assert.equal(f.state.buys, 1); assert.equal(f.order().status, "reconciliation_required"); assert.equal(f.balance(), 50_000_000 - MONTHLY);
  assert.equal(f.notifications().length, 1);
});
test("definitive purchase rejection refunds exactly once and a new order uses new registration", async t => {
  const f = fixture(t); f.state.buyRejected = true; await f.rent(); await f.rent(); assert.equal(f.order().status, "rejected"); assert.equal(f.balance(), 50_000_000);
  assert.equal(f.state.buys, 1); assert.equal(f.notifications().length, 0);
  f.state.buyRejected = false; await f.rent(input({ requestId: "second-rental-request", registration: { ...registration, businessName: "Updated Trade" } }));
  assert.equal(f.state.calls.at(-1).registration.business_name, "Updated Trade"); assert.equal(f.state.creates, 1);
});
test("lost callback-rule responses retain connection identity and read-reconcile without duplicate rules", async t => {
  const f = fixture(t); f.state.inboundLost = true; f.state.receiptLost = true; await f.rent(); const connection = f.order().connection_id;
  await Promise.all([f.sync(), f.sync()]); await f.sync();
  assert.equal(f.order().status, "active"); assert.equal(f.order().connection_id, connection); assert.equal(f.state.inboundCreates, 1); assert.equal(f.state.receiptCreates, 1);
});
test("registration requiring customer action is reported honestly and not marked connected", async t => {
  const f = fixture(t); f.state.registrationPending = true; await f.rent(); assert.equal(f.order().status, "registering");
  assert.equal(f.state.inboundCreates, 0); assert.ok(f.notifications().some(note => note.event_type === "sms_rental_registration"));
});
test("simultaneous monthly renewal ticks debit the original quoted rental exactly once", async t => {
  const f = fixture(t); await f.rent(); const due = new Date(Date.now() - 60000).toISOString();
  f.sqlite.prepare("UPDATE trade_sms_number_orders SET renewal_at=?").run(due); f.state.env = false;
  await Promise.all([f.api.processManagedSmsRentals(f.db), f.api.processManagedSmsRentals(f.db)]);
  assert.equal(f.balance(), 50_000_000 - 2 * MONTHLY); assert.equal(f.order().renewal_at, billing.nextSmsRentalDate(due));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE id LIKE 'rental-renewal:%'").get().n, 1);
});
test("low renewal balance pauses the number, requests operations release and never debits later", async t => {
  const f = fixture(t); await f.rent(); f.sqlite.exec("UPDATE trade_sms_ledger SET amount_micro=21000000 WHERE id='topup'");
  f.sqlite.prepare("UPDATE trade_sms_number_orders SET renewal_at=?").run(new Date(Date.now() - 60000).toISOString()); f.state.env = false;
  await f.api.processManagedSmsRentals(f.db); assert.equal(f.order().status, "suspended"); assert.equal(f.balance(), 100000);
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_connections").get().status, "connecting");
  f.sqlite.exec("UPDATE trade_sms_ledger SET amount_micro=50000000 WHERE id='topup'"); await f.api.processManagedSmsRentals(f.db);
  assert.equal(f.balance(), 50_000_000 - MONTHLY); assert.equal(f.notifications().filter(note => note.event_type === "sms_rental_release").length, 1);
});
test("cancellation stops renewals immediately but remains pending until owned-number absence confirms release", async t => {
  const f = fixture(t); await f.rent(); const before = f.balance(); await f.api.cancelManagedSmsRental(actor, f.db);
  assert.equal(f.order().status, "cancel_requested"); f.sqlite.prepare("UPDATE trade_sms_number_orders SET renewal_at=?").run(new Date(Date.now() - 60000).toISOString());
  await f.api.processManagedSmsRentals(f.db); assert.equal(f.balance(), before); assert.equal(f.order().status, "cancel_requested");
  f.state.owned = []; await f.sync(); assert.equal(f.order().status, "cancelled"); assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_connections").get().status, "disconnected");
  assert.equal(f.state.buys, 1); assert.equal(f.notifications().filter(note => note.event_type === "sms_rental_release").length, 1);
});
test("cancellation after ambiguous purchase cannot invent provider release confirmation", async t => {
  const f = fixture(t); f.state.buyLost = true; f.state.buyMissing = true; await f.rent(); await f.api.cancelManagedSmsRental(actor, f.db); await f.sync();
  assert.equal(f.order().status, "cancel_requested"); assert.equal(f.state.buys, 1); assert.equal(f.balance(), 50_000_000 - MONTHLY);
});
test("only owners rent and cancel numbers; registration does not depend on undocumented environment switch", async t => {
  const f = fixture(t); await assert.rejects(() => f.api.rentManagedSmsNumber({ ...actor, isOwner: false }, input(), f.db), /SMS_OWNER_REQUIRED/);
  await assert.rejects(() => f.api.cancelManagedSmsRental({ ...actor, isOwner: false }, f.db), /SMS_OWNER_REQUIRED/);
  assert.equal((await f.api.managedSmsNumbers(actor)).length, 1);
});
test("actual provider initial cost refunds only the verified difference once and renews on the next AEST month boundary", async t => {
  const f = fixture(t); f.state.actualInitial = 1_045_000; const result = await f.rent(); await f.sync();
  assert.equal(result.order.initialReservedMicro, MONTHLY); assert.equal(result.order.initialChargeMicro, 1_045_000);
  assert.equal(result.order.initialChargeSettled, true);
  assert.equal(f.balance(), 50_000_000 - 1_045_000); assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE id LIKE 'rental-adjustment:%'").get().n, 1);
  const localRenewal = new Date(Date.parse(f.order().renewal_at) + 10 * 3600000);
  assert.equal(localRenewal.getUTCDate(), 1); assert.equal(localRenewal.getUTCHours(), 0);
});
test("registration pending retains the maximum reserve until ReadyToUse and never invents a pro-rata refund", async t => {
  const f = fixture(t); f.state.registrationPending = true; f.state.actualInitial = 2_000_000;
  const result = await f.rent(); assert.equal(f.balance(), 50_000_000 - MONTHLY); assert.equal(f.order().renewal_at, ""); assert.equal(result.order.initialChargeSettled, false);
  f.state.owned[0].ready = true; f.state.owned[0].registrationStatus = 5; await f.sync();
  assert.equal(f.order().status, "active"); assert.equal(f.balance(), 48_000_000); assert.equal(f.order().renewal_at, billing.nextSmsRentalDate(new Date().toISOString()));
});
test("cancelling registration settles a verified $2 charge from a $35 reservation exactly once", async t => {
  const f = fixture(t); f.state.registrationPending = true; f.state.quotedTotal = 35_000_000; f.state.actualInitial = 2_000_000;
  const request = input({ acceptedInitialReservedMicro: 35_000_000 });
  await f.rent(request); assert.equal(f.balance(), 15_000_000); assert.equal(f.order().renewal_at, "");
  await f.api.cancelManagedSmsRental(actor, f.db); f.state.owned = [];
  await f.sync(); await f.sync();
  assert.equal(f.order().status, "cancelled"); assert.equal(f.balance(), 48_000_000);
  const adjustment = f.sqlite.prepare("SELECT amount_micro FROM trade_sms_ledger WHERE id LIKE 'rental-adjustment:%'").all();
  assert.equal(adjustment.length, 1); assert.equal(adjustment[0].amount_micro, 33_000_000);
  const result = await f.rent(request);
  assert.equal(result.order.initialChargeSettled, true); assert.equal(result.order.initialChargeMicro, 2_000_000);
  assert.equal(f.state.buys, 1); assert.equal(f.state.inboundCreates, 0);
});
test("cancellation and its verified rental adjustment commit atomically and a failed refund can be retried", async t => {
  const f = fixture(t); f.state.registrationPending = true; f.state.actualInitial = 2_000_000;
  await f.rent(); await f.api.cancelManagedSmsRental(actor, f.db); f.state.owned = [];
  f.sqlite.exec(`CREATE TRIGGER fail_cancel_adjustment BEFORE INSERT ON trade_sms_ledger WHEN NEW.id LIKE 'rental-adjustment:%'
    BEGIN SELECT RAISE(ABORT,'Fixture adjustment unavailable'); END`);
  await f.sync(); assert.equal(f.order().status, "cancel_requested"); assert.equal(f.balance(), 50_000_000 - MONTHLY);
  f.sqlite.exec("DROP TRIGGER fail_cancel_adjustment");
  await f.sync(); await f.sync();
  assert.equal(f.order().status, "cancelled"); assert.equal(f.balance(), 48_000_000);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE id LIKE 'rental-adjustment:%'").get().n, 1);
});
test("released number with an unknown initial charge stays under explicit cost review until verified", async t => {
  const f = fixture(t); f.state.buyLost = true;
  await f.rent(); await f.sync(); assert.ok(f.order().provider_owned_at); assert.equal(f.order().initial_charge_micro, -1);
  await f.api.cancelManagedSmsRental(actor, f.db); f.state.owned = [];
  await f.sync(); await f.sync();
  assert.equal(f.order().status, "cancel_requested"); assert.match(f.order().error, /initial rental cost.*review/i);
  assert.equal(f.balance(), 50_000_000 - MONTHLY); assert.equal(f.state.buys, 1);
  assert.equal((await f.rent()).order.initialChargeSettled, false);
  assert.ok(f.notifications().some(note => note.event_type === "sms_rental_reconcile"));
  f.sqlite.prepare("UPDATE trade_sms_number_orders SET initial_charge_micro=2000000").run();
  await f.sync(); assert.equal(f.order().status, "cancelled"); assert.equal(f.balance(), 48_000_000);
});
test("provider initial charge above the reservation and changed recurring quote never silently increase customer debits", async t => {
  const f = fixture(t); f.state.actualInitial = MONTHLY + 1; await f.rent(); await f.sync();
  assert.equal(f.order().status, "reconciliation_required"); assert.equal(f.balance(), 50_000_000 - MONTHLY); assert.equal(f.state.inboundCreates, 0);
});
test("changed monthly quote persists a review hold even when a later sync can find the number", async t => {
  const f = fixture(t); f.state.actualMonthly = MONTHLY + 1; await f.rent(); await f.sync();
  assert.equal(f.order().status, "price_review_required"); assert.equal(f.order().initial_charge_micro, MONTHLY); assert.equal(f.state.inboundCreates, 0);
});
test("payment review blocks new rental reservations and cannot be cleared by registration upsert", async t => {
  const f = fixture(t), now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO trade_sms_accounts(owner_uid,status,created_at,updated_at) VALUES('owner','payment_review',?,?)").run(now, now);
  await assert.rejects(() => f.rent(), /SMS_PAYMENT_REVIEW_REQUIRED/); assert.equal(f.balance(), 50_000_000);
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_accounts").get().status, "payment_review"); assert.equal(f.state.creates, 0);
});
test("initial reserve consent is exact and replay cannot change it", async t => {
  const f = fixture(t); await assert.rejects(() => f.rent(input({ acceptedInitialReservedMicro: MONTHLY - 1 })), /SMS_NUMBER_PRICE_CHANGED/);
  await f.rent(); await assert.rejects(() => f.rent(input({ acceptedInitialReservedMicro: MONTHLY - 1 })), /SMS_REQUEST_CONFLICT/);
  assert.equal(f.state.buys, 1);
});
test("renting a released number again reuses its business-owned connection and callback identity", async t => {
  const f = fixture(t); await f.rent(); const connectionId = f.order().connection_id;
  await f.api.cancelManagedSmsRental(actor, f.db); f.state.owned = []; await f.sync();
  const result = await f.rent(input({ requestId: "rerent-request-12345" }));
  assert.equal(result.order.status, "active"); assert.equal(f.sqlite.prepare("SELECT id FROM trade_sms_connections WHERE status='connected'").get().id, connectionId);
  assert.equal(f.state.inboundCreates, 1); assert.equal(f.state.receiptCreates, 1); assert.equal(f.state.creates, 1); assert.equal(f.state.buys, 2);
});
