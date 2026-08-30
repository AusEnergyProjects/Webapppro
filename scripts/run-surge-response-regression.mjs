import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SURGE_RESPONSE_REGRESSION_CORPUS,
  SURGE_RESPONSE_REGRESSION_FAMILIES,
} from "../src/data/surge-response-regression-corpus.ts";
import { generateSurgeModelAnswer } from "../src/lib/energy-assistant-model.ts";
import { parseSurgePlanContext } from "../src/lib/energy-assistant-plan-context.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import {
  evaluateSurgeResponseRegression,
  surgeVisibleAnswerFromReply,
} from "../src/lib/surge-response-regression-gate.ts";

const CHECKPOINT_VERSION = 5;
const MAX_CONCURRENCY = 5;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_BUDGET_MICRO_USD = 60_000_000;
const LOCAL_ORIGIN = "https://surge-regression.local";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_ENV_PATH = join(REPOSITORY_ROOT, ".env.local");
const HELDOUT_FIXTURE_ROOT = join(REPOSITORY_ROOT, "test", "fixtures");
const HELDOUT_FIXTURE_VERSION = 1;
const MAX_HELDOUT_FIXTURE_BYTES = 256_000;
const MAX_HELDOUT_CASES = 50;
const DEFAULT_MODEL = "gpt-5.6-sol";
const FINGERPRINT_STANDALONE_PATHS = [
  "scripts/run-surge-response-regression.mjs",
  "src/components/EnergyAssistantWidget.tsx",
  "src/components/EnergyAssistantWidget.module.css",
];
const FINGERPRINT_SOURCE_ROOTS = ["src/data", "src/lib"];

function usage(message = "") {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write([
    "Usage:",
    "  npm run eval:surge-response-regression -- --run-label <immutable-label> --one-per-family --confirm-paid",
    "  npm run eval:surge-response-regression -- --run-label <immutable-label> --all --confirm-paid",
    "  npm run eval:surge-response-regression -- --run-label <immutable-label> --case-id <case-id> [--case-id <case-id>] --confirm-paid",
    "  npm run eval:surge-response-regression -- --fixture test/fixtures/<fixture>.json --run-label <immutable-label> --all --confirm-paid",
    "  npm run eval:surge-response-regression -- --run-label <label> --one-per-family --dry-run",
    "Options:",
    "  --sample one-per-family       Alias for --one-per-family.",
    "  --budget-micro-usd <integer>  Hard estimated-spend ceiling; default 60000000.",
    "  --concurrency 1..5            Default 3.",
    "  --checkpoint <path>           Override the run-scoped temp checkpoint.",
    "  --fixture <path>              Load an immutable JSON suite from test/fixtures.",
    "  --case-id <case-id>           Run one named case; repeat for a bounded repair sample.",
    "  --confirm-paid                Required for real API calls.",
    "  --dry-run                     Exercise the local handler with model admission denied.",
    "  --help                        Show this help without loading credentials.",
  ].join("\n") + "\n");
}

function secretShaped(value) {
  return /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~-]{16,}\b|\b(?:OPENAI_)?API_KEY\s*[:=]\s*\S+/i.test(value);
}

function safeText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{8,}\b/gi, "Bearer [REDACTED]")
    .replace(/\b(?:OPENAI_)?API_KEY\s*[:=]\s*\S+/gi, "API_KEY=[REDACTED]");
}

const HELDOUT_TAGS = new Set([
  "context",
  "multi_part",
  "numeric",
  "safety",
  "urgent_safety",
  "saved_context",
  "volatile_fact",
]);
const HELDOUT_MODEL_POLICIES = new Set(["allowed", "forbidden", "official_lookup"]);

function exactObjectKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function boundedFixtureText(value, maximum, { allowEmpty = false } = {}) {
  return typeof value === "string"
    && (allowEmpty || value.length > 0)
    && value.length <= maximum
    && !/[\u0000-\u001F\u007F]/u.test(value)
    && !secretShaped(value);
}

function validFixturePattern(value) {
  if (!boundedFixtureText(value, 500)) return false;
  try {
    new RegExp(value, "iu");
    return true;
  } catch {
    return false;
  }
}

function validFixturePatternList(value, { allowEmpty = true } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.length <= 24
    && value.every(validFixturePattern);
}

function validFixtureAssertions(value, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 16) return false;
  const ids = new Set();
  for (const item of value) {
    if (!exactObjectKeys(item, ["id", "anyOf"])
      || !boundedFixtureText(item.id, 80)
      || ids.has(item.id)
      || !validFixturePatternList(item.anyOf, { allowEmpty: false })) {
      return false;
    }
    ids.add(item.id);
  }
  return true;
}

function validFixtureRecentTurns(value) {
  return Array.isArray(value)
    && value.length <= 12
    && value.every((turn) => (
      exactObjectKeys(turn, ["role", "content"])
      && (turn.role === "user" || turn.role === "assistant")
      && boundedFixtureText(turn.content, 2_600)
    ));
}

function validFixturePlanContext(value) {
  if (value === null) return true;
  if (!exactObjectKeys(value, ["version", "source", "facts"])
    || !Array.isArray(value.facts)
    || !value.facts.every((fact) => (
      exactObjectKeys(fact, ["key", "value"])
      && boundedFixtureText(fact.key, 48)
      && boundedFixtureText(fact.value, 180)
    ))) {
    return false;
  }
  return parseSurgePlanContext(value) !== null;
}

function validHeldoutCase(value) {
  const keys = [
    "id",
    "family",
    "variant",
    "question",
    "tags",
    "clauses",
    "requiredNumbers",
    "forbiddenPatterns",
    "recentTurns",
    "planContext",
    "maxQuestions",
    "maxWords",
    "maxParagraphs",
    "modelPolicy",
    "safetyLeadAnyOf",
    "similarityGroup",
  ];
  return exactObjectKeys(value, keys)
    && typeof value.id === "string"
    && /^[a-z0-9][a-z0-9_-]{2,79}$/u.test(value.id)
    && !SURGE_RESPONSE_REGRESSION_CORPUS.some((entry) => entry.id === value.id)
    && !SURGE_RESPONSE_REGRESSION_CORPUS.some((entry) => entry.question === value.question)
    && SURGE_RESPONSE_REGRESSION_FAMILIES.includes(value.family)
    && Number.isSafeInteger(value.variant)
    && value.variant >= 1
    && value.variant <= 10_000
    && boundedFixtureText(value.question, 2_000)
    && Array.isArray(value.tags)
    && value.tags.length <= HELDOUT_TAGS.size
    && new Set(value.tags).size === value.tags.length
    && value.tags.every((tag) => HELDOUT_TAGS.has(tag))
    && validFixtureAssertions(value.clauses, { allowEmpty: false })
    && validFixtureAssertions(value.requiredNumbers)
    && validFixturePatternList(value.forbiddenPatterns)
    && validFixtureRecentTurns(value.recentTurns)
    && validFixturePlanContext(value.planContext)
    && (value.maxQuestions === 0 || value.maxQuestions === 1)
    && Number.isSafeInteger(value.maxWords)
    && value.maxWords >= 1
    && value.maxWords <= 300
    && Number.isSafeInteger(value.maxParagraphs)
    && value.maxParagraphs >= 1
    && value.maxParagraphs <= 8
    && HELDOUT_MODEL_POLICIES.has(value.modelPolicy)
    && validFixturePatternList(value.safetyLeadAnyOf)
    && boundedFixtureText(value.similarityGroup, 80, { allowEmpty: true })
    && (!value.tags.includes("urgent_safety") || value.safetyLeadAnyOf.length > 0);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateSurgeRegressionFixture(value) {
  if (!exactObjectKeys(value, ["version", "cases"])
    || value.version !== HELDOUT_FIXTURE_VERSION
    || !Array.isArray(value.cases)
    || value.cases.length < 1
    || value.cases.length > MAX_HELDOUT_CASES
    || !value.cases.every(validHeldoutCase)) {
    throw new Error("The held-out fixture does not match the reviewed schema.");
  }
  const ids = value.cases.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Held-out fixture case IDs must be unique.");
  }
  return deepFreeze(value.cases);
}

function pathIsContained(root, candidate) {
  const relativePath = relative(root, candidate);
  return Boolean(relativePath)
    && relativePath !== ".."
    && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !isAbsolute(relativePath);
}

export async function loadSurgeRegressionFixture(pathValue) {
  if (!boundedFixtureText(pathValue, 500) || extname(pathValue).toLowerCase() !== ".json") {
    throw new Error("Held-out fixture path must name a JSON file under test/fixtures.");
  }
  const lexicalPath = resolve(REPOSITORY_ROOT, pathValue);
  if (!pathIsContained(HELDOUT_FIXTURE_ROOT, lexicalPath)) {
    throw new Error("Held-out fixture path must stay under test/fixtures.");
  }

  const [fixtureRoot, details] = await Promise.all([
    realpath(HELDOUT_FIXTURE_ROOT),
    lstat(lexicalPath),
  ]);
  if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_HELDOUT_FIXTURE_BYTES) {
    throw new Error("Held-out fixture must be a bounded regular file.");
  }
  const fixturePath = await realpath(lexicalPath);
  if (!pathIsContained(fixtureRoot, fixturePath)) {
    throw new Error("Held-out fixture resolved outside test/fixtures.");
  }

  const source = await readFile(fixturePath, "utf8");
  if (secretShaped(source)) throw new Error("Held-out fixture must not contain a credential.");
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Held-out fixture must contain valid JSON.");
  }
  return { path: fixturePath, cases: validateSurgeRegressionFixture(parsed) };
}

export function sanitizeSurgeRegressionRejectionDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stage = safeText(value.stage).slice(0, 80);
  const visibleCandidate = safeText(value.visibleCandidate).slice(0, 2_600);
  const integerFields = [
    "answerWordCount",
    "visibleBlockCount",
    "questionPartCount",
    "declaredCoveredQuestionPartCount",
  ];
  const booleanFields = [
    "completeQuestionCoverage",
    "quantitiesGrounded",
    "suppliedQuestionQuantitiesPreserved",
    "everydayLanguagePassed",
  ];
  if (
    !stage
    || integerFields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0)
    || booleanFields.some((field) => typeof value[field] !== "boolean")
  ) return null;
  return {
    stage,
    visibleCandidate,
    answerWordCount: value.answerWordCount,
    visibleBlockCount: value.visibleBlockCount,
    questionPartCount: value.questionPartCount,
    declaredCoveredQuestionPartCount: value.declaredCoveredQuestionPartCount,
    completeQuestionCoverage: value.completeQuestionCoverage,
    quantitiesGrounded: value.quantitiesGrounded,
    suppliedQuestionQuantitiesPreserved: value.suppliedQuestionQuantitiesPreserved,
    everydayLanguagePassed: value.everydayLanguagePassed,
  };
}

function surgeRegressionRejectionDiagnosticIsValid(value) {
  const sanitized = sanitizeSurgeRegressionRejectionDiagnostic(value);
  if (!sanitized || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(sanitized);
  return Object.keys(value).length === keys.length
    && keys.every((key) => value[key] === sanitized[key]);
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function parseSurgeRegressionArgs(values) {
  const args = {
    runLabel: "",
    mode: "",
    caseIds: [],
    concurrency: DEFAULT_CONCURRENCY,
    budgetMicroUsd: DEFAULT_BUDGET_MICRO_USD,
    checkpoint: "",
    fixture: "",
    confirmPaid: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--run-label" || value === "--deployment-label") args.runLabel = values[++index] || "";
    else if (value === "--concurrency") args.concurrency = parsePositiveInteger(values[++index], "Concurrency");
    else if (value === "--budget-micro-usd") args.budgetMicroUsd = parsePositiveInteger(values[++index], "Budget");
    else if (value === "--checkpoint") args.checkpoint = values[++index] || "";
    else if (value === "--fixture") {
      if (args.fixture) throw new Error("Fixture must not be repeated.");
      args.fixture = values[++index] || "";
      if (!args.fixture) throw new Error("Fixture path is required after --fixture.");
    }
    else if (value === "--confirm-paid") args.confirmPaid = true;
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else if (value === "--case-id") {
      if (args.mode && args.mode !== "case-ids") throw new Error("Choose exactly one run mode.");
      const caseId = values[++index] || "";
      if (!caseId) throw new Error("Case ID is required after --case-id.");
      args.mode = "case-ids";
      args.caseIds.push(caseId);
    }
    else if (value === "--all") {
      if (args.mode) throw new Error("Choose exactly one run mode.");
      args.mode = "all";
    } else if (value === "--one-per-family") {
      if (args.mode) throw new Error("Choose exactly one run mode.");
      args.mode = "one-per-family";
    } else if (value === "--sample") {
      if (values[++index] !== "one-per-family") throw new Error("The only supported sample is one-per-family.");
      if (args.mode) throw new Error("Choose exactly one run mode.");
      args.mode = "one-per-family";
    } else {
      throw new Error("An unknown argument was supplied.");
    }
  }
  if (args.help) return args;
  if (!args.runLabel || !args.mode) throw new Error("Run label and run mode are required.");
  if (args.concurrency > MAX_CONCURRENCY) throw new Error(`Concurrency must not exceed ${MAX_CONCURRENCY}.`);
  if (args.runLabel.length > 160 || /[\u0000-\u001F\u007F]/u.test(args.runLabel)) {
    throw new Error("Run label must be a short printable value.");
  }
  if (secretShaped(args.runLabel)) throw new Error("Run label must not contain a credential.");
  if (new Set(args.caseIds).size !== args.caseIds.length) throw new Error("Case IDs must not be repeated.");
  if (!args.fixture
    && args.caseIds.some((caseId) => !SURGE_RESPONSE_REGRESSION_CORPUS.some((entry) => entry.id === caseId))) {
    throw new Error("An unknown regression case ID was supplied.");
  }
  if (args.fixture && args.mode === "one-per-family") {
    throw new Error("Fixture runs support only --all or explicit --case-id selection.");
  }
  if (!args.dryRun && !args.confirmPaid) throw new Error("Real model execution requires --confirm-paid.");
  if (args.dryRun && args.confirmPaid) throw new Error("Choose either --dry-run or --confirm-paid, not both.");
  return args;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function executionName(args) {
  return args.dryRun ? "dry-run" : "real-model";
}

export function createSurgeRegressionRunIdentity({
  runLabel,
  execution,
  sourceFingerprint,
  model,
}) {
  return hash(JSON.stringify({
    version: CHECKPOINT_VERSION,
    runLabel,
    execution,
    sourceFingerprint,
    model,
  }));
}

export function createSurgeRegressionCacheKey(runIdentity, entry) {
  return hash(JSON.stringify({
    version: CHECKPOINT_VERSION,
    runIdentity,
    case: entry,
  }));
}

async function surgeRegressionSourceFingerprint(fixturePath = "") {
  async function sourcePathsUnder(relativeDirectory) {
    const entries = await readdir(join(REPOSITORY_ROOT, relativeDirectory), { withFileTypes: true });
    const paths = [];
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) paths.push(...await sourcePathsUnder(relativePath));
      else if (entry.isFile() && /\.(?:json|mjs|ts|tsx)$/u.test(entry.name)) paths.push(relativePath);
    }
    return paths;
  }

  const sourcePaths = [...FINGERPRINT_STANDALONE_PATHS];
  for (const sourceRoot of FINGERPRINT_SOURCE_ROOTS) {
    sourcePaths.push(...await sourcePathsUnder(sourceRoot));
  }
  const source = createHash("sha256");
  for (const relativePath of [...new Set(sourcePaths)].sort()) {
    source.update(relativePath);
    source.update("\0");
    source.update(await readFile(join(REPOSITORY_ROOT, relativePath)));
    source.update("\0");
  }
  if (fixturePath) {
    source.update(`heldout:${relative(REPOSITORY_ROOT, fixturePath)}`);
    source.update("\0");
    source.update(await readFile(fixturePath));
    source.update("\0");
  }
  return source.digest("hex");
}

function defaultCheckpoint(runIdentity) {
  return join(tmpdir(), "surge-response-regression", `${runIdentity.slice(0, 20)}.json`);
}

export function selectSurgeRegressionCases(
  mode,
  caseIds = [],
  sourceCases = SURGE_RESPONSE_REGRESSION_CORPUS,
  familyOrder = SURGE_RESPONSE_REGRESSION_FAMILIES,
) {
  if (mode === "all") return [...sourceCases];
  if (mode === "case-ids") {
    return caseIds.map((caseId) => {
      const entry = sourceCases.find((candidate) => candidate.id === caseId);
      if (!entry) throw new Error(`Unknown regression case ID: ${caseId}`);
      return entry;
    });
  }
  return familyOrder.map((family) => {
    const entry = sourceCases.find((candidate) => candidate.family === family);
    if (!entry) throw new Error(`Corpus family is empty: ${family}`);
    return entry;
  });
}

export function surgeRegressionObservationIsValid(value, caseId) {
  return Boolean(value)
    && typeof value === "object"
    && value.caseId === caseId
    && Number.isInteger(value.httpStatus)
    && typeof value.content === "string"
    && typeof value.directAnswer === "string"
    && typeof value.visibleAnswer === "string"
    && typeof value.followUpQuestion === "string"
    && Array.isArray(value.quickReplies)
    && Number.isSafeInteger(value.estimatedMicroUsd)
    && value.estimatedMicroUsd >= 0
    && Number.isSafeInteger(value.modelReservations)
    && value.modelReservations >= 0
    && typeof value.modelAttempted === "boolean"
    && typeof value.modelFailureCode === "string"
    && typeof value.modelFailureStage === "string"
    && (value.modelRejectionDiagnostic === null
      || surgeRegressionRejectionDiagnosticIsValid(value.modelRejectionDiagnostic))
    && typeof value.answerSource === "string"
    && typeof value.budgetDenied === "boolean";
}

function emptyCheckpoint(args, runIdentity, sourceFingerprint, model) {
  return {
    version: CHECKPOINT_VERSION,
    runIdentity,
    runLabelHash: hash(args.runLabel),
    execution: executionName(args),
    sourceFingerprint,
    modelHash: hash(model),
    entries: {},
  };
}

async function loadCheckpoint(path, args, runIdentity, sourceFingerprint, model) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== CHECKPOINT_VERSION
      || parsed?.runIdentity !== runIdentity
      || parsed?.runLabelHash !== hash(args.runLabel)
      || parsed?.execution !== executionName(args)
      || parsed?.sourceFingerprint !== sourceFingerprint
      || parsed?.modelHash !== hash(model)
      || !parsed.entries
      || typeof parsed.entries !== "object") {
      return emptyCheckpoint(args, runIdentity, sourceFingerprint, model);
    }
    return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error("The regression checkpoint could not be read safely.");
    return emptyCheckpoint(args, runIdentity, sourceFingerprint, model);
  }
}

function checkpointWriter(path, checkpoint) {
  let pending = Promise.resolve();
  return () => {
    pending = pending.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    });
    return pending;
  };
}

async function loadLocalApiConfiguration() {
  let details;
  try {
    details = await lstat(LOCAL_ENV_PATH);
  } catch {
    throw new Error("The repository .env.local file is missing.");
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error("The repository .env.local path is not a trusted regular file.");
  }

  const inheritedKey = process.env.OPENAI_API_KEY;
  const inheritedModel = process.env.SURGE_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.SURGE_MODEL;
  let localKey = "";
  let localModel = "";
  try {
    process.loadEnvFile(LOCAL_ENV_PATH);
    localKey = process.env.OPENAI_API_KEY?.trim() || "";
    localModel = process.env.SURGE_MODEL?.trim() || "";
  } catch {
    throw new Error("The repository .env.local file could not be loaded safely.");
  } finally {
    if (inheritedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = inheritedKey;
    if (inheritedModel === undefined) delete process.env.SURGE_MODEL;
    else process.env.SURGE_MODEL = inheritedModel;
  }
  if (!localKey) throw new Error("OPENAI_API_KEY is not configured in .env.local.");
  return { apiKey: localKey, model: localModel || undefined };
}

function createBudget(limitMicroUsd, initialCommittedMicroUsd, initialRequestedMicroUsd, dryRun) {
  if (initialCommittedMicroUsd > limitMicroUsd) throw new Error("Cached estimated spend already exceeds the configured budget.");
  let committedMicroUsd = initialCommittedMicroUsd;
  let newCommittedMicroUsd = 0;
  let requestedMicroUsd = initialRequestedMicroUsd;
  return {
    reserve(estimatedMicroUsd) {
      requestedMicroUsd += estimatedMicroUsd;
      if (dryRun) return false;
      if (committedMicroUsd + estimatedMicroUsd > limitMicroUsd) return false;
      committedMicroUsd += estimatedMicroUsd;
      newCommittedMicroUsd += estimatedMicroUsd;
      return true;
    },
    summary() {
      return { limitMicroUsd, requestedMicroUsd, committedMicroUsd, newCommittedMicroUsd };
    },
  };
}

function requestFor(entry) {
  return new Request(`${LOCAL_ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: {
      origin: LOCAL_ORIGIN,
      "content-type": "application/json",
      "x-surge-quality-rehearsal": "aggregate-v1",
    },
    body: JSON.stringify({
      action: "ask",
      requestId: `trusted-regression-${entry.id}`,
      message: entry.question,
      recentTurns: entry.recentTurns,
      ...(entry.planContext ? { planContext: entry.planContext } : {}),
      audience: "public",
      pageContext: "/surge",
    }),
  });
}

async function runCase(entry, options) {
  let estimatedMicroUsd = 0;
  let modelReservations = 0;
  let modelAttempted = false;
  let budgetDenied = false;
  let modelFailureCode = "";
  let modelFailureStage = "";
  let modelRejectionDiagnostic = null;
  const startedAt = performance.now();
  const response = await handleEnergyAssistantRequest(requestFor(entry), {
    now: options.now,
    requireValidatedModelForOrdinaryAdvice: true,
    reserveModelCall: async ({ estimatedMicroUsd: estimate }) => {
      modelReservations += 1;
      estimatedMicroUsd = estimate;
      const allowed = options.budget.reserve(estimate);
      if (!allowed) {
        budgetDenied = !options.dryRun;
        return { allowed: false };
      }
      return { allowed: true, release: async () => undefined };
    },
    generateAnswer: async (modelRequest) => {
      modelAttempted = true;
      return generateSurgeModelAnswer(modelRequest, {
        apiKey: options.apiKey,
        model: options.model,
        enabled: true,
        onFailure: (failure) => {
          modelFailureCode = failure.code;
          modelFailureStage = failure.stage || "";
        },
        syntheticEvaluation: {
          onRejectedCandidate: (diagnostic) => {
            modelRejectionDiagnostic = sanitizeSurgeRegressionRejectionDiagnostic(diagnostic);
          },
        },
      });
    },
  });
  let payload = null;
  let rawBody = "";
  try {
    rawBody = await response.text();
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }
  const reply = payload?.reply || {};
  const leakedSecret = secretShaped(rawBody);
  return {
    caseId: entry.id,
    httpStatus: response.status,
    visibleAnswer: safeText(surgeVisibleAnswerFromReply(reply)),
    content: safeText(reply.content),
    directAnswer: safeText(reply.directAnswer),
    followUpQuestion: safeText(reply.followUpQuestion),
    quickReplies: Array.isArray(reply.quickReplies) ? reply.quickReplies.map(() => ({ redacted: true })) : [],
    answerSource: typeof payload?.quality?.answerSource === "string" ? payload.quality.answerSource : "",
    error: leakedSecret
      ? "Response contained secret-shaped text and was redacted."
      : budgetDenied
        ? "Estimated budget denied this model call."
        : payload?.ok === true
          ? ""
          : String(payload?.error?.code || "Invalid response payload"),
    latencyMs: performance.now() - startedAt,
    estimatedMicroUsd,
    modelReservations,
    modelAttempted,
    modelFailureCode,
    modelFailureStage,
    modelRejectionDiagnostic,
    budgetDenied,
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]);
}

function countBy(values) {
  return Object.fromEntries(
    [...new Set(values.filter(Boolean))]
      .sort()
      .map((value) => [value, values.filter((candidate) => candidate === value).length]),
  );
}

async function main() {
  let args;
  try {
    args = parseSurgeRegressionArgs(process.argv.slice(2));
  } catch (error) {
    usage(error instanceof Error ? error.message : "Arguments were not accepted.");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    usage();
    return;
  }

  const fixture = args.fixture ? await loadSurgeRegressionFixture(args.fixture) : null;
  const sourceCases = fixture?.cases || SURGE_RESPONSE_REGRESSION_CORPUS;
  const cases = selectSurgeRegressionCases(args.mode, args.caseIds, sourceCases);
  const configuration = args.dryRun ? { apiKey: "", model: DEFAULT_MODEL } : await loadLocalApiConfiguration();
  const effectiveModel = configuration.model || DEFAULT_MODEL;
  const sourceFingerprint = await surgeRegressionSourceFingerprint(fixture?.path || "");
  const runIdentity = createSurgeRegressionRunIdentity({
    runLabel: args.runLabel,
    execution: executionName(args),
    sourceFingerprint,
    model: effectiveModel,
  });
  const checkpointPath = args.checkpoint ? resolve(args.checkpoint) : defaultCheckpoint(runIdentity);
  const checkpoint = await loadCheckpoint(
    checkpointPath,
    args,
    runIdentity,
    sourceFingerprint,
    effectiveModel,
  );
  const selectedCache = new Map(cases.map((entry) => {
    const key = createSurgeRegressionCacheKey(runIdentity, entry);
    const cached = checkpoint.entries[key];
    return [entry.id, surgeRegressionObservationIsValid(cached, entry.id) ? cached : null];
  }));
  const cachedCommittedMicroUsd = [...selectedCache.values()]
    .filter(Boolean)
    .reduce((total, entry) => total + (entry.modelAttempted ? entry.estimatedMicroUsd : 0), 0);
  const cachedRequestedMicroUsd = [...selectedCache.values()]
    .filter(Boolean)
    .reduce((total, entry) => total + entry.estimatedMicroUsd, 0);
  const budget = createBudget(
    args.budgetMicroUsd,
    cachedCommittedMicroUsd,
    cachedRequestedMicroUsd,
    args.dryRun,
  );
  const saveCheckpoint = checkpointWriter(checkpointPath, checkpoint);
  const runNow = new Date();
  let cacheHits = 0;

  const observations = await mapConcurrent(cases, args.concurrency, async (entry) => {
    const cached = selectedCache.get(entry.id);
    if (cached) {
      cacheHits += 1;
      return cached;
    }
    const result = await runCase(entry, {
      apiKey: configuration.apiKey,
      model: configuration.model,
      budget,
      dryRun: args.dryRun,
      now: () => runNow,
    });
    if (!result.budgetDenied) {
      checkpoint.entries[createSurgeRegressionCacheKey(runIdentity, entry)] = result;
      await saveCheckpoint();
    }
    return result;
  });

  const report = evaluateSurgeResponseRegression(cases, observations, {
    requireAllowedModel: !args.dryRun,
  });
  const failures = [...report.results.flatMap((result) => result.failures), ...report.globalFailures];
  const latencies = observations.map((item) => item.latencyMs || 0).filter((value) => value > 0);
  const budgetSummary = budget.summary();
  const summary = {
    ready: args.dryRun ? null : report.ready,
    dryRun: args.dryRun,
    runFingerprint: runIdentity.slice(0, 12),
    mode: args.mode,
    caseCount: report.caseCount,
    cacheHits,
    customerVisibleGate: {
      passedCases: report.passedCases,
      failedCases: report.failedCases,
      failureCount: report.failureCount,
      failuresByCode: countBy(failures.map((item) => item.code)),
    },
    model: {
      reservationCases: observations.filter((item) => item.modelReservations > 0).length,
      reservationCount: observations.reduce((total, item) => total + item.modelReservations, 0),
      attemptedCases: observations.filter((item) => item.modelAttempted).length,
      acceptedCases: observations.filter((item) => item.answerSource === "model").length,
      fallbackCases: observations.filter((item) => item.modelAttempted && item.answerSource !== "model").length,
      budgetDeniedCases: observations.filter((item) => item.budgetDenied).length,
      answerSources: countBy(observations.map((item) => item.answerSource)),
      failuresByCode: countBy(observations.map((item) => item.modelFailureCode)),
      failuresByStage: countBy(observations.map((item) => item.modelFailureStage)),
      rejectionDiagnosticsRecorded: observations.filter((item) => item.modelRejectionDiagnostic).length,
    },
    estimatedBudgetMicroUsd: budgetSummary,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length ? Math.round(Math.max(...latencies)) : 0,
    },
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!args.dryRun && !report.ready) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.stderr.write("The local Surge regression run failed without exposing response or credential data.\n");
    process.exitCode = 1;
  }
}
