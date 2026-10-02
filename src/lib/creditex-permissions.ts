export const CREDITEX_PERMISSION_GROUPS = [
  { label: "Jobs and audits", permissions: [
    { key: "jobs", label: "View jobs and files", description: "Open accessible jobs, field answers, photos and documents." },
    { key: "audit", label: "Complete job audits", description: "Save audit answers and mark eligible jobs audited." },
    { key: "corrections", label: "Request corrections", description: "Return accessible jobs for corrections and manage findings." },
    { key: "jobs_assign", label: "Assign compliance work", description: "Assign and release cases within existing compliance controls." },
    { key: "job_lifecycle", label: "Cancel and restore jobs", description: "Cancel, move jobs to the bin and restore them." },
    { key: "payouts", label: "Record job payments", description: "Record completed payouts on eligible jobs." },
  ] },
  { label: "Customers and communication", permissions: [
    { key: "customers", label: "View customers", description: "See customer contacts for authorised jobs and the customer map." },
    { key: "customer_calls", label: "Call customers", description: "Use the built-in phone for authorised customer contacts." },
    { key: "messages", label: "Read team messages", description: "Open private conversations addressed to this person." },
    { key: "messages_send", label: "Send team messages", description: "Send private messages to people in this workspace." },
  ] },
  { label: "Tasks", permissions: [
    { key: "tasks", label: "View personal tasks", description: "See tasks assigned to or created by this person." },
    { key: "tasks_create", label: "Create tasks", description: "Add tasks for yourself." },
    { key: "tasks_assign", label: "Assign tasks to others", description: "Allocate new tasks or reassign tasks you can edit." },
    { key: "tasks_edit", label: "Edit tasks", description: "Update task details within your task access." },
    { key: "tasks_complete", label: "Complete and reopen tasks", description: "Change the status of accessible tasks." },
    { key: "tasks_team", label: "Manage all team tasks", description: "View all workspace tasks and, with edit access, update them." },
  ] },
  { label: "Forms and submissions", permissions: [
    { key: "forms", label: "Create and edit form drafts", description: "Create and change activity form drafts. Named-user checks apply." },
    { key: "forms_publish", label: "Publish activity forms", description: "Make approved form changes available to field staff." },
    { key: "submissions", label: "View submissions", description: "Review batches, registry records and submission progress." },
    { key: "submissions_manage", label: "Manage submissions", description: "Prepare and update submissions within existing approval rules." },
  ] },
  { label: "Team and administration", permissions: [
    { key: "team_details", label: "Manage team contact details", description: "View the roster and update names, phone numbers and job titles." },
    { key: "team_access", label: "Manage team access", description: "Invite people, suspend access and change permissions." },
    { key: "voice_setup", label: "Manage calling setup", description: "Connect the business phone account and assign its numbers." },
    { key: "governance", label: "View compliance rules", description: "Review official sources and programme rules." },
    { key: "governance_manage", label: "Manage compliance rules", description: "Maintain rules and sources. Independent approvals still apply." },
  ] },
] as const;

// Retained for stored grants and older clients. Calculator is a standard workspace tool.
export type CreditexPermission = typeof CREDITEX_PERMISSION_GROUPS[number]["permissions"][number]["key"] | "calculator";
export const CREDITEX_PERMISSIONS: readonly CreditexPermission[] = [...CREDITEX_PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission.key)), "calculator"];
export const CREDITEX_PERMISSION_DEPENDENCIES: Partial<Record<CreditexPermission, readonly CreditexPermission[]>> = {
  audit: ["jobs"], corrections: ["jobs", "audit"], jobs_assign: ["jobs"], job_lifecycle: ["jobs"], payouts: ["jobs"],
  customer_calls: ["customers"], messages_send: ["messages"], tasks_create: ["tasks"], tasks_assign: ["tasks"],
  tasks_edit: ["tasks"], tasks_complete: ["tasks"], tasks_team: ["tasks"], forms_publish: ["forms"],
  submissions_manage: ["submissions"], governance_manage: ["governance"],
};

/** Role ceilings retain the existing legal and operational authority boundaries. */
export function creditexAllowedPermissions(role: string): CreditexPermission[] {
  if (role === "admin") return [...CREDITEX_PERMISSIONS];
  if (!["case_manager", "reviewer", "auditor"].includes(role)) return [];
  return CREDITEX_PERMISSIONS.filter(key => key !== "team_access" && key !== "voice_setup" && key !== "payouts"
    && (key !== "job_lifecycle" || role === "case_manager")
    && (role !== "auditor" || !["forms", "forms_publish"].includes(key)));
}

/** Null grants preserve pre-existing behaviour; new grants are always explicit. */
export function creditexRolePermissions(role: string): CreditexPermission[] {
  return creditexAllowedPermissions(role).filter(key => role === "admin" || !["team_details", "tasks_team"].includes(key));
}

export const CREDITEX_ACCESS_PRESETS: readonly { id: string; label: string; description: string; role: string; permissions: CreditexPermission[] }[] = [
  { id: "administrator", label: "Administrator", description: "Manage the workspace, team and compliance operations.", role: "admin", permissions: creditexRolePermissions("admin") },
  { id: "compliance_manager", label: "Compliance manager", description: "Coordinate audits, corrections, forms, submissions and team tasks.", role: "case_manager", permissions: creditexAllowedPermissions("case_manager") },
  { id: "auditor", label: "Auditor", description: "Review jobs, call customers, record audits and manage your own tasks.", role: "auditor", permissions: ["jobs", "audit", "corrections", "customers", "customer_calls", "messages", "messages_send", "tasks", "tasks_create", "tasks_assign", "tasks_edit", "tasks_complete", "calculator"] },
  { id: "custom", label: "Custom access", description: "Choose exactly what this person can view and do.", role: "admin", permissions: [] },
];

export function isCreditexPermission(value: unknown): value is CreditexPermission {
  return typeof value === "string" && CREDITEX_PERMISSIONS.some(key => key === value);
}
function hasDependencies(key: CreditexPermission, permissions: readonly CreditexPermission[]): boolean {
  return (CREDITEX_PERMISSION_DEPENDENCIES[key] || []).every(parent => permissions.includes(parent) && hasDependencies(parent, permissions));
}

/** Malformed persisted grants fail closed; child grants cannot bypass their parent. */
export function resolveCreditexPermissions(role: string, stored: unknown): CreditexPermission[] {
  const allowed = creditexAllowedPermissions(role);
  if (stored === undefined || stored === null) return creditexRolePermissions(role);
  let input: unknown = stored;
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { return []; }
  }
  if (!Array.isArray(input) || !input.every(isCreditexPermission)) return [];
  const selected = allowed.filter(key => input.includes(key));
  return selected.filter(key => hasDependencies(key, selected));
}
export function setCreditexPermission(role: string, permissions: readonly CreditexPermission[], key: CreditexPermission, enabled: boolean): CreditexPermission[] {
  const selected = new Set(permissions);
  const add = (item: CreditexPermission) => { selected.add(item); for (const parent of CREDITEX_PERMISSION_DEPENDENCIES[item] || []) add(parent); };
  if (enabled) add(key); else selected.delete(key);
  return resolveCreditexPermissions(role, [...selected]);
}
export function hasCreditexPermission(identity: { role: string; permissions?: readonly CreditexPermission[] }, key: CreditexPermission) {
  return resolveCreditexPermissions(identity.role, identity.permissions).includes(key);
}
export function creditexPermissionLabel(key: CreditexPermission) {
  for (const group of CREDITEX_PERMISSION_GROUPS) {
    const permission = group.permissions.find(item => item.key === key);
    if (permission) return permission.label;
  }
  return key === "calculator" ? "Calculator" : key;
}

/** SQL identifiers are internal literals. SQL and application checks use the same grants. */
export function creditexPermissionSql(permission: CreditexPermission, memberAlias = "member") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(memberAlias)) throw new Error("Invalid compliance member alias.");
  const roles = ["admin", "case_manager", "reviewer", "auditor"];
  const allowedRoles = roles.filter(role => creditexAllowedPermissions(role).includes(permission));
  const defaultRoles = roles.filter(role => creditexRolePermissions(role).includes(permission));
  const column = `${memberAlias}.permissions_json`;
  const dependencies = new Set<CreditexPermission>([permission]);
  const add = (key: CreditexPermission) => { for (const parent of CREDITEX_PERMISSION_DEPENDENCIES[key] || []) { dependencies.add(parent); add(parent); } };
  add(permission);
  const roleList = (values: string[]) => values.length ? `${memberAlias}.role IN (${values.map(role => `'${role}'`).join(",")})` : "0";
  return `(${roleList(allowedRoles)} AND ((${column} IS NULL AND ${roleList(defaultRoles)}) OR
    (json_valid(${column}) AND json_type(${column})='array'
      AND NOT EXISTS (SELECT 1 FROM json_each(${column}) grant_entry WHERE grant_entry.type<>'text' OR grant_entry.value NOT IN (${CREDITEX_PERMISSIONS.map(key => `'${key}'`).join(",")}))
      ${[...dependencies].map(key => `AND EXISTS (SELECT 1 FROM json_each(${column}) grant_entry WHERE grant_entry.value='${key}')`).join("\n")})))`;
}
