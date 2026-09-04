import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

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

function executableFunction(source, name) {
  const sourceFile = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration, `missing ${name}`);
  const output = ts.transpileModule(declaration.getText(sourceFile), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return Function(`${output}; return ${name};`)();
}

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

test("mobile address predictions are cancellable, accessible and resolve before filling fields", () => {
  assert.match(mobile, /apiRequest<[^>]+>\('\/api\/trade-address-suggestions'/);
  assert.match(mobile, /type AddressPrediction = \{ id: string; label: string; provider: string \}/);
  assert.match(mobile, /query\.length < 3/);
  assert.match(mobile, /\}, 280\)/);
  assert.match(mobile, /controller\.abort\(\)/);
  assert.match(mobile, /JSON\.stringify\(\{ action: 'predict', query, sessionToken: addressPredictionSession\.token \}\)/);
  assert.match(mobile, /const sessionToken = addressPredictionSession\.token/);
  assert.match(mobile, /JSON\.stringify\(\{ action: 'resolve', provider: prediction\.provider, providerReference: prediction\.id, query, sessionToken \}\)/);
  assert.match(mobile, /const selection = result\.selection/);
  assert.match(mobile, /accessibilityLabel=\{`Use address \$\{prediction\.label\}`\}/);
  assert.match(mobile, /predictions\.some\(\(prediction\) => prediction\.provider === 'google-places' \|\| prediction\.provider === 'google-geocoding'\) \? <Text style=\{styles\.addressAttribution\}>Google Maps<\/Text> : null/);
  assert.match(mobile, /Crypto\.randomUUID\(\)/);
  assert.match(mobile, /Enter the address manually/);
  assert.match(mobile, /Address suggestion selected\. Check the details before saving\./);
  assert.doesNotMatch(mobile, /address suggestion[^\n]{0,80}verified/i);
});

test("suggested and manual addresses keep the rental job state and provenance boundaries", () => {
  const postcode = mobile.indexOf('label="Postcode"');
  const suburb = mobile.indexOf('label="Suburb"');
  assert.ok(postcode > 0 && postcode < suburb);
  assert.match(mobile, /\/api\/address-localities\?postcode=/);
  assert.match(mobile, /matches\.length === 1/);
  assert.match(mobile, /Choose the correct suburb for this postcode/);
  assert.match(mobile, /accessibilityRole="radio"/);
  for (const setter of ["setAddressLine1", "setAddressLine2", "setSuburb", "setAddressState", "setPostcode"]) {
    assert.match(mobile, new RegExp(`${setter}\\(selection\\.`));
  }
  assert.match(mobile, /setAddressProvenance\(\{ entryMode: 'provider_selected', provider: selection\.provider, providerReference: selection\.providerReference, formattedAddress: selection\.formattedAddress, selectionProof: selection\.selectionProof \}\)/);
  assert.match(mobile, /addressEntryMode: addressProvenance\.entryMode, addressProvider: addressProvenance\.provider, addressProviderReference: addressProvenance\.providerReference/);
  assert.match(mobile, /addressFormatted: addressProvenance\.formattedAddress, addressSelectionProof: addressProvenance\.selectionProof/);
  assert.match(mobile, /function manualAddressProvenance\(\): AddressProvenance/);
  assert.match(mobile, /function changeAddressLine2\(value: string\) \{ setAddressLine2\(value\); setAddressProvenance\(manualAddressProvenance\(\)\); \}/);
  assert.match(mobile, /function changeSuburb\(value: string\) \{ setSuburb\(value\); setAddressProvenance\(manualAddressProvenance\(\)\); \}/);
  assert.doesNotMatch(mobile, /addressState: 'VIC'/);
  assert.match(mobile, /Rental inspection jobs require a Victorian service address\./);
  assert.match(mobile, /!lockedToSavedCustomer && addressPredictionSession\.predictions\.length/);
});

test("provider-selected locality remains signed while only manual addresses are reconciled", () => {
  const shouldReconcile = executableFunction(mobile, "shouldReconcileAddressLocality");
  assert.equal(shouldReconcile("provider_selected", false, "3000", "VIC"), false);
  assert.equal(shouldReconcile("manual_pending_review", false, "3000", "VIC"), true);
  assert.equal(shouldReconcile("manual_pending_review", true, "3000", "VIC"), false);
  assert.equal(shouldReconcile("manual_pending_review", false, "300", "VIC"), false);
  assert.match(mobile, /if \(!shouldReconcileAddressLocality\(addressProvenance\.entryMode, Boolean\(selectedCustomer\), postcode, addressState\)\)/);
  assert.match(mobile, /\[addressProvenance\.entryMode, addressState, postcode, selectedCustomer\]/);
  assert.match(mobile, /localityLookupController\.current\?\.abort\(\); localityLookupController\.current = null;\s*setAddressLine1\(selection\.addressLine1\)/);
  assert.match(mobile, /setAddressProvenance\(manualAddressProvenance\(\)\);\s*const matches =/);
  assert.match(mobile, /setLocalities\(\[\]\); setLocalityBusy\(false\); setLocalityMessage\('Address suggestion selected\. Its suburb and postcode are preserved\.'\)/);
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
