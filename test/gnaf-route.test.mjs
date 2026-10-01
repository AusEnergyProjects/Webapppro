import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import ts from "typescript";
import { gnafAddressKey, gnafShardForKey, GNAF_ATTRIBUTION } from "../src/lib/gnaf-address.ts";
import { createGnafDirectory, gnafSha256, GNAF_PREFIX, GNAF_MAX_COMPRESSED_BYTES } from "../src/lib/gnaf-directory.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
function declarations(path, names) {
  const source = ts.createSourceFile(path, fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const nodes = source.statements.filter(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && names.includes(node.name?.text));
  assert.equal(nodes.length, names.length);
  return nodes.map(node => node.getText()).join("\n");
}
const stubs = {
  "@/lib/admin-server": `import { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL } from './src/lib/firebase-mfa.ts';
    ${declarations("src/lib/admin-server.ts", ["sameOrigin", "adminJson", "mfaErrorResponse"])}`,
  "@/lib/trade-access-server": declarations("src/lib/trade-access-server.ts", ["TradeAccessError"]),
  "@/lib/trade-team-server": `let error=null,calls=0;
    export function setAccessError(value){error=value;calls=0;}
    export function accessCalls(){return calls;}
    export async function requireInstallerTeamAccess(){calls++;if(error)throw error;return {ownerUid:'verified-owner',memberId:'staff'};}`,
  "@/lib/gnaf-directory-server": `let directory=null,bucket=null,calls=0,bucketReads=0,error=null;
    export function configureDirectory(value,storage,fail=null){directory=value;bucket=storage;error=fail;calls=0;bucketReads=0;}
    export function directoryCalls(){return calls;}
    export function bucketCalls(){return bucketReads;}
    export async function getGnafDirectory(){calls++;if(error)throw error;return directory;}
    export function gnafBucket(){bucketReads++;if(!bucket)throw new Error('Missing bucket');return bucket;}`,
};
const built = await build({
  stdin: { contents: `export {POST as locate} from './src/app/api/trade-map/locate/route.ts';
    export {PUT as upload,POST as provision} from './src/app/api/admin/address-directory/route.ts';
    export {setAccessError,accessCalls} from '@/lib/trade-team-server';
    export {configureDirectory,directoryCalls,bucketCalls} from '@/lib/gnaf-directory-server';
    export {TradeAccessError} from '@/lib/trade-access-server';
    export {FirebaseMfaRequiredError} from './src/lib/firebase-mfa.ts';`, resolveDir: root },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
  plugins: [{ name: "gnaf-route-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "ts", resolveDir: root }));
  } }],
});
const route = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + "\n//# sourceURL=gnaf-route-fixture.mjs").toString("base64")}`);
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const VERSION = "aug2026", TOKEN = "synthetic-maintenance-token-" + "a".repeat(40);
const importKeys = ["TLINK_GNAF_IMPORT_TOKEN", "TLINK_GNAF_IMPORT_VERSION", "TLINK_GNAF_IMPORT_UNTIL"];
async function withMaintenance(callback, changes = {}) {
  const previous = Object.fromEntries(importKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { TLINK_GNAF_IMPORT_TOKEN: TOKEN, TLINK_GNAF_IMPORT_VERSION: VERSION,
    TLINK_GNAF_IMPORT_UNTIL: new Date(Date.now() + 3600000).toISOString(), ...changes });
  for (const key of importKeys) if (changes[key] === null) delete process.env[key];
  try { return await callback(); } finally {
    for (const key of importKeys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
}
function request(path, { method = "POST", body, headers = {} } = {}) {
  return new Request(`https://tlink.example${path}`, { method, body, headers });
}
function manual(body, headers = {}) {
  return request("/api/trade-map/locate", { body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}
function adminUpload(part, bytes, options = {}) {
  return request(`/api/admin/address-directory?version=${encodeURIComponent(options.version ?? VERSION)}&part=${encodeURIComponent(part)}`, {
    method: "PUT", body: bytes, headers: { authorization: `Bearer ${options.token ?? TOKEN}`, ...options.headers },
  });
}
function adminPost(body, headers = {}) {
  return request("/api/admin/address-directory", { body: JSON.stringify(body), headers: {
    authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers,
  } });
}
async function fixture() {
  route.setAccessError(null);
  const key = gnafAddressKey("12 Smith Street Melbourne VIC 3000"), part = gnafShardForKey(key);
  const shard = { schema: 1, version: VERSION, postcode: "3000", bucket: part.split("/")[1][0], entries: { [key]: [-37.81, 144.96, "GAVIC123", "PC"] } };
  const decoded = encode(shard), bytes = gzipSync(decoded);
  const manifest = { schema: 1, version: VERSION, sourceUrl: "https://data.gov.au/data/gnaf.zip", sourceSha256: "1".repeat(64),
    attribution: GNAF_ATTRIBUTION, datum: "GDA2020", createdAt: "2026-10-01T00:00:00Z", recordCount: 1,
    shards: { [part]: { sha256: await gnafSha256(bytes), bytes: bytes.length, decodedBytes: decoded.length, entries: 1 } } };
  const objects = new Map(), writes = [];
  const bucket = {
    async get(key) { const item = objects.get(key); return item ? { size: item.bytes.length, customMetadata: item.metadata, async arrayBuffer() { return Uint8Array.from(item.bytes).buffer; } } : null; },
    async head(key) { const item = objects.get(key); return item ? { size: item.bytes.length, customMetadata: item.metadata } : null; },
    async put(key, bytes, options) { if (options.onlyIf && objects.has(key)) return null;
      writes.push(key); objects.set(key, { bytes: Uint8Array.from(bytes), metadata: options.customMetadata }); return { key }; },
  };
  objects.set(`${GNAF_PREFIX}${VERSION}/${part}`, { bytes, metadata: { version: VERSION, sha256: await gnafSha256(bytes), decodedBytes: String(decoded.length), entries: "1" } });
  const directory = createGnafDirectory(bucket, manifest);
  route.configureDirectory(directory, bucket);
  return { key, part, shard, bytes, decoded, manifest, objects, writes, bucket, directory };
}

test("manual map search checks origin and team authentication before reading addresses", async () => {
  await fixture();
  const crossOrigin = await route.locate(manual({ address: "12 Smith Street Melbourne VIC 3000" }, { origin: "https://other.example" }));
  assert.equal(crossOrigin.status, 403); assert.equal(route.accessCalls(), 0); assert.equal(route.directoryCalls(), 0);
  for (const [error, status] of [[new Error("AUTH_REQUIRED"), 401], [new Error("ABN_REVIEW_REQUIRED"), 403],
    [new route.FirebaseMfaRequiredError(), 403], [new route.TradeAccessError("ACCOUNT_INACTIVE", 403, "Account inactive"), 403]]) {
    route.setAccessError(error);
    const response = await route.locate(manual({ address: "12 Smith Street Melbourne VIC 3000" }));
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(route.directoryCalls(), 0);
  }
});

test("manual map search rejects malformed and oversized actual bodies without trusting Content-Length", async () => {
  await fixture();
  for (const body of [null, [], {}, { address: 42 }, { address: "x".repeat(1001) }]) {
    assert.equal((await route.locate(manual(body))).status, 400);
  }
  const huge = await route.locate(manual({ address: "12 Smith Street Melbourne VIC 3000", padding: "x".repeat(8192) }, { "content-length": "1" }));
  assert.equal(huge.status, 400);
  assert.equal((await route.locate(request("/api/trade-map/locate", { body: "{" }))).status, 400);
  assert.equal((await route.locate(request("/api/trade-map/locate", { body: new Uint8Array([0xff]) }))).status, 400);
  assert.equal(route.directoryCalls(), 0);
});

test("manual search resolves trusted local coordinates, strips source ID and returns honest invalid-address results", async () => {
  const f = await fixture();
  const response = await route.locate(manual({ address: f.key, sourceId: "forged", position: { lat: 0, lng: 0 } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, result: { status: "located", position: { lat: -37.81, lng: 144.96 }, approximate: true } });
  for (const address of ["", "PO Box 3 Melbourne VIC 3000", "address withheld VIC 3000", "invalid"]) {
    const result = await route.locate(manual({ address }));
    assert.deepEqual(await result.json(), { ok: true, result: { status: "unlocated", reason: "invalid_address" } });
  }
  assert.deepEqual(f.writes, [], "manual search must not mutate the national directory or business records");
});

test("manual search returns 503 for an unavailable or corrupt directory without revealing provider details", async () => {
  const f = await fixture();
  f.objects.clear();
  const missing = await route.locate(manual({ address: f.key }));
  assert.equal(missing.status, 503); assert.equal((await missing.json()).ok, false);
  route.configureDirectory(null, f.bucket, new Error("sensitive bucket/provider diagnostic"));
  const failure = await route.locate(manual({ address: f.key }));
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /sensitive|diagnostic/);
});

test("maintenance upload denies missing, wrong, expired or unscoped credentials before touching the bucket", async () => {
  const f = await fixture();
  for (const changes of [
    { TLINK_GNAF_IMPORT_TOKEN: null }, { TLINK_GNAF_IMPORT_VERSION: null }, { TLINK_GNAF_IMPORT_VERSION: "../other" },
    { TLINK_GNAF_IMPORT_UNTIL: new Date(Date.now() - 1000).toISOString() },
    { TLINK_GNAF_IMPORT_UNTIL: new Date(Date.now() + 25 * 3600000).toISOString() },
  ]) await withMaintenance(async () => {
    assert.equal((await route.upload(adminUpload(f.part, f.bytes))).status, 403);
    assert.equal((await route.provision(adminPost({ action: "activate", version: VERSION }))).status, 403);
  }, changes);
  await withMaintenance(async () => {
    assert.equal((await route.upload(adminUpload(f.part, f.bytes, { token: "wrong".repeat(10) }))).status, 403);
    assert.equal((await route.upload(adminUpload(f.part, f.bytes, { headers: { authorization: "" } }))).status, 403);
    assert.equal((await route.upload(adminUpload(f.part, f.bytes, { headers: { origin: "https://other.example" } }))).status, 403);
  });
  assert.equal(route.bucketCalls(), 0); assert.deepEqual(f.writes, []);
});

test("maintenance route confines all writes to the authorised version and valid directory parts", async () => {
  const f = await fixture();
  await withMaintenance(async () => {
    assert.equal((await route.upload(adminUpload(f.part, f.bytes, { version: "different" }))).status, 403);
    for (const part of ["../private.json", "../../current.json", "current.json", "verified/0.json", "3000/4.json.gz", "3000/0.json", ""]) {
      assert.equal((await route.upload(adminUpload(part, f.bytes))).status, 400, part);
    }
    assert.equal((await route.provision(adminPost({ action: "activate", version: "../other" }))).status, 400);
    assert.equal((await route.provision(adminPost({ action: "delete", version: VERSION }))).status, 400);
  });
  assert.deepEqual(f.writes, []);
});

test("maintenance body limits reject oversized bytes and JSON even with a false Content-Length", async () => {
  const f = await fixture();
  await withMaintenance(async () => {
    const upload = await route.upload(adminUpload(f.part, new Uint8Array(GNAF_MAX_COMPRESSED_BYTES + 1), { headers: { "content-length": "1" } }));
    assert.equal(upload.status, 413);
    const action = await route.provision(adminPost({ action: "activate", version: VERSION, padding: "x".repeat(16 * 1024) }, { "content-length": "1" }));
    assert.equal(action.status, 413);
  });
  assert.equal(route.bucketCalls(), 0); assert.deepEqual(f.writes, []);
});

test("maintenance distinguishes invalid incoming data from storage failures without leaking backend errors", async () => {
  const f = await fixture();
  await withMaintenance(async () => {
    for (const [part, bytes] of [[f.part, new Uint8Array(20)], [f.part, gzipSync(encode({ wrong: true }))], ["manifest.json", encode({ wrong: true })]]) {
      const response = await route.upload(adminUpload(part, bytes));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("X-TLink-Directory-Error"), "invalid_input");
      assert.deepEqual(await response.json(), { ok: false, error: part === "manifest.json" ? "Invalid directory manifest." : "Invalid directory partition data.",
        category: "invalid_input", operation: "upload", part });
    }
    for (const method of ["head", "put", "get"]) {
      const original = f.bucket[method];
      f.objects.delete(`${GNAF_PREFIX}${VERSION}/${f.part}`);
      f.bucket[method] = async () => { throw new Error(`Private backend failure with ${TOKEN}`); };
      try {
        const response = method === "get" ? await route.provision(adminPost({ action: "verify", version: VERSION, offset: 0 })) : await route.upload(adminUpload(f.part, f.bytes));
        assert.equal(response.status, 503, method);
        assert.equal(response.headers.get("X-TLink-Directory-Error"), "backend_failure");
        const text = await response.text();
        assert.equal(text.includes(TOKEN), false); assert.doesNotMatch(text, /Private backend/);
        const body = JSON.parse(text);
        assert.equal(body.category, "backend_failure");
        assert.equal(body.operation, method === "get" ? "verify" : "upload");
        if (method === "get") assert.equal(body.offset, 0); else assert.equal(body.part, f.part);
      } finally { f.bucket[method] = original; }
    }
    const malformedAction = await route.provision(request("/api/admin/address-directory", { body: "{", headers: { authorization: `Bearer ${TOKEN}` } }));
    assert.equal(malformedAction.status, 400);
    assert.equal((await malformedAction.json()).category, "invalid_input");
    f.objects.set(`${GNAF_PREFIX}${VERSION}/manifest.json`, { bytes: encode({ corrupt: true }), metadata: {} });
    const corruptStored = await route.provision(adminPost({ action: "verify", version: VERSION, offset: 0 }));
    assert.equal(corruptStored.status, 503, "Previously stored corruption is a backend failure, not invalid current input");
    assert.equal((await corruptStored.json()).category, "backend_failure");
  });
});

test("activation cannot replace the active directory until every immutable partition is verified", async () => {
  const f = await fixture();
  f.objects.clear();
  const previous = { bytes: encode({ previous: true }), metadata: { version: "previous" } };
  f.objects.set(`${GNAF_PREFIX}current.json`, previous);
  await withMaintenance(async () => {
    assert.equal((await route.upload(adminUpload("manifest.json", encode(f.manifest)))).status, 200);
    assert.equal((await route.provision(adminPost({ action: "activate", version: VERSION }))).status, 409);
    assert.equal(f.objects.get(`${GNAF_PREFIX}current.json`), previous);
    assert.equal((await route.provision(adminPost({ action: "verify", version: VERSION, offset: 0 }))).status, 409);
    assert.equal((await route.upload(adminUpload(f.part, f.bytes))).status, 200);
    assert.equal((await route.upload(adminUpload(f.part, f.bytes))).status, 200, "an identical interrupted upload can resume");
    const changed = { ...f.shard, entries: { [f.key]: [-37.7, 144.8, "GAVIC456", "PC"] } };
    assert.equal((await route.upload(adminUpload(f.part, gzipSync(encode(changed))))).status, 409);
    assert.equal((await route.provision(adminPost({ action: "verify", version: VERSION, offset: 1 }))).status, 400);
    const verified = await route.provision(adminPost({ action: "verify", version: VERSION, offset: 0 }));
    assert.deepEqual(await verified.json(), { ok: true, verified: 1, total: 1, nextOffset: null });
    const activated = await route.provision(adminPost({ action: "activate", version: VERSION }));
    assert.equal(activated.status, 200);
    assert.deepEqual(await activated.json(), { ok: true, version: VERSION, records: 1, partitions: 1 });
    assert.equal(f.objects.get(`${GNAF_PREFIX}current.json`).metadata.version, VERSION);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(f.objects.get(`${GNAF_PREFIX}current.json`).bytes)), f.manifest);
  });
  assert.ok(f.writes.every(key => key.startsWith(`${GNAF_PREFIX}${VERSION}/`) || key === `${GNAF_PREFIX}current.json`));
});
