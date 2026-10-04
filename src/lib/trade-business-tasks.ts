export const TASK_STATUSES = ['open', 'in_progress', 'done'] as const;
export type BusinessTaskStatus = typeof TASK_STATUSES[number];
export type BusinessTask = {
  id: string; title: string; detail: string; assigneeMemberId: string; assigneeName: string;
  createdByMemberId: string; createdByName: string; status: BusinessTaskStatus; dueOn: string;
  revision: number; createdAt: string; updatedAt: string; completedAt: string; canEdit: boolean;
};
export type TaskPerson = { id: string; name: string };
export type BusinessTaskDraft = { key: string; title: string; detail: string };
const taskJobTabs = new Set(['quote', 'invoice', 'summary', 'schedule', 'messages', 'files']);

/** Notes may contain a job link, but never supply a different business or external destination. */
export function taskJobHref(detail: string, ownerUid: string, memberPortal: boolean): string | undefined {
  if (!ownerUid) return;
  const line = detail.split(/\r?\n/).find(value => value.startsWith('Job: /direct-trade/dashboard?'));
  if (!line) return;
  const url = new URL(line.slice(5), 'https://tlink.invalid');
  const id = url.searchParams.get('jobId') || '';
  const tab = url.searchParams.get('jobTab') || '';
  if (url.origin !== 'https://tlink.invalid' || url.pathname !== '/direct-trade/dashboard'
    || url.searchParams.get('workspace') !== 'work' || url.searchParams.get('business') !== ownerUid
    || !/^[A-Za-z0-9:_-]{1,180}$/.test(id) || !taskJobTabs.has(tab)) return;
  const jobTab = tab === 'files' ? 'field' : tab === 'messages' ? 'summary' : tab;
  return `/direct-trade/${memberPortal ? 'team' : 'dashboard'}?${new URLSearchParams({ workspace: 'work', jobId: id, jobTab, business: ownerUid })}`;
}
export type BusinessTaskList = {
  tasks: BusinessTask[]; memberId: string; canViewTeam: boolean;
  page: number; total: number; totalPages: number;
};
export class BusinessTaskError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function taskText(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new BusinessTaskError(400, 'Check the task details.');
  const text = value.trim();
  if (required && !text) throw new BusinessTaskError(400, 'Add a task title and choose a person.');
  return text;
}
export function taskDueDate(value: unknown): string {
  const date = taskText(value ?? '', 10);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new BusinessTaskError(400, 'Choose a valid due date.');
  return date;
}
export function taskStatus(value: unknown): BusinessTaskStatus {
  if (value === 'open' || value === 'in_progress' || value === 'done') return value;
  throw new BusinessTaskError(400, 'Choose To do, In progress or Done.');
}
