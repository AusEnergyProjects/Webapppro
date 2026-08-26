import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ENERGY_ASSISTANT_KNOWLEDGE } from "../src/data/energy-assistant-knowledge.ts";
import {
  SURGE_ASSESSOR_EDUCATION_CARDS,
  SURGE_ASSESSOR_EDUCATION_TOPIC_IDS,
} from "../src/data/surge-assessor-education.ts";
import {
  SURGE_ASSESSOR_EDUCATION_REVIEW,
  SURGE_ASSESSOR_EDUCATION_SOURCE_CONTRACT,
  SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY,
  SURGE_ASSESSOR_EDUCATION_SOURCES,
} from "../src/data/surge-assessor-education-sources.ts";

const EXPECTED_SOURCE_IDS = Object.freeze([
  "electric-saul-editorial",
  "home-by-evidence",
  "drive-the-transition",
  "comfort-by-design",
  "power-you-control",
  "comfort-you-control",
  "community-informed-response-guide",
]);

const SOURCE_ROOT_ENV = "SURGE_ASSESSOR_EDUCATION_SOURCE_ROOT";
const sourceRoot = path.resolve(
  process.env[SOURCE_ROOT_ENV]?.trim() || path.join(homedir(), "Downloads"),
);

const REQUIRED_TOPICS = Object.freeze([
  "identity",
  "answer_first_novice_teaching",
  "highest_value_follow_up",
  "good_better_best",
  "building_diagnostics",
  "draught_ventilation_moisture",
  "insulation_windows",
  "heating_cooling",
  "hot_water",
  "appliances",
  "solar",
  "battery",
  "tariffs",
  "ev_mobility",
  "renter_strata",
  "safety_escalation",
  "product_model_comparison",
  "rebates_current_data",
  "evidence_uncertainty",
]);

const EXPECTED_CARD_IDS = Object.freeze([
  "surge-identity-provider-neutral-guide",
  "teach-answer-first-for-novices",
  "ask-one-decision-changing-question",
  "good-better-best-by-evidence-and-fit",
  "diagnose-the-home-before-prescribing",
  "control-water-and-ventilation-before-sealing",
  "treat-insulation-and-windows-as-systems",
  "reduce-heating-and-cooling-load-first",
  "size-hot-water-around-real-demand",
  "compare-appliances-by-the-job-and-annual-energy",
  "size-solar-from-site-and-load-profile",
  "give-the-battery-a-measured-job",
  "compare-the-whole-tariff-with-real-loads",
  "solve-the-mobility-need-before-the-vehicle",
  "adapt-the-path-for-renters-and-strata",
  "stop-and-escalate-at-hazard-boundaries",
  "compare-exact-products-on-identical-scope",
  "verify-rebates-tariffs-and-current-facts-live",
  "label-evidence-assumptions-and-uncertainty",
]);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PDF_FILE_NAME_PATTERN = /^[^/\\]+\.pdf$/iu;
const UNICODE_DASH_PATTERN = /[\u2010-\u2015\u2212]/u;
const FILE_NAME_PATTERN = /\b[^\s/\\]+\.pdf\b/iu;
const VOLATILE_CLAIM_PATTERNS = [
  /\$\s*\d/u,
  /\b\d+(?:\.\d+)?\s*(?:%|c\/kwh)\b/iu,
  /https?:\/\//iu,
  /\b20\d{2}-\d{2}-\d{2}\b/u,
];
const UNSAFE_WINNER_PATTERNS = [
  /\b(?:clear|outright|universal) winner\b/iu,
  /\b(?:the|our) best (?:brand|model|product|installer|retailer|tariff)\b/iu,
  /\b(?:number one|top pick) (?:brand|model|product|installer|retailer|tariff)\b/iu,
  /\bguaranteed (?:savings|payback|performance|eligibility)\b/iu,
];

const failures = [];
const sorted = (values) => [...values].sort();
const sameStrings = (left, right) =>
  JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const present = (value) => typeof value === "string" && value.trim().length > 0;

if (
  SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.contract !==
  SURGE_ASSESSOR_EDUCATION_SOURCE_CONTRACT
) {
  failures.push("The source custody contract is missing or unsupported.");
}

if (
  !present(SURGE_ASSESSOR_EDUCATION_REVIEW.preparedBy) ||
  !present(SURGE_ASSESSOR_EDUCATION_REVIEW.custodyVerifiedBy) ||
  SURGE_ASSESSOR_EDUCATION_REVIEW.preparedBy ===
    SURGE_ASSESSOR_EDUCATION_REVIEW.custodyVerifiedBy
) {
  failures.push("The editorial preparer and custody verifier must be distinct.");
}

if (
  SURGE_ASSESSOR_EDUCATION_REVIEW.status !==
    "reviewed_for_editorial_use" ||
  !ISO_DATE_PATTERN.test(SURGE_ASSESSOR_EDUCATION_REVIEW.reviewedOn) ||
  SURGE_ASSESSOR_EDUCATION_REVIEW.independentSubjectMatterReview !==
    "outstanding"
) {
  failures.push(
    "The editorial review status, date or independent subject-matter review state is invalid.",
  );
}

if (
  SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.classification !==
    "editorial_primary" ||
  SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.currentFactBoundary !==
    "verify_with_current_official_sources"
) {
  failures.push("The custody-level editorial or current-fact boundary is invalid.");
}

const sourceIds = SURGE_ASSESSOR_EDUCATION_SOURCES.map((source) => source.id);
if (!sameStrings(sourceIds, EXPECTED_SOURCE_IDS)) {
  failures.push("The education source manifest IDs do not match the reviewed seven-source set.");
}
if (new Set(sourceIds).size !== sourceIds.length) {
  failures.push("The education source manifest contains duplicate IDs.");
}
if (
  SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.sourceCount !== 7 ||
  SURGE_ASSESSOR_EDUCATION_SOURCES.length !== 7
) {
  failures.push("The education source manifest must contain exactly seven sources.");
}

const sourcesById = new Map(
  SURGE_ASSESSOR_EDUCATION_SOURCES.map((source) => [source.id, source]),
);
let sourceRootAvailable = false;
try {
  sourceRootAvailable = statSync(sourceRoot).isDirectory();
} catch {
  sourceRootAvailable = false;
}
if (!sourceRootAvailable) {
  failures.push(
    `Education source root is unavailable. Set ${SOURCE_ROOT_ENV} to the folder containing all seven supplied PDFs.`,
  );
}

for (const source of SURGE_ASSESSOR_EDUCATION_SOURCES) {
  const sourceId = source.id;
  if (!ID_PATTERN.test(source.id) || !present(source.title)) {
    failures.push(`${sourceId}: source identity is invalid.`);
  }
  if (
    !Number.isInteger(source.pageCount) ||
    source.pageCount < 1 ||
    !Number.isInteger(source.byteLength) ||
    source.byteLength < 1 ||
    !SHA256_PATTERN.test(source.pdfSha256) ||
    !SHA256_PATTERN.test(source.extractedTextSha256)
  ) {
    failures.push(`${sourceId}: page count, byte length or custody hash is invalid.`);
  }
  if (
    !present(source.sourceFileName) ||
    !PDF_FILE_NAME_PATTERN.test(source.sourceFileName) ||
    path.basename(source.sourceFileName) !== source.sourceFileName
  ) {
    failures.push(`${sourceId}: controlled source filename is invalid.`);
  }
  if (
    source.classification !== "editorial_primary" ||
    source.officialEvidence !== false ||
    source.regulatoryEvidence !== false ||
    source.mayAnswerCurrentFacts !== false ||
    source.currentFactBoundary !== "verify_with_current_official_sources"
  ) {
    failures.push(`${sourceId}: editorial-only authority restrictions changed.`);
  }

  if (!sourceRootAvailable || !PDF_FILE_NAME_PATTERN.test(source.sourceFileName)) {
    continue;
  }

  const sourcePath = path.resolve(sourceRoot, source.sourceFileName);
  const sourceRelativePath = path.relative(sourceRoot, sourcePath);
  if (
    sourceRelativePath.startsWith("..") ||
    path.isAbsolute(sourceRelativePath)
  ) {
    failures.push(`${sourceId}: source path escapes the controlled source root.`);
    continue;
  }

  let sourceBytes;
  try {
    sourceBytes = readFileSync(sourcePath);
  } catch {
    failures.push(`${sourceId}: external PDF is unavailable in the controlled source root.`);
    continue;
  }

  if (sourceBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    failures.push(`${sourceId}: controlled source is not a PDF file.`);
  }
  if (sourceBytes.byteLength !== source.byteLength) {
    failures.push(
      `${sourceId}: controlled PDF byte length does not match the source manifest.`,
    );
  }
  const actualPdfSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualPdfSha256 !== source.pdfSha256) {
    failures.push(`${sourceId}: controlled PDF SHA-256 does not match the source manifest.`);
  }
}

const totalPages = SURGE_ASSESSOR_EDUCATION_SOURCES.reduce(
  (sum, source) => sum + source.pageCount,
  0,
);
if (
  totalPages !== 465 ||
  SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.totalPageCount !== 465
) {
  failures.push(`Expected 465 pages of custody, found ${totalPages}.`);
}

const extraction = SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.extraction;
if (
  extraction.primaryTextEngine !== "pypdf 6.10.0" ||
  extraction.verificationTextEngine !== "pdfplumber 0.11.9" ||
  extraction.pageCountEngine !== "Poppler pdfinfo" ||
  extraction.pagesProcessedByPrimary !== 465 ||
  extraction.pagesProcessedByVerification !== 465 ||
  extraction.emptyPageCount !== 0 ||
  extraction.nearEmptyPageCount !== 0 ||
  extraction.extractionErrorCount !== 0
) {
  failures.push("The reviewed full-page extraction coverage changed.");
}

const topicRegistry = [...SURGE_ASSESSOR_EDUCATION_TOPIC_IDS];
if (!sameStrings(topicRegistry, REQUIRED_TOPICS)) {
  failures.push("The education topic registry does not cover the required scope.");
}

const cardIds = SURGE_ASSESSOR_EDUCATION_CARDS.map((card) => card.id);
if (!sameStrings(cardIds, EXPECTED_CARD_IDS)) {
  failures.push("The reviewed education card IDs changed or are incomplete.");
}
if (new Set(cardIds).size !== cardIds.length) {
  failures.push("The education cards contain duplicate IDs.");
}

const officialSourceIds = new Set(
  ENERGY_ASSISTANT_KNOWLEDGE.filter((source) => source.official).map(
    (source) => source.id,
  ),
);
const coveredTopics = new Set();
const referencedEducationSources = new Set();

for (const card of SURGE_ASSESSOR_EDUCATION_CARDS) {
  if (!ID_PATTERN.test(card.id)) {
    failures.push(`${card.id}: card ID is invalid.`);
  }
  if (
    !present(card.title) ||
    !present(card.answerFirst) ||
    !present(card.why) ||
    !present(card.safetyBoundary)
  ) {
    failures.push(`${card.id}: required customer education content is missing.`);
  }
  if (card.decisionQuestions.length < 2 || card.decisionQuestions.some((item) => !present(item))) {
    failures.push(`${card.id}: at least two decision questions are required.`);
  }
  if (
    card.currentFactBoundary !== "verify_with_current_official_sources" ||
    card.review.status !== "reviewed_for_editorial_use" ||
    card.review.preparedBy !== SURGE_ASSESSOR_EDUCATION_REVIEW.preparedBy ||
    card.review.custodyVerifiedBy !==
      SURGE_ASSESSOR_EDUCATION_REVIEW.custodyVerifiedBy ||
    card.review.reviewedOn !== SURGE_ASSESSOR_EDUCATION_REVIEW.reviewedOn ||
    card.review.independentSubjectMatterReview !== "outstanding" ||
    card.review.preparedBy === card.review.custodyVerifiedBy
  ) {
    failures.push(`${card.id}: review or current-fact restriction is invalid.`);
  }
  if (card.topics.length === 0) {
    failures.push(`${card.id}: at least one topic is required.`);
  }
  for (const topic of card.topics) {
    if (!REQUIRED_TOPICS.includes(topic)) {
      failures.push(`${card.id}: unknown topic ${topic}.`);
    }
    coveredTopics.add(topic);
  }
  if (card.pageReferences.length === 0) {
    failures.push(`${card.id}: page references are required.`);
  }
  for (const reference of card.pageReferences) {
    const source = sourcesById.get(reference.sourceId);
    if (!source) {
      failures.push(`${card.id}: unknown education source ${reference.sourceId}.`);
      continue;
    }
    referencedEducationSources.add(reference.sourceId);
    if (
      !Number.isInteger(reference.pageStart) ||
      !Number.isInteger(reference.pageEnd) ||
      reference.pageStart < 1 ||
      reference.pageEnd < reference.pageStart ||
      reference.pageEnd > source.pageCount
    ) {
      failures.push(
        `${card.id}: invalid ${reference.sourceId} page range ${reference.pageStart}-${reference.pageEnd}.`,
      );
    }
  }
  for (const officialSourceId of card.relatedOfficialSourceIds) {
    if (!officialSourceIds.has(officialSourceId)) {
      failures.push(`${card.id}: unknown official source ID ${officialSourceId}.`);
    }
  }
  if (card.optionalLadder) {
    if (
      !present(card.optionalLadder.good) ||
      !present(card.optionalLadder.better) ||
      !present(card.optionalLadder.best)
    ) {
      failures.push(`${card.id}: the optional ladder is incomplete.`);
    }
  }

  const customerContent = JSON.stringify({
    title: card.title,
    answerFirst: card.answerFirst,
    why: card.why,
    decisionQuestions: card.decisionQuestions,
    optionalLadder: card.optionalLadder,
    safetyBoundary: card.safetyBoundary,
  });
  if (FILE_NAME_PATTERN.test(customerContent)) {
    failures.push(`${card.id}: customer content exposes a PDF filename.`);
  }
  for (const pattern of VOLATILE_CLAIM_PATTERNS) {
    if (pattern.test(customerContent)) {
      failures.push(`${card.id}: customer content embeds an unverified current-fact value.`);
    }
  }
  for (const pattern of UNSAFE_WINNER_PATTERNS) {
    if (pattern.test(customerContent)) {
      failures.push(`${card.id}: customer content contains an unsafe winner claim.`);
    }
  }
}

for (const topic of REQUIRED_TOPICS) {
  if (!coveredTopics.has(topic)) {
    failures.push(`Required education topic is not covered: ${topic}.`);
  }
}
for (const sourceId of sourceIds) {
  if (!referencedEducationSources.has(sourceId)) {
    failures.push(`Education source is not referenced by any reviewed card: ${sourceId}.`);
  }
}

const goodBetterBestCard = SURGE_ASSESSOR_EDUCATION_CARDS.find((card) =>
  card.topics.includes("good_better_best"),
);
if (!goodBetterBestCard?.optionalLadder) {
  failures.push("The good, better, best method requires a complete ladder.");
}

const currentDataCards = SURGE_ASSESSOR_EDUCATION_CARDS.filter((card) =>
  card.topics.includes("rebates_current_data"),
);
if (
  currentDataCards.length === 0 ||
  currentDataCards.some(
    (card) =>
      card.relatedOfficialSourceIds.length === 0 ||
      !/current official/iu.test(card.answerFirst),
  )
) {
  failures.push("Current-data education must require current official verification.");
}

const serializedRegistry = JSON.stringify({
  custody: SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY,
  cards: SURGE_ASSESSOR_EDUCATION_CARDS,
});
if (UNICODE_DASH_PATTERN.test(serializedRegistry)) {
  failures.push("The education registry contains a Unicode dash.");
}

if (failures.length > 0) {
  throw new Error(`Surge assessor education audit failed:\n${failures.join("\n")}`);
}

console.log(
  `Surge assessor education audit passed: ${SURGE_ASSESSOR_EDUCATION_SOURCES.length} controlled source PDFs verified, ${totalPages} pages, ${SURGE_ASSESSOR_EDUCATION_CARDS.length} cards reviewed for editorial use and ${coveredTopics.size} required topics. Independent subject-matter review remains outstanding.`,
);
