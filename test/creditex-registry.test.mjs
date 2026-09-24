import assert from "node:assert/strict";
import test from "node:test";
import { fixture, NOW, HASH, author, reviewer, auditor, administrator, accountInput } from "./helpers/creditex-registry-fixture.mjs";

test("AUD input preserves exact cents and rejects floats, signs, exponent notation and invalid precision", t => {
  const { service } = fixture(t);
  assert.equal(service.registryMoneyMinor("0.01"), 1);
  assert.equal(service.registryMoneyMinor("123.4"), 12340);
  assert.equal(service.registryMoneyMinor("10000000000.00"), 1_000_000_000_000);
  for (const value of [12.34, "0", "-1", "+1", "1e2", "1.001", "Infinity", "1,000", "10000000000.01"]) {
    assert.throws(() => service.registryMoneyMinor(value), { code: "REGISTRY_AMOUNT_INVALID" });
  }
});

test("production audit schema accepts authorised platform admin operations", async t => {
  const f = fixture(t), accountId = await f.account(administrator);
  const row = f.sqlite.prepare("SELECT actor_type,actor_uid FROM compliance_audit_events WHERE target_id=?").get(accountId);
  assert.equal(row.actor_uid, "owner");
  assert.ok(["platform", "compliance"].includes(row.actor_type));
});

test("account access enforces governance, organisation, activity scope, authority and exact approval", async t => {
  const f = fixture(t);
  await assert.rejects(f.account(auditor), { code: "REGISTRY_PERMISSION_DENIED" });
  await assert.rejects(f.account({ ...author, actorUid: "operator" }), { code: "REGISTRY_PERMISSION_DENIED" });
  await assert.rejects(f.service.loadRegistryWorkspace(f.db, { ...author, actorUid: "denied" }), { code: "REGISTRY_ACCESS_DENIED" });
  const accountId = await f.account();
  await assert.rejects(f.service.requireRegistryAccount(f.db, { ...author, organisationId: "org-two" }, accountId), { code: "REGISTRY_ACCOUNT_NOT_FOUND" });
  const input = { accountId, packetId: f.packet.id, expectedPacketSha256: HASH };
  await assert.rejects(f.service.attachRegistryAccount(f.db, author, { ...input, expectedPacketSha256: "stale" }, f.options), { code: "REGISTRY_PACKET_CHANGED" });
  f.packet.review.decision = "rejected";
  await assert.rejects(f.service.attachRegistryAccount(f.db, author, input, f.options), { code: "REGISTRY_APPROVAL_REQUIRED" });
  f.packet.review.decision = "approved";
  f.packet.activityTemplateId = "different-activity";
  await assert.rejects(f.service.attachRegistryAccount(f.db, author, input, f.options), { code: "REGISTRY_ACTIVITY_NOT_AUTHORISED" });
  f.packet.activityTemplateId = "veu-test";
  f.sqlite.prepare("UPDATE creditex_registry_accounts SET authority_expires_on='2026-09-23' WHERE id=?").run(accountId);
  await assert.rejects(f.service.attachRegistryAccount(f.db, author, input, f.options), { code: "REGISTRY_ACCOUNT_INACTIVE" });
});

test("account identity is immutable and stale edits fail without success audit", async t => {
  const f = fixture(t), accountId = await f.account();
  const update = { ...accountInput, id: accountId, expectedVersion: 1, financeEmail: "new@example.test" };
  await assert.rejects(f.service.saveRegistryAccount(f.db, author, { ...update, legalName: "Changed entity" }, f.options), { code: "REGISTRY_IDENTITY_IMMUTABLE" });
  await assert.rejects(f.service.saveRegistryAccount(f.db, author, { ...update, expectedVersion: 0 }, f.options), { code: "REGISTRY_ACCOUNT_CHANGED" });
  f.intercept(() => f.sqlite.prepare("UPDATE creditex_registry_accounts SET version=version+1 WHERE id=?").run(accountId));
  await assert.rejects(f.service.saveRegistryAccount(f.db, author, update, f.options), { code: "REGISTRY_ACCOUNT_CHANGED" });
  assert.equal(f.auditCount("registry_account_updated"), 0);
  assert.equal((await f.service.requireRegistryAccount(f.db, author, accountId)).financeEmail, accountInput.financeEmail);
});

test("evidence retains exact bytes, tenant ownership and private download headers", async t => {
  const f = fixture(t), evidenceId = await f.evidence();
  await assert.rejects(f.service.downloadRegistryEvidence(f.db, { ...author, organisationId: "org-two" }, evidenceId, f.options), { code: "REGISTRY_EVIDENCE_NOT_FOUND" });
  const response = await f.service.downloadRegistryEvidence(f.db, auditor, evidenceId, f.options);
  assert.equal(await response.text(), "Synthetic registry receipt");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const row = f.sqlite.prepare("SELECT object_key FROM creditex_registry_evidence WHERE id=?").get(evidenceId);
  f.records.get(row.object_key).bytes = new TextEncoder().encode("Tampered registry receipt").buffer;
  await assert.rejects(f.service.downloadRegistryEvidence(f.db, author, evidenceId, f.options), { code: "REGISTRY_EVIDENCE_INTEGRITY" });
  f.records.delete(row.object_key);
  await assert.rejects(f.service.downloadRegistryEvidence(f.db, author, evidenceId, f.options), { code: "REGISTRY_EVIDENCE_MISSING" });
});

test("a concurrent account change prevents disabling it and leaves no success audit", async t => {
  const f = fixture(t), accountId = await f.account();
  f.intercept(() => f.sqlite.prepare("UPDATE creditex_registry_accounts SET version=version+1 WHERE id=?").run(accountId));
  await assert.rejects(f.service.disableRegistryAccount(f.db, author, { accountId, expectedVersion: 1 }), { code: "REGISTRY_ACCOUNT_CHANGED" });
  assert.equal((await f.service.requireRegistryAccount(f.db, author, accountId)).enabled, true);
  assert.equal(f.auditCount("registry_account_disabled"), 0);
});

test("evidence rejects invalid file payloads before storage", async t => {
  const f = fixture(t);
  for (const file of [new File(["not pdf"], "receipt.pdf"), new File(["{"], "receipt.json"), new File(["<svg/>"], "receipt.svg"), new File([new Uint8Array([255])], "receipt.txt")]) {
    await assert.rejects(f.service.storeRegistryEvidence(f.db, author, file, f.options), { code: "REGISTRY_EVIDENCE_TYPE" });
  }
  await assert.rejects(f.service.storeRegistryEvidence(f.db, author, new File([], "empty.txt"), f.options), { code: "REGISTRY_EVIDENCE_SIZE" });
  assert.equal(f.records.size, 0);
});

test("fee invoice requires lodgement and bound claims, replays exact records, rejects changed duplicates", async t => {
  const f = fixture(t), setup = await f.ready();
  const input = { ...setup, reference: "INV-001", amount: "100.00", dueDate: "2026-10-01", packetIds: [f.packet.id] };
  f.packet.status = "prepared";
  await assert.rejects(f.service.recordRegistryInvoice(f.db, author, input, f.options), { code: "REGISTRY_LODGEMENT_REQUIRED" });
  f.packet.status = "submitted";
  const id = await f.service.recordRegistryInvoice(f.db, author, input, f.options);
  assert.equal(await f.service.recordRegistryInvoice(f.db, author, input, f.options), id);
  await assert.rejects(f.service.recordRegistryInvoice(f.db, author, { ...input, amount: "101" }, f.options), { code: "REGISTRY_INVOICE_CONFLICT" });
  await assert.rejects(f.service.recordRegistryInvoice(f.db, { ...author, organisationId: "org-two" }, input, f.options), { code: "REGISTRY_ACCOUNT_NOT_FOUND" });
  assert.equal(f.auditCount("registry_invoice_recorded"), 1);
});

test("payment evidence has exact replay, bounded balance and never registers certificates", async t => {
  const f = fixture(t), { invoiceId, evidenceId } = await f.invoice();
  const input = { invoiceId, evidenceId, reference: "PAY-001", amount: "40.10", paidAt: NOW };
  const id = await f.service.recordRegistryPayment(f.db, author, input, f.options);
  assert.equal(await f.service.recordRegistryPayment(f.db, author, input, f.options), id);
  await assert.rejects(f.service.recordRegistryPayment(f.db, author, { ...input, amount: "40.11" }, f.options), { code: "REGISTRY_PAYMENT_CONFLICT" });
  await assert.rejects(f.service.recordRegistryPayment(f.db, author, { ...input, reference: "TOO-MUCH", amount: "59.91" }, f.options), { code: "REGISTRY_PAYMENT_EXCEEDS_BALANCE" });
  assert.equal(f.auditCount("registry_payment_evidence_recorded"), 1);
  await f.service.recordRegistryPayment(f.db, author, { ...input, reference: "PAY-002", amount: "59.90" }, f.options);
  const workspace = await f.service.loadRegistryWorkspace(f.db, author);
  assert.equal(workspace.invoices[0].paidMinor, 10000);
  assert.equal(workspace.claims[0].registryStatus, "unconfirmed");
  assert.equal(workspace.claims[0].registeredQuantity, "");
});

test("concurrent payments cannot overpay and do not audit the rejected attempt as saved", async t => {
  const f = fixture(t), { invoiceId, evidenceId } = await f.invoice();
  const input = { invoiceId, evidenceId, amount: "70.00", paidAt: NOW };
  const results = await Promise.allSettled(["ONE", "TWO"].map(reference => f.service.recordRegistryPayment(f.db, author, { ...input, reference }, f.options)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "REGISTRY_PAYMENT_EXCEEDS_BALANCE");
  assert.equal(f.sqlite.prepare("SELECT SUM(amount_minor) amount FROM creditex_registry_payments").get().amount, 7000);
  assert.equal(f.auditCount("registry_payment_evidence_recorded"), 1);
});

test("concurrent duplicate payment clicks return the same retained receipt", async t => {
  const f = fixture(t), { invoiceId, evidenceId } = await f.invoice();
  const input = { invoiceId, evidenceId, amount: "40.00", paidAt: NOW, reference: "ONE" };
  const results = await Promise.all([1, 2].map(() => f.service.recordRegistryPayment(f.db, author, input, f.options)));
  assert.equal(results[0], results[1]);
  assert.equal(f.auditCount("registry_payment_evidence_recorded"), 1);
});

test("result evidence requires exact reference, quantity, date and independent approval", async t => {
  const f = fixture(t), { accountId, evidenceId } = await f.ready();
  const input = { accountId, evidenceId, packetId: f.packet.id, expectedPacketSha256: HASH, externalReference: f.packet.providerReference, registryStatus: "registered", quantity: "10", occurredAt: "2026-09-23T01:00:00.000Z", note: "Original registry confirmation checked." };
  await assert.rejects(f.service.recordRegistryResult(f.db, author, { ...input, externalReference: "WRONG" }, f.options), { code: "REGISTRY_REFERENCE_MISMATCH" });
  await assert.rejects(f.service.recordRegistryResult(f.db, author, { ...input, quantity: "11" }, f.options), { code: "REGISTRY_QUANTITY_MISMATCH" });
  await assert.rejects(f.service.recordRegistryResult(f.db, author, { ...input, occurredAt: "2027-01-01T00:00:00Z" }, f.options), { code: "REGISTRY_DATE_INVALID" });
  const resultId = await f.service.recordRegistryResult(f.db, author, input, f.options);
  assert.equal((await f.service.loadRegistryWorkspace(f.db, author)).claims[0].registryStatus, "unconfirmed");
  await assert.rejects(f.service.reviewRegistryResult(f.db, author, { resultId, decision: "approved", note: "Self review" }, f.options), { code: "REGISTRY_INDEPENDENT_REVIEW_REQUIRED" });
  await assert.rejects(f.service.reviewRegistryResult(f.db, auditor, { resultId, decision: "approved", note: "Read only" }, f.options), { code: "REGISTRY_PERMISSION_DENIED" });
  await assert.rejects(f.service.reviewRegistryResult(f.db, { ...reviewer, organisationId: "org-two" }, { resultId, decision: "approved", note: "Wrong tenant" }, f.options), { code: "REGISTRY_RESULT_NOT_FOUND" });
  await f.service.reviewRegistryResult(f.db, reviewer, { resultId, decision: "approved", note: "Verified the original registry document and quantity." }, f.options);
  const workspace = await f.service.loadRegistryWorkspace(f.db, reviewer);
  assert.equal(workspace.claims[0].registryStatus, "registered");
  assert.equal(workspace.claims[0].registeredQuantity, "10");
  await assert.rejects(f.service.reviewRegistryResult(f.db, reviewer, { resultId, decision: "rejected", note: "Second review" }, f.options), { code: "REGISTRY_ALREADY_REVIEWED" });
});

test("a late imported older result cannot regress a newer approved registry event", async t => {
  const f = fixture(t), { accountId, evidenceId } = await f.ready();
  const input = { accountId, evidenceId, packetId: f.packet.id, expectedPacketSha256: HASH, externalReference: f.packet.providerReference, note: "Original regulator record." };
  for (const event of [{ registryStatus: "registered", quantity: "10", occurredAt: "2026-09-23T00:00:00Z" }, { registryStatus: "assessment", quantity: "", occurredAt: "2026-09-22T00:00:00Z" }]) {
    const resultId = await f.service.recordRegistryResult(f.db, author, { ...input, ...event }, f.options);
    await f.service.reviewRegistryResult(f.db, reviewer, { resultId, decision: "approved", note: "Verified original." }, f.options);
  }
  assert.equal((await f.service.loadRegistryWorkspace(f.db, reviewer)).claims[0].registryStatus, "registered");
  const empty = await f.service.loadRegistryWorkspace(f.db, { ...author, organisationId: "org-two" });
  assert.deepEqual([empty.accounts, empty.claims, empty.invoices, empty.payments, empty.results], [[], [], [], [], []]);
});

test("registration approval requires the retained original evidence to exist and match its hash", async t => {
  for (const failure of ["missing", "corrupt"]) {
    const f = fixture(t), { accountId, evidenceId } = await f.ready();
    const resultId = await f.service.recordRegistryResult(f.db, author, {
      accountId, evidenceId, packetId: f.packet.id, expectedPacketSha256: HASH,
      externalReference: f.packet.providerReference, registryStatus: "registered", quantity: "10",
      occurredAt: "2026-09-23T01:00:00Z", note: "Original registry confirmation.",
    }, f.options);
    if (failure === "missing") f.records.clear();
    else {
      const row = f.sqlite.prepare("SELECT object_key FROM creditex_registry_evidence WHERE id=?").get(evidenceId);
      f.records.get(row.object_key).bytes = new TextEncoder().encode("Substituted registry confirmation").buffer;
    }
    await assert.rejects(f.service.reviewRegistryResult(f.db, reviewer, {
      resultId, decision: "approved", note: "Independent confirmation attempted.",
    }, f.options), { code: failure === "missing" ? "REGISTRY_EVIDENCE_MISSING" : "REGISTRY_EVIDENCE_INTEGRITY" });
    assert.equal(f.auditCount("registry_result_reviewed"), 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_result_reviews").get().n, 0);
    assert.equal((await f.service.loadRegistryWorkspace(f.db, reviewer)).claims[0].registryStatus, "unconfirmed");
  }
});

test("bounded review history cannot displace the current approved registration", async t => {
  const f = fixture(t), { accountId, evidenceId } = await f.ready();
  const input = {
    accountId, evidenceId, packetId: f.packet.id, expectedPacketSha256: HASH,
    externalReference: f.packet.providerReference, registryStatus: "registered", quantity: "10",
    occurredAt: "2026-09-23T01:00:00Z", note: "Original confirmed registration.",
  };
  const resultId = await f.service.recordRegistryResult(f.db, author, input, f.options);
  await f.service.reviewRegistryResult(f.db, reviewer, {
    resultId, decision: "approved", note: "Verified exact original confirmation.",
  }, f.options);
  for (let index = 0; index < 3000; index++) {
    await f.service.recordRegistryResult(f.db, author, {
      ...input, registryStatus: "assessment", occurredAt: NOW, note: `Pending supplementary outcome ${index}`,
    }, f.options);
  }
  const workspace = await f.service.loadRegistryWorkspace(f.db, reviewer);
  assert.equal(workspace.results.length, 3000);
  assert.equal(workspace.results.some(result => result.id === resultId), false);
  assert.equal(workspace.claims[0].registryStatus, "registered");
  assert.equal(workspace.claims[0].registeredQuantity, "10");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_result_reviews WHERE decision='approved'").get().n, 1);
});
