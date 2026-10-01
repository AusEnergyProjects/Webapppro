import { createReadStream, appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { gnafAddressKey, gnafShardForKey, GNAF_ATTRIBUTION, GNAF_LICENCE_URL } from "../src/lib/gnaf-address.ts";

export const GNAF_SOURCE_URL = "https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc/resource/b023544a-5836-4d43-b6d8-da2f73e8d2bf/download/g-naf_aug26_allstates_gda2020_psv_110.zip";
export const GNAF_SOURCE_SHA256 = "16820cc91c3ea32a3997b88024c8d0e576c1db10fe8645380be49b457e952df5";
const STATES = ["ACT", "NSW", "NT", "OT", "QLD", "SA", "TAS", "VIC", "WA"];
const MAX_LINE_BYTES = 16_384;

/** Streams PSV without retaining an entire source table or allocating a promise per row. */
export async function readGnafPsv(file, onRow) {
  let header;
  let fieldCount;
  let remainder = "";
  let lineNumber = 0;
  const consume = (line) => {
    lineNumber += 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line) return;
    if (line.length > MAX_LINE_BYTES) throw new Error(`Oversized PSV row at ${file}:${lineNumber}`);
    const fields = line.split("|");
    if (!header) {
      fields[0] = fields[0].replace(/^\uFEFF/, "");
      header = Object.fromEntries(fields.map((name, index) => [name, index]));
      fieldCount = fields.length;
      if (Object.keys(header).length !== fields.length) throw new Error(`Duplicate PSV headers: ${file}`);
      return;
    }
    if (fields.length !== fieldCount) throw new Error(`Incorrect PSV field count at ${file}:${lineNumber}`);
    onRow(fields, header);
  };
  for await (const chunk of createReadStream(file, { encoding: "utf8", highWaterMark: 1024 * 1024 })) {
    const lines = (remainder + chunk).split("\n");
    remainder = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (remainder.length > MAX_LINE_BYTES) throw new Error(`Oversized PSV row in ${file}`);
  }
  if (remainder) consume(remainder);
  if (!header) throw new Error(`Empty PSV table: ${file}`);
}

const value = (row, header, name) => row[header[name]] ?? "";
const componentNumber = (row, header, stem) => `${value(row, header, `${stem}_PREFIX`)}${value(row, header, stem)}${value(row, header, `${stem}_SUFFIX`)}`;
const words = (...parts) => parts.filter(Boolean).join(" ");

/** Only explicit address identities are generated. Unit, level and range information is never dropped. */
export function gnafAddressVariants(row, header, street, locality, authorities) {
  const first = componentNumber(row, header, "NUMBER_FIRST");
  const last = componentNumber(row, header, "NUMBER_LAST");
  const lot = componentNumber(row, header, "LOT_NUMBER");
  const unit = componentNumber(row, header, "FLAT_NUMBER");
  const level = componentNumber(row, header, "LEVEL_NUMBER");
  const unitCode = value(row, header, "FLAT_TYPE_CODE");
  const levelCode = value(row, header, "LEVEL_TYPE_CODE");
  const number = first ? `${first}${last && last !== first ? `-${last}` : ""}` : lot ? `LOT ${lot}` : "";
  const building = value(row, header, "BUILDING_NAME");
  if (!number && !building) return [];
  const unitCodes = [...new Set([unitCode || "UNIT", authorities.flat.get(unitCode)].filter(Boolean))];
  const levelCodes = [...new Set([levelCode || "LEVEL", authorities.level.get(levelCode)].filter(Boolean))];
  const subaddresses = unit || unitCode ? unitCodes.map(code => words(code, unit)) : [""];
  const levels = level || levelCode ? levelCodes.map(code => words(code, level)) : [""];
  const streetNames = street ? street.names : [""];
  const result = new Set();
  for (const sub of subaddresses) for (const floor of levels) for (const road of streetNames) for (const place of locality.names) {
    const address = words(sub, floor, number || building, road, place.name, locality.state, place.postcode);
    if (address) result.add(address);
    if (building && number) result.add(words(building, sub, floor, number, road, place.name, locality.state, place.postcode));
    // The slash convention is safe only for residential unit types with no level qualification.
    if (unit && first && !level && !levelCode && ["UNIT", "FLAT", "APT", ""].includes(unitCode)) {
      result.add(words(`${unit}/${number}`, road, place.name, locality.state, place.postcode));
    }
  }
  return [...result];
}

async function authorityNames(sourceDir, table) {
  const result = new Map();
  await readGnafPsv(join(sourceDir, "Authority Code", `Authority_Code_${table}_AUT_psv.psv`), (row, h) => {
    result.set(value(row, h, "CODE"), value(row, h, "NAME"));
  });
  return result;
}

async function loadStateNames(sourceDir, state, authorities) {
  const table = (name) => join(sourceDir, "Standard", `${state}_${name}_psv.psv`);
  const states = new Map();
  await readGnafPsv(table("STATE"), (row, h) => {
    if (!value(row, h, "DATE_RETIRED")) states.set(value(row, h, "STATE_PID"), value(row, h, "STATE_ABBREVIATION"));
  });
  const localities = new Map();
  await readGnafPsv(table("LOCALITY"), (row, h) => {
    if (value(row, h, "DATE_RETIRED")) return;
    localities.set(value(row, h, "LOCALITY_PID"), {
      name: value(row, h, "LOCALITY_NAME"), state: states.get(value(row, h, "STATE_PID")) || state,
    });
  });
  const streets = new Map();
  const roadNames = (row, h) => {
    const name = value(row, h, "STREET_NAME");
    const type = value(row, h, "STREET_TYPE_CODE");
    const suffix = value(row, h, "STREET_SUFFIX_CODE");
    return [...new Set([words(name, type, suffix), words(name, type, authorities.suffix.get(suffix) || suffix)])];
  };
  await readGnafPsv(table("STREET_LOCALITY"), (row, h) => {
    if (!value(row, h, "DATE_RETIRED")) streets.set(value(row, h, "STREET_LOCALITY_PID"), { names: roadNames(row, h) });
  });
  await readGnafPsv(table("STREET_LOCALITY_ALIAS"), (row, h) => {
    if (value(row, h, "DATE_RETIRED")) return;
    const street = streets.get(value(row, h, "STREET_LOCALITY_PID"));
    if (street) street.names = [...new Set([...street.names, ...roadNames(row, h)])];
  });
  return { table, localities, streets };
}

/** Bounded spool buffers, with one postcode held in memory during final collision reconciliation. */
export function createGnafSpool(outputDir, { bufferLimit = 16 * 1024 * 1024 } = {}) {
  const spoolDir = join(outputDir, "spool");
  mkdirSync(spoolDir, { recursive: true });
  const buffers = new Map();
  const files = new Set();
  let buffered = 0;
  const flush = (postcode) => {
    const text = buffers.get(postcode);
    if (!text) return;
    appendFileSync(join(spoolDir, `${postcode}.ndjson`), text);
    buffered -= text.length;
    buffers.delete(postcode);
  };
  return {
    files,
    add(postcode, key, tuple) {
      if (!/^\d{4}$/.test(postcode)) throw new Error("Invalid postcode shard");
      const line = `${JSON.stringify([key, tuple])}\n`;
      files.add(postcode);
      const current = (buffers.get(postcode) ?? "") + line;
      buffers.set(postcode, current);
      buffered += line.length;
      if (current.length >= 64 * 1024) flush(postcode);
      while (buffered > bufferLimit && buffers.size) flush(buffers.keys().next().value);
    },
    close({ durable = false } = {}) {
      for (const postcode of buffers.keys()) flush(postcode);
      if (durable) for (const postcode of files) {
        const descriptor = openSync(join(spoolDir, `${postcode}.ndjson`), "r+");
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      }
    },
    spoolDir,
  };
}

export function reconcileGnafMatch(previous, next) {
  if (previous === undefined) return next;
  if (previous === null) return null;
  // Equal source points do not need an arbitrary coordinate choice. Preserve a deterministic source identifier.
  if (previous[0] !== next[0] || previous[1] !== next[1] || previous[3] !== next[3]) return null;
  return previous[2] < next[2] ? previous : next;
}

export async function finishGnafShards(spool, outputDir, { version }) {
  spool.close();
  const shards = {};
  let entries = 0;
  let ambiguous = 0;
  let totalBytes = 0;
  let maxDecodedBytes = 0;
  for (const postcode of [...spool.files].sort()) {
    const records = new Map();
    let remainder = "";
    const consume = line => {
      if (!line) return;
      const [key, tuple] = JSON.parse(line);
      records.set(key, reconcileGnafMatch(records.get(key), tuple));
    };
    for (const directory of spool.spoolDirs ?? [spool.spoolDir]) {
      const file = join(directory, `${postcode}.ndjson`);
      if (!existsSync(file)) continue;
      for await (const chunk of createReadStream(file, { encoding: "utf8", highWaterMark: 1024 * 1024 })) {
        const lines = (remainder + chunk).split("\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) consume(line);
      }
      if (remainder) consume(remainder);
      remainder = "";
    }
    const buckets = new Map();
    for (const key of [...records.keys()].sort()) {
      const relative = gnafShardForKey(key);
      const bucket = relative.split("/")[1].split(".")[0];
      if (!buckets.has(bucket)) buckets.set(bucket, Object.create(null));
      const tuple = records.get(key);
      buckets.get(bucket)[key] = tuple;
      entries += 1;
      if (tuple === null) ambiguous += 1;
    }
    for (const [bucket, matches] of buckets) {
      const relative = `${postcode}/${bucket}.json.gz`;
      const decoded = JSON.stringify({ schema: 1, version, postcode, bucket, entries: matches });
      const data = gzipSync(decoded, { level: 9 });
      if (Buffer.byteLength(decoded) > 8 * 1024 * 1024 || data.length > 2 * 1024 * 1024) throw new Error(`Shard exceeds runtime memory bound: ${relative}`);
      mkdirSync(join(outputDir, postcode), { recursive: true });
      const destination = join(outputDir, relative);
      // Finalisation can be interrupted after some immutable shards are written.
      // Reuse only byte-identical shards; never silently overwrite a different build.
      if (existsSync(destination)) {
        if (!readFileSync(destination).equals(data)) throw new Error(`Existing shard differs: ${relative}`);
      } else writeFileSync(destination, data, { flag: "wx" });
      shards[relative] = { bytes: data.length, decodedBytes: Buffer.byteLength(decoded), sha256: createHash("sha256").update(data).digest("hex"), entries: Object.keys(matches).length };
      totalBytes += data.length;
      maxDecodedBytes = Math.max(maxDecodedBytes, Buffer.byteLength(decoded));
    }
  }
  return { shards, entries, ambiguous, totalBytes, maxDecodedBytes };
}

export async function buildGnafDirectory({ sourceDir, outputDir, version, states = STATES, onProgress = console.log, sourceSha256 = GNAF_SOURCE_SHA256, sourceUrl = GNAF_SOURCE_URL, resume = false }) {
  if (!/^[a-z0-9-]{1,60}$/.test(version)) throw new Error("Invalid dataset version");
  if (!states.length || new Set(states).size !== states.length || states.some(state => !STATES.includes(state))) throw new Error("Invalid jurisdictions");
  if (!resume && existsSync(outputDir) && readdirSync(outputDir).length) throw new Error("Output directory must be empty; builds never overwrite a previous release");
  if (existsSync(join(outputDir, "manifest.json"))) throw new Error("A complete directory is immutable");
  mkdirSync(outputDir, { recursive: true });
  const started = Date.now();
  const checkpointPath = join(outputDir, "checkpoint.json");
  const normalizerSha256 = createHash("sha256").update(readFileSync(new URL("../src/lib/gnaf-address.ts", import.meta.url))).digest("hex");
  const identity = { schema: 1, version, sourceDir: resolve(sourceDir), sourceSha256, sourceUrl, states, normalizerSha256 };
  let checkpoint = { ...identity, completed: [], elapsedSeconds: 0 };
  if (resume) {
    checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
    if (Object.entries(identity).some(([key, value]) => JSON.stringify(checkpoint[key]) !== JSON.stringify(value)) || !Array.isArray(checkpoint.completed)) throw new Error("Checkpoint does not match this source and builder configuration");
    if (checkpoint.completed.some((entry, index) => entry.state !== states[index] || !/^state-[A-Z]{2,3}-[a-f0-9-]{36}$/.test(entry.stage))) throw new Error("Invalid checkpoint stages");
    for (const stage of checkpoint.completed) for (const [postcode, size] of Object.entries(stage.spoolFiles)) {
      if (!/^\d{4}$/.test(postcode) || !Number.isSafeInteger(size) || size < 1 || statSync(join(outputDir, stage.stage, "spool", `${postcode}.ndjson`)).size !== size) throw new Error("Checkpoint spool is incomplete or changed");
    }
  }
  const previousElapsedSeconds = checkpoint.elapsedSeconds;
  const saveCheckpoint = () => {
    checkpoint.elapsedSeconds = previousElapsedSeconds + (Date.now() - started) / 1000;
    writeFileSync(`${checkpointPath}.tmp`, JSON.stringify(checkpoint), { flush: true });
    renameSync(`${checkpointPath}.tmp`, checkpointPath);
  };
  if (!resume) saveCheckpoint();
  const authorities = { flat: await authorityNames(sourceDir, "FLAT_TYPE"), level: await authorityNames(sourceDir, "LEVEL_TYPE"), suffix: await authorityNames(sourceDir, "STREET_SUFFIX") };
  const counts = { rows: 0, active: 0, indexed: 0, withoutPostcode: 0, withoutIdentity: 0, withoutCoordinate: 0, invalidCoordinate: 0, variants: 0 };
  const stateCounts = {};
  for (const completed of checkpoint.completed) {
    for (const key of Object.keys(counts)) counts[key] += completed.counts[key];
    stateCounts[completed.state] = completed.summary;
  }
  if (resume) onProgress(JSON.stringify({ phase: "resumed", states: checkpoint.completed.map(entry => entry.state) }));
  for (const state of states.slice(checkpoint.completed.length)) {
    const stateStarted = Date.now();
    const beforeCounts = { ...counts };
    // A partial state's files are never reused: a new isolated stage makes
    // recovery deterministic without truncating or deleting prior work.
    const stage = `state-${state}-${randomUUID()}`;
    const stageDir = join(outputDir, stage);
    const spool = createGnafSpool(stageDir);
    const { table, localities, streets } = await loadStateNames(sourceDir, state, authorities);
    const db = new DatabaseSync(join(stageDir, "geocodes.sqlite"));
    db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-131072; CREATE TABLE geocodes(pid TEXT PRIMARY KEY,lat REAL,lng REAL,kind TEXT) WITHOUT ROWID; BEGIN;");
    const insert = db.prepare("INSERT INTO geocodes(pid,lat,lng,kind) VALUES (?,?,?,?)");
    let loaded = 0;
    await readGnafPsv(table("ADDRESS_DEFAULT_GEOCODE"), (row, h) => {
      if (value(row, h, "DATE_RETIRED")) return;
      const latString = value(row, h, "LATITUDE");
      const lngString = value(row, h, "LONGITUDE");
      const lat = Number(latString), lng = Number(lngString);
      if (!latString || !lngString || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -55 || lat > -9 || lng < 96 || lng > 169) { counts.invalidCoordinate += 1; return; }
      insert.run(value(row, h, "ADDRESS_DETAIL_PID"), lat, lng, value(row, h, "GEOCODE_TYPE_CODE"));
      loaded += 1;
    });
    db.exec("COMMIT;");
    onProgress(JSON.stringify({ state, phase: "coordinates", loaded, elapsedSeconds: (Date.now() - stateStarted) / 1000 }));
    const find = db.prepare("SELECT lat,lng,kind FROM geocodes WHERE pid=?");
    const before = counts.indexed;
    await readGnafPsv(table("ADDRESS_DETAIL"), (row, h) => {
      counts.rows += 1;
      if (value(row, h, "DATE_RETIRED")) return;
      counts.active += 1;
      const postcode = value(row, h, "POSTCODE");
      if (!/^\d{4}$/.test(postcode)) { counts.withoutPostcode += 1; return; }
      const locality = localities.get(value(row, h, "LOCALITY_PID"));
      if (!locality) { counts.withoutIdentity += 1; return; }
      const pid = value(row, h, "ADDRESS_DETAIL_PID");
      const coordinate = find.get(pid);
      if (!coordinate) { counts.withoutCoordinate += 1; return; }
      // A locality alias can represent only part of a large locality. Applying every alias
      // to every address creates unverified identities, so use its actual locality only.
      const names = [{ name: locality.name, postcode }];
      const addresses = gnafAddressVariants(row, h, streets.get(value(row, h, "STREET_LOCALITY_PID")), { state: locality.state, names }, authorities);
      if (!addresses.length) { counts.withoutIdentity += 1; return; }
      const keys = new Set();
      for (const address of addresses) {
        const key = gnafAddressKey(address);
        if (!key) continue;
        const variantPostcode = key.slice(-4);
        if (keys.has(key)) continue;
        keys.add(key);
        spool.add(variantPostcode, key, [coordinate.lat, coordinate.lng, pid, coordinate.kind]);
        counts.variants += 1;
      }
      if (keys.size) counts.indexed += 1;
      else counts.withoutIdentity += 1;
    });
    db.close();
    spool.close({ durable: true });
    stateCounts[state] = { coordinates: loaded, indexed: counts.indexed - before, elapsedSeconds: (Date.now() - stateStarted) / 1000 };
    checkpoint.completed.push({ state, stage, summary: stateCounts[state], counts: Object.fromEntries(Object.keys(counts).map(key => [key, counts[key] - beforeCounts[key]])), spoolFiles: Object.fromEntries([...spool.files].map(postcode => [postcode, statSync(join(spool.spoolDir, `${postcode}.ndjson`)).size])) });
    saveCheckpoint();
    onProgress(JSON.stringify({ state, phase: "addresses", ...stateCounts[state], heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }));
  }
  const spool = {
    close() {},
    files: new Set(checkpoint.completed.flatMap(entry => Object.keys(entry.spoolFiles))),
    spoolDirs: checkpoint.completed.map(entry => join(outputDir, entry.stage, "spool")),
  };
  onProgress(JSON.stringify({ phase: "shards", postcodes: spool.files.size }));
  const result = await finishGnafShards(spool, outputDir, { version });
  const manifest = {
    schema: 1, version, sourceUrl, sourceSha256, attribution: GNAF_ATTRIBUTION, datum: "EPSG:7844", recordCount: counts.indexed,
    source: { url: sourceUrl, sha256: sourceSha256, dataset: "G-NAF", datum: "EPSG:7844", mapTransform: "EPSG:8450 (null transform to WGS84 ensemble; 3m datum-level uncertainty)" },
    licence: { url: GNAF_LICENCE_URL, attribution: GNAF_ATTRIBUTION, adaptation: "Joined active G-NAF tables; principal localities and explicit street aliases; normalized exact address identities; postcode shards; ambiguous identities retained without a coordinate.", disclaimer: "Source data is supplied as-is without warranties. Not proof of postal deliverability or surveyed boundaries." },
    createdAt: new Date().toISOString(), elapsedSeconds: previousElapsedSeconds + (Date.now() - started) / 1000, counts, jurisdictions: stateCounts, ...result,
  };
  writeFileSync(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) throw new Error("Use --source=<extracted release directory> --output=<new directory> --version=<version>");
    return [match[1], match[2]];
  }));
  if (!options.source || !options.output || !options.version) throw new Error("Missing source, output or version");
  if (!statSync(options.source).isDirectory()) throw new Error("Source directory does not exist");
  const manifest = await buildGnafDirectory({ sourceDir: resolve(options.source), outputDir: resolve(options.output), version: options.version, states: options.states?.split(","), resume: options.resume === "true" });
  console.log(JSON.stringify({ complete: true, counts: manifest.counts, bytes: manifest.totalBytes, shards: Object.keys(manifest.shards).length, elapsedSeconds: manifest.elapsedSeconds }));
}
