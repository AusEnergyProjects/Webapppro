import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  handleTradeMapMaintenance,
  queueTradeMapMaintenance,
  TRADE_MAP_MAINTENANCE_HEADER,
  TRADE_MAP_MAINTENANCE_PATH,
} from "../src/lib/trade-map-maintenance.ts";

const SECRET = "test-monitor-secret-never-used-in-production";
const NOW = Date.parse("2026-10-01T05:00:00.000Z");
const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function signedRequest({ timestamp = NOW, secret = SECRET, purpose = "tlink-map-maintenance", method = "POST", body, query = "", headers = {} } = {}) {
  const signature = createHmac("sha256", secret).update(`${purpose}\n${timestamp}`).digest("base64url");
  return new Request(`https://example.test${TRADE_MAP_MAINTENANCE_PATH}${query}`, {
    method, body,
    headers: { "X-TLink-Maintenance-Timestamp": String(timestamp), "X-TLink-Maintenance-Signature": signature, ...headers },
  });
}

const handle = request => handleTradeMapMaintenance(request, { secret: SECRET, now: NOW });

test("fresh purpose-signed empty maintenance request is accepted without customer or queue data", async () => {
  const response = await handle(signedRequest());
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get(TRADE_MAP_MAINTENANCE_HEADER), "1");
  assert.deepEqual(await response.json(), { ok: true, accepted: true });
});

test("clock skew is bounded to two minutes in either direction", async () => {
  for (const offset of [-120_000, 120_000]) assert.equal((await handle(signedRequest({ timestamp: NOW + offset }))).status, 202);
  for (const offset of [-120_001, 120_001]) {
    const response = await handle(signedRequest({ timestamp: NOW + offset }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
  }
});

test("missing, malformed, wrong-secret and cross-purpose signatures cannot dispatch", async () => {
  const requests = [
    new Request(`https://example.test${TRADE_MAP_MAINTENANCE_PATH}`, { method: "POST" }),
    signedRequest({ secret: "another-secret-that-is-not-the-monitor-key" }),
    signedRequest({ purpose: "admin.notification" }),
    signedRequest({ purpose: "tlink-map-maintenance-other" }),
    signedRequest({ headers: { "X-TLink-Maintenance-Timestamp": "NaN" } }),
    signedRequest({ headers: { "X-TLink-Maintenance-Timestamp": String(NOW / 1000) } }),
    signedRequest({ headers: { "X-TLink-Maintenance-Signature": "x".repeat(44) } }),
    signedRequest({ headers: { "X-TLink-Maintenance-Signature": "/".repeat(43) } }),
    new Request(`https://example.test${TRADE_MAP_MAINTENANCE_PATH}`, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, [TRADE_MAP_MAINTENANCE_HEADER]: "1" } }),
  ];
  for (const request of requests) {
    const response = await handle(request);
    assert.equal(response.status, 401);
    assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
    assert.equal((await response.text()).includes(SECRET), false);
  }
});

test("unconfigured or short monitor secret cannot dispatch", async () => {
  for (const secret of [undefined, "", "short", 123]) {
    const response = await handleTradeMapMaintenance(signedRequest(), { secret, now: NOW });
    assert.equal(response.status, 503);
    assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
  }
});

test("only POST with no payload or owner query is accepted", async () => {
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
    const response = await handle(signedRequest({ method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
    assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
  }
  for (const options of [{ body: "{}" }, { body: " " }, { body: JSON.stringify({ ownerUid: "another-business" }) }, { query: "?ownerUid=another-business" }]) {
    const response = await handle(signedRequest(options));
    assert.equal(response.status, 400);
    assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
  }
});

test("authentication rejection occurs before reading a request body", async () => {
  let reads = 0;
  const request = new Request(`https://example.test${TRADE_MAP_MAINTENANCE_PATH}`, { method: "POST" });
  Object.defineProperty(request, "body", { get: () => { reads++; throw new Error("Body must not be touched"); } });
  assert.equal((await handle(request)).status, 401);
  assert.equal(reads, 0);
});

test("dispatch strips internal header, returns before work finishes and schedules exactly once", async () => {
  const request = signedRequest();
  const pending = [];
  let calls = 0, release;
  const operation = new Promise(resolve => { release = resolve; });
  const response = queueTradeMapMaintenance(request, await handle(request), {
    waitUntil: promise => pending.push(promise),
    drain: () => { calls++; return operation; },
    onError: () => assert.fail("Successful maintenance must not log a failure"),
  });
  assert.equal(calls, 0);
  assert.equal(pending.length, 1);
  assert.equal(response.status, 202);
  assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
  assert.deepEqual(await response.json(), { ok: true, accepted: true });
  assert.equal(calls, 1);
  release({ failed: 0 });
  await Promise.all(pending);
});

test("request header spoofing, error responses, other routes and other methods never trigger work", async () => {
  for (const [request, status, value] of [
    [signedRequest({ headers: { [TRADE_MAP_MAINTENANCE_HEADER]: "1" } }), 202, null],
    [signedRequest(), 401, "1"],
    [signedRequest(), 200, "1"],
    [signedRequest(), 202, "other"],
    [signedRequest({ method: "GET" }), 202, "1"],
    [new Request("https://example.test/api/other", { method: "POST" }), 202, "1"],
  ]) {
    const response = queueTradeMapMaintenance(request, Response.json({}, { status, headers: value ? { [TRADE_MAP_MAINTENANCE_HEADER]: value } : {} }), {
      waitUntil: () => assert.fail("Unauthenticated response cannot dispatch"),
      drain: () => assert.fail("Unauthenticated response cannot access the database"),
      onError: () => assert.fail("No operation should have started"),
    });
    assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
  }
});

test("rejected and returned failure outcomes are observable without passing private errors into the logger", async () => {
  for (const drain of [async () => ({ failed: 1 }), async () => { throw new Error("private customer detail"); }]) {
    const pending = [], errors = [];
    const request = signedRequest();
    queueTradeMapMaintenance(request, await handle(request), {
      waitUntil: promise => pending.push(promise), drain, onError: (...args) => errors.push(args),
    });
    await Promise.all(pending);
    assert.deepEqual(errors, [[]]);
  }
});

test("route uses the existing runtime monitor secret and exports only a POST handler", async () => {
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "process", transpile(read("../src/app/api/internal/trade-map-maintenance/route.ts")))(
    name => { assert.equal(name, "@/lib/trade-map-maintenance"); return { handleTradeMapMaintenance }; },
    moduleRecord, moduleRecord.exports, { env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: SECRET } },
  );
  assert.equal(typeof moduleRecord.exports.POST, "function");
  for (const method of ["GET", "PUT", "DELETE"]) assert.equal(moduleRecord.exports[method], undefined);
  assert.equal((await moduleRecord.exports.POST(signedRequest({ timestamp: Date.now() }))).status, 202);
});

test("worker maintenance hook installs guards then drains one batch, with no database access before authorization", async () => {
  const source = ts.createSourceFile("worker.ts", read("../worker/index.ts"), ts.ScriptTarget.Latest, true);
  const hook = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "queueBackgroundDispatches");
  assert.ok(hook);
  const calls = [], pending = [], logs = [], db = {};
  const pass = response => response;
  const dependencies = {
    shouldDrainOpportunityNotificationBacklog: () => false,
    shouldDrainPublicPlanDeliveryBacklog: () => false,
    shouldDrainPublicPlanQuotePhotoCleanup: () => false,
    queueAccountingDispatch: pass, queueTradeMapPreparation: pass, queueTradeMapMaintenance,
    queueTradeQuoteDeliveryDispatch: pass, queuePublicPlanDeliveryDispatch: pass,
    queueCreditexProductRegistryDispatch: pass, queueCustomerProjectActivityDispatch: pass,
    queueOpportunityNotificationDispatch: pass, queueCustomerOpportunityDispatch: pass,
    getD1: () => { calls.push("database"); return db; },
    ensureTlinkSchemaGuards: async database => { assert.equal(database, db); calls.push("guards"); },
    getGnafDirectory: () => assert.fail("Worker passes directory resolver to bounded queue"),
    drainTradeMapPreparation: async options => {
      calls.push("drain"); assert.equal(options.db, db); assert.equal(options.maxBatches, 1);
      assert.equal(options.ownerUid, undefined); assert.equal(options.getDirectory, dependencies.getGnafDirectory);
      return { processed: 25, completed: 0, failed: 0 };
    },
    console: { info: (...args) => logs.push(args), error: () => assert.fail("No failure expected") },
  };
  const run = new Function("exports", ...Object.keys(dependencies), `${transpile(hook.getText())}; return queueBackgroundDispatches;`)({}, ...Object.values(dependencies));
  const denied = new Request(`https://example.test${TRADE_MAP_MAINTENANCE_PATH}`, { method: "POST", headers: { [TRADE_MAP_MAINTENANCE_HEADER]: "1" } });
  run(await handle(denied), { waitUntil: promise => pending.push(promise) }, denied, {});
  assert.deepEqual(calls, []);
  assert.equal(pending.length, 0);
  const request = signedRequest();
  const response = run(await handle(request), { waitUntil: promise => pending.push(promise) }, request, {});
  assert.equal(response.status, 202);
  assert.equal(response.headers.has(TRADE_MAP_MAINTENANCE_HEADER), false);
  assert.deepEqual(calls, []);
  await Promise.all(pending);
  assert.deepEqual(calls, ["database", "guards", "drain"]);
  assert.deepEqual(logs, [["Automatic map maintenance completed.", { processed: 25, completed: 0, failed: 0 }]]);
});
