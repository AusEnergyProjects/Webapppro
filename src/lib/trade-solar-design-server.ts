import { getD1 } from "../../db";
import { canManageQuotes, canViewQuotes, type TeamAccess } from "./trade-team-server";
import { normalizeSolarDesignInput, solarDesignRecordId, solarDesignRevision, SOLAR_DESIGN_PAGE_SIZE, type SolarDesign, type SolarDesignInput, type SolarDesignSummary } from "./trade-solar-design";

type Row = Record<string, unknown>;
type Scope = { sql: string; bindings: string[] };

export function assertSolarDesignAccess(access: TeamAccess, edit = false) {
  if (!canViewQuotes(access) || (edit && !canManageQuotes(access))) throw new Error("SOLAR_DESIGN_ACCESS_REQUIRED");
}
function canBrowseDesigns(access: TeamAccess) {
  return !access.fieldSessionId && (access.isOwner || (access.canViewCustomers && access.canSearchCustomers && access.jobScope === "team"));
}
function assertBrowse(access: TeamAccess) {
  assertSolarDesignAccess(access);
  if (!canBrowseDesigns(access)) throw new Error("SOLAR_DESIGN_BROWSE_REQUIRED");
}

/** The same predicate guards reads and writes, including linkage and assignment changes during a save. */
function designScope(access: TeamAccess, alias: string): Scope {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid static design alias.");
  const assignment = access.isOwner || access.jobScope === "team" ? "1 = 1" : "work.assignee_member_id = ?";
  return {
    sql: `(
      (${alias}.work_order_id = '' AND ${canBrowseDesigns(access) ? "1" : "0"} = 1 AND (
        ${alias}.customer_id = '' OR EXISTS (
          SELECT 1 FROM trade_crm_customers customer
          WHERE customer.id = ${alias}.customer_id AND customer.firebase_uid = ${alias}.owner_uid
            AND customer.record_status = 'active'
        )
      )) OR (${alias}.work_order_id <> '' AND EXISTS (
        SELECT 1 FROM trade_work_orders work
        JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
        JOIN trade_crm_customers customer ON customer.id = detail.crm_customer_id AND customer.firebase_uid = work.firebase_uid AND customer.record_status = 'active'
        JOIN trade_crm_service_sites site ON site.id = detail.service_site_id AND site.customer_id = customer.id AND site.firebase_uid = work.firebase_uid AND site.record_status = 'active'
        WHERE work.id = ${alias}.work_order_id AND work.firebase_uid = ${alias}.owner_uid
          AND work.partner_type = 'installer' AND work.record_status = 'active'
          AND (${alias}.customer_id = '' OR ${alias}.customer_id = customer.id)
          AND work.source_type <> 'opportunity'
          AND detail.customer_source IN ('trade_owned', 'public_lead_released')
          AND (work.source_type <> 'public_lead' OR (
            detail.customer_source = 'public_lead_released'
            AND length(detail.accepted_disclosure_sha256) = 64
            AND detail.accepted_disclosure_sha256 NOT GLOB '*[^0-9a-f]*'
            AND CASE WHEN json_valid(detail.accepted_disclosure_snapshot)
              THEN json_extract(detail.accepted_disclosure_snapshot, '$.contract') ELSE '' END = 'tlink-public-lead-accepted-disclosure-v1'
          )) AND ${assignment}
      ))
    )`,
    bindings: access.isOwner || access.jobScope === "team" ? [] : [access.memberId],
  };
}

function storedDesign(row: Row): SolarDesign {
  return { ...normalizeSolarDesignInput(JSON.parse(String(row.data_json))), id: String(row.id), revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
async function designRow(access: TeamAccess, id: string) {
  const scope = designScope(access, "design");
  return getD1().prepare(`SELECT design.* FROM trade_solar_designs design
    WHERE design.id = ? AND design.owner_uid = ? AND ${scope.sql}`)
    .bind(id, access.ownerUid, ...scope.bindings).first<Row>();
}
export async function loadSolarDesign(access: TeamAccess, rawId: unknown) {
  assertSolarDesignAccess(access);
  const row = await designRow(access, solarDesignRecordId(rawId, true));
  if (!row) throw new Error("SOLAR_DESIGN_NOT_FOUND");
  return storedDesign(row);
}

export async function listSolarDesigns(access: TeamAccess, filters: { customerId?: unknown; workOrderId?: unknown; offset?: number; search?: unknown } = {}) {
  assertSolarDesignAccess(access);
  const customerId = solarDesignRecordId(filters.customerId), workOrderId = solarDesignRecordId(filters.workOrderId);
  // Field access must enter through one assigned job, never a business design directory.
  if (!workOrderId) assertBrowse(access);
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error("SOLAR_DESIGN_INVALID");
  const search = filters.search ?? "";
  if (typeof search !== "string" || search.length > 100 || /[\u0000-\u001f\u007f]/.test(search)) throw new Error("SOLAR_DESIGN_INVALID");
  const searchPattern = search.trim().replace(/[\\%_]/g, "\\$&");
  const scope = designScope(access, "design");
  const rows = await getD1().prepare(`SELECT design.id, design.title, design.customer_id, design.work_order_id,
      design.panel_count, design.revision, design.created_at, design.updated_at
    FROM trade_solar_designs design WHERE design.owner_uid = ? AND ${scope.sql}
      ${customerId ? "AND design.customer_id = ?" : ""} ${workOrderId ? "AND design.work_order_id = ?" : ""}
      ${searchPattern ? "AND design.title LIKE ? ESCAPE '\\'" : ""}
    ORDER BY design.updated_at DESC, design.id LIMIT ? OFFSET ?`)
    .bind(access.ownerUid, ...scope.bindings, ...(customerId ? [customerId] : []), ...(workOrderId ? [workOrderId] : []), ...(searchPattern ? [`%${searchPattern}%`] : []), SOLAR_DESIGN_PAGE_SIZE + 1, offset).all<Row>();
  const designs: SolarDesignSummary[] = rows.results.slice(0, SOLAR_DESIGN_PAGE_SIZE).map((row) => ({
    id: String(row.id), title: String(row.title), customerId: String(row.customer_id), workOrderId: String(row.work_order_id),
    panelCount: Number(row.panel_count), revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
  return { designs, hasMore: rows.results.length > SOLAR_DESIGN_PAGE_SIZE };
}

async function resolveCustomer(access: TeamAccess, design: SolarDesignInput): Promise<SolarDesignInput> {
  if (!design.workOrderId || design.customerId) return design;
  const scope = designScope(access, "context");
  const row = await getD1().prepare(`SELECT detail.crm_customer_id FROM trade_crm_job_details detail,
      (SELECT ? owner_uid, '' customer_id, ? work_order_id) context
    WHERE detail.work_order_id = context.work_order_id AND detail.firebase_uid = context.owner_uid AND ${scope.sql}`)
    .bind(access.ownerUid, design.workOrderId, ...scope.bindings).first<Row>();
  if (!row) throw new Error("SOLAR_DESIGN_CONTEXT_UNAVAILABLE");
  return { ...design, customerId: String(row.crm_customer_id) };
}

export async function saveSolarDesign(access: TeamAccess, raw: unknown, rawId: unknown, rawRevision: unknown): Promise<SolarDesign> {
  assertSolarDesignAccess(access, true);
  const expectedRevision = solarDesignRevision(rawRevision);
  const requestedId = solarDesignRecordId(rawId);
  if (expectedRevision > 0 && !requestedId) throw new Error("SOLAR_DESIGN_INVALID");
  const id = requestedId || crypto.randomUUID();
  const design = await resolveCustomer(access, normalizeSolarDesignInput(raw));
  const data = JSON.stringify(design), now = new Date().toISOString();
  const target = designScope(access, "target");
  const targetSql = `EXISTS (SELECT 1 FROM (SELECT ? owner_uid, ? customer_id, ? work_order_id) target WHERE ${target.sql})`;
  const targetBindings = [access.ownerUid, design.customerId, design.workOrderId, ...target.bindings];
  const db = getD1();
  if (expectedRevision === 0) {
    const result = await db.prepare(`INSERT INTO trade_solar_designs
      (id, owner_uid, customer_id, work_order_id, title, panel_count, data_json, revision, created_by_uid, updated_by_uid, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ? WHERE ${targetSql}
      ON CONFLICT(id) DO NOTHING`)
      .bind(id, access.ownerUid, design.customerId, design.workOrderId, design.title, design.panels.length, data, access.actorUid, access.actorUid, now, now, ...targetBindings).run();
    if (Number(result.meta.changes) !== 1) {
      const existing = await designRow(access, id);
      if (existing) {
        if (Number(existing.revision) === 1 && String(existing.data_json) === data) return storedDesign(existing);
        throw new Error("SOLAR_DESIGN_REVISION_CONFLICT");
      }
      throw new Error("SOLAR_DESIGN_CONTEXT_UNAVAILABLE");
    }
    return { ...design, id, revision: 1, createdAt: now, updatedAt: now };
  }
  const prior = await designRow(access, id);
  if (!prior) throw new Error("SOLAR_DESIGN_NOT_FOUND");
  if (Number(prior.revision) !== expectedRevision) {
    if (Number(prior.revision) === expectedRevision + 1 && String(prior.data_json) === data && prior.updated_by_uid === access.actorUid) return storedDesign(prior);
    throw new Error("SOLAR_DESIGN_REVISION_CONFLICT");
  }
  const current = designScope(access, "trade_solar_designs");
  const result = await db.prepare(`UPDATE trade_solar_designs
    SET customer_id = ?, work_order_id = ?, title = ?, panel_count = ?, data_json = ?,
      revision = revision + 1, updated_by_uid = ?, updated_at = ?
    WHERE id = ? AND owner_uid = ? AND revision = ? AND ${current.sql} AND ${targetSql}`)
    .bind(design.customerId, design.workOrderId, design.title, design.panels.length, data, access.actorUid, now,
      id, access.ownerUid, expectedRevision, ...current.bindings, ...targetBindings).run();
  if (Number(result.meta.changes) !== 1) {
    const existing = await designRow(access, id);
    if (!existing) throw new Error("SOLAR_DESIGN_NOT_FOUND");
    if (Number(existing.revision) !== expectedRevision) {
      if (Number(existing.revision) === expectedRevision + 1 && String(existing.data_json) === data && existing.updated_by_uid === access.actorUid) return storedDesign(existing);
      throw new Error("SOLAR_DESIGN_REVISION_CONFLICT");
    }
    throw new Error("SOLAR_DESIGN_CONTEXT_UNAVAILABLE");
  }
  return { ...design, id, revision: expectedRevision + 1, createdAt: String(prior.created_at), updatedAt: now };
}

/** Quote handoff only changes verified links, preserving the saved geometry and equipment. */
export async function attachSolarDesign(access: TeamAccess, id: unknown, expectedRevision: unknown, workOrderId: unknown, customerId?: unknown) {
  assertSolarDesignAccess(access, true);
  const current = await loadSolarDesign(access, id);
  if (current.revision !== solarDesignRevision(expectedRevision)) throw new Error("SOLAR_DESIGN_REVISION_CONFLICT");
  return saveSolarDesign(access, { ...current, customerId: solarDesignRecordId(customerId), workOrderId: solarDesignRecordId(workOrderId, true) }, current.id, expectedRevision);
}
