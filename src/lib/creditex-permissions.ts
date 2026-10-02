export const CREDITEX_PERMISSION_GROUPS = [
  { label: "Daily work", permissions: [
    { key: "jobs", label: "Jobs and corrections", description: "View assigned jobs, evidence and the corrections queue." },
    { key: "audit", label: "Audit jobs", description: "Record audit answers and request corrections on accessible jobs." },
    { key: "customers", label: "Customers and calls", description: "View authorised customer contacts and use customer calling tools." },
    { key: "messages", label: "Team messages", description: "Read and send private messages with your team." },
    { key: "tasks", label: "Tasks", description: "Use tasks within the member's existing team access." },
    { key: "calculator", label: "Calculator", description: "Use certificate and rebate calculations." },
  ] },
  { label: "Compliance tools", permissions: [
    { key: "forms", label: "Edit activity forms", description: "Edit and publish field form masters, subject to named-user checks." },
    { key: "submissions", label: "Submissions", description: "Use submission and registry tools within the selected role." },
    { key: "governance", label: "Rules and official sources", description: "Use governed source and rule tools. Independent approvals still apply." },
    { key: "team_access", label: "Manage team access", description: "Invite people and change access. Administrator only." },
  ] },
] as const;

export type CreditexPermission = typeof CREDITEX_PERMISSION_GROUPS[number]["permissions"][number]["key"];
export const CREDITEX_PERMISSIONS: readonly CreditexPermission[] = CREDITEX_PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission.key));

export function creditexRolePermissions(role: string): CreditexPermission[] {
  if (role === "admin") return [...CREDITEX_PERMISSIONS];
  if (role === "case_manager" || role === "reviewer") return CREDITEX_PERMISSIONS.filter(key => key !== "team_access");
  if (role === "auditor") return CREDITEX_PERMISSIONS.filter(key => !["forms", "team_access"].includes(key));
  return [];
}

export function isCreditexPermission(value: unknown): value is CreditexPermission {
  return typeof value === "string" && CREDITEX_PERMISSIONS.some(key => key === value);
}

/** Existing roles remain the upper bound; malformed persisted grants fail closed. */
export function resolveCreditexPermissions(role: string, stored: unknown): CreditexPermission[] {
  const allowed = creditexRolePermissions(role);
  if (stored === undefined || stored === null) return allowed;
  let input: unknown = stored;
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { return []; }
  }
  if (!Array.isArray(input) || !input.every(isCreditexPermission)) return [];
  return allowed.filter(key => input.includes(key));
}

export function hasCreditexPermission(identity: { role: string; permissions?: readonly CreditexPermission[] }, key: CreditexPermission) {
  return resolveCreditexPermissions(identity.role, identity.permissions).includes(key);
}

export function creditexPermissionLabel(key: CreditexPermission) {
  for (const group of CREDITEX_PERMISSION_GROUPS) {
    const permission = group.permissions.find(item => item.key === key);
    if (permission) return permission.label;
  }
  return key;
}

/** SQL identifiers are internal literals; permissions and role defaults share this contract. */
export function creditexPermissionSql(permission: CreditexPermission, memberAlias = "member") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(memberAlias)) throw new Error("Invalid compliance member alias.");
  const roles = ["admin", "case_manager", "reviewer", "auditor"].filter(role => creditexRolePermissions(role).includes(permission));
  const column = `${memberAlias}.permissions_json`;
  return `(${memberAlias}.role IN (${roles.map(role => `'${role}'`).join(",")}) AND (${column} IS NULL OR
    (json_valid(${column}) AND json_type(${column})='array'
      AND NOT EXISTS (SELECT 1 FROM json_each(${column}) grant_entry WHERE grant_entry.type<>'text' OR grant_entry.value NOT IN (${CREDITEX_PERMISSIONS.map(key => `'${key}'`).join(",")}))
      AND EXISTS (SELECT 1 FROM json_each(${column}) grant_entry WHERE grant_entry.value='${permission}'))))`;
}
