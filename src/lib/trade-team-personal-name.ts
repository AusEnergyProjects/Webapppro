// These aliases are source-owned SQL identifiers, never request input. Read the
// owner's personal name directly so records predating its team-row projection
// are correct without requiring that owner to open the app first.
export function tradeTeamPersonalNameSql(member: 'trade_team_members' | 'person' | 'other' | 'm'): string {
  return `CASE WHEN ${member}.member_uid=${member}.owner_uid THEN
    COALESCE((SELECT NULLIF(trim(personal_owner.manager_name),'') FROM trade_accounts personal_owner
      WHERE personal_owner.firebase_uid=${member}.owner_uid),${member}.display_name)
    ELSE ${member}.display_name END`;
}
