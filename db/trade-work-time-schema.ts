import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tradeWorkTimeSessions = sqliteTable("trade_work_time_sessions", {
  id: text("id").primaryKey().notNull(), ownerUid: text("owner_uid").notNull(),
  memberId: text("member_id").notNull(), actorUid: text("actor_uid").notNull(),
  kind: text("kind").notNull(), source: text("source").notNull(),
  formKind: text("form_kind").notNull().default(""), formId: text("form_id").notNull().default(""),
  formKey: text("form_key").notNull().default(""), formTitle: text("form_title").notNull().default(""),
  pageKey: text("page_key").notNull().default(""), pageTitle: text("page_title").notNull().default(""),
  workOrderId: text("work_order_id").notNull().default(""),
  startedAt: text("started_at").notNull(), endedAt: text("ended_at").notNull(),
  observedCompletedAt: text("observed_completed_at").notNull().default(""),
  receivedAt: text("received_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [
  index("trade_work_time_owner_end_idx").on(table.ownerUid, table.endedAt),
  index("trade_work_time_member_end_idx").on(table.ownerUid, table.memberId, table.endedAt),
  index("trade_work_time_form_idx").on(table.ownerUid, table.formKey, table.startedAt),
  check("trade_work_time_kind_check", sql`${table.kind} IN ('app','form') AND ${table.source} IN ('web','native')`),
  check("trade_work_time_completion_check", sql`${table.observedCompletedAt}='' OR (${table.kind}='form' AND ${table.observedCompletedAt}=${table.endedAt})`),
  check("trade_work_time_page_check", sql`(${table.kind}='app' AND ${table.pageKey}='' AND ${table.pageTitle}='') OR (${table.kind}='form' AND length(${table.pageKey}) BETWEEN 1 AND 180 AND length(${table.pageTitle}) BETWEEN 1 AND 160)`),
  check("trade_work_time_form_check", sql`(${table.kind}='app' AND ${table.formKind}='' AND ${table.formId}='' AND ${table.formKey}='') OR (${table.kind}='form' AND ${table.formKind} IN ('job_form','activity_record','work_pack','rental_inspection') AND ${table.formId}<>'' AND ${table.formKey}<>'' AND ${table.workOrderId}<>'')`),
  check("trade_work_time_range_check", sql`julianday(${table.startedAt}) IS NOT NULL AND julianday(${table.endedAt}) IS NOT NULL AND ${table.endedAt}>=${table.startedAt} AND julianday(${table.endedAt})-julianday(${table.startedAt})<=1`),
]);
