import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isPublicAssessmentBookingSubmissionId,
  PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION,
  PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE,
  PUBLIC_ASSESSMENT_BOOKING_CONTACT_METHODS,
  PUBLIC_ASSESSMENT_BOOKING_PATHWAYS,
  PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND,
  PUBLIC_ASSESSMENT_BOOKING_STAGES,
} from "../src/lib/public-assessment-booking.mjs";

const component = fs.readFileSync("src/components/PublicAssessmentBookingForm.tsx", "utf8");
const styles = fs.readFileSync("src/components/PublicAssessmentBookingForm.module.css", "utf8");
const page = fs.readFileSync("src/app/book-an-assessment/page.tsx", "utf8");

test("the booking form uses the governed public assessment options", () => {
  assert.deepEqual(PUBLIC_ASSESSMENT_BOOKING_PATHWAYS, [
    "new-home-nathers",
    "existing-home-rating",
    "basix-nsw",
    "unsure",
  ]);
  assert.deepEqual(PUBLIC_ASSESSMENT_BOOKING_STAGES, [
    "early-planning",
    "plans-ready",
    "approval-in-progress",
    "home-already-built",
    "unsure",
  ]);
  assert.deepEqual(PUBLIC_ASSESSMENT_BOOKING_CONTACT_METHODS, ["email", "phone", "either"]);
  assert.match(component, /PUBLIC_ASSESSMENT_BOOKING_PATHWAYS\.map/);
  assert.match(component, /PUBLIC_ASSESSMENT_BOOKING_STAGES\.map/);
  assert.match(component, /PUBLIC_ASSESSMENT_BOOKING_CONTACT_METHODS\.map/);
});

test("the request posts the complete assessment booking payload to the existing lead endpoint", () => {
  assert.equal(PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND, "assessment-booking-request");
  assert.match(component, /fetch\("\/api\/leads", \{/);
  assert.match(component, /method: "POST"/);
  assert.match(component, /"Content-Type": "application\/json"/);
  assert.match(component, /submissionType: "upgrade"/);
  assert.match(component, /enquiry: PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND/);
  for (const key of [
    "submissionId", "assessmentPathway", "name", "email", "phone", "postcode", "state",
    "assessmentStage", "preferredContact", "preferredTiming", "projectNotes", "website",
    "clientStartedAt", "consent",
  ]) {
    assert.match(component, new RegExp(`\\b${key}\\b`));
  }
  assert.match(component, /preferredTiming: preferredTiming\.trim\(\)/);
  assert.match(component, /maxLength=\{160\}/);
});

test("the submission identity remains stable for retries and changes for material edits", () => {
  assert.equal(
    isPublicAssessmentBookingSubmissionId("20260901.123e4567-e89b-42d3-a456-426614174000"),
    true,
  );
  assert.match(component, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\.replaceAll\("-", ""\)/);
  assert.match(component, /crypto\.randomUUID\(\)/);
  assert.match(component, /lastAttemptCore\.current && lastAttemptCore\.current !== core/);
  assert.match(component, /isPublicAssessmentBookingSubmissionId\(submissionId\.current\)/);
  assert.match(component, /preferredTiming: preferredTiming\.trim\(\),[\s\S]*notes: notes\.trim\(\)/);
});

test("the form requires contact, location, stage, consent and keeps notes bounded", () => {
  assert.match(component, /<span>Full name \*<\/span>/);
  assert.match(component, /autoComplete="name" maxLength=\{120\} required/);
  assert.match(component, /<span>Email \*<\/span>/);
  assert.match(component, /autoComplete="email" maxLength=\{254\} required/);
  assert.match(component, /<span>Phone \*<\/span>/);
  assert.match(component, /inputMode="tel" maxLength=\{40\} required/);
  assert.match(component, /<span>Postcode \*<\/span>/);
  assert.match(component, /pattern="\\d\{4\}" maxLength=\{4\} required/);
  assert.match(component, /<span>State or territory \*<\/span>/);
  assert.match(component, /autoComplete="address-level1" required/);
  assert.match(component, /<span>Project stage \*<\/span>/);
  assert.match(component, /<span>Preferred contact \*<\/span>/);
  assert.match(component, /changeConsent\(event\.target\.checked\)\} required/);
  assert.match(component, /maxLength=\{1200\}/);
  assert.match(component, /className=\{styles\.honeypot\}/);
  assert.match(component, /name="assessmentPathway"/);
});

test("the exact consent notice and booking boundary are visible and submitted", () => {
  assert.equal(
    PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE,
    "Use my details to review this assessment booking request and contact me about scope, price, access and appointment options.",
  );
  assert.equal(
    PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION,
    "public-assessment-booking-2026-09-01",
  );
  assert.match(component, /purpose: PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE/);
  assert.match(component, /noticeVersion: PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION/);
  assert.match(component, /This is a booking request, not an appointment confirmation/);
  assert.match(component, /appointment is confirmed only after the pathway, scope, price, access and appointment time are agreed with you/);
  assert.match(component, /Reference \{submitState\.reference\}/);
});

test("the booking page inserts the form without changing its metadata or schema renderer", () => {
  assert.match(page, /import \{ PublicAssessmentBookingForm \}/);
  assert.match(page, /beforeSources=\{<PublicAssessmentBookingForm \/>\}/);
  assert.match(page, /buildAssessmentMetadata\(\{ path, title, description \}\)/);
  assert.match(page, /<AssessmentServicePage/);
});

test("the dedicated form styles provide focus, mobile and honeypot treatment", () => {
  assert.match(styles, /\.fieldGrid input:focus/);
  assert.match(styles, /\.fieldGrid select:focus/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /\.honeypot \{[^}]*left: -10000px/);
  assert.match(styles, /\.pathwayGrid,[\s\S]*\.fieldGrid \{[\s\S]*grid-template-columns: 1fr/);
  assert.doesNotMatch(`${component}${page}`, /\u2013|\u2014/);
});
