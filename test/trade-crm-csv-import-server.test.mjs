import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { migratedDataforceD1 } from "./helpers/trade-dataforce-database.mjs";
import { parseStrictImportCsv } from "../src/lib/creditex-dataforce-job-csv.ts";
import { suggestTradeCrmCsvMapping } from "../src/lib/trade-crm-csv-import-metadata.ts";
import { previewTradeCrmCsvImport, commitTradeCrmCsvImport, getTradeCrmCsvImport, exportTradeCrmCsvSource } from "../src/lib/trade-crm-csv-import-server.ts";

const csv = (headers, rows) => `\uFEFF${[headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}\r\n`;
const clientHeaders = ["Client ID", "Name", "Contact First", "Contact Last", "Email Address", "Mobile Number", "Company Address", "Billing Address", "Payment Terms", "Unmapped original"];
const jobHeaders = ["Job Number", "Client ID", "Company", "Job Category", "Job Status", "Job Address", "Scheduled Start", "Description of work", "Work Completed", "Invoice No", "Payment Amount"];
function files(suffix = "") {
  const clientText = csv(clientHeaders, [
    ["C1", "Example One", "First", "Client", "first@example.test", "0400000001", "10 Office Road\nMelbourne VIC 3000", "PO Box 1", "30 days", "  exact quoted \"source\"\r\nnext line 🧰  "],
    ["C2", "Example Two", "Second", "Client", "second@example.test", "0400000002", "11 Office Road\nMelbourne VIC 3000", "PO Box 2", "7 days", "other"],
  ]) + suffix;
  const jobsText = csv(jobHeaders, [
    ["J1", "C2", "", "Standard", "Completed", "20 Site Road, Melbourne VIC 3000, Australia", "30/09/2026 10:00", "Original work description", "Done in prior system", "INV-1", "250"],
    ["J2", "C1", "", "Standard", "Invoiced", "21 Site Road\nMelbourne VIC 3000", "2026-10-01T11:00", "Second job", "", "INV-2", "400"],
  ]);
  return [
    { id: "clients", fileName: "clients.csv", role: "customers", csvText: clientText, mapping: suggestTradeCrmCsvMapping(clientHeaders, "customers") },
    { id: "jobs", fileName: "jobs.csv", role: "jobs", csvText: jobsText, mapping: suggestTradeCrmCsvMapping(jobHeaders, "jobs") },
  ];
}
const options = { sourceNamespace: "Previous account", unmatchedJobs: "block", serviceCategoryMappings: { Standard: "assessment" } };
async function finish(db, owner, id) { let result; do { result = await commitTradeCrmCsvImport(db, owner, id); } while (result.hasMore); return result; }

test("paired imports preserve source, explicitly link clients, remain resumable and expose real owner-scoped lists", async t => {
  const { db, close } = await migratedDataforceD1();
  try {
    const inputFiles = files();
    const preview = await previewTradeCrmCsvImport(db, "owner", inputFiles, options);
    assert.equal(preview.total, 4); assert.equal(preview.batch.errorCount, 0);
    assert.equal(preview.fieldMappings.length, clientHeaders.length + jobHeaders.length);
    assert.equal(preview.rows.find(row => row.key === "J1").values.customer.businessName, "Example Two");
    for (const file of inputFiles) assert.equal((await exportTradeCrmCsvSource(db, "owner", preview.batch.id, file.id)).csv, file.csvText);
    assert.equal((await previewTradeCrmCsvImport(db, "owner", inputFiles.map(file => ({ ...file, fileName: "renamed.csv" })), options)).reused, true);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM trade_work_orders WHERE firebase_uid='owner'").first()).n, 0);
    const committed = await finish(db, "owner", preview.batch.id);
    assert.equal(committed.batch.importedCount, 4);
    assert.deepEqual({ jobs: committed.reconciliation.jobs, customers: committed.reconciliation.customers, sites: committed.reconciliation.sites, appointments: committed.reconciliation.appointments }, { jobs: 2, customers: 2, sites: 2, appointments: 2 });
    assert.equal(committed.reconciliation.sourceRows, 4);
    assert.equal(committed.reconciliation.sourceCells, clientHeaders.length * 2 + jobHeaders.length * 2);
    assert.equal(committed.reconciliation.brokenLinks, 0); assert.equal(committed.reconciliation.mismatchedSourceRows, 0);
    assert.equal(Object.hasOwn(committed.reconciliation, "mappedFieldMismatches"), false, "uncomputed fidelity must not be advertised as zero mismatches");
    for (const table of ["trade_work_orders", "trade_crm_appointments"]) {
      const field = table === "trade_work_orders" ? "stage" : "status";
      assert.deepEqual((await db.prepare(`SELECT DISTINCT ${field} status FROM ${table} WHERE firebase_uid='owner'`).all()).results, [{ status: "imported" }]);
    }
    assert.deepEqual((await db.prepare("SELECT DISTINCT pipeline_stage FROM trade_crm_job_details WHERE firebase_uid='owner'").all()).results, [{ pipeline_stage: "imported" }]);
    const financial = await db.prepare("SELECT SUM(invoiced_value_cents) invoiced,SUM(paid_value_cents) paid FROM trade_crm_job_details WHERE firebase_uid='owner'").first();
    assert.deepEqual(financial, { invoiced: 0, paid: 0 });
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM trade_crm_job_notes WHERE firebase_uid='owner'").first()).n, 1);
    assert.equal((await finish(db, "owner", preview.batch.id)).batch.importedCount, 4);

    await t.test("all five summary lists paginate and agree with reconciliation", async () => {
      for (const kind of ["jobs", "customers", "sites", "appointments", "contacts"]) {
        const page = await getTradeCrmCsvImport(db, "owner", preview.batch.id, 0, 1, "all", kind);
        assert.equal(page.batch.id, preview.batch.id); assert.equal(page.total, committed.reconciliation[kind]);
        assert.equal(page.records.length, 1); assert.ok(page.records[0].id); assert.ok(page.records[0].label);
        const second = await getTradeCrmCsvImport(db, "owner", preview.batch.id, page.nextOffset, 1, "all", kind);
        assert.notEqual(second.records[0].id, page.records[0].id);
        await assert.rejects(getTradeCrmCsvImport(db, "foreign", preview.batch.id, 0, 1, "all", kind), /not found/);
      }
      const page = await getTradeCrmCsvImport(db, "owner", preview.batch.id, 1, 2, "imported");
      assert.equal(page.total, 4); assert.equal(page.rows.length, 2); assert.equal(page.nextOffset, 3);
      for (const kind of ["warning", "invalid", "conflict", "excluded", "duplicate"]) assert.equal((await getTradeCrmCsvImport(db, "owner", preview.batch.id, 0, 100, kind)).total, 0);
      await assert.rejects(exportTradeCrmCsvSource(db, "foreign", preview.batch.id, "clients"), /not found/);
      await assert.rejects(commitTradeCrmCsvImport(db, "foreign", preview.batch.id), /not found/);
    });
    await t.test("archived jobs remain excluded without recreating or losing original receipts", async () => {
      const job = await db.prepare("SELECT work_order_id FROM trade_csv_import_sources WHERE firebase_uid='owner' AND source_id='J1'").first();
      await db.prepare("UPDATE trade_work_orders SET record_status='archived' WHERE id=? AND firebase_uid='owner'").bind(job.work_order_id).run();
      const after = await getTradeCrmCsvImport(db, "owner", preview.batch.id);
      assert.equal(after.reconciliation.jobs, 1); assert.equal(after.reconciliation.removedCount, 1); assert.equal(after.reconciliation.brokenLinks, 0);
      assert.equal(after.batch.historicalImportedCount, 4); assert.equal(after.batch.importedCount, 3); assert.equal(after.batch.excludedCount, 1);
      const removed = await getTradeCrmCsvImport(db, "owner", preview.batch.id, 0, 10, "excluded");
      assert.equal(removed.total, 1); assert.equal(removed.rows[0].resultStatus, "removed");
      const duplicate = await previewTradeCrmCsvImport(db, "owner", files("\r\n").map(file => file.id === "clients" ? { ...file, csvText: file.csvText.replace(/\r\n\r\n$/, "\r\n") } : { ...file, csvText: file.csvText.replace(/^\uFEFF/, "") }), options);
      assert.equal(duplicate.rows.find(row => row.key === "J1").resultStatus, "removed");
      assert.equal((await finish(db, "owner", duplicate.batch.id)).batch.importedCount, 0);
      assert.equal((await db.prepare("SELECT record_status FROM trade_work_orders WHERE id=?").bind(job.work_order_id).first()).record_status, "archived");
      assert.equal((await exportTradeCrmCsvSource(db, "owner", preview.batch.id, "jobs")).csv, inputFiles[1].csvText);
    });
    await t.test("changed source and manual deletion are conflicts, never silent overwrites", async () => {
      const changed = inputFiles.map(file => file.id === "jobs" ? { ...file, csvText: file.csvText.replace("Second job", "Changed original job") } : file);
      const batch = await previewTradeCrmCsvImport(db, "owner", changed, options);
      assert.equal(batch.rows.find(row => row.key === "J2").resultStatus, "conflict");
      const filtered = await getTradeCrmCsvImport(db, "owner", batch.batch.id, 0, 10, "conflict");
      assert.equal(filtered.total, 1);
    });
    await t.test("an explicit excluded source row stays in raw export and cannot create entities", async () => {
      const batch = await previewTradeCrmCsvImport(db, "excluded-owner", inputFiles, { ...options, excludedRows: { jobs: [2] } });
      assert.equal(batch.batch.excludedCount, 1);
      assert.equal((await getTradeCrmCsvImport(db, "excluded-owner", batch.batch.id, 0, 10, "excluded")).total, 1);
      const result = await finish(db, "excluded-owner", batch.batch.id);
      assert.equal(result.reconciliation.jobs, 1); assert.equal(result.batch.importedCount, 3);
      assert.equal((await exportTradeCrmCsvSource(db, "excluded-owner", batch.batch.id, "jobs")).csv, inputFiles[1].csvText);
    });
    await t.test("transaction rollback leaves no source claim and a retry safely finishes", async () => {
      const batch = await previewTradeCrmCsvImport(db, "failure", inputFiles, options);
      await db.prepare("CREATE TRIGGER csv_test_failure BEFORE INSERT ON trade_crm_job_details WHEN NEW.firebase_uid='failure' BEGIN SELECT RAISE(ABORT,'CSV_TEST_FAILURE'); END").run();
      await assert.rejects(commitTradeCrmCsvImport(db, "failure", batch.batch.id), /CSV_TEST_FAILURE/);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM trade_csv_import_sources WHERE firebase_uid='failure' AND entity_type='job'").first()).n, 0);
      await db.prepare("DROP TRIGGER csv_test_failure").run();
      assert.equal((await finish(db, "failure", batch.batch.id)).batch.importedCount, 4);
    });
    await t.test("new source jobs cannot refill a previously deleted imported customer or site", async () => {
      for (const removedType of ["customer", "site"]) {
        const owner = `deleted-${removedType}`;
        const batch = await previewTradeCrmCsvImport(db, owner, inputFiles, options);
        await finish(db, owner, batch.batch.id);
        const old = await db.prepare("SELECT customer_id,service_site_id FROM trade_csv_import_sources WHERE firebase_uid=? AND source_id='J2'").bind(owner).first();
        const table = removedType === "customer" ? "trade_crm_customers" : "trade_crm_service_sites";
        const id = removedType === "customer" ? old.customer_id : old.service_site_id;
        await db.prepare(`DELETE FROM ${table} WHERE id=? AND firebase_uid=?`).bind(id, owner).run();
        const newFiles = inputFiles.map(file => file.id === "jobs" ? { ...file, csvText: file.csvText.replace('"J2"', '"NEW-JOB"') } : file);
        const next = await previewTradeCrmCsvImport(db, owner, newFiles, options);
        await finish(db, owner, next.batch.id);
        const receipt = (await getTradeCrmCsvImport(db, owner, next.batch.id)).rows.find(row => row.key === "NEW-JOB");
        assert.equal(receipt.resultStatus, "conflict"); assert.match(receipt.error, /deleted/);
        assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE id=?`).bind(id).first()).n, 0);
        assert.equal((await db.prepare("SELECT COUNT(*) n FROM trade_csv_import_sources WHERE firebase_uid=? AND source_id='NEW-JOB'").bind(owner).first()).n, 0);
      }
    });
    await t.test("staged row tampering is rejected before a CRM write", async () => {
      const batch = await previewTradeCrmCsvImport(db, "tampered", inputFiles, options);
      await db.prepare("UPDATE trade_data_import_rows SET normalized_data='{}' WHERE batch_id=?").bind(batch.batch.id).run();
      const result = await finish(db, "tampered", batch.batch.id);
      assert.equal(result.batch.errorCount, 4); assert.equal(result.batch.importedCount, 0);
    });
    await t.test("source files over 2 MB retain exact Unicode text across bounded database chunks", async () => {
      const largeSource = csv(["Client ID", "Name", "Original notes"], Array.from({ length: 80 }, (_, index) => [`L${index}`, `Large Client ${index}`, "🧰".repeat(8_000)]));
      assert.ok(new TextEncoder().encode(largeSource).byteLength > 2_000_000);
      const large = [{ id: "large", fileName: "large.csv", csvText: largeSource, role: "customers", mapping: suggestTradeCrmCsvMapping(parseStrictImportCsv(largeSource).headers, "customers") }];
      const batch = await previewTradeCrmCsvImport(db, "large", large, options);
      const chunks = await db.prepare("SELECT length(CAST(source_text AS BLOB)) bytes FROM trade_csv_import_file_chunks WHERE firebase_uid='large'").all();
      assert.ok(chunks.results.length > 8); assert.ok(chunks.results.every(chunk => chunk.bytes <= 250_000));
      assert.equal((await exportTradeCrmCsvSource(db, "large", batch.batch.id, "large")).csv, largeSource);
      assert.equal((await finish(db, "large", batch.batch.id)).batch.importedCount, 80);
    });
  } finally { await close(); }
});

test("new CSV endpoint enforces verified owner identity, same origin and a streamed body bound", () => {
  const route = fs.readFileSync(new URL("../src/app/api/trade-imports/csv/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/requireVerifiedTradeAccess\(request, \{ partnerTypes: \["installer"\] \}\)/g) || []).length, 2);
  assert.equal((route.match(/!sameOrigin\(request\)/g) || []).length, 2);
  assert.match(route, /readBoundedJsonRequest\(request, 22 \* 1024 \* 1024\)/);
  assert.doesNotMatch(route, /ownerUid.*body|firebaseUid.*body|request\.json\(\)/);
});
