import assert from "node:assert/strict";
import test from "node:test";
import * as portal from "../src/lib/wattzun-portal.ts";
import { syntheticWorkContext, workContextContract as contract, workContextGateway } from "./helpers/wattzun-work-context-fixture.mjs";

const access = { db: {}, actorUid: "synthetic-actor", scope: { portal: "trade", scopeId: "synthetic-business", label: "Synthetic business" } };
const input = { portal: "trade", scopeId: "synthetic-business", requestId: "synthetic-context-request-01", message: "Summarise this job", history: [], preferences: { speed: 1 } };

test("work references are explicit bounded selections belonging to exactly one portal", () => {
  for (const [reference, selectedPortal] of [
    [{ kind: "trade_job", recordId: "job-one:1" }, "trade"],
    [{ kind: "creditex_audit", recordId: "case-one_1" }, "creditex"],
    ...["quarter", "year", "all"].map(period => [{ kind: "council_report", period }, "council"]),
  ]) {
    assert.deepEqual(contract.readWattzunWorkReference(reference, selectedPortal), reference);
    for (const other of ["trade", "creditex", "council"].filter(value => value !== selectedPortal)) assert.equal(contract.readWattzunWorkReference(reference, other), null);
  }
  for (const invalid of [null, [], "job", {}, { kind: "trade_job", recordId: "" }, { kind: "trade_job", recordId: "../job" },
    { kind: "trade_job", recordId: "x".repeat(181) }, { kind: "trade_job", recordId: "job", facts: { spoofed: true } },
    { kind: "trade_job", recordId: "job", scopeId: "foreign" }, { kind: "council_report", period: "month" }]) {
    assert.equal(contract.readWattzunWorkReference(invalid, "trade"), null);
  }
});

test("turns preserve a valid reference and reject cross-portal or browser-supplied reference facts", () => {
  const reference = syntheticWorkContext().reference;
  assert.deepEqual(portal.parseWattzunTurn({ ...input, workReference: reference }).workReference, reference);
  for (const workReference of [{ kind: "creditex_audit", recordId: "other" }, { ...reference, facts: { permission: "owner" } }, { ...reference, recordId: "../foreign" }]) {
    assert.throws(() => portal.parseWattzunTurn({ ...input, workReference }), portal.WattzunInputError);
  }
  assert.equal(portal.parseWattzunTurn(input).workReference, undefined);
});

test("published context information strips provider facts, source IDs and descriptions", () => {
  const context = syntheticWorkContext(), gateway = workContextGateway();
  const info = gateway.wattzunWorkContextInfo(context);
  assert.deepEqual(Object.keys(info).sort(), ["reference", "title", "sourceSha256", "sources", "limitations"].sort());
  assert.deepEqual(info.sources, context.sources.map(({ label, href }) => ({ label, href })));
  assert.equal(info.facts, undefined);
  assert.doesNotMatch(JSON.stringify(info), /switchboard|operationalStage|trade_job_overview|Recorded job scope/);
  assert.deepEqual(contract.readWattzunWorkContextInfo({ ...info, facts: "PRIVATE_PROVIDER_FACTS" }, "trade"), info);
});

test("context metadata rejects unbounded or foreign navigation before display", () => {
  const info = workContextGateway().wattzunWorkContextInfo(syntheticWorkContext());
  for (const invalid of [
    { ...info, title: "" }, { ...info, title: "x".repeat(241) }, { ...info, sourceSha256: "not-a-hash" },
    { ...info, sources: [] }, { ...info, sources: Array(7).fill(info.sources[0]) },
    { ...info, limitations: Array(9).fill("Limit") }, { ...info, limitations: ["x".repeat(1001)] },
    ...["https://foreign.test", "//foreign.test", "/\\foreign.test", "/council", "/creditex/compliance", "/customer/quote", "/direct-trade/dashboard-other"].map(href => ({ ...info, sources: [{ label: "Source", href }] })),
  ]) assert.equal(contract.readWattzunWorkContextInfo(invalid, "trade"), null);
});

test("the context gateway dispatches only the selected portal reference and validates actual source links", async () => {
  const context = syntheticWorkContext(), calls = [];
  const gateway = workContextGateway({ trade: async (...args) => { calls.push(args); return context; } });
  const request = new Request("https://example.test/api/wattzun/portal");
  assert.equal(await gateway.loadWattzunWorkContext(request, access, context.reference), context);
  assert.deepEqual(calls, [[request, access, context.reference]]);
  await assert.rejects(gateway.loadWattzunWorkContext(request, access, { kind: "creditex_audit", recordId: "private-case" }), error => error.status === 403);
  assert.equal(calls.length, 1);
});

test("source validation rejects mismatched identities, duplicate IDs and foreign or invalid sources", () => {
  const context = syntheticWorkContext(), gateway = workContextGateway();
  assert.doesNotThrow(() => gateway.validateWattzunWorkContext(context, access, context.reference));
  for (const invalid of [
    { ...context, reference: { ...context.reference, recordId: "foreign-job" } },
    { ...context, sources: [context.sources[0], context.sources[0]] },
    { ...context, sources: [{ ...context.sources[0], id: "PRIVATE_unsafe" }] },
    { ...context, sources: [{ ...context.sources[0], description: "" }] },
    { ...context, sources: [{ ...context.sources[0], href: "/council" }] },
  ]) assert.throws(() => gateway.validateWattzunWorkContext(invalid, access, context.reference), error => error.status === 503);
});

test("complete context enforces the UTF8 cap without truncating or rewriting sources", async () => {
  const context = syntheticWorkContext({ facts: { description: "界".repeat(9000) } });
  const gateway = workContextGateway({ trade: async () => context });
  await assert.rejects(gateway.loadWattzunWorkContext(new Request("https://example.test"), access, context.reference), error => error.status === 413);
  assert.equal(context.facts.description.length, 9000);
});
