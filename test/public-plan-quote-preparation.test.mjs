import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";

import {
  PUBLIC_PLAN_QUOTE_ALLOWED_TYPES,
  PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES,
  PUBLIC_PLAN_QUOTE_MAX_FILES,
  PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION,
  PUBLIC_PLAN_QUOTE_MAX_IMAGE_PIXELS,
  PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES,
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
  normalizePublicPlanQuotePreparation,
  publicPlanQuoteAnswersForMatchedCategories,
  publicPlanQuoteCategoryIntersection,
  publicPlanQuotePhotoReplayDecision,
  publicPlanQuotePhotoPromptsForServices,
  publicPlanQuotePlanFactsForSnapshot,
  publicPlanQuoteQuestionsForServices,
  publicPlanQuoteUploadKeyHashMatches,
  publicPlanQuoteUploadRateDecision,
  publicPlanQuoteWithdrawalDecision,
  validPublicPlanQuoteClientUploadId,
  validPublicPlanQuoteUploadReference,
} from "../src/lib/public-plan-quote-preparation.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "../src/lib/public-plan-enquiry.mjs";
import { ENERGY_SERVICE_IDS } from "../src/lib/energy-service-catalogue.mjs";
import {
  hasAllowedSignature,
  privateImageDimensions,
  sanitiseQuotingPhoto,
} from "../src/lib/private-image-evidence.ts";
import {
  drainPublicPlanQuotePhotoCleanup,
  shouldDrainPublicPlanQuotePhotoCleanup,
} from "../src/lib/public-plan-quote-photo-cleanup.ts";

const SERVICES = [...ENERGY_SERVICE_IDS];

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function tradePhotoAccessSql() {
  const route = read("../src/app/api/public-plan-quote-preparation/route.ts");
  const getRoute = route.slice(route.indexOf("export async function GET"));
  const sql = getRoute.match(/const row = await getD1\(\)\.prepare\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(sql, "trade photo access SQL must be extractable for execution");
  return sql.replace(
    '${verifiedTradeAccountPredicate("account")}',
    "account.status = 'approved'",
  );
}

function cleanupDatabaseAdapter(database) {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              return { results: database.prepare(sql).all(...bindings) };
            },
            async first() {
              return database.prepare(sql).get(...bindings) || null;
            },
            async run() {
              const result = database.prepare(sql).run(...bindings);
              return { meta: { changes: Number(result.changes || 0) } };
            },
          };
        },
      };
    },
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

test("quote preparation stays materially shorter than the plan and deduplicates globally", () => {
  for (const service of SERVICES) {
    const questions = publicPlanQuoteQuestionsForServices([service]);
    assert.ok(questions.length >= 1 && questions.length <= 2, `${service} has ${questions.length} questions`);
    assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
    assert.ok(questions.every((question) => question.label.length <= 80));
  }

  const combined = publicPlanQuoteQuestionsForServices(SERVICES);
  assert.ok(combined.length <= 6, `all services have ${combined.length} questions`);
  assert.equal(new Set(combined.map((question) => question.id)).size, combined.length);
  for (const service of SERVICES) {
    const serviceIds = publicPlanQuoteQuestionsForServices([service]).map((question) => question.id);
    assert.ok(serviceIds.every((id) => combined.some((question) => question.id === id)));
  }
  const removedRepeatQuestions = new Set([
    "switchboard",
    "roof-details",
    "existing-solar",
    "existing-heating-equipment",
    "existing-hot-water-equipment",
    "heating-scope",
    "draught-locations",
    "fixed-ventilation",
    "insulation-area",
    "insulation-known",
    "window-construction",
    "window-priority",
    "shading-access",
    "ev-needs",
    "ev-parking",
    "assessment-concerns",
    "assessment-records",
  ]);
  assert.ok(combined.every((question) => !removedRepeatQuestions.has(question.id)));

  const screenshotServices = [
    "assessment",
    "solar",
    "heating-cooling",
    "hot-water",
    "draught-proofing",
    "insulation",
    "glazing",
    "window-coverings",
    "ev-charging",
  ];
  assert.deepEqual(
    publicPlanQuoteQuestionsForServices(screenshotServices).map((question) => question.id),
    ["timing"],
  );
  assert.deepEqual(
    publicPlanQuoteQuestionsForServices(["solar"]).map((question) => question.id),
    ["timing"],
  );
  assert.deepEqual(
    publicPlanQuoteQuestionsForServices(["heating-cooling"]).map((question) => question.id),
    ["timing"],
  );
  assert.doesNotMatch(
    publicPlanQuoteQuestionsForServices(SERVICES).map((question) => question.label).join(" "),
    /What should the solar quote cover|How much of the home should the heating or cooling quote cover/,
  );
});

test("electric cooking reuses the plan fact and asks only for useful quote scope and wide photos", () => {
  const questions = publicPlanQuoteQuestionsForServices(["electric-cooking"]);
  assert.deepEqual(
    questions.map((question) => question.id),
    ["timing", "electric-cooking-scope"],
  );
  assert.doesNotMatch(questions.map((question) => question.label).join(" "), /installed now|existing fuel/i);

  const facts = publicPlanQuotePlanFactsForSnapshot(["electric-cooking"], {
    features: ["gas-cooking"],
  });
  assert.deepEqual(facts, [{
    questionId: "known-plan-electric-cooking",
    label: "Cooking setup already recorded in the home plan",
    answer: "Gas cooktop or oven",
    services: ["electric-cooking"],
  }]);

  const prompts = publicPlanQuotePhotoPromptsForServices(["electric-cooking"]);
  assert.deepEqual(
    prompts.map((prompt) => prompt.id),
    ["switchboard-front", "electric-cooking-installation-area"],
  );
  assert.match(prompts[1].hint, /whole cooktop or cooker/i);
});

test("known plan facts become an exact read-only summary and preserve multi-system heating", () => {
  const facts = publicPlanQuotePlanFactsForSnapshot([
    "solar",
    "battery",
    "insulation",
    "heating-cooling",
    "hot-water",
  ], {
    propertyContext: {
      switchboard: "modern_breakers",
      roofType: "metal",
      roofForm: "pitched",
      roofCondition: "good",
    },
    features: [
      "solar-none",
      "battery",
      "wall-insulation-well",
      "reverse-cycle",
      "gas-heating",
      "evaporative-cooling",
      "heat-pump-hot-water",
    ],
  });
  const byId = Object.fromEntries(facts.map((fact) => [fact.questionId, fact]));
  assert.equal(byId["known-plan-switchboard"].answer, "Modern circuit breakers");
  assert.equal(
    byId["known-plan-roof"].answer,
    "Metal roof covering; Pitched or sloping roof; No known roof damage",
  );
  assert.equal(byId["known-plan-solar"].answer, "No rooftop solar");
  assert.equal(byId["known-plan-battery"].answer, "Home battery installed");
  assert.deepEqual(byId["known-plan-solar"].services, ["solar"]);
  assert.deepEqual(byId["known-plan-battery"].services, ["battery"]);
  assert.equal(
    byId["known-plan-insulation"].answer,
    "External walls: well insulated or recently upgraded",
  );
  assert.equal(
    byId["known-plan-heating-cooling"].answer,
    "Reverse-cycle air conditioning; Gas space or ducted heating; Evaporative cooling",
  );
  assert.equal(byId["known-plan-hot-water"].answer, "Heat-pump hot water");
  assert.deepEqual(
    publicPlanQuoteAnswersForMatchedCategories(facts, ["solar"])
      .filter((fact) => fact.questionId.startsWith("known-plan-solar") || fact.questionId.startsWith("known-plan-battery"))
      .map((fact) => fact.questionId),
    ["known-plan-solar"],
  );
  assert.deepEqual(
    publicPlanQuoteAnswersForMatchedCategories(facts, ["battery"])
      .filter((fact) => fact.questionId.startsWith("known-plan-solar") || fact.questionId.startsWith("known-plan-battery"))
      .map((fact) => fact.questionId),
    ["known-plan-battery"],
  );

  const notSure = publicPlanQuotePlanFactsForSnapshot(["solar"], {
    propertyContext: { switchboard: "not_sure", roofType: "metal", roofCondition: "not_sure" },
  });
  assert.equal(notSure.some((fact) => fact.questionId === "known-plan-switchboard"), false);
  assert.equal(notSure.find((fact) => fact.questionId === "known-plan-roof").answer, "Metal roof covering");
});

test("quote preparation normalises deterministic answers and rejects mismatched, duplicate or excessive input", () => {
  const services = ["hot-water", "battery"];
  const questions = publicPlanQuoteQuestionsForServices(services);
  const prompts = publicPlanQuotePhotoPromptsForServices(services);
  const suppliedAnswers = [questions.at(-1), questions[0]].map((question) => ({
    questionId: question.id,
    answer: question.options[0],
  }));
  const valid = normalizePublicPlanQuotePreparation({
    version: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
    answers: suppliedAnswers,
    photoPromptIds: [prompts[2].id, prompts[0].id],
    expectedPhotoCount: 2,
    uploadKeyHash: "a".repeat(64),
  }, services);
  assert.equal(valid.ok, true);
  assert.deepEqual(
    valid.value.answers.map((answer) => answer.questionId),
    questions.filter((question) => suppliedAnswers.some((answer) => answer.questionId === question.id))
      .map((question) => question.id),
  );
  assert.deepEqual(
    valid.value.photoPromptIds,
    prompts.filter((prompt) => [prompts[2].id, prompts[0].id].includes(prompt.id))
      .map((prompt) => prompt.id),
  );

  const base = {
    version: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
    answers: [],
    photoPromptIds: [],
    expectedPhotoCount: 0,
    uploadKeyHash: "",
  };
  assert.equal(normalizePublicPlanQuotePreparation(base, services).ok, true);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    uploadKeyHash: "c".repeat(64),
  }, services).ok, true);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    answers: [suppliedAnswers[0], suppliedAnswers[0]],
  }, services).ok, false);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    answers: [{ questionId: questions[0].id, answer: "invented option" }],
  }, services).ok, false);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    photoPromptIds: ["representative-window"],
    expectedPhotoCount: 1,
    uploadKeyHash: "b".repeat(64),
  }, services).ok, false);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    photoPromptIds: [prompts[0].id, prompts[0].id],
    expectedPhotoCount: 2,
    uploadKeyHash: "b".repeat(64),
  }, services).ok, false);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    photoPromptIds: [prompts[0].id],
    expectedPhotoCount: PUBLIC_PLAN_QUOTE_MAX_FILES + 1,
    uploadKeyHash: "b".repeat(64),
  }, services).ok, false);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    photoPromptIds: [prompts[0].id],
    expectedPhotoCount: 1,
    uploadKeyHash: "not-a-hash",
  }, services).ok, false);
  const planSnapshot = {
    propertyContext: { switchboard: "modern_breakers" },
    features: ["solar-none"],
  };
  const planFact = publicPlanQuotePlanFactsForSnapshot(["battery"], planSnapshot)[0];
  const carried = normalizePublicPlanQuotePreparation({
    ...base,
    answers: [{ questionId: planFact.questionId, answer: planFact.answer }],
  }, ["battery"], planSnapshot);
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.value.answers.map((answer) => answer.answer), ["Modern circuit breakers"]);
  assert.equal(normalizePublicPlanQuotePreparation({
    ...base,
    answers: [{ questionId: planFact.questionId, answer: "Altered plan fact" }],
  }, ["battery"], planSnapshot).ok, false);
});

test("hot-water and heating prioritise wide context photos plus the full switchboard view", () => {
  assert.deepEqual(
    publicPlanQuotePhotoPromptsForServices(["hot-water"]).map((prompt) => prompt.id),
    ["switchboard-front", "hot-water-installation-area"],
  );
  assert.deepEqual(
    publicPlanQuotePhotoPromptsForServices(["heating-cooling"]).map((prompt) => prompt.id),
    ["switchboard-front", "heating-installation-area"],
  );
  assert.deepEqual(
    publicPlanQuotePhotoPromptsForServices(["ev-charging"]).map((prompt) => prompt.id),
    ["switchboard-front", "ev-installation-area"],
  );
  assert.deepEqual(
    publicPlanQuotePhotoPromptsForServices(["solar"]).map((prompt) => prompt.id),
    ["roof-wide", "switchboard-front", "solar-battery-equipment-wide"],
  );
  assert.deepEqual(
    publicPlanQuotePhotoPromptsForServices(["battery"]).map((prompt) => prompt.id),
    ["switchboard-front", "solar-battery-equipment-wide", "battery-installation-area"],
  );
  const combined = publicPlanQuotePhotoPromptsForServices(["hot-water", "heating-cooling"]);
  assert.equal(new Set(combined.map((prompt) => prompt.id)).size, combined.length);
  assert.deepEqual(
    combined.find((prompt) => prompt.id === "hot-water-installation-area").services,
    ["hot-water"],
  );
  assert.deepEqual(
    combined.find((prompt) => prompt.id === "heating-installation-area").services,
    ["heating-cooling"],
  );
  assert.match(combined.find((prompt) => prompt.id === "switchboard-front").label, /Full switchboard/);
  assert.match(
    combined.find((prompt) => prompt.id === "switchboard-front").hint,
    /normal hinged door open\. Do not remove covers or touch wiring/,
  );
  const equipmentPrompt = publicPlanQuotePhotoPromptsForServices([
    "solar",
    "battery",
    "heating-cooling",
    "hot-water",
    "ev-charging",
  ]).find((prompt) => prompt.id === "solar-battery-equipment-wide");
  assert.deepEqual(equipmentPrompt.services, ["solar", "battery"]);
  assert.deepEqual(publicPlanQuoteCategoryIntersection(
    equipmentPrompt.services,
    ["heating-cooling", "hot-water", "ev-charging"],
  ), []);
  assert.ok(combined.every((prompt) => !prompt.id.endsWith("equipment-label")));
});

test("quote answers and photo categories are minimised to each exact matched service and malformed categories fail closed", () => {
  const answers = [
    { questionId: "solar", label: "Solar", answer: "Solar answer", services: ["solar"] },
    { questionId: "hot-water", label: "Hot water", answer: "Hot-water answer", services: ["hot-water"] },
    { questionId: "shared", label: "Timing", answer: "Soon", services: ["solar", "hot-water"] },
  ];
  assert.deepEqual(
    publicPlanQuoteAnswersForMatchedCategories(answers, ["solar"]),
    [
      { ...answers[0], services: ["solar"] },
      { ...answers[2], services: ["solar"] },
    ],
  );
  assert.deepEqual(
    publicPlanQuoteAnswersForMatchedCategories(answers, "not-json"),
    [],
  );
  assert.deepEqual(
    publicPlanQuoteCategoryIntersection(["solar", "hot-water"], ["solar"]),
    ["solar"],
  );
  assert.deepEqual(
    publicPlanQuoteCategoryIntersection(["solar", "invalid"], ["solar"]),
    [],
  );
});

test("upload authorization primitives reject wrong secrets and the durable rate window is bounded", () => {
  assert.equal(validPublicPlanQuoteUploadReference(
    "AEA-20260811-7DAA379EC8FA4089",
    "c8451488-6d1c-4c0a-8bb8-3b8b2d01bfa8",
  ), true);
  assert.equal(validPublicPlanQuoteUploadReference(
    "AEA-20260811-7DAA379EC8FA4089",
    "not-a-secret",
  ), false);
  assert.equal(validPublicPlanQuoteClientUploadId(
    "quote.c8451488-6d1c-4c0a-8bb8-3b8b2d01bfa8",
  ), true);
  assert.equal(publicPlanQuoteUploadKeyHashMatches("a".repeat(64), "a".repeat(64)), true);
  assert.equal(publicPlanQuoteUploadKeyHashMatches("a".repeat(64), "b".repeat(64)), false);
  assert.equal(publicPlanQuoteWithdrawalDecision({
    status: "active",
    suppliedKeyHash: "a".repeat(64),
    storedKeyHash: "a".repeat(64),
  }), "withdraw");
  assert.equal(publicPlanQuoteWithdrawalDecision({
    status: "withdrawn",
    suppliedKeyHash: "a".repeat(64),
    storedKeyHash: "a".repeat(64),
  }), "already-withdrawn");
  assert.equal(publicPlanQuoteWithdrawalDecision({
    status: "active",
    suppliedKeyHash: "b".repeat(64),
    storedKeyHash: "a".repeat(64),
  }), "reject");

  const now = 10_000;
  const allowed = publicPlanQuoteUploadRateDecision([0, 1_000], now, {
    limit: 3,
    windowMs: 20_000,
  });
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.nextTimestamps, [0, 1_000, now]);
  const blocked = publicPlanQuoteUploadRateDecision([0, 1_000, 2_000], now, {
    limit: 3,
    windowMs: 20_000,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 10);
  assert.equal(publicPlanQuoteUploadRateDecision(["invalid"], now).unavailable, true);
});

test("photo upload replay is idempotent only for the same prompt, type and stripped-byte hash", () => {
  const incoming = {
    promptId: "switchboard-front",
    contentType: "image/jpeg",
    sha256: "a".repeat(64),
  };
  assert.equal(publicPlanQuotePhotoReplayDecision(null, incoming), "new");
  assert.equal(publicPlanQuotePhotoReplayDecision({ ...incoming, status: "active" }, incoming), "replay");
  assert.equal(publicPlanQuotePhotoReplayDecision({ ...incoming, status: "pending" }, incoming), "resume");
  assert.equal(publicPlanQuotePhotoReplayDecision({ ...incoming, status: "deleted" }, incoming), "resume");
  assert.equal(publicPlanQuotePhotoReplayDecision({
    ...incoming,
    sha256: "b".repeat(64),
    status: "active",
  }, incoming), "mismatch");
});

test("durable cleanup handles withdrawal batches, delete failures and a late put without future customer traffic", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE public_trade_lead_quote_preparations (
    opportunity_id text PRIMARY KEY NOT NULL,
    status text NOT NULL
  );
  CREATE TABLE public_trade_lead_quote_photos (
    id text PRIMARY KEY NOT NULL,
    opportunity_id text NOT NULL,
    client_upload_id text NOT NULL UNIQUE,
    object_key text NOT NULL UNIQUE,
    status text NOT NULL,
    updated_at text NOT NULL
  );`);
  database.prepare(`INSERT INTO public_trade_lead_quote_preparations
    (opportunity_id, status) VALUES (?, 'withdrawn')`).run("opportunity-1");
  const nowMs = Date.parse("2026-08-11T08:00:00.000Z");
  const objectKeys = new Set();
  const insertPhoto = database.prepare(`INSERT INTO public_trade_lead_quote_photos
    (id, opportunity_id, client_upload_id, object_key, status, updated_at)
    VALUES (?, 'opportunity-1', ?, ?, ?, ?)`);
  for (let index = 0; index < PUBLIC_PLAN_QUOTE_MAX_FILES + 3; index += 1) {
    const objectKey = `quote-object-${index}`;
    objectKeys.add(objectKey);
    insertPhoto.run(
      `photo-${index}`,
      `quote.client-${index}`,
      objectKey,
      "active",
      new Date(nowMs).toISOString(),
    );
  }
  insertPhoto.run(
    "photo-failure",
    "quote.failure",
    "quote-object-failure",
    "active",
    new Date(nowMs).toISOString(),
  );
  objectKeys.add("quote-object-failure");
  const failedOnce = new Set(["quote-object-failure"]);
  const bucket = {
    async delete(objectKey) {
      if (failedOnce.delete(objectKey)) throw new Error("SIMULATED_R2_DELETE_FAILURE");
      objectKeys.delete(objectKey);
    },
  };
  const db = cleanupDatabaseAdapter(database);

  for (let pass = 0; pass < 4; pass += 1) {
    await drainPublicPlanQuotePhotoCleanup({ db, bucket, limit: 5, nowMs });
  }
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM public_trade_lead_quote_photos WHERE status = 'active'`).get().count, 0);
  assert.equal(database.prepare(`SELECT status FROM public_trade_lead_quote_photos
    WHERE id = 'photo-failure'`).get().status, "deleted");

  await drainPublicPlanQuotePhotoCleanup({
    db,
    bucket,
    limit: 5,
    nowMs: nowMs + (2 * 60 * 1000),
  });
  assert.equal(database.prepare(`SELECT status FROM public_trade_lead_quote_photos
    WHERE id = 'photo-failure'`).get().status, "purged");

  objectKeys.add("quote-object-0");
  const afterGrace = nowMs + (7 * 60 * 60 * 1000);
  for (let pass = 0; pass < 5; pass += 1) {
    await drainPublicPlanQuotePhotoCleanup({ db, bucket, limit: 5, nowMs: afterGrace });
  }
  assert.equal(objectKeys.size, 0, "the retained tombstone must find and delete a late R2 put");
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM public_trade_lead_quote_photos`).get().count, 0);
});

test("successful health probes trigger bounded quote-photo cleanup while cron remains a fallback", () => {
  assert.equal(shouldDrainPublicPlanQuotePhotoCleanup({
    method: "GET",
    pathname: "/api/health",
    responseOk: true,
  }), true);
  assert.equal(shouldDrainPublicPlanQuotePhotoCleanup({
    method: "POST",
    pathname: "/api/health",
    responseOk: true,
  }), false);
  assert.equal(shouldDrainPublicPlanQuotePhotoCleanup({
    method: "GET",
    pathname: "/api/health",
    responseOk: false,
  }), false);

  const worker = read("../worker/index.ts");
  const backgroundStart = worker.indexOf("function queueBackgroundDispatches");
  const fetchStart = worker.indexOf("function canonicalHostRedirect", backgroundStart);
  const background = worker.slice(backgroundStart, fetchStart);
  assert.match(background, /shouldDrainPublicPlanQuotePhotoCleanup\(\{/);
  assert.match(background, /ctx\.waitUntil\([\s\S]*drainPublicPlanQuotePhotoCleanup\(\{/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON[\s\S]*drainPublicPlanQuotePhotoCleanup\(\{/);
  assert.match(worker, /drainOpportunityNotificationDeliveries\(\)/);
});

test("JPEG quote-photo sanitising strips APP metadata before and between scans and truncates malicious trailers after EOI", () => {
  const app = (text) => {
    const data = Buffer.from(text, "ascii");
    return Buffer.from([0xff, 0xe1, 0x00, data.length + 2, ...data]);
  };
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app("EXIF"),
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]),
    app("GPS!"),
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x44, 0xff, 0xd9]),
    Buffer.from("EXIF-GPS-TRAILER", "ascii"),
  ]);
  assert.equal(hasAllowedSignature(jpeg, "image/jpeg", false), true);
  assert.equal(hasAllowedSignature(Buffer.from("not an image"), "image/jpeg", false), false);
  assert.equal(hasAllowedSignature(jpeg, "image/png", false), false);
  const clean = sanitiseQuotingPhoto(jpeg, "image/jpeg");
  assert.ok(clean);
  assert.equal(Buffer.from(clean).includes(Buffer.from("EXIF")), false);
  assert.equal(Buffer.from(clean).includes(Buffer.from("GPS!")), false);
  assert.deepEqual(Array.from(clean.slice(-2)), [0xff, 0xd9]);
  assert.equal(Buffer.from(clean).includes(Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33])), true);

  const missingEoi = jpeg.subarray(0, jpeg.indexOf(Buffer.from([0xff, 0xd9])));
  assert.equal(sanitiseQuotingPhoto(missingEoi, "image/jpeg"), null);
});

test("metadata stripping removes private GPS chunks from decodable JPEG and PNG", async () => {
  const gps = Buffer.from("GPS=-33.8688,151.2093", "ascii");
  const pixel = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 15, g: 120, b: 210, alpha: 1 },
    },
  }).png().toBuffer();

  const jpeg = await sharp(pixel).jpeg().toBuffer();
  const app0 = Buffer.alloc(4 + gps.length);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(gps.length + 2, 2);
  gps.copy(app0, 4);
  const jpegWithGps = Buffer.concat([jpeg.subarray(0, 2), app0, jpeg.subarray(2)]);
  const cleanJpeg = sanitiseQuotingPhoto(jpegWithGps, "image/jpeg");
  assert.ok(cleanJpeg);
  assert.equal(Buffer.from(cleanJpeg).includes(gps), false);
  assert.deepEqual(privateImageDimensions(cleanJpeg, "image/jpeg"), { width: 1, height: 1 });
  assert.equal((await sharp(cleanJpeg).metadata()).width, 1);

  const ihdrEnd = 8 + 12 + pixel.readUInt32BE(8);
  const pngWithGps = Buffer.concat([
    pixel.subarray(0, ihdrEnd),
    pngChunk("gpSs", gps),
    pixel.subarray(ihdrEnd),
  ]);
  const cleanPng = sanitiseQuotingPhoto(pngWithGps, "image/png");
  assert.ok(cleanPng);
  assert.equal(Buffer.from(cleanPng).includes(gps), false);
  assert.deepEqual(privateImageDimensions(cleanPng, "image/png"), { width: 1, height: 1 });
  assert.equal((await sharp(cleanPng).metadata()).height, 1);

});

test("server image inspection rejects malformed or excessive decoded dimensions before private storage", () => {
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x00, 0x06, 0x00, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  assert.deepEqual(privateImageDimensions(jpeg, "image/jpeg"), {
    width: 1536,
    height: 1024,
  });

  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION + 1, 16);
  png.writeUInt32BE(3000, 20);
  png[24] = 8;
  png[25] = 6;
  assert.deepEqual(privateImageDimensions(png, "image/png"), {
    width: PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION + 1,
    height: 3000,
  });
  const dimensions = privateImageDimensions(png, "image/png");
  assert.ok(
    dimensions.width > PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION
    || dimensions.width * dimensions.height > PUBLIC_PLAN_QUOTE_MAX_IMAGE_PIXELS,
  );

  const malformedWebp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x16, 0, 0, 0]),
    Buffer.from("WEBPVP8X", "ascii"),
    Buffer.from([10, 0, 0, 0, 0]),
  ]);
  assert.equal(privateImageDimensions(malformedWebp, "image/webp"), null);
});

test("the public form progressively renders mobile capture, explicit sharing consent and photo-only retry", () => {
  const form = read("../src/components/PublicPlanEnquiryForm.tsx");
  const css = read("../src/components/PublicPlanEnquiryForm.module.css");
  assert.match(form, /Help trades prepare a desktop quote/);
  assert.match(form, /publicPlanQuoteQuestionsForSnapshot\(interests, planSnapshot\)/);
  assert.match(form, /publicPlanQuotePlanFactsForSnapshot\(interests, planSnapshot\)/);
  assert.match(form, /<details className=\{`\$\{styles\.quotePreparation\} \$\{styles\.full\}`\} open>/);
  assert.match(form, /Share \{knownPlanFacts\.length\} relevant details already recorded in my home plan/);
  assert.match(form, /className=\{styles\.knownPlanFactList\}/);
  assert.match(form, /Relevant home plan facts are included only when I selected the read-only summary above/);
  assert.match(form, /setIncludeKnownPlanAnswers\(include\)/);
  assert.doesNotMatch(form, /What type of switchboard is installed|What is the main roof covering and condition|What heating or cooling equipment is installed now|What hot-water system is installed now|Which areas need heating or cooling, and what is wrong now|Where are the noticeable draughts|Are any openings required for ventilation or an unflued gas appliance|What useful records are available|What should the assessor focus on first/);
  assert.match(form, /Useful wide photos/);
  assert.match(form, /<details className=\{styles\.quotePhotos\}>/);
  assert.doesNotMatch(form, /<details className=\{styles\.quotePhotos\} open>/);
  assert.match(form, /Optional\. Open this section if photos would help a trade understand the site/);
  assert.match(form, /Close-up labels are secondary/);
  assert.match(form, /accept="image\/jpeg,image\/png"/);
  assert.doesNotMatch(form, /image\/webp|WebP/);
  assert.match(form, /aria-label=\{`Add photos: \$\{prompt\.label\}`\}/);
  assert.match(form, /aria-describedby=\{hintId\}/);
  assert.match(form, /capture="environment"[\s\S]*multiple[\s\S]*type="file"/);
  assert.match(form, /const retained = quotePhotos/);
  assert.match(form, /quote details or photos I chose to add/);
  assert.match(form, /full plan and PDF stay private/);
  assert.match(form, /never attached to email|not attached to email/);
  assert.doesNotMatch(form, /uploaded files are not shared with trades/);
  assert.match(form, /kind: "photos_pending"/);
  assert.match(form, /Retry the remaining photos without sending the enquiry again/);
  const retryStart = form.indexOf("function retryQuotePhotoUploads");
  const submitStart = form.indexOf("async function submit", retryStart);
  assert.ok(retryStart > 0 && submitStart > retryStart);
  assert.doesNotMatch(form.slice(retryStart, submitStart), /\/api\/leads/);
  assert.match(form, /await uploadRemainingQuotePhotos\(reference\);[\s\S]*return;[\s\S]*finishAcceptedEnquiry\(reference\)/);
  assert.match(form, /browserImageDimensions\(file\)/);
  assert.match(css, /\.selectedPhotoList button[\s\S]*font-size: 0\.875rem;[\s\S]*min-height: 2\.75rem/);
  assert.match(css, /\.quoteQuestion > small[\s\S]*font-size: 0\.875rem/);
  assert.equal(PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES, 8 * 1024 * 1024);
  assert.equal(PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES, 48 * 1024 * 1024);
  assert.deepEqual(PUBLIC_PLAN_QUOTE_ALLOWED_TYPES, ["image/jpeg", "image/png"]);
});

test("submission and quote-photo uploads stay in an accessible progress modal until a safe outcome", () => {
  const form = read("../src/components/PublicPlanEnquiryForm.tsx");
  const css = read("../src/components/PublicPlanEnquiryForm.module.css");
  const leadPost = form.indexOf('fetch("/api/leads"');
  const sendingState = form.lastIndexOf('kind: "sending"', leadPost);
  assert.ok(sendingState > 0 && sendingState < leadPost);
  assert.match(form, /ref={submissionDialogRef}/);
  assert.match(form, /aria-labelledby="public-plan-submission-title"/);
  assert.match(form, /aria-modal="true"/);
  assert.match(form, /onCancel=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(form, /onKeyDown={keepFocusInSubmissionDialog}/);
  assert.match(form, /document\.body\.style\.overflow = "hidden"/);
  assert.match(form, /window\.addEventListener\("beforeunload", warnBeforeLeaving\)/);
  assert.match(form, /Do not close this page or follow another link until this finishes/);
  assert.match(form, /<progress[\s\S]*max=\{quotePhotos\.length \+ 1\}[\s\S]*value=/);
  assert.match(form, /Lead accepted/);
  assert.match(form, /\{uploadedQuotePhotoCount\} of \{quotePhotos\.length\} uploaded/);
  assert.match(form, /Continue without remaining photos/);
  assert.match(form, /window\.confirm\([\s\S]*Continue without/);
  const retryStart = form.indexOf("function retryQuotePhotoUploads");
  const retryEnd = form.indexOf("function continueWithoutRemainingPhotos", retryStart);
  assert.doesNotMatch(form.slice(retryStart, retryEnd), /\/api\/leads/);
  assert.match(form, /finishAcceptedEnquiry\(reference\)[\s\S]*setGatewayOpen\(true\)/);
  assert.match(css, /\.submissionDialog::backdrop[\s\S]*background: rgba\(0, 19, 31, 0\.86\)/);
  assert.match(css, /\.submissionActions[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(css, /@container \(max-width: 34rem\)[\s\S]*\.submissionActions[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("known home-plan facts use readable horizontal label and value rows", () => {
  const form = read("../src/components/PublicPlanEnquiryForm.tsx");
  const css = read("../src/components/PublicPlanEnquiryForm.module.css");
  assert.match(form, /fact\.label\.replace\(" already recorded in the home plan", ""\)/);
  assert.match(form, /className=\{styles\.knownPlanFact\}/);
  assert.match(css, /\.knownPlanFactList \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.knownPlanFactList \.knownPlanFact \{[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(7\.5rem, 0\.35fr\) minmax\(0, 1fr\);[\s\S]*min-width: 0/);
  assert.match(css, /\.knownPlanFactList \.knownPlanFact strong,[\s\S]*writing-mode: horizontal-tb;[\s\S]*word-break: normal/);
  assert.doesNotMatch(css.match(/\.knownPlanFactList \.knownPlanFact strong,[\s\S]*?\n\}/)?.[0] || "", /overflow-wrap: anywhere/);
  assert.match(css, /@container \(max-width: 44rem\)[\s\S]*\.knownPlanFactList[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@container \(max-width: 25rem\)[\s\S]*\.knownPlanFactList \.knownPlanFact[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.serviceChoice small \{[\s\S]*font-size: 0\.82rem/);
});

test("the private upload boundary rate-limits before multipart parsing and validates content, consent, idempotency and exact trade access", () => {
  const route = read("../src/app/api/public-plan-quote-preparation/route.ts");
  const cleanup = read("../src/lib/public-plan-quote-photo-cleanup.ts");
  const post = route.slice(route.indexOf("export async function POST"));
  const preAuthLimiter = post.indexOf('"public-photo-upload"');
  const preparationRoute = post.indexOf("const preparation = await activePreparation");
  const sourceLimiter = post.indexOf("sourceRateLimit = await checkUploadRateLimit");
  const parser = post.indexOf("form = await request.formData()");
  assert.ok(
    preAuthLimiter > 0
    && preparationRoute > preAuthLimiter
    && sourceLimiter > preparationRoute
    && parser > sourceLimiter,
  );
  assert.match(route, /sameOrigin\(request, true\)/);
  assert.match(route, /MULTIPART_CONTENT_TYPE_PATTERN\.test\(contentType\)/);
  assert.match(route, /if \(!declaredLengthHeader\)/);
  assert.match(route, /Number\.isSafeInteger\(declaredLength\)/);
  assert.match(route, /x-quote-source-reference/);
  assert.match(route, /x-quote-upload-key/);
  assert.match(route, /public_trade_lead_quote_upload_limits/);
  assert.match(route, /UPLOAD_RATE_LIMIT = PUBLIC_PLAN_QUOTE_MAX_FILES \* 2/);
  assert.match(route, /PREAUTH_RATE_LIMIT = PUBLIC_PLAN_QUOTE_MAX_FILES \* 4/);
  assert.match(route, /"source"[\s\S]*"client"/);
  assert.match(route, /all-clients/);
  assert.match(route, /preparation\?\.upload_key_hash \|\| INVALID_UPLOAD_KEY_HASH/);
  assert.match(route, /PUBLIC_PLAN_QUOTE_ALLOWED_TYPES\.includes\(file\.type\)/);
  assert.match(route, /file\.size > PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES/);
  assert.match(route, /hasAllowedSignature\(originalBytes, file\.type, false\)/);
  assert.match(route, /privateImageDimensions\(originalBytes, file\.type\)/);
  assert.match(route, /sanitiseQuotingPhoto\(originalBytes, file\.type\)/);
  assert.match(route, /COUNT\(\*\)[\s\S]*PUBLIC_PLAN_QUOTE_MAX_FILES/);
  assert.match(route, /SUM\(size_bytes\)[\s\S]*PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES/);
  assert.match(route, /client_upload_id = \?[\s\S]*IDEMPOTENCY_MISMATCH/);
  assert.match(route, /CURRENT_QUOTE_ACCESS_EXISTS_SQL/);
  assert.match(route, /SET status = 'active'[\s\S]*CURRENT_QUOTE_ACCESS_EXISTS_SQL/);
  assert.match(route, /status = 'deleted'[\s\S]*deleteTombstonedPhotoObject/);
  assert.match(cleanup, /photo\.status = 'deleted' AND photo\.updated_at < \?/);
  assert.match(cleanup, /photo\.status = 'purged' AND photo\.updated_at < \?/);
  assert.match(cleanup, /await bucket\.delete\(photo\.object_key\)/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /SET status = 'withdrawn', withdrawn_at = \?, question_answers = '\[\]'/);
  assert.match(route, /status IN \('pending', 'active', 'deleted', 'purged'\)/);
  assert.match(route, /requireVerifiedTradeAccess/);
  assert.match(route, /match\.firebase_uid = \?/);
  assert.match(route, /publicPlanQuoteCategoryIntersection\([\s\S]*row\.matched_categories/);
  assert.match(route, /verifiedTradeAccountPredicate/);
  assert.match(route, /contact\.withdrawn_at = ''/);
  assert.match(route, /public_trade_lead_quote_photo_events/);
  assert.doesNotMatch(route, /publicUrl|signedUrl|send.*email/i);
  assert.doesNotMatch(route, /image\/webp|WebP/);
});

test("matched trade photo reads fail closed after preparation withdrawal or lead lifecycle expiry", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE public_trade_lead_quote_photos (
      id text PRIMARY KEY, opportunity_id text NOT NULL, status text NOT NULL,
      service_categories text NOT NULL, object_key text NOT NULL
    );
    CREATE TABLE public_trade_lead_quote_preparations (
      id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL,
      status text NOT NULL, notice_version text NOT NULL, consent_purpose text NOT NULL,
      granted_at text NOT NULL, withdrawn_at text NOT NULL
    );
    CREATE TABLE trade_opportunities (
      id text PRIMARY KEY, source_reference text NOT NULL, status text NOT NULL,
      expires_at text NOT NULL
    );
    CREATE TABLE trade_opportunity_matches (
      id text PRIMARY KEY, opportunity_id text NOT NULL, firebase_uid text NOT NULL,
      status text NOT NULL, matched_categories text NOT NULL
    );
    CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY, partner_type text NOT NULL, status text NOT NULL
    );
    CREATE TABLE public_trade_lead_contact_releases (
      id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL,
      status text NOT NULL, notice_version text NOT NULL, consent_purpose text NOT NULL,
      granted_at text NOT NULL, withdrawn_at text NOT NULL, updated_at text NOT NULL
    );
    INSERT INTO trade_opportunities VALUES
      ('opportunity-1', 'AEA-TEST', 'open', '2099-08-12T00:00:00.000Z');
    INSERT INTO trade_opportunity_matches VALUES
      ('match-1', 'opportunity-1', 'trade-a', 'interested', '["hot-water"]');
    INSERT INTO trade_accounts VALUES ('trade-a', 'installer', 'approved');
    INSERT INTO public_trade_lead_quote_preparations VALUES
      ('preparation-1', 'opportunity-1', 'AEA-TEST', 'active',
       '${PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION}', '${PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE}',
       '2026-08-12T00:00:00.000Z', '');
    INSERT INTO public_trade_lead_contact_releases VALUES
      ('release-1', 'opportunity-1', 'AEA-TEST', 'active',
       '${PUBLIC_PLAN_CONSENT_NOTICE_VERSION}', '${PUBLIC_PLAN_CONSENT_PURPOSE}',
       '2026-08-12T00:00:00.000Z', '', '2026-08-12T00:00:00.000Z');
    INSERT INTO public_trade_lead_quote_photos VALUES
      ('39c16039-4acd-4664-a2e5-3d8ad0dd7dd6', 'opportunity-1', 'active',
       '["hot-water"]', 'private/object.jpg');`);
  const query = database.prepare(tradePhotoAccessSql());
  const bindings = [
    PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
    PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
    "trade-a",
    PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    PUBLIC_PLAN_CONSENT_PURPOSE,
    "39c16039-4acd-4664-a2e5-3d8ad0dd7dd6",
  ];
  assert.equal(query.get(...bindings)?.match_id, "match-1");
  database.exec(`INSERT INTO public_trade_lead_contact_releases VALUES
    ('release-2', 'opportunity-1', 'AEA-TEST', 'withdrawn',
     '${PUBLIC_PLAN_CONSENT_NOTICE_VERSION}', '${PUBLIC_PLAN_CONSENT_PURPOSE}',
     '2026-08-12T01:00:00.000Z', '2026-08-12T01:01:00.000Z',
     '2026-08-12T01:01:00.000Z')`);
  assert.equal(query.get(...bindings), undefined,
    "a newer withdrawn release blocks an older active release");
  database.prepare("DELETE FROM public_trade_lead_contact_releases WHERE id = 'release-2'").run();
  assert.equal(query.get(...bindings)?.match_id, "match-1");
  database.prepare("UPDATE public_trade_lead_quote_preparations SET withdrawn_at = '2026-08-12T01:00:00.000Z'").run();
  assert.equal(query.get(...bindings), undefined);
  database.prepare("UPDATE public_trade_lead_quote_preparations SET withdrawn_at = ''").run();
  database.prepare("UPDATE trade_opportunities SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal(query.get(...bindings), undefined);
  database.prepare("UPDATE trade_opportunities SET expires_at = '2099-08-12T00:00:00.000Z', status = 'paused'").run();
  assert.equal(query.get(...bindings), undefined);
  database.prepare("UPDATE trade_opportunities SET status = 'open'").run();
  database.prepare("UPDATE trade_opportunity_matches SET status = 'closed'").run();
  assert.equal(query.get(...bindings), undefined);
  database.close();
});

test("quote preparation persists once per source and is exposed only through signed-in matched-trade lead evidence", () => {
  const opportunity = read("../src/lib/opportunity-server.ts");
  const tradeRoute = read("../src/app/api/trade-opportunities/route.ts");
  const dashboard = read("../src/components/DirectTradeDashboard.tsx");
  const migration = read("../drizzle/0128_public_plan_quote_preparation.sql");
  const validation = read("../src/lib/lead-validation.mjs");
  const envelope = read("../src/lib/lead-envelope.mjs");

  assert.match(opportunity, /persistPublicQuotePreparation/);
  assert.match(opportunity, /consent\.noticeVersion !== PUBLIC_PLAN_CONSENT_NOTICE_VERSION/);
  assert.match(opportunity, /consent\.purpose !== PUBLIC_PLAN_CONSENT_PURPOSE/);
  assert.match(opportunity, /INSERT INTO public_trade_lead_quote_preparations[\s\S]*ON CONFLICT DO NOTHING/);
  assert.match(opportunity, /OPPORTUNITY_SOURCE_REFERENCE_MISMATCH/);
  assert.match(opportunity, /ensureOpportunityNotificationDeliveries\(opportunityId\)/);
  assert.match(validation, /normalizePublicPlanQuotePreparation/);
  assert.match(envelope, /quotePreparation: payload\?\.quotePreparation \|\| null/);
  assert.match(tradeRoute, /public_trade_lead_quote_photos/);
  assert.match(tradeRoute, /m\.firebase_uid = \?/);
  assert.match(tradeRoute, /publicPlanQuoteAnswersForMatchedCategories/);
  assert.match(tradeRoute, /publicPlanQuoteCategoryIntersection/);
  assert.match(tradeRoute, /m\.matched_categories/);
  assert.match(tradeRoute, /public_quote_preparation_id/);
  assert.match(tradeRoute, /public_quote_preparation\.notice_version = '\$\{PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION\}'[\s\S]*public_contact\.notice_version = '\$\{PUBLIC_PLAN_CONSENT_NOTICE_VERSION\}'/);
  assert.match(dashboard, /PublicQuotePreparation/);
  assert.match(dashboard, /item\.downloadHref/);
  assert.match(migration, /public_trade_lead_quote_preparations/);
  assert.match(migration, /public_trade_lead_quote_photos/);
  assert.match(migration, /public_trade_lead_quote_photo_events/);
  assert.match(migration, /public_trade_lead_quote_upload_limits/);
  assert.match(migration, /UNIQUE INDEX `public_trade_lead_quote_photos_client_idx`/);
  assert.match(migration, /`status` text DEFAULT 'pending'/);
  assert.match(migration, /`content_type` text NOT NULL CHECK \(`content_type` IN \('image\/jpeg', 'image\/png'\)\)/);
  assert.doesNotMatch(migration, /image\/webp/);
  assert.match(migration, /`withdrawn_at` text DEFAULT ''/);
  const schema = read("../db/schema.ts");
  assert.match(schema, /publicTradeLeadQuotePhotos[\s\S]*status: text\("status"\)\.notNull\(\)\.default\("pending"\)/);
  assert.match(schema, /publicTradeLeadQuotePreparations[\s\S]*withdrawnAt: text\("withdrawn_at"\)/);
});
