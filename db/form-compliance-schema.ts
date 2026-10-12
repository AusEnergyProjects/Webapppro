import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const formComplianceTemplateVersions = sqliteTable('form_compliance_template_versions', {
  id: text('id').primaryKey().notNull(), scope: text('scope').notNull(), scopeId: text('scope_id').notNull(),
  formKey: text('form_key').notNull(), title: text('title').notNull(), revision: integer('revision').notNull(),
  questionsJson: text('questions_json').notNull(), sourceSnapshot: text('source_snapshot').notNull(),
  actorUid: text('actor_uid').notNull(), actorName: text('actor_name').notNull(), createdAt: text('created_at').notNull(),
}, table => [
  unique().on(table.scope, table.scopeId, table.formKey, table.revision),
  check('form_compliance_template_scope_check', sql`${table.scope} IN ('business','creditex') AND trim(${table.scopeId})<>'' AND trim(${table.formKey})<>''`),
  check('form_compliance_template_revision_check', sql`${table.revision}>0`),
  check('form_compliance_template_json_check', sql`json_valid(${table.questionsJson}) AND json_type(${table.questionsJson})='array' AND json_array_length(${table.questionsJson}) BETWEEN 1 AND 60 AND json_valid(${table.sourceSnapshot})`),
]);
export const formComplianceReviewVersions = sqliteTable('form_compliance_review_versions', {
  id: text('id').primaryKey().notNull(), scope: text('scope').notNull(), scopeId: text('scope_id').notNull(),
  formKey: text('form_key').notNull(), recordKind: text('record_kind').notNull(), recordId: text('record_id').notNull(),
  workOrderId: text('work_order_id').notNull(), revision: integer('revision').notNull(), status: text('status').notNull(),
  templateRevision: integer('template_revision').notNull(), templateSnapshot: text('template_snapshot').notNull(),
  answersJson: text('answers_json').notNull(), sourceSnapshot: text('source_snapshot').notNull(), sourceHash: text('source_hash').notNull(),
  actorUid: text('actor_uid').notNull(), actorName: text('actor_name').notNull(), createdAt: text('created_at').notNull(),
}, table => [
  unique().on(table.scope, table.scopeId, table.recordKind, table.recordId, table.revision),
  index('form_compliance_review_work_idx').on(table.scope, table.scopeId, table.workOrderId, table.createdAt),
  check('form_compliance_review_scope_check', sql`${table.scope} IN ('business','creditex') AND trim(${table.scopeId})<>''`),
  check('form_compliance_review_kind_check', sql`${table.recordKind} IN ('field','work_pack','job_form')`),
  check('form_compliance_review_status_check', sql`${table.status} IN ('draft','complete')`),
  check('form_compliance_review_revision_check', sql`${table.revision}>0 AND ${table.templateRevision}>=0`),
  check('form_compliance_review_json_check', sql`json_valid(${table.templateSnapshot}) AND json_valid(${table.answersJson}) AND json_type(${table.answersJson})='array' AND json_array_length(${table.answersJson}) BETWEEN 1 AND 60 AND json_valid(${table.sourceSnapshot})`),
  check('form_compliance_review_hash_check', sql`length(${table.sourceHash})=64 AND ${table.sourceHash} NOT GLOB '*[^0-9a-f]*'`),
]);

