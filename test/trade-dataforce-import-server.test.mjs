import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DATAFORCE_JOB_CSV_HEADERS } from "../src/lib/creditex-dataforce-job-csv.ts";
import { previewTradeDataforceImport, commitTradeDataforceImport, getTradeDataforceImport, exportTradeDataforceSource,
  reconcileTradeDataforceImport } from "../src/lib/trade-dataforce-import-server.ts";
import { migratedDataforceD1 } from "./helpers/trade-dataforce-database.mjs";

function record(id, patch = {}) {
  return { ...Object.fromEntries(DATAFORCE_JOB_CSV_HEADERS.map(key => [key, ""])), "App Id": `APP-${id}`, "Job Id": `JOB-${id}`,
    Status: "completed", SubStatus: "passed", Type: "normal", "Work Type": "Home Energy Rating Assessment",
    "Scheduled Datetime": "30-Sep-2026 09:30AM", Balance: "$35.50", "Certificates (VEECs)": "12", Invoiced: "No",
    "Field Worker": "Historic Worker (99)", Customer: `Person ${id}`, Phone: "0399999999", Mobile: "0400000000", Email: "shared@example.com",
    Address: "10 Test Street", Suburb: "Melbourne", Postcode: "3000", ...patch };
}
function csv(records) {
  return [DATAFORCE_JOB_CSV_HEADERS, ...records.map(row => DATAFORCE_JOB_CSV_HEADERS.map(header => row[header]))]
    .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
async function finish(db, owner, batchId) {
  let result;
  do { result = await commitTradeDataforceImport(db, owner, batchId); } while (result.hasMore);
  return result;
}

test("Dataforce migration uses production D1 schema, atomic source claims and faithful CRM links", async t => {
  const { db, close } = await migratedDataforceD1();
  try {
    await t.test("mixed malformed rows reject the whole file without staging", async () => {
      await assert.rejects(previewTradeDataforceImport(db, "malformed", `${csv([record("1")])}\r\ninvalid,row`, "bad.csv"), /Row 3/);
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM trade_data_import_batches WHERE firebase_uid='malformed'").first()).count, 0);
      await assert.rejects(previewTradeDataforceImport(db, "blank", `${csv([record("1")])}\r\n\r\n`, "blank.csv"), /complete 23-column/);
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM trade_data_import_batches WHERE firebase_uid='blank'").first()).count, 0);
    });
    const originals = Array.from({ length: 23 }, (_, index) => record(String(index), index === 2 ? { SubStatus: "partial" } : {}));
    const preview = await previewTradeDataforceImport(db, "owner", csv(originals), "source.csv");
    await t.test("preview has every source cell and creates no CRM rows", async () => {
      assert.equal(preview.total, 23);
      assert.deepEqual(preview.rows[0].values.record, originals[0]);
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM trade_work_orders").first()).count, 0);
    });
    await t.test("two concurrent chunks cannot double-import, and remaining rows resume", async () => {
      await Promise.all([commitTradeDataforceImport(db, "owner", preview.batch.id), commitTradeDataforceImport(db, "owner", preview.batch.id)]);
      const done = await finish(db, "owner", preview.batch.id);
      assert.equal(done.batch.importedCount, 23);
      assert.equal(done.batch.pendingCount, 0);
      assert.equal(done.reconciliation.jobs, 23);
      assert.equal(done.reconciliation.customers, 23); // Shared phones/email never collapse different people.
      assert.equal(done.reconciliation.contacts, 46);
      assert.equal(done.reconciliation.brokenLinks, 0);
      const rows = (await db.prepare(`SELECT source.raw_json,source.source_job_id,work.stage,work.scheduled_start,appointment.starts_at,
        work.assignee_member_id,details.invoiced_value_cents,details.paid_value_cents FROM trade_dataforce_sources source
        JOIN trade_work_orders work ON work.id=source.work_order_id JOIN trade_crm_job_details details ON details.work_order_id=work.id
        JOIN trade_crm_appointments appointment ON appointment.work_order_id=work.id WHERE source.firebase_uid='owner'`).all()).results;
      for (const row of rows) {
        assert.deepEqual(JSON.parse(row.raw_json), originals.find(source => source["Job Id"] === row.source_job_id));
        assert.equal(row.scheduled_start, "2026-09-30T09:30"); assert.equal(row.starts_at, row.scheduled_start);
        assert.equal(row.stage, row.source_job_id === "JOB-2" ? "in_progress" : "completed");
        assert.equal(row.assignee_member_id, ""); assert.equal(row.invoiced_value_cents, 0); assert.equal(row.paid_value_cents, 0);
      }
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes WHERE owner_uid='owner' AND audience_member_id=''").first()).count, 23);
      for (const table of ["trade_mobile_push_outbox", "trade_team_members", "compliance_cases", "trade_crm_quick_invoices", "trade_crm_accepted_invoices"]) {
        assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count, 0, table);
      }
    });
    await t.test("same-file reuse is a no-op and altered source IDs conflict", async () => {
      const again = await previewTradeDataforceImport(db, "owner", csv(originals), "renamed.csv");
      assert.equal(again.reused, true); assert.equal(again.batch.id, preview.batch.id);
      assert.equal((await commitTradeDataforceImport(db, "owner", again.batch.id)).processedCount, 0);
      const changed = await previewTradeDataforceImport(db, "owner", csv([record("0", { Address: "Changed address" })]), "changed.csv");
      assert.equal(changed.rows[0].resultStatus, "conflict");
      assert.equal((await finish(db, "owner", changed.batch.id)).batch.importedCount, 0);
      const differentFile = await previewTradeDataforceImport(db, "owner", `${csv(originals)}\r\n`, "copy.csv");
      assert.equal(differentFile.batch.duplicateCount, 23);
    });
    await t.test("source IDs and export remain owner scoped", async () => {
      await assert.rejects(getTradeDataforceImport(db, "other", preview.batch.id), /not found/);
      await assert.rejects(commitTradeDataforceImport(db, "other", preview.batch.id), /not found/);
      await assert.rejects(exportTradeDataforceSource(db, "other", preview.batch.id), /not found/);
      const other = await previewTradeDataforceImport(db, "other", csv([originals[0]]), "other.csv");
      assert.equal((await finish(db, "other", other.batch.id)).batch.importedCount, 1);
      assert.notEqual(other.batch.id, preview.batch.id);
    });
    await t.test("reviewed work type choices persist and change preview identity without changing source", async () => {
      const original = record("mapping", { "Work Type": "Standard Install" });
      const before = await previewTradeDataforceImport(db, "mapping-owner", csv([original]), "mapping.csv");
      const mapped = await previewTradeDataforceImport(db, "mapping-owner", csv([original]), "mapping.csv", { "Standard Install": "assessment" });
      assert.notEqual(mapped.batch.id, before.batch.id);
      assert.equal(mapped.rows[0].values.job.serviceCategory, "assessment");
      assert.deepEqual(mapped.rows[0].values.record, original);
      const result = await finish(db, "mapping-owner", mapped.batch.id);
      assert.equal(result.batch.importedCount, 1);
      assert.equal((await db.prepare("SELECT service_category FROM trade_work_orders WHERE firebase_uid='mapping-owner'").first()).service_category, "assessment");
      await assert.rejects(previewTradeDataforceImport(db, "mapping-owner", csv([original]), "invalid-choice.csv", { "Standard Install": "invented" }), /category/i);
      const changed = await previewTradeDataforceImport(db, "mapping-owner", csv([original]), "changed-choice.csv", { "Standard Install": "plumbing" });
      assert.equal(changed.rows[0].resultStatus, "conflict");
    });
    await t.test("exact existing customer, service site and contacts are reused", async () => {
      const first = await previewTradeDataforceImport(db, "contact-owner", csv([record("c1", { Customer: "Reusable Contact" })]), "contact.csv");
      await finish(db, "contact-owner", first.batch.id);
      await db.prepare("UPDATE trade_crm_customer_contacts SET id='legacy-' || id WHERE firebase_uid='contact-owner'").run();
      await db.prepare("UPDATE trade_crm_site_contacts SET customer_contact_id='legacy-' || customer_contact_id WHERE firebase_uid='contact-owner'").run();
      const second = await previewTradeDataforceImport(db, "contact-owner", csv([record("c2", { Customer: "Reusable Contact" })]), "second-contact.csv");
      assert.equal((await finish(db, "contact-owner", second.batch.id)).batch.importedCount, 1);
      for (const [table, expected] of [["trade_crm_customers",1],["trade_crm_service_sites",1],["trade_crm_customer_contacts",2],["trade_crm_site_contacts",2]]) {
        assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE firebase_uid='contact-owner'`).first()).count, expected, table);
      }
    });
    await t.test("an edited or archived service site blocks later linkage", async () => {
      const first = await previewTradeDataforceImport(db, "site-owner", csv([record("s1", { Customer: "Same Person" })]), "site.csv");
      await finish(db, "site-owner", first.batch.id);
      await db.prepare("UPDATE trade_crm_service_sites SET address_line_1='Edited address' WHERE firebase_uid='site-owner'").run();
      const second = await previewTradeDataforceImport(db, "site-owner", csv([record("s2", { Customer: "Same Person" })]), "second.csv");
      const result = await finish(db, "site-owner", second.batch.id);
      assert.equal(result.batch.conflictCount, 1); assert.equal(result.batch.importedCount, 0);
    });
    await t.test("deleted imports remain explicit tombstones, never automatic recreations", async () => {
      await db.prepare("DELETE FROM trade_work_orders WHERE firebase_uid='other'").run();
      const otherBatch = (await getTradeDataforceImport(db, "other")).batches[0];
      const stale = await getTradeDataforceImport(db, "other", otherBatch.id);
      assert.match(stale.batch.integrityWarning, /deleted/);
      const retry = await previewTradeDataforceImport(db, "other", `${csv([originals[0]])}\n`, "retry.csv");
      assert.equal(retry.rows[0].resultStatus, "conflict");
    });
    await t.test("a failed CRM insert rolls back its source claim and resumes without duplicates", async () => {
      const next = await previewTradeDataforceImport(db, "failure", csv([record("fail")]), "fail.csv");
      await db.prepare("CREATE TRIGGER dataforce_test_fail BEFORE INSERT ON trade_crm_job_details WHEN NEW.firebase_uid='failure' BEGIN SELECT RAISE(ABORT, 'SIMULATED_FAILURE'); END").run();
      await assert.rejects(commitTradeDataforceImport(db, "failure", next.batch.id), /SIMULATED_FAILURE/);
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM trade_dataforce_sources WHERE firebase_uid='failure'").first()).count, 0);
      assert.equal((await db.prepare("SELECT COUNT(*) count FROM trade_crm_customers WHERE firebase_uid='failure'").first()).count, 0);
      await db.prepare("DROP TRIGGER dataforce_test_fail").run();
      assert.equal((await finish(db, "failure", next.batch.id)).batch.importedCount, 1);
    });
    await t.test("large source cells retain their complete values across bounded preview statements", async () => {
      const large = Array.from({ length: 30 }, (_, index) => record(`large${index}`, { Agent: "A".repeat(4096), Client: "B".repeat(4096), Submission: "C".repeat(4096) }));
      const batch = await previewTradeDataforceImport(db, "large", csv(large), "large.csv");
      assert.equal(batch.total, 30); assert.equal(batch.rows[29].values.record.Submission.length, 4096);
      assert.match((await exportTradeDataforceSource(db, "large", batch.batch.id)).csv, /C{4096}/);
    });
    await t.test("tampered malformed staged rows cannot create CRM records", async () => {
      const batch = await previewTradeDataforceImport(db, "invalid", csv([record("bad")]), "bad.csv");
      await db.prepare("UPDATE trade_data_import_rows SET normalized_data='{}' WHERE batch_id=?").bind(batch.batch.id).run();
      const done = await finish(db, "invalid", batch.batch.id);
      assert.equal(done.batch.errorCount, 1); assert.equal(done.batch.importedCount, 0); assert.equal(done.batch.status, "needs_review");
    });
    const current = await reconcileTradeDataforceImport(db, "owner", preview.batch.id);
    assert.equal(current.brokenLinks, 0);
    assert.equal(current.sourceCells, 529); assert.equal(current.mismatchedSourceRows, 0); assert.equal(current.changedJobs, 0);
  } finally { await close(); }
});

test("Dataforce endpoint keeps verified owner access, same-origin checks and dedicated operations", () => {
  const route = fs.readFileSync(new URL("../src/app/api/trade-imports/dataforce/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/requireVerifiedTradeAccess\(request, \{ partnerTypes: \["installer"\] \}\)/g) || []).length, 2);
  assert.equal((route.match(/!sameOrigin\(request\)/g) || []).length, 2);
  assert.doesNotMatch(route, /ownerUid.*body|firebaseUid.*body|request\.headers\.get\("X-TLink-Business"\)/);
});
