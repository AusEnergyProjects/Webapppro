import type { WorkTimeSessionInput } from "./trade-work-time";
/** Browser/native timing only. Authorisation and reporting remain server-owned. */
export type ClientWorkTimeSession = WorkTimeSessionInput;
export type WorkTimeContext = Pick<ClientWorkTimeSession, "kind" | "formKind" | "formId" | "workOrderId" | "pageKey" | "pageTitle">;
export const WORK_TIME_IDLE_MS = 120_000;
export const WORK_TIME_HEARTBEAT_MS = 30_000;
const DAY_MS = 86_400_000;

export function workTimePageKey(value: string) {
  if (value.length <= 180) return value;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `${value.slice(0, 160)}:${(hash >>> 0).toString(16)}`;
}

export class WorkTimeRecorder {
  private contexts = new Map<string, WorkTimeContext>();
  private sessions = new Map<string, ClientWorkTimeSession>();
  private foreground = false;
  private lastActivity = 0;

  private readonly options: {
    source: ClientWorkTimeSession["source"];
    now: () => number;
    uuid: () => string;
    emit: (session: ClientWorkTimeSession) => void;
  };
  constructor(options: WorkTimeRecorder["options"]) { this.options = options; }

  setContext(key: string, context: WorkTimeContext | null) {
    const previous = this.contexts.get(key);
    if (JSON.stringify(previous || null) === JSON.stringify(context)) return false;
    this.checkpoint();
    this.sessions.delete(key);
    if (context) this.contexts.set(key, context); else this.contexts.delete(key);
    this.startMissing();
    return true;
  }

  setForeground(foreground: boolean) {
    if (this.foreground === foreground) return;
    this.checkpoint();
    this.foreground = foreground;
    if (!foreground) this.sessions.clear();
    else { this.lastActivity = this.options.now(); this.startMissing(); }
  }

  activity() {
    if (!this.foreground) return;
    if (this.options.now() >= this.lastActivity + WORK_TIME_IDLE_MS) this.checkpoint();
    this.lastActivity = this.options.now();
    this.startMissing();
  }

  completeForm(context: WorkTimeContext) {
    if (context.kind !== "form" || !context.formId || !context.pageKey) return;
    this.checkpoint();
    for (const [key, active] of this.contexts) {
      if (active.kind === "form" && active.formKind === context.formKind && active.formId === context.formId && active.workOrderId === context.workOrderId) {
        this.contexts.delete(key);
        this.sessions.delete(key);
      }
    }
    const timestamp = new Date(this.options.now()).toISOString();
    this.options.emit({ ...context, id: this.options.uuid(), source: this.options.source,
      startedAt: timestamp, endedAt: timestamp, completedAt: timestamp });
  }

  checkpoint() {
    const now = this.options.now();
    const end = Math.min(now, this.lastActivity + WORK_TIME_IDLE_MS);
    for (const [key, session] of this.sessions) {
      const start = Date.parse(session.startedAt);
      const boundedEnd = Math.min(end, start + DAY_MS);
      if (boundedEnd > start && boundedEnd > Date.parse(session.endedAt)) {
        const next = { ...session, endedAt: new Date(boundedEnd).toISOString() };
        this.sessions.set(key, next);
        this.options.emit(next);
      }
      if (now >= this.lastActivity + WORK_TIME_IDLE_MS || now < start || end >= start + DAY_MS) this.sessions.delete(key);
    }
    this.startMissing();
  }

  private startMissing() {
    const now = this.options.now();
    if (!this.foreground || now >= this.lastActivity + WORK_TIME_IDLE_MS) return;
    for (const [key, context] of this.contexts) {
      if (!this.sessions.has(key)) {
        const timestamp = new Date(now).toISOString();
        const session = { ...context, source: this.options.source, id: this.options.uuid(), startedAt: timestamp, endedAt: timestamp };
        this.sessions.set(key, session);
        // Retain the observed opening immediately, including a page followed
        // straight away by the camera/background before the first heartbeat.
        this.options.emit(session);
      }
    }
  }
}

export type WorkTimeStorage = {
  list: () => Promise<ClientWorkTimeSession[]>;
  put: (session: ClientWorkTimeSession) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

/** One instance belongs to one immutable account/business scope. Writes and receipts are serialised. */
export class WorkTimeQueue {
  private writes: Promise<void> = Promise.resolve();
  private flushing = false;
  private storageFailed = false;

  private readonly options: {
    storage: WorkTimeStorage;
    send: (sessions: ClientWorkTimeSession[]) => Promise<void>;
    canSend: () => boolean;
    status: (message: string) => void;
    now?: () => number;
  };
  constructor(options: WorkTimeQueue["options"]) { this.options = options; }

  enqueue(session: ClientWorkTimeSession) {
    this.writes = this.writes.then(async () => {
      await this.options.storage.put(session);
      this.storageFailed = false;
      if (!this.options.canSend()) this.options.status("Recorded time is saved on this device and waiting to sync.");
    }).catch(() => {
      this.storageFailed = true;
      this.options.status("Time tracking could not be saved on this device. Form answers are unaffected.");
    });
  }

  async flush() {
    if (this.flushing || !this.options.canSend()) return;
    this.flushing = true;
    try {
      await this.writes;
      const all = await this.options.storage.list();
      const oldest = (this.options.now?.() ?? Date.now()) - 14 * DAY_MS;
      const pending = all.filter(item => Date.parse(item.startedAt) >= oldest).slice(0, 30);
      if (!this.options.canSend()) return;
      if (pending.length) {
        await this.options.send(pending);
        // An interval may have grown while the request was in flight. Never
        // discard its newer endpoint when acknowledging the older snapshot.
        this.writes = this.writes.then(async () => {
          const current = new Map((await this.options.storage.list()).map(item => [item.id, item]));
          for (const sent of pending) {
            const retained = current.get(sent.id);
            if (retained && Date.parse(retained.endedAt) <= Date.parse(sent.endedAt)) await this.options.storage.remove(sent.id);
          }
        });
        await this.writes;
      }
      if (!this.storageFailed) this.options.status(all.some(item => Date.parse(item.startedAt) < oldest)
        ? "Some recorded time is older than 14 days and could not sync. Form answers are unaffected." : "");
    } catch {
      this.options.status(this.storageFailed
        ? "Time tracking could not be saved on this device. Form answers are unaffected."
        : "Recorded time is waiting to sync. You can continue completing this form.");
    } finally { this.flushing = false; }
  }
}

export function parseStoredWorkTime(raw: string | null): ClientWorkTimeSession | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !["app", "form"].includes(String(item.kind))
      || !["web", "native"].includes(String(item.source))
      || !["", "job_form", "activity_record", "work_pack", "rental_inspection", "swms"].includes(String(item.formKind))
      || typeof item.formId !== "string" || typeof item.workOrderId !== "string"
      || typeof item.pageKey !== "string" || typeof item.pageTitle !== "string"
      || typeof item.startedAt !== "string" || typeof item.endedAt !== "string"
      || !Number.isFinite(Date.parse(item.startedAt)) || !Number.isFinite(Date.parse(item.endedAt))) return null;
    if (item.completedAt !== undefined && (typeof item.completedAt !== "string" || item.kind !== "form" || item.completedAt !== item.endedAt)) return null;
    return { id: item.id, kind: item.kind as ClientWorkTimeSession["kind"], source: item.source as ClientWorkTimeSession["source"],
      formKind: item.formKind as ClientWorkTimeSession["formKind"], formId: item.formId, workOrderId: item.workOrderId,
      pageKey: item.pageKey, pageTitle: item.pageTitle, startedAt: item.startedAt, endedAt: item.endedAt,
      ...(typeof item.completedAt === "string" ? { completedAt: item.completedAt } : {}) };
  } catch { return null; }
}
