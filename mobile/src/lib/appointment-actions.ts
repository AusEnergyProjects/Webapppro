import type { FieldJob } from './types';

export type AppointmentAction = 'reschedule' | 'no_show' | 'cancel' | 'update_customer';
export type AppointmentActionContext = {
  job: { id: string; revision: number; stage: string };
  appointment: { id: string; revision: number; status: string; startsAt: string; endsAt: string; memberId: string } | null;
  assignees: { id: string; displayName: string }[];
  permissions: { reschedule: boolean; noShow: boolean; cancel: boolean; editCustomer: boolean };
  customer: { id: string; updatedAt: string; firstName: string; lastName: string; businessName: string; phone: string; email: string } | null;
};
export type AppointmentActionResult = {
  ok: true;
  jobPatch: Partial<Pick<FieldJob, 'revision' | 'stage' | 'lifecycleStatus' | 'scheduledStart' | 'scheduledEnd' | 'assigneeMemberId' | 'assigneeLabel' | 'appointmentId' | 'appointmentStatus' | 'appointmentStartsAt' | 'appointmentEndsAt' | 'customerName' | 'customerPhone'>>;
  email?: { status: string; message: string };
  calendarSync?: { failed?: number | boolean; message?: string };
};

export function appointmentTimeParts(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  const hour24 = match ? Number(match[1]) : 9;
  return { hour: hour24 % 12 || 12, minute: match?.[2] || '00', period: hour24 < 12 ? 'am' : 'pm' };
}

export function appointmentTimeValue(hour: number, minute: string, period: string) {
  return `${String(hour % 12 + (period === 'pm' ? 12 : 0)).padStart(2, '0')}:${minute}`;
}

export function appointmentFormValues(appointment: AppointmentActionContext['appointment'], now = new Date()) {
  const start = appointment?.startsAt ? new Date(appointment.startsAt) : now;
  const date = new Date(Number.isFinite(start.getTime()) ? start : now);
  const duration = appointment ? (Date.parse(appointment.endsAt) - date.getTime()) / 60000 : 60;
  if (appointment) date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    time: appointment ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '09:00',
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 60,
    memberId: appointment?.memberId || '',
  };
}

export function appointmentContactLinks(job: Pick<FieldJob, 'protectedJob' | 'customerPhone' | 'serviceAddress'>, customer: AppointmentActionContext['customer']) {
  if (job.protectedJob) return { directions: '', call: '', email: '' };
  const phone = (customer?.phone ?? job.customerPhone).replace(/[^+\d]/g, '');
  const email = customer?.email.trim() || '';
  return {
    directions: job.serviceAddress ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.serviceAddress)}` : '',
    call: phone ? `tel:${phone}` : '',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${encodeURIComponent(email)}` : '',
  };
}

export function appointmentSavedMessage(action: AppointmentAction, result: AppointmentActionResult) {
  const saved = { reschedule: 'Appointment rescheduled.', no_show: 'No show recorded. Ready to reschedule.', cancel: 'Job cancelled and removed from the schedule.', update_customer: 'Customer details updated.' }[action];
  return [saved, result.email?.message, result.calendarSync?.failed
    ? result.calendarSync.message || 'Google Calendar could not be updated. Retry calendar sync in TLink.' : ''].filter(Boolean).join(' ');
}
