import type { AdminIdentity } from "./admin-server";
import type { ComplianceIdentity } from "./compliance-access-server";
import { archiveCreditexVeuPilot } from "./creditex-veu-pilot-server";

type Row = { id: string; status: string; updatedAt: string; organisationId?: string };
type Group = { key: string; label: string; table: string; idColumn: string; state: string; predicate: string; pending: string; assignment: string };
export type DemoCleanupPreview = { digest: string; groups: { key: string; label: string; count: number; records: Row[] }[]; total: number; pilotOrganisationIds: string[] };
export class DemoCleanupError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
const demoCustomers = "SELECT firebase_uid FROM customer_accounts WHERE is_synthetic = 1";
const demoProjects = `SELECT id FROM customer_projects WHERE is_synthetic = 1 OR firebase_uid IN (${demoCustomers})`;
const demoOpportunities = `SELECT id FROM trade_opportunities WHERE is_synthetic = 1 OR id IN (SELECT opportunity_id FROM customer_projects WHERE id IN (${demoProjects}) AND opportunity_id <> '')`;
const liveLinkConflict = `SELECT p.id FROM customer_projects p WHERE p.opportunity_id IN (${demoOpportunities}) AND p.id NOT IN (${demoProjects})`;
const groups: Group[] = [
  { key: "customers", label: "Customer accounts", table: "customer_accounts", idColumn: "firebase_uid", state: "account_status", predicate: "is_synthetic = 1", pending: "account_status <> 'closed'", assignment: "account_status = 'closed'" },
  { key: "trades", label: "Trade accounts", table: "trade_accounts", idColumn: "firebase_uid", state: "account_status || ':' || availability_status", predicate: "is_synthetic = 1", pending: "(account_status <> 'closed' OR availability_status <> 'paused')", assignment: "account_status = 'closed', availability_status = 'paused'" },
  { key: "products", label: "Product listings", table: "supplier_products", idColumn: "id", state: "listing_status", predicate: "is_synthetic = 1", pending: "listing_status <> 'archived'", assignment: "listing_status = 'archived'" },
  { key: "projects", label: "Open customer projects", table: "customer_projects", idColumn: "id", state: "status", predicate: `id IN (${demoProjects})`, pending: "status IN ('matching','quote_review')", assignment: "status = 'withdrawn'" },
  { key: "opportunities", label: "Opportunities", table: "trade_opportunities", idColumn: "id", state: "status", predicate: `id IN (${demoOpportunities})`, pending: "status <> 'closed'", assignment: "status = 'closed'" },
  { key: "matches", label: "Open opportunity matches", table: "trade_opportunity_matches", idColumn: "id", state: "status", predicate: `opportunity_id IN (${demoOpportunities})`, pending: "status IN ('offered','viewed','interested','connected')", assignment: "status = 'closed'" },
  { key: "quotes", label: "Submitted customer project quotes", table: "customer_project_quotes", idColumn: "id", state: "status", predicate: `project_id IN (${demoProjects})`, pending: "status = 'submitted'", assignment: "status = 'closed'" },
];

function requireOwner(admin: AdminIdentity) {
  if (admin.role !== "owner") throw new DemoCleanupError("OWNER_REQUIRED", 403, "Only the platform owner can archive the demo dataset.");
}

export function requireRecentDemoCleanupAuthentication(admin: AdminIdentity) {
  requireOwner(admin);
  const now = Math.floor(Date.now() / 1000);
  if (!admin.authTime || admin.authTime > now || now - admin.authTime > 7200) throw new DemoCleanupError("RECENT_AUTH_REQUIRED", 403, "Sign out and sign in again before archiving the demo dataset.");
}

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function previewDemoCleanup(database: D1Database, admin: AdminIdentity): Promise<DemoCleanupPreview> {
  requireOwner(admin);
  const snapshots = await Promise.all(groups.map(async group => {
    const result = await database.prepare(`SELECT ${group.idColumn} AS id, ${group.state} AS status, updated_at AS updatedAt FROM ${group.table} WHERE ${group.predicate} AND ${group.pending} ORDER BY ${group.idColumn} LIMIT 10001`).all<Row>();
    if (result.results.length > 10000) throw new DemoCleanupError("DEMO_DATASET_TOO_LARGE", 409, "The demo dataset exceeds this cleanup's bounded size. Ask support to split the reviewed dataset.");
    return { key: group.key, label: group.label, count: result.results.length, records: result.results };
  }));
  const pilots = await database.prepare("SELECT id, status, updated_at AS updatedAt, organisation_id AS organisationId FROM compliance_pilot_runs WHERE program_code = 'VEU' AND record_mode = 'synthetic_test' AND status <> 'archived' ORDER BY id LIMIT 101").all<Row>();
  if (pilots.results.length > 100) throw new DemoCleanupError("DEMO_DATASET_TOO_LARGE", 409, "The pilot dataset exceeds this cleanup's bounded size.");
  snapshots.push({ key: "pilotRuns", label: "Synthetic VEU pilot runs", count: pilots.results.length, records: pilots.results });
  const conflicting = await database.prepare(`${liveLinkConflict} LIMIT 1`).first();
  if (conflicting) throw new DemoCleanupError("DEMO_LIVE_LINK_CONFLICT", 409, "A demo opportunity is shared with an unmarked customer project. Resolve that link before archiving demo records.");
  return { digest: await digest(snapshots), groups: snapshots, total: snapshots.reduce((sum, group) => sum + group.count, 0), pilotOrganisationIds: [...new Set(pilots.results.map(row => String(row.organisationId)))] };
}

function audit(database: D1Database, admin: AdminIdentity, receiptId: string, event: string, metadata: object) {
  return database.prepare("INSERT INTO admin_audit_log (id, admin_uid, action, entity_type, entity_id, summary, metadata, created_at) VALUES (?, ?, ?, 'demo_dataset', ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), admin.uid, event, receiptId, event === "demo_cleanup.started" ? "Owner authorised archival of the reviewed synthetic dataset." : "Demo archival recorded its confirmed outcome. No historical records were deleted.", JSON.stringify(metadata), new Date().toISOString());
}

export async function archiveDemoCleanup(database: D1Database, admin: AdminIdentity, expectedDigest: unknown, pilotMembers: Map<string, ComplianceIdentity>) {
  requireRecentDemoCleanupAuthentication(admin);
  if (typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new DemoCleanupError("DEMO_PREVIEW_REQUIRED", 400, "Preview the demo records before archiving them.");
  const before = await previewDemoCleanup(database, admin);
  if (before.digest !== expectedDigest) throw new DemoCleanupError("DEMO_PREVIEW_CHANGED", 409, "The demo records changed after preview. Refresh the preview before archiving.");
  for (const organisationId of before.pilotOrganisationIds) {
    const member = pilotMembers.get(organisationId);
    if (!member || member.uid !== admin.uid || member.organisationId !== organisationId || member.role !== "admin") throw new DemoCleanupError("DEMO_PILOT_ADMIN_REQUIRED", 403, "The owner must also have administrator access to each affected Creditex organisation before archiving its pilot.");
  }
  const receiptId = crypto.randomUUID();
  const archivedPilotIds: string[] = [];
  const applied: Record<string, number> = {};
  await audit(database, admin, receiptId, "demo_cleanup.started", { previewDigest: expectedDigest, groups: before.groups }).run();
  let failure = "";
  try {
    const pilots = before.groups.find(group => group.key === "pilotRuns")?.records || [];
    for (const current of pilots) {
      const member = pilotMembers.get(String(current.organisationId));
      if (!member) throw new DemoCleanupError("DEMO_PILOT_ADMIN_REQUIRED", 403, "Creditex administrator access changed during cleanup.");
      const result = await archiveCreditexVeuPilot(database, member, "ARCHIVE SYNTHETIC VEU PILOT", current);
      if (result.runId !== current.id) throw new DemoCleanupError("DEMO_PREVIEW_CHANGED", 409, "The pilot changed during archival. Review the receipt before continuing.");
      archivedPilotIds.push(result.runId);
    }
    const now = new Date().toISOString();
    const results = await database.batch(groups.map(group => {
      const rows = before.groups.find(snapshot => snapshot.key === group.key)!.records;
      // IDs and revisions come from the reviewed snapshot. Recheck the synthetic relationship
      // in the UPDATE so a row cannot become live between preview and application.
      return database.prepare(`UPDATE ${group.table} SET ${group.assignment}, updated_at = ?
        WHERE NOT EXISTS (${liveLinkConflict}) AND ${group.predicate} AND ${group.pending} AND EXISTS (
          SELECT 1 FROM json_each(?) reviewed WHERE json_extract(reviewed.value, '$.id') = ${group.table}.${group.idColumn}
          AND json_extract(reviewed.value, '$.updatedAt') = ${group.table}.updated_at
          AND json_extract(reviewed.value, '$.status') = (${group.state}))`).bind(now, JSON.stringify(rows));
    }));
    groups.forEach((group, index) => { applied[group.key] = Number(results[index].meta.changes || 0); });
  } catch (error) {
    failure = error instanceof DemoCleanupError ? error.message : "The remaining demo archival did not finish. Refresh the preview before continuing.";
  }
  let after: DemoCleanupPreview | null = null;
  try { after = await previewDemoCleanup(database, admin); }
  catch (error) { failure ||= error instanceof DemoCleanupError ? error.message : "The final state could not be checked. Refresh the preview before continuing."; }
  const receipt = { id: receiptId, previewDigest: expectedDigest, completed: !failure && after?.total === 0,
    archivedPilotIds, applied, remaining: after ? Object.fromEntries(after.groups.map(group => [group.key, group.count])) : null,
    error: failure || (after?.total ? "Some records changed during cleanup and were left untouched. Refresh the preview to review the remaining records." : ""),
    historicalRecordsDeleted: false, completedAt: new Date().toISOString() };
  await audit(database, admin, receiptId, "demo_cleanup.finished", receipt).run();
  return { receipt, preview: after };
}
