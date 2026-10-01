// Sites installs trigger bodies through prepared statements after 0231 creates the tables.
export const TRADE_CREW_SCHEMA_GUARDS = [
  {
    "name": "trade_crews_lead_insert_guard",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crews_lead_insert_guard BEFORE INSERT ON trade_crews\nWHEN NOT EXISTS (SELECT 1 FROM trade_team_members WHERE id=NEW.lead_member_id AND owner_uid=NEW.owner_uid AND status='active' AND member_uid<>owner_uid)\nBEGIN SELECT RAISE(ABORT,'CREW_LEAD_INVALID'); END;"
  },
  {
    "name": "trade_crews_lead_update_guard",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crews_lead_update_guard BEFORE UPDATE OF owner_uid,lead_member_id ON trade_crews\nWHEN NEW.owner_uid<>OLD.owner_uid OR NOT EXISTS (SELECT 1 FROM trade_team_members WHERE id=NEW.lead_member_id AND owner_uid=NEW.owner_uid AND status='active' AND member_uid<>owner_uid)\nBEGIN SELECT RAISE(ABORT,'CREW_LEAD_INVALID'); END;"
  },
  {
    "name": "trade_crew_members_insert_guard",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crew_members_insert_guard BEFORE INSERT ON trade_crew_members\nWHEN NOT EXISTS (SELECT 1 FROM trade_team_members WHERE id=NEW.member_id AND owner_uid=NEW.owner_uid AND status='active' AND member_uid<>owner_uid)\nBEGIN SELECT RAISE(ABORT,'CREW_MEMBER_INVALID'); END;"
  },
  {
    "name": "trade_crew_members_update_guard",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crew_members_update_guard BEFORE UPDATE ON trade_crew_members\nBEGIN SELECT RAISE(ABORT,'CREW_MEMBERSHIP_IMMUTABLE'); END;"
  },
  {
    "name": "trade_crew_members_restrict_access",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crew_members_restrict_access AFTER INSERT ON trade_crew_members\nBEGIN\n  UPDATE trade_team_members SET job_scope='own',schedule_scope='own',can_create_jobs=0,can_manage_team=0,can_edit_team_permissions=0,\n    can_view_customers=0,can_manage_customers=0,can_search_customers=0,can_view_quotes=0,can_manage_quotes=0,can_send_quotes=0,\n    can_view_invoices=0,can_manage_invoices=0,can_view_price_book=0,can_manage_price_book=0,can_apply_discounts=0,can_send_sms=0\n    WHERE owner_uid=NEW.owner_uid AND id=NEW.member_id;\nEND;"
  },
  {
    "name": "trade_crew_members_permission_guard",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crew_members_permission_guard BEFORE UPDATE ON trade_team_members\nWHEN EXISTS (SELECT 1 FROM trade_crew_members WHERE owner_uid=NEW.owner_uid AND member_id=NEW.id)\n  AND (NEW.job_scope<>'own' OR NEW.schedule_scope<>'own' OR NEW.can_create_jobs<>0\n    OR NEW.can_manage_team<>0 OR NEW.can_edit_team_permissions<>0 OR NEW.can_view_customers<>0 OR NEW.can_manage_customers<>0\n    OR NEW.can_search_customers<>0 OR NEW.can_view_quotes<>0 OR NEW.can_manage_quotes<>0 OR NEW.can_send_quotes<>0\n    OR NEW.can_view_invoices<>0 OR NEW.can_manage_invoices<>0 OR NEW.can_view_price_book<>0 OR NEW.can_manage_price_book<>0\n    OR NEW.can_apply_discounts<>0 OR NEW.can_send_sms<>0)\nBEGIN SELECT RAISE(ABORT,'CREW_SCOPE_REQUIRED'); END;"
  }
] as const;
