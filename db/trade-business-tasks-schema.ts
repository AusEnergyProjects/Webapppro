import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tradeBusinessTasks = sqliteTable('trade_business_tasks', {
  id: text('id').primaryKey().notNull(), ownerUid: text('owner_uid').notNull(), title: text('title').notNull(), detail: text('detail').notNull().default(''),
  assigneeMemberId: text('assignee_member_id').notNull(), createdByMemberId: text('created_by_member_id').notNull(), status: text('status').notNull().default('open'),
  dueOn: text('due_on').notNull().default(''), revision: integer('revision').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), completedAt: text('completed_at').notNull().default(''),
}, table => [
  index('trade_business_tasks_assignee_idx').on(table.ownerUid, table.assigneeMemberId, table.status, table.dueOn),
  index('trade_business_tasks_creator_idx').on(table.ownerUid, table.createdByMemberId, table.status),
  check('trade_business_tasks_title_check', sql`length(trim(${table.title})) BETWEEN 1 AND 180`),
  check('trade_business_tasks_detail_check', sql`length(${table.detail}) <= 3000`),
  check('trade_business_tasks_status_check', sql`${table.status} IN ('open','in_progress','done')`),
  check('trade_business_tasks_revision_check', sql`${table.revision} >= 1`),
]);
