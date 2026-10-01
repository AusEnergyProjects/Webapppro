import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
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
test("ambiguous addresses remain unlocated, while unknown postcode is a genuine no-match",async()=>{
  const f=await fixture(); f.shard.entries[f.key]=null;const decoded=encode(f.shard),bytes=gzipSync(decoded);
  f.manifest.shards[f.path]={sha256:await gnafSha256(bytes),bytes:bytes.length,decodedBytes:decoded.length,entries:1};
  await uploadGnafPart(f.bucket,"aug2026",f.path,bytes);
  const results=await createGnafDirectory(f.bucket,f.manifest).resolve([f.key,"12 Smith Street Melbourne VIC 3999"]);
  assert.equal(results[0].reason,"ambiguous");assert.equal(results[1].reason,"zero_results");
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
