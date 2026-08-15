import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL(
  "../tmp/official-sources/source-manifest.json",
  import.meta.url,
);
const outputPath = new URL(
  "../src/data/creditex-official-source-custody-candidates-2026-08-15.json",
  import.meta.url,
);
const expectedSourceManifestSha256 =
  "56a1fd50cea659f3d7e81d413f1fd69a7aeeefe6149501aef4291c8e8a9b66a3";
const approvedRegulatorHosts = new Set(["www.qca.org.au"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalContentType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function governmentHost(value) {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || !(
      host === "gov.au"
      || host.endsWith(".gov.au")
      || approvedRegulatorHosts.has(host)
    )
  ) {
    throw new Error(`Non-government custody candidate URL: ${value}`);
  }
  parsed.hostname = host;
  parsed.hash = "";
  return { url: parsed.toString(), host };
}

const sourceBytes = await readFile(sourcePath);
const sourceManifestSha256 = sha256(sourceBytes);
if (sourceManifestSha256 !== expectedSourceManifestSha256) {
  throw new Error(
    `Official source audit manifest changed: ${sourceManifestSha256}`,
  );
}
const sourceManifest = JSON.parse(sourceBytes.toString("utf8"));
const candidates = sourceManifest.sources
  .filter((source) =>
    source.authorityClass === "government_or_regulator"
    && source.custodyIngestionCandidate === true
    && source.operationallyApproved === false
    && source.independentlyReviewed === false
    && source.httpStatus === 200
  )
  .map((source) => {
    const official = governmentHost(source.officialUrl);
    const final = governmentHost(source.finalUrl);
    const expectedContentType = normalContentType(source.contentType);
    if (!/^[0-9a-f]{64}$/.test(source.sha256)) {
      throw new Error(`Invalid source SHA-256: ${source.sourceId}`);
    }
    if (
      !Number.isSafeInteger(source.bytes)
      || source.bytes < 1
      || source.bytes > 15 * 1024 * 1024
    ) {
      throw new Error(`Invalid source byte size: ${source.sourceId}`);
    }
    return {
      sourceId: source.sourceId,
      programCodes: [...source.programCodes].sort(),
      authorityClass: "government_or_regulator",
      authorityHost: official.host,
      officialUrl: official.url,
      expectedFinalAuthorityHost: final.host,
      expectedFinalUrl: final.url,
      sourceTitle: String(source.title || source.officialFilename).trim(),
      sourceVersion: String(
        source.statedVersion || source.statedEffectiveDate || "",
      ).trim(),
      statedEffectiveDate: String(source.statedEffectiveDate || "").trim(),
      originalFileName: String(source.officialFilename).trim(),
      expectedContentType,
      expectedSizeBytes: source.bytes,
      expectedSha256: source.sha256,
      observedOn: source.observedOn,
      pendingIndependentCreditexReview: true,
      operationallyApproved: false,
    };
  })
  .sort((left, right) => left.sourceId.localeCompare(right.sourceId));

if (candidates.length !== 167) {
  throw new Error(`Expected 167 custody candidates, found ${candidates.length}`);
}
if (new Set(candidates.map((candidate) => candidate.sourceId)).size !== 167) {
  throw new Error("Official source custody candidate IDs are not unique.");
}

const output = {
  contract: "creditex-official-source-custody-import/v1",
  observedOn: sourceManifest.observedOn,
  sourceAuditManifestSha256: sourceManifestSha256,
  candidateCount: candidates.length,
  authorityBoundary: "australian_government_or_regulator_https_only",
  custodyBoundary:
    "Exact expected bytes only. Import creates immutable pending-review custody artifacts. It does not approve, bind, publish, mark current, or enable any rule, claim or certificate action.",
  candidates,
};
const encoded = `${JSON.stringify(output, null, 2)}\n`;
await writeFile(outputPath, encoded, "utf8");
console.log(JSON.stringify({
  output: outputPath.pathname,
  candidates: candidates.length,
  bytes: Buffer.byteLength(encoded),
  sha256: sha256(encoded),
}));
