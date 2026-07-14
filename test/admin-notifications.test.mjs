import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0012_elite_whizzer.sql");
const workflowMigration = read("../drizzle/0013_magenta_vivisector.sql");
const notificationServer = read("../src/lib/admin-notifications.ts");
const notificationRoute = read("../src/app/api/admin/notifications/route.ts");
const directoryRoute = read("../src/app/api/admin/directory/route.ts");
const inbox = read("../src/components/AdminNotificationInbox.tsx");
const directory = read("../src/components/AdminAccountDirectory.tsx");
const portal = read("../src/components/AdminOperationsPortal.tsx");
const customerAccount = read("../src/app/api/customer-account/route.ts");
const customerProjects = read("../src/app/api/customer-projects/route.ts");
const tradeProfile = read("../src/app/api/trade-profile/route.ts");
const verification = read("../src/app/api/trade-verification/documents/route.ts");
const tradeOpportunities = read("../src/app/api/trade-opportunities/route.ts");
const supplierProducts = read("../src/app/api/supplier-products/route.ts");
const productSelections = read("../src/app/api/product-selections/route.ts");
const supplierEnquiries = read("../src/app/api/supplier-enquiries/route.ts");
const adminAccounts = read("../src/app/api/admin/accounts/route.ts");
const adminProducts = read("../src/app/api/admin/products/route.ts");
const adminReferrals = read("../src/app/api/admin/referrals/route.ts");

test("operations notifications are durable, deduplicated and action oriented", () => {
  assert.match(schema, /sqliteTable\("admin_notifications"/);
  assert.match(schema, /admin_notifications_event_key_idx/);
  assert.match(schema, /requiresAction: integer\("requires_action"/);
  assert.match(schema, /resolutionNote: text\("resolution_note"/);
  assert.match(migration, /CREATE TABLE `admin_notifications`/);
  assert.match(migration, /CREATE UNIQUE INDEX `admin_notifications_event_key_idx`/);
  assert.match(notificationServer, /ON CONFLICT\(event_key\) DO NOTHING/);
  assert.match(notificationServer, /metadataJson\(input\.metadata\)/);
  assert.match(notificationServer, /backfillActionableAdminNotifications/);
  assert.match(notificationServer, /statements\.slice\(index, index \+ 50\)/);
});

test("operations cases have ownership, response targets and indexed queues", () => {
  assert.match(schema, /assignedToUid: text\("assigned_to_uid"\)/);
  assert.match(schema, /dueAt: text\("due_at"\)/);
  assert.match(schema, /admin_notifications_assignee_idx/);
  assert.match(schema, /admin_notifications_due_idx/);
  assert.match(workflowMigration, /ADD `assigned_to_uid`/);
  assert.match(workflowMigration, /WHEN 'urgent'.*\+2 hours/s);
  assert.match(workflowMigration, /WHERE `requires_action` = 1 AND `status` != 'resolved'/);
  assert.match(notificationServer, /adminNotificationDueAt/);
  assert.match(notificationServer, /urgent: 2, high: 8, normal: 24, low: 72/);
});

test("every primary signup, enquiry, approval and trade response boundary creates an operations event", () => {
  assert.match(customerAccount, /eventType: "customer\.signup"/);
  assert.match(customerProjects, /eventType: "customer\.enquiry_submitted"/);
  assert.match(customerProjects, /requiresAction: true/);
  assert.match(tradeProfile, /eventType: "trade\.signup"/);
  assert.match(tradeProfile, /trade\.referral_review_required/);
  assert.match(verification, /trade\.verification_evidence_uploaded/);
  assert.match(tradeOpportunities, /installer\.quote_submitted/);
  assert.match(tradeOpportunities, /installer\.lead_\$\{status\}/);
  assert.match(supplierProducts, /supplier\.product_created/);
  assert.match(supplierProducts, /supplier\.catalogue_imported/);
  assert.match(productSelections, /installer\.product_enquiry_submitted/);
  assert.match(supplierEnquiries, /supplier\.product_enquiry_\$\{status\}/);
});

test("the notification API is filtered, role protected and auditable", () => {
  assert.match(notificationRoute, /sameOrigin\(request\)/);
  assert.match(notificationRoute, /requireAdminIdentity\(request/);
  assert.match(notificationRoute, /Cache-Control.*no-store|adminJson/);
  assert.match(notificationRoute, /action === "mark_all_read"/);
  assert.match(notificationRoute, /action === "resolve"/);
  assert.match(notificationRoute, /Record how the action was resolved/);
  assert.match(notificationRoute, /writeAdminAudit\(admin, "notification\.resolve"/);
  assert.match(notificationRoute, /\["owner", "admin", "reviewer"\]/);
  assert.match(notificationRoute, /queue === "mine"/);
  assert.match(notificationRoute, /queue === "overdue"/);
  assert.match(notificationRoute, /action === "assign"/);
  assert.match(notificationRoute, /action === "set_due"/);
  assert.match(notificationRoute, /action === "set_priority"/);
  assert.match(notificationRoute, /action === "add_note"/);
  assert.match(notificationRoute, /Your operations role can only assign a case to yourself/);
  assert.match(notificationRoute, /WHERE l\.entity_type = 'admin_notification'/);
  assert.match(adminAccounts, /event_type IN \('trade\.signup', 'trade\.verification_evidence_uploaded'\)/);
  assert.match(adminProducts, /Catalogue review: \$\{reviewStatus\}/);
  assert.match(adminReferrals, /Referral decision: \$\{action\}/);
});

test("all account types are listed without unsafe account impersonation", () => {
  assert.match(schema, /sqliteTable\("customer_account_notes"/);
  assert.match(directoryRoute, /"customer", "installer", "supplier", "admin"/);
  assert.match(directoryRoute, /FROM customer_accounts/);
  assert.match(directoryRoute, /FROM trade_accounts/);
  assert.match(directoryRoute, /FROM admin_users/);
  assert.match(directoryRoute, /impersonationAllowed: false/);
  assert.match(directoryRoute, /customer_account\.view/);
  assert.match(directoryRoute, /requireAdminIdentity\(request, \["owner", "admin"\]\)/);
  assert.match(directoryRoute, /Your operations role cannot open private customer records/);
  assert.match(directoryRoute, /UPDATE trade_opportunities SET status = 'paused'/);
  assert.match(directoryRoute, /customer_account\.update/);
  assert.doesNotMatch(directoryRoute, /signInWith|customToken|password/);
});

test("the operations portal prioritises alerts and provides a filterable account workspace", () => {
  assert.match(portal, /<span>01<\/span>Inbox/);
  assert.match(portal, /<span>03<\/span>All accounts/);
  assert.match(portal, /AdminNotificationInbox/);
  assert.match(portal, /AdminAccountDirectory/);
  assert.match(portal, /notificationCounts\.action_required/);
  assert.match(inbox, /30_000/);
  assert.match(inbox, /Enable browser alerts/);
  assert.match(inbox, /Action required only/);
  assert.match(inbox, /Open record/);
  assert.match(inbox, /My queue/);
  assert.match(inbox, /Unassigned/);
  assert.match(inbox, /Response target/);
  assert.match(inbox, /Internal case note/);
  assert.match(inbox, /Case history/);
  assert.match(inbox, /aea-admin-inbox-queue/);
  assert.doesNotMatch(inbox, /window\.prompt/);
  assert.match(directory, /All account types/);
  assert.match(directory, /Safe account access/);
  assert.match(directory, /never signs in as that person/);
  assert.match(directory, /Save and audit adjustment/);
  assert.match(directory, /Private project history/);
});

test("new operations notification and account copy avoids prohibited dash characters", () => {
  for (const source of [notificationRoute, directoryRoute, inbox, directory, notificationServer]) {
    assert.doesNotMatch(source, /[\u2013\u2014]/);
  }
});
