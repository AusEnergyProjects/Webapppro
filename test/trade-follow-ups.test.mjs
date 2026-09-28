import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FOLLOW_UP_SETTINGS, DEFAULT_FOLLOW_UP_TEMPLATES, followUpTemplate,
  FOLLOW_UP_FIELDS, followUpEditorText, followUpStoredText, followUpSettings, followUpTimingHours, followUpJobSubject, renderFollowUp, followUpLocalTime, followUpAppointmentEpoch,
} from "../src/lib/trade-follow-ups.ts";

test("automatic reminders default off and starter templates render customer details", () => {
  assert.equal(DEFAULT_FOLLOW_UP_SETTINGS.invoiceEnabled, false);
  assert.equal(DEFAULT_FOLLOW_UP_SETTINGS.appointmentEnabled, false);
  for (const id of ["general-follow-up", "quote-follow-up", "overdue-invoice", "appointment-reminder"]) {
    assert.ok(DEFAULT_FOLLOW_UP_TEMPLATES.some(template => template.id === id));
  }
  const rendered = renderFollowUp(DEFAULT_FOLLOW_UP_TEMPLATES.find(t => t.id === "general-follow-up"), {
    customer_name: "Alex", business_name: "Example Trade", job_number: "TLJ-1", job_title: "Roof repair",
  });
  assert.match(rendered.body, /Hi Alex,/);
  assert.match(rendered.body, /TLJ-1/);
  assert.deepEqual(rendered.missing, []);
});

test("templates reject unsupported and inherited token names", () => {
  const template = { id: "test", name: "Test", kind: "general", subject: "Hello", body: "Hi {customer_name}" };
  for (const token of ["unknown_field", "toString", "constructor", "__proto__"]) {
    assert.throws(() => followUpTemplate({ ...template, body: `Hi {${token}}` }), /FOLLOW_UP_FIELD_INVALID/, token);
  }
  assert.equal(followUpTemplate(template).body, template.body);
});

test("rendering never substitutes inherited properties", () => {
  const result = renderFollowUp({ subject: "Hello", body: "{toString} {customer_name}" }, {});
  assert.equal(result.body, "{toString} {customer_name}");
  assert.ok(result.missing.includes("Customer name"));
  assert.equal(result.missing.length, 3);
});

test("unavailable fields stay visible and report their labels", () => {
  const result = renderFollowUp({ subject: "Invoice {invoice_number}", body: "Due {invoice_due_date}" }, { invoice_number: "INV-1" });
  assert.equal(result.subject, "Invoice INV-1");
  assert.equal(result.body, "Due {invoice_due_date}");
  assert.deepEqual(result.missing, ["Invoice due date", "Job number"]);
});

test("template validation rejects header controls and oversized content", () => {
  const template = DEFAULT_FOLLOW_UP_TEMPLATES[0];
  for (const invalid of [{ subject: "Hello\nBcc: attacker@example.test" }, { body: "x".repeat(8001) }, { subject: "x".repeat(201) }]) {
    assert.throws(() => followUpTemplate({ ...template, ...invalid }), /FOLLOW_UP_TEMPLATE_INVALID/);
  }
});

test("reminder settings accept custom timing and reject accidental enablement", () => {
  assert.deepEqual(followUpSettings(DEFAULT_FOLLOW_UP_SETTINGS), DEFAULT_FOLLOW_UP_SETTINGS);
  const custom = { ...DEFAULT_FOLLOW_UP_SETTINGS,
    invoiceTiming: { amount: 2, unit: "weeks", direction: "after" },
    appointmentTiming: { amount: 3, unit: "hours", direction: "before" },
  };
  assert.deepEqual(followUpSettings(custom), custom);
  for (const invalid of [{ invoiceEnabled: "true" },
    { invoiceTiming: { amount: 0, unit: "days", direction: "after" } },
    { appointmentTiming: { amount: 1, unit: "minutes", direction: "before" } },
    { invoiceTiming: { amount: 7, unit: "weeks", direction: "after" } },
    { invoiceTiming: { amount: 1.5, unit: "days", direction: "after" } },
    { appointmentTiming: { amount: 1, unit: "days", direction: "during" } },
  ]) {
    assert.throws(() => followUpSettings({ ...DEFAULT_FOLLOW_UP_SETTINGS, ...invalid }), /FOLLOW_UP_SETTINGS_INVALID/);
  }
});

test("timing hours preserve before/after and equivalent hour day week choices", () => {
  assert.equal(followUpTimingHours({ amount: 3, unit: "hours", direction: "before" }), -3);
  assert.equal(followUpTimingHours({ amount: 3, unit: "days", direction: "after" }), 72);
  assert.equal(followUpTimingHours({ amount: 2, unit: "weeks", direction: "after" }), 336);
  assert.equal(followUpTimingHours({ amount: 1, unit: "weeks", direction: "before" }), -168);
  const largest = { ...DEFAULT_FOLLOW_UP_SETTINGS, invoiceTiming: { amount: 1008, unit: "hours", direction: "after" } };
  assert.deepEqual(followUpSettings(largest).invoiceTiming, largest.invoiceTiming);
});

test("appointment wall times resolve Australian offsets and DST safely", () => {
  assert.equal(new Date(followUpAppointmentEpoch("2026-09-28T14:00", "Australia/Melbourne")).toISOString(), "2026-09-28T04:00:00.000Z");
  assert.equal(new Date(followUpAppointmentEpoch("2026-09-28T14:00", "Australia/Adelaide")).toISOString(), "2026-09-28T04:30:00.000Z");
  assert.equal(new Date(followUpAppointmentEpoch("2026-12-28T14:00", "Australia/Adelaide")).toISOString(), "2026-12-28T03:30:00.000Z");
  assert.equal(new Date(followUpAppointmentEpoch("2026-12-28T14:00", "Australia/Darwin")).toISOString(), "2026-12-28T04:30:00.000Z");
  assert.ok(Number.isNaN(followUpAppointmentEpoch("2026-10-04T02:30", "Australia/Melbourne")));
  const repeated = followUpAppointmentEpoch("2026-04-05T02:30", "Australia/Melbourne");
  assert.equal(followUpLocalTime(new Date(repeated), "Australia/Melbourne"), "2026-04-05T02:30:00");
});

test("readable insert labels round-trip every supported field without exposing code", () => {
  for(const [key,label] of Object.entries(FOLLOW_UP_FIELDS)) {
    const stored='Hello {'+key+'}!';const friendly='Hello ['+label+']!';
    assert.equal(followUpEditorText(stored),friendly);assert.equal(followUpStoredText(friendly),stored);
  }
  const value='Hi [Customer first name], your appointment is [Appointment time].';
  const ready=renderFollowUp({subject:'Visit',body:followUpStoredText(value)},{job_number:'TLJ-123',customer_first_name:'Alex',appointment_time:'9 am'});
  assert.equal(ready.body,'Hi Alex, your appointment is 9 am.');assert.deepEqual(ready.missing,[]);
});
test("readable field conversion preserves ordinary brackets and rejects inherited fields", () => {
  assert.equal(followUpStoredText('[bring ID] [constructor]'),'[bring ID] [constructor]');
  assert.equal(followUpEditorText('{constructor}'),'{constructor}');
});

test("every starter and custom template subject identifies the job once",()=>{
  const fields=Object.fromEntries(Object.keys(FOLLOW_UP_FIELDS).map(key=>[key,"Example"]));fields.job_number="TLJ-123";
  for(const template of [...DEFAULT_FOLLOW_UP_TEMPLATES,{subject:"Custom message",body:"Hello"}]) {
    const rendered=renderFollowUp(template,fields);assert.match(rendered.subject,/TLJ-123/);assert.equal(rendered.subject.length<=200,true);
  }
  assert.equal(followUpJobSubject("Re: TLJ-123 question","TLJ-123"),"Re: TLJ-123 question");
  assert.equal(followUpJobSubject("re: tlj-123 question","TLJ-123"),"re: tlj-123 question");
  assert.equal(followUpJobSubject("TLJ-1234 question","TLJ-123"),"[TLJ-123] TLJ-1234 question");
  assert.equal(followUpJobSubject("x".repeat(200),"TLJ-123").length,200);
  assert.ok(followUpJobSubject("x".repeat(199)+" TLJ-123","TLJ-123").startsWith("[TLJ-123]"));
  assert.throws(()=>followUpJobSubject("Subject",""),/FIELD_MISSING/);
  assert.throws(()=>followUpJobSubject("Subject\nBcc: bad","TLJ-123"),/FIELD_MISSING/);
});
