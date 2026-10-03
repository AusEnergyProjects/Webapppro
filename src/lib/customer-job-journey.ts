export type CustomerJobCurrent = {
  stage: "preparing" | "scheduled" | "in_progress" | "completed" | "cancelled";
  appointment: null | { startsAt: string; endsAt: string; label: string; googleCalendarUrl: string };
  photos: null | { status: "needed" | "submitted" | "reviewed"; outstanding: number };
};

export type CustomerJobJourney = {
  decision: "active" | "accepted" | "declined";
  workNumber: string;
  title: string;
  businessName: string;
  expiresAt: string;
  current: CustomerJobCurrent | null;
};

export function customerJobNextStep(journey: CustomerJobJourney) {
  if (journey.decision === "declined") return { title: "Quote declined", detail: "Your decision is saved. Contact the business if your plans change.", action: "document" as const, label: "View decision" };
  if (journey.current?.stage === "cancelled") return { title: "Job cancelled", detail: "Contact the business if you need to discuss this job.", action: "document" as const, label: "View your record" };
  if (journey.decision === "active") return { title: "Your quote is ready", detail: "Review the work and price, then choose whether to proceed.", action: "document" as const, label: "Review quote" };
  if (journey.current?.photos?.status === "needed") return { title: "A few photos are needed", detail: "Add the requested photos so the business can keep your job moving.", action: "photos" as const, label: "Add requested photos" };
  if (journey.current?.stage === "completed") return { title: "Work completed", detail: "Your quote acceptance and invoice record are available below.", action: "document" as const, label: "View your record" };
  if (journey.current?.stage === "in_progress") return { title: "Work is under way", detail: "Your business is working on the job. Keep this link for updates.", action: null, label: "" };
  if (journey.current?.appointment) return { title: "Your appointment is booked", detail: "Your appointment details are below. There is nothing else to do here right now.", action: null, label: "" };
  if (!journey.current) return { title: "Your acceptance is saved", detail: "Current job updates are unavailable. Your saved quote record is still accessible.", action: "document" as const, label: "View your record" };
  return { title: "Your quote is accepted", detail: "The business will confirm the next step. You do not need to submit your details again.", action: null, label: "" };
}

/** Stored appointment values are local wall-clock times, not UTC instants. */
export function customerJobAppointmentLabel(startsAt: string, endsAt: string) {
  const wallDate = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? new Date(`${value}:00Z`) : new Date(NaN);
  const start = wallDate(startsAt), end = wallDate(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return "";
  const date = (value: Date) => value.toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const time = (value: Date) => value.toLocaleTimeString("en-AU", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  return `${date(start)}, ${time(start)} to ${startsAt.slice(0, 10) === endsAt.slice(0, 10) ? "" : `${date(end)}, `}${time(end)}`;
}

export function customerJobLocalNow(now: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
