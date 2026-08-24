import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  directAppointmentDisplayTime,
  directAppointmentInviteDraft,
} from "../src/lib/direct-appointment-invite.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const mobile = read("../mobile/src/app/new-job.tsx");
const mobileApi = read("../mobile/src/lib/api.ts");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const inviteServer = read("../src/lib/direct-appointment-invite-server.ts");
const dedup = read("../src/lib/trade-customer-dedup-server.ts");

test("field job time control covers the full day in 15-minute intervals", () => {
  assert.match(mobile, /Array\.from\(\{ length: 12 \}/);
  assert.match(mobile, /\['00', '15', '30', '45'\]/);
  assert.match(mobile, /\['am', 'pm'\]/);
  assert.match(mobile, /Choose any 15-minute time across the full day/);
  assert.match(mobile, /const minimum = 15; const maximum = 480; const step = 15/);
  assert.match(mobile, /PanResponder\.create/);
  assert.match(mobile, /accessibilityRole="adjustable"/);
  assert.match(mobile, /15-minute intervals/);
});

test("postcode resolves before the user chooses a matching suburb", () => {
  const postcode = mobile.indexOf('label="Postcode"');
  const suburb = mobile.indexOf('label="Suburb"');
  assert.ok(postcode > 0 && postcode < suburb);
  assert.match(mobile, /\/api\/address-localities\?postcode=/);
  assert.match(mobile, /matches\.length === 1/);
  assert.match(mobile, /Choose the correct suburb for this postcode/);
  assert.match(mobile, /accessibilityRole="radio"/);
});

test("an exact saved-customer email can be selected instead of creating a duplicate", () => {
  assert.match(mobile, /find_field_customer_by_email/);
  assert.match(mobile, /Existing customer found/);
  assert.match(mobile, /customerMode: selectedCustomer \? 'existing' : 'new'/);
  assert.match(mobile, /crmCustomerId: selectedCustomer\?\.customerId/);
  assert.match(mobileApi, /public readonly payload/);
  assert.match(crmRoute, /action === "find_field_customer_by_email"/);
  assert.match(crmRoute, /directCustomerHasEmail/);
  assert.match(dedup, /lower\(c\.email\) = \? OR lower\(cc\.email\) = \?/);
});

test("optional TLink invite is requested only after the job and appointment commit", () => {
  assert.match(mobile, /Email the customer a calendar invite/);
  assert.match(mobile, /emailCalendarInvite/);
  const commit = crmRoute.indexOf("await db.batch(batchStatements)");
  const invite = crmRoute.indexOf("await sendDirectAppointmentCalendarInvite", commit);
  assert.ok(commit > 0 && invite > commit);
  assert.match(inviteServer, /messageType: "tlink_direct_appointment_invite"/);
  assert.match(inviteServer, /text\/calendar; charset=utf-8/);
  assert.match(inviteServer, /AbortSignal\.timeout\(8_000\)/);
  assert.match(crmRoute, /customer_calendar_invite_accepted/);
});

test("the invite copy is TLink branded, timezone readable and calendar compatible", () => {
  assert.equal(directAppointmentDisplayTime("2026-08-26T00:15"), "Wednesday 26 August 2026 at 12:15 am");
  assert.equal(directAppointmentDisplayTime("2026-08-26T23:45"), "Wednesday 26 August 2026 at 11:45 pm");
  const draft = directAppointmentInviteDraft({
    workNumber: "TLJ-TEST123",
    businessName: "Example Electrical",
    customerName: "John Smith",
    customerEmail: "john@example.com",
    organizerEmail: "bookings@example.com",
    startsAt: "2026-08-26T09:15",
    endsAt: "2026-08-26T10:45",
    timeZone: "Australia/Melbourne",
  });
  assert.ok(draft);
  assert.match(draft.subject, /Example Electrical appointment/);
  assert.match(draft.html, />TLink</);
  assert.match(draft.html, /Add to Google Calendar/);
  assert.match(draft.calendar.ics, /TLink job reference TLJ-TEST123/);
  assert.match(draft.calendar.ics, /METHOD:REQUEST/);
  assert.doesNotMatch(`${draft.body}\n${draft.html}`, /street address|internal notes/i);
});

test("new field job sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${mobile}\n${mobileApi}\n${crmRoute}\n${inviteServer}\n${dedup}`, /[\u2013\u2014]/);
});
