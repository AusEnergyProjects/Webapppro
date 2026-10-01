export const WORK_TIME_FORM_KINDS = ["job_form", "activity_record", "work_pack", "rental_inspection"] as const;
export type WorkTimeFormKind = typeof WORK_TIME_FORM_KINDS[number];
export type WorkTimeSessionInput = {
  id: string; kind: "app" | "form"; source: "web" | "native";
  formKind: WorkTimeFormKind | ""; formId: string; workOrderId: string; pageKey: string; pageTitle: string;
  startedAt: string; endedAt: string;
  completedAt?: string;
};
export type WorkTimeInterval = { startedAt: string; endedAt: string };
export type WorkTimeMemberSummary = {
  memberId: string; name: string; appSeconds: number; formSeconds: number;
  jobSeconds: number; workSeconds: number; jobs: number;
};
export type WorkTimeFormSummary = {
  key: string; formId: string; formKind: WorkTimeFormKind; title: string;
  workOrderId: string; workNumber: string; members: string[];
  activeSeconds: number; weekSeconds: number; elapsedSeconds: number; weekElapsedSeconds: number; firstStartedAt: string; lastActiveAt: string; completedAt: string; workFinishedAt: string;
  pages: { key: string; title: string; firstStartedAt: string; lastActiveAt: string; activeSeconds: number; weekSeconds: number; elapsedSeconds: number }[];
};
export type WorkTimeJobSummary = {
  memberId: string; memberName: string; workOrderId: string; workNumber: string; title: string;
  firstStartedAt: string; lastActiveAt: string; activeSeconds: number; elapsedSeconds: number; status: string;
};
export type WorkTimeReport = {
  generatedAt: string; weekStart: string; weekEnd: string; timeZone: string;
  scope: "business" | "crew" | "self"; members: WorkTimeMemberSummary[];
  forms: WorkTimeFormSummary[]; jobs: WorkTimeJobSummary[];
};

export class WorkTimeInputError extends Error {}
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,179}$/;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = ["id", "kind", "source", "formKind", "formId", "workOrderId", "pageKey", "pageTitle", "startedAt", "endedAt"];
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function parseWorkTimeBatch(value: unknown, now = Date.now()): WorkTimeSessionInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1
    || !("sessions" in value) || !Array.isArray(value.sessions) || !value.sessions.length || value.sessions.length > 30) {
    throw new WorkTimeInputError("Send between 1 and 30 activity sessions.");
  }
  const ids = new Set<string>();
  return value.sessions.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || keys.some(key => !(key in entry)) || Object.keys(entry).some(key => !keys.includes(key) && key !== "completedAt")) throw new WorkTimeInputError("Invalid activity session.");
    const row = entry as Record<string, unknown>;
    const formKind = WORK_TIME_FORM_KINDS.find(kind => kind === row.formKind) || "";
    if (typeof row.id !== "string" || !sessionIdPattern.test(row.id) || ids.has(row.id)
      || (row.kind !== "app" && row.kind !== "form") || (row.source !== "web" && row.source !== "native")
      || typeof row.formId !== "string" || typeof row.workOrderId !== "string"
      || typeof row.pageKey !== "string" || typeof row.pageTitle !== "string"
      || row.pageKey.length > 180 || row.pageTitle.length > 160 || /[\u0000-\u001f]/.test(row.pageKey + row.pageTitle)
      || (row.workOrderId !== "" && !idPattern.test(row.workOrderId))
      || (row.kind === "form" ? !formKind || !idPattern.test(row.formId) || !row.workOrderId : row.formKind !== "" || row.formId !== "")
      || (row.kind === "form" ? !row.pageKey.trim() || !row.pageTitle.trim() : row.pageKey !== "" || row.pageTitle !== "")
      || !timestamp(row.startedAt) || !timestamp(row.endedAt)) throw new WorkTimeInputError("Invalid activity session.");
    const start = Date.parse(row.startedAt), end = Date.parse(row.endedAt);
    if (row.completedAt !== undefined && row.completedAt !== "" && (row.kind !== "form" || !timestamp(row.completedAt) || row.completedAt !== row.endedAt)) throw new WorkTimeInputError("Invalid form completion timestamp.");
    if (end < start || end - start > 86_400_000 || start < now - 14 * 86_400_000 || end > now + 300_000) {
      throw new WorkTimeInputError("Activity timestamps must be ordered, within the last 14 days, and no more than 24 hours per session. Check this device's clock.");
    }
    ids.add(row.id);
    return { id: row.id, kind: row.kind, source: row.source, formKind, formId: row.formId,
      workOrderId: row.workOrderId, pageKey: row.pageKey, pageTitle: row.pageTitle, startedAt: row.startedAt, endedAt: row.endedAt,
      ...(typeof row.completedAt === "string" && row.completedAt ? { completedAt: row.completedAt } : {}) };
  });
}

/** Union, rather than sum, prevents concurrent tabs/devices inflating a person's time. */
export function workTimeSeconds(intervals: WorkTimeInterval[], from: string, to: string): number {
  const lower = Date.parse(from), upper = Date.parse(to);
  const ranges = intervals.map(value => [Math.max(lower, Date.parse(value.startedAt)), Math.min(upper, Date.parse(value.endedAt))])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start).sort((a, b) => a[0] - b[0]);
  let total = 0, start = 0, end = 0;
  for (const [nextStart, nextEnd] of ranges) {
    if (nextStart > end) { total += end - start; start = nextStart; end = nextEnd; }
    else end = Math.max(end, nextEnd);
  }
  return Math.floor((total + end - start) / 1000);
}

export function workTimeLabel(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? "<1 min" : "0 min";
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** A form stays open while the worker puts the phone away. A resumed page is not a new work boundary. */
export function formPageWindows(entries: Array<WorkTimeInterval & { pageKey: string }>, completedAt: string, now: string): Array<WorkTimeInterval & { pageKey: string }> {
  const ordered = [...entries].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const end = completedAt || now;
  const windows: Array<WorkTimeInterval & { pageKey: string }> = [];
  for (const entry of ordered) {
    if (entry.startedAt > end) continue;
    const previous = windows[windows.length - 1];
    if (previous?.pageKey === entry.pageKey) continue;
    if (previous) previous.endedAt = entry.startedAt;
    windows.push({ pageKey: entry.pageKey, startedAt: entry.startedAt, endedAt: end });
  }
  return windows;
}
