import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as formats from "../src/lib/creditex-registry-formats.ts";
import * as preflight from "../src/lib/creditex-interchange-preflight.ts";
import * as registry from "../src/lib/creditex-registry.ts";
import { fixture, HASH, author, reviewer, auditor, accountInput } from "./helpers/creditex-registry-fixture.mjs";

function exportFixture(t) {
  const f = fixture(t);
  f.packet.programCode = "NSW-ESS";
  f.packet.activityTemplateId = "nsw-d16";
  f.packet.status = "prepared";
  f.packet.providerReference = "";
  const format = formats.listRegistryFormats().find(item => item.key === "nsw_esc");
  const row = {
    "ACP Implementation Identifier": f.packet.id, "Implementation Date": "01/08/2026",
    "Address Line 2 ( Street No , Street Name )": "10 TEST ST", Suburb: "SYDNEY", State: "NSW", Postcode: "2000",
    "End-User Business Classification": "Residential", "End-Use Service": "Air heating and cooling", "Purchase Cost (Excluding GST)": "500.00",
    "ESS Activity Definition": "D16", "Calculation Method": "Deemed Energy Savings Method - Home Energy Efficiency Retrofits",
    "Number of units installed": "1", "Product Brand": "Example", "Product Model Number": "Model", Refrigerant: "R32", "New or Replacement": "New",
    "Electricity Savings (MWh)": "10.00", "Regional Network Factor": "1", "Version of the Rule": "01/07/2026",
    "Company or individual responsible for work at site": "Example Pty Ltd", "Electrician licence": "123456", "Multi split system": "No",
  };
  const serialized = formats.serializeRegistryRows("nsw_esc", [row]);
  assert.equal(serialized.valid, true, JSON.stringify(serialized.issues));
  let evidenceAvailable = true;
  let evidenceChecks = 0;
  let dispatchIntent = null;
  const dependencies = {
    "./creditex-interchange-preflight": preflight,
    "./creditex-registry-formats": formats,
    "./creditex-registry": registry,
    "./creditex-registry-server": f.service,
    "./creditex-output-action-server": { async loadCreditexOutputDispatchIntent(database, actor, packetId) {
      assert.equal(database, f.db);
      assert.equal(actor.organisationId, author.organisationId);
      assert.equal(packetId, f.packet.id);
      return dispatchIntent;
    }, async recheckOutputDispatchEvidence() {
      evidenceChecks++;
      if (!evidenceAvailable) throw Object.assign(new Error("Current source approval withdrawn"), { code: "OUTPUT_ACTION_EVIDENCE_CHANGED" });
    } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/creditex-registry-exports.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, moduleRecord, moduleRecord.exports);
  const exports = moduleRecord.exports;
  return { ...f, exports, format, row, csv: serialized.csv,
    revokeEvidence() { evidenceAvailable = false; },
    reserveDispatch(status) { dispatchIntent = { id: "retained-dispatch", status }; },
    evidenceChecks() { return evidenceChecks; },
    async setup() {
      const accountId = await f.account(author, { scheme: "nsw_esc", activityScope: ["nsw-d16"] });
      await f.service.attachRegistryAccount(f.db, author, { accountId, packetId: f.packet.id, expectedPacketSha256: HASH }, f.options);
      return { accountId, formatKey: "nsw_esc", packetIds: [f.packet.id], baseVintage: "2026", csv: serialized.csv };
    },
    async prepare() {
      const input = await this.setup();
      const exportId = await exports.prepareRegistryExport(f.db, author, input, f.options);
      return { input, exportId };
    },
    async approve(exportId) { return exports.reviewRegistryExport(f.db, reviewer, { exportId, decision: "approved", note: "Exact rows, evidence, calculation and current rules independently verified." }, f.options); },
    tamper(exportId) {
      const row = f.sqlite.prepare("SELECT evidence.object_key FROM creditex_registry_exports output JOIN creditex_registry_evidence evidence ON evidence.id=output.evidence_id WHERE output.id=?").get(exportId);
      f.records.get(row.object_key).bytes = new TextEncoder().encode("Tampered retained export").buffer;
    },
  };
}

test("official templates bind exact headers and claim references without inventing scheme data", async t => {
  const f = exportFixture(t), input = await f.setup();
  const csv = await f.exports.registryExportTemplate(f.db, author, input, f.options);
  const { rows } = preflight.analyseCreditexCsv(csv);
  assert.deepEqual(rows[0], f.format.headers);
  assert.equal(rows[1][f.format.headers.indexOf(f.format.referenceField)], f.packet.id);
  assert.equal(rows[1].filter(Boolean).length, 1);
  await assert.rejects(f.exports.registryExportTemplate(f.db, auditor, input, f.options), { code: "REGISTRY_PERMISSION_DENIED" });
  f.packet.status = "submitted";
  f.packet.providerReference = "EXTERNAL-ONE";
  await assert.rejects(f.exports.registryExportTemplate(f.db, author, input, f.options), { code: "REGISTRY_EXPORT_NOT_READY" });
});

test("export preparation rejects changed headers, unknown rows, invalid values and wrong batch vintage", async t => {
  const f = exportFixture(t), input = await f.setup();
  await assert.rejects(f.exports.prepareRegistryExport(f.db, author, { ...input, csv: input.csv.replace("ACP Implementation Identifier", "Wrong header") }, f.options), { code: "REGISTRY_EXPORT_HEADER" });
  await assert.rejects(f.exports.prepareRegistryExport(f.db, author, { ...input, csv: input.csv.replace(f.packet.id, "another-claim") }, f.options), { code: "REGISTRY_EXPORT_REFERENCE" });
  await assert.rejects(f.exports.prepareRegistryExport(f.db, author, { ...input, csv: input.csv.replace("01/08/2026", "31/02/2026") }, f.options), { code: "REGISTRY_EXPORT_INVALID" });
  await assert.rejects(f.exports.prepareRegistryExport(f.db, author, { ...input, baseVintage: "2025" }, f.options), { code: "REGISTRY_EXPORT_VINTAGE" });
  await assert.rejects(f.exports.prepareRegistryExport(f.db, author, { ...input, packetIds: [f.packet.id, f.packet.id] }, f.options), { code: "REGISTRY_EXPORT_CLAIMS" });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_exports").get().n, 0);
  assert.equal(f.records.size, 0);
});

test("reserved dispatches cannot create another registry template or submission file", async t => {
  for (const status of ["dispatching", "uncertain", "completed"]) {
    const f = exportFixture(t), input = await f.setup();
    f.reserveDispatch(status);
    await assert.rejects(f.exports.registryExportTemplate(f.db, author, input, f.options), { code: "REGISTRY_EXPORT_DISPATCH_RESERVED" });
    await assert.rejects(f.exports.prepareRegistryExport(f.db, author, input, f.options), { code: "REGISTRY_EXPORT_DISPATCH_RESERVED" });
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_exports").get().n, 0);
    assert.equal(f.records.size, 0);
    assert.equal(f.evidenceChecks(), 0);
  }
});

test("a reserved dispatch blocks approval and approved-file download while retained previews remain readable", async t => {
  for (const status of ["dispatching", "uncertain", "completed"]) {
    const f = exportFixture(t), { input, exportId } = await f.prepare();
    await f.approve(exportId);
    f.reserveDispatch(status);
    await assert.rejects(f.exports.prepareRegistryExport(f.db, author, input, f.options), { code: "REGISTRY_EXPORT_DISPATCH_RESERVED" });
    await assert.rejects(f.exports.downloadRegistryExport(f.db, author, exportId, f.options), { code: "REGISTRY_EXPORT_DISPATCH_RESERVED" });
    const preview = await f.exports.previewRegistryExport(f.db, reviewer, exportId, f.options);
    assert.equal(preview.reviewStatus, "approved");
    assert.equal(preview.rows[0][0], f.packet.id);
    assert.equal(f.auditCount("registry_export_prepared"), 1);
    assert.equal(f.auditCount("registry_export_reviewed"), 1);

    const pending = exportFixture(t), prepared = await pending.prepare();
    pending.reserveDispatch(status);
    await assert.rejects(pending.approve(prepared.exportId), { code: "REGISTRY_EXPORT_DISPATCH_RESERVED" });
    assert.equal(pending.auditCount("registry_export_reviewed"), 0);
  }
});

test("prepared exports replay exactly, permit review preview, and require independent approval before download", async t => {
  const f = exportFixture(t), { input, exportId } = await f.prepare();
  assert.equal(await f.exports.prepareRegistryExport(f.db, author, input, f.options), exportId);
  assert.equal(f.auditCount("registry_export_prepared"), 1);
  const preview = await f.exports.previewRegistryExport(f.db, reviewer, exportId, f.options);
  assert.equal(preview.reviewStatus, "pending");
  assert.equal(preview.rows[0][0], f.packet.id);
  await assert.rejects(f.exports.downloadRegistryExport(f.db, author, exportId, f.options), { code: "REGISTRY_EXPORT_APPROVAL_REQUIRED" });
  await assert.rejects(f.exports.reviewRegistryExport(f.db, author, { exportId, decision: "approved", note: "Self approval" }, f.options), { code: "REGISTRY_INDEPENDENT_REVIEW_REQUIRED" });
  await assert.rejects(f.exports.reviewRegistryExport(f.db, auditor, { exportId, decision: "approved", note: "Read only" }, f.options), { code: "REGISTRY_PERMISSION_DENIED" });
  await f.approve(exportId);
  const response = await f.exports.downloadRegistryExport(f.db, author, exportId, f.options);
  assert.equal(await response.text(), f.csv);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(f.evidenceChecks(), 4);
  await assert.rejects(f.approve(exportId), { code: "REGISTRY_ALREADY_REVIEWED" });
});

test("account revision changes invalidate approval and download of an earlier export", async t => {
  const f = exportFixture(t), { input, exportId } = await f.prepare();
  await f.approve(exportId);
  await f.service.saveRegistryAccount(f.db, author, { ...accountInput, id: input.accountId, expectedVersion: 1, scheme: "nsw_esc", activityScope: ["nsw-d16"], resultsEmail: "updated@example.test" }, f.options);
  await assert.rejects(f.exports.downloadRegistryExport(f.db, author, exportId, f.options), { code: "REGISTRY_EXPORT_CHANGED" });
  const secondId = await f.exports.prepareRegistryExport(f.db, author, input, f.options);
  assert.notEqual(secondId, exportId);
  assert.equal((await f.exports.listRegistryExports(f.db, reviewer)).find(row => row.id === secondId).reviewStatus, "pending");
});

test("concurrent identical export preparation retains one file record with exact original bytes", async t => {
  const f = exportFixture(t), input = await f.setup();
  const ids = await Promise.all([1, 2].map(() => f.exports.prepareRegistryExport(f.db, author, input, f.options)));
  assert.equal(ids[0], ids[1]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_exports").get().n, 1);
  assert.equal(f.auditCount("registry_export_prepared"), 1);
  const row = f.sqlite.prepare("SELECT evidence_id FROM creditex_registry_exports WHERE id=?").get(ids[0]);
  const original = await f.service.downloadRegistryEvidence(f.db, reviewer, row.evidence_id, f.options);
  assert.equal(await original.text(), f.csv);
  await f.approve(ids[0]);
  assert.equal(await (await f.exports.downloadRegistryExport(f.db, author, ids[0], f.options)).text(), f.csv);
});

test("concurrent export reviews cannot replace the first independent decision", async t => {
  const f = exportFixture(t), { exportId } = await f.prepare();
  const results = await Promise.allSettled(["approved", "rejected"].map(decision =>
    f.exports.reviewRegistryExport(f.db, reviewer, { exportId, decision, note: "Independent row and evidence review." }, f.options)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "REGISTRY_ALREADY_REVIEWED");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_export_reviews").get().n, 1);
  assert.equal(f.auditCount("registry_export_reviewed"), 1);
  const savedDecision = f.sqlite.prepare("SELECT decision FROM creditex_registry_export_reviews WHERE export_id=?").get(exportId).decision;
  assert.equal(savedDecision, results[0].status === "fulfilled" ? "approved" : "rejected");
});

test("withdrawn governed source approval blocks export preparation, review and approved download", async t => {
  const f = exportFixture(t), { input, exportId } = await f.prepare();
  await f.approve(exportId);
  f.revokeEvidence();
  await assert.rejects(f.exports.prepareRegistryExport(f.db, author, input, f.options), { code: "OUTPUT_ACTION_EVIDENCE_CHANGED" });
  await assert.rejects(f.exports.downloadRegistryExport(f.db, author, exportId, f.options), { code: "OUTPUT_ACTION_EVIDENCE_CHANGED" });
  const g = exportFixture(t), pending = await g.prepare();
  g.revokeEvidence();
  await assert.rejects(g.approve(pending.exportId), { code: "OUTPUT_ACTION_EVIDENCE_CHANGED" });
});

test("retained file tampering blocks review, preview and approved download", async t => {
  const f = exportFixture(t), { exportId } = await f.prepare();
  f.tamper(exportId);
  await assert.rejects(f.approve(exportId), { code: "REGISTRY_EVIDENCE_INTEGRITY" });
  await assert.rejects(f.exports.previewRegistryExport(f.db, reviewer, exportId, f.options), { code: "REGISTRY_EVIDENCE_INTEGRITY" });
  const g = exportFixture(t), approved = await g.prepare();
  await g.approve(approved.exportId);
  g.tamper(approved.exportId);
  await assert.rejects(g.exports.downloadRegistryExport(g.db, author, approved.exportId, g.options), { code: "REGISTRY_EVIDENCE_INTEGRITY" });
});

test("exports and previews cannot cross organisation boundaries", async t => {
  const f = exportFixture(t), { exportId } = await f.prepare(), other = { ...reviewer, organisationId: "org-two" };
  assert.deepEqual(await f.exports.listRegistryExports(f.db, other), []);
  await assert.rejects(f.exports.previewRegistryExport(f.db, other, exportId, f.options), { code: "REGISTRY_EXPORT_NOT_FOUND" });
  await assert.rejects(f.exports.downloadRegistryExport(f.db, other, exportId, f.options), { code: "REGISTRY_EXPORT_NOT_FOUND" });
  await assert.rejects(f.exports.reviewRegistryExport(f.db, other, { exportId, decision: "approved", note: "Other tenant" }, f.options), { code: "REGISTRY_EXPORT_NOT_FOUND" });
});
