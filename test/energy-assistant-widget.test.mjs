import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const widget = read("../src/components/EnergyAssistantWidget.tsx");
const styles = read("../src/components/EnergyAssistantWidget.module.css");
const layout = read("../src/app/layout.tsx");
const leadClient = read("../src/lib/energy-assistant-lead-client.mjs");
const planner = read("../src/components/HomeEnergyPlanner.tsx");
const privacy = read("../src/app/privacy/page.tsx");
const gettingStarted = read("../src/components/GettingStarted.tsx");
const surgeRoute = read("../src/app/surge/page.tsx");
const surgeRouteStyles = read("../src/app/surge/surge-page.module.css");
const surgeOpenButton = read("../src/components/SurgeOpenButton.tsx");
const surgeEvents = read("../src/lib/energy-assistant-events.ts");
const mascotImage = readFileSync(new URL("../public/surge-mascot.png", import.meta.url));

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test("the energy guide is mounted once at the root and excluded from print or PDF output", () => {
  assert.match(layout, /import \{ EnergyAssistantWidget \}/);
  assert.equal((layout.match(/<EnergyAssistantWidget\s*\/>/g) || []).length, 1);
  assert.match(widget, /pathname === "\/plan\/print"/);
  assert.match(widget, /pathname\.includes\("\/pdf\/"\)/);
  assert.match(styles, /@media print[\s\S]*\.root[\s\S]*display:\s*none/);
});

test("the dedicated Surge AI route keeps chat present without a launcher, close control or modal behaviour", () => {
  assert.match(surgeRoute, /SiteHeader active="surge"/);
  assert.match(surgeRoute, /className=\{styles\.chrome\}/);
  assert.match(surgeRouteStyles, /max-width: var\(--layout-max\)/);
  assert.match(widget, /const dedicated = pathname === "\/surge"/);
  assert.match(widget, /const effectiveOpen = dedicated \|\| \(open && openPathname === pathname && !hidden\)/);
  assert.match(widget, /dedicated \? ` \$\{styles\.rootDedicated\}`/);
  assert.match(widget, /\{!dedicated && <div className=\{styles\.launcherWrap\}>/);
  assert.match(widget, /role=\{dedicated \? "region" : "dialog"\}/);
  assert.match(widget, /aria-modal=\{dedicated \? undefined : "true"\}/);
  assert.match(widget, /\{!dedicated && <button type="button" aria-label="Close Surge AI"/);
  assert.match(styles, /\.rootDedicated \{[\s\S]*?position: relative;[\s\S]*?width: 100%;/);
  assert.match(styles, /\.rootDedicated \.panel \{[\s\S]*?width: min\(1040px, 70vw\);/);
  assert.match(styles, /\.rootDedicated \.starters \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.root\.rootDedicated \{[\s\S]*?position: relative;/);
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.rootDedicated \.starters \{[^}]*grid-template-columns: 1fr;/);
  assert.match(widget, /if \(!effectiveOpen \|\| dedicated\) return;/);
});

test("Surge AI starts with a home profile, then a clean grouped roadmap and conversational answers", () => {
  for (const label of [
    "Improve my home",
    "Costs and support",
    "Compare my options",
    "What should I upgrade first?",
    "Why is one room too hot or too cold?",
    "How much could solar, a battery or an EV save me?",
    "Which rebates could apply to my home?",
    "Help me compare an energy quote",
    "Which heating, hot water or cooking option suits my home?",
  ]) {
    assert.match(widget, new RegExp(label.replace(/[?]/g, "\\?")));
  }
  assert.match(widget, /Ask Surge AI/);
  assert.match(widget, /All things energy upgrades/);
  assert.match(widget, /Hi, I am Surge AI/);
  assert.match(widget, /I will explain it clearly and ask one useful question at a time/);
  assert.match(widget, /START_ROADMAP\.map\(\(group\) =>/);
  assert.match(widget, /messages\.length === 0 && !needsStarterProfile[\s\S]*styles\.welcome/);
  assert.match(widget, /messages\.length === 0 && !needsStarterProfile[\s\S]*styles\.starters/);
  assert.doesNotMatch(widget, /Quick tools|context\.tools\.map|styles\.pageTools/);
  assert.doesNotMatch(styles, /\.pageTools|\.contextCard/);
  assert.doesNotMatch(widget, /\bAEA\b/);
  assert.doesNotMatch(widget, />AI chat</i);
  assert.match(widget, />Surge AI</);
  assert.match(widget, /Tell Surge AI about the home/);
  assert.match(widget, /needsStarterProfile/);
  assert.match(widget, /Property postcode/);
  assert.match(widget, /Your relationship to the home/);
  assert.match(widget, /People usually living here/);
  assert.match(widget, /What matters most right now\?/);
  assert.match(widget, /Start with my home/);
  assert.match(widget, /className=\{styles\.assistantAvatar\}/);
  assert.match(widget, /src="\/surge-mascot\.png"/);
  assert.doesNotMatch(widget, />What to do next</);
  assert.doesNotMatch(widget, /practicalSteps\.slice\(0, 3\)/);
  assert.doesNotMatch(widget, />Best next action</);
  assert.doesNotMatch(widget, />Assumptions and limits</);
  assert.doesNotMatch(widget, />Sources and dates</);
  assert.doesNotMatch(widget, /function quickQuestionsFor/);
  assert.doesNotMatch(widget, />Ask next</);
  assert.doesNotMatch(widget, /quickQuestionsFor\(message\)/);
  assert.match(widget, /function naturalFollowUpFor/);
  assert.match(widget, /styles\.clarifyingQuestion/);
  assert.doesNotMatch(widget, /styles\.answerTools/);
  assert.match(widget, /answerStatus === "source_review_required"/);
});

test("the widget uses the canonical stateless assistant contract and never sends page records", () => {
  assert.match(widget, /action:\s*"ask"[\s\S]*requestId,[\s\S]*message,[\s\S]*recentTurns,[\s\S]*planContext,[\s\S]*pageContext:\s*context\.apiPath[\s\S]*audience:\s*context\.audience/);
  assert.match(widget, /const recentTurns = recentTurnsForRequest\(messagesRef\.current, profile\)/);
  assert.doesNotMatch(widget, /action:\s*"history"|action:\s*"delete"/);
  assert.doesNotMatch(widget, /sessionId|accessKey|type Credentials/);
  assert.match(widget, /type Audience = "public" \| "customer" \| "trade"/);
  assert.match(widget, /I do not read private account, project or quote records/);
  assert.match(widget, /I do not read customer, job or certificate records/);
  assert.doesNotMatch(widget, /document\.querySelector|innerHTML|textContent/);
});

test("Surge receives only bounded completed planner answers and excludes them from trade mode", () => {
  assert.match(widget, /buildSurgePlanContextFromStoredAssessment/);
  assert.match(widget, /await import\(\s*"@\/lib\/energy-assistant-plan-context"\s*\)/);
  assert.match(widget, /window\.sessionStorage\.getItem\(HOME_ENERGY_ASSESSMENT_STORAGE_KEY\)/);
  assert.match(widget, /const planContext = context\.audience === "trade" \? null : await readStoredPlanContext\(\)/);
  assert.match(widget, /continuation:\s*continuationRef\.current,[\s\S]*planContext,[\s\S]*pageContext:/);
  assert.match(planner, /HOME_ENERGY_ASSESSMENT_STORAGE_KEY/);
  assert.match(planner, /If you ask Surge AI, completed plan answers are sent as bounded context/);
  assert.match(planner, /photos and contact details are not included/);
  assert.match(privacy, /completed steps in the home energy planner in the same browser tab/);
  assert.match(privacy, /Planner photos and contact details are not included/);
  assert.match(privacy, /Newer details you tell Surge AI override a conflicting saved-plan answer/);
  assert.match(privacy, /Trade mode does not read a locally saved household plan/);
});

test("the tucked mascot preference survives customer-page navigation until explicit unhide", () => {
  assert.match(widget, /const DISPLAY_PREFERENCE_KEY = "aea-surge-display-v1"/);
  assert.match(widget, /function readStoredMascotTucked/);
  assert.match(widget, /function storeMascotTucked\(tucked: boolean\)/);
  assert.match(widget, /setMascotTucked\(readStoredMascotTucked\(\)\)/);
  assert.match(widget, /setMascotTucked\(true\);\s*storeMascotTucked\(true\)/);
  assert.match(widget, /setMascotTucked\(false\);\s*storeMascotTucked\(false\);\s*setOpenPathname\(pathname\)/);
  assert.match(widget, /window\.addEventListener\("storage", syncDisplayPreference\)/);
  assert.match(widget, /event\.key !== DISPLAY_PREFERENCE_KEY/);
  assert.match(widget, /aria-label="Bring Surge AI back and open chat"/);

  const resetStart = widget.indexOf("const clearLocalSession = useCallback");
  const resetEnd = widget.indexOf("useEffect(() =>", resetStart);
  const resetSource = widget.slice(resetStart, resetEnd);
  assert.doesNotMatch(resetSource, /DISPLAY_PREFERENCE_KEY|storeMascotTucked|setMascotTucked/);
});

test("customer pages open the single shared Surge widget through one reusable event", () => {
  assert.match(surgeEvents, /OPEN_SURGE_EVENT = "aea:open-surge"/);
  assert.match(surgeEvents, /window\.dispatchEvent\(new CustomEvent/);
  assert.match(surgeEvents, /draft\.trim\(\)\.slice\(0, 1_200\)/);
  assert.match(surgeOpenButton, /requestSurgeOpen\(draft\)/);
  assert.doesNotMatch(surgeOpenButton, /EnergyAssistantWidget|fetch\(/);
  assert.match(widget, /window\.addEventListener\(OPEN_SURGE_EVENT, openFromCustomerPage\)/);
  assert.match(widget, /if \(hidden \|\| context\.audience === "trade"\) return/);
  assert.match(widget, /setMascotTucked\(false\);[\s\S]*storeMascotTucked\(false\);[\s\S]*setOpenPathname\(pathname\);[\s\S]*setOpen\(true\)/);
  assert.match(widget, /if \(nextDraft\) setDraft\(nextDraft\)/);
  assert.equal((planner.match(/<SurgeOpenButton/g) || []).length, 2);
  assert.match(planner, /Ask Surge AI about the planner/);
  assert.match(planner, /Ask Surge AI about this roadmap/);
  assert.equal((gettingStarted.match(/<SurgeOpenButton/g) || []).length, 1);
  assert.match(gettingStarted, /Ask Surge AI first/);
});

test("only bounded local transcript, home profile, continuation, last activity and guide mode are persisted while the panel starts closed", () => {
  const persisted = [...widget.matchAll(/storeSession\(JSON\.stringify\(\{([\s\S]*?)\}\)\);/g)];
  assert.ok(persisted.length > 0);
  const persistedSource = persisted.map((match) => match[1]).join("\n");
  for (const match of persisted) assert.doesNotMatch(match[1], /\bopen\b/);
  assert.match(persistedSource, /mode/);
  assert.match(persistedSource, /messages:\s*boundedLocalMessages\(messages\)/);
  assert.match(persistedSource, /continuation:\s*continuationRef\.current/);
  assert.match(persistedSource, /profile/);
  assert.match(persistedSource, /lastActive/);
  assert.match(widget, /const MAX_LOCAL_MESSAGES = 40/);
  assert.match(widget, /const MAX_LOCAL_STORAGE_CHARACTERS = 160_000/);
  assert.match(widget, /const LOCAL_RETENTION_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(persistedSource, /lead|draft|email|phone|serviceConsent|marketingConsent/);
  assert.match(widget, /Chat history stays on this device for 30 days\. Your question and recent context are securely processed to answer you\./);
  assert.match(widget, />\s*Clear conversation/);
  assert.match(widget, /const messagesRef = useRef<AssistantMessage\[\]>\(\[\]\)/);
  assert.match(widget, /const replaceMessages = \(nextMessages: AssistantMessage\[\]\) =>/);
  assert.match(widget, /messagesRef\.current = boundedMessages[\s\S]*storeSession\(JSON\.stringify/);
  assert.match(widget, /replaceMessages\(\[\.\.\.messagesRef\.current, userMessage\]\)/);
  assert.match(widget, /replaceMessages\(\[\.\.\.messagesRef\.current, reply\]\)/);
  assert.doesNotMatch(widget, /setOpen\(saved\.open\)/);
  assert.match(widget, /const \[openPathname, setOpenPathname\] = useState\(""\)/);
  assert.match(widget, /const effectiveOpen = dedicated \|\| \(open && openPathname === pathname && !hidden\)/);
  assert.match(widget, /setOpenPathname\(pathname\);\s*setOpen\(true\)/);
  assert.doesNotMatch(widget, /const rememberModeForNavigation|setOpen\(saved\.open\)/);
});

test("same-browser local continuation is explicit and does not create tracking identity", () => {
  assert.match(widget, /type SavedConversation = \{[\s\S]*continuation: SurgeConversationState \| null/);
  assert.match(widget, /const continuationRef = useRef<SurgeConversationState \| null>\(null\)/);
  assert.match(widget, /continuation:\s*continuationRef\.current,[\s\S]*pageContext:/);
  assert.match(widget, /const nextContinuation = parseSurgeConversationState\(record\.continuation\)/);
  assert.match(widget, /continuationRef\.current = nextContinuation/);
  assert.match(widget, /setContinuation\(nextContinuation\)/);
  assert.match(widget, /Chat history stays on this device for 30 days/);
  assert.doesNotMatch(widget, /Last active \$\{lastActive\}/);
  assert.doesNotMatch(widget, /document\.cookie|canvas\.toDataURL|navigator\.plugins/);
  assert.match(widget, /setLead\(EMPTY_LEAD\)/);
  assert.match(widget, /setLeadRequestId\(""\)/);
});

test("the model reply parser accepts one follow-up question and ignores legacy extras", () => {
  const compiled = ts.transpileModule(functionSource(widget, "parseMessage"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const parseMessage = Function(
    "asString",
    "asRecord",
    "asStringList",
    "parseCitations",
    "parseActions",
    "makeRequestId",
    `${compiled}; return parseMessage;`,
  )(
    (value, maximum = 4_000) => typeof value === "string" ? value.trim().slice(0, maximum) : "",
    (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null,
    (value, limit) => Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, limit) : [],
    () => [],
    () => [],
    () => "generated-message",
  );

  const parsed = parseMessage({
    id: "reply-1",
    role: "assistant",
    content: "A clear answer.",
    directAnswer: "A clear answer.",
    followUpQuestion: "What is your postcode?",
    suggestedQuestions: ["Legacy question one", "Legacy question two"],
  }, "assistant");

  assert.deepEqual(parsed.suggestions, ["What is your postcode?"]);
});

test("public and customer widget copy never exposes internal platform names", () => {
  assert.match(widget, /function customerVisibleText/);
  assert.match(widget, /customerVisibleText\(message\.directAnswer \|\| message\.content, context\.audience\)/);
  assert.doesNotMatch(widget, /matched TLink trades/);
  assert.doesNotMatch(widget, /approved matched TLink trades/);
  assert.match(widget, /shared with matched trades/);
  assert.match(widget, /approved matched trades/);

  const compiled = ts.transpileModule(functionSource(widget, "customerVisibleText"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const visibleText = Function(`${compiled}; return customerVisibleText;`)();
  assert.equal(visibleText("Open TLink or Creditex", "public"), "Open the trade platform");
  assert.equal(visibleText("Open Creditex", "customer"), "Open the trade platform");
  assert.equal(visibleText("Open TLink", "trade"), "Open TLink");
});

test("expired local conversations and explicit resets atomically clear transcript and lead state", () => {
  assert.match(widget, /function savedConversation\(value: unknown, now = Date\.now\(\)\)/);
  assert.match(widget, /now - activeAt > LOCAL_RETENTION_MS/);
  assert.match(widget, /messages:\s*expired \? \[\] : boundedLocalMessages/);
  assert.match(widget, /Your locally saved conversation expired after 30 days of inactivity/);
  assert.match(widget, /const clearLocalSession = useCallback/);
  assert.match(widget, /removeStoredSession\(\)/);
  assert.match(widget, /continuationRef\.current = null/);
  assert.match(widget, /setMessages\(nextMessages\)/);
  assert.match(widget, /setContinuation\(null\)/);
  assert.match(widget, /Local conversation history cleared/);
  assert.doesNotMatch(widget, /fetch\([^)]*delete|SESSION_CREDENTIAL/);
});

test("trade and customer guide modes survive navigation into shared utility routes", () => {
  assert.match(widget, /function pageContext\(pathname: string, rememberedAudience: Audience = "public"\)/);
  assert.match(widget, /function isSharedUtilityRoute\(pathname: string\)/);
  for (const route of ["/calculator", "/rebates", "/compare", "/guides"]) {
    assert.ok(widget.includes(`pathname === "${route}"`), `missing shared route ${route}`);
  }
  assert.match(widget, /isSharedUtilityRoute\(pathname\) && rememberedAudience === "trade"/);
  assert.match(widget, /isSharedUtilityRoute\(pathname\) && rememberedAudience === "customer"/);
  assert.match(widget, /const restoredMode = explicitRouteAudience\(pathname\) \|\| saved\.mode/);
  assert.match(widget, /mode:\s*context\.audience/);
  assert.match(widget, /mode:\s*record\?\.mode === "trade" \|\| record\?\.mode === "customer"/);
  assert.match(widget, /const nextMode = explicitRouteAudience\(pathname\) \|\| "public"/);
  assert.match(widget, /setMode\(nextMode\)/);
  assert.match(widget, /if \(hydrationStartedRef\.current\) return/);
});

test("browser storage failures cannot break widget hydration, persistence or reset", () => {
  const helperSource = [
    functionSource(widget, "accessBrowserStorage"),
    functionSource(widget, "readStoredSession"),
    functionSource(widget, "storeSession"),
    functionSource(widget, "removeStoredSession"),
  ].join("\n");
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const helpers = Function(
    "STORAGE_KEY",
    `${compiled}; return { readStoredSession, storeSession, removeStoredSession };`,
  )("test-session");
  const existingWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage() {
          throw new Error("browser storage disabled");
        },
      },
    });
    assert.equal(helpers.readStoredSession(), null);
    assert.doesNotThrow(() => helpers.storeSession("value"));
    assert.doesNotThrow(() => helpers.removeStoredSession());

    const values = new Map();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, value),
          removeItem: (key) => values.delete(key),
        },
      },
    });
    helpers.storeSession("value");
    assert.equal(helpers.readStoredSession(), "value");
    helpers.removeStoredSession();
    assert.equal(helpers.readStoredSession(), null);

    globalThis.window.localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    assert.doesNotThrow(() => helpers.storeSession("new value"));
  } finally {
    if (existingWindow) Object.defineProperty(globalThis, "window", existingWindow);
    else delete globalThis.window;
  }
});

test("local continuation caps messages and recent API context and expires after 30 days", () => {
  const helperSource = [
    functionSource(widget, "boundedLocalMessages"),
    functionSource(widget, "starterProfile"),
    functionSource(widget, "starterProfileContext"),
    functionSource(widget, "recentTurnsForRequest"),
    functionSource(widget, "savedConversation"),
  ].join("\n");
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const helpers = Function(
    "MAX_LOCAL_MESSAGES",
    "MAX_LOCAL_STORAGE_CHARACTERS",
    "MAX_RECENT_TURNS",
    "MAX_MESSAGE_LENGTH",
    "MAX_RECENT_CONTEXT_CHARACTERS",
    "LOCAL_RETENTION_MS",
    "asRecord",
    "asString",
    "parseMessage",
    "parseSurgeConversationState",
    "EMPTY_STARTER_PROFILE",
    "PROFILE_RELATIONSHIPS",
    "PROFILE_HOME_TYPES",
    "PROFILE_HOUSEHOLD_SIZES",
    "PROFILE_PRIORITIES",
    `${compiled}; return { boundedLocalMessages, recentTurnsForRequest, savedConversation };`,
  )(
    40,
    160_000,
    8,
    1_200,
    6_000,
    30 * 24 * 60 * 60 * 1000,
    (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null,
    (value, maximum = 4_000) => typeof value === "string" ? value.trim().slice(0, maximum) : "",
    (value, role) => ({ ...value, role }),
    (value) => value && typeof value === "object" && value.version === 1 ? value : null,
    {
      postcode: "",
      relationship: "owner-occupier",
      homeType: "detached-house",
      householdSize: "three-four",
      priority: "lower-bills",
      completed: false,
    },
    new Set(["owner-occupier", "renter", "landlord", "strata", "not-sure"]),
    new Set(["detached-house", "townhouse", "apartment-unit", "rural-home", "not-sure"]),
    new Set(["one", "two", "three-four", "five-plus", "not-sure"]),
    new Set(["lower-bills", "comfort", "healthy-home", "electrify", "solar-storage", "not-sure"]),
  );
  const now = Date.parse("2026-08-20T02:00:00.000Z");
  const messages = Array.from({ length: 42 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}-${"x".repeat(998)}`,
    createdAt: new Date(now - (42 - index) * 1000).toISOString(),
  }));
  const active = helpers.savedConversation({
    open: true,
    mode: "trade",
    lastActive: new Date(now - 1_000).toISOString(),
    messages,
    continuation: {
      version: 1,
      activeTopic: "solar",
      goal: "Work out whether solar suits this home",
      facts: [{ key: "postcode", value: "3006" }],
      pendingQuestion: "How much electricity do you use?",
      lastAnswerSummary: "The roof and electricity use still need checking.",
    },
    profile: {
      postcode: "3006",
      relationship: "owner-occupier",
      homeType: "detached-house",
      householdSize: "three-four",
      priority: "lower-bills",
      completed: true,
    },
  }, now);
  assert.equal(active.expired, false);
  assert.equal(active.messages.length, 40);
  assert.equal(active.messages[0].id, "message-2");
  assert.equal(active.mode, "trade");
  assert.equal(active.continuation.activeTopic, "solar");
  assert.deepEqual(active.continuation.facts, [{ key: "postcode", value: "3006" }]);
  assert.equal(active.profile.postcode, "3006");
  assert.equal(active.profile.completed, true);
  assert.equal("open" in active, false);

  const recent = helpers.recentTurnsForRequest(active.messages);
  assert.ok(recent.length <= 8);
  assert.ok(recent.length > 0);
  assert.equal(recent[0].role, "user");
  assert.ok(recent.some((turn) => turn.role === "assistant"));
  assert.ok(recent.every((turn, index) => index === 0 || turn.role !== recent[index - 1].role));
  assert.ok(recent.every((turn) =>
    turn.role === (Number.parseInt(turn.content, 10) % 2 === 0 ? "user" : "assistant")));
  assert.ok(recent.reduce((total, turn) => total + turn.content.length, 0) <= 6_000);

  const profiled = helpers.recentTurnsForRequest([
    { role: "user", content: "What should I upgrade first?" },
  ], active.profile);
  assert.equal(profiled[0].role, "user");
  assert.match(profiled[0].content, /postcode 3006/);
  assert.match(profiled[0].content, /owner-occupier/);
  assert.match(profiled[0].content, /detached house/);
  assert.match(profiled[0].content, /three or four people/);
  assert.match(profiled[0].content, /lower energy bills/);
  assert.match(profiled[0].content, /What should I upgrade first\?/);

  const compactConversation = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `fact-${index}`,
  }));
  assert.deepEqual(
    helpers.recentTurnsForRequest(compactConversation).map((turn) => turn.content),
    compactConversation.slice(-8).map((turn) => turn.content),
  );
  assert.deepEqual(
    helpers.recentTurnsForRequest([
      { role: "user", content: "first attempt" },
      { role: "user", content: "clarified attempt" },
      { role: "assistant", content: "previous Surge answer" },
    ]),
    [
      { role: "user", content: "clarified attempt" },
      { role: "assistant", content: "previous Surge answer" },
    ],
  );

  const expired = helpers.savedConversation({
    open: true,
    mode: "customer",
    lastActive: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString(),
    messages,
  }, now);
  assert.equal(expired.expired, true);
  assert.deepEqual(expired.messages, []);
  assert.equal(expired.continuation, null);
  assert.equal(expired.profile.completed, false);
});

test("Surge AI has no customer file-upload or local-document feature", () => {
  assert.doesNotMatch(widget, /type="file"|accept="\.pdf|Choose PDF|documentResult|analyseDocument|documentLeadSummary|structuredDocumentSummary|shareDocumentSummary/);
  assert.doesNotMatch(styles, /\.documentTool|\.documentPicker|\.documentResult|\.documentVehicles|\.documentUse/);
  assert.doesNotMatch(privacy, /PDF quote|electricity interval file|bytes and extracted text/);
});

test("lead capture is optional, consent separated and retry safe", () => {
  assert.match(widget, /hasUsefulAnswer && serviceInterest && !leadOpen/);
  assert.match(widget, /function signalsServiceInterest\(message: string\)/);
  const interestSource = functionSource(widget, "signalsServiceInterest");
  const interestCompiled = ts.transpileModule(interestSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const signalsInterest = Function(`${interestCompiled}; return signalsServiceInterest;`)();
  assert.equal(signalsInterest("What insulation options suit a renter?"), false);
  assert.equal(signalsInterest("What are my hot water options?"), false);
  assert.equal(signalsInterest("I want quotes from an installer"), true);
  assert.equal(signalsInterest("Help me find a service provider"), true);
  assert.match(widget, /message\.role === "user" && signalsServiceInterest\(message\.content\)/);
  assert.match(widget, /Your advice is not gated/);
  assert.match(widget, /Surge AI never sends the raw conversation to trades/);
  assert.match(widget, /Keep exploring or change subject/);
  assert.match(widget, /Continue asking or change subject/);
  assert.match(widget, /fetch\("\/api\/energy-assistant\/leads"/);
  for (const field of [
    "submissionKey",
    "suburb",
    "state",
    "services",
    "interestConfirmed",
    "quoteBrief",
    "serviceConsent",
    "marketingConsent",
    "tradeSharingConsent",
  ]) {
    assert.ok(leadClient.includes(field), `missing canonical lead field: ${field}`);
  }
  assert.match(widget, /buildEnergyAssistantLeadPayload\(\{/);
  assert.match(widget, /createEnergyAssistantSubmissionKey\(\)/);
  assert.match(widget, /energyAssistantQuoteQuestionsForServices\(lead\.services\)/);
  assert.match(widget, /\/api\/address-localities\?postcode=/);
  assert.match(widget, /separately agree that Australian Energy Assessments may share my name, email, postcode, state, selected services and completed quote brief/);
  assert.match(widget, /unchecked by default/);
  assert.match(leadClient, /tradeSharingConsent: lead\?\.tradeSharingConsent === true/);
  assert.match(leadClient, /additionalContext: additionalContext\(lead\?\.message, documentSummary\)/);
  assert.doesNotMatch(widget, /sessionId:\s*credentials|accessKey:\s*credentials/);
  assert.match(widget, /marketingConsent:\s*false/);
  assert.match(widget, /This is optional and is not required for a response/);
  assert.match(widget, /Only the details you enter here go to Australian Energy Assessments/);
  assert.match(widget, /const requestId = leadRequestId \|\| makeRequestId\("lead"\)/);
  assert.match(widget, /const submissionKey = leadSubmissionKey \|\| createEnergyAssistantSubmissionKey\(\)/);
  assert.match(widget, /const grantedAt = leadGrantedAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(widget, /setLead\(EMPTY_LEAD\)[\s\S]{0,160}catch/);
});

test("the optional quote brief is progressive, phone-safe and trade sharing requires useful detail", () => {
  assert.match(widget, /type LeadStage = "scope" \| "basics" \| "questions" \| "contact" \| "preferences" \| "consent"/);
  assert.match(widget, /quoteQuestions\.slice\(leadQuestionPage \* 3, leadQuestionPage \* 3 \+ 3\)/);
  assert.match(widget, /currentQuoteQuestions\.map\(\(question\) =>/);
  assert.doesNotMatch(widget, /\{quoteQuestions\.map\(\(question\) => \(/);
  assert.match(widget, /Not sure \/ skip these/);
  assert.match(widget, /answerCurrentQuoteQuestionsAsUnknown/);
  assert.match(widget, /Brief so far/);
  assert.match(widget, /Edit location or services/);
  assert.match(widget, /Edit property details/);
  assert.match(widget, /Edit service details/);
  assert.match(widget, /leadStage === "contact"/);
  assert.match(widget, /leadStage === "preferences"/);
  assert.match(widget, /leadStage === "consent"/);
  assert.match(widget, /question\.id !== "timing"[\s\S]*question\.services\.length === 1/);
  assert.match(widget, /length < 2/);
  assert.match(widget, /Add two useful details for each service or leave trade sharing off/);
  assert.match(widget, /Finish the trade brief or leave trade sharing off/);
  assert.match(widget, /Australian Energy Assessments help stays available/);
  assert.match(widget, /It has not been shared with trades because the brief still needs more useful detail/);
  assert.doesNotMatch(widget, /quickQuestionsFor\(message\)/);
  assert.equal((styles.match(/overflow-y:\s*auto/g) || []).length, 1);
});

test("the floating guide remains modal while the dedicated page is non-modal", () => {
  assert.match(widget, /role=\{dedicated \? "region" : "dialog"\}/);
  assert.match(widget, /aria-modal=\{dedicated \? undefined : "true"\}/);
  assert.match(widget, /tabIndex=\{dedicated \? undefined : -1\}/);
  assert.match(widget, /if \(!effectiveOpen \|\| dedicated\) return/);
  assert.match(widget, /dialogRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(widget, /effectiveOpen[\s\S]{0,700}composerRef\.current\?\.focus/);
  assert.match(widget, /const hasConversation = messages\.length > 0/);
  assert.match(widget, /top: hasConversation \? container\.scrollHeight : 0/);
  assert.match(widget, /behavior: hasConversation \? "smooth" : "auto"/);
  assert.match(widget, /event\.key === "Escape"/);
  assert.match(widget, /event\.key !== "Tab"/);
  assert.match(widget, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(widget, /matchMedia\("\(max-width: 640px\)"\)/);
  assert.match(widget, /document\.body\.style\.overflow = "hidden"/);
  assert.match(widget, /data-mascot-state=\{messages\.length > 0 \? "returning" : "idle"\}/);
  assert.match(widget, /function SurgeMascot/);
  assert.match(widget, /<SurgeMascot \/>/);
  assert.match(widget, /<SurgeMascot peeking \/>/);
  assert.match(styles, /\.launcher\s*\{[\s\S]*height:\s*70px[\s\S]*width:\s*60px/);
  assert.match(styles, /\.mascot\s*\{[\s\S]*background:\s*url\("\/surge-mascot\.png"\)[\s\S]*height:\s*65px[\s\S]*width:\s*53px/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.launcher\s*\{[\s\S]*height:\s*70px[\s\S]*width:\s*60px/);
  assert.equal(mascotImage.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(mascotImage.byteLength > 100_000);
  assert.match(widget, /aria-label="Hide Surge AI mascot"/);
  assert.match(widget, /aria-label="Open Surge AI"/);
  assert.match(widget, /aria-label="Close Surge AI"/);
  assert.match(widget, /aria-label="Bring Surge AI back and open chat"/);
  assert.match(widget, /mascotTucked \? \(/);
  assert.match(widget, /setMascotTucked\(false\);\s*storeMascotTucked\(false\);\s*setOpenPathname\(pathname\);\s*setOpen\(true\)/);
  assert.match(styles, /\.launcherPeek\s*\{/);
  assert.match(styles, /\.launcherPeek\s*\{[\s\S]*background:\s*transparent[\s\S]*border:\s*0[\s\S]*height:\s*70px[\s\S]*width:\s*55px/);
  assert.match(styles, /\.rootTucked\s*\{[\s\S]*right:\s*calc\(100% - 100vw\)/);
  assert.match(styles, /\.mascotPeeking\s*\{[\s\S]*height:\s*66px[\s\S]*right:\s*-31\.5px[\s\S]*rotate\(-11deg\)[\s\S]*width:\s*53px/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.root:not\(\.rootOpen\)\.rootTucked\s*\{[\s\S]*right:\s*calc\(100% - 100vw\)/);
  assert.doesNotMatch(widget, /peekLabel|>Ask Surge<\/span>/);
  assert.match(styles, /\.launcherDismiss::after\s*\{[\s\S]*inset:\s*-12px/);
  for (const state of ["surgeIdle", "surgeHello", "surgeReturning"]) {
    assert.match(styles, new RegExp(`@keyframes ${state}`));
  }
  assert.match(styles, /@keyframes surgePeek/);
  assert.match(styles, /@keyframes surgePeek\s*\{[\s\S]*rotate\(-11deg\)[\s\S]*rotate\(-15deg\)/);
  assert.match(styles, /prefers-reduced-motion:[\s\S]*\.mascot/);
  assert.match(styles, /\.panel\s*\{[\s\S]*width:\s*400px/);
  assert.match(styles, /\.rootOpen\s*\{[\s\S]*flex-direction:\s*column-reverse[\s\S]*gap:\s*10px/);
  assert.match(styles, /\.rootOpen \.panel\s*\{[\s\S]*calc\(100dvh - 98px\)/);
  assert.match(styles, /\.conversation\s*\{[\s\S]*align-content:\s*start[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /\.privacy a,[\s\S]*\.privacy button\s*\{[\s\S]*align-items:\s*center[\s\S]*display:\s*inline-flex/);
  assert.equal((styles.match(/overflow-y:\s*auto/g) || []).length, 1);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.rootOpen\s*\{[\s\S]*bottom:\s*max\(12px,[\s\S]*top:\s*auto/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.rootOpen \.panel\s*\{[\s\S]*height:\s*min\(72dvh, 620px\)[\s\S]*max-height:\s*calc\(100dvh - 104px - env\(safe-area-inset-bottom\)\)[\s\S]*width:\s*100%/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styles, /min-height:\s*(?:[0-3]?\d|4[0-3])px/);
});

test("page navigation links are restricted and public answer cards do not expose source metadata", () => {
  assert.match(widget, /const SAFE_EXACT_ACTIONS = new Set/);
  assert.match(widget, /candidate\.includes\("\\\\"\)/);
  assert.match(widget, /candidate\.includes\("\?"\)/);
  assert.match(widget, /SAFE_EXACT_ACTIONS\.has\(pathname\)/);
  assert.ok(widget.includes("if (/^\\/guides\\/[a-z0-9-]{1,80}$/.test(pathname))"));
  assert.doesNotMatch(widget, /target="_blank" rel="noreferrer"/);
  const answerCardStart = widget.indexOf("{messages.length > 0 && (");
  const answerCardEnd = widget.indexOf("{busy &&", answerCardStart);
  assert.notEqual(answerCardStart, -1);
  assert.notEqual(answerCardEnd, -1);
  const answerCards = widget.slice(answerCardStart, answerCardEnd);
  assert.match(answerCards, /message\.directAnswer \|\| message\.content/);
  assert.match(answerCards, /naturalFollowUpFor\(message, context\.audience\)/);
  assert.doesNotMatch(answerCards, /citations|sources|sourceBoundary|toolActions|message\.actions/);
});
