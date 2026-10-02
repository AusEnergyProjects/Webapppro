import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tradeTeamMembers } from "./schema";

export const tradeMemberEngagement = sqliteTable("trade_member_engagement", {
  ownerUid: text("owner_uid").notNull(), memberId: text("member_id").notNull(),
  encryptedPayload: text("encrypted_payload").notNull(), revision: integer("revision").notNull().default(1),
  lastMutationId: text("last_mutation_id").notNull(), updatedByUid: text("updated_by_uid").notNull(),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.ownerUid, table.memberId] }),
  foreignKey({ columns: [table.ownerUid, table.memberId], foreignColumns: [tradeTeamMembers.ownerUid, tradeTeamMembers.id] }),
  check("trade_member_engagement_revision_check", sql`${table.revision} >= 1`),
  check("trade_member_engagement_payload_check", sql`${table.encryptedPayload} LIKE 'v1.%'`),
]);
