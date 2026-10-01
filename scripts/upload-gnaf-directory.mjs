import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GNAF_MAX_MANIFEST_BYTES, parseGnafManifest, parseGnafShard } from "../src/lib/gnaf-directory.ts";

const ORIGINS = new Set(["https://ausenergyassessments.com", "https://aea-energy-comparison.info294029.chatgpt.site"]);
const REPOSITORY = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const VERIFY_BATCH = 250;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function within(parent, path) {
  const location = relative(parent, path);
  return !!location && !isAbsolute(location) && location !== ".." && !location.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function localFile(directory, part) {
  const file = realpathSync(join(directory, part));
  if (!within(directory, file) || !statSync(file).isFile()) throw new Error("Directory data files must remain inside the selected data directory.");
  return file;
}

function uploadOptions(value) {
  if (!object(value) || !ORIGINS.has(value.origin) || typeof value.directory !== "string" || !isAbsolute(value.directory)
    || typeof value.token !== "string" || !/^[\x21-\x7e]{32,256}$/.test(value.token)
    || typeof value.version !== "string" || !/^[a-z0-9-]{1,60}$/.test(value.version)) {
    throw new Error("Provide an approved HTTPS origin, absolute data directory, valid maintenance token and directory version through hidden stdin.");
  }
  const directory = realpathSync(value.directory);
  if (directory === REPOSITORY || within(REPOSITORY, directory)) {
    throw new Error("The data directory and upload journal must be outside the repository.");
  }
  if (!statSync(directory).isDirectory()) throw new Error("The data directory does not exist.");
  return { origin: value.origin, directory, token: value.token, version: value.version };
}

async function smallJson(response) {
  if (!response.body) throw new Error("Directory server returned an empty response.");
  const reader = response.body.getReader();
  let text = "", size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 32_768) { await reader.cancel(); throw new Error("Directory server returned an oversized response."); }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch { throw new Error("Directory server returned an invalid response."); }
  finally { reader.releaseLock(); }
}

/** Local data stays outside Git; the journal contains only acknowledged partition hashes. */
export async function uploadGnafDirectory(input, { request = fetch, log = value => process.stdout.write(`${JSON.stringify(value)}\n`) } = {}) {
  const options = uploadOptions(input);
  const manifestPath = localFile(options.directory, "manifest.json");
  if (statSync(manifestPath).size > GNAF_MAX_MANIFEST_BYTES) throw new Error("Local manifest exceeds the size limit.");
  const manifestBytes = readFileSync(manifestPath), manifest = parseGnafManifest(manifestBytes);
  if (manifest.version !== options.version) throw new Error("Local manifest version differs from the requested version.");
  const manifestSha256 = sha256(manifestBytes), parts = Object.keys(manifest.shards).sort();
  const binding = { schema: 1, origin: options.origin, version: options.version, manifestSha256 };
  const journalPath = join(options.directory, `.upload-${sha256(JSON.stringify(binding)).slice(0, 20)}.json`);
  const completed = new Set();
  if (existsSync(journalPath)) {
    if (!lstatSync(journalPath).isFile()) throw new Error("The upload journal must be a regular local file.");
    if (statSync(journalPath).size > 4 * 1024 * 1024) throw new Error("Upload journal exceeds its size limit.");
    let saved;
    try { saved = JSON.parse(readFileSync(journalPath, "utf8")); } catch { throw new Error("The upload journal is invalid; preserve it for inspection before restarting."); }
    if (!object(saved) || Object.entries(binding).some(([key, value]) => saved[key] !== value)
      || !object(saved.uploaded) || Object.entries(saved.uploaded).some(([part, hash]) => manifest.shards[part]?.sha256 !== hash)) {
      throw new Error("The upload journal does not match this origin, version and manifest.");
    }
    for (const part of Object.keys(saved.uploaded)) completed.add(part);
  }
  function checkpoint(stage) {
    const uploaded = Object.fromEntries([...completed].sort().map(part => [part, manifest.shards[part].sha256]));
    const temporary = `${journalPath}.${randomUUID()}.next`;
    try {
      writeFileSync(temporary, JSON.stringify({ ...binding, stage, uploaded }), { mode: 0o600, flag: "wx" });
      renameSync(temporary, journalPath);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  async function call(method, parameters, body) {
    const url = new URL("/api/admin/address-directory", options.origin);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    let response;
    try {
      response = await request(url, { method, redirect: "error", signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${options.token}`, "Content-Type": method === "PUT" ? "application/octet-stream" : "application/json" }, body });
    } catch { throw new Error("Directory upload connection failed. Rerun with the same directory and version to resume."); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Directory ${method === "PUT" ? "upload" : "verification"} failed (HTTP ${response.status}). Saved progress is retained.`);
    }
    const result = await smallJson(response);
    if (!object(result) || result.ok !== true) throw new Error("Directory server did not confirm the operation.");
    return result;
  }
  async function uploadPart(part) {
    const expected = manifest.shards[part], file = localFile(options.directory, part);
    if (statSync(file).size !== expected.bytes) throw new Error(`Local partition size differs: ${part}`);
    const bytes = readFileSync(file);
    if (sha256(bytes) !== expected.sha256) throw new Error(`Local partition checksum differs: ${part}`);
    const { shard, decodedBytes } = parseGnafShard(bytes, options.version, part);
    if (decodedBytes !== expected.decodedBytes || Object.keys(shard.entries).length !== expected.entries) throw new Error(`Local partition content differs: ${part}`);
    const result = await call("PUT", { version: options.version, part }, bytes);
    if (result.sha256 !== expected.sha256 || result.bytes !== expected.bytes) throw new Error(`Directory server did not confirm the partition checksum: ${part}`);
    completed.add(part);
    if (completed.size % 32 === 0) { checkpoint("uploading"); log({ stage: "uploading", uploaded: completed.size, total: parts.length }); }
  }
  log({ stage: "starting", version: options.version, resumed: completed.size, total: parts.length });
  const pending = parts.filter(part => !completed.has(part));
  let next = 0, failure;
  async function worker() {
    while (!failure && next < pending.length) {
      const part = pending[next++];
      try { await uploadPart(part); }
      catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  checkpoint(failure ? "paused" : "uploaded");
  if (failure) throw failure;
  const uploadedManifest = await call("PUT", { version: options.version, part: "manifest.json" }, manifestBytes);
  if (uploadedManifest.sha256 !== manifestSha256 || uploadedManifest.bytes !== manifestBytes.length) throw new Error("Directory server did not confirm the manifest checksum.");
  for (let offset = 0; offset < parts.length; offset += VERIFY_BATCH) {
    const result = await call("POST", {}, JSON.stringify({ action: "verify", version: options.version, offset }));
    const verified = Math.min(offset + VERIFY_BATCH, parts.length), nextOffset = verified < parts.length ? verified : null;
    if (result.verified !== verified || result.total !== parts.length || result.nextOffset !== nextOffset) throw new Error("Directory verification returned an unexpected partition count.");
    log({ stage: "verifying", verified, total: parts.length });
  }
  checkpoint("verified");
  const activated = await call("POST", {}, JSON.stringify({ action: "activate", version: options.version }));
  if (activated.version !== options.version || activated.records !== manifest.recordCount || activated.partitions !== parts.length) throw new Error("Directory activation was not confirmed.");
  checkpoint("active");
  const result = { stage: "active", version: options.version, records: activated.records, partitions: activated.partitions, journalPath };
  log(result);
  return result;
}

async function hiddenInput() {
  const terminal = process.stdin.isTTY;
  if (terminal) process.stdin.setRawMode(true);
  process.stderr.write("Ready for directory upload JSON (input hidden).\n");
  try {
    const input = await new Promise((resolveInput, reject) => {
      let input = "";
      process.stdin.setEncoding("utf8");
      function finish(error) {
        process.stdin.pause(); process.stdin.removeListener("data", data); process.stdin.removeListener("end", end);
        if (error) reject(error); else resolveInput(input.trim());
      }
      function data(chunk) {
        input += chunk;
        if (input.includes("\u0003")) finish(new Error("Upload cancelled."));
        else if (input.length > 16_384) finish(new Error("Upload input exceeds its size limit."));
        else if (/[\r\n]/.test(input)) finish();
      }
      function end() { finish(); }
      process.stdin.on("data", data); process.stdin.on("end", end);
    });
    try { return JSON.parse(input); } catch { throw new Error("Upload input must be one JSON object."); }
  } finally { if (terminal) process.stdin.setRawMode(false); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Pass upload settings through hidden stdin only.");
    await uploadGnafDirectory(await hiddenInput());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Directory upload failed."}\n`);
    process.exitCode = 1;
  }
}
