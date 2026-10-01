import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { uploadGnafDirectory } from "../scripts/upload-gnaf-directory.mjs";
import { GNAF_ATTRIBUTION, gnafAddressKey, gnafShardForKey } from "../src/lib/gnaf-address.ts";

const ORIGIN = "https://ausenergyassessments.com";
const TOKEN = "private-upload-token-".repeat(3);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
const reply = (value, status = 200) => Response.json(value, { status });

function fixture(t, count = 5) {
  const directory = mkdtempSync(join(tmpdir(), "tlink-gnaf-upload-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifest = { schema: 1, version: "aug2026", sourceUrl: "https://data.gov.au/data/gnaf.zip", sourceSha256: "1".repeat(64),
    attribution: GNAF_ATTRIBUTION, datum: "GDA2020", createdAt: "2026-10-01T00:00:00Z", recordCount: count, shards: {} };
  for (let i = 0; i < count; i++) {
    const postcode = String(3000 + i), key = gnafAddressKey(`12 Smith Street Melbourne VIC ${postcode}`), part = gnafShardForKey(key);
    const decoded = encode({ schema: 1, version: manifest.version, postcode, bucket: part.split("/")[1][0], entries: { [key]: [-37.8, 144.9, `GAVIC${i}`, "PC"] } });
    const bytes = gzipSync(decoded), file = join(directory, part);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes);
    manifest.shards[part] = { sha256: sha256(bytes), bytes: bytes.length, decodedBytes: decoded.length, entries: 1 };
  }
  writeFileSync(join(directory, "manifest.json"), encode(manifest));
  const logs = [], calls = [], stored = new Map();
  let active = 0, maximumActive = 0, hook;
  async function request(url, options) {
    assert.equal(url.origin, ORIGIN); assert.equal(url.pathname, "/api/admin/address-directory");
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(options.signal instanceof AbortSignal);
    const part = url.searchParams.get("part"), body = options.method === "POST" ? JSON.parse(options.body) : null;
    calls.push({ method: options.method, part, action: body?.action, offset: body?.offset });
    active++; maximumActive = Math.max(maximumActive, active);
    try {
      await new Promise(setImmediate);
      const replacement = await hook?.({ url, options, part, body });
      if (replacement) return replacement;
      if (options.method === "PUT") {
        assert.equal(url.searchParams.get("version"), manifest.version);
        const bytes = Buffer.from(options.body), previous = stored.get(part);
        if (previous && !previous.equals(bytes)) return reply({ ok: false }, 409);
        stored.set(part, bytes);
        return reply({ ok: true, sha256: sha256(bytes), bytes: bytes.length });
      }
      assert.equal(body.version, manifest.version);
      if (body.action === "verify") {
        assert.ok(stored.has("manifest.json"));
        const parts = Object.keys(manifest.shards).sort(), verified = Math.min(body.offset + 250, parts.length);
        assert.deepEqual(parts.filter(part => !stored.has(part)), []);
        return reply({ ok: true, verified, total: parts.length, nextOffset: verified < parts.length ? verified : null });
      }
      assert.equal(body.action, "activate");
      return reply({ ok: true, version: manifest.version, records: manifest.recordCount, partitions: Object.keys(manifest.shards).length });
    } finally { active--; }
  }
  return { directory, manifest, logs, calls, stored, options: { origin: ORIGIN, directory, version: manifest.version, token: TOKEN },
    dependencies: { request, log: value => logs.push(value) }, setHook(value) { hook = value; }, maximumActive: () => maximumActive };
}

test("uploads four verified partitions concurrently, then the manifest, verification and activation", async t => {
  const f = fixture(t), result = await uploadGnafDirectory(f.options, f.dependencies);
  assert.equal(f.maximumActive(), 4);
  assert.equal(result.stage, "active"); assert.equal(result.records, 5); assert.equal(result.partitions, 5);
  assert.deepEqual(f.calls.slice(-3).map(call => call.part || call.action), ["manifest.json", "verify", "activate"]);
  assert.equal(f.calls.slice(0, -3).every(call => call.method === "PUT" && call.part !== "manifest.json"), true);
  const journal = readFileSync(result.journalPath, "utf8"), saved = JSON.parse(journal);
  assert.equal(saved.stage, "active"); assert.equal(Object.keys(saved.uploaded).length, 5);
  assert.equal(saved.origin, ORIGIN); assert.equal(saved.version, "aug2026");
  assert.equal(saved.manifestSha256, sha256(readFileSync(join(f.directory, "manifest.json"))));
  assert.equal(JSON.stringify(f.logs).includes(TOKEN), false); assert.equal(journal.includes(TOKEN), false);
  assert.equal(readdirSync(f.directory).some(name => name.endsWith(".next")), false);
});

test("an interrupted upload keeps acknowledged hashes and resumes only missing partitions", async t => {
  const f = fixture(t, 4), failed = Object.keys(f.manifest.shards).sort()[3];
  f.setHook(({ part }) => part === failed ? reply({ ok: false, token: TOKEN }, 503) : null);
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), /HTTP 503/);
  assert.equal(f.calls.some(call => call.part === "manifest.json" || call.action === "activate"), false);
  const journalFile = readdirSync(f.directory).find(name => name.startsWith(".upload-"));
  const journal = JSON.parse(readFileSync(join(f.directory, journalFile), "utf8"));
  assert.equal(journal.stage, "paused"); assert.equal(Object.keys(journal.uploaded).length, 3);
  const start = f.calls.length; f.setHook(null);
  await uploadGnafDirectory(f.options, f.dependencies);
  assert.deepEqual(f.calls.slice(start).filter(call => call.method === "PUT").map(call => call.part), [failed, "manifest.json"]);
  assert.equal(f.logs.findLast(log => log.stage === "starting").resumed, 3);
});

test("a completed retry is idempotent and still verifies every server partition", async t => {
  const f = fixture(t, 251); await uploadGnafDirectory(f.options, f.dependencies);
  assert.deepEqual(f.calls.filter(call => call.action === "verify").map(call => call.offset), [0, 250]);
  const start = f.calls.length; await uploadGnafDirectory(f.options, f.dependencies);
  assert.deepEqual(f.calls.slice(start).map(call => call.part || call.action), ["manifest.json", "verify", "verify", "activate"]);
  assert.deepEqual(f.calls.slice(start).filter(call => call.action === "verify").map(call => call.offset), [0, 250]);
});

test("the journal is bound to the exact origin, version and manifest", async t => {
  const f = fixture(t, 1), result = await uploadGnafDirectory(f.options, f.dependencies);
  const saved = JSON.parse(readFileSync(result.journalPath, "utf8"));
  writeFileSync(result.journalPath, encode({ ...saved, origin: "https://other.example" }));
  const start = f.calls.length;
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), /does not match/);
  assert.equal(f.calls.length, start);
  writeFileSync(result.journalPath, encode({ ...saved, uploaded: { "3999/0.json.gz": "a".repeat(64) } }));
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), /does not match/);
});

test("transport failures and provider error bodies never disclose the maintenance token", async t => {
  const f = fixture(t, 1);
  f.setHook(() => { throw new Error(`Sensitive provider diagnostic: ${TOKEN}`); });
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), error => {
    assert.match(error.message, /connection failed/); assert.equal(error.message.includes(TOKEN), false); return true;
  });
  f.setHook(() => new Response(`Provider echoed ${TOKEN}`, { status: 401 }));
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), error => {
    assert.match(error.message, /HTTP 401/); assert.equal(error.message.includes(TOKEN), false); return true;
  });
  assert.equal(JSON.stringify(f.logs).includes(TOKEN), false);
});

test("verification or acknowledgement mismatch never activates the directory", async t => {
  const f = fixture(t, 1);
  f.setHook(({ body }) => body?.action === "verify" ? reply({ ok: true, verified: 0, total: 1, nextOffset: null }) : null);
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), /unexpected partition count/);
  assert.equal(f.calls.some(call => call.action === "activate"), false);
  f.setHook(({ part }) => part === "manifest.json" ? reply({ ok: true, sha256: "f".repeat(64), bytes: 1 }) : null);
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), /manifest checksum/);
  assert.equal(f.calls.some(call => call.action === "activate"), false);
});

test("corrupt local data is not uploaded or activated", async t => {
  const f = fixture(t, 1), part = Object.keys(f.manifest.shards)[0], file = join(f.directory, part);
  const bytes = readFileSync(file); bytes[20] ^= 255; writeFileSync(file, bytes);
  await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), /checksum differs/);
  assert.equal(f.calls.length, 0);
});

test("invalid origins, credentials, repository paths and version traversal fail before any request", async t => {
  const f = fixture(t, 1), repository = resolve(fileURLToPath(new URL("../", import.meta.url)));
  for (const change of [{ origin: "http://ausenergyassessments.com" }, { origin: `${ORIGIN}.attacker.example` },
    { origin: `${ORIGIN}/path` }, { directory: "." }, { directory: repository }, { directory: join(repository, "src") },
    { token: "short" }, { token: `${TOKEN}\r\nHeader: bad` }, { version: "../private" }, { version: "wrong-version" }]) {
    await assert.rejects(uploadGnafDirectory({ ...f.options, ...change }, f.dependencies));
  }
  assert.equal(f.calls.length, 0);
});

test("manifest partition traversal and oversize metadata are rejected before any request", async t => {
  const f = fixture(t, 1), part = Object.keys(f.manifest.shards)[0], original = f.manifest.shards[part];
  for (const shards of [{ "../private": original }, { [part]: { ...original, bytes: 2 * 1024 * 1024 + 1 } }]) {
    writeFileSync(join(f.directory, "manifest.json"), encode({ ...f.manifest, shards }));
    await assert.rejects(uploadGnafDirectory(f.options, f.dependencies));
  }
  assert.equal(f.calls.length, 0);
});

test("oversized or malformed successful responses are rejected without logging response content", async t => {
  const f = fixture(t, 1);
  for (const response of [new Response(TOKEN), new Response("x".repeat(32_769)), reply({ ok: false, details: TOKEN })]) {
    f.setHook(() => response);
    await assert.rejects(uploadGnafDirectory(f.options, f.dependencies), error => {
      assert.equal(error.message.includes(TOKEN), false); return true;
    });
  }
  assert.equal(f.calls.some(call => call.action === "activate"), false);
});

test("CLI rejects command-line settings and never echoes a token argument", () => {
  const script = fileURLToPath(new URL("../scripts/upload-gnaf-directory.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script, `--token=${TOKEN}`], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /hidden stdin only/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(TOKEN), false);
});
