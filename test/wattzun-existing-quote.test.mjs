import test from "node:test";
import assert from "node:assert/strict";
import { prepareWattzunExistingQuote, executeWattzunExistingQuote, WattzunExistingQuoteError } from "../src/lib/wattzun-existing-quote-server.ts";
import { normaliseTradeQuoteLineGroup, OVERALL_PERCENT_DISCOUNT_SECTION, OVERALL_FIXED_DISCOUNT_SECTION } from "../src/lib/trade-quote.ts";

const request = () => new Request("https://tlink.test/api/wattzun/workflow", { headers: { Origin: "https://tlink.test", Authorization: "Bearer synthetic", "X-TLink-Business": "business-a" } });
const proposal = (overrides = {}) => ({ kind: "draft_job_quote", jobQuery: "Frankston job", jobId: "job-a", mode: "append", description: "Install confirmed additional work", lines: [{ lineType: "labour", description: "Additional installation", quantity: "2", unitPrice: "50", taxCode: "gst" }], ...overrides });
const actor = { scopeId: "business-a", actorUid: "actor-a" };
function savedLines(raw) {
  const calculated = normaliseTradeQuoteLineGroup(raw, String);
  return calculated.lines.map((item, index) => ({ id: `line-${index}`, position: index + 1, ...item,
    priceBookItemId: raw[index].priceBookItemId || "", priceBookItemType: raw[index].priceBookItemId ? "product" : "",
    jobPacketId: raw[index].jobPacketId || "", jobPacketLineId: raw[index].jobPacketLineId || "", jobPacketRevision: raw[index].jobPacketId ? 3 : 0,
    sectionHeading: raw[index].sectionHeading || "Included work", quoteChoiceId: "", unitCostCentsExGst: raw[index].priceBookItemId ? 4000 : 0, marginBasisPoints: raw[index].priceBookItemId ? 6000 : 0 }));
}
function fixture(options = {}) {
  const raw = options.lines || [
    { lineType: "product", description: "Saved panel", quantity: "1", unitPrice: "100", taxCode: "gst", priceBookItemId: "price-a", jobPacketId: "packet-a", jobPacketLineId: "packet-line-a", sectionHeading: "Included work" },
    { lineType: "adjustment", description: "Agreed rebate", quantity: "1", unitPrice: "-5", taxCode: "gst", sectionHeading: "Rebates" },
    { lineType: "adjustment", description: "Existing discount", quantity: "1", unitPrice: "5", taxCode: "gst", sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION },
    { lineType: "adjustment", description: "Loyalty discount", quantity: "percent:10", unitPrice: "0", taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION },
  ];
  const choice = { id: "choice-id", clientKey: "addon-a", kind: "addon", groupKey: "addon-a", name: "Optional monitor", summary: "Keep existing choice", recommended: false,
    items: savedLines([{ lineType: "product", description: "Monitor", quantity: "1", unitPrice: "25", taxCode: "gst", sectionHeading: "Optional" }]) };
  const version = { id: "draft-a", versionNumber: 1, status: "draft", updatedAt: "2026-10-07T10:00:00.000Z",
    customerEmail: "recipient@example.test", terms: "Agreed payment terms", customerMessage: "Agreed greeting", validUntil: "2026-11-01",
    equipment: { common: [], choices: [] }, designId: "design-a", roofImage: { sha256: "a".repeat(64), contentType: "image/png", width: 400, height: 400 }, items: savedLines(raw), choices: [choice] };
  const payload = { ok: true, access: { canManageQuotes: true, canViewPriceBook: true },
    job: { customerId: "customer-a", workNumber: "JOB-123", customerName: "John Smith", siteSummary: "12 Fake Street, Frankston VIC 3199", publicLead: false },
    business: { quoteDefaultTerms: "Default terms", quoteEmailIntro: "Default greeting" }, authorisedEmails: ["recipient@example.test", "other@example.test"],
    priceBookItems: [{ id: "price-a", itemType: "product", lineType: "product", name: "Saved panel", description: "Saved panel", sellPriceCentsExGst: 10000, taxCode: "gst", unitCostCentsExGst: 4000, marginBasisPoints: 6000 }],
    jobPackets: [{ id: "packet-a", revision: 3, lines: [{ id: "packet-line-a", priceBookItemId: "price-a" }] }],
    quote: options.noQuote ? null : { id: "quote-a", workOrderId: "job-a", customerId: "customer-a", status: options.status || "draft", currentVersionNumber: 1,
      editableDraft: { id: "draft-a", versionNumber: 1, updatedAt: version.updatedAt }, versions: [version] } };
  const team = { ownerUid: "business-a", actorUid: "actor-a", memberId: "member-a", isOwner: false, jobScope: "own",
    canViewQuotes: true, canManageQuotes: true, canViewPriceBook: true, canApplyDiscounts: true };
  let saves = 0; let gets = 0; let lostAck = false; let denied = false; let savedPayload;
  const deps = {
    team: async incoming => { assert.equal(incoming.headers.get("X-TLink-Business"), "business-a"); return { ...team }; },
    getQuote: async incoming => {
      assert.equal(incoming.method, "GET"); assert.equal(incoming.headers.get("Authorization"), "Bearer synthetic");
      assert.equal(new URL(incoming.url).searchParams.get("workOrderId"), "job-a"); gets++;
      return denied ? Response.json({ ok: false, error: "Job assignment ended." }, { status: 403 }) : Response.json(structuredClone(payload));
    },
    saveQuote: async incoming => {
      assert.equal(incoming.method, "POST"); assert.equal(incoming.headers.get("X-TLink-Business"), "business-a");
      assert.equal(incoming.headers.get("Origin"), "https://tlink.test"); savedPayload = await incoming.json();
      if (payload.quote && (savedPayload.expectedVersionId !== payload.quote.editableDraft.id || savedPayload.expectedUpdatedAt !== payload.quote.editableDraft.updatedAt)) return Response.json({ ok: false, error: "Revision conflict" }, { status: 409 });
      saves++;
      const current = payload.quote?.versions[0];
      const next = { ...version, ...current, id: current?.id || "new-draft-a", updatedAt: `2026-10-07T10:00:0${saves}.000Z`,
        customerEmail: savedPayload.customerEmail, terms: savedPayload.terms, customerMessage: savedPayload.customerMessage, validUntil: savedPayload.validUntil,
        equipment: savedPayload.equipment, designId: savedPayload.designId, roofImage: current?.roofImage || null,
        items: savedLines(savedPayload.lines), choices: savedPayload.choices.map((entry, index) => ({ ...entry, id: `resaved-choice-${index}`, items: savedLines(entry.lines) })) };
      payload.quote = { id: payload.quote?.id || "new-quote-a", workOrderId: "job-a", customerId: "customer-a", status: "draft", currentVersionNumber: 1,
        editableDraft: { id: next.id, versionNumber: 1, updatedAt: next.updatedAt }, versions: [next] };
      if (lostAck) { lostAck = false; throw new Error("Synthetic saved response was lost"); }
      return Response.json({ ok: true, quote: structuredClone(payload.quote) });
    },
  };
  return { deps, payload, team, get saves() { return saves; }, get gets() { return gets; }, get savedPayload() { return savedPayload; }, loseAck() { lostAck = true; }, revokeAssignment() { denied = true; } };
}
async function prepare(f, value = proposal()) { return prepareWattzunExistingQuote(request(), { ...actor, proposal: value }, f.deps); }
async function execute(f, prepared, extra = {}) { return executeWattzunExistingQuote(request(), { ...actor, prepared, expectedSourceSha256: prepared.sourceSha256, ...extra }, f.deps); }

test("append prepares the same real job and conserves recipients, terms, choices, discounts, roof, design and packet references", async () => {
  const f = fixture(); const before = structuredClone(f.payload.quote.versions[0]); const prepared = await prepare(f);
  assert.equal(f.saves, 0); assert.equal(prepared.savePayload.workOrderId, "job-a");
  assert.equal(prepared.savePayload.expectedVersionId, "draft-a"); assert.equal(prepared.savePayload.expectedUpdatedAt, before.updatedAt);
  assert.equal(prepared.savePayload.customerEmail, before.customerEmail); assert.equal(prepared.savePayload.terms, before.terms);
  assert.equal(prepared.savePayload.customerMessage, before.customerMessage); assert.equal(prepared.savePayload.validUntil, before.validUntil);
  assert.equal(prepared.savePayload.designId, before.designId); assert.deepEqual(prepared.savePayload.equipment, before.equipment);
  assert.equal(prepared.original.roofImageSha256, "a".repeat(64)); assert.equal(Object.hasOwn(prepared.savePayload, "roofImage"), false);
  assert.equal(Object.hasOwn(prepared.savePayload, "saveAsBusinessDefault"), false);
  assert.equal(prepared.savePayload.lines[0].priceBookItemId, "price-a"); assert.equal(prepared.savePayload.lines[0].jobPacketLineId, "packet-line-a");
  assert.equal(prepared.savePayload.lines.at(-1).sectionHeading, OVERALL_PERCENT_DISCOUNT_SECTION);
  assert.equal(prepared.savePayload.lines.at(-2).description, "Additional installation"); assert.equal(prepared.savePayload.lines.at(-2).unitPrice, "50.00");
  assert.equal(prepared.savePayload.lines[2].unitPrice, "5.00"); assert.equal(prepared.savePayload.choices[0].name, before.choices[0].name);
  const receipt = await execute(f, prepared); assert.equal(f.saves, 1); assert.equal(receipt.id, "quote-a"); assert.equal(receipt.workOrderId, "job-a"); assert.equal(receipt.versionId, "draft-a");
  assert.equal(receipt.href, "/direct-trade/team?workspace=work&jobId=job-a&jobTab=quote");
  assert.equal(f.payload.quote.versions[0].roofImage.sha256, before.roofImage.sha256); assert.equal(f.payload.quote.versions[0].items.length, before.items.length + 1);
});

test("exact replay reconciles a saved draft without appending again", async () => {
  const f = fixture(); const prepared = await prepare(f); const first = await execute(f, prepared); const second = await execute(f, prepared);
  assert.deepEqual(second, first); assert.equal(f.saves, 1); assert.equal(f.payload.quote.versions[0].items.filter(item => item.description === "Additional installation").length, 1);
});
test("lost acknowledgement retries reconcile frozen target instead of duplicating lines", async () => {
  const f = fixture(); const prepared = await prepare(f); f.loseAck(); await assert.rejects(execute(f, prepared), /saved response was lost/);
  const receipt = await execute(f, prepared); assert.equal(receipt.versionId, "draft-a"); assert.equal(f.saves, 1);
});

test("expired review recovery reads a saved target without initiating another save", async () => {
  const f = fixture(), prepared = await prepare(f);
  await assert.rejects(execute(f, prepared, { allowSave: false }), error => error.status === 409);
  assert.equal(f.saves, 0);
  f.loseAck(); await assert.rejects(execute(f, prepared), /response was lost/);
  const receipt = await execute(f, prepared, { allowSave: false });
  assert.equal(receipt.kind, 'quote_draft'); assert.equal(f.saves, 1);
  f.payload.quote.versions[0].terms = 'A newer unrelated edit';
  await assert.rejects(execute(f, prepared, { allowSave: false }), error => error.status === 409);
  assert.equal(f.saves, 1);
});
test("replace changes included items while preserving unsupplied discounts and choices", async () => {
  const f = fixture(); const prepared = await prepare(f, proposal({ mode: "replace" }));
  assert.equal(prepared.savePayload.lines.some(item => item.description === "Saved panel"), false);
  for (const label of ["Agreed rebate", "Existing discount", "Loyalty discount"]) assert.equal(prepared.savePayload.lines.some(item => item.description === label), true);
  assert.equal(prepared.savePayload.choices.length, 1); await execute(f, prepared); assert.equal(f.saves, 1);
});
test("existing job without a quote gets its first draft through the quote service, never a new job", async () => {
  const f = fixture({ noQuote: true }); const prepared = await prepare(f);
  assert.equal(prepared.savePayload.expectedVersionId, ""); assert.equal(prepared.savePayload.expectedUpdatedAt, "");
  assert.equal(prepared.savePayload.terms, "Default terms"); assert.equal(prepared.savePayload.customerMessage, "Default greeting");
  const receipt = await execute(f, prepared); assert.equal(receipt.workOrderId, "job-a"); assert.equal(receipt.id, "new-quote-a"); assert.equal(receipt.versionId, "new-draft-a");
  await execute(f, prepared); assert.equal(f.saves, 1);
});
test("unknown quantity, price or GST requires relevant details without reading or changing records", async t => {
  for (const field of ["quantity", "unitPrice", "taxCode"]) await t.test(field, async () => {
    const f = fixture(); const value = proposal(); value.lines[0][field] = null;
    await assert.rejects(prepare(f, value), error => error instanceof WattzunExistingQuoteError && error.status === 400 && /Please confirm line 1/.test(error.message));
    assert.equal(f.gets, 0); assert.equal(f.saves, 0);
  });
});
test("invalid negative prices and missing included lines fail rather than inventing values", async () => {
  const f = fixture(); await assert.rejects(prepare(f, proposal({ lines: [] })), error => error.status === 400);
  const value = proposal(); value.lines[0].unitPrice = "-10"; await assert.rejects(prepare(f, value), error => error.status === 400); assert.equal(f.saves, 0);
});
test("issued, accepted, declined and issuing quotes cannot be silently revised", async t => {
  for (const status of ["issued", "accepted", "declined", "issuing"]) await t.test(status, async () => {
    const f = fixture({ status }); await assert.rejects(prepare(f), error => error.status === 409 && /explicitly start a revision/.test(error.message)); assert.equal(f.saves, 0);
  });
});
test("stale quote terms or saved revision block overwrite", async t => {
  for (const changed of ["terms", "updatedAt"]) await t.test(changed, async () => {
    const f = fixture(); const prepared = await prepare(f); f.payload.quote.versions[0][changed] = "changed";
    if (changed === "updatedAt") f.payload.quote.editableDraft.updatedAt = "changed";
    await assert.rejects(execute(f, prepared), error => error.status === 409); assert.equal(f.saves, 0);
  });
});
test("current assignment and quote grants are authoritative on prepare and execution", async () => {
  const f = fixture(); const prepared = await prepare(f); f.revokeAssignment(); await assert.rejects(execute(f, prepared), error => error.status === 403); assert.equal(f.saves, 0);
  const g = fixture(); g.team.canManageQuotes = false; await assert.rejects(prepare(g), error => error.status === 403); assert.equal(g.gets, 0);
});
test("actor and business switches or altered role cannot replay a prepared review", async () => {
  const f = fixture(); const prepared = await prepare(f); f.team.actorUid = "other-actor";
  await assert.rejects(execute(f, prepared), error => error.status === 403); assert.equal(f.saves, 0);
  const g = fixture(); const other = await prepare(g); g.team.memberId = "other-member";
  await assert.rejects(execute(g, other), error => error.status === 403); assert.equal(g.saves, 0);
  const h = fixture(); h.team.ownerUid = "business-b"; await assert.rejects(prepare(h), error => error.status === 403); assert.equal(h.saves, 0);
});
test("changed customer or foreign quote job cannot be edited", async t => {
  for (const field of ["customerId", "workOrderId"]) await t.test(field, async () => {
    const f = fixture(); f.payload.quote[field] = "other-record"; await assert.rejects(prepare(f), error => error.status === 409); assert.equal(f.saves, 0);
  });
});
test("changed price book values or packet revision require editor review without silently repricing", async t => {
  for (const change of ["price", "cost", "margin", "type", "packet", "removed"]) await t.test(change, async () => {
    const f = fixture(); if (change === "price") f.payload.priceBookItems[0].sellPriceCentsExGst = 12000;
    if (change === "cost") f.payload.priceBookItems[0].unitCostCentsExGst = 5000;
    if (change === "margin") f.payload.priceBookItems[0].marginBasisPoints = 4000;
    if (change === "type") f.payload.priceBookItems[0].itemType = "material";
    if (change === "packet") f.payload.jobPackets[0].revision = 4;
    if (change === "removed") f.payload.priceBookItems = [];
    await assert.rejects(prepare(f), error => error.status === 409); assert.equal(f.saves, 0);
  });
});
test("catalogue change after prepare and lost-ack draft changed by another user cannot be overwritten", async () => {
  const f = fixture(); const prepared = await prepare(f); f.payload.priceBookItems[0].unitCostCentsExGst = 5000;
  await assert.rejects(execute(f, prepared), error => error.status === 409); assert.equal(f.saves, 0);
  const g = fixture(); const other = await prepare(g); await execute(g, other); g.payload.quote.versions[0].customerMessage = "User edited after save";
  await assert.rejects(execute(g, other), error => error.status === 409); assert.equal(g.saves, 1);
});
test("aborted review and different source fingerprint never call the save service", async () => {
  const f = fixture(); const prepared = await prepare(f);
  await assert.rejects(execute(f, prepared, { expectedSourceSha256: "b".repeat(64) }), error => error.status === 409);
  const controller = new AbortController(); controller.abort(); const incoming = new Request(request(), { signal: controller.signal });
  await assert.rejects(executeWattzunExistingQuote(incoming, { ...actor, prepared, expectedSourceSha256: prepared.sourceSha256 }, f.deps), error => error.status === 409); assert.equal(f.saves, 0);
});
