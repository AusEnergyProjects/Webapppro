import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const crmMigration = read("../drizzle/0019_melodic_unus.sql");
const customerSiteMigration = read("../drizzle/0047_customer_service_site_foundation.sql");
const route = read("../src/app/api/trade-crm/route.ts");
const workspace = read("../src/components/InstallerCrmWorkspace.tsx");
const styles = read("../src/app/globals.css");

const apply = (db, sql) => {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
};

test("customer accounts own multiple contacts, service sites and site contacts", () => {
  for (const table of ["trade_crm_customers", "trade_crm_customer_contacts", "trade_crm_service_sites", "trade_crm_site_contacts"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
  }
  assert.match(schema, /serviceSiteId: text\("service_site_id"\)/);
  assert.match(schema, /trade_crm_customer_contacts_owner_customer_idx/);
  assert.match(schema, /trade_crm_service_sites_owner_customer_idx/);
  assert.match(schema, /trade_crm_site_contacts_owner_site_contact_idx/);
});

test("the migration backfills one primary contact and site without exposing protected jobs", () => {
  const db = new DatabaseSync(":memory:");
  apply(db, crmMigration);
  db.exec(`INSERT INTO trade_crm_customers
    (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, email, phone,
     address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes, record_status, created_at, updated_at)
    VALUES ('customer-1', 'owner-1', 'CUS-1', 'business', 'Alex', 'Ng', 'Example Services', 'alex@example.test', '0400000000',
      '10 Sample Street', '', 'Newcastle', 'NSW', '2300', '[]', '', 'active', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z');
    INSERT INTO trade_crm_job_details
    (id, work_order_id, firebase_uid, crm_customer_id, customer_source, pipeline_stage, description, customer_reference,
     next_action, tags, estimated_value_cents, quoted_value_cents, invoiced_value_cents, paid_value_cents,
     quote_status, invoice_status, payment_due_at, created_at, updated_at)
    VALUES ('detail-direct', 'job-direct', 'owner-1', 'customer-1', 'trade_owned', 'enquiry', '', '', '', '[]', 0, 0, 0, 0,
      'not_started', 'not_started', '', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z'),
      ('detail-protected', 'job-protected', 'owner-1', '', 'platform_private', 'qualifying', '', '', '', '[]', 0, 0, 0, 0,
      'not_started', 'not_started', '', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z');`);
  apply(db, customerSiteMigration);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM trade_crm_customer_contacts").get().total, 1);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM trade_crm_service_sites").get().total, 1);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM trade_crm_site_contacts").get().total, 1);
  assert.equal(db.prepare("SELECT service_site_id FROM trade_crm_job_details WHERE id = 'detail-direct'").get().service_site_id, "legacy-site-customer-1");
  assert.equal(db.prepare("SELECT service_site_id FROM trade_crm_job_details WHERE id = 'detail-protected'").get().service_site_id, "");
});

test("contact and site APIs enforce the account owner boundary", () => {
  for (const action of ["create_customer_contact", "update_customer_contact", "create_service_site", "update_service_site", "link_site_contact"]) {
    assert.match(route, new RegExp(`action === "${action}"`));
  }
  assert.match(route, /async function ownedCustomer/);
  assert.match(route, /async function ownedContact/);
  assert.match(route, /async function ownedServiceSite/);
  assert.match(route, /id = \? AND firebase_uid = \?/);
  assert.match(route, /service_site_id = \?/);
  assert.match(route, /let serviceSiteId = platformPrivate \? ""/);
  assert.match(route, /ORDER BY is_primary DESC, created_at LIMIT 1/);
  assert.match(route, /ownedServiceSite\(db, identity, serviceSiteId, customerId\)/);
});

test("the CRM can create, edit and assign contacts and service sites", () => {
  for (const label of ["Customer contacts", "Add another contact", "Service sites", "Access instructions", "Parking instructions", "Hazards and controls", "Authoritative service site"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /contacts\.map/);
  assert.match(workspace, /sites\.map/);
  assert.match(workspace, /action: "link_site_contact"/);
  assert.match(styles, /\.crm-customer-entities \{[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.crm-customer-entities \{ grid-template-columns: 1fr; \}/);
});

test("new customer and service-site copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${workspace}`, /[\u2013\u2014]/);
});
