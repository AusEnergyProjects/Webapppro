import { ComplianceAccessError, type ComplianceIdentity } from './compliance-access-server';
import { resolveCreditexPermissions } from './creditex-permissions';
import { CREDITEX_PARTNER_ORGANISATION_CODE } from './trade-compliance-intent';

/** Native office access uses the same named membership and MFA as the web portal. */
export function creditexAppAccess(member: ComplianceIdentity) {
  if (member.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE) throw new ComplianceAccessError('CREDITEX_PARTNER_REQUIRED', 403, 'Creditex team access is required.');
  const permissions: string[] = resolveCreditexPermissions(member.role, member.permissions);
  const has = (key: string) => permissions.includes(key);
  return {
    workspace: 'creditex' as const, signInMethod: 'named_account' as const,
    member: { id: member.membershipId, uid: member.uid, name: member.displayName, email: member.email,
      organisationId: member.organisationId, organisationName: member.organisationTradingName || member.organisationLegalName, role: member.role },
    permissions,
    capabilities: { jobs: has('jobs'), messages: has('messages'), sendMessages: has('messages_send'),
      tasks: has('tasks'), createTasks: has('tasks_create'), assignTasks: has('tasks_assign'), editTasks: has('tasks_edit'),
      completeTasks: has('tasks_complete'), customers: has('customers'), calculator: true, map: has('jobs') || has('customers') },
  };
}
