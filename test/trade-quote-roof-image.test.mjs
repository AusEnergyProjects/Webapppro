import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { deflateSync, crc32 } from "node:zlib";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import * as roofImages from "../src/lib/trade-quote-roof-image.ts";
import * as quoteMath from "../src/lib/trade-quote.ts";
import * as quoteOptions from "../src/lib/trade-quote-options.ts";
import { createTradeQuotePdfBytes } from "../src/lib/trade-quote-pdf.mjs";
import { canonicalGoogleBusinessProfileUrl } from "../src/lib/trade-google-business-profile.mjs";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=", "base64"));
const upload = { dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}` };
const reference = { objectKey: "trade-quote-roofs/owner/job/version/1234.png", contentType: "image/png", width: 1, height: 1, sizeBytes: png.length, sha256: "a".repeat(64) };
const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function compile(path, dependencies) {
  const compiled = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  Function("require", "exports", compiled)(id => dependencies[id] || {}, exports);
  return exports;
}

test("roof upload accepts PNG bytes only and bounds bytes, dimensions and caller-supplied references", () => {
  assert.deepEqual(roofImages.decodeQuoteRoofImage(upload), { bytes: png, width: 1, height: 1 });
  for (const value of [reference, { dataUrl: upload.dataUrl, objectKey: reference.objectKey }, { dataUrl: "data:image/svg+xml;base64,AAAA" }, { dataUrl: "data:image/png;base64,AAAA" }, { dataUrl: "data:image/png;base64," + "a".repeat(5_333_337) }]) {
    assert.throws(() => roofImages.decodeQuoteRoofImage(value), /QUOTE_ROOF_IMAGE_INVALID/);
  }
  const enormous = new Uint8Array(png);
  new DataView(enormous.buffer).setUint32(16, 4097);
  assert.throws(() => roofImages.quoteRoofImageDimensions(enormous), /QUOTE_ROOF_IMAGE_INVALID/);
  assert.throws(() => roofImages.parseQuoteRoofImage({ ...reference, objectKey: "other-business/private.png" }), /QUOTE_ROOF_IMAGE_INVALID/);
  assert.throws(() => roofImages.assertQuoteRoofImageScope(reference, "other-owner", "job"), /QUOTE_ROOF_IMAGE_INVALID/);
  assert.throws(() => roofImages.assertQuoteRoofImageScope(reference, "owner", "other-job"), /QUOTE_ROOF_IMAGE_INVALID/);
});

test("a realistic multi-megabyte PNG decodes without a regexp stack overflow", () => {
  const width = 1200, height = 900;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  let seed = 1987;
  for (let y = 0; y < height; y++) for (let x = 1; x <= width * 3; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[y * (width * 3 + 1) + x] = seed >>> 24;
  }
  const chunk = (kind, data) => {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); result.write(kind, 4); data.copy(result, 8);
    result.writeUInt32BE(crc32(result.subarray(4, data.length + 8)), data.length + 8);
    return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const large = Buffer.concat([Buffer.from(png.subarray(0, 8)), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
  assert.ok(large.length > 3_000_000 && large.length < 4_000_000);
  const decoded = roofImages.decodeQuoteRoofImage({ dataUrl: `data:image/png;base64,${large.toString("base64")}` });
  assert.equal(decoded.width, width); assert.equal(decoded.height, height); assert.equal(decoded.bytes.length, large.length);
});

test("private roof storage verifies full PNG, saves an immutable identity and rejects changed or missing bytes", async () => {
  const objects = new Map(), writes = [];
  const bucket = {
    async put(key, bytes, options) { writes.push({ key, options }); objects.set(key, new Uint8Array(bytes)); },
    async get(key) { const bytes = objects.get(key); return bytes ? { size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer } : null; },
    async delete(key) { objects.delete(key); },
  };
  const store = compile("../src/lib/trade-quote-roof-image-server.ts", { "cloudflare:workers": { env: { EVIDENCE: bucket } }, "pdf-lib": { PDFDocument }, "./trade-quote-roof-image": roofImages });
  const saved = await store.storeQuoteRoofImage({ ownerUid: "owner", workOrderId: "job", versionId: "version", upload });
  assert.match(saved.objectKey, /^trade-quote-roofs\/owner\/job\/version\/[a-f0-9-]+\.png$/);
  assert.equal(writes[0].options.httpMetadata.contentType, "image/png");
  assert.deepEqual((await store.loadQuoteRoofImage(saved)).bytes, png);
  const second = await store.storeQuoteRoofImage({ ownerUid: "owner", workOrderId: "job", versionId: "version", upload });
  assert.notEqual(saved.objectKey, second.objectKey);
  objects.get(saved.objectKey)[40] ^= 1;
  await assert.rejects(store.loadQuoteRoofImage(saved), /QUOTE_ROOF_IMAGE_UNAVAILABLE/);
  await store.deleteUnclaimedQuoteRoofImage(second);
  await assert.rejects(store.loadQuoteRoofImage(second), /QUOTE_ROOF_IMAGE_UNAVAILABLE/);
  const broken = new Uint8Array(png.slice(0, 45));
  await assert.rejects(store.storeQuoteRoofImage({ ownerUid: "owner", workOrderId: "job", versionId: "version", upload: { dataUrl: `data:image/png;base64,${Buffer.from(broken).toString("base64")}` } }), /QUOTE_ROOF_IMAGE_INVALID/);
  assert.equal(writes.length, 2);
});

function routeFixture({ owned = true, assigned = true, permitted = true, priorRoof = reference, claim = true } = {}) {
  const queries = [], stored = [], discarded = [], loaded = [];
  const quote = { id: "quote", work_order_id: "job", current_version_number: 1, quote_number: "Q-1" };
  const version = { id: "version", quote_id: "quote", version_number: 1, status: "draft", updated_at: "original", roof_image_json: priorRoof ? JSON.stringify(priorRoof) : "" };
  const access = { ownerUid: "owner", actorUid: "staff", canViewQuotes: permitted, canManageQuotes: permitted, canApplyDiscounts: true, canViewPriceBook: true, isOwner: false };
  const db = {
    prepare(sql) { return { bind(...values) { const statement = { sql, values }; queries.push(statement); return { ...statement,
      async first() {
        if (sql.includes("FROM trade_work_orders w")) return owned ? { id: "job", crm_customer_id: "customer", work_number: "JOB-1" } : null;
        if (sql.includes("SELECT version.roof_image_json")) return values[0] === "version" && values[1] === "owner" && values[2] === "job" ? version : null;
        if (sql.includes("FROM trade_crm_quotes")) return quote;
        if (sql.includes("SELECT * FROM trade_crm_quote_versions")) return version;
        if (sql.includes("SELECT status FROM trade_crm_quote_versions")) return { status: "draft" };
        return null;
      },
      async all() { return { results: sql.includes("SELECT * FROM trade_crm_quote_versions") ? [version] : [] }; },
    }; } }; },
    async batch(statements) {
      const roof = statements.find(statement => statement.sql.includes("SET roof_image_json"));
      if (claim && roof) version.roof_image_json = roof.values[0];
      return statements.map(() => ({ meta: { changes: claim ? 1 : 0 } }));
    },
  };
  const route = compile("../src/app/api/trade-quotes/route.ts", {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { sameOrigin: () => true, cleanAdminText: value => String(value ?? "").trim(), adminJson: (body, status = 200) => Response.json(body, { status }), mfaErrorResponse: () => null },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access, canViewQuotes: value => value.canViewQuotes, canManageQuotes: value => value.canManageQuotes, assignedJob: async () => { if (!assigned) throw new Error("JOB_NOT_FOUND"); } },
    "@/lib/trade-quote-roof-image": roofImages,
    "@/lib/trade-quote-roof-image-server": { storeQuoteRoofImage: async input => { stored.push(input); return { ...reference, objectKey: reference.objectKey.replace("1234.png", "5678.png") }; }, loadQuoteRoofImage: async image => { loaded.push(image); return { bytes: png, contentType: "image/png" }; }, deleteUnclaimedQuoteRoofImage: async image => discarded.push(image) },
    "@/lib/trade-quote": quoteMath, "@/lib/trade-quote-options": quoteOptions,
    "@/lib/trade-job-packet-server": { resolveJobPacketQuoteLines: async (_owner, lines) => ({ lines, references: [] }) },
    "@/lib/trade-price-book-server": { resolvePriceBookQuoteLines: async (_owner, lines) => ({ lines, references: [] }) },
    "@/lib/trade-discount-permissions": { quoteInputDiscountMagnitude: () => 0 },
  });
  return { route, queries, stored, discarded, loaded, version };
}

test("roof media requires quote permission, assigned owned job and its exact version", async () => {
  for (const options of [{ owned: false }, { assigned: false }, { permitted: false }]) {
    const h = routeFixture(options);
    const response = await h.route.GET(new Request("https://tlink.test/api/trade-quotes?workOrderId=job&media=roof&versionId=version"));
    assert.ok([403, 404].includes(response.status)); assert.equal(h.loaded.length, 0);
  }
  const h = routeFixture();
  const foreign = await h.route.GET(new Request("https://tlink.test/api/trade-quotes?workOrderId=job&media=roof&versionId=other-version"));
  assert.equal(foreign.status, 404); assert.equal(h.loaded.length, 0);
  const response = await h.route.GET(new Request("https://tlink.test/api/trade-quotes?workOrderId=job&media=roof&versionId=version"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  const corruptReference = routeFixture({ priorRoof: { ...reference, objectKey: reference.objectKey.replace("/owner/", "/another-owner/") } });
  const leaked = await corruptReference.route.GET(new Request("https://tlink.test/api/trade-quotes?workOrderId=job&media=roof&versionId=version"));
  assert.equal(leaked.status, 400); assert.equal(corruptReference.loaded.length, 0);
});

test("saving a quote preserves, replaces or explicitly removes the persisted roof without accepting references", async () => {
  for (const [patch, expected, uploadCount] of [[{}, reference.objectKey, 0], [{ roofImage: null }, null, 0], [{ roofImage: upload }, reference.objectKey.replace("1234.png", "5678.png"), 1]]) {
    const h = routeFixture();
    const response = await h.route.POST(new Request("https://tlink.test/api/trade-quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_draft", workOrderId: "job", lines: [{ lineType: "product", description: "Panels", quantity: "10", unitPrice: "200", taxCode: "gst" }], ...patch }) }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(h.stored.length, uploadCount);
    assert.equal(roofImages.parseQuoteRoofImage(h.version.roof_image_json)?.objectKey ?? null, expected);
    assert.equal(body.quote.versions[0].roofImage?.width ?? null, expected ? 1 : null);
    assert.equal(JSON.stringify(body).includes("trade-quote-roofs/"), false);
  }
});

test("PDF includes the complete roof image and fails closed instead of issuing without it", async () => {
  const snapshot = { schemaVersion: "trade-quote-document-v2", quoteNumber: "Q-1", versionNumber: 1,
    business: { name: "Test Business" }, work: { number: "JOB-1", title: "Roof" }, customer: { name: "Customer" }, site: { summary: "1 Test Street" },
    roofImage: reference, items: [], choices: [], subtotalCents: 0, taxCents: 0, totalCents: 0 };
  await assert.rejects(createTradeQuotePdfBytes(snapshot), /QUOTE_ROOF_IMAGE_UNAVAILABLE/);
  const document = await PDFDocument.load(await createTradeQuotePdfBytes(snapshot, {}, { roof: { bytes: png, contentType: "image/png" } }));
  const imageCount = document.getPages().reduce((count, page) => {
    const images = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    return count + (images?.entries().length || 0);
  }, 0);
  assert.equal(imageCount, 1);
});

test("customer links use their immutable roof snapshot and reject another business or job's image", async () => {
  const review = compile("../src/lib/trade-quote-review-server.ts", {
    "../../db": { getD1: () => { throw new Error("Issued snapshot must not read a mutable draft"); } },
    "./trade-google-business-profile.mjs": { canonicalGoogleBusinessProfileUrl }, "./trade-quote-roof-image": roofImages,
  });
  const snapshot = { schemaVersion: "trade-quote-document-v2", quoteId: "quote", quoteVersionId: "version", quoteNumber: "Q-1", versionNumber: 1,
    business: { name: "Test Business", bannerCrop: { xBasisPoints: 0, yBasisPoints: 0, widthBasisPoints: 10000, heightBasisPoints: 10000 } },
    work: { id: "job" }, customer: { id: "customer" }, site: {}, roofImage: reference, items: [], choices: [] };
  const link = { quote_id: "quote", quote_version_id: "version", work_order_id: "job", crm_customer_id: "customer", firebase_uid: "owner", document_snapshot_json: JSON.stringify(snapshot) };
  assert.deepEqual((await review.quoteDocumentSnapshotForAuthorisedLink(link)).roofImage, reference);
  for (const objectKey of [reference.objectKey.replace("/owner/", "/foreign-owner/"), reference.objectKey.replace("/job/", "/foreign-job/")]) {
    await assert.rejects(review.quoteDocumentSnapshotForAuthorisedLink({ ...link, document_snapshot_json: JSON.stringify({ ...snapshot, roofImage: { ...reference, objectKey } }) }), /QUOTE_(?:ROOF_IMAGE_INVALID|DOCUMENT_SNAPSHOT_INVALID)/);
  }
  const legacy = { ...snapshot }; delete legacy.roofImage;
  assert.equal((await review.quoteDocumentSnapshotForAuthorisedLink({ ...link, document_snapshot_json: JSON.stringify(legacy) })).roofImage, undefined);
});

test("a lost draft claim does not replace the old image and discards only its new private upload", async () => {
  const h = routeFixture({ claim: false });
  const response = await h.route.POST(new Request("https://tlink.test/api/trade-quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_draft", workOrderId: "job", lines: [{ lineType: "product", description: "Panels", quantity: "10", unitPrice: "200", taxCode: "gst" }], roofImage: upload }) }));
  assert.equal(response.status, 409);
  assert.equal(h.discarded.length, 1);
  assert.notEqual(h.discarded[0].objectKey, reference.objectKey);
  assert.equal(roofImages.parseQuoteRoofImage(h.version.roof_image_json).objectKey, reference.objectKey);
});
