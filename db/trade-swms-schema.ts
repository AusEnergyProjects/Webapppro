import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tradeJobSwms = sqliteTable("trade_job_swms", {
  id: text("id").primaryKey().notNull(), firebaseUid: text("firebase_uid").notNull(), workOrderId: text("work_order_id").notNull(),
  templateKey: text("template_key").notNull(), templateName: text("template_name").notNull(), templateVersion: integer("template_version").notNull(),
  templateSnapshot: text("template_snapshot").notNull(), contextJson: text("context_json").notNull(), answersJson: text("answers_json").notNull(),
  signatureJson: text("signature_json").notNull().default(""), status: text("status").notNull().default("draft"), revision: integer("revision").notNull().default(1),
  lastRequestSha256: text("last_request_sha256").notNull().default(""), snapshotSha256: text("snapshot_sha256").notNull().default(""),
  lastActorUid: text("last_actor_uid").notNull(), lastActorMemberId: text("last_actor_member_id").notNull(),
  completedAt: text("completed_at").notNull().default(""), createdByUid: text("created_by_uid").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [
  uniqueIndex("trade_job_swms_job_idx").on(table.firebaseUid, table.workOrderId),
  index("trade_job_swms_owner_updated_idx").on(table.firebaseUid, table.updatedAt),
  check("trade_job_swms_json_check", sql`json_valid(${table.templateSnapshot}) AND json_valid(${table.contextJson}) AND json_valid(${table.answersJson})`),
  check("trade_job_swms_revision_check", sql`${table.revision}>=1 AND ${table.templateVersion}>=1`),
  check("trade_job_swms_completion_check", sql`(${table.status}='draft' AND ${table.signatureJson}='' AND ${table.completedAt}='' AND ${table.snapshotSha256}='') OR (${table.status}='complete' AND json_valid(${table.signatureJson}) AND ${table.completedAt}<>'' AND length(${table.snapshotSha256})=64)`),
]);
