import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Miniflare } from "miniflare";
import { gnafAddressKey, gnafShardForKey, GNAF_ATTRIBUTION } from "../src/lib/gnaf-address.ts";
import { createGnafDirectory, parseGnafManifest, parseGnafShard, gnafSha256, GNAF_PREFIX } from "../src/lib/gnaf-directory.ts";
import { uploadGnafPart, verifyGnafBatch, activateGnafDirectory, gnafProvisionAuthorized, readGnafUpload } from "../src/lib/gnaf-provision.ts";

const encode = value => new TextEncoder().encode(JSON.stringify(value));
async function fixture(address = "12 Smith St, Melbourne VIC 3000, Australia", sourceId = "GAVIC123") {
  const key = gnafAddressKey(address), path = gnafShardForKey(key);
  const shard = { schema: 1, version: "aug2026", postcode: path.split('/')[0], bucket: path.split('/')[1][0], entries: { [key]: [-37.81, 144.96, sourceId, "PC"] } };
  const decoded = encode(shard), bytes = gzipSync(decoded);
  const manifest = { schema: 1, version: "aug2026", sourceUrl: "https://data.gov.au/data/gnaf.zip", sourceSha256: "1".repeat(64), attribution: GNAF_ATTRIBUTION, datum: "GDA2020", createdAt: "2026-10-01T00:00:00Z", recordCount: 1,
    shards: { [path]: { sha256: await gnafSha256(bytes), bytes: bytes.length, decodedBytes: decoded.length, entries: 1 } } };
  const objects = new Map(); let reads = 0;
  const bucket = {
    async get(key) { reads++; const o = objects.get(key); return o ? { size: o.bytes.length, customMetadata: o.metadata, async arrayBuffer() { return Uint8Array.from(o.bytes).buffer; } } : null; },
    async head(key) { const o = objects.get(key); return o ? {size:o.bytes.length,customMetadata:o.metadata} : null; },
    async put(key, bytes, options) { if (options.onlyIf && objects.has(key)) return null; objects.set(key,{bytes:Uint8Array.from(bytes),metadata:options.customMetadata}); return {key}; }
  };
  return { key, path, shard, bytes, manifest, objects, bucket, reads:()=>reads };
}
test("exact address normalisation preserves units and rejects private placeholders", () => {
  assert.equal(gnafAddressKey("3/15 Smith Rd, Carlton VIC 3053 Australia"),gnafAddressKey("Unit 3, 15 Smith Road Carlton VIC 3053"));
  assert.notEqual(gnafAddressKey("3/15 Smith Road Carlton VIC 3053"),gnafAddressKey("15 Smith Road Carlton VIC 3053"));
  assert.equal(gnafAddressKey("15 Smith Rd, Unit 3, Carlton, Victoria, 3053, Australia"),gnafAddressKey("Unit 3 15 Smith Road Carlton VIC 3053"));
  assert.equal(gnafAddressKey("1 Smith St Darwin Northern Territory 800"),gnafAddressKey("1 Smith Street Darwin NT 0800"));
  for(const value of ["address withheld VIC 3000", "PO Box 3 Carlton VIC 3053", "12 Smith Rd", "a@b.com VIC 3000", "x".repeat(1001)]) assert.equal(gnafAddressKey(value),null);
});
test("directory resolves repeated addresses once per shard without external calls", async () => {
  const f=await fixture(); await uploadGnafPart(f.bucket,"aug2026",f.path,f.bytes);
  const directory=createGnafDirectory(f.bucket,parseGnafManifest(encode(f.manifest)));
  const result=await directory.resolve(Array(200).fill(f.key));
  assert.equal(result.length,200); assert.equal(f.reads(),1); assert.equal(result[0].sourceId,"GAVIC123"); assert.equal(result[0].approximate,true);
  assert.equal((await directory.resolve(["missing"] ))[0].reason,"invalid_address");
  await assert.rejects(directory.resolve(Array(201).fill(f.key)));
});
test("directory overlaps at most four compressed reads and preserves result order across groups", async () => {
  const fixtures = await Promise.all(Array.from({ length: 9 }, (_, index) => fixture(`12 Smith Street Melbourne VIC ${3000 + index}`, `GAVIC${index}`)));
  const manifest = { ...fixtures[0].manifest, recordCount: fixtures.length, shards: Object.assign({}, ...fixtures.map(f => f.manifest.shards)) };
  const partitions = new Map(fixtures.map(f => [`${GNAF_PREFIX}aug2026/${f.path}`, f]));
  let active = 0, maximumActive = 0, reads = 0;
  const bucket = { async get(path) {
    const f = partitions.get(path);
    assert.ok(f); reads++; active++; maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setImmediate(resolve));
    return { size: f.bytes.length, async arrayBuffer() {
      await new Promise(resolve => setImmediate(resolve)); active--;
      return Uint8Array.from(f.bytes).buffer;
    } };
  } };
  const addresses = fixtures.map(f => f.key).reverse();
  const result = await createGnafDirectory(bucket, manifest).resolve([...addresses, addresses[0], "invalid"]);
  assert.equal(maximumActive, 4); assert.equal(active, 0); assert.equal(reads, 9);
  assert.deepEqual(result.slice(0, 10).map(item => item.status), Array(10).fill("located"));
  assert.deepEqual(result.slice(0, 10).map(item => item.sourceId), ["GAVIC8", "GAVIC7", "GAVIC6", "GAVIC5", "GAVIC4", "GAVIC3", "GAVIC2", "GAVIC1", "GAVIC0", "GAVIC8"]);
  assert.equal(result.at(-1).reason, "invalid_address");
});
test("a failed prefetched group finishes its outstanding reads and never returns partial matches", async () => {
  const fixtures = await Promise.all(Array.from({ length: 5 }, (_, index) => fixture(`12 Smith Street Melbourne VIC ${3000 + index}`)));
  const manifest = { ...fixtures[0].manifest, recordCount: fixtures.length, shards: Object.assign({}, ...fixtures.map(f => f.manifest.shards)) };
  const partitions = new Map(fixtures.map(f => [`${GNAF_PREFIX}aug2026/${f.path}`, f]));
  for (const failure of ["missing", "corrupt", "truncated"]) {
    let active = 0, reads = 0;
    const bucket = { async get(path) {
      const f = partitions.get(path); reads++; active++;
      await new Promise(resolve => setImmediate(resolve));
      if (f === fixtures[0] && failure === "missing") { active--; return null; }
      return { size: f.bytes.length, async arrayBuffer() {
        await new Promise(resolve => setImmediate(resolve)); active--;
        return (f !== fixtures[0] ? Uint8Array.from(f.bytes) : failure === "corrupt" ? new Uint8Array(f.bytes.length) : Uint8Array.from(f.bytes).slice(1)).buffer;
      } };
    } };
    await assert.rejects(createGnafDirectory(bucket, manifest).resolve(fixtures.map(f => f.key)));
    assert.equal(active, 0, failure); assert.equal(reads, 4, "later groups are not read after a failed group");
  }
});
test("lookup accepts explicit unit slashes after aliases without changing stored canonical keys", async () => {
  const f=await fixture("Unit 3M 15 Smith Street Melbourne VIC 3000");
  await uploadGnafPart(f.bucket,"aug2026",f.path,f.bytes);
  const addresses=["Flat", "Apartment", "APT", "U", "Villa", "Townhouse"].map(type=>`${type} 3M/15 Smith St, Melbourne VIC 3000`);
  assert.equal(gnafAddressKey(addresses[0]),"UNIT 3M/15 SMITH STREET MELBOURNE VIC 3000","the immutable builder normalizer is unchanged");
  const results=await createGnafDirectory(f.bucket,f.manifest).resolve(addresses);
  assert.ok(results.every(result=>result.status==="located"&&result.sourceId==="GAVIC123"));
  assert.equal(f.reads(),1,"all equivalent inputs use the existing canonical shard");
});
test("unit slash lookup preserves building names, unit suffixes and street ranges", async () => {
  const f=await fixture("The Lodge Unit 3M 15-17 Smith Street Melbourne VIC 3000");
  await uploadGnafPart(f.bucket,"aug2026",f.path,f.bytes);
  const directory=createGnafDirectory(f.bucket,f.manifest);
  const results=await directory.resolve([
    "The Lodge Flat 3M/15-17 Smith St, Melbourne VIC 3000",
    "The Lodge Unit 3M / 15-17 Smith St, Melbourne VIC 3000",
    "Flat 3M/15-17 Smith St, Melbourne VIC 3000",
    "The Lodge Flat 3/15-17 Smith St, Melbourne VIC 3000",
    "The Lodge Flat 3M/15 Smith St, Melbourne VIC 3000",
    "Another Lodge Flat 3M/15-17 Smith St, Melbourne VIC 3000",
    "The Lodge Flat 3M/15-17 Smith St, Melbourne VIC 3000, private@example.test",
  ]);
  assert.deepEqual(results.map(result=>result.status),["located","located","unlocated","unlocated","unlocated","unlocated","unlocated"]);
  assert.equal(results.at(-1).reason,"invalid_address");
});
test("unit slash lookup never drops a required level or a different subaddress type", async () => {
  const f=await fixture("The Lodge Unit 3 Level 2 15 Smith Street Melbourne VIC 3000");
  await uploadGnafPart(f.bucket,"aug2026",f.path,f.bytes);
  const results=await createGnafDirectory(f.bucket,f.manifest).resolve([
    f.key,
    "The Lodge Flat 3/15 Smith St, Melbourne VIC 3000",
    "The Lodge STR 3/15 Smith St, Melbourne VIC 3000",
  ]);
  assert.deepEqual(results.map(result=>result.status),["located","unlocated","unlocated"]);
});
test("missing or corrupt partition fails the request instead of caching false no-match results", async()=>{
  const f=await fixture(), directory=createGnafDirectory(f.bucket,f.manifest);
  await assert.rejects(directory.resolve([f.key]));
  f.objects.set(`${GNAF_PREFIX}aug2026/${f.path}`,{bytes:new Uint8Array(f.bytes.length),metadata:{}});
  await assert.rejects(directory.resolve([f.key]));
  const oversized=Uint8Array.from(f.bytes);new DataView(oversized.buffer).setUint32(oversized.length-4,9*1024*1024,true);
  assert.throws(()=>parseGnafShard(oversized,"aug2026",f.path));
  assert.throws(()=>parseGnafShard(f.bytes,"wrong",f.path));
  const json = encode(f.shard), bomb = Uint8Array.from(gzipSync(Buffer.concat([json,Buffer.alloc(1024*1024,32)])));
  new DataView(bomb.buffer).setUint32(bomb.length-4,json.length,true);
  assert.throws(()=>parseGnafShard(bomb,"aug2026",f.path),"a forged gzip trailer must not hide its actual expanded size");
});

test("native Workers inflation enforces output limits and rejects damaged gzip with matching object hashes", async () => {
  const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const f = await fixture();
  const largeFixtures = await Promise.all(Array.from({ length: 9 }, (_, index) => fixture(`12 Smith Street Melbourne VIC ${3100 + index}`)));
  const largeObjects = new Map();
  let random = 42;
  for (const [index, item] of largeFixtures.entries()) {
    const size = [339295, 362376, 65536][index] || 2 * 1024 * 1024;
    const value = { ...item.shard, padding: "" };
    const padding = Buffer.alloc(size - encode(value).length);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let position = 0; position < padding.length; position++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      padding[position] = alphabet.charCodeAt(random % alphabet.length);
    }
    value.padding = padding.toString();
    const decoded = encode(value), bytes = gzipSync(decoded);
    assert.equal(decoded.length, size);
    item.manifest.shards[item.path] = { sha256: await gnafSha256(bytes), bytes: bytes.length, decodedBytes: size, entries: 1 };
    largeObjects.set(`${GNAF_PREFIX}aug2026/${item.path}`, bytes);
  }
  const largeManifest = { ...f.manifest, recordCount: largeFixtures.length, shards: Object.assign({}, ...largeFixtures.map(item => item.manifest.shards)) };
  const runtime = new Miniflare({
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], port: 0,
    serviceBindings: { LOCAL: request => {
      const bytes = largeObjects.get(decodeURIComponent(new URL(request.url).pathname.slice(1)));
      assert.ok(bytes, "Only local synthetic directory partitions may be read");
      return new Response(bytes);
    } },
    modules: [
      { type: "ESModule", path: "entry.js", contents: `
        import { createGnafDirectory, parseGnafShard, gnafSha256 } from './directory.js';
        const fixture = ${JSON.stringify({ key: f.key, path: f.path, manifest: f.manifest })};
        const large = ${JSON.stringify({ keys: largeFixtures.map(item => item.key), manifest: largeManifest })};
        export default { async fetch(request, env) {
          if (new URL(request.url).pathname === '/multiple') {
            let reads = 0;
            const bucket = { get: async key => {
              reads++;
              const response = await env.LOCAL.fetch('https://local-bucket.test/' + encodeURIComponent(key));
              const bytes = await response.arrayBuffer();
              return { size: bytes.byteLength, arrayBuffer: async () => bytes };
            } };
            const results = await createGnafDirectory(bucket, large.manifest).resolve(large.keys);
            return Response.json({ located: results.filter(result => result.status === 'located').length, reads });
          }
          const bytes = new Uint8Array(await request.arrayBuffer());
          const manifest = structuredClone(fixture.manifest);
          manifest.shards[fixture.path].sha256 = await gnafSha256(bytes);
          manifest.shards[fixture.path].bytes = bytes.length;
          const bucket = { get: async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) };
          let provisioning = false, runtime = false;
          try { parseGnafShard(bytes, 'aug2026', fixture.path); provisioning = true; } catch {}
          try { runtime = (await createGnafDirectory(bucket, manifest).resolve([fixture.key]))[0].status === 'located'; } catch {}
          return Response.json({ provisioning, runtime });
        } }
      ` },
      { type: "ESModule", path: "directory.js", contents: compile("../src/lib/gnaf-directory.ts") },
      { type: "ESModule", path: "gnaf-address.ts", contents: compile("../src/lib/gnaf-address.ts") },
    ],
    outboundService: () => { throw new Error("Directory tests must never call an external service"); },
  });
  const invoke = async bytes => (await runtime.dispatchFetch("https://local.test/", { method: "POST", body: bytes })).json();
  try {
    assert.deepEqual(await invoke(f.bytes), { provisioning: true, runtime: true });
    // Workerd's native output-buffer growth rejected these valid lengths when
    // maxOutputLength equalled the trailer, even for a single small partition.
    for (let iteration = 0; iteration < 2; iteration++) {
      const response = await runtime.dispatchFetch("https://local.test/multiple");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { located: largeFixtures.length, reads: largeFixtures.length });
    }
    const crc = Uint8Array.from(f.bytes); crc[crc.length - 8] ^= 1;
    const smallTrailer = Uint8Array.from(f.bytes);
    new DataView(smallTrailer.buffer).setUint32(smallTrailer.length - 4, 1, true);
    const largeTrailer = Uint8Array.from(f.bytes);
    new DataView(largeTrailer.buffer).setUint32(largeTrailer.length - 4, 9 * 1024 * 1024, true);
    const bomb = Uint8Array.from(gzipSync(Buffer.alloc(9 * 1024 * 1024, 32)));
    new DataView(bomb.buffer).setUint32(bomb.length - 4, encode(f.shard).length, true);
    const concatenated = Buffer.concat([f.bytes, f.bytes]);
    for (const [name, bytes] of [
      ["CRC mismatch", crc], ["truncated gzip", f.bytes.subarray(0, f.bytes.length - 4)],
      ["small forged trailer", smallTrailer], ["oversized trailer", largeTrailer],
      ["expanded output exceeds forged length", bomb], ["concatenated members exceed length", concatenated],
    ]) assert.deepEqual(await invoke(bytes), { provisioning: false, runtime: false }, name);
  } finally { await runtime.dispose(); }
});
test("ambiguous addresses remain unlocated, while unknown postcode is a genuine no-match",async()=>{
  const f=await fixture(); f.shard.entries[f.key]=null;const decoded=encode(f.shard),bytes=gzipSync(decoded);
  f.manifest.shards[f.path]={sha256:await gnafSha256(bytes),bytes:bytes.length,decodedBytes:decoded.length,entries:1};
  await uploadGnafPart(f.bucket,"aug2026",f.path,bytes);
  const results=await createGnafDirectory(f.bucket,f.manifest).resolve([f.key,"12 Smith Street Melbourne VIC 3999"]);
  assert.equal(results[0].reason,"ambiguous");assert.equal(results[1].reason,"zero_results");
});
test("runtime rejects invalid requested values even when partition bytes match the manifest", async () => {
  for (const entry of [[91,144,"GAVIC1","PC"],[-37,144,"<invalid>","PC"],{},false]) {
    const f=await fixture(); f.shard.entries[f.key]=entry;
    const decoded=encode(f.shard),bytes=gzipSync(decoded);
    f.manifest.shards[f.path]={sha256:await gnafSha256(bytes),bytes:bytes.length,decodedBytes:decoded.length,entries:1};
    f.objects.set(`${GNAF_PREFIX}aug2026/${f.path}`,{bytes,metadata:{}});
    await assert.rejects(createGnafDirectory(f.bucket,f.manifest).resolve([f.key]));
  }
});
test("runtime validates partition identity and decoded metadata after checking its hash", async () => {
  for (const change of ["version","path","schema","count","size"]) {
    const f=await fixture();
    if(change==="version") f.shard.version="another";
    if(change==="path") f.shard.postcode="3999";
    if(change==="schema") f.shard.schema=2;
    const decoded=encode(f.shard),bytes=gzipSync(decoded);
    f.manifest.shards[f.path]={sha256:await gnafSha256(bytes),bytes:bytes.length,decodedBytes:decoded.length+(change==="size"?1:0),entries:change==="count"?2:1};
    f.objects.set(`${GNAF_PREFIX}aug2026/${f.path}`,{bytes,metadata:{}});
    await assert.rejects(createGnafDirectory(f.bucket,f.manifest).resolve([f.key]),change);
  }
});
test("provisioning still rejects malformed unrelated entries before immutable upload", async () => {
  const f=await fixture();
  const malformedEntries=[
    ["unrelated",[-37,144,"GAVIC1","PC"]],
    [gnafAddressKey("1 Test Road Sydney NSW 2000"),[-33,151,"GANSW1","PC"]],
    [f.key,[91,144,"GAVIC1","PC"]],
  ];
  for (const [key,entry] of malformedEntries) {
    const bytes=gzipSync(encode({...f.shard,entries:{...f.shard.entries,[key]:entry}}));
    assert.throws(()=>parseGnafShard(bytes,"aug2026",f.path));
    await assert.rejects(uploadGnafPart(f.bucket,"aug2026",f.path,bytes),/Invalid directory partition data/);
  }
  assert.equal(f.objects.size,0);
});
test("activation requires every immutable partition and matching verification receipts",async()=>{
  const f=await fixture();await uploadGnafPart(f.bucket,"aug2026","manifest.json",encode(f.manifest));
  await assert.rejects(activateGnafDirectory(f.bucket,"aug2026"),/Verify every/);
  await assert.rejects(verifyGnafBatch(f.bucket,"aug2026",0),/failed verification/);
  await uploadGnafPart(f.bucket,"aug2026",f.path,f.bytes);await uploadGnafPart(f.bucket,"aug2026",f.path,f.bytes);
  assert.deepEqual(await verifyGnafBatch(f.bucket,"aug2026",0),{verified:1,total:1,nextOffset:null});
  assert.deepEqual(await activateGnafDirectory(f.bucket,"aug2026"),{version:"aug2026",records:1,partitions:1});
  assert.equal(f.objects.get(`${GNAF_PREFIX}current.json`).metadata.version,"aug2026");
  const changed={...f.manifest,recordCount:2};await assert.rejects(uploadGnafPart(f.bucket,"aug2026","manifest.json",encode(changed)),/different data/);
  await assert.rejects(uploadGnafPart(f.bucket,"aug2026","../../private.json",f.bytes),/Invalid/);
});
test("maintenance authorization expires and rejects wrong tokens or missing deployment scope",async()=>{
  const now=Date.parse("2026-10-01T00:00:00Z"),token="a".repeat(64),env={TLINK_GNAF_IMPORT_TOKEN:token,TLINK_GNAF_IMPORT_UNTIL:"2026-10-01T12:00:00Z",TLINK_GNAF_IMPORT_VERSION:"aug2026"};
  const request=secret=>new Request("https://example.test",{headers:{authorization:`Bearer ${secret}`}});
  assert.equal(await gnafProvisionAuthorized(request(token),env,now),true);
  assert.equal(await gnafProvisionAuthorized(request("b".repeat(64)),env,now),false);
  assert.equal(await gnafProvisionAuthorized(request(token),env,now+86400000),false);
  assert.equal(await gnafProvisionAuthorized(request(token),{...env,TLINK_GNAF_IMPORT_VERSION:"../other"},now),false);
});
test("upload byte limits apply to actual streamed body without trusting Content-Length",async()=>{
  await assert.rejects(readGnafUpload(new Request("https://example.test",{method:"PUT",body:"12345"}),4),/size limit/);
  assert.equal((await readGnafUpload(new Request("https://example.test",{method:"PUT",body:"1234"}),4)).length,4);
});
