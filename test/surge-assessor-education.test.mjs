import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SURGE_ASSESSOR_EDUCATION_SOURCE_CONTRACT,
  SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY,
  SURGE_ASSESSOR_EDUCATION_SOURCES,
} from "../src/data/surge-assessor-education-sources.ts";
import {
  SURGE_ASSESSOR_EDUCATION_CARDS,
  SURGE_ASSESSOR_EDUCATION_TOPIC_IDS,
  selectSurgeAssessorEducationForPrompt,
} from "../src/data/surge-assessor-education.ts";
import {
  SURGE_INDUSTRY_LIBRARY_SUMMARY,
  SURGE_INDUSTRY_LIBRARY_SOURCE_HASHES,
  selectSurgeIndustryPassagesForPrompt,
  splitSurgeQuestionFacets,
} from "../src/lib/surge-industry-library.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const CURRENT_FACT_BOUNDARY = "verify_with_current_official_sources";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function cardPublicText(card) {
  return [
    card.title,
    card.answerFirst,
    card.why,
    ...card.decisionQuestions,
    ...(card.optionalLadder ? Object.values(card.optionalLadder) : []),
    card.safetyBoundary,
  ].join("\n");
}

test("education source custody covers all seven reviewed documents and 465 pages", () => {
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CONTRACT,
    "surge-assessor-education-source-custody-v1",
  );
  assert.equal(SURGE_ASSESSOR_EDUCATION_SOURCES.length, 7);
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCES.reduce(
      (total, source) => total + source.pageCount,
      0,
    ),
    465,
  );
  assert.equal(SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.sourceCount, 7);
  assert.equal(SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.totalPageCount, 465);
  assert.deepEqual(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.sources,
    SURGE_ASSESSOR_EDUCATION_SOURCES,
  );
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.review.status,
    "reviewed_for_editorial_use",
  );
  assert.ok(SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.review.preparedBy);
  assert.ok(SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.review.custodyVerifiedBy);
  assert.notEqual(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.review.preparedBy,
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.review.custodyVerifiedBy,
  );
  assert.match(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.review.reviewedOn,
    /^\d{4}-\d{2}-\d{2}$/,
  );
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.review
      .independentSubjectMatterReview,
    "outstanding",
  );

  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.extraction.pagesProcessedByPrimary,
    465,
  );
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.extraction.pagesProcessedByVerification,
    465,
  );
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.extraction.emptyPageCount,
    0,
  );
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.extraction.nearEmptyPageCount,
    0,
  );
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.extraction.extractionErrorCount,
    0,
  );

  for (const source of SURGE_ASSESSOR_EDUCATION_SOURCES) {
    assert.ok(source.id);
    assert.ok(source.title);
    assert.match(source.sourceFileName, /\.pdf$/i, source.id);
    assert.equal(path.basename(source.sourceFileName), source.sourceFileName);
    assert.ok(source.pageCount > 0, source.id);
    assert.ok(source.byteLength > 0, source.id);
    assert.match(source.pdfSha256, SHA256, source.id);
    assert.match(source.extractedTextSha256, SHA256, source.id);
  }
});

test("editorial education sources cannot answer current regulatory or market facts", () => {
  assert.match(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.authorityBoundary,
    /not current official, regulatory, eligibility, price, tariff or product evidence/i,
  );
  assert.equal(
    SURGE_ASSESSOR_EDUCATION_SOURCE_CUSTODY.currentFactBoundary,
    CURRENT_FACT_BOUNDARY,
  );

  for (const source of SURGE_ASSESSOR_EDUCATION_SOURCES) {
    assert.equal(source.classification, "editorial_primary", source.id);
    assert.equal(source.officialEvidence, false, source.id);
    assert.equal(source.regulatoryEvidence, false, source.id);
    assert.equal(source.mayAnswerCurrentFacts, false, source.id);
    assert.equal(source.currentFactBoundary, CURRENT_FACT_BOUNDARY, source.id);
  }

  const currentFactCard = SURGE_ASSESSOR_EDUCATION_CARDS.find(
    (card) => card.topics.includes("rebates_current_data"),
  );
  assert.ok(currentFactCard);
  assert.match(currentFactCard.answerFirst, /current official record/i);
  assert.match(currentFactCard.answerFirst, /jurisdiction and as-of date/i);
  assert.match(currentFactCard.why, /can change/i);
});

test("education cards cover every topic and contain valid reviewed page references", () => {
  const sourceById = new Map(
    SURGE_ASSESSOR_EDUCATION_SOURCES.map((source) => [source.id, source]),
  );
  const cardIds = new Set();
  const coveredTopics = new Set();
  const referencedSources = new Set();

  for (const card of SURGE_ASSESSOR_EDUCATION_CARDS) {
    assert.ok(!cardIds.has(card.id), `duplicate card id: ${card.id}`);
    cardIds.add(card.id);
    assert.equal(card.review.status, "reviewed_for_editorial_use", card.id);
    assert.equal(card.review.independentSubjectMatterReview, "outstanding", card.id);
    assert.equal(card.currentFactBoundary, CURRENT_FACT_BOUNDARY, card.id);
    assert.ok(card.answerFirst.trim(), card.id);
    assert.ok(card.why.trim(), card.id);
    assert.ok(card.pageReferences.length > 0, card.id);

    for (const topic of card.topics) coveredTopics.add(topic);
    for (const reference of card.pageReferences) {
      const source = sourceById.get(reference.sourceId);
      assert.ok(source, `${card.id}: unknown source ${reference.sourceId}`);
      assert.ok(reference.pageStart >= 1, `${card.id}: invalid page start`);
      assert.ok(
        reference.pageEnd >= reference.pageStart,
        `${card.id}: page range reversed`,
      );
      assert.ok(
        reference.pageEnd <= source.pageCount,
        `${card.id}: page ${reference.pageEnd} exceeds ${source.id} page count`,
      );
      referencedSources.add(reference.sourceId);
    }
  }

  assert.deepEqual(
    [...coveredTopics].sort(),
    [...SURGE_ASSESSOR_EDUCATION_TOPIC_IDS].sort(),
  );
  assert.deepEqual(
    [...referencedSources].sort(),
    SURGE_ASSESSOR_EDUCATION_SOURCES.map((source) => source.id).sort(),
  );
});

test("public education prose has no Unicode dashes or raw custody metadata", () => {
  for (const card of SURGE_ASSESSOR_EDUCATION_CARDS) {
    const text = cardPublicText(card);
    assert.doesNotMatch(text, /[\u2013\u2014]/, card.id);
    assert.doesNotMatch(
      text,
      /sha256|pdfSha256|extractedTextSha256|byteLength|pageStart|pageEnd|pypdf|pdfplumber|Poppler/i,
      card.id,
    );
  }
});

test("response method is answer first, explanatory and limited to one decision-changing question", () => {
  const answerFirstCard = SURGE_ASSESSOR_EDUCATION_CARDS.find(
    (card) => card.topics.includes("answer_first_novice_teaching"),
  );
  const followUpCard = SURGE_ASSESSOR_EDUCATION_CARDS.find(
    (card) => card.topics.includes("highest_value_follow_up"),
  );
  assert.ok(answerFirstCard);
  assert.ok(followUpCard);
  assert.match(answerFirstCard.answerFirst, /^Lead with the practical conclusion/i);
  assert.match(answerFirstCard.answerFirst, /why it matters here/i);
  assert.match(followUpCard.answerFirst, /ask one focused question/i);
  assert.match(followUpCard.answerFirst, /largest unresolved decision risk/i);
  assert.match(followUpCard.why, /wrong assumption/i);
});

test("good, better and best describes method quality rather than a price rank", () => {
  const card = SURGE_ASSESSOR_EDUCATION_CARDS.find((candidate) =>
    candidate.topics.includes("good_better_best"),
  );
  assert.ok(card);
  assert.deepEqual(Object.keys(card.optionalLadder ?? {}), ["good", "better", "best"]);
  assert.match(card.answerFirst, /evidence quality, fit, durability and verification/i);
  assert.match(card.answerFirst, /not by purchase price or technical complexity/i);
  assert.doesNotMatch(
    Object.values(card.optionalLadder ?? {}).join(" "),
    /cheapest|most expensive|premium|budget product/i,
  );
});

test("education policy prevents a generic brand winner", () => {
  const identityCard = SURGE_ASSESSOR_EDUCATION_CARDS.find((card) =>
    card.topics.includes("identity"),
  );
  const productCard = SURGE_ASSESSOR_EDUCATION_CARDS.find((card) =>
    card.topics.includes("product_model_comparison"),
  );
  assert.ok(identityCard);
  assert.ok(productCard);
  assert.match(identityCard.answerFirst, /provider-neutral/i);
  assert.match(identityCard.answerFirst, /does not sell a brand/i);
  assert.match(productCard.answerFirst, /exact model and variant/i);
  assert.match(productCard.answerFirst, /rather than ranking brands generally/i);
  assert.doesNotMatch(cardPublicText(productCard), /best brand|brand winner|clear winner/i);
});

test("prompt selector returns a small relevant reviewed teaching set", () => {
  const selected = selectSurgeAssessorEducationForPrompt(
    "What should I do first to improve winter comfort when the ceiling insulation looks patchy?",
    4,
  );

  assert.ok(selected.length > 0);
  assert.ok(selected.length <= 4);
  assert.match(
    selected.map((card) => `${card.title} ${card.guidance}`).join("\n"),
    /insulation|ceiling|thermal envelope|heat loss/i,
  );
  for (const card of selected) {
    assert.equal(
      card.authorityBoundary,
      "verify_current_facts_with_governed_evidence",
    );
    assert.equal(Object.hasOwn(card, "pageReferences"), false);
    assert.equal(Object.hasOwn(card, "review"), false);
    assert.equal(Object.hasOwn(card, "pdfSha256"), false);
  }
});

test("controlled PDFs are pre-indexed once and retrieve bounded relevant passages", () => {
  assert.deepEqual(SURGE_INDUSTRY_LIBRARY_SUMMARY, {
    schemaVersion: 1,
    sourceCount: 7,
    pageCount: 465,
    chunkCount: 1729,
    currentFactBoundary: "verify_with_current_official_sources",
  });
  assert.deepEqual(
    SURGE_INDUSTRY_LIBRARY_SOURCE_HASHES,
    Object.fromEntries(SURGE_ASSESSOR_EDUCATION_SOURCES.map((source) => [source.id, source.pdfSha256])),
  );

  const cases = [
    [
      "When is a three-phase upgrade worth paying for with solar and a battery?",
      /three-phase|three phase|3-phase|3 phase/i,
    ],
    [
      "Should I seal a draughty window before buying double glazing or honeycomb blinds?",
      /window|glazing|draught|blind/i,
    ],
    [
      "What matters when comparing heat-pump hot-water quotes?",
      /heat pump|hot water|warranty|installation/i,
    ],
  ];

  for (const [query, expected] of cases) {
    const passages = selectSurgeIndustryPassagesForPrompt(query, 3);
    assert.ok(passages.length > 0, query);
    assert.ok(passages.length <= 3, query);
    assert.match(passages.map((passage) => passage.excerpt).join("\n"), expected, query);
    assert.ok(passages.reduce((total, passage) => total + passage.excerpt.length, 0) <= 1_500, query);
    assert.ok(passages.every(
      (passage) => passage.authorityBoundary === "stable_industry_guidance_only_verify_current_facts_officially",
    ), query);
  }

  const multiPartQuestion = "Is three-phase worth getting with solar and a battery, does it require rewiring the house, and how involved or expensive is the upgrade?";
  assert.deepEqual(splitSurgeQuestionFacets(multiPartQuestion), [
    "Is three-phase worth getting with solar and a battery",
    "does it require rewiring the house",
    "how involved or expensive is the upgrade",
  ]);
  const multiPartPassages = selectSurgeIndustryPassagesForPrompt(multiPartQuestion, 5);
  assert.ok(multiPartPassages.length >= 3);
  assert.ok(multiPartPassages.length <= 5);
  assert.match(multiPartPassages.map((passage) => passage.excerpt).join("\n"), /three-phase|three phase|3-phase|3 phase/i);
  assert.match(multiPartPassages.map((passage) => passage.excerpt).join("\n"), /rewir|switchboard|supply upgrade|upgrade cost/i);
  assert.ok(multiPartPassages.reduce((total, passage) => total + passage.excerpt.length, 0) <= 2_500);
});

test("source custody audit fails closed when supplied PDFs are unavailable", () => {
  const emptySourceRoot = mkdtempSync(
    path.join(tmpdir(), "surge-education-source-audit-"),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/audit-surge-assessor-education.mjs",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SURGE_ASSESSOR_EDUCATION_SOURCE_ROOT: emptySourceRoot,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /external PDF is unavailable|source audit failed/i,
    );
  } finally {
    rmSync(emptySourceRoot, { recursive: true, force: true });
  }
});

test("source custody audit fails closed when a supplied PDF does not match its manifest", () => {
  const substitutedSourceRoot = mkdtempSync(
    path.join(tmpdir(), "surge-education-source-audit-"),
  );
  const source = SURGE_ASSESSOR_EDUCATION_SOURCES[0];

  try {
    writeFileSync(
      path.join(substitutedSourceRoot, source.sourceFileName),
      Buffer.from("%PDF-1.4\nsubstituted test document\n", "utf8"),
    );

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/audit-surge-assessor-education.mjs",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SURGE_ASSESSOR_EDUCATION_SOURCE_ROOT: substitutedSourceRoot,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /controlled PDF byte length does not match|controlled PDF SHA-256 does not match/i,
    );
  } finally {
    rmSync(substitutedSourceRoot, { recursive: true, force: true });
  }
});

test("current rebate questions receive the governed evidence boundary", () => {
  const selected = selectSurgeAssessorEducationForPrompt(
    "What current rebate and certificate discount can I get?",
    4,
  );

  assert.ok(selected.some((card) => /current official record/i.test(card.guidance)));
  assert.ok(
    selected.every(
      (card) => card.authorityBoundary === "verify_current_facts_with_governed_evidence",
    ),
  );
});
