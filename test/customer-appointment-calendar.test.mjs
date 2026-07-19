import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  australianAppointmentTimeZone,
  customerAppointmentCalendar,
  textAttachment,
} from "../src/lib/customer-appointment-calendar.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const publicRoute = read("../src/app/api/job-information/[token]/route.ts");
const customerUi = read("../src/components/JobInformationUpload.tsx");
const deliveryServer = read("../src/lib/photo-request-delivery-server.ts");

test("customer appointments create a timezone-aware Google link and private calendar file", () => {
  assert.equal(australianAppointmentTimeZone("VIC"), "Australia/Melbourne");
  const calendar = customerAppointmentCalendar({ workNumber: "TLJ-00000804", businessName: "Australian Energy Assessments",
    startsAt: "2026-07-20T11:00", endsAt: "2026-07-20T13:00", timeZone: "Australia/Melbourne" });
  assert.ok(calendar);
  const google = new URL(calendar.googleUrl);
  assert.equal(google.hostname, "calendar.google.com");
  assert.equal(google.searchParams.get("dates"), "20260720T110000/20260720T130000");
  assert.equal(google.searchParams.get("ctz"), "Australia/Melbourne");
  assert.match(calendar.ics, /DTSTART;TZID=Australia\/Melbourne:20260720T110000/);
  assert.match(calendar.ics, /TLink job reference TLJ-00000804/);
  assert.doesNotMatch(calendar.ics, /address|street/i);
  const attachment = textAttachment(calendar.filename, calendar.ics, "text/calendar");
  assert.match(Buffer.from(attachment.content, "base64").toString("utf8"), /BEGIN:VCALENDAR/);
});

test("the secure customer page and email expose the same bounded calendar handoff", () => {
  assert.match(publicRoute, /customerAppointmentCalendar/);
  assert.match(publicRoute, /googleCalendarUrl/);
  assert.match(customerUi, /Add to Google Calendar/);
  assert.match(deliveryServer, /text\/calendar; charset=utf-8; method=PUBLISH/);
  assert.match(deliveryServer, /attachments/);
  assert.doesNotMatch(`${publicRoute}\n${customerUi}\n${deliveryServer}`, /[\u2013\u2014]/);
});
