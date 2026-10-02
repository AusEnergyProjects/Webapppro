import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// Versions intentionally survive changes to source jobs, assignments and memberships.
export const creditexJobAuditVersions = sqliteTable('creditex_job_audit_versions', {
  id: text('id').primaryKey().notNull(), organisationId: text('organisation_id').notNull(),
  intentId: text('intent_id').notNull(), workOrderId: text('work_order_id').notNull(), ownerUid: text('owner_uid').notNull(),
  revision: integer('revision').notNull(), outcome: text('outcome').notNull(), checklistVersion: text('checklist_version').notNull(),
  answersJson: text('answers_json').notNull(), callOutcome: text('call_outcome').notNull(),
  callReason: text('call_reason').notNull().default(''), callId: text('call_id').notNull().default(''), note: text('note').notNull().default(''),
  sourceSnapshot: text('source_snapshot').notNull(), sourceSha256: text('source_sha256').notNull(),
  actorKind: text('actor_kind').notNull(), actorUid: text('actor_uid').notNull(), actorMemberId: text('actor_member_id').notNull(),
  actorName: text('actor_name').notNull(), requestId: text('request_id').notNull(), requestSha256: text('request_sha256').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  unique().on(table.organisationId, table.intentId, table.revision), unique().on(table.actorKind, table.actorUid, table.requestId),
  index('creditex_job_audit_job_idx').on(table.organisationId, table.workOrderId, table.revision),
  check('creditex_job_audit_revision_check', sql`${table.revision} > 0`),
  check('creditex_job_audit_outcome_check', sql`${table.outcome} IN ('draft','audited','correction_required')`),
  check('creditex_job_audit_answers_check', sql`json_valid(${table.answersJson})`),
  check('creditex_job_audit_call_outcome_check', sql`${table.callOutcome} IN ('completed','unavailable','not_required')`),
  check('creditex_job_audit_snapshot_check', sql`json_valid(${table.sourceSnapshot})`),
  check('creditex_job_audit_source_hash_check', sql`length(${table.sourceSha256}) = 64`),
  check('creditex_job_audit_actor_check', sql`${table.actorKind} IN ('compliance','admin')`),
  check('creditex_job_audit_request_hash_check', sql`length(${table.requestSha256}) = 64`),
]);
