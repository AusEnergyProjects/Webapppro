import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DATAFORCE_JOB_CSV_HEADERS } from "../src/lib/creditex-dataforce-job-csv.ts";
import { migratedDataforceD1 } from "./helpers/trade-dataforce-database.mjs";

const migration = fs.readFileSync(new URL("../drizzle/0224_neutral_job_import_labels.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean);
const oldTags = '["Dataforce import"]';
const newTags = '["Job import"]';
const now = "2026-09-30T00:00:00.000Z";
const oldDescription = (id, sub = "partial") => `Imported Dataforce job source-${id}. Original status: completed${sub ? ` / ${sub}` : ""}.`;
const oldNotes = id => `Imported Dataforce appointment app-${id}. Original time retained; worker assignment needs confirmation in TLink.`;

test("neutral-label migration changes only exact owned generated copy, preserves provenance and edits, and refreshes current field audiences once", async () => {
  const fixture = await migratedDataforceD1();
  const { db } = fixture;
  try {
    const insert = (table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`)
      .bind(...Object.values(values));
    const specs = [
      { id: "clean", changed: true },
      { id: "edited", tags: '["Dataforce import","user tag"]', description: `${oldDescription("edited")} Keep my edit.`, notes: `${oldNotes("edited")} Use rear gate.` },
      { id: "wrong-owner", sourceOwner: "other-owner" },
      { id: "no-source", noSource: true },
      { id: "neutral", tags: newTags, description: oldDescription("neutral").replace("Imported Dataforce", "Imported"), notes: oldNotes("neutral").replace("Imported Dataforce", "Imported") },
      { id: "visit-only", tags: "[]", description: "Custom instructions", changed: true },
      { id: "customer-only", jobTags: "[]", description: "Custom instructions", notes: "Custom visit notes" },
      { id: "blank-substatus", sub: "", changed: true },
      { id: "archived", archived: true },
      { id: "other-business", owner: "business-two", changed: true },
    ];
    const seed = [];
    for (const spec of specs) {
      const id = spec.id, owner = spec.owner || "owner", customerId = `customer-${id}`;
      seed.push(insert("trade_work_orders", { id, firebase_uid: owner, partner_type: "installer", source_type: "import",
        source_reference: `source-${id}`, work_number: `TLJ-${id}`, title: "Original title", stage: "in_progress",
        assignee_member_id: id === "clean" ? "lead-worker" : "", revision: 4, record_status: spec.archived ? "archived" : "active", created_at: now, updated_at: now }));
      seed.push(insert("trade_crm_customers", { id: customerId, firebase_uid: owner, customer_number: `customer-number-${id}`,
        first_name: "Original customer", tags: spec.tags ?? oldTags, created_at: now, updated_at: now }));
      seed.push(insert("trade_crm_job_details", { id: `${id}:detail`, work_order_id: id, firebase_uid: owner,
        crm_customer_id: customerId, tags: spec.jobTags ?? spec.tags ?? oldTags, description: spec.description ?? oldDescription(id, spec.sub), created_at: now, updated_at: now }));
      seed.push(insert("trade_crm_appointments", { id: `${id}:visit`, work_order_id: id, firebase_uid: owner,
        title: "Original visit", starts_at: "2026-09-30T09:00", assignee_member_id: id === "clean" ? "visit-worker" : "",
        status: "in_progress", notes: spec.notes ?? oldNotes(id), revision: 7, created_at: now, updated_at: now }));
      seed.push(insert("trade_work_order_events", { id: `${id}:import`, work_order_id: id, firebase_uid: owner, event_type: "data_imported",
        summary: `Imported Dataforce job source-${id}; source retained without issuing invoices, certificates or customer notifications.`, created_at: now }));
      if (!spec.noSource) seed.push(insert("trade_dataforce_sources", { id: `source-row-${id}`, firebase_uid: spec.sourceOwner || owner,
        source_job_id: `source-${id}`, source_app_id: `app-${id}`, row_sha256: "a".repeat(64),
        raw_json: JSON.stringify({ ...Object.fromEntries(DATAFORCE_JOB_CSV_HEADERS.map(header => [header, ""])),
          "Job Id": `source-${id}`, "App Id": `app-${id}`, Status: "completed", SubStatus: spec.sub ?? "partial", Agent: "Original Dataforce text" }),
        import_batch_id: "batch", import_row_id: `row-${id}`, work_order_id: id, customer_id: customerId, service_site_id: `site-${id}`,
        customer_key: `customer-key-${id}`, site_key: `site-key-${id}`, created_at: now }));
    }
    for (const [id, owner, status, member] of [
      ["additional", "owner", "completed", "second-worker"],
      ["cancelled", "owner", "cancelled", "cancelled-worker"],
      ["foreign", "other-owner", "in_progress", "foreign-worker"],
    ]) seed.push(insert("trade_crm_appointments", { id, work_order_id: "clean", firebase_uid: owner, title: "Additional visit",
      starts_at: "2026-09-30T10:00", assignee_member_id: member, status, notes: oldNotes("clean"), revision: 7, created_at: now, updated_at: now }));
    for (let start = 0; start < seed.length; start += 20) await db.batch(seed.slice(start, start + 20));
    const all = async table => (await db.prepare(`SELECT * FROM ${table} ORDER BY ${table === "trade_team_sync_changes" ? "sequence" : "id"}`).all()).results;
    const sourcesBefore = await all("trade_dataforce_sources"), eventsBefore = await all("trade_work_order_events");
    await db.batch(migration.map(sql => db.prepare(sql)));
    const customers = await all("trade_crm_customers"), details = await all("trade_crm_job_details"), visits = await all("trade_crm_appointments"), jobs = await all("trade_work_orders");
    for (const spec of specs) {
      const owned = !spec.noSource && !spec.sourceOwner;
      const detail = details.find(row => row.work_order_id === spec.id), visit = visits.find(row => row.id === `${spec.id}:visit`);
      const customer = customers.find(row => row.id === `customer-${spec.id}`), job = jobs.find(row => row.id === spec.id);
      const originalDescription = spec.description ?? oldDescription(spec.id, spec.sub), originalNotes = spec.notes ?? oldNotes(spec.id);
      const descriptionChanges = owned && originalDescription === oldDescription(spec.id, spec.sub);
      const notesChange = owned && originalNotes === oldNotes(spec.id);
      const originalTags = spec.jobTags ?? spec.tags ?? oldTags, customerTags = spec.tags ?? oldTags;
      assert.equal(detail.description, descriptionChanges ? originalDescription.replace("Imported Dataforce", "Imported") : originalDescription, spec.id);
      assert.equal(detail.tags, owned && originalTags === oldTags ? newTags : originalTags, spec.id);
      assert.equal(customer.tags, owned && customerTags === oldTags ? newTags : customerTags, spec.id);
      assert.equal(visit.notes, notesChange ? originalNotes.replace("Imported Dataforce", "Imported") : originalNotes, spec.id);
      assert.equal(visit.revision, notesChange ? 8 : 7, spec.id);
      assert.equal(visit.starts_at, "2026-09-30T09:00");
      assert.equal(visit.status, "in_progress");
      assert.equal(job.revision, spec.changed ? 5 : 4, spec.id);
      assert.equal(job.stage, "in_progress");
      assert.equal(job.source_reference, `source-${spec.id}`);
      if (!spec.changed) assert.equal(job.updated_at, now, spec.id);
    }
    for (const id of ["additional", "cancelled", "foreign"]) {
      const visit = visits.find(row => row.id === id);
      assert.equal(visit.notes, oldNotes("clean"));
      assert.equal(visit.revision, 7);
    }
    const changes = await all("trade_team_sync_changes");
    assert.deepEqual(changes.filter(row => row.entity_id === "clean").map(row => row.audience_member_id).sort(), ["", "lead-worker", "second-worker", "visit-worker"]);
    assert.equal(changes.length, 7);
    assert.ok(changes.every(row => row.operation === "upsert" && row.entity_type === "job" && row.revision === 5));
    assert.deepEqual([...new Set(changes.map(row => row.entity_id))].sort(), specs.filter(spec => spec.changed).map(spec => spec.id).sort());
    assert.deepEqual(await all("trade_dataforce_sources"), sourcesBefore);
    assert.deepEqual(await all("trade_work_order_events"), eventsBefore);
    for (const table of ["trade_mobile_push_outbox", "trade_crm_appointment_revisions", "trade_crm_accepted_invoices", "trade_crm_quick_invoices"]) {
      assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n, 0);
    }
    await db.batch(migration.map(sql => db.prepare(sql)));
    assert.deepEqual(await all("trade_team_sync_changes"), changes);
    assert.deepEqual(await all("trade_work_orders"), jobs);
    assert.deepEqual(await all("trade_crm_appointments"), visits);
    assert.deepEqual(await all("trade_crm_job_details"), details);
    assert.deepEqual(await all("trade_crm_customers"), customers);
    assert.deepEqual(await all("trade_dataforce_sources"), sourcesBefore);
    assert.deepEqual(await all("trade_work_order_events"), eventsBefore);
  } finally { await fixture.close(); }
});
