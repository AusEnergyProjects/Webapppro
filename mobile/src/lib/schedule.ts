type ScheduledJob = { appointmentStartsAt?: string; scheduledStart?: string; stage: string; lifecycleStatus?: string };

export function effectiveJobStart(job: ScheduledJob): string {
  return [job.appointmentStartsAt, job.scheduledStart]
    .find((value) => Boolean(value) && Number.isFinite(Date.parse(value!))) || '';
}

export function isUnscheduledJob(job: ScheduledJob): boolean {
  return !effectiveJobStart(job)
    && !['completed', 'cancelled', 'audited'].includes(job.lifecycleStatus || job.stage)
    && !['completed', 'cancelled'].includes(job.stage);
}
