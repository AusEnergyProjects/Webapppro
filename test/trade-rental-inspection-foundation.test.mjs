import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RENTAL_ASSESSMENT_MODULE_KEYS,
  RENTAL_ASSESSMENT_OPTIONAL_MODULE_KEYS,
  VIC_RENTAL_ASSESSMENT_TEMPLATE,
  canonicalRentalJson,
  normalizeRentalAssessmentModules,
  publicRentalReportValue,
  rentalAssessmentCompletion,
  rentalAssessmentItemKey,
  rentalInspectionServiceAddressAccepted,
  publicRentalFinding,
  rentalAssessmentTemplateSnapshot,
  rentalReportExpiresAt,
} from "../src/lib/trade-rental-assessment.mjs";
import { rentalEvidenceCapture, rentalEvidencePhotoCapture } from "../src/lib/trade-rental-evidence.mjs";
import { rentalImageDimensions, rentalImageWithinReportLimit } from "../src/lib/trade-rental-image-dimensions.mjs";
import {
  assertRentalModuleCredentialCurrent,
  currentRentalModuleCredentialSnapshot,
} from "../src/lib/trade-rental-credentials.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("the Victorian minimum standards template is current, source backed and complete", () => {
  const minimum = VIC_RENTAL_ASSESSMENT_TEMPLATE.modules.minimum_standards;
  assert.equal(VIC_RENTAL_ASSESSMENT_TEMPLATE.contract, "tlink-rental-assessment-template-v1");
  assert.equal(VIC_RENTAL_ASSESSMENT_TEMPLATE.jurisdiction, "VIC");
  assert.equal(minimum.sections.length, 15);
  assert.equal(new Set(minimum.sections.map((section) => section.key)).size, 15);
  assert.ok(VIC_RENTAL_ASSESSMENT_TEMPLATE.sources.every((item) => item.url.startsWith("https://")));
  assert.ok(minimum.sections.every((section) => section.checks.length > 0));
  assert.ok(minimum.sections.flatMap((section) => section.checks).every((item) => item.photoGuidance && item.requiredEvidenceCount >= 1));
  assert.doesNotMatch(JSON.stringify(VIC_RENTAL_ASSESSMENT_TEMPLATE), /homes victoria|johns lyng|detector inspector/i);
});

test("minimum standards are mandatory and optional safety modules are explicit", () => {
  assert.deepEqual(RENTAL_ASSESSMENT_MODULE_KEYS, [
    "minimum_standards",
    "electrical_safety_check",
    "gas_safety_check",
    "smoke_alarm_check",
  ]);
  assert.deepEqual(RENTAL_ASSESSMENT_OPTIONAL_MODULE_KEYS, [
    "electrical_safety_check",
    "gas_safety_check",
    "smoke_alarm_check",
  ]);
  assert.deepEqual(normalizeRentalAssessmentModules([]), ["minimum_standards"]);
  assert.equal(rentalInspectionServiceAddressAccepted("rental-inspection", "VIC"), true);
  assert.equal(rentalInspectionServiceAddressAccepted("rental-inspection", "NSW"), false);
  assert.equal(rentalInspectionServiceAddressAccepted("rental-inspection", ""), false);
  assert.equal(rentalInspectionServiceAddressAccepted("electrical", "NSW"), true);
  assert.deepEqual(normalizeRentalAssessmentModules(JSON.stringify([
    "gas_safety_check",
    "unknown",
    "gas_safety_check",
    "electrical_safety_check",
  ])), ["minimum_standards", "electrical_safety_check", "gas_safety_check"]);
  const snapshot = rentalAssessmentTemplateSnapshot(["smoke_alarm_check"]);
  assert.deepEqual(snapshot.selectedModules, ["minimum_standards", "smoke_alarm_check"]);
  assert.deepEqual(Object.keys(snapshot.modules), snapshot.selectedModules);
  for (const key of RENTAL_ASSESSMENT_OPTIONAL_MODULE_KEYS) {
    const assessmentModule = VIC_RENTAL_ASSESSMENT_TEMPLATE.modules[key];
    assert.ok(assessmentModule.sections.length > 0, `${key} must attach real questions`);
    assert.ok(assessmentModule.metadataFields.length > 0, `${key} must capture issuer details`);
    assert.ok(assessmentModule.sections.flatMap((section) => section.checks).every((item) => item.photoGuidance));
  }
});

test("report links expire after 60 days and public findings exclude internal notes", () => {
  assert.equal(rentalReportExpiresAt("2026-08-24T00:00:00.000Z"), "2026-10-23T00:00:00.000Z");
  assert.throws(() => rentalReportExpiresAt("not-a-date"), /INVALID_ISSUED_AT/);
  assert.deepEqual(publicRentalFinding({ id: "f-1", title: "Repair lock", internalNotes: "private", internal_notes: "private sql" }), {
    id: "f-1",
    title: "Repair lock",
  });
  assert.deepEqual(publicRentalReportValue({
    property: { address: "1 Test Street", internalNotes: "private" },
    findings: [{ title: "Repair lock", internal_notes: "private sql" }],
  }), { property: { address: "1 Test Street" }, findings: [{ title: "Repair lock" }] });
  assert.equal(canonicalRentalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
});

test("server-derived completion requires metadata, answers, evidence and quote-ready findings", () => {
  const moduleTemplate = {
    key: "minimum_standards",
    credentialGate: "qualified_assessor",
    metadataFields: [{ key: "declaration", label: "Assessor declaration", type: "checkbox", required: true }],
    sections: [{ key: "locks", title: "Locks", checks: [{
      key: "entry_lock", prompt: "The entry lock works.", required: true,
      repeatBy: "external_entry_door", requiredEvidenceCount: 1,
      credentialGate: "qualified_assessor",
    }] }],
  };
  const itemKey = rentalAssessmentItemKey("minimum_standards", "locks", "entry_lock", "front-door");
  const base = {
    moduleTemplate,
    answers: { declaration: true },
    items: [{ id: "item-1", itemKey, sectionKey: "locks", checkKey: "entry_lock",
      locationLabel: "Front door", outcome: "does_not_meet", requiredEvidenceCount: 1, responseJson: {} }],
    evidenceCounts: { "item-1": 1 },
    findings: [{ itemId: "item-1", title: "Front lock fails", description: "Deadlock does not engage.",
      tradeCategory: "Locksmith", scopeSummary: "Replace the front-door deadlock and prove operation.",
      severity: "required", details: {} }],
  };
  assert.deepEqual(rentalAssessmentCompletion(base), { complete: true, blockers: [] });
  const unsafe = structuredClone(base);
  unsafe.findings[0].severity = "immediate_safety_risk";
  const incomplete = rentalAssessmentCompletion(unsafe);
  assert.equal(incomplete.complete, false);
  assert.match(incomplete.blockers.map((item) => item.label).join(" "), /make-safe action/i);

  const unexplainedNotApplicable = structuredClone(base);
  unexplainedNotApplicable.items[0].outcome = "not_applicable";
  unexplainedNotApplicable.items[0].publicNotes = "";
  unexplainedNotApplicable.findings = [];
  assert.match(rentalAssessmentCompletion(unexplainedNotApplicable).blockers
    .map((item) => item.label).join(" "), /clear public reason/i);
  unexplainedNotApplicable.items[0].publicNotes = "No external stairs are present at this single-level property.";
  assert.deepEqual(rentalAssessmentCompletion(unexplainedNotApplicable), { complete: true, blockers: [] });
});

test("rental evidence preserves capture time and requires GPS for photos", () => {
  const observedAt = "2026-08-24T04:05:06.000Z";
  const documentEnvelope = {
    source: "web_file_upload",
    capture: { captureObservedAtUtc: observedAt, utcOffsetMinutes: 600, timeZone: "Australia/Melbourne" },
    location: { state: "not_required" },
  };
  assert.deepEqual(rentalEvidenceCapture(documentEnvelope), {
    source: "web_file_upload",
    metadataBasis: "device_reported",
    capturedAtUtc: observedAt,
    utcOffsetMinutes: 600,
    timeZone: "Australia/Melbourne",
    locationCaptured: false,
    locationObservedAtUtc: "",
    latitude: null,
    longitude: null,
    accuracyMetres: null,
    locationMocked: null,
  });
  assert.equal(rentalEvidencePhotoCapture(documentEnvelope), null);

  const photoEnvelope = structuredClone(documentEnvelope);
  photoEnvelope.source = "in_app_camera";
  photoEnvelope.location = {
    state: "captured",
    observedAtUtc: observedAt,
    latitude: -37.813629,
    longitude: 144.963058,
    accuracyMetres: 7.4,
  };
  const capture = rentalEvidencePhotoCapture(photoEnvelope);
  assert.ok(capture?.locationCaptured);
  assert.equal(capture.capturedAtUtc, observedAt);
  assert.equal(capture.latitude, -37.813629);
  assert.equal(capture.longitude, 144.963058);
  assert.equal(capture.accuracyMetres, 7.4);
  assert.equal(capture.metadataBasis, "device_reported");

  assert.ok(rentalEvidencePhotoCapture(photoEnvelope, { receivedAtUtc: "2026-08-24T04:06:00.000Z" }));
  const mocked = structuredClone(photoEnvelope);
  mocked.location.mocked = true;
  assert.equal(rentalEvidencePhotoCapture(mocked, { receivedAtUtc: "2026-08-24T04:06:00.000Z" }), null);
  const imprecise = structuredClone(photoEnvelope);
  imprecise.location.accuracyMetres = 100.1;
  assert.equal(rentalEvidencePhotoCapture(imprecise, { receivedAtUtc: "2026-08-24T04:06:00.000Z" }), null);
  const stale = structuredClone(photoEnvelope);
  assert.equal(rentalEvidencePhotoCapture(stale, { receivedAtUtc: "2026-08-24T04:21:00.001Z" }), null);
  const mismatchedTimes = structuredClone(photoEnvelope);
  mismatchedTimes.location.observedAtUtc = "2026-08-24T04:08:00.001Z";
  assert.equal(rentalEvidencePhotoCapture(mismatchedTimes, { receivedAtUtc: "2026-08-24T04:08:30.000Z" }), null);
});

test("rental report images reject malformed and excessive decoded dimensions", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 4096, false);
  view.setUint32(20, 2929, false);
  assert.deepEqual(rentalImageDimensions(png, "image/png"), { width: 4096, height: 2929 });
  assert.equal(rentalImageWithinReportLimit(png, "image/png"), true);
  view.setUint32(16, 4097, false);
  assert.equal(rentalImageWithinReportLimit(png, "image/png"), false);
  assert.equal(rentalImageWithinReportLimit(new Uint8Array([1, 2, 3]), "image/png"), false);
});

test("optional credentials bind to the assigned assessor and remain valid at report issue", async () => {
  const expiresAt = "2026-08-25";
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async first() {
              if (sql.includes("FROM trade_team_members")) {
                return { id: "member-1", display_name: "Alex Assessor", first_name: "Alex", last_name: "Assessor" };
              }
              if (sql.includes("FROM trade_team_member_credentials")) {
                const checkedDate = String(bindings[4] || "");
                if (checkedDate > expiresAt) return null;
                return {
                  credential_type: "licence",
                  name: "Electrician licence",
                  credential_number: "REC-100",
                  issuer: "Energy Safe Victoria",
                  jurisdiction: "VIC",
                  expires_at: expiresAt,
                  updated_at: "2026-08-20T00:00:00.000Z",
                  file_name: "rec-100.pdf",
                  file_title: "Electrician licence",
                  file_sha256: "a".repeat(64),
                  file_updated_at: "2026-08-20T00:00:00.000Z",
                };
              }
              return null;
            },
          };
        },
      };
    },
  };
  const answers = {
    electricianName: "Alex Assessor",
    licenceNumber: "REC-100",
    credentialConfirmed: true,
    assessorDeclaration: true,
  };
  const completedAt = "2026-08-24T01:00:00.000Z";
  const storedSnapshot = await currentRentalModuleCredentialSnapshot({
    db,
    ownerUid: "owner-1",
    assessorMemberId: "member-1",
    moduleKey: "electrical_safety_check",
    requiredCapability: "licensed_electrician",
    answers,
    confirmedAt: completedAt,
  });
  await assertRentalModuleCredentialCurrent({
    db,
    ownerUid: "owner-1",
    assessorMemberId: "member-1",
    moduleKey: "electrical_safety_check",
    requiredCapability: "licensed_electrician",
    answers,
    storedSnapshot,
    completedAt,
    checkedAt: "2026-08-25T10:00:00.000Z",
  });
  await assert.rejects(() => assertRentalModuleCredentialCurrent({
    db,
    ownerUid: "owner-1",
    assessorMemberId: "member-1",
    moduleKey: "electrical_safety_check",
    requiredCapability: "licensed_electrician",
    answers,
    storedSnapshot,
    completedAt,
    checkedAt: "2026-08-26T00:00:00.000Z",
  }), /RENTAL_MODULE_CREDENTIAL_CHANGED/);
  await assert.rejects(() => currentRentalModuleCredentialSnapshot({
    db,
    ownerUid: "owner-1",
    assessorMemberId: "member-1",
    moduleKey: "electrical_safety_check",
    requiredCapability: "licensed_electrician",
    answers: { ...answers, electricianName: "Different Worker" },
    confirmedAt: completedAt,
  }), /RENTAL_MODULE_CREDENTIAL_REQUIRED/);
});

test("job setup and field workspace attach one frozen rental workflow with guarded evidence", async () => {
  const [form, route, assessmentRoute, assessmentPanel, mobilePanel, fieldRoute, assignmentHelper, migration, schema] = await Promise.all([
    source("src/components/TradeNewJobForm.tsx"),
    source("src/app/api/trade-crm/route.ts"),
    source("src/app/api/trade-rental-inspections/route.ts"),
    source("src/components/TradeRentalInspectionPanel.tsx"),
    source("mobile/src/components/rental-inspection-workflow.tsx"),
    source("src/app/api/trade-field-work/route.ts"),
    source("src/lib/trade-rental-assignment-server.ts"),
    source("drizzle/0160_trade_rental_inspections.sql"),
    source("db/schema.ts"),
  ]);
  assert.match(form, /Rental inspection/);
  assert.match(form, /rentalInspectionModulesJson/);
  assert.match(form, /Rental minimum standards included/);
  assert.match(route, /INSERT INTO trade_rental_inspections/);
  assert.match(route, /INSERT INTO trade_rental_inspection_modules/);
  assert.match(route, /rentalInspectionAttached/);
  assert.match(route, /Rental inspections require a Victorian service address/);
  assert.match(assessmentRoute, /assignedJob\(access, workOrderId\)/);
  assert.match(assessmentRoute, /FIELD_EVIDENCE_MANAGEMENT_REQUIRED/);
  assert.match(assessmentRoute, /RENTAL_INSPECTION_LOCKED/);
  assert.match(assessmentRoute, /RENTAL_REPORT_CLEANUP_REQUIRED/);
  assert.match(assessmentRoute, /jobMediaId/);
  assert.match(assessmentRoute, /media\.work_order_id|work_order_id = \?/);
  assert.match(assessmentRoute, /rentalAssessmentCompletion/);
  assert.match(assessmentPanel, /capture="environment"/);
  assert.match(assessmentPanel, /fresh device-reported GPS position within 100 metres/);
  assert.match(assessmentPanel, /Location access is off\. Allow location for TLink in your browser settings/);
  assert.match(assessmentPanel, /GPS took too long\. Move to an open area/);
  assert.match(assessmentPanel, /Save section and continue/);
  assert.match(assessmentPanel, /for \(const draft of drafts\)/);
  assert.match(mobilePanel, /Save section and continue/);
  assert.match(mobilePanel, /for \(const draft of drafts\)/);
  assert.match(mobilePanel, /next\.delete\(draft\.dirtyKey\)/);
  assert.match(mobilePanel, /if \(!draft\.item\.id\)/);
  assert.match(mobilePanel, /savedCount > 0/);
  assert.match(fieldRoute, /rentalEvidencePhotoCapture\(evidenceEnvelope, \{ receivedAtUtc: now \}\)/);
  assert.match(assessmentPanel, /Internal assessment note/);
  assert.match(assessmentPanel, /Quote-ready scope/);
  assert.match(assignmentHelper, /rentalInspectionAssignmentStatements/);
  assert.match(assignmentHelper, /UPDATE trade_rental_inspections/);
  assert.match(assignmentHelper, /assessor_snapshot/);
  assert.match(assignmentHelper, /UPDATE trade_rental_inspection_modules/);
  assert.match(assignmentHelper, /rental_assignment_guard/);
  for (const table of [
    "trade_rental_inspections",
    "trade_rental_inspection_modules",
    "trade_rental_inspection_items",
    "trade_rental_findings",
    "trade_rental_evidence_links",
    "trade_rental_reports",
    "trade_rental_report_links",
    "trade_rental_inspection_events",
  ]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
    assert.match(schema, new RegExp(`sqliteTable\\(\"${table}\"`));
  }
  assert.match(migration, /trade_rental_report_links_token_idx/);
  assert.match(migration, /trade_rental_report_links_active_report_idx/);
  assert.match(assessmentRoute, /rentalEvidencePhotoCapture/);
});
