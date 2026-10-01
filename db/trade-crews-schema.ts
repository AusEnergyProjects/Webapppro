import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tradeCrews = sqliteTable("trade_crews", {
  id: text("id").primaryKey().notNull(),
  ownerUid: text("owner_uid").notNull(),
  name: text("name").notNull(),
  companyName: text("company_name").notNull().default(""),
  leadMemberId: text("lead_member_id").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_crews_owner_id_idx").on(table.ownerUid, table.id),
  uniqueIndex("trade_crews_owner_lead_idx").on(table.ownerUid, table.leadMemberId),
  check("trade_crews_name_check", sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
  check("trade_crews_revision_check", sql`${table.revision} >= 1`),
]);

export const tradeCrewMembers = sqliteTable("trade_crew_members", {
  ownerUid: text("owner_uid").notNull(),
  crewId: text("crew_id").notNull(),
  memberId: text("member_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("trade_crew_members_owner_member_idx").on(table.ownerUid, table.memberId),
  index("trade_crew_members_crew_idx").on(table.ownerUid, table.crewId, table.memberId),
]);
