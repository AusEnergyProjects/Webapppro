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
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
  normalizePublicPlanQuotePreparation,
  publicPlanQuoteAnswersForMatchedCategories,
  publicPlanQuoteCategoryIntersection,
  publicPlanQuotePhotoReplayDecision,
  publicPlanQuotePhotoPromptsForServices,
  publicPlanQuoteQuestionsForServices,
  publicPlanQuoteQuestionsForSnapshot,
  publicPlanQuoteUploadKeyHashMatches,
  publicPlanQuoteUploadRateDecision,
  publicPlanQuoteWithdrawalDecision,
  validPublicPlanQuoteClientUploadId,
  validPublicPlanQuoteUploadReference,
} from "../src/lib/public-plan-quote-preparation.mjs";
import {
  hasAllowedSignature,
  privateImageDimensions,
  sanitiseQuotingPhoto,
} from "../src/lib/private-image-evidence.ts";
import {
  drainPublicPlanQuotePhotoCleanup,
  shouldDrainPublicPlanQuotePhotoCleanup,
} from "../src/lib/public-plan-quote-photo-cleanup.ts";

const SERVICES = [
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "draught-proofing",
  "insulation",
  "glazing",
  "window-coverings",
  "ev-charging",
  "other",
];

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

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

test("each public service has three or four concise questions and combined services deduplicate globally", () => {
  for (const service of SERVICES) {
    const questions = publicPlanQuoteQuestionsForServices([service]);
    assert.ok(questions.length >= 3 && questions.length <= 4, `${service} has ${questions.length} questions`);
    assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
    assert.ok(questions.every((question) => question.label.length <= 80));
  }

  const combined = publicPlanQuoteQuestionsForServices(SERVICES);
  assert.equal(new Set(combined.map((question) => question.id)).size, combined.length);
  for (const service of SERVICES) {
    const serviceIds = publicPlanQuoteQuestionsForServices([service]).map((question) => question.id);
    assert.ok(serviceIds.every((id) => combined.some((question) => question.id === id)));
  }
});

test("known plan facts stay visible as exact editable suggestions instead of being silently shared or asked from scratch", () => {
  const questions = publicPlanQuoteQuestionsForSnapshot([
    "solar",
    "battery",
    "insulation",
    "heating-cooling",
    "hot-water",
  ], {
    propertyContext: {
      switchboard: "modern_breakers",
      roofType: "metal",
      roofCondition: "good",
    },
    features: [
      "solar-none",
      "wall-insulation-well",
      "gas-heating",
      "heat-pump-hot-water",
    ],
  });
  const suggestions = Object.fromEntries(questions
    .filter((question) => question.defaultAnswer)
    .map((question) => [question.id, question]));
  assert.equal(suggestions.switchboard.defaultAnswer, "Modern circuit breakers");
  assert.equal(suggestions["roof-details"].defaultAnswer, "Metal and sound");
  assert.equal(suggestions["existing-solar"].defaultAnswer, "No solar");
  assert.equal(suggestions["insulation-known"].defaultAnswer, "Well insulated or recently upgraded");
  assert.equal(suggestions["existing-heating-equipment"].defaultAnswer, "Gas");
  assert.equal(suggestions["existing-hot-water-equipment"].defaultAnswer, "Heat pump");
  assert.ok(Object.values(suggestions).every((question) =>
    question.answerSource === "private-plan"));

  const notSure = publicPlanQuoteQuestionsForSnapshot(["solar"], {
    propertyContext: { switchboard: "not_sure", roofType: "metal", roofCondition: "not_sure" },
  });
  assert.equal(notSure.find((question) => question.id === "switchboard").defaultAnswer, "");
  assert.equal(notSure.find((question) => question.id === "roof-details").defaultAnswer, "");
});

test("quote preparation normalises deterministic answers and rejects mismatched, duplicate or excessive input", () => {
  const services = ["hot-water", "battery"];
  const questions = publicPlanQuoteQuestionsForServices(services);
  const prompts = publicPlanQuotePhotoPromptsForServices(services);
  const suppliedAnswers = [questions[2], questions[0]].map((question) => ({
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
  const carried = normalizePublicPlanQuotePreparation({
    ...base,
    answers: [{ questionId: "switchboard", answer: "Modern circuit breakers" }],
  }, ["battery"], { propertyContext: { switchboard: "modern_breakers" } });
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.value.answers.map((answer) => answer.answer), ["Modern circuit breakers"]);
});

test("hot-water and heating use service-specific equipment and location photos plus the shared switchboard view", () => {
  assert.deepEqual(
    publicPlanQuotePhotoPromptsForServices(["hot-water"]).map((prompt) => prompt.id),
    ["hot-water-equipment-label", "hot-water-installation-area", "switchboard-front"],
  );
  assert.deepEqual(
    publicPlanQuotePhotoPromptsForServices(["heating-cooling"]).map((prompt) => prompt.id),
    ["heating-equipment-label", "heating-installation-area", "switchboard-front"],
  );
  const combined = publicPlanQuotePhotoPromptsForServices(["hot-water", "heating-cooling"]);
  assert.equal(new Set(combined.map((prompt) => prompt.id)).size, combined.length);
  assert.deepEqual(
    combined.find((prompt) => prompt.id === "hot-water-equipment-label").services,
    ["hot-water"],
  );
  assert.deepEqual(
    combined.find((prompt) => prompt.id === "heating-equipment-label").services,
    ["heating-cooling"],
  );
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
  assert.match(form, /Use \{knownPlanQuoteQuestions\.length\} known/);
  assert.match(form, /Suggested from your private plan/);
  assert.match(form, /known plan answers are included only when you select/i);
  assert.match(form, /setIncludeKnownPlanAnswers\(include\)/);
  assert.match(form, /accept="image\/jpeg,image\/png"/);
  assert.doesNotMatch(form, /image\/webp|WebP/);
  assert.match(form, /aria-label=\{`Add photos: \$\{prompt\.label\}`\}/);
  assert.match(form, /aria-describedby=\{hintId\}/);
  assert.match(form, /capture="environment"[\s\S]*multiple[\s\S]*type="file"/);
  assert.match(form, /const retained = quotePhotos/);
  assert.match(form, /quote answers or photos I chose to add/);
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

test("quote preparation persists once per source and is exposed only through signed-in matched-trade lead evidence", () => {
  const opportunity = read("../src/lib/opportunity-server.ts");
  const tradeRoute = read("../src/app/api/trade-opportunities/route.ts");
  const dashboard = read("../src/components/DirectTradeDashboard.tsx");
  const migration = read("../drizzle/0128_public_plan_quote_preparation.sql");
  const validation = read("../src/lib/lead-validation.mjs");
  const envelope = read("../src/lib/lead-envelope.mjs");

  assert.match(opportunity, /persistPublicQuotePreparation/);
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
