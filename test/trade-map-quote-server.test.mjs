import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as mapQuote from "../src/lib/trade-map-quote.ts";
import * as quoteMath from "../src/lib/trade-quote.ts";

const source = fs.readFileSync(new URL("../src/app/api/trade-quotes/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(`${source}\nexport { resolveLineGroup };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ canView = true, assigned = true, foreignJob = false, unitLabel = "m²" } = {}) {
  const queries = [], logos = [], exports = {};
  const access = { ownerUid: "business-owner", actorUid: "team-member", canViewQuotes: canView, canManageQuotes: true, isOwner: false };
  const database = { prepare(sql) { return { bind(...values) { queries.push({ sql, values }); return {
    async first() {
      if (sql.includes("FROM trade_work_orders w")) return foreignJob ? null : { id: "job-1", source_type: "direct", crm_customer_id: "customer-1" };
      if (sql.includes("FROM trade_accounts")) return { business_name: "Owner Business", logo_object_key: "trade-branding/business-owner/logo/one", logo_content_type: "image/png" };
      throw new Error("Unexpected test query");
    }, async all() { return { results: [] }; },
  }; } }; } };
  const dependencies = {
    "../../../../db": { getD1: () => database },
    "@/lib/admin-server": { sameOrigin: () => true, cleanAdminText: value => String(value || "").trim(), adminJson: (body, status = 200) => Response.json(body, { status }), mfaErrorResponse: () => null },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access, canViewQuotes: value => value.canViewQuotes, assignedJob: async (value, id) => { assert.equal(value.ownerUid, "business-owner"); assert.equal(id, "job-1"); if (!assigned) throw new Error("JOB_NOT_FOUND"); } },
    "@/lib/trade-quote-pdf-server": { loadBrandAsset: async asset => { logos.push(asset); return { contentType: asset.contentType, bytes: new Uint8Array([1, 2, 3]) }; } },
    "@/lib/trade-map-quote": mapQuote,
    "@/lib/trade-quote": quoteMath,
    "@/lib/trade-job-packet-server": { resolveJobPacketQuoteLines: async (_owner, lines) => ({ lines, references: [] }) },
    "@/lib/trade-price-book-server": { resolvePriceBookQuoteLines: async (_owner, lines) => ({ lines, references: lines.map(line => line.priceBookItemId ? { unitLabel } : null) }) },
  };
  Function("require", "exports", compiled)(id => dependencies[id] || {}, exports);
  return { route: exports, queries, logos };
}

test("quote preview logo is resolved through the selected job's business owner for staff", async () => {
  const h = fixture();
  const response = await h.route.GET(new Request("https://tlink.test/api/trade-quotes?workOrderId=job-1&media=logo"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(h.queries.find(query => query.sql.includes("FROM trade_accounts")).values[0], "business-owner");
  assert.equal(h.logos[0].objectKey, "trade-branding/business-owner/logo/one");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test("quote logo cannot bypass quote permissions, job assignment or tenant ownership", async () => {
  for (const options of [{ canView: false }, { assigned: false }, { foreignJob: true }]) {
    const h = fixture(options);
    const response = await h.route.GET(new Request("https://tlink.test/api/trade-quotes?workOrderId=job-1&media=logo"));
    assert.ok([403, 404].includes(response.status), String(response.status));
    assert.equal(h.logos.length, 0);
  }
});

test("quote save checks the current saved item's unit before applying map quantities", async () => {
  const line = { ...mapQuote.mapQuoteLine({ kind: "area", quantity: 162.5 }), priceBookItemId: "item-1", unitPrice: "20.00" };
  const matching = await fixture().route.resolveLineGroup("business-owner", [line]);
  assert.equal(matching.calculated.totalCents, 357500);
  await assert.rejects(fixture({ unitLabel: "pack" }).route.resolveLineGroup("business-owner", [line]), /MAP_QUOTE_UNIT_MISMATCH/);
  const ordinary = await fixture({ unitLabel: "pack" }).route.resolveLineGroup("business-owner", [{ ...line, sectionHeading: "Included work" }]);
  assert.equal(ordinary.calculated.totalCents, 357500);
});
