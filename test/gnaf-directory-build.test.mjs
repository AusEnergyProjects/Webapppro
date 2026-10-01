import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { buildGnafDirectory, createGnafSpool, finishGnafShards, gnafAddressVariants, readGnafPsv, reconcileGnafMatch } from "../scripts/build-gnaf-directory.mjs";
import { gnafAddressKey } from "../src/lib/gnaf-address.ts";
import { createGnafDirectory, parseGnafManifest, parseGnafShard } from "../src/lib/gnaf-directory.ts";

function temporary(t) {
  const base = resolve(tmpdir());
  const directory = mkdtempSync(join(base, "tlink-gnaf-builder-"));
  t.after(() => {
    assert.ok(directory.startsWith(`${base}${sep}tlink-gnaf-builder-`));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function psv(file, headers, rows) {
  writeFileSync(file, `${headers.join("|")}\n${rows.map(row => headers.map(name => row[name] ?? "").join("|")).join("\n")}\n`);
}

const addressHeaders = ["ADDRESS_DETAIL_PID", "DATE_RETIRED", "LOCALITY_PID", "STREET_LOCALITY_PID", "POSTCODE", "NUMBER_FIRST", "NUMBER_FIRST_PREFIX", "NUMBER_FIRST_SUFFIX", "NUMBER_LAST", "NUMBER_LAST_PREFIX", "NUMBER_LAST_SUFFIX", "LOT_NUMBER", "LOT_NUMBER_PREFIX", "LOT_NUMBER_SUFFIX", "FLAT_TYPE_CODE", "FLAT_NUMBER", "FLAT_NUMBER_PREFIX", "FLAT_NUMBER_SUFFIX", "LEVEL_TYPE_CODE", "LEVEL_NUMBER", "LEVEL_NUMBER_PREFIX", "LEVEL_NUMBER_SUFFIX", "BUILDING_NAME"];

function sourceFixture(directory) {
  mkdirSync(join(directory, "Authority Code"), { recursive: true });
  mkdirSync(join(directory, "Standard"), { recursive: true });
  for (const [type, rows] of Object.entries({ FLAT_TYPE: [{ CODE: "APT", NAME: "APARTMENT" }], LEVEL_TYPE: [{ CODE: "L", NAME: "LEVEL" }], STREET_SUFFIX: [{ CODE: "N", NAME: "NORTH" }] })) {
    psv(join(directory, "Authority Code", `Authority_Code_${type}_AUT_psv.psv`), ["CODE", "NAME"], rows);
  }
  const table = name => join(directory, "Standard", `ACT_${name}_psv.psv`);
  psv(table("STATE"), ["STATE_PID", "STATE_ABBREVIATION", "DATE_RETIRED"], [{ STATE_PID: "STATE1", STATE_ABBREVIATION: "ACT" }]);
  psv(table("LOCALITY"), ["LOCALITY_PID", "LOCALITY_NAME", "STATE_PID", "DATE_RETIRED"], [{ LOCALITY_PID: "LOCAL1", LOCALITY_NAME: "CANBERRA", STATE_PID: "STATE1" }]);
  psv(table("LOCALITY_ALIAS"), ["LOCALITY_PID", "NAME", "POSTCODE", "DATE_RETIRED"], [{ LOCALITY_PID: "LOCAL1", NAME: "CANBERRA CENTRAL", POSTCODE: "2601" }]);
  psv(table("STREET_LOCALITY"), ["STREET_LOCALITY_PID", "STREET_NAME", "STREET_TYPE_CODE", "STREET_SUFFIX_CODE", "DATE_RETIRED"], [{ STREET_LOCALITY_PID: "STREET1", STREET_NAME: "GARDEN", STREET_TYPE_CODE: "ROAD" }]);
  psv(table("STREET_LOCALITY_ALIAS"), ["STREET_LOCALITY_PID", "STREET_NAME", "STREET_TYPE_CODE", "STREET_SUFFIX_CODE", "DATE_RETIRED"], [{ STREET_LOCALITY_PID: "STREET1", STREET_NAME: "OLD GARDEN", STREET_TYPE_CODE: "RD" }]);
  const rows = [
    { ADDRESS_DETAIL_PID: "ADDRESS1", NUMBER_FIRST: "10" },
    { ADDRESS_DETAIL_PID: "ADDRESS2", NUMBER_FIRST: "20", FLAT_TYPE_CODE: "APT", FLAT_NUMBER: "3" },
    { ADDRESS_DETAIL_PID: "ADDRESS3", NUMBER_FIRST: "30" },
    { ADDRESS_DETAIL_PID: "ADDRESS4", NUMBER_FIRST: "30" },
    { ADDRESS_DETAIL_PID: "ADDRESS5", NUMBER_FIRST: "40", DATE_RETIRED: "2020-01-01" },
    { ADDRESS_DETAIL_PID: "ADDRESS6", NUMBER_FIRST: "50" },
    { ADDRESS_DETAIL_PID: "ADDRESS7", NUMBER_FIRST: "60", POSTCODE: "" },
    { ADDRESS_DETAIL_PID: "ADDRESS8", NUMBER_FIRST: "70" },
  ].map(row => ({ LOCALITY_PID: "LOCAL1", STREET_LOCALITY_PID: "STREET1", POSTCODE: "2600", ...row }));
  psv(table("ADDRESS_DETAIL"), addressHeaders, rows);
  psv(table("ADDRESS_DEFAULT_GEOCODE"), ["ADDRESS_DETAIL_PID", "DATE_RETIRED", "LATITUDE", "LONGITUDE", "GEOCODE_TYPE_CODE"], rows.filter(row => row.ADDRESS_DETAIL_PID !== "ADDRESS8").map((row, index) => ({ ADDRESS_DETAIL_PID: row.ADDRESS_DETAIL_PID, LATITUDE: row.ADDRESS_DETAIL_PID === "ADDRESS6" ? "0" : (-35.1 - index / 1000).toString(), LONGITUDE: "149.12345", GEOCODE_TYPE_CODE: "PC" })));
}

test("streams PSV with BOM, CRLF and a final row without a newline, rejecting malformed rows", async t => {
  const directory = temporary(t);
  const file = join(directory, "source.psv");
  writeFileSync(file, "\ufeffNAME|VALUE\r\nRUE ÉTÉ|1\r\nFINAL|2");
  const rows = [];
  await readGnafPsv(file, (row, header) => rows.push([row[header.NAME], row[header.VALUE]]));
  assert.deepEqual(rows, [["RUE ÉTÉ", "1"], ["FINAL", "2"]]);
  writeFileSync(file, "NAME|NAME\nA|B\n");
  await assert.rejects(readGnafPsv(file, () => {}), /Duplicate PSV headers/);
  writeFileSync(file, "NAME|VALUE\nA|B|C\n");
  await assert.rejects(readGnafPsv(file, () => {}), /Incorrect PSV field count/);
});

test("preserves unit, level and number range when generating explicit source variants", () => {
  const header = Object.fromEntries(addressHeaders.map((name, index) => [name, index]));
  const source = { NUMBER_FIRST: "10", NUMBER_LAST: "12", FLAT_TYPE_CODE: "APT", FLAT_NUMBER: "3", LEVEL_TYPE_CODE: "L", LEVEL_NUMBER: "2", BUILDING_NAME: "GARDEN HOUSE" };
  const variants = gnafAddressVariants(addressHeaders.map(name => source[name] ?? ""), header, { names: ["GARDEN RD"] }, { state: "ACT", names: [{ name: "CANBERRA", postcode: "2600" }] }, { flat: new Map([["APT", "APARTMENT"]]), level: new Map([["L", "LEVEL"]]) });
  assert.equal(variants.length, 8);
  assert.ok(variants.every(address => /(?:APT|APARTMENT) 3 (?:L|LEVEL) 2 10-12/.test(address)));
  assert.ok(variants.every(address => !address.includes("3/10")));
  assert.ok(!variants.includes("10-12 GARDEN RD CANBERRA ACT 2600"));
});

test("collisions with different coordinates or geocode types remain ambiguous regardless of order", () => {
  const first = [-35.1, 149.1, "ADDRESS2", "PC"];
  const same = [-35.1, 149.1, "ADDRESS1", "PC"];
  const other = [-35.2, 149.1, "ADDRESS3", "PC"];
  assert.deepEqual(reconcileGnafMatch(first, same), same);
  assert.deepEqual(reconcileGnafMatch(same, first), same);
  assert.equal(reconcileGnafMatch(first, other), null);
  assert.equal(reconcileGnafMatch(other, first), null);
  assert.equal(reconcileGnafMatch(first, [-35.1, 149.1, "ADDRESS4", "BC"]), null);
  assert.equal(reconcileGnafMatch(null, first), null);
});

test("postcode spool flushes preserve duplicate collisions and emit runtime-compatible integrity metadata", async t => {
  const directory = temporary(t);
  const spool = createGnafSpool(directory, { bufferLimit: 1 });
  const key = gnafAddressKey("1 Garden Rd Canberra ACT 2600");
  spool.add("2600", key, [-35.1, 149.1, "ADDRESS1", "PC"]);
  spool.add("2600", key, [-35.2, 149.1, "ADDRESS2", "PC"]);
  const result = await finishGnafShards(spool, directory, { version: "fixture-aug2026" });
  assert.equal(result.entries, 1);
  assert.equal(result.ambiguous, 1);
  for (const [path, metadata] of Object.entries(result.shards)) {
    const bytes = readFileSync(join(directory, path));
    const decoded = parseGnafShard(bytes, "fixture-aug2026", path);
    assert.equal(decoded.shard.entries[key], null);
    assert.equal(metadata.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(metadata.bytes, bytes.length);
    assert.equal(metadata.decodedBytes, decoded.decodedBytes);
  }
  assert.deepEqual(await finishGnafShards(spool, directory, { version: "fixture-aug2026" }), result);
});

test("source tables retain associated street aliases but never multiply unrelated locality aliases onto addresses", async t => {
  const directory = temporary(t);
  const sourceDir = join(directory, "source");
  const outputDir = join(directory, "directory");
  sourceFixture(sourceDir);
  const manifest = await buildGnafDirectory({ sourceDir, outputDir, version: "fixture-aug2026", states: ["ACT"], onProgress: () => {} });
  const validated = parseGnafManifest(readFileSync(join(outputDir, "manifest.json")));
  assert.equal(validated.recordCount, 4);
  assert.deepEqual({ ...manifest.counts, variants: undefined }, { rows: 8, active: 7, indexed: 4, withoutPostcode: 1, withoutIdentity: 0, withoutCoordinate: 2, invalidCoordinate: 1, variants: undefined });
  assert.ok(manifest.ambiguous > 0);
  const bucket = { async get(key) {
    const bytes = readFileSync(join(outputDir, key.replace(`address-directory/${validated.version}/`, "")));
    return { size: bytes.length, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  } };
  const runtime = createGnafDirectory(bucket, validated);
  const results = await runtime.resolve(["10 Garden Rd, Canberra ACT 2600, Australia", "3/20 Garden Rd Canberra ACT 2600", "10 Old Garden Rd Canberra ACT 2600", "20 Garden Rd Canberra ACT 2600", "30 Garden Rd Canberra ACT 2600", "40 Garden Rd Canberra ACT 2600", "10 Garden Rd Canberra Central ACT 2601"]);
  assert.equal(results[0].status, "located");
  assert.equal(results[0].sourceId, "ADDRESS1");
  assert.equal(results[0].approximate, true);
  assert.equal(results[1].sourceId, "ADDRESS2");
  assert.equal(results[2].sourceId, "ADDRESS1");
  assert.deepEqual(results[3], { status: "unlocated", reason: "zero_results" });
  assert.deepEqual(results[4], { status: "unlocated", reason: "ambiguous" });
  assert.deepEqual(results[5], { status: "unlocated", reason: "zero_results" });
  assert.deepEqual(results[6], { status: "unlocated", reason: "zero_results" });
  await assert.rejects(buildGnafDirectory({ sourceDir, outputDir, version: "fixture-aug2026" }), /must be empty/);
  await assert.rejects(buildGnafDirectory({ sourceDir, outputDir: join(directory, "invalid"), version: "fixture.invalid" }), /Invalid dataset version/);
});

test("durable state checkpoints resume without recounting completed rows or reusing incomplete stages", async t => {
  const directory = temporary(t);
  const sourceDir = join(directory, "source");
  const outputDir = join(directory, "directory");
  sourceFixture(sourceDir);
  await assert.rejects(buildGnafDirectory({ sourceDir, outputDir, version: "fixture-aug2026", states: ["ACT"], onProgress: text => {
    if (JSON.parse(text).phase === "addresses") throw new Error("Simulated process interruption after durable state checkpoint");
  } }), /Simulated process interruption/);
  const checkpoint = JSON.parse(readFileSync(join(outputDir, "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.completed.length, 1);
  assert.equal(checkpoint.completed[0].counts.indexed, 4);
  assert.ok(Object.keys(checkpoint.completed[0].spoolFiles).length > 0);
  const partial = join(outputDir, "state-ACT-incomplete", "spool");
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, "2600.ndjson"), "invalid partial data must not be merged");
  await assert.rejects(buildGnafDirectory({ sourceDir, outputDir, version: "different-version", states: ["ACT"], resume: true }), /does not match/);
  const events = [];
  const manifest = await buildGnafDirectory({ sourceDir, outputDir, version: "fixture-aug2026", states: ["ACT"], resume: true, onProgress: text => events.push(JSON.parse(text)) });
  assert.equal(manifest.counts.rows, 8);
  assert.equal(manifest.recordCount, 4);
  assert.deepEqual(events[0], { phase: "resumed", states: ["ACT"] });
  assert.ok(events.every(event => !event.state));
  await assert.rejects(buildGnafDirectory({ sourceDir, outputDir, version: "fixture-aug2026", states: ["ACT"], resume: true }), /complete directory is immutable/);
});

test("resume refuses a checkpoint whose completed spool was truncated", async t => {
  const directory = temporary(t);
  const sourceDir = join(directory, "source");
  const outputDir = join(directory, "directory");
  sourceFixture(sourceDir);
  await assert.rejects(buildGnafDirectory({ sourceDir, outputDir, version: "fixture-aug2026", states: ["ACT"], onProgress: text => {
    if (JSON.parse(text).phase === "addresses") throw new Error("Interrupted");
  } }), /Interrupted/);
  const checkpoint = JSON.parse(readFileSync(join(outputDir, "checkpoint.json"), "utf8"));
  const completed = checkpoint.completed[0];
  writeFileSync(join(outputDir, completed.stage, "spool", `${Object.keys(completed.spoolFiles)[0]}.ndjson`), "");
  await assert.rejects(buildGnafDirectory({ sourceDir, outputDir, version: "fixture-aug2026", states: ["ACT"], resume: true, onProgress: () => {} }), /incomplete or changed/);
});
