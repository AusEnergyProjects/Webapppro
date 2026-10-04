import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const exports = {};
  const compiled = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const { customerHubEmailRetryable } = load("../src/lib/customer-hub-email-server.ts", {
  "./trade-integration-crypto": {}, "./customer-quote-hub-server": {}, "./customer-hub-links": {},
  "./service-reminder-delivery": {}, "./customer-hub-email.mjs": {},
});

function fixture({ role = "owner", originAllowed = true, outcome = { ok: true, status: "accepted" } } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  const tables = {
    service_reminder_channel_settings: "channel,provider,enabled,sender_label,daily_limit,revision,updated_at",
    service_reminder_deliveries: "id,channel,provider,status,attempts,provider_status,last_error,updated_at",
    appointment_notification_deliveries: "id,event_id,audience,channel,provider,status,eligibility_reason,attempts,provider_status,last_error,updated_at",
    appointment_notification_events: "id,event_type",
    trade_crm_photo_request_deliveries: "id,channel,provider,intent,status,eligibility_reason,attempts,provider_status,last_error,updated_at",
    customer_hub_events: "id,event_type,body,recipient_email,secure_link",
  };
  for (const [name, columns] of Object.entries(tables)) {
    sqlite.exec(`CREATE TABLE ${name} (${columns.split(",").map(column => `${column} TEXT`).join(",")})`);
  }
  const migration = read("../drizzle/0247_customer_hub_conversations.sql");
  const deliverySchema = migration.match(/CREATE TABLE customer_hub_email_deliveries \([\s\S]*?\n\);/);
  assert.ok(deliverySchema);
  sqlite.exec(deliverySchema[0]);
  const calls = { reads: 0, retries: [], audits: [], identities: [], existingRetries: [] };
  const db = {
    prepare(sql) {
      calls.reads += 1;
      const statement = values => ({
        bind: (...next) => statement(next),
        all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
        first: async () => sqlite.prepare(sql).get(...values) || null,
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
      });
      return statement([]);
    },
  };
  const routes = load("../src/app/api/admin/service-reminder-delivery/route.ts", {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": {
      sameOrigin: request => originAllowed && (!request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin),
      requireAdminIdentity: async (_request, allowedRoles) => {
        calls.identities.push(allowedRoles);
        if (!role) throw new Error("AUTH_REQUIRED");
        if (!allowedRoles.includes(role)) throw new Error("ROLE_REQUIRED");
        return { uid: "operations-owner", role };
      },
      adminJson: (body, status = 200) => Response.json(body, { status }),
      adminError: error => Response.json({ ok: false, error: error.message }, { status: error.message === "AUTH_REQUIRED" ? 401 : 403 }),
      cleanAdminText: (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "",
      writeAdminAudit: async (...args) => calls.audits.push(args),
    },
    "@/lib/service-reminder-delivery": { serviceReminderProviderConfiguration: () => ({ email: {}, sms: {} }) },
    "@/lib/appointment-notification-server": { retryAppointmentNotificationDelivery: async (...args) => { calls.existingRetries.push(["appointment", ...args]); return { ok: true }; } },
    "@/lib/photo-request-delivery-server": { retryPhotoRequestDelivery: async (...args) => { calls.existingRetries.push(["photo", ...args]); return { ok: true }; } },
    "@/lib/customer-hub-email-server": { customerHubEmailRetryable, retryCustomerHubEmail: async (database, id) => {
      assert.equal(database, db); calls.retries.push(id);
      if (outcome.ok) sqlite.prepare("UPDATE customer_hub_email_deliveries SET status=? WHERE event_id=?").run(outcome.status, id);
      return outcome;
    } },
  });
  function seed(id, overrides = {}) {
    const row = { event_id: id, release_id: "private-release", email_hash: "private-email-hash", status: "stopped",
      attempts: 1, next_attempt_at: "", first_attempt_at: "2026-01-01T00:00:00.000Z", encrypted_payload: "",
      updated_at: new Date().toISOString(), provider_id: "", ...overrides };
    const columns = Object.keys(row);
    sqlite.prepare(`INSERT INTO customer_hub_email_deliveries (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
    sqlite.prepare("INSERT INTO customer_hub_events VALUES (?, 'asked', 'PRIVATE QUESTION', 'private@example.test', 'https://example.test/private-capability')").run(id);
    return row;
  }
  return { sqlite, calls, routes, seed };
}

const request = (method = "GET", body, headers = {}) => new Request("https://example.test/api/admin/service-reminder-delivery", {
  method, headers: { origin: "https://example.test", ...headers }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
});

test("Customer Q&A admin projection returns exactly six safe fields, newest first, limited to fifty", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  for (let index = 0; index < 55; index += 1) f.seed(`event-${String(index).padStart(2, "0")}`, {
    updated_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    encrypted_payload: "PRIVATE ENCRYPTED PAYLOAD", provider_id: "PRIVATE PROVIDER ID",
  });
  const response = await f.routes.GET(request());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.customerHubDeliveries.length, 50);
  assert.equal(payload.customerHubDeliveries[0].id, "event-54");
  assert.equal(payload.customerHubDeliveries.at(-1).id, "event-05");
  for (const row of payload.customerHubDeliveries) {
    assert.deepEqual(Object.keys(row).sort(), ["attempts", "canRetry", "eventType", "id", "status", "updatedAt"]);
    assert.equal(row.canRetry, false);
  }
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|private@example|private-capability|private-email-hash|private-release|encrypted_payload|provider_id|first_attempt_at/);
  for (const key of ["settings", "counts", "failures", "appointmentCounts", "appointmentDeliveries", "photoRequestCounts", "photoRequestDeliveries"]) assert.deepEqual(payload[key], []);
});

test("admin retry availability uses the backend policy for claims, accepted messages, budgets and ambiguous attempts", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const recent = new Date(Date.now() - 60000).toISOString();
  const scenarios = [
    ["safe-old-stop", {}, true],
    ["pending", { status: "pending" }, false], ["sending", { status: "sending" }, false],
    ["accepted", { status: "accepted" }, false], ["provider-recorded", { provider_id: "provider-private" }, false],
    ["budget", { attempts: 4 }, false],
    ["ambiguous-old", { status: "unknown", encrypted_payload: "private-frozen-payload" }, false],
    ["ambiguous-recent", { status: "unknown", encrypted_payload: "private-frozen-payload", first_attempt_at: recent }, true],
    ["failed-recent", { status: "failed", encrypted_payload: "private-frozen-payload", first_attempt_at: recent }, true],
  ];
  for (const [id, overrides] of scenarios) f.seed(id, overrides);
  const { customerHubDeliveries } = await (await f.routes.GET(request())).json();
  for (const [id, , expected] of scenarios) assert.equal(customerHubDeliveries.find(row => row.id === id).canRetry, expected, id);
});

test("delivery reads and retries reject cross-origin, signed-out and non-admin requests before database access", async t => {
  for (const options of [{ originAllowed: false }, { role: "" }, { role: "support" }, { role: "reviewer" }]) {
    const f = fixture(options); t.after(() => f.sqlite.close());
    for (const [method, body] of [["GET", undefined], ["POST", { action: "retry_customer_hub_email", deliveryId: "event" }]]) {
      assert.equal((await f.routes[method](request(method, body))).status, options.role === "" ? 401 : 403);
    }
    assert.equal(f.calls.reads, 0); assert.deepEqual(f.calls.retries, []); assert.deepEqual(f.calls.audits, []);
  }
});

test("retry validates its action and identifier before invoking the delivery backend", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  for (const body of ["{invalid", { action: "retry_everything", deliveryId: "event" }, { action: "retry_customer_hub_email", deliveryId: " " }]) {
    assert.equal((await f.routes.POST(request("POST", body))).status, 400);
  }
  assert.deepEqual(f.calls.retries, []); assert.deepEqual(f.calls.audits, []);
});

test("retry returns and audits the actual bounded outcome rather than claiming every retry sent", async t => {
  for (const role of ["owner", "admin"]) for (const status of ["accepted", "stopped", "failed", "pending", "unknown"]) {
    const f = fixture({ role, outcome: { ok: true, status } }); t.after(() => f.sqlite.close()); f.seed("event");
    const response = await f.routes.POST(request("POST", { action: "retry_customer_hub_email", deliveryId: "event" }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.customerHubRetry, { id: "event", status });
    assert.equal(payload.customerHubDeliveries[0].status, status);
    assert.deepEqual(f.calls.retries, ["event"]);
    assert.equal(f.calls.audits[0][1], "customer_hub.email_retry");
    assert.deepEqual(f.calls.audits[0][5], { deliveryId: "event", result: status });
    assert.doesNotMatch(JSON.stringify(f.calls.audits), /PRIVATE|private@example|private-capability|provider_id|encrypted_payload/);
  }
});

test("missing or no-longer-retryable emails return accurate HTTP errors without a success audit", async t => {
  for (const [error, status] of [["DELIVERY_NOT_FOUND", 404], ["DELIVERY_NOT_RETRYABLE", 409]]) {
    const f = fixture({ outcome: { ok: false, error } }); t.after(() => f.sqlite.close());
    const response = await f.routes.POST(request("POST", { action: "retry_customer_hub_email", deliveryId: "event" }));
    assert.equal(response.status, status); assert.equal((await response.json()).ok, false);
    assert.deepEqual(f.calls.audits, []);
  }
});

test("existing appointment and photo request retry actions retain their existing backend paths", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  for (const action of ["retry_appointment_delivery", "retry_photo_request_delivery"]) assert.equal(
    (await f.routes.POST(request("POST", { action, deliveryId: "existing" }))).status, 200);
  assert.deepEqual(f.calls.existingRetries, [["appointment", "existing", "https://example.test"], ["photo", "existing", "https://example.test"]]);
  assert.deepEqual(f.calls.retries, []);
});

function renderHarness(initial, response) {
  const state = []; const statuses = []; const requests = []; let cursor = 0;
  const loadedUi = load("../src/components/AdminServiceReminderDelivery.tsx", {
    react: { useCallback: fn => fn, useEffect: () => {}, useState: value => {
      const index = cursor++; if (!(index in state)) state[index] = index === 0 ? initial : value;
      return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    } },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  });
  const render = () => { cursor = 0; return loadedUi.AdminServiceReminderDelivery({
    api: async (path, init) => { requests.push({ path, ...init }); return response; }, setStatus: value => statuses.push(value),
  }); };
  return { render, statuses, requests };
}
const nodes = (tree, predicate) => tree == null || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(item => nodes(item, predicate)) : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join(" ") : text(tree.props?.children);

test("admin UI exposes retries only for safe rows and describes provider acceptance without claiming inbox delivery", async () => {
  for (const status of ["accepted", "stopped", "failed", "pending", "unknown"]) {
    const deliveries = [{ id: "retryable", eventType: "asked", status: "stopped", attempts: 1, updatedAt: new Date().toISOString(), canRetry: true },
      { id: "claimed", eventType: "replied", status: "sending", attempts: 1, updatedAt: new Date().toISOString(), canRetry: false }];
    const h = renderHarness({ customerHubDeliveries: deliveries }, {
      customerHubDeliveries: [{ ...deliveries[0], status, canRetry: false }], customerHubRetry: { id: "retryable", status },
    });
    const buttons = nodes(h.render(), node => node.type === "button" && text(node) === "Recheck and retry email");
    assert.equal(buttons.length, 1);
    buttons[0].props.onClick();
    assert.equal(nodes(h.render(), node => node.type === "button" && text(node) === "Recheck and retry email")[0].props.disabled, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(JSON.parse(h.requests[0].body), { action: "retry_customer_hub_email", deliveryId: "retryable" });
    assert.match(h.statuses.at(-1), status === "accepted" ? /accepted by the email provider.*Inbox delivery is not confirmed/ : /Delivery is not confirmed/);
    assert.equal(nodes(h.render(), node => node.type === "button" && text(node) === "Recheck and retry email").length, 0);
  }
});
