import { desc, sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const portalTeamMessages = sqliteTable("portal_team_messages", {
  id: text("id").primaryKey().notNull(), workspace: text("workspace").notNull(), scopeId: text("scope_id").notNull(),
  senderId: text("sender_id").notNull(), recipientId: text("recipient_id").notNull(), senderUid: text("sender_uid").notNull(),
  senderName: text("sender_name").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull(),
}, table => [
  index("portal_team_messages_conversation").on(table.workspace, table.scopeId, table.senderId, table.recipientId, desc(table.createdAt), desc(table.id)),
  index("portal_team_messages_recipient").on(table.workspace, table.scopeId, table.recipientId, table.senderId, desc(table.createdAt), desc(table.id)),
  check("portal_team_messages_workspace", sql`${table.workspace} IN ('admin','creditex')`),
  check("portal_team_messages_scope", sql`length(${table.scopeId})>0 AND (${table.workspace}<>'admin' OR ${table.scopeId}='platform')`),
  check("portal_team_messages_body", sql`length(${table.body}) BETWEEN 1 AND 4000`),
  check("portal_team_messages_participants", sql`${table.senderId}<>${table.recipientId}`),
]);
export const portalTeamTasks = sqliteTable("portal_team_tasks", {
  id: text("id").primaryKey().notNull(), workspace: text("workspace").notNull(), scopeId: text("scope_id").notNull(),
  title: text("title").notNull(), detail: text("detail").notNull().default(""), assigneeId: text("assignee_id").notNull(),
  creatorId: text("creator_id").notNull(), creatorUid: text("creator_uid").notNull(), creatorName: text("creator_name").notNull(),
  status: text("status").notNull().default("open"), dueOn: text("due_on").notNull().default(""), revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), completedAt: text("completed_at").notNull().default(""),
}, table => [
  index("portal_team_tasks_assignee").on(table.workspace, table.scopeId, table.assigneeId, table.status, table.dueOn, desc(table.createdAt)),
  index("portal_team_tasks_creator").on(table.workspace, table.scopeId, table.creatorId, table.status, desc(table.createdAt)),
  check("portal_team_tasks_workspace", sql`${table.workspace} IN ('admin','creditex')`),
  check("portal_team_tasks_scope", sql`length(${table.scopeId})>0 AND (${table.workspace}<>'admin' OR ${table.scopeId}='platform')`),
  check("portal_team_tasks_title", sql`length(${table.title}) BETWEEN 1 AND 180`),
  check("portal_team_tasks_detail", sql`length(${table.detail})<=3000`),
  check("portal_team_tasks_status", sql`${table.status} IN ('open','done')`),
  check("portal_team_tasks_revision", sql`${table.revision}>0`),
]);
export const portalTeamEvents = sqliteTable("portal_team_events", {
  id: text("id").primaryKey().notNull(), workspace: text("workspace").notNull(), scopeId: text("scope_id").notNull(),
  actorId: text("actor_id").notNull(), actorUid: text("actor_uid").notNull(), entityId: text("entity_id").notNull(),
  action: text("action").notNull(), createdAt: text("created_at").notNull(),
}, table => [
  index("portal_team_events_entity").on(table.workspace, table.scopeId, table.entityId, table.createdAt, table.id),
  check("portal_team_events_workspace", sql`${table.workspace} IN ('admin','creditex')`),
  check("portal_team_events_action", sql`${table.action} IN ('task.created','task.edited','task.completed','task.reopened')`),
]);
