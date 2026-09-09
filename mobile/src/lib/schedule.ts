type ScheduledJob = { appointmentStartsAt?: string; scheduledStart?: string; stage: string; lifecycleStatus?: string; appointmentStatus?: string };

type SearchableJob = {
  workNumber: string; title: string; protectedJob: boolean; siteArea?: string;
  customerName?: string; customerPhone?: string; customerEmail?: string; serviceAddress?: string;
};

export function matchesJobSearch(job: SearchableJob, query: string): boolean {
  const terms = query.toLocaleLowerCase('en-AU').trim().split(/\s+/).filter(Boolean);
  const fields = [job.workNumber, job.title, job.siteArea];
  if (!job.protectedJob) fields.push(job.customerName, job.customerPhone, job.customerEmail, job.serviceAddress);
  const text = fields.filter(Boolean).join(' ').toLocaleLowerCase('en-AU');
  return terms.every((term) => text.includes(term));
}

export function localWorkDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function effectiveJobStart(job: ScheduledJob): string {
  if (['no_show', 'cancelled'].includes(job.lifecycleStatus || job.stage)
    || ['no_show', 'cancelled'].includes(job.stage)) return '';
  return [job.appointmentStartsAt, job.scheduledStart]
    .find((value) => Boolean(value) && Number.isFinite(Date.parse(value!))) || '';
}

export function isVisibleScheduleJob(job: ScheduledJob): boolean {
  return job.stage !== 'cancelled' && job.lifecycleStatus !== 'cancelled';
}

export function isUnscheduledJob(job: ScheduledJob): boolean {
  return !effectiveJobStart(job)
    && !['completed', 'cancelled', 'audited'].includes(job.lifecycleStatus || job.stage)
    && !['completed', 'cancelled'].includes(job.stage);
}
