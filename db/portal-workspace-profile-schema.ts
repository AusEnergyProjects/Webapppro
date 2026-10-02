import { sql } from "drizzle-orm";
import { check, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const portalWorkspaceProfiles = sqliteTable("portal_workspace_profiles", {
  workspace: text("workspace").notNull(), tenantId: text("tenant_id").notNull(), memberId: text("member_id").notNull(),
  displayName: text("display_name").notNull().default(""), themeKey: text("theme_key").notNull().default("emerald_navy"),
  colourMode: text("colour_mode").notNull().default("day"), updatedAt: text("updated_at").notNull(),
}, table => [
  primaryKey({ columns: [table.workspace, table.tenantId, table.memberId] }),
  check("portal_workspace_profiles_workspace_check", sql`${table.workspace} IN ('admin','creditex')`),
  check("portal_workspace_profiles_colour_mode_check", sql`${table.colourMode} IN ('day','night')`),
]);
