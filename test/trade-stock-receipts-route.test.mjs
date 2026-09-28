import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as bounds from "../src/lib/bounded-request-body.mjs";
import * as contract from "../src/lib/trade-stock-receipts.ts";
const code = ts.transpileModule(fs.readFileSync(new URL("../src/app/api/trade-stock/receipts/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  let allowed = true, calls = 0;
  class TradeAccessError extends Error { status = 403; }
  const access = { ownerUid: "owner", actorUid: "staff" }, exports = {};
  const dependencies = { "@/lib/admin-server": { sameOrigin: request => request.headers.get("origin") !== "https://foreign.test", adminJson: (body, status = 200) => Response.json(body, { status }), mfaErrorResponse: () => null },
    "@/lib/trade-access-server": { TradeAccessError }, "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access },
    "@/lib/trade-stock-server": { requireStockAccess: () => { if (!allowed) throw new Error("STOCK_ACCESS_REQUIRED"); } },
    "@/lib/trade-stock-receipts": contract, "@/lib/bounded-request-body.mjs": bounds,
    "@/lib/trade-stock-receipts-server": {
      stockReceiptWorkspace: async (owner, id) => { calls++; assert.equal(owner, "owner"); return { receipt: { id } }; },
      readStockReceipt: async owner => { calls++; assert.equal(owner, "owner"); return { fileName: "Invoice with spaces.pdf", bytes: new ArrayBuffer(0) }; },
      uploadStockReceipt: async (owner, actor) => { calls++; assert.equal(owner, "owner"); assert.equal(actor, "staff"); return {}; },
      receiveStockReceipt: async (owner, actor) => { calls++; assert.equal(owner, "owner"); assert.equal(actor, "staff"); },
    } };
  Function("require", "exports", code)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, exports);
  return { route: exports, calls: () => calls, deny: () => { allowed = false; } };
}

test("stock receipt permissions and origin checks precede every document operation", async () => {
  const f = harness(); f.deny();
  assert.equal((await f.route.GET(new Request("https://tlink.test/api/trade-stock/receipts"))).status, 403);
  assert.equal((await f.route.POST(new Request("https://tlink.test/api/trade-stock/receipts", { method: "POST", body: "{}" }))).status, 403);
  assert.equal(f.calls(), 0);
  const second = harness();
  assert.equal((await second.route.GET(new Request("https://tlink.test/api/trade-stock/receipts", { headers: { origin: "https://foreign.test" } }))).status, 403);
  assert.equal(second.calls(), 0);
});

test("actual request bytes are bounded even with no content-length header", async () => {
  const f = harness();
  const response = await f.route.POST(new Request("https://tlink.test/api/trade-stock/receipts", { method: "POST", body: JSON.stringify({ data: "x".repeat(100_001) }) }));
  assert.equal(response.status, 413); assert.equal(f.calls(), 0);
  assert.equal((await f.route.POST(new Request("https://tlink.test/api/trade-stock/receipts", { method: "POST", body: "{" }))).status, 400);
  assert.equal(f.calls(), 0);
});

test("download is private and sandboxed with an encoded document filename", async () => {
  const f = harness(), response = await f.route.GET(new Request("https://tlink.test/api/trade-stock/receipts?receiptId=receipt&download=1"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.match(response.headers.get("content-disposition"), /Invoice%20with%20spaces.pdf/);
  assert.equal(f.calls(), 1);
});
