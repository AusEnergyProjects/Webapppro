import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseSurgeConversationState,
  surgeConversationTopicFor,
} from "../src/lib/energy-assistant-conversation.ts";
import {
  generateSurgeModelAnswer,
  surgeTextsSupplyImplicitCelsiusSetpoint,
} from "../src/lib/energy-assistant-model.ts";
import { parseSurgePlanContext } from "../src/lib/energy-assistant-plan-context.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import { sanitizeSurgeCustomerOfficialUrl } from "../src/lib/surge-official-citation.ts";
import { surgeTextHasIncompleteTrailingFragment } from "../src/lib/surge-everyday-answer.ts";
import { surgeVisibleAnswerFromReply } from "../src/lib/surge-response-regression-gate.ts";

const CHECKPOINT_VERSION = 5;
const FIXTURE_VERSIONS = new Set([1, 2]);
const DEFAULT_MODEL = "gpt-5.6-sol";
const LOCAL_ORIGIN = "https://surge-trajectory.local";
const MAX_FIXTURE_BYTES = 512_000;
const REQUIRED_V1_TURNS = 50;
const REQUIRED_V2_CONVERSATIONS = 20;
const MIN_V2_CONVERSATION_TURNS = 3;
const MAX_V2_CONVERSATION_TURNS = 8;
const MAX_TRAJECTORY_TURNS = REQUIRED_V2_CONVERSATIONS * MAX_V2_CONVERSATION_TURNS;
const MAX_MESSAGE_LENGTH = 2_600;
const MAX_RECENT_TURNS = 12;
const MAX_RECENT_CHARACTERS = 9_000;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "test", "fixtures");
const LOCAL_ENV_PATH = join(REPOSITORY_ROOT, ".env.local");
const SOURCE_PATHS = [
  "scripts/run-surge-conversation-trajectory.mjs",
  "src/app/api/energy-assistant/route.ts",
  "src/components/EnergyAssistantWidget.tsx",
  "src/lib",
  "src/data",
];
const SOURCE_POLICIES = new Set(["model_required", "deterministic", "official_lookup", "official_reference"]);
const CONVERSATION_ASSERTION_TYPES = new Set([
  "turn_count",
  "all_http_status",
  "valid_continuation_every_turn",
  "request_history_bounds",
  "source_policy_enforced",
  "official_citation_requirements",
  "forbid_patterns_all_responses",
  "maximum_adjacent_normalized_similarity",
  "quick_reply_count_all_turns",
  "question_count_matches_turn_limit",
  "forbid_reasking_known_facts",
  "cross_turn_correction",
  "cross_turn_topic_isolation",
  "return_after_interruption",
  "forbid_patterns_turn_range",
  "property_boundary",
  "structured_action_count",
  "long_range_recall",
  "quantity_grounding_all_turns",
  "all_turn_clauses_pass",
]);
const GENERIC_FAILURE_PATTERNS = [
  "staged whole-home diagnosis",
  "affected room or major end use",
  "Name the exact home-energy decision",
  "I found a related current official source",
  "For the supplied Victoria owner context",
  "Wattzun AI provides general home-energy guidance",
];

function usage(message = "") {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write([
    "Usage:",
    "  npm run eval:surge-conversation-trajectory -- --fixture test/fixtures/<fixture>.json --run-label <immutable-label> --scripted",
    "  npm run eval:surge-conversation-trajectory -- --fixture test/fixtures/<fixture>.json --run-label <immutable-label> --budget-micro-usd <hard-limit> --confirm-paid",
    "",
    "Options:",
    "  --checkpoint <path>          Override the run-scoped temporary checkpoint.",
    "  --retry-failed-turn          Retry the one checkpointed HTTP/provider failure.",
    "  --scripted                   No-provider sequential plumbing rehearsal.",
    "  --confirm-paid               Run the trajectory through the configured model.",
    "  --budget-micro-usd <amount>  Required explicit paid-run reservation ceiling.",
    "  --help                       Show this help without loading credentials.",
  ].join("\n") + "\n");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function secretShaped(value) {
  return /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~-]{16,}\b|\b(?:OPENAI_)?API_KEY\s*[:=]\s*\S+/i.test(value);
}

function safeText(value, maximum = 8_000) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{8,}\b/gi, "Bearer [REDACTED]")
    .replace(/\b(?:OPENAI_)?API_KEY\s*[:=]\s*\S+/gi, "API_KEY=[REDACTED]")
    .slice(0, maximum);
}

function safeDiagnosticCount(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function safeDiagnosticBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

export function sanitizeTrajectoryRejectionDiagnostic(value) {
  const source = record(value);
  if (!source) return null;
  const candidate = safeText(source.visibleCandidate, 4_000)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .trim();
  const stage = safeText(source.stage, 80).trim();
  return {
    stage: /^[a-z][a-z0-9_]{1,79}$/u.test(stage) ? stage : "",
    visibleCandidate: secretShaped(candidate) ? "[REDACTED]" : candidate,
    answerWordCount: safeDiagnosticCount(source.answerWordCount, 10_000),
    visibleBlockCount: safeDiagnosticCount(source.visibleBlockCount, 100),
    questionPartCount: safeDiagnosticCount(source.questionPartCount, 100),
    declaredCoveredQuestionPartCount: safeDiagnosticCount(
      source.declaredCoveredQuestionPartCount,
      100,
    ),
    completeQuestionCoverage: safeDiagnosticBoolean(source.completeQuestionCoverage),
    quantitiesGrounded: safeDiagnosticBoolean(source.quantitiesGrounded),
    suppliedQuestionQuantitiesPreserved: safeDiagnosticBoolean(
      source.suppliedQuestionQuantitiesPreserved,
    ),
    everydayLanguagePassed: safeDiagnosticBoolean(source.everydayLanguagePassed),
  };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactKeys(value, keys) {
  const source = record(value);
  return Boolean(source)
    && Object.keys(source).length === keys.length
    && keys.every((key) => Object.hasOwn(source, key));
}

function boundedText(value, maximum, { allowEmpty = false } = {}) {
  return typeof value === "string"
    && value.length <= maximum
    && (allowEmpty || value.trim().length > 0)
    && !/[\u0000-\u001F\u007F]/u.test(value)
    && !secretShaped(value);
}

function validPattern(value) {
  if (!boundedText(value, 260)) return false;
  try {
    new RegExp(value, "i");
    return true;
  } catch {
    return false;
  }
}

function validPatternList(value, { allowEmpty = true } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.length <= 20
    && value.every(validPattern);
}

function validClauses(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return false;
  const ids = new Set();
  return value.every((clause) => {
    const source = record(clause);
    if (!source) return false;
    const keys = [
      "id",
      "anyOf",
      ...(Object.hasOwn(source, "target") ? ["target"] : []),
      ...(Object.hasOwn(source, "requireAffirmed") ? ["requireAffirmed"] : []),
    ];
    if (!exactKeys(source, keys)
      || !/^[a-z0-9][a-z0-9_-]{1,79}$/u.test(source.id)
      || ids.has(source.id)
      || !validPatternList(source.anyOf, { allowEmpty: false })
      || (Object.hasOwn(source, "target")
        && !["visible_answer", "first_practical_step"].includes(source.target))
      || (Object.hasOwn(source, "requireAffirmed")
        && source.requireAffirmed !== true)) return false;
    ids.add(source.id);
    return true;
  });
}

function validStateExpectation(value) {
  if (!exactKeys(value, [
    "activeTopicAnyOf",
    "goalAnyOf",
    "factsExclude",
    "pendingQuestion",
  ])) return false;
  if (!Array.isArray(value.activeTopicAnyOf)
    || value.activeTopicAnyOf.length > 12
    || !value.activeTopicAnyOf.every((item) => boundedText(item, 48))) return false;
  if (!validPatternList(value.goalAnyOf)) return false;
  if (![value.factsExclude].every((items) => (
    Array.isArray(items)
    && items.length <= 20
    && items.every((item) => boundedText(item, 180))
  ))) return false;
  return ["empty", "optional_material", "required_material"].includes(value.pendingQuestion);
}

function validTurn(value, index, version) {
  const keys = version === 2 ? [
    "conversationId",
    "id",
    "message",
    "sourcePolicy",
    "clauses",
    "forbiddenPatterns",
    "maxWords",
    "maxParagraphs",
    "maxQuestions",
    "state",
  ] : [
    "id",
    "message",
    "sourcePolicy",
    "clauses",
    "forbiddenPatterns",
    "maxWords",
    "maxParagraphs",
    "maxQuestions",
    "state",
  ];
  const validIdentity = version === 2
    ? /^c(?:0[1-9]|1\d|20)$/u.test(value.conversationId)
      && value.id.startsWith(`${value.conversationId}t`)
      && /^c(?:0[1-9]|1\d|20)t0[1-8](?:-[a-z0-9][a-z0-9_-]{1,49})?$/u.test(value.id)
    : value.id.startsWith(`t${String(index + 1).padStart(2, "0")}-`);
  return exactKeys(value, keys)
    && validIdentity
    && /^[a-z0-9][a-z0-9_-]{2,59}$/u.test(value.id)
    && boundedText(value.message, MAX_MESSAGE_LENGTH)
    && SOURCE_POLICIES.has(value.sourcePolicy)
    && validClauses(value.clauses)
    && validPatternList(value.forbiddenPatterns)
    && Number.isSafeInteger(value.maxWords)
    && value.maxWords >= 1
    && value.maxWords <= 300
    && Number.isSafeInteger(value.maxParagraphs)
    && value.maxParagraphs >= 1
    && value.maxParagraphs <= 8
    && (value.maxQuestions === 0 || value.maxQuestions === 1)
    && validStateExpectation(value.state);
}

function safeFixtureValue(value, depth = 0) {
  if (depth > 6) return false;
  if (typeof value === "string") return boundedText(value, 500, { allowEmpty: true });
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean" || value === null) return true;
  if (Array.isArray(value)) return value.length <= 40 && value.every((item) => safeFixtureValue(item, depth + 1));
  const source = record(value);
  return Boolean(source)
    && Object.keys(source).length <= 20
    && Object.entries(source).every(([key, item]) => (
      /^[A-Za-z][A-Za-z0-9_]*$/u.test(key)
      && safeFixtureValue(item, depth + 1)
    ));
}

function validOfficialCitationCheckpoint(value) {
  const source = record(value);
  if (!exactKeys(source, ["turn", "minimumCount", "requiredUrls"])
    || !boundedText(source.turn, 80)
    || !Number.isSafeInteger(source.minimumCount)
    || source.minimumCount < 1
    || source.minimumCount > 8
    || !Array.isArray(source.requiredUrls)
    || source.requiredUrls.length < 1
    || source.requiredUrls.length > source.minimumCount
    || new Set(source.requiredUrls).size !== source.requiredUrls.length) return false;
  return source.requiredUrls.every((url) => (
    boundedText(url, 500)
    && sanitizeSurgeCustomerOfficialUrl(url) === url
  ));
}

function validConversationAssertion(value) {
  const source = record(value);
  if (!source) return false;
  if (!boundedText(source.id, 80)
    || !/^[a-z0-9][a-z0-9_-]{1,79}$/u.test(source.id)
    || !boundedText(source.type, 80)
    || !/^[a-z][a-z0-9_]{2,79}$/u.test(source.type)
    || !CONVERSATION_ASSERTION_TYPES.has(source.type)
    || !safeFixtureValue(source)) return false;
  if (source.type === "official_citation_requirements") {
    return exactKeys(source, ["id", "type", "checkpoints"])
      && Array.isArray(source.checkpoints)
      && source.checkpoints.length >= 1
      && source.checkpoints.length <= MAX_TRAJECTORY_TURNS
      && source.checkpoints.every(validOfficialCitationCheckpoint)
      && new Set(source.checkpoints.map((checkpoint) => checkpoint.turn)).size
        === source.checkpoints.length;
  }
  if (source.type === "structured_action_count") {
    return exactKeys(source, ["id", "type", "turn", "exactActionCount"])
      && boundedText(source.turn, 80)
      && Number.isSafeInteger(source.exactActionCount)
      && source.exactActionCount >= 1
      && source.exactActionCount <= 8;
  }
  return true;
}

export function validateSurgeConversationTrajectoryFixture(value) {
  const baseValid = exactKeys(value, [
    "version",
    "id",
    "reviewedBy",
    "reviewedOn",
    "planContext",
    "execution",
    "turns",
    "conversationAssertions",
  ])
    && FIXTURE_VERSIONS.has(value.version)
    && /^[a-z0-9][a-z0-9_-]{4,119}$/u.test(value.id)
    && boundedText(value.reviewedBy, 120)
    && /^\d{4}-\d{2}-\d{2}$/u.test(value.reviewedOn)
    && parseSurgePlanContext(value.planContext) !== null
    && Array.isArray(value.turns)
    && value.turns.every((turn, index) => validTurn(turn, index, value.version))
    && Array.isArray(value.conversationAssertions)
    && value.conversationAssertions.length >= 1
    && value.conversationAssertions.length <= 30
    && value.conversationAssertions.every(validConversationAssertion);
  if (!baseValid) {
    throw new Error("The conversation trajectory fixture does not match the reviewed schema.");
  }
  const validV1Execution = value.version === 1
    && exactKeys(value.execution, [
      "userTurns",
      "recentTurnLimit",
      "recentCharacterLimit",
      "persistContinuation",
      "requireValidatedModelForOrdinaryAdvice",
    ])
    && value.execution.userTurns === REQUIRED_V1_TURNS
    && value.turns.length === REQUIRED_V1_TURNS
    && value.execution.persistContinuation === true;
  const validV2Execution = value.version === 2
    && exactKeys(value.execution, [
      "userTurns",
      "conversationCount",
      "minimumTurnsPerConversation",
      "maximumTurnsPerConversation",
      "resetStateBetweenConversations",
      "persistContinuationWithinConversation",
      "recentTurnLimit",
      "recentCharacterLimit",
      "requireValidatedModelForOrdinaryAdvice",
    ])
    && value.execution.userTurns === value.turns.length
    && value.execution.conversationCount === REQUIRED_V2_CONVERSATIONS
    && value.execution.minimumTurnsPerConversation === MIN_V2_CONVERSATION_TURNS
    && value.execution.maximumTurnsPerConversation === MAX_V2_CONVERSATION_TURNS
    && value.execution.resetStateBetweenConversations === true
    && value.execution.persistContinuationWithinConversation === true
    && value.turns.length >= REQUIRED_V2_CONVERSATIONS * MIN_V2_CONVERSATION_TURNS
    && value.turns.length <= MAX_TRAJECTORY_TURNS;
  if (!(validV1Execution || validV2Execution)
    || value.execution.recentTurnLimit !== MAX_RECENT_TURNS
    || value.execution.recentCharacterLimit !== MAX_RECENT_CHARACTERS
    || value.execution.requireValidatedModelForOrdinaryAdvice !== true) {
    throw new Error("The conversation trajectory fixture does not match the reviewed execution contract.");
  }
  if (value.version === 2) {
    const expectedConversationIds = Array.from(
      { length: REQUIRED_V2_CONVERSATIONS },
      (_, index) => `c${String(index + 1).padStart(2, "0")}`,
    );
    const encounteredConversationIds = [];
    const counts = new Map();
    let previousConversationId = "";
    for (const turn of value.turns) {
      if (turn.conversationId !== previousConversationId) {
        encounteredConversationIds.push(turn.conversationId);
        previousConversationId = turn.conversationId;
      }
      const turnNumber = (counts.get(turn.conversationId) || 0) + 1;
      counts.set(turn.conversationId, turnNumber);
      const expectedTurnPrefix = `${turn.conversationId}t${String(turnNumber).padStart(2, "0")}`;
      if (turn.id !== expectedTurnPrefix && !turn.id.startsWith(`${expectedTurnPrefix}-`)) {
        throw new Error("Conversation trajectory turn IDs must be sequential within each conversation.");
      }
    }
    if (JSON.stringify(encounteredConversationIds) !== JSON.stringify(expectedConversationIds)
      || expectedConversationIds.some((id) => (
        counts.get(id) < MIN_V2_CONVERSATION_TURNS
        || counts.get(id) > MAX_V2_CONVERSATION_TURNS
      ))) {
      throw new Error("Version 2 trajectories must contain twenty contiguous three-to-eight-turn conversations.");
    }
    if (!expectedConversationIds.some((id) => ((counts.get(id) - 1) * 2) > MAX_RECENT_TURNS)) {
      throw new Error("Version 2 trajectories must include a return turn after the seed transcript is evicted.");
    }
  }
  const turnIds = value.turns.map((turn) => turn.id);
  if (new Set(turnIds).size !== turnIds.length) {
    throw new Error("Conversation trajectory turn IDs must be unique.");
  }
  const knownTurnIds = new Set(turnIds);
  const assertionReferencesKnownTurns = value.conversationAssertions.every((assertion) => {
    if (assertion.type === "official_citation_requirements") {
      return assertion.checkpoints.every((checkpoint) => knownTurnIds.has(checkpoint.turn));
    }
    if (assertion.type === "structured_action_count") {
      return knownTurnIds.has(assertion.turn);
    }
    return true;
  });
  if (!assertionReferencesKnownTurns) {
    throw new Error("Conversation trajectory assertions must reference a configured turn.");
  }
  const clauseIds = value.turns.flatMap((turn) => turn.clauses.map((clause) => `${turn.id}:${clause.id}`));
  if (new Set(clauseIds).size !== clauseIds.length) {
    throw new Error("Conversation trajectory clause IDs must be unique within each turn.");
  }
  return Object.freeze(value);
}

function pathIsContained(root, candidate) {
  const relativePath = relative(root, candidate);
  return Boolean(relativePath)
    && relativePath !== ".."
    && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !isAbsolute(relativePath);
}

export async function loadSurgeConversationTrajectoryFixture(pathValue) {
  if (!boundedText(pathValue, 500) || extname(pathValue).toLowerCase() !== ".json") {
    throw new Error("Trajectory fixture path must name a JSON file under test/fixtures.");
  }
  const lexicalPath = resolve(REPOSITORY_ROOT, pathValue);
  if (!pathIsContained(FIXTURE_ROOT, lexicalPath)) {
    throw new Error("Trajectory fixture path must stay under test/fixtures.");
  }
  const [fixtureRoot, details] = await Promise.all([realpath(FIXTURE_ROOT), lstat(lexicalPath)]);
  if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_FIXTURE_BYTES) {
    throw new Error("Trajectory fixture must be a bounded regular file.");
  }
  const fixturePath = await realpath(lexicalPath);
  if (!pathIsContained(fixtureRoot, fixturePath)) {
    throw new Error("Trajectory fixture resolved outside test/fixtures.");
  }
  const source = await readFile(fixturePath, "utf8");
  if (secretShaped(source)) throw new Error("Trajectory fixture must not contain a credential.");
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Trajectory fixture must contain valid JSON.");
  }
  return { path: fixturePath, source, fixture: validateSurgeConversationTrajectoryFixture(parsed) };
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

export function parseSurgeConversationTrajectoryArgs(values) {
  const args = {
    fixture: "",
    runLabel: "",
    checkpoint: "",
    budgetMicroUsd: 0,
    scripted: false,
    confirmPaid: false,
    retryFailedTurn: false,
    help: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--fixture") args.fixture = values[++index] || "";
    else if (value === "--run-label") args.runLabel = values[++index] || "";
    else if (value === "--checkpoint") args.checkpoint = values[++index] || "";
    else if (value === "--budget-micro-usd") args.budgetMicroUsd = positiveInteger(values[++index], "Budget");
    else if (value === "--scripted") args.scripted = true;
    else if (value === "--confirm-paid") args.confirmPaid = true;
    else if (value === "--retry-failed-turn") args.retryFailedTurn = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error("An unknown argument was supplied.");
  }
  if (args.help) return args;
  if (!args.fixture || !args.runLabel) throw new Error("Fixture and run label are required.");
  if (args.scripted === args.confirmPaid) throw new Error("Choose exactly one of --scripted or --confirm-paid.");
  if (args.confirmPaid && args.budgetMicroUsd < 1) {
    throw new Error("Paid trajectory runs require an explicit --budget-micro-usd hard limit.");
  }
  if (args.runLabel.length > 160 || /[\u0000-\u001F\u007F]/u.test(args.runLabel)) {
    throw new Error("Run label must be a short printable value.");
  }
  return args;
}

export function recentTurnsForTrajectory(messages) {
  const turns = [];
  for (const message of messages) {
    const content = safeText(message?.content, MAX_MESSAGE_LENGTH).trim();
    if (!content || (message?.role !== "user" && message?.role !== "assistant")) continue;
    const turn = { role: message.role, content };
    if (turns.at(-1)?.role === turn.role) turns[turns.length - 1] = turn;
    else turns.push(turn);
  }
  if (turns.length > MAX_RECENT_TURNS) turns.splice(0, turns.length - MAX_RECENT_TURNS);
  while (turns.length > 0
    && turns.reduce((total, turn) => total + turn.content.length, 0) > MAX_RECENT_CHARACTERS) {
    turns.shift();
  }
  if (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

async function sourceFiles(pathValue) {
  const details = await lstat(pathValue);
  if (details.isFile()) return [pathValue];
  if (!details.isDirectory()) return [];
  const entries = await readdir(pathValue, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter((entry) => !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => sourceFiles(join(pathValue, entry.name))));
  return nested.flat();
}

async function sourceFingerprint(fixturePath) {
  const paths = (await Promise.all(SOURCE_PATHS.map((pathValue) => sourceFiles(join(REPOSITORY_ROOT, pathValue)))))
    .flat()
    .concat(fixturePath)
    .sort();
  const digest = createHash("sha256");
  for (const pathValue of paths) {
    digest.update(relative(REPOSITORY_ROOT, pathValue).replaceAll("\\", "/"));
    digest.update("\0");
    digest.update(await readFile(pathValue));
    digest.update("\0");
  }
  return digest.digest("hex");
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
  let apiKey = "";
  let model = "";
  try {
    process.loadEnvFile(LOCAL_ENV_PATH);
    apiKey = process.env.OPENAI_API_KEY?.trim() || "";
    model = process.env.SURGE_MODEL?.trim() || "";
  } finally {
    if (inheritedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = inheritedKey;
    if (inheritedModel === undefined) delete process.env.SURGE_MODEL;
    else process.env.SURGE_MODEL = inheritedModel;
  }
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured in .env.local.");
  return { apiKey, model: model || DEFAULT_MODEL };
}

export function createSurgeTrajectoryBudget(limitMicroUsd, committedMicroUsd = 0) {
  if (!Number.isSafeInteger(limitMicroUsd) || limitMicroUsd < 1) {
    throw new Error("The hard budget must be a positive integer.");
  }
  if (!Number.isSafeInteger(committedMicroUsd) || committedMicroUsd < 0) {
    throw new Error("Checkpointed reservations must be a non-negative integer.");
  }
  if (committedMicroUsd > limitMicroUsd) throw new Error("Checkpointed reservations exceed the hard budget.");
  let committed = committedMicroUsd;
  let requested = committedMicroUsd;
  return {
    reserve(estimate) {
      requested += estimate;
      if (committed + estimate > limitMicroUsd) return false;
      committed += estimate;
      return true;
    },
    observe(estimate) {
      requested += estimate;
    },
    summary() {
      return { limitMicroUsd, requestedMicroUsd: requested, committedMicroUsd: committed };
    },
  };
}

function requestForTurn(turn, index, fixture, recentTurns, continuation) {
  return new Request(`${LOCAL_ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: {
      origin: LOCAL_ORIGIN,
      "content-type": "application/json",
      "x-surge-quality-rehearsal": "aggregate-v1",
    },
    body: JSON.stringify({
      action: "ask",
      requestId: `trusted-trajectory-${turn.id}-${String(index + 1).padStart(2, "0")}`,
      message: turn.message,
      recentTurns,
      continuation,
      planContext: fixture.planContext,
      audience: "public",
      pageContext: "/surge",
    }),
  });
}

function conversationIdForTurn(turn, fixture) {
  return fixture.version === 2 ? turn.conversationId : "trajectory-v1";
}

function observationsInLatestConversation(observations) {
  const latestConversationId = observations.at(-1)?.conversationId;
  if (!latestConversationId) return observations;
  let firstIndex = observations.length - 1;
  while (firstIndex > 0 && observations[firstIndex - 1]?.conversationId === latestConversationId) {
    firstIndex -= 1;
  }
  return observations.slice(firstIndex);
}

export function resetSurgeTrajectoryStateAtConversationBoundary(fixture, turn, state) {
  const conversationId = conversationIdForTurn(turn, fixture);
  if (fixture.version === 2 && state.observations.at(-1)?.conversationId !== conversationId) {
    state.recentTurns = [];
    state.continuation = null;
  }
  return state;
}

function match(value, pattern) {
  return new RegExp(pattern, "i").test(value);
}

function requiredMatchIsNegated(value, matchIndex, matchLength) {
  const preceding = value.slice(Math.max(0, matchIndex - 140), matchIndex);
  const affirmativeNegationPrefix = /\b(?:cannot|can['’]?t|does\s+not|doesn['’]?t|do\s+not|don['’]?t|will\s+not|won['’]?t)\s+(?:prevent|stop|block|rule\s+out)\b[^.!?;,\n]{0,60}$/iu
    .test(preceding);
  if (!affirmativeNegationPrefix && forbiddenMatchIsNegated(value, matchIndex)) return true;
  const matchedText = value.slice(matchIndex, matchIndex + matchLength);
  const following = value.slice(matchIndex + matchLength, matchIndex + matchLength + 140);
  const precedingClause = preceding.split(/[.!?;\n]/u).at(-1) || "";
  const followingClause = following.split(/[.!?;\n]/u)[0] || "";
  const relevantClause = `${precedingClause}${matchedText}${followingClause}`;
  const directlyNegatedAction = /\b(?:cannot|can['’]?t|do\s+not|don['’]?t|does\s+not|doesn['’]?t|will\s+not|won['’]?t|would\s+not|wouldn['’]?t|should\s+not|shouldn['’]?t|must\s+not|mustn['’]?t|may\s+not|might\s+not|is\s+not|isn['’]?t|are\s+not|aren['’]?t|never|no\s+longer)\s+(?:still\s+)?(?:be\s+)?(?:use(?:d|s|ing)?|suppl(?:y|ies|ied|ying)|power(?:s|ed|ing)?|generat(?:e|es|ed|ing)|remain(?:s|ed|ing)?|benefit(?:s|ed|ing)?|start|address|control|tackle)\b/iu;
  const unavailableRelationship = /\b(?:solar\s+use|home\s+use|self[- ]consumption|use|using|suppl(?:y|ies|ied|ying)|power(?:s|ed|ing)?|generat(?:e|es|ed|ing))\b[^.!?;,\n]{0,55}\b(?:is|are|be|becomes?|remains?)\s+(?:not\s+(?:possible|available|useful|beneficial|worthwhile|allowed)|impossible|unavailable|pointless|unusable|worthless|of\s+no\s+(?:benefit|value|use))\b/iu;
  const negativePriority = /\b(?:moisture|condensation|damp|mould|mold|bathroom\s+fan|airflow)\b[^.!?;,\n]{0,55}\b(?:is|are|should\s+be|must\s+be|would\s+be)\s+(?:(?:absolutely|definitely|certainly|clearly)\s+)?not\s+(?:the\s+)?(?:first\s+)?(?:priority|step)\b/iu;
  if (directlyNegatedAction.test(relevantClause)
    || unavailableRelationship.test(relevantClause)
    || negativePriority.test(relevantClause)) {
    return true;
  }
  return /^\s*(?:(?:as\s+)?(?:the\s+)?(?:first\s+)?(?:priority|step)|first)?\s*\?\s*(?:(?:absolutely|definitely|certainly|clearly|actually|of\s+course)\s+)*(?:no|not|never)\b/iu
    .test(following);
}

function matchesRequired(value, pattern, requireAffirmed) {
  if (!requireAffirmed) return match(value, pattern);
  const expression = new RegExp(pattern, "ig");
  let candidate = expression.exec(value);
  while (candidate) {
    if (!requiredMatchIsNegated(value, candidate.index, candidate[0].length)) return true;
    if (!candidate[0]) expression.lastIndex += 1;
    candidate = expression.exec(value);
  }
  return false;
}

function forbiddenMatchIsNegated(value, matchIndex) {
  const preceding = value.slice(Math.max(0, matchIndex - 120), matchIndex);
  const clausePrefix = preceding
    .split(/[.!?;,:\n]|\b(?:but|however|although|yet)\b/iu)
    .at(-1)
    ?.trim() || "";
  if (!clausePrefix || /\bnot only\b/iu.test(clausePrefix)) return false;
  return /\b(?:not|never|no longer|cannot|can't|won't|shouldn't|mustn't|don't|doesn't|didn't|avoid(?:ed|ing|s)?|rather than|instead of|without|no need to|no reason to)\b[^.!?;,:\n]{0,80}$/iu.test(clausePrefix);
}

function forbiddenNumericMatchIsInternallyNegated(value, matchIndex, matchLength) {
  const matchedText = value.slice(matchIndex, matchIndex + matchLength);
  const numericMatches = [...matchedText.matchAll(/\$?\s*\d[\d,.]*/gu)];
  const lastNumeric = numericMatches.at(-1);
  if (!lastNumeric || lastNumeric.index === undefined) return false;
  const beforeNumber = matchedText.slice(0, lastNumeric.index)
    .split(/[.!?;:\n]|\b(?:but|however|although|yet)\b/iu)
    .at(-1)
    ?.trim() || "";
  if (/\bnot only\b/iu.test(beforeNumber)) return false;
  return /\b(?:not|never|no longer|isn['’]?t|wasn['’]?t|aren['’]?t|weren['’]?t|rather than|instead of)\b\s*(?:(?:the\s+)?(?:old|original|previous|earlier)\s+)?(?:(?:about|around|approximately|roughly|exactly)\s+)?$/iu
    .test(beforeNumber);
}

function forbiddenMatchIsHistoricalContrast(value, matchIndex, matchLength) {
  const preceding = value.slice(Math.max(0, matchIndex - 120), matchIndex);
  const matchedText = value.slice(matchIndex, matchIndex + matchLength);
  const following = value.slice(matchIndex + matchLength, matchIndex + matchLength + 180);
  const historicalLead = /(?:\b(?:earlier|first|initially|originally|previously)\b[^.!?;:\n]{0,55}\b(?:said|stated|quoted|entered|copied|gave)\b\s*|\b(?:old|original|previous|initial)\s+(?:figure|price|value|amount|time)?\s*)$/iu
    .test(preceding);
  const labelledError = /^[^.!?\n]{0,80}\b(?:was|is)\b[^.!?\n]{0,55}\b(?:copied error|error|mistake|mistaken|incorrect|wrong|old figure|old price|old value)\b/iu
    .test(following);
  const explicitReplacement = /\b(?:corrected|changed|updated|replaced)\b[^.!?\n]{0,40}\b(?:to|with)\b|\b(?:actually|rather than|instead(?: of)?|both|same)\b/iu
    .test(following);
  const currentReplacement = /\b(?:but|however|then|now)\b[^.!?\n]{0,80}\b(?:actual(?:ly)?|correct(?:ed)?|current)\b/iu
    .test(following);
  const matchedNumbers = new Set(
    [...matchedText.matchAll(/\d[\d,.]*/g)].map((item) => item[0].replace(/[,.]/g, "")),
  );
  const hasAffirmedDistinctReplacementNumber = [...following.matchAll(/\d[\d,.]*/g)]
    .some((item) => {
      const normalized = item[0].replace(/[,.]/g, "");
      return normalized
        && !matchedNumbers.has(normalized)
        && !forbiddenMatchIsNegated(following, item.index || 0);
    });
  if (matchedNumbers.size) {
    return hasAffirmedDistinctReplacementNumber
      && ((historicalLead && (explicitReplacement || currentReplacement)) || labelledError);
  }
  return (historicalLead || labelledError) && explicitReplacement;
}

function matchesForbidden(value, pattern) {
  const expression = new RegExp(pattern, "ig");
  let candidate = expression.exec(value);
  while (candidate) {
    if (!forbiddenMatchIsNegated(value, candidate.index)
      && !forbiddenNumericMatchIsInternallyNegated(value, candidate.index, candidate[0].length)
      && !forbiddenMatchIsHistoricalContrast(value, candidate.index, candidate[0].length)) return true;
    if (!candidate[0]) expression.lastIndex += 1;
    candidate = expression.exec(value);
  }
  return false;
}

function wordCount(value) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function paragraphCount(value) {
  return value.trim() ? value.trim().split(/\n\s*\n/u).filter(Boolean).length : 0;
}

function normalizedVisibleCandidate(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function normalizedTokens(value, { ignoreNumbers = false } = {}) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim().split(/\s+/u).filter((item) => (
    item.length > 2 && (!ignoreNumbers || !/^\$?\d/u.test(item))
  )));
}

function jaccardSimilarity(left, right, options) {
  const leftTokens = normalizedTokens(left, options);
  const rightTokens = normalizedTokens(right, options);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function evaluateState(turn, continuation) {
  const failures = [];
  const expectation = turn.state;
  if (!continuation) return ["continuation_invalid"];
  if (expectation.activeTopicAnyOf.length
    && !expectation.activeTopicAnyOf.includes(continuation.activeTopic)) failures.push("state_active_topic");
  if (expectation.goalAnyOf.length
    && !expectation.goalAnyOf.some((pattern) => match(continuation.goal, pattern))) failures.push("state_goal");
  const stateText = JSON.stringify(continuation.facts);
  for (const pattern of expectation.factsExclude) {
    if (match(stateText, pattern)) failures.push(`state_stale_fact:${pattern}`);
  }
  if (expectation.pendingQuestion === "empty" && continuation.pendingQuestion) failures.push("state_pending_question");
  if (expectation.pendingQuestion === "required_material" && !continuation.pendingQuestion) failures.push("state_pending_question_missing");
  return failures;
}

function officialLookupUnavailable(observation) {
  return observation.modelAttempted === true
    && /\b(?:could not|couldn['’]t)\s+(?:be\s+)?(?:confirm(?:ed)?|verif(?:y|ied))\b/i.test(
      `${observation.visibleAnswer}\n${observation.followUpQuestion}`,
    )
    && (
      (Boolean(observation.modelFailureCode?.trim())
        && observation.answerSource === "deterministic")
      || (observation.officialWebLookupRequested === true
        && observation.answerSource === "model")
    );
}

function officialCitationEvidenceSatisfied(observation) {
  const urls = Array.isArray(observation.officialCitationUrls)
    ? observation.officialCitationUrls
    : [];
  const hosts = Array.isArray(observation.officialCitationHosts)
    ? observation.officialCitationHosts
    : [];
  if (!Number.isSafeInteger(observation.citationCount)
    || observation.citationCount < 1
    || urls.length !== observation.citationCount
    || hosts.length !== urls.length
    || new Set(urls).size !== urls.length) return false;
  return urls.every((url, index) => {
    const officialUrl = sanitizeSurgeCustomerOfficialUrl(url);
    if (!officialUrl || officialUrl !== url) return false;
    return new URL(officialUrl).hostname.toLowerCase() === hosts[index];
  });
}

function officialLookupSatisfied(observation) {
  return (observation.officialWebLookupRequested === true
      && observation.answerSource === "model"
      && officialCitationEvidenceSatisfied(observation))
    || officialLookupUnavailable(observation);
}

function officialReferenceSatisfied(observation) {
  return observation.officialWebLookupRequested !== true
    && observation.answerSource === "model"
    && officialCitationEvidenceSatisfied(observation);
}

export function evaluateSurgeTrajectoryTurn(turn, observation, mode) {
  const failures = [];
  if (observation.httpStatus !== 200) failures.push("http_status");
  const answerSearchable = observation.visibleAnswer || "";
  const searchable = [observation.visibleAnswer, observation.followUpQuestion]
    .filter(Boolean)
    .join("\n");
  for (const clause of turn.clauses) {
    const clauseSearchable = clause.target === "first_practical_step"
      ? observation.practicalSteps?.[0] || ""
      : answerSearchable;
    if (!clause.anyOf.some((pattern) => matchesRequired(
      clauseSearchable,
      pattern,
      clause.requireAffirmed === true,
    ))) failures.push(`clause:${clause.id}`);
  }
  for (const pattern of turn.forbiddenPatterns) {
    if (matchesForbidden(searchable, pattern)) failures.push(`forbidden:${pattern}`);
  }
  for (const pattern of GENERIC_FAILURE_PATTERNS) {
    if (searchable.toLowerCase().includes(pattern.toLowerCase())) failures.push(`generic:${pattern}`);
  }
  if (wordCount(observation.visibleAnswer) > turn.maxWords) failures.push("word_limit");
  if (paragraphCount(observation.visibleAnswer) > turn.maxParagraphs) failures.push("paragraph_limit");
  if (surgeTextHasIncompleteTrailingFragment(observation.visibleAnswer)) failures.push("incomplete_visible_answer");
  const rejectedCandidate = normalizedVisibleCandidate(
    observation.rejectionDiagnostic?.visibleCandidate,
  );
  const rejectedIncompleteAnswerWasDelivered = !rejectedCandidate
    || rejectedCandidate === normalizedVisibleCandidate(observation.visibleAnswer);
  if (observation.rejectionDiagnostic?.completeQuestionCoverage === false
    && rejectedIncompleteAnswerWasDelivered) {
    failures.push("incomplete_question_coverage");
  }
  if ((observation.followUpQuestion ? 1 : 0) > turn.maxQuestions) failures.push("follow_up_limit");
  if (observation.quickReplyCount > 0) failures.push("quick_replies");
  if (mode === "paid") {
    if (turn.sourcePolicy === "model_required" && observation.answerSource !== "model") failures.push("model_required");
    if (turn.sourcePolicy === "deterministic"
      && observation.answerSource !== "deterministic") failures.push("deterministic_required");
    if (turn.sourcePolicy === "official_lookup" && !officialLookupSatisfied(observation)) failures.push("official_lookup_required");
    if (turn.sourcePolicy === "official_reference" && !officialReferenceSatisfied(observation)) failures.push("official_reference_required");
  }
  failures.push(...evaluateState(turn, observation.continuation));
  return failures;
}

function boundedContinuation(value) {
  return parseSurgeConversationState(value);
}

async function runTurn(turn, index, fixture, state, options) {
  let reservationEstimate = 0;
  let modelAttempted = false;
  let modelFailureCode = "";
  let modelFailureStage = "";
  let rejectionStage = "";
  let rejectionDiagnostic = null;
  let budgetDenied = false;
  let officialWebLookupRequested = false;
  const startedAt = performance.now();
  const response = await handleEnergyAssistantRequest(
    requestForTurn(turn, index, fixture, state.recentTurns, state.continuation),
    {
      now: options.now,
      requireValidatedModelForOrdinaryAdvice: options.mode === "paid",
      reserveModelCall: async ({ estimatedMicroUsd }) => {
        reservationEstimate = estimatedMicroUsd;
        if (options.mode === "scripted") {
          options.budget.observe(estimatedMicroUsd);
          return { allowed: false };
        }
        const allowed = options.budget.reserve(estimatedMicroUsd);
        if (!allowed) budgetDenied = true;
        if (allowed) {
          await options.persistCommittedBudget({
            turnId: turn.id,
            message: turn.message,
            reservationEstimate: estimatedMicroUsd,
          });
        }
        return allowed ? { allowed: true, release: async () => undefined } : { allowed: false };
      },
      generateAnswer: async (modelRequest) => {
        modelAttempted = true;
        officialWebLookupRequested = Boolean(modelRequest.officialWebSearch);
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
              rejectionDiagnostic = sanitizeTrajectoryRejectionDiagnostic(diagnostic);
              rejectionStage = rejectionDiagnostic?.stage || "";
            },
          },
        });
      },
    },
  );
  const rawBody = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }
  const reply = record(payload?.reply) || {};
  const continuation = boundedContinuation(payload?.continuation);
  const visibleAnswer = safeText(surgeVisibleAnswerFromReply(reply));
  const practicalSteps = Array.isArray(reply.practicalSteps)
    ? reply.practicalSteps
      .map((step) => safeText(step, 500).trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];
  const replyCitations = Array.isArray(reply.citations) ? reply.citations : [];
  const officialCitationUrls = replyCitations
    .map((citation) => sanitizeSurgeCustomerOfficialUrl(record(citation)?.url))
    .filter(Boolean);
  const officialCitationHosts = officialCitationUrls.map((url) => new URL(url).hostname.toLowerCase());
  const observation = {
    conversationId: conversationIdForTurn(turn, fixture),
    turnId: turn.id,
    message: turn.message,
    httpStatus: response.status,
    assistant: safeText(reply.content || visibleAnswer),
    visibleAnswer,
    directAnswer: safeText(reply.directAnswer),
    followUpQuestion: safeText(reply.followUpQuestion, 500),
    practicalSteps,
    practicalStepCount: practicalSteps.length,
    quickReplyCount: Array.isArray(reply.quickReplies) ? reply.quickReplies.length : 0,
    citationCount: replyCitations.length,
    officialCitationUrls,
    officialCitationHosts,
    answerSource: safeText(payload?.quality?.answerSource, 40),
    continuation,
    latencyMs: Math.round(performance.now() - startedAt),
    reservationEstimate,
    modelAttempted,
    officialWebLookupRequested,
    modelFailureCode,
    modelFailureStage,
    rejectionStage,
    rejectionDiagnostic,
    budgetDenied,
    errorCode: safeText(payload?.error?.code, 100),
    failures: [],
  };
  if (secretShaped(rawBody)) {
    observation.visibleAnswer = "[REDACTED]";
    observation.assistant = "[REDACTED]";
    observation.directAnswer = "[REDACTED]";
    observation.failures.push("secret_shaped_output");
  }
  observation.failures.push(...evaluateSurgeTrajectoryTurn(turn, observation, options.mode));
  return observation;
}

function transcriptHash(observations) {
  return hash(observations.map((item) => (
    `${item.conversationId || "trajectory-v1"}\0${item.turnId}\0${item.message}\0${item.assistant}`
  )).join("\0"));
}

function checkpointedReservationFloor(source) {
  if (source.mode !== "paid") return 0;
  return [...source.observations, source.failedTurn, source.inFlightTurn]
    .filter(Boolean)
    .reduce((total, item) => (
      item.budgetDenied !== true
      && Number.isSafeInteger(item.reservationEstimate)
      && item.reservationEstimate > 0
        ? total + item.reservationEstimate
        : total
    ), 0);
}

export function createSurgeTrajectoryCheckpointState(runIdentity, args, sourceHash, model) {
  return {
    version: CHECKPOINT_VERSION,
    runIdentity,
    runLabelHash: hash(args.runLabel),
    mode: args.scripted ? "scripted" : "paid",
    budgetMicroUsd: args.scripted ? 0 : args.budgetMicroUsd,
    sourceHash,
    modelHash: hash(model),
    observations: [],
    committedReservationMicroUsd: 0,
    recentTurns: [],
    continuation: null,
    transcriptHash: hash(""),
    failedTurn: null,
    inFlightTurn: null,
  };
}

function validInFlightTurn(value) {
  const source = record(value);
  return Boolean(source)
    && exactKeys(source, ["conversationId", "turnId", "message", "reservationEstimate"])
    && boundedText(source.conversationId, 80)
    && boundedText(source.turnId, 80)
    && boundedText(source.message, MAX_MESSAGE_LENGTH)
    && Number.isSafeInteger(source.reservationEstimate)
    && source.reservationEstimate > 0;
}

function validCheckpoint(value, expected) {
  const source = record(value);
  return Boolean(source)
    && source.version === CHECKPOINT_VERSION
    && source.runIdentity === expected.runIdentity
    && source.runLabelHash === expected.runLabelHash
    && source.mode === expected.mode
    && source.budgetMicroUsd === expected.budgetMicroUsd
    && source.sourceHash === expected.sourceHash
    && source.modelHash === expected.modelHash
    && Array.isArray(source.observations)
    && source.observations.length <= MAX_TRAJECTORY_TURNS
    && Number.isSafeInteger(source.committedReservationMicroUsd)
    && source.committedReservationMicroUsd >= 0
    && source.committedReservationMicroUsd >= checkpointedReservationFloor(source)
    && Array.isArray(source.recentTurns)
    && (source.continuation === null || boundedContinuation(source.continuation))
    && source.transcriptHash === transcriptHash(source.observations)
    && (source.failedTurn === null || record(source.failedTurn))
    && (source.inFlightTurn === null || validInFlightTurn(source.inFlightTurn));
}

export async function loadSurgeTrajectoryCheckpoint(pathValue, expected, retryFailedTurn) {
  try {
    const parsed = JSON.parse(await readFile(pathValue, "utf8"));
    if (!validCheckpoint(parsed, expected)) {
      throw new Error("The existing trajectory checkpoint belongs to different code, fixture, model or run label.");
    }
    const pendingTurn = parsed.failedTurn || parsed.inFlightTurn;
    const latestCompletedConversationId = parsed.observations.at(-1)?.conversationId;
    const pendingStartsNewConversation = Boolean(
      pendingTurn?.conversationId
      && latestCompletedConversationId
      && pendingTurn.conversationId !== latestCompletedConversationId,
    );
    const rebuiltRecentTurns = pendingStartsNewConversation
      ? []
      : recentTurnsForTrajectory(observationsInLatestConversation(
        parsed.observations,
      ).flatMap((item) => [
        { role: "user", content: item.message },
        { role: "assistant", content: item.assistant },
      ]));
    if (JSON.stringify(rebuiltRecentTurns) !== JSON.stringify(parsed.recentTurns)) {
      throw new Error("The existing trajectory checkpoint transcript is inconsistent.");
    }
    if ((parsed.failedTurn || parsed.inFlightTurn) && !retryFailedTurn) {
      throw new Error("The prior run stopped on a failed or in-flight turn; pass --retry-failed-turn to retry that exact turn.");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return expected;
    throw error;
  }
}

function checkpointWriter(pathValue, checkpoint) {
  let pending = Promise.resolve();
  return () => {
    pending = pending.then(async () => {
      await mkdir(dirname(pathValue), { recursive: true });
      const temporary = `${pathValue}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, pathValue);
    });
    return pending;
  };
}

function failureCounts(observations) {
  const counts = {};
  for (const failure of observations.flatMap((item) => item.failures)) {
    const key = failure.split(":", 1)[0];
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function conversationFailures(observations) {
  const failures = [];
  for (let index = 1; index < observations.length; index += 1) {
    const current = observations[index];
    const currentQuestion = current.followUpQuestion.trim().toLowerCase();
    if (currentQuestion && observations.slice(0, index).some((item) => (
      item.conversationId === current.conversationId
      && item.followUpQuestion.trim().toLowerCase() === currentQuestion
    ))) failures.push({ turnId: current.turnId, code: "repeated_follow_up" });
  }
  return failures;
}

function conversationAssertionFailure(assertion, code, turnId = "") {
  return {
    assertionId: assertion.id,
    type: assertion.type,
    code,
    ...(turnId ? { turnId } : {}),
  };
}

function observationText(observation) {
  return `${observation.visibleAnswer || ""}\n${observation.followUpQuestion || ""}`;
}

function currentContinuationText(continuation) {
  const ledger = record(continuation?.ledger);
  const activeDecision = Array.isArray(ledger?.decisions)
    ? ledger.decisions.find((decision) => decision.id === ledger.activeDecisionId)
    : null;
  const currentFacts = (facts) => Array.isArray(facts)
    ? facts.filter((fact) => fact?.key !== "user_context")
    : [];
  return JSON.stringify({
    activeTopic: continuation?.activeTopic || "",
    facts: currentFacts(continuation?.facts),
    pendingQuestion: continuation?.pendingQuestion || "",
    activeDecision: activeDecision ? {
      topic: activeDecision.topic,
      facts: currentFacts(activeDecision.facts),
      pendingQuestion: activeDecision.pendingQuestion,
      subjectIds: activeDecision.subjectIds,
    } : null,
  });
}

function observationRange(fixture, observationsByTurn, fromTurn, throughTurn) {
  const fromIndex = fixture.turns.findIndex((turn) => turn.id === fromTurn);
  const throughIndex = fixture.turns.findIndex((turn) => turn.id === throughTurn);
  if (fromIndex < 0 || throughIndex < fromIndex) return [];
  return fixture.turns
    .slice(fromIndex, throughIndex + 1)
    .map((turn) => observationsByTurn.get(turn.id))
    .filter(Boolean);
}

function subjectPostcode(continuation, subjectId) {
  const subjects = continuation?.ledger?.subjects;
  if (!Array.isArray(subjects)) return "";
  const subject = subjects.find((item) => item.id === subjectId);
  const postcode = subject?.facts?.find((fact) => fact.key === "postcode");
  return typeof postcode?.value === "string" ? postcode.value : "";
}

function activeDecisionSubjectIds(continuation) {
  const ledger = continuation?.ledger;
  if (!ledger || !Array.isArray(ledger.decisions)) return [];
  const decision = ledger.decisions.find((item) => item.id === ledger.activeDecisionId);
  return Array.isArray(decision?.subjectIds) ? decision.subjectIds : [];
}

function numericValues(value) {
  const text = String(value || "");
  const quantities = [];
  const quantityKind = (currency, unit = "") => {
    if (currency) return "currency";
    const normalizedUnit = unit.toLowerCase().replaceAll(/\s+/gu, "");
    if (/^kwh$/u.test(normalizedUnit)) return "energy_kwh";
    if (/^kw$/u.test(normalizedUnit)) return "power_kw";
    if (/^years?$/u.test(normalizedUnit)) return "duration_year";
    if (/^months?$/u.test(normalizedUnit)) return "duration_month";
    if (/^weeks?$/u.test(normalizedUnit)) return "duration_week";
    if (/^days?$/u.test(normalizedUnit)) return "duration_day";
    if (/^hours?$/u.test(normalizedUnit)) return "duration_hour";
    if (/^minutes?$/u.test(normalizedUnit)) return "duration_minute";
    if (/^seconds?$/u.test(normalizedUnit)) return "duration_second";
    if (/^times?$/u.test(normalizedUnit)) return "count_times";
    if (/^(?:%|percent)$/u.test(normalizedUnit)) return "percentage";
    if (/^(?:degrees?(?:c|celsius)?|°c)$/u.test(normalizedUnit)) return "temperature_c";
    if (/^amps?$/u.test(normalizedUnit)) return "current_amp";
    if (/^volts?$/u.test(normalizedUnit)) return "voltage_volt";
    if (/^(?:litres?|liters?)$/u.test(normalizedUnit)) return "volume_litre";
    return "bare";
  };
  const digitPattern = /(?:^|[^A-Za-z0-9])(\$\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s+|[-‑–—])?(kWh|kW|years?|months?|weeks?|days?|hours?|minutes?|seconds?|times?|%|percent|degrees?(?:\s*C(?:elsius)?)?|°\s*C|amps?|volts?|litres?|liters?)?/giu;
  for (const item of text.matchAll(digitPattern)) {
    const numericValue = Number(item[2].replaceAll(",", ""));
    if (Number.isFinite(numericValue)) {
      quantities.push({
        value: numericValue,
        kind: quantityKind(Boolean(item[1]), item[3]),
      });
    }
  }
  const numberWords = new Map([
    ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6],
    ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11], ["twelve", 12],
  ]);
  for (const item of text.toLowerCase().matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+|[-‑–—])(years?|months?|weeks?|days?|hours?|minutes?|seconds?|times?)\b/gu)) {
    quantities.push({
      value: numberWords.get(item[1]),
      kind: quantityKind(false, item[2]),
    });
  }
  return quantities;
}

function approximatelyIncludes(values, candidate) {
  return values.some((quantity) => quantity.kind === candidate.kind
    && Math.abs(quantity.value - candidate.value) <= Math.max(0.01, Math.abs(candidate.value) * 0.0001));
}

function derivedFromKnownQuantities(known, candidate) {
  const approximatelyDerived = (value) => (
    Math.abs(value - candidate.value) <= Math.max(0.01, Math.abs(candidate.value) * 0.0001)
  );
  const sameKind = known.filter((quantity) => quantity.kind === candidate.kind);
  for (let leftIndex = 0; leftIndex < sameKind.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < sameKind.length; rightIndex += 1) {
      const left = sameKind[leftIndex].value;
      const right = sameKind[rightIndex].value;
      if (approximatelyDerived(left + right) || approximatelyDerived(Math.abs(left - right))) return true;
    }
  }
  if (candidate.kind === "duration_month") {
    if (known.some((quantity) => quantity.kind === "duration_year"
      && approximatelyDerived(quantity.value * 12))) return true;
  }
  if (candidate.kind !== "currency") return false;
  const currencies = known.filter((quantity) => quantity.kind === "currency");
  const years = known.filter((quantity) => quantity.kind === "duration_year");
  for (const recurring of currencies) {
    for (const duration of years) {
      const repaymentTotal = recurring.value * 12 * duration.value;
      if (approximatelyDerived(repaymentTotal)) return true;
      if (currencies.some((quoted) => approximatelyDerived(Math.abs(quoted.value - repaymentTotal)))) return true;
    }
  }
  return false;
}

function quantityGroundingFailures(assertion, fixture, observations) {
  const failures = [];
  const turnsById = new Map(fixture.turns.map((turn) => [turn.id, turn]));
  let currentConversationId = "";
  let known = numericValues(JSON.stringify(fixture.planContext));
  let recentUserMessages = [];
  for (const observation of observations) {
    if (observation.conversationId && observation.conversationId !== currentConversationId) {
      currentConversationId = observation.conversationId;
      known = numericValues(JSON.stringify(fixture.planContext));
      recentUserMessages = [];
    }
    recentUserMessages.push(observation.message);
    recentUserMessages = recentUserMessages.slice(-3);
    known.push(...numericValues(observation.message));
    const turn = turnsById.get(observation.turnId);
    const latestExplicitUserTopic = [...recentUserMessages]
      .reverse()
      .map((message) => surgeConversationTopicFor(message))
      .find(Boolean) || "";
    const groundedByCurrentOfficialLookup = turn?.sourcePolicy === "official_lookup"
      && observation.officialWebLookupRequested === true
      && officialCitationEvidenceSatisfied(observation);
    const answerQuantities = numericValues(observationText(observation));
    let answerQuantitiesGrounded = true;
    for (const candidate of answerQuantities) {
      if (approximatelyIncludes(known, candidate)) continue;
      if (
        candidate.kind === "temperature_c"
        && latestExplicitUserTopic === "rcac"
        && surgeTextsSupplyImplicitCelsiusSetpoint(
          recentUserMessages,
          "rcac heating or cooling",
          candidate.value,
        )
      ) continue;
      if (assertion.allowDerivedArithmetic === true && derivedFromKnownQuantities(known, candidate)) continue;
      if (groundedByCurrentOfficialLookup) continue;
      failures.push(conversationAssertionFailure(assertion, "quantity_not_grounded", observation.turnId));
      answerQuantitiesGrounded = false;
      break;
    }
    if (answerQuantitiesGrounded) known.push(...answerQuantities);
  }
  return failures;
}

export function evaluateSurgeConversationAssertions(fixture, observations, { mode = "paid" } = {}) {
  const failures = [];
  const observationsByTurn = new Map(observations.map((item) => [item.turnId, item]));
  const turnsById = new Map(fixture.turns.map((item) => [item.id, item]));

  for (const assertion of fixture.conversationAssertions) {
    const fail = (code, turnId = "") => failures.push(
      conversationAssertionFailure(assertion, code, turnId),
    );
    if (assertion.type === "turn_count") {
      if (observations.length !== assertion.expected) fail("turn_count");
      continue;
    }
    if (assertion.type === "all_http_status") {
      for (const observation of observations) {
        if (observation.httpStatus !== assertion.expected) fail("http_status", observation.turnId);
      }
      continue;
    }
    if (assertion.type === "valid_continuation_every_turn") {
      for (const observation of observations) {
        const continuation = observation.continuation;
        if (!continuation
          || continuation.version !== assertion.version
          || !Array.isArray(continuation.facts)
          || continuation.facts.length > assertion.maximumFacts) {
          fail("continuation_invalid", observation.turnId);
        }
      }
      continue;
    }
    if (assertion.type === "request_history_bounds") {
      for (let index = 0; index < observations.length; index += 1) {
        const currentConversationId = observations[index].conversationId;
        const priorObservations = observations.slice(0, index).filter((item) => (
          !currentConversationId || item.conversationId === currentConversationId
        ));
        const history = recentTurnsForTrajectory(priorObservations.flatMap((item) => [
          { role: "user", content: item.message },
          { role: "assistant", content: item.assistant },
        ]));
        const characters = history.reduce((total, turn) => total + turn.content.length, 0);
        const alternating = !assertion.requireAlternatingRoles || history.every((turn, turnIndex) => (
          turn.role === (turnIndex % 2 === 0 ? "user" : "assistant")
        ));
        if (history.length > assertion.maximumTurns
          || characters > assertion.maximumCharacters
          || !alternating) fail("request_history_bounds", observations[index].turnId);
      }
      continue;
    }
    if (assertion.type === "source_policy_enforced") {
      if (mode === "scripted") continue;
      for (const turn of fixture.turns.filter((item) => item.sourcePolicy === assertion.policy)) {
        const observation = observationsByTurn.get(turn.id);
        if (!observation) continue;
        if (assertion.policy === "official_lookup"
          && assertion.requireOfficialCitationsOrExplicitUnavailability === true) {
          if (!officialLookupSatisfied(observation)) fail("official_evidence_missing", turn.id);
        } else if (assertion.policy === "official_reference"
          && assertion.requireOfficialCitations === true) {
          if (!officialReferenceSatisfied(observation)) fail("official_reference_missing", turn.id);
        } else if (!assertion.allowedAnswerSources.includes(observation.answerSource)) {
          fail("answer_source", turn.id);
        }
      }
      continue;
    }
    if (assertion.type === "official_citation_requirements") {
      if (mode === "scripted") continue;
      for (const checkpoint of assertion.checkpoints) {
        const observation = observationsByTurn.get(checkpoint.turn);
        if (!observation) continue;
        const urls = Array.isArray(observation.officialCitationUrls)
          ? observation.officialCitationUrls
          : [];
        if (!Number.isSafeInteger(observation.citationCount)
          || observation.citationCount < checkpoint.minimumCount
          || checkpoint.requiredUrls.some((url) => !urls.includes(url))) {
          fail("official_citation_relevance", checkpoint.turn);
        }
      }
      continue;
    }
    if (assertion.type === "forbid_patterns_all_responses") {
      for (const observation of observations) {
        if (assertion.patterns.some((pattern) => matchesForbidden(observationText(observation), pattern))) {
          fail("forbidden_pattern", observation.turnId);
        }
      }
      continue;
    }
    if (assertion.type === "maximum_adjacent_normalized_similarity") {
      for (let index = 1; index < observations.length; index += 1) {
        const previous = observations[index - 1];
        const current = observations[index];
        if (previous.conversationId !== current.conversationId) continue;
        if (current.visibleAnswer.trim() === previous.visibleAnswer.trim()) {
          fail("verbatim_repeat", current.turnId);
        } else if (jaccardSimilarity(
          previous.visibleAnswer,
          current.visibleAnswer,
          { ignoreNumbers: assertion.ignoreNumbers === true },
        ) >= assertion.maximum) fail("adjacent_similarity", current.turnId);
      }
      continue;
    }
    if (assertion.type === "quick_reply_count_all_turns") {
      for (const observation of observations) {
        if (observation.quickReplyCount > assertion.maximum) fail("quick_replies", observation.turnId);
      }
      continue;
    }
    if (assertion.type === "question_count_matches_turn_limit") {
      for (const observation of observations) {
        const turn = turnsById.get(observation.turnId);
        if (turn && (observation.followUpQuestion ? 1 : 0) > turn.maxQuestions) {
          fail("follow_up_limit", observation.turnId);
        }
      }
      continue;
    }
    if (assertion.type === "forbid_reasking_known_facts") {
      for (const observation of observations) {
        if (assertion.patterns.some((pattern) => matchesForbidden(observationText(observation), pattern))) {
          fail("known_fact_reasked", observation.turnId);
        }
      }
      continue;
    }
    if (assertion.type === "cross_turn_correction") {
      for (const checkpoint of assertion.checkpoints) {
        const correctionIndex = fixture.turns.findIndex((turn) => turn.id === checkpoint.correctionTurn);
        const throughIndex = fixture.turns.findIndex((turn) => turn.id === checkpoint.throughTurn);
        if (correctionIndex < 0 || throughIndex <= correctionIndex) continue;
        for (const turn of fixture.turns.slice(correctionIndex + 1, throughIndex + 1)) {
          const observation = observationsByTurn.get(turn.id);
          if (!observation) continue;
          const answerSearchable = observationText(observation);
          const continuationSearchable = currentContinuationText(observation.continuation);
          if (checkpoint.forbidAsCurrent.some((pattern) => (
            matchesForbidden(answerSearchable, pattern)
            || matchesForbidden(continuationSearchable, pattern)
          ))) {
            fail("stale_correction", turn.id);
          }
        }
      }
      continue;
    }
    if (assertion.type === "cross_turn_topic_isolation") {
      for (const checkpoint of assertion.checkpoints) {
        const observation = observationsByTurn.get(checkpoint.turn);
        if (observation && checkpoint.forbid.some((pattern) => matchesForbidden(observationText(observation), pattern))) {
          fail("topic_leak", checkpoint.turn);
        }
      }
      continue;
    }
    if (assertion.type === "return_after_interruption") {
      const interruption = observationsByTurn.get(assertion.interruptionTurn);
      const returned = observationsByTurn.get(assertion.returnTurn);
      if (interruption && assertion.preserveStateAcrossInterruption === true) {
        const interruptionIndex = observations.findIndex((item) => item.turnId === assertion.interruptionTurn);
        const before = interruptionIndex > 0 ? observations[interruptionIndex - 1] : null;
        if (!before || JSON.stringify(before.continuation) !== JSON.stringify(interruption.continuation)) {
          fail("interruption_changed_state", assertion.interruptionTurn);
        }
      }
      if (returned) {
        const searchable = observationText(returned);
        if (assertion.requiredAtReturn.some((pattern) => !match(searchable, pattern))) {
          fail("return_context_missing", assertion.returnTurn);
        }
        if (assertion.forbiddenAtReturn.some((pattern) => matchesForbidden(searchable, pattern))) {
          fail("interruption_leaked", assertion.returnTurn);
        }
      }
      continue;
    }
    if (assertion.type === "forbid_patterns_turn_range") {
      for (const observation of observationRange(
        fixture,
        observationsByTurn,
        assertion.fromTurn,
        assertion.throughTurn,
      )) {
        if (assertion.patterns.some((pattern) => matchesForbidden(observationText(observation), pattern))) {
          fail("forbidden_pattern", observation.turnId);
        }
      }
      continue;
    }
    if (assertion.type === "property_boundary") {
      const service = observationsByTurn.get(assertion.servicePropertyTurn);
      if (service && (
        subjectPostcode(service.continuation, "mums_home") !== assertion.servicePostcode
        || subjectPostcode(service.continuation, "saved_home") !== assertion.savedHomePostcode
      )) fail("property_boundary", assertion.servicePropertyTurn);
      const returned = observationsByTurn.get(assertion.savedHomeReturnTurn);
      if (returned) {
        const subjectIds = activeDecisionSubjectIds(returned.continuation);
        if (!subjectIds.includes("saved_home") || subjectIds.includes("mums_home")) {
          fail("saved_home_return", assertion.savedHomeReturnTurn);
        }
      }
      continue;
    }
    if (assertion.type === "structured_action_count") {
      const observation = observationsByTurn.get(assertion.turn);
      if (observation && observation.practicalStepCount !== assertion.exactActionCount) {
        fail("structured_action_count", assertion.turn);
      }
      continue;
    }
    if (assertion.type === "long_range_recall") {
      const observation = observationsByTurn.get(assertion.turn);
      if (!observation) continue;
      const searchable = observationText(observation);
      assertion.requiredSemanticGroups.forEach((group, index) => {
        if (!group.some((pattern) => match(searchable, pattern))) {
          fail(`memory_group_${index + 1}`, assertion.turn);
        }
      });
      if (assertion.forbidden.some((pattern) => matchesForbidden(searchable, pattern))) {
        fail("long_range_subject_leak", assertion.turn);
      }
      if (observation.practicalStepCount !== assertion.exactActionCount) {
        fail("structured_action_count", assertion.turn);
      }
      if ((observation.followUpQuestion ? 1 : 0) > assertion.maximumQuestions) {
        fail("long_range_question_limit", assertion.turn);
      }
      continue;
    }
    if (assertion.type === "quantity_grounding_all_turns") {
      failures.push(...quantityGroundingFailures(assertion, fixture, observations));
      continue;
    }
    if (assertion.type === "all_turn_clauses_pass") {
      for (const observation of observations) {
        if (observation.failures.some((failure) => failure.startsWith("clause:"))) {
          fail("semantic_clause", observation.turnId);
        }
      }
    }
  }
  return failures;
}

function trajectoryConversationResults(fixture, observations, crossTurnFailures, assertionFailures) {
  const conversationIds = fixture.version === 2
    ? [...new Set(fixture.turns.map((turn) => turn.conversationId))]
    : ["trajectory-v1"];
  const failedTurnIds = new Set([
    ...observations.filter((item) => item.failures.length > 0).map((item) => item.turnId),
    ...crossTurnFailures.map((item) => item.turnId).filter(Boolean),
    ...assertionFailures.map((item) => item.turnId).filter(Boolean),
  ]);
  return conversationIds.map((conversationId) => {
    const expectedTurnIds = fixture.turns
      .filter((turn) => conversationIdForTurn(turn, fixture) === conversationId)
      .map((turn) => turn.id);
    const completed = observations.filter((item) => item.conversationId === conversationId);
    const failedTurns = expectedTurnIds.filter((turnId) => failedTurnIds.has(turnId));
    return {
      id: conversationId,
      completedTurns: completed.length,
      expectedTurns: expectedTurnIds.length,
      failedTurns,
      passed: completed.length === expectedTurnIds.length && failedTurns.length === 0,
    };
  });
}

async function main() {
  let args;
  try {
    args = parseSurgeConversationTrajectoryArgs(process.argv.slice(2));
  } catch (error) {
    usage(error instanceof Error ? error.message : "Arguments were not accepted.");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    usage();
    return;
  }
  const loaded = await loadSurgeConversationTrajectoryFixture(args.fixture);
  const mode = args.scripted ? "scripted" : "paid";
  const configuration = args.scripted
    ? { apiKey: "", model: DEFAULT_MODEL }
    : await loadLocalApiConfiguration();
  const sourceHash = await sourceFingerprint(loaded.path);
  const runIdentity = hash(JSON.stringify({
    runLabel: args.runLabel,
    mode,
    budgetMicroUsd: args.scripted ? 0 : args.budgetMicroUsd,
    sourceHash,
    model: configuration.model,
  }));
  const checkpointPath = args.checkpoint
    ? resolve(args.checkpoint)
    : join(tmpdir(), "surge-conversation-trajectory", `${runIdentity}.json`);
  const empty = createSurgeTrajectoryCheckpointState(runIdentity, args, sourceHash, configuration.model);
  const checkpoint = await loadSurgeTrajectoryCheckpoint(checkpointPath, empty, args.retryFailedTurn);
  const saveCheckpoint = checkpointWriter(checkpointPath, checkpoint);
  const budget = createSurgeTrajectoryBudget(
    args.scripted ? Number.MAX_SAFE_INTEGER : args.budgetMicroUsd,
    checkpoint.committedReservationMicroUsd,
  );
  const runNow = new Date();

  for (let index = checkpoint.observations.length; index < loaded.fixture.turns.length; index += 1) {
    const turn = loaded.fixture.turns[index];
    resetSurgeTrajectoryStateAtConversationBoundary(loaded.fixture, turn, checkpoint);
    const observation = await runTurn(turn, index, loaded.fixture, checkpoint, {
      mode,
      apiKey: configuration.apiKey,
      model: configuration.model,
      budget,
      persistCommittedBudget: async (inFlightTurn) => {
        checkpoint.committedReservationMicroUsd = budget.summary().committedMicroUsd;
        checkpoint.inFlightTurn = {
          conversationId: conversationIdForTurn(turn, loaded.fixture),
          ...inFlightTurn,
        };
        await saveCheckpoint();
      },
      now: () => runNow,
    });
    checkpoint.inFlightTurn = null;
    if (observation.httpStatus !== 200 || !observation.continuation || observation.budgetDenied) {
      checkpoint.failedTurn = observation;
      await saveCheckpoint();
      process.stderr.write(`Trajectory stopped safely at ${turn.id}; inspect the checkpointed failure before retrying.\n`);
      process.exitCode = 1;
      break;
    }
    checkpoint.observations.push(observation);
    checkpoint.recentTurns = recentTurnsForTrajectory(observationsInLatestConversation(
      checkpoint.observations,
    ).flatMap((item) => [
      { role: "user", content: item.message },
      { role: "assistant", content: item.assistant },
    ]));
    checkpoint.continuation = observation.continuation;
    checkpoint.transcriptHash = transcriptHash(checkpoint.observations);
    checkpoint.failedTurn = null;
    await saveCheckpoint();
  }

  const crossTurnFailures = conversationFailures(checkpoint.observations);
  const conversationAssertionFailures = evaluateSurgeConversationAssertions(
    loaded.fixture,
    checkpoint.observations,
    { mode },
  );
  const failedConversationAssertionIds = new Set(
    conversationAssertionFailures.map((failure) => failure.assertionId),
  );
  const allTurnFailures = checkpoint.observations.flatMap((item) => item.failures);
  const conversationResults = trajectoryConversationResults(
    loaded.fixture,
    checkpoint.observations,
    crossTurnFailures,
    conversationAssertionFailures,
  );
  const summary = {
    mode,
    runFingerprint: runIdentity.slice(0, 12),
    completedTurns: checkpoint.observations.length,
    expectedTurns: loaded.fixture.turns.length,
    completedConversations: conversationResults.filter((item) => (
      item.completedTurns === item.expectedTurns
    )).length,
    expectedConversations: conversationResults.length,
    conversations: conversationResults,
    checkpointPath,
    conversationAssertions: {
      configured: loaded.fixture.conversationAssertions.length,
      passed: loaded.fixture.conversationAssertions.length - failedConversationAssertionIds.size,
      failed: failedConversationAssertionIds.size,
      failures: conversationAssertionFailures,
    },
    quality: mode === "scripted" ? null : {
      passedTurns: checkpoint.observations.filter((item) => item.failures.length === 0).length,
      failedTurns: checkpoint.observations.filter((item) => item.failures.length > 0).length,
      passedConversations: conversationResults.filter((item) => item.passed).length,
      failedConversations: conversationResults.filter((item) => !item.passed).length,
      failureCount: allTurnFailures.length
        + crossTurnFailures.length
        + conversationAssertionFailures.length,
      failuresByCode: failureCounts(checkpoint.observations),
      crossTurnFailures,
    },
    model: {
      attemptedTurns: checkpoint.observations.filter((item) => item.modelAttempted).length,
      acceptedTurns: checkpoint.observations.filter((item) => item.answerSource === "model").length,
      answerSources: checkpoint.observations.reduce((counts, item) => {
        const key = item.answerSource || "none";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
    },
    reservationBudgetMicroUsd: budget.summary(),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (mode === "paid" && (
    checkpoint.observations.length !== loaded.fixture.turns.length
    || allTurnFailures.length > 0
    || crossTurnFailures.length > 0
    || conversationAssertionFailures.length > 0
  )) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.stderr.write("The local Surge trajectory run failed without exposing response or credential data.\n");
    process.exitCode = 1;
  }
}
