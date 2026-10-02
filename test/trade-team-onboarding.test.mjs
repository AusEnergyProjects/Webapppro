import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { teamOnboardingStep } from "../src/lib/trade-team-onboarding.ts";

const now = Date.parse("2026-10-02T00:00:00Z");
const member = { id: "person-a", status: "active", email: "person@example.test", hasLogin: true, invitePending: false };
const trainingModule = { status: "passed", expiresAt: "2027-01-01T00:00:00Z", businessServiceEnabled: true };
const training = { memberId: member.id, officeOnly: false, modules: [trainingModule] };
const step = (person = member, record = training) => teamOnboardingStep(person, record, now);

test("invitation, roster-only and app sign-in states are distinct", () => {
  assert.equal(step({ ...member, hasLogin: false, email: "" }).action, "Add email");
  assert.equal(step({ ...member, hasLogin: false, invitePending: true }).label, "Waiting to join");
  assert.equal(step({ ...member, hasLogin: false }).action, "Set up access");
  assert.equal(step({ ...member, hasLogin: false, lastActiveAt: "2026-10-01T00:00:00Z" }).label, "Training current");
});

test("inactive staff cannot be represented as ready even with a current pass", () => {
  for (const status of ["suspended", "archived"]) assert.equal(step({ ...member, status }).kind, "inactive");
});

test("only office-only records skip installation training", () => {
  assert.equal(step(member, { ...training, officeOnly: true, modules: [] }).label, "Office setup ready");
  assert.equal(step(member, { ...training, modules: [] }).label, "Check service requirements");
});

test("missing or not yet checked training never becomes current", () => {
  const result = teamOnboardingStep(member, undefined, now);
  assert.equal(result.kind, "training");
  assert.equal(result.action, "Check training");
  assert.equal(step(member, { ...training, memberId: "another-person" }).action, "Check training");
});

test("expired, revoked, missing expiry and outstanding modules require review", () => {
  for (const changed of [
    { status: "required" }, { status: "revoked" }, { expiresAt: "2026-09-30T00:00:00Z" }, { expiresAt: "" }, { expiresAt: "invalid" },
  ]) {
    const result = step(member, { ...training, modules: [trainingModule, { ...trainingModule, ...changed }] });
    assert.equal(result.kind, "training");
    assert.match(result.detail, /1 of 2 assigned modules/);
    assert.match(result.detail, /Each person completes their own training/);
  }
});

test("a training pass never asserts job eligibility or enables a disabled business service", () => {
  const result = step();
  assert.equal(result.label, "Training current");
  assert.match(result.detail, /Check licences and job requirements/);
  assert.doesNotMatch(result.label, /ready|eligible/i);
  assert.equal(step(member, { ...training, modules: [{ ...trainingModule, businessServiceEnabled: false }] }).label, "Business setup needed");
});

const source = fs.readFileSync(new URL("../src/components/TradeTeamSettings.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("TradeTeamSettings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let summaryEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('fetch("/api/trade-training"')) summaryEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(summaryEffect);
const script = ts.transpileModule(`(${summaryEffect})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function summaryHarness(fetch, overrides = {}) {
  const pending = new Map();
  const changes = { records: [training], loading: false, error: "previous failure" };
  const context = { AbortController, teamAccess: { canManageTeam: true }, statusFilter: "all", tokenHeaders: async () => ({ Authorization: "Bearer test" }), fetch,
    window: { requestAnimationFrame(callback) { pending.set(1, callback); return 1; }, cancelAnimationFrame(id) { pending.delete(id); } },
    setOnboardingLoading: value => { changes.loading = value; }, setOnboardingError: value => { changes.error = value; }, setOnboardingTraining: value => { changes.records = value; }, ...overrides };
  const cleanup = runInNewContext(script, context);
  return { changes, cleanup, async start() { for (const callback of pending.values()) callback(); pending.clear(); await flush(); } };
}

test("one summary request supplies roster setup and a failed refresh clears stale training", async () => {
  const calls = [];
  const good = summaryHarness(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true, team: [training] }) }; });
  await good.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/trade-training");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(good.changes.records[0].memberId, member.id);
  assert.equal(good.changes.loading, false);
  const failed = summaryHarness(async () => ({ ok: false, json: async () => ({ ok: false, error: "Training unavailable" }) }));
  await failed.start();
  assert.equal(failed.changes.records.length, 0);
  assert.equal(failed.changes.error, "Training unavailable");
  assert.equal(failed.changes.loading, false);
});

test("leaving the workspace cannot apply a late training summary and archived view never requests it", async () => {
  let resolve;
  const delayed = summaryHarness(() => new Promise(done => { resolve = done; }));
  await delayed.start();
  delayed.cleanup();
  resolve({ ok: true, json: async () => ({ ok: true, team: [training] }) });
  await flush();
  assert.equal(delayed.changes.records.length, 0);
  let requested = false;
  const archived = summaryHarness(async () => { requested = true; }, { statusFilter: "archived" });
  await archived.start();
  assert.equal(requested, false);
});
