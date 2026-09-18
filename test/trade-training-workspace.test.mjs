import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/TradeTrainingWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const reviewSource = fs.readFileSync(new URL("../src/components/CreditexOnboardingReviewWorkspace.tsx", import.meta.url), "utf8");
const reviewCompiled = ts.transpileModule(reviewSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const user = { uid: "learner-a", getIdToken: async () => "test-token" };
const business = { status: "approved", revision: 1, insuranceExpiresOn: "2027-01-01", approved: true, blockedReasons: [] };
const course = (availability = "active") => ({ id: "veu-6", version: "reviewed-v1", title: "Activity 6 heating and cooling", activityTemplateIds: ["veu-6"], estimatedMinutes: 25,
  passPercent: 100, validityDays: 365, assessmentAvailable: true, assessmentUnavailableReason: "", availability, status: "required", completion: null,
  lessons: [{ title: "Consumer protection", body: "Check the activity 6 requirements.", sourceIds: ["esc"] }, { title: "Commissioning", body: "Retain actual commissioning evidence.", sourceIds: ["esc"] }],
  sources: [{ id: "esc", title: "Official Activity 6 guidance", url: "https://www.esc.vic.gov.au/activity-6" }] });
const attempt = { id: "attempt-1", moduleId: "veu-6", version: "reviewed-v1", expiresAt: "2027-01-01T10:00:00Z", questions: [
  { id: "q-consent", prompt: "When is customer consent needed?", critical: true, options: [{ id: "before", text: "Before the relevant agreement" }, { id: "after", text: "After the installation" }] },
  { id: "q-photo", prompt: "Which commissioning evidence is retained?", critical: true, options: [{ id: "actual", text: "The actual installation" }, { id: "stock", text: "A stock image" }] },
] };
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(responder, component = "TradeTrainingWorkspace", props = {}) {
  const state = []; const effects = []; const requests = []; let cursor = 0; let initial = true;
  const hooks = {
    useState(value) { const index = cursor++; if (!(index in state)) state[index] = typeof value === "function" ? value() : value; return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
    useRef(value) { const index = cursor++; if (!(index in state)) state[index] = { current: value }; return state[index]; },
    useCallback(callback) { return callback; },
    useEffect(callback) { if (initial) effects.push(callback); },
  };
  const exports = {};
  const fetch = async (url, init = {}) => { requests.push({ url, ...init }); const result = await responder(url, init); return { ok: result.ok !== false, json: async () => result }; };
  const require = (id) => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : (() => { throw new Error(`Unexpected client runtime import: ${id}`); })();
  Function("require", "exports", "fetch", component === "CreditexOnboardingReviewWorkspace" ? reviewCompiled : compiled)(require, exports, fetch);
  const render = () => { cursor = 0; const tree = exports[component]({ user, api: responder, canReview: true, ...props }); initial = false; return tree; };
  return { requests, render, async mount() { render(); for (const effect of effects) effect(); await flush(); return render(); } };
}
const button = (tree, name) => nodes(tree, (node) => node.type === "button" && text(node).includes(name))[0];

async function learn(h) {
  let tree = await h.mount(); button(tree, "Open learning material").props.onClick(); tree = h.render();
  assert.equal(button(tree, "Start assessment").props.disabled, true);
  const first = nodes(tree, (node) => node.type === "input" && node.props.type === "checkbox")[0]; first.props.onChange({ target: { checked: true } });
  tree = h.render(); button(tree, "Next lesson").props.onClick(); tree = h.render();
  nodes(tree, (node) => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } });
  return h.render();
}

test("learner reads exact source-linked lessons before an active assessment can start", async () => {
  const h = harness(async (_url, init) => init.method ? { ok: true, attempt } : { ok: true, business, memberId: "member-a", modules: [course()] });
  let tree = await learn(h);
  assert.equal(button(tree, "Start assessment").props.disabled, false);
  assert.ok(nodes(tree, (node) => node.type === "a" && node.props.href === "https://www.esc.vic.gov.au/activity-6").length);
  button(tree, "Start assessment").props.onClick(); await flush(); tree = h.render();
  assert.deepEqual(JSON.parse(h.requests.at(-1).body), { action: "start", moduleId: "veu-6" });
  assert.equal(nodes(tree, (node) => node.type === "legend").length, 1);
  assert.ok(text(tree).includes("When is customer consent needed?"));
  assert.ok(!text(tree).includes("Which commissioning evidence is retained?"));
  assert.equal(button(tree, "Next question").props.disabled, true);
});

test("assessment preserves answers when navigating and uses only the server result", async () => {
  let submission;
  const h = harness(async (_url, init) => {
    if (!init.method) return { ok: true, business, memberId: "member-a", modules: [course()] };
    const body = JSON.parse(init.body); if (body.action === "start") return { ok: true, attempt };
    submission = body; return { ok: true, result: { passed: false, scorePercent: 90, criticalPassed: false, reference: "", expiresAt: "" } };
  });
  let tree = await learn(h); button(tree, "Start assessment").props.onClick(); await flush(); tree = h.render();
  nodes(tree, (node) => node.type === "input" && node.props.value === "before")[0].props.onChange();
  tree = h.render(); button(tree, "Next question").props.onClick(); tree = h.render();
  nodes(tree, (node) => node.type === "input" && node.props.value === "actual")[0].props.onChange();
  tree = h.render(); button(tree, "Previous question").props.onClick(); tree = h.render();
  assert.equal(nodes(tree, (node) => node.type === "input" && node.props.value === "before")[0].props.checked, true);
  button(tree, "Next question").props.onClick(); tree = h.render(); button(tree, "Submit assessment").props.onClick(); await flush(); tree = h.render();
  assert.deepEqual(submission, { action: "submit", attemptId: "attempt-1", answers: { "q-consent": "before", "q-photo": "actual" } });
  assert.ok(text(tree).includes("More learning is needed"));
  assert.ok(!text(tree).includes("Assessment passed"));
  assert.ok(text(tree).includes("mandatory compliance questions need review"));
  assert.equal(button(tree, "Try the assessment again").props.disabled, false);
  assert.ok(text(tree).includes("retry immediately as often as needed"));
});

test("all 25 answers submit, a 96% result can be retried immediately, and 100% records the personal pass", async () => {
  const questions = Array.from({ length: 25 }, (_, index) => ({ id: `question-${index}`, prompt: `Activity 6 requirement ${index + 1}`, critical: true, options: [{ id: `answer-${index}`, text: "The current requirement" }, { id: `other-${index}`, text: "A different requirement" }] }));
  let submissions = 0;
  const courseModule = course();
  const h = harness(async (_url, init) => {
    if (!init.method) return { ok: true, business, memberId: "member-a", modules: [courseModule] };
    const body = JSON.parse(init.body);
    if (body.action === "start") return { ok: true, attempt: { ...attempt, id: `attempt-${submissions + 1}`, questions } };
    assert.equal(Object.keys(body.answers).length, 25); submissions++;
    const passed = submissions === 2;
    if (passed) { courseModule.status = "passed"; courseModule.completion = { reference: "TL-CX-TRAIN-CURRENT-PASS", passedAt: "2026-09-19", expiresAt: "2027-09-19", revokedAt: "" }; }
    return { ok: true, result: { passed, scorePercent: passed ? 100 : 96, criticalPassed: passed, reference: passed ? courseModule.completion.reference : "", expiresAt: passed ? courseModule.completion.expiresAt : "" } };
  });
  let tree = await learn(h); button(tree, "Start assessment").props.onClick(); await flush(); tree = h.render();
  for (let run = 0; run < 2; run++) {
    for (let index = 0; index < 25; index++) {
      assert.match(text(tree), new RegExp(`Question\\s+${index + 1}\\s+of\\s+25`));
      nodes(tree, node => node.type === "input" && node.props.value === `answer-${index}`)[0].props.onChange(); tree = h.render();
      if (index < 24) { button(tree, "Next question").props.onClick(); tree = h.render(); }
    }
    button(tree, "Submit assessment").props.onClick(); await flush(); tree = h.render();
    if (run === 0) {
      assert.match(text(tree), /Your score:\s+96\s*%/); assert.doesNotMatch(text(tree), /Assessment passed/);
      assert.equal(button(tree, "Try the assessment again").props.disabled, false);
      button(tree, "Try the assessment again").props.onClick(); await flush(); tree = h.render();
      assert.match(text(tree), /0\s+answered/);
    }
  }
  assert.match(text(tree), /Your score:\s+100\s*%/); assert.match(text(tree), /TL-CX-TRAIN-CURRENT-PASS/);
  assert.match(text(tree), /1\s+of\s+1\s+activity modules passed/);
  assert.doesNotMatch(text(tree), /approval pending/i);
  assert.equal(button(tree, "Start assessment").props.disabled, true);
});

test("large programme catalogues page activity cards and filter by exact programme and search", async () => {
  const modules = Array.from({ length: 30 }, (_, index) => ({ ...course(), id: `test-${index}`, title: `Specific module ${index}`, programCode: index < 15 ? "VEU" : "ACT-SHS" }));
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", modules }));
  let tree = await h.mount();
  const openButtons = () => nodes(tree, (node) => node.type === "button" && text(node) === "Open learning material");
  assert.equal(openButtons().length, 12);
  button(tree, "Show 12 more").props.onClick(); tree = h.render(); assert.equal(openButtons().length, 24);
  nodes(tree, (node) => node.type === "select")[0].props.onChange({ target: { value: "ACT SHS" } }); tree = h.render();
  assert.equal(openButtons().length, 12); assert.match(text(tree), /15\s+matching activities/);
  nodes(tree, (node) => node.type === "input" && node.props.type === "search")[0].props.onChange({ target: { value: "module 22" } }); tree = h.render();
  assert.equal(openButtons().length, 1); assert.ok(text(tree).includes("Specific module 22"));
  assert.ok(!text(tree).includes("Specific module 21"));
});

test("to-do list shows unfinished training first and keeps passed references available by status", async () => {
  const completed = { ...course(), id: "sres-ashp", title: "Completed heat-pump learning", status: "passed",
    completion: { reference: "TL-CX-TRAIN-PASSED", passedAt: "2026-09-18", expiresAt: "2027-01-01", revokedAt: "" } };
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", modules: [completed, course("awaiting_review")] }));
  let tree = await h.mount();
  assert.match(text(tree), /1\s+training\s+task\s+to do/);
  assert.ok(text(tree).includes("Activity 6 heating and cooling"));
  assert.ok(!text(tree).includes("Completed heat-pump learning"));
  const statusSelect = () => nodes(tree, (node) => node.type === "select" && node.props["aria-label"] === "Training status")[0];
  statusSelect().props.onChange({ target: { value: "passed" } }); tree = h.render();
  assert.ok(text(tree).includes("Completed heat-pump learning"));
  assert.ok(text(tree).includes("TL-CX-TRAIN-PASSED"));
  assert.ok(!text(tree).includes("Activity 6 heating and cooling"));
  statusSelect().props.onChange({ target: { value: "all" } }); tree = h.render();
  assert.ok(text(tree).includes("Completed heat-pump learning"));
  assert.ok(text(tree).includes("Activity 6 heating and cooling"));
});

test("personal training remains visible when the business has not enabled the service", async () => {
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", modules: [{ ...course(), businessServiceEnabled: false }] }));
  const tree = await h.mount();
  assert.ok(text(tree).includes("You can study this activity now"));
  assert.ok(text(tree).includes("before programme work can be booked"));
  assert.ok(button(tree, "Open learning material"));
});

test("declared activities without a curriculum stay visible as locked with no assessment action", async () => {
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", modules: [], unavailableActivities: [{ id: "special-one", title: "Special work", programCode: "NSW-ESS", serviceCategory: "other", status: "unavailable", message: "Current training is not reviewed." }] }));
  const tree = await h.mount();
  assert.ok(text(tree).includes("Special work")); assert.ok(text(tree).includes("These activities remain locked"));
  assert.equal(button(tree, "Start assessment"), undefined); assert.equal(button(tree, "Open learning material"), undefined);
});

test("complete courses permit assessment after all lessons without a manual review gate", async () => {
  const h = harness(async (_url, init) => init.method ? { ok: true, attempt } : { ok: true, business, memberId: "member-a", modules: [course("awaiting_review")] });
  let tree = await learn(h);
  assert.equal(button(tree, "Start assessment").props.disabled, false);
  assert.equal(button(tree, "Next lesson"), undefined);
  assert.match(text(tree), /Lessons complete. Continue to the assessment below/);
  assert.match(text(tree), /ready to start the assessment/);
  assert.doesNotMatch(text(tree), /Programme approval pending|review and activate this exact curriculum/);
  button(tree, "Start assessment").props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /Question\s+1\s+of\s+2/);
  assert.equal(h.requests.filter(request => request.method === "POST").length, 1);
});

test("a server-confirmed pass displays the returned completion reference and learning feedback", async () => {
  const h = harness(async (_url, init) => {
    if (!init.method) return { ok: true, business, memberId: "member-a", modules: [course()] };
    const body = JSON.parse(init.body); if (body.action === "start") return { ok: true, attempt };
    return { ok: true, result: { passed: true, scorePercent: 100, criticalPassed: true, reference: "TL-CX-TRAIN-SERVER-REFERENCE", expiresAt: "2027-01-01", feedback: [{ questionId: "q-consent", prompt: "When is customer consent needed?", correct: true, correctAnswer: "Before the relevant agreement", explanation: "Retain informed customer consent before the agreement.", sourceIds: ["esc"] }] } };
  });
  let tree = await learn(h); button(tree, "Start assessment").props.onClick(); await flush(); tree = h.render();
  nodes(tree, (node) => node.type === "input" && node.props.value === "before")[0].props.onChange(); tree = h.render();
  button(tree, "Next question").props.onClick(); tree = h.render();
  nodes(tree, (node) => node.type === "input" && node.props.value === "actual")[0].props.onChange(); tree = h.render();
  button(tree, "Submit assessment").props.onClick(); await flush(); tree = h.render();
  assert.ok(text(tree).includes("TL-CX-TRAIN-SERVER-REFERENCE"));
  assert.ok(text(tree).includes("Retain informed customer consent before the agreement."));
  assert.ok(text(tree).includes("not a government certificate, licence or accreditation"));
});

test("partial curriculum explains the assessment block after every lesson is read", async () => {
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", modules: [{ ...course("awaiting_review"), status: "awaiting_review", assessmentAvailable: false, assessmentUnavailableReason: "Current official installation requirements are incomplete." }] }));
  const tree = await learn(h);
  assert.equal(button(tree, "Start assessment").props.disabled, true);
  assert.match(text(tree), /Current official installation requirements are incomplete/);
  button(tree, "Start assessment").props.onClick(); await flush();
  assert.equal(h.requests.filter(request => request.method === "POST").length, 0);
});

test("learning completion retains its reference and served-state explanation without a manual approval label", async () => {
  const completed = { ...course("awaiting_review"), status: "passed", completion: { reference: "LEARNING-PENDING-APPROVAL", expiresAt: "2027-01-01" } };
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", trainingServiceStates: ["VIC", "NSW"], modules: [completed] }));
  let tree = await h.mount();
  nodes(tree, node => node.type === "select" && node.props["aria-label"] === "Training status")[0].props.onChange({ target: { value: "passed" } }); tree = h.render();
  assert.match(text(tree), /LEARNING-PENDING-APPROVAL/); assert.doesNotMatch(text(tree), /Programme approval pending/);
  assert.match(text(tree), /Training for\s+VIC, NSW/); assert.match(text(tree), /0\s+training\s+tasks\s+to do/);
});

test("internal review notes never become learner source links", async () => {
  const withInternal = course(); withInternal.sources.push({ id: "creditex-review", title: "Internal review notes", url: "/creditex-resources/creditex-source-review.md" });
  withInternal.lessons[0].sourceIds.push("creditex-review");
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", modules: [withInternal] }));
  let tree = await h.mount(); button(tree, "Open learning material").props.onClick(); tree = h.render();
  const links = nodes(tree, node => node.type === "a");
  assert.ok(links.some(node => node.props.href === "https://www.esc.vic.gov.au/activity-6"));
  assert.ok(!links.some(node => node.props.href.includes("creditex-source-review.md")));
  assert.doesNotMatch(text(tree), /Internal review notes/);
});

test("non-owner onboarding renders status without private application controls", async () => {
  const h = harness(async () => ({ ok: true, actor: { isOwner: false, displayName: "Team member", memberId: "member-a" }, business }), "TradeCreditexOnboarding");
  const tree = await h.mount();
  assert.ok(text(tree).includes("The business owner manages the application and private documents"));
  assert.equal(nodes(tree, (node) => node.type === "input" || node.type === "form").length, 0);
});

const draftBusiness = { status: "draft", revision: 4, insuranceExpiresOn: "", approved: false, blockedReasons: [] };
const oldApplication = () => ({ legalName: "Previous Company Pty Ltd", acn: "123456789", hasWebsite: false, website: "", address: "1 Main Street", insuranceDocumentId: "insurance-1", insuranceExpiresOn: "2027-01-01", priorProposalDocumentId: "", doesNswWork: false, contractorLicenceDocumentId: "", director: { name: "Alex Owner", address: "1 Main Street", email: "alex@example.com", mobile: "0412345678", idDocumentId: "id-1", selfieDocumentId: "selfie-1" }, directorIsGuarantor: true, guarantor: { name: "", address: "", email: "", mobile: "", idDocumentId: "", selfieDocumentId: "", position: "" }, witness: { name: "Sam Witness", position: "Witness", email: "sam@example.com" }, acceptedPrivacy: true });
const ownerSetup = (application = oldApplication()) => ({ ok: true, actor: { isOwner: true, displayName: "Alex", memberId: "owner" }, business: draftBusiness, application, documents: [] });
const field = (tree, title) => nodes(tree, node => node.props?.title === title)[0];
const submitSetup = async h => { nodes(h.render(), node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await flush(); return h.render(); };

test("old saved onboarding gets unsigned defaults and a usable agreement placeholder", async () => {
  const h = harness(async () => ownerSetup(), "TradeCreditexOnboarding", { initialExpanded: true });
  const tree = await h.mount();
  assert.match(text(tree), /Creditex partnership agreement: document to be supplied/);
  assert.match(text(tree), /save your business details and complete training now/);
  assert.match(text(tree), /Automated ABN verification: connection to be supplied/);
  assert.match(text(tree), /does not sign a contract/);
  assert.doesNotMatch(text(tree), /Awaiting approval|Approval pending|Awaiting Creditex review/i);
  const agreement = nodes(tree, node => node.type === "label" && text(node).startsWith("Signed Creditex partnership agreement"))[0];
  assert.equal(nodes(agreement, node => node.type === "select")[0].props.value, "");
  const declaration = nodes(tree, node => node.type === "label" && text(node).includes("uploaded Creditex partnership agreement is signed"))[0];
  assert.equal(nodes(declaration, node => node.type === "input")[0].props.checked, false);
  assert.equal(h.requests.filter(request => request.method).length, 0);
});

test("one complete-setup action saves changed details then submits the returned revision", async () => {
  let releaseSave;
  const savePending = new Promise(resolve => { releaseSave = resolve; });
  const h = harness(async (_url, init) => {
    if (!init.method) return ownerSetup();
    if (init.method === "PUT") { await savePending; return { ok: true, business: { ...draftBusiness, revision: 5 } }; }
    return { ok: true, business: { ...draftBusiness, status: "completed", revision: 6, approved: true, completionReference: "TL-CX-BUSINESS-REAL-RECORD", completedAt: "2026-09-19T01:00:00Z" } };
  }, "TradeCreditexOnboarding", { initialExpanded: true });
  let tree = await h.mount(); field(tree, "Pty Ltd company legal name").props.onChange("Current Company Pty Ltd");
  tree = await submitSetup(h);
  assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  assert.equal(h.requests.filter(request => request.method === "POST").length, 0);
  releaseSave(); await flush(); tree = h.render();
  const mutations = h.requests.filter(request => request.method);
  assert.deepEqual(mutations.map(request => request.method), ["PUT", "POST"]);
  const saved = JSON.parse(mutations[0].body);
  assert.equal(saved.expectedRevision, 4); assert.equal(saved.application.legalName, "Current Company Pty Ltd");
  assert.deepEqual(JSON.parse(mutations[1].body), { action: "submit", expectedRevision: 5 });
  assert.match(text(tree), /TL-CX-BUSINESS-REAL-RECORD/); assert.match(text(tree), /Business setup complete/);
  assert.equal(button(tree, "Complete business setup").props.disabled, true);
});

test("save failure preserves changed fields and never submits an old revision", async () => {
  let saves = 0;
  const h = harness(async (_url, init) => {
    if (!init.method) return ownerSetup();
    if (init.method === "PUT") { saves++; return saves === 1 ? { ok: false, error: "Connection interrupted while saving." } : { ok: true, business: { ...draftBusiness, revision: 5 } }; }
    return { ok: true, business: { ...draftBusiness, revision: 6, status: "completed", approved: true } };
  }, "TradeCreditexOnboarding", { initialExpanded: true });
  let tree = await h.mount(); field(tree, "Pty Ltd company legal name").props.onChange("Retained Company Pty Ltd");
  tree = await submitSetup(h);
  assert.match(text(tree), /Connection interrupted while saving/);
  assert.equal(field(tree, "Pty Ltd company legal name").props.value, "Retained Company Pty Ltd");
  assert.equal(h.requests.filter(request => request.method === "POST").length, 0);
  assert.equal(button(tree, "Save progress").props.disabled, false);
  await submitSetup(h);
  const writes = h.requests.filter(request => request.method === "PUT").map(request => JSON.parse(request.body));
  assert.deepEqual(writes.map(write => write.expectedRevision), [4, 4]);
  assert.deepEqual(JSON.parse(h.requests.at(-1).body), { action: "submit", expectedRevision: 5 });
});

test("completion failure retains the saved revision and retries without repeating the save", async () => {
  let completes = 0;
  const h = harness(async (_url, init) => {
    if (!init.method) return ownerSetup();
    if (init.method === "PUT") return { ok: true, business: { ...draftBusiness, revision: 5 } };
    completes++; return completes === 1 ? { ok: false, error: "Signed agreement is required." } : { ok: true, business: { ...draftBusiness, revision: 6, status: "completed", approved: true } };
  }, "TradeCreditexOnboarding", { initialExpanded: true });
  let tree = await h.mount(); field(tree, "Business address").props.onChange("2 Retained Street");
  tree = await submitSetup(h);
  assert.match(text(tree), /Signed agreement is required/);
  assert.equal(field(tree, "Business address").props.value, "2 Retained Street");
  assert.equal(button(tree, "Save progress").props.disabled, true);
  await submitSetup(h);
  assert.equal(h.requests.filter(request => request.method === "PUT").length, 1);
  assert.deepEqual(h.requests.filter(request => request.method === "POST").map(request => JSON.parse(request.body).expectedRevision), [5, 5]);
});

test("new setup persists prefilled business details without accepting declarations", async () => {
  const h = harness(async (_url, init) => !init.method ? ownerSetup(null) : init.method === "PUT" ? { ok: true, business: { ...draftBusiness, revision: 5 } } : { ok: false, error: "Complete the declarations." }, "TradeCreditexOnboarding", { initialExpanded: true, businessName: "Prefilled Company Pty Ltd", businessAddress: "10 Prefilled Street" });
  const tree = await h.mount(); assert.equal(button(tree, "Save progress").props.disabled, false); await submitSetup(h);
  const request = h.requests.find(request => request.method === "PUT");
  const saved = JSON.parse(request.body).application;
  assert.equal(saved.legalName, "Prefilled Company Pty Ltd"); assert.equal(saved.address, "10 Prefilled Street");
  assert.equal(saved.acceptedPrivacy, false); assert.equal(saved.acceptedCompliance, false); assert.equal(saved.agreementDocumentId, "");
});

test("training is reachable for owners and staff and learner bundles never import the answer bank", () => {
  const read = (name) => fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
  assert.match(read("DirectTradeDashboard.tsx"), /workspace === "training" && <TradeTrainingWorkspace/);
  assert.match(read("TradeTeamPortal.tsx"), /portalView === "training" && <TradeTrainingWorkspace/);
  assert.match(read("TradeTeamPortal.tsx"), /onOpenOwnTraining=\{\(\) => setPortalView\("training"\)\}/);
  assert.match(read("DirectTradeDashboard.tsx"), /onOpenOwnTraining=\{\(\) => setWorkspace\("training"\)\}/);
  assert.match(read("DirectTradePartnerForm.tsx"), /<TradeCreditexOnboarding user=\{user\} initialExpanded/);
  assert.doesNotMatch(source, /correctOptionId|TRAINING_MODULES|creditex-training-curriculum|localStorage/);
  assert.match(source, /result\?\.feedback/);
  assert.match(read("CreditexOnboardingReviewWorkspace.tsx"), /expectedVersion: curriculum\.version, expectedHash: curriculum\.contentHash/);
});

test("reviewer sees exact source gaps and can withdraw but cannot activate incomplete curriculum", async () => {
  const partial = { ...course("awaiting_review"), contentHash: "retained-hash", reviewUpdatedAt: "", questions: [],
    sourceCoverage: { status: "partial", gaps: ["Current activity assignment template has not been verified."] } };
  const h = harness(async () => ({ applications: [], modules: [partial], completions: [] }), "CreditexOnboardingReviewWorkspace");
  let tree = await h.mount(); button(tree, "Curriculum review").props.onClick(); tree = h.render();
  nodes(tree, (node) => node.type === "select")[0].props.onChange({ target: { value: partial.id } }); tree = h.render();
  assert.ok(text(tree).includes("Current activity assignment template has not been verified."));
  assert.ok(text(tree).includes("Source review is incomplete. Activation is locked."));
  assert.equal(button(tree, "Record curriculum decision").props.disabled, true);
  nodes(tree, (node) => node.type === "select" && node.props.name === "action")[0].props.onChange({ target: { value: "withdraw_module" } }); tree = h.render();
  assert.equal(button(tree, "Record curriculum decision").props.disabled, false);
});

test("blank service scope gives a setup action without suggesting approval", async () => {
  const h = harness(async () => ({ ok: true, business, memberId: "member-a", modules: [] }));
  const tree = await h.mount();
  assert.ok(text(tree).includes("service selections in Business settings"));
  assert.ok(text(tree).includes("capabilities in Team"));
  assert.ok(text(tree).includes("An empty list does not approve government program work"));
  assert.equal(button(tree, "Start assessment"), undefined);
});
