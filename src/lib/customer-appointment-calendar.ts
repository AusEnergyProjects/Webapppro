const STATE_TIME_ZONES: Record<string, string> = {
  ACT: "Australia/Sydney",
  NSW: "Australia/Sydney",
  NT: "Australia/Darwin",
  QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide",
  TAS: "Australia/Hobart",
  VIC: "Australia/Melbourne",
  WA: "Australia/Perth",
};

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function calendarStamp(value: string) {
  const match = String(value || "").match(LOCAL_DATE_TIME);
  return match ? `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}00` : "";
}

function bounded(value: unknown, maximum: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function calendarEmail(value: unknown) {
  const email = bounded(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function australianAppointmentTimeZone(state: unknown) {
  return STATE_TIME_ZONES[String(state || "").trim().toUpperCase()] || STATE_TIME_ZONES.NSW;
}

export function customerAppointmentCalendar(input: {
  workNumber: string;
  businessName: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  attendeeEmail?: string;
  organizerEmail?: string;
  sequence?: number;
}) {
  const startsAt = calendarStamp(input.startsAt);
  const endsAt = calendarStamp(input.endsAt);
  if (!startsAt || !endsAt || endsAt <= startsAt) return null;
  const workNumber = bounded(input.workNumber, 40) || "TLink appointment";
  const businessName = bounded(input.businessName, 120) || "your installer";
  const timeZone = Object.values(STATE_TIME_ZONES).includes(input.timeZone) ? input.timeZone : STATE_TIME_ZONES.NSW;
  const title = `${businessName} appointment`;
  const details = `Appointment with ${businessName}. TLink job reference ${workNumber}.`;
  const attendeeEmail = calendarEmail(input.attendeeEmail);
  const organizerEmail = calendarEmail(input.organizerEmail);
  const invitation = Boolean(attendeeEmail && organizerEmail);
  const method = invitation ? "REQUEST" : "PUBLISH";
  const sequence = Math.max(0, Math.min(99, Math.trunc(Number(input.sequence) || 0)));
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", title);
  google.searchParams.set("dates", `${startsAt}/${endsAt}`);
  google.searchParams.set("details", details);
  google.searchParams.set("ctz", timeZone);
  const uid = `${workNumber}-${startsAt}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TLink//Customer Appointment//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}@tlink.ausenergyassessments.com`,
    `DTSTAMP:${startsAt}Z`,
    `DTSTART;TZID=${timeZone}:${startsAt}`,
    `DTEND;TZID=${timeZone}:${endsAt}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(details)}`,
    ...(invitation ? [
      `ORGANIZER;CN=${escapeIcs(businessName)}:mailto:${organizerEmail}`,
      `ATTENDEE;CN=Customer;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${attendeeEmail}`,
      `SEQUENCE:${sequence}`,
    ] : []),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return {
    googleUrl: google.toString(),
    filename: `${workNumber.replace(/[^a-z0-9-]/gi, "-") || "tlink"}-appointment.ics`,
    ics,
    method,
  };
}

export function textAttachment(filename: string, content: string, contentType: string) {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { filename, content: btoa(binary), contentType };
}
