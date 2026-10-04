import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { transformSync } from "esbuild";
import { Miniflare } from "miniflare";
import * as localities from "../src/lib/address-localities.mjs";
import * as contract from "../src/lib/council-profile.ts";
import * as boundedBody from "../src/lib/bounded-request-body.mjs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const compiled = transformSync(read(path), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}
const server = load("../src/lib/council-profile-server.ts", { "./address-localities.mjs": localities, "./council-profile": contract });

function png(width = 1, height = 1) {
  const chunk = (name, data) => {
    const type = Buffer.from(name); const content = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length, 0); content.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) randomBytes(width * 4).copy(scanlines, row * (width * 4 + 1) + 1);
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}
const valid = () => ({ name: "Council community", postcodes: ["3175", "3805"], logoDataUrl: null, theme: { primaryColor: "#032733", accentColor: "#0B765D" } });
const request = (method = "GET", body, { councilId = "owned", origin = "https://example.test", contentType = "application/json" } = {}) => new Request(`https://example.test/api/council/profile?councilId=${councilId}`, {
  method, headers: { ...(origin === null ? {} : { Origin: origin }), ...(method === "GET" ? {} : { "Content-Type": contentType }) },
  ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});

test("profile contract rejects unknown fields, invalid colours, duplicate/out-of-state postcodes and disguised raster uploads", () => {
  assert.deepEqual(contract.parseCouncilProfileInput({ ...valid(), name: " Council community " }, "VIC"), { ...valid(), theme: contract.COUNCIL_DEFAULT_THEME });
  for (const change of [
    { state: "NSW" }, { councilId: "other" }, { role: "owner" }, { name: "x" }, { name: "x".repeat(121) }, { name: "Council\nInjected" },
    { postcodes: [] }, { postcodes: Array.from({ length: 101 }, (_, index) => String(3000 + index)) }, { postcodes: ["3175", "3175"] },
    { postcodes: ["2000"] }, { postcodes: ["3175x"] }, { postcodes: [3175] },
    { theme: { ...valid().theme, accentColor: "red" } }, { theme: { ...valid().theme, image: "url(https://hostile.test)" } },
    { logoDataUrl: "https://example.test/logo.png" }, { logoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
    { logoDataUrl: "data:image/png;base64,PHN2Zy8+" }, { logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
    { logoDataUrl: `data:image/jpeg;base64,${png().split(",")[1]}` },
    { logoDataUrl: `data:image/png;base64,${Buffer.alloc(256 * 1024 + 1).toString("base64")}` },
  ]) assert.throws(() => contract.parseCouncilProfileInput({ ...valid(), ...change }, "VIC"), contract.CouncilProfileInputError);
  const image = png();
  const parsed = contract.parseCouncilProfileInput({ ...valid(), logoDataUrl: image }, "VIC");
  assert.equal(parsed.logoDataUrl, image); assert.deepEqual(contract.parseCouncilProfileInput(parsed, "VIC"), parsed);
});

test("profile auth, atomic writes and branding execute against actual Cloudflare D1", async t => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2025-04-01", d1Databases: { DB: "council-profile-regression" }, port: 0 });
  try {
    const db = await runtime.getD1Database("DB");
    await db.prepare("CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY)").run();
    await db.prepare("CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,admin_uid TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,summary TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL)").run();
    for (const file of ["0250_council_workspace.sql", "0251_council_profile.sql"]) {
      for (const statement of read(`../drizzle/${file}`).split("--> statement-breakpoint")) if (statement.trim()) await db.prepare(statement).run();
    }
    let identity;
    let beforeBatch;
    const wrapped = { prepare: sql => db.prepare(sql), batch: async statements => {
      if (beforeBatch) { const effect = beforeBatch; beforeBatch = undefined; await effect(); }
      return db.batch(statements);
    } };
    const access = load("../src/lib/council-access-server.ts", {
      "../../db": { getD1: () => wrapped }, "./firebase-server": { requireFirebaseIdentity: async () => { if (!identity) throw new Error("AUTH_REQUIRED"); return identity; } },
    });
    const route = load("../src/app/api/council/profile/route.ts", {
      "@/lib/council-access-server": access, "@/lib/council-profile": contract, "@/lib/council-profile-server": server,
      "@/lib/bounded-request-body.mjs": boundedBody,
    });
    const reset = async () => {
      beforeBatch = undefined; identity = { uid: "member-uid", email: "member@example.test", emailVerified: true };
      await db.batch(["council_postcodes", "council_memberships", "council_organisations", "admin_audit_log"].map(table => db.prepare(`DELETE FROM ${table}`)));
      await db.batch([
        db.prepare("INSERT INTO council_organisations(id,name,slug,state,status,created_at,updated_at) VALUES ('owned','Original council','original-council','VIC','active','2026-09-23','2026-09-23'),('other','Other council','other-council','VIC','active','2026-09-23','2026-09-23')"),
        db.prepare("INSERT INTO council_postcodes VALUES ('owned','VIC','3175','admin','2026-09-23'),('other','VIC','3805','admin','2026-09-23')"),
        db.prepare("INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,status,invited_by_uid,created_at,updated_at) VALUES ('member','owned','member-uid','member@example.test','editor','active','admin','2026-09-23','2026-09-23')"),
      ]);
    };
    const auditCount = async () => (await db.prepare("SELECT COUNT(*) n FROM admin_audit_log").first()).n;

    await t.test("GET shows persistent defaults; editor saves name, scope, logo over16KiB and theme atomically", async () => {
      await reset();
      const before = await route.GET(request()); assert.equal(before.status, 200);
      assert.equal(before.headers.get("Cache-Control"), "private, no-store"); assert.equal(before.headers.get("Vary"), "Authorization");
      const original = (await before.json()).profile;
      assert.deepEqual(original.theme, contract.COUNCIL_DEFAULT_THEME); assert.equal(original.logoDataUrl, null); assert.deepEqual(original.postcodes, ["3175"]);
      const logoDataUrl = png(128, 128); assert.ok(logoDataUrl.length > 16384);
      const body = { ...valid(), logoDataUrl, theme: { primaryColor: "#123456", accentColor: "#ABCDEF" } };
      const saved = await route.PATCH(request("PATCH", body)); assert.equal(saved.status, 200, await saved.clone().text());
      const result = (await saved.json()).profile;
      assert.deepEqual(result, { councilId: "owned", name: body.name, state: "VIC", postcodes: ["3175", "3805"], logoDataUrl, theme: { primaryColor: "#123456", accentColor: "#abcdef" }, updatedAt: result.updatedAt });
      assert.deepEqual((await (await route.GET(request())).json()).profile, result);
      const audit = await db.prepare("SELECT * FROM admin_audit_log").first(); const metadata = JSON.parse(audit.metadata);
      assert.equal(audit.admin_uid, "member-uid"); assert.equal(audit.entity_id, "owned"); assert.deepEqual(metadata.before.postcodes, ["3175"]);
      assert.equal(metadata.after.logoPresent, true); assert.match(metadata.after.logoSha256, /^[a-f0-9]{64}$/);
      assert.ok(audit.metadata.length < 4000); assert.equal(audit.metadata.includes("base64"), false);
      const other = await db.prepare("SELECT name,logo_data_url FROM council_organisations WHERE id='other'").first();
      assert.equal(other.name, "Other council"); assert.equal(other.logo_data_url, null);
      assert.equal((await route.PATCH(request("PATCH", valid()))).status, 200);
      assert.equal((await (await route.GET(request())).json()).profile.logoDataUrl, null);
    });

    await t.test("only authenticated verified active council membership reads; viewer cannot edit", async () => {
      await reset(); identity = null; assert.equal((await route.GET(request())).status, 401);
      identity = { uid: "member-uid", email: "member@example.test", emailVerified: false }; assert.equal((await route.GET(request())).status, 403);
      identity.emailVerified = true; assert.equal((await route.GET(request("GET", undefined, { councilId: "other" }))).status, 403);
      await db.prepare("UPDATE council_memberships SET role='viewer'").run();
      assert.equal((await route.GET(request())).status, 200); assert.equal((await route.PATCH(request("PATCH", valid()))).status, 403);
      await db.prepare("UPDATE council_memberships SET status='suspended'").run(); assert.equal((await route.GET(request())).status, 403);
      assert.equal(await auditCount(), 0);
    });

    await t.test("strict origin, content type, byte bound, geography and unknown fields fail before mutation", async () => {
      await reset();
      for (const origin of [null, "https://hostile.test"]) assert.equal((await route.PATCH(request("PATCH", valid(), { origin }))).status, 403);
      assert.equal((await route.PATCH(request("PATCH", valid(), { contentType: "text/plain" }))).status, 415);
      assert.equal((await route.PATCH(request("PATCH", "{"))).status, 400);
      assert.equal((await route.PATCH(request("PATCH", " ".repeat(contract.COUNCIL_PROFILE_MAX_BODY_BYTES + 1)))).status, 413);
      for (const change of [{ councilId: "other" }, { state: "NSW" }, { postcodes: ["2000"] }, { postcodes: ["3001"] }, { postcodes: ["3998"] }]) {
        assert.equal((await route.PATCH(request("PATCH", { ...valid(), ...change }))).status, 400);
      }
      const profile = (await (await route.GET(request())).json()).profile;
      assert.equal(profile.name, "Original council"); assert.deepEqual(profile.postcodes, ["3175"]); assert.equal(await auditCount(), 0);
    });

    await t.test("membership revocation or role downgrade between authorisation and batch cannot change profile or scope", async () => {
      for (const sql of ["UPDATE council_memberships SET status='suspended'", "UPDATE council_memberships SET role='viewer'", "UPDATE council_organisations SET status='suspended' WHERE id='owned'"]) {
        await reset(); beforeBatch = () => db.prepare(sql).run();
        const response = await route.PATCH(request("PATCH", valid())); assert.equal(response.status, 403, await response.clone().text());
        assert.equal((await db.prepare("SELECT name FROM council_organisations WHERE id='owned'").first()).name, "Original council");
        assert.deepEqual((await db.prepare("SELECT postcode FROM council_postcodes WHERE council_id='owned'").all()).results.map(row => row.postcode), ["3175"]);
        assert.equal(await auditCount(), 0);
      }
    });

    await t.test("a scope-write failure rolls back branding, postcode deletion and its audit together", async () => {
      await reset();
      await db.prepare("CREATE TRIGGER reject_test_scope BEFORE INSERT ON council_postcodes WHEN NEW.postcode='3805' BEGIN SELECT RAISE(ABORT,'test scope failure'); END").run();
      try {
        assert.equal((await route.PATCH(request("PATCH", { ...valid(), logoDataUrl: png() }))).status, 503);
        const profile = (await (await route.GET(request())).json()).profile;
        assert.equal(profile.name, "Original council"); assert.equal(profile.logoDataUrl, null); assert.deepEqual(profile.postcodes, ["3175"]);
        assert.equal(await auditCount(), 0);
      } finally { await db.prepare("DROP TRIGGER reject_test_scope").run(); }
    });

    await t.test("one hundred real postcodes save under D1 binding limits with one bounded audit record", async () => {
      await reset();
      const postcodes = Array.from({ length: 1000 }, (_, index) => String(3000 + index)).filter(postcode => localities.addressLocalitiesForPostcode(postcode)?.localities.some(locality => locality.state === "VIC")).slice(0, 100);
      assert.equal(postcodes.length, 100);
      const response = await route.PATCH(request("PATCH", { ...valid(), postcodes })); assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual((await response.json()).profile.postcodes, postcodes); assert.equal(await auditCount(), 1);
      assert.ok((await db.prepare("SELECT metadata FROM admin_audit_log").first()).metadata.length < 4000);
    });
  } finally { await runtime.dispose(); }
});
