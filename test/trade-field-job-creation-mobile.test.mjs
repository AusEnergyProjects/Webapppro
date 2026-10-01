import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { sendMailboxEmail } from "../src/lib/trade-email-provider.ts";
import { sendServiceReminderProviderMessage } from "../src/lib/service-reminder-delivery.ts";

import {
  directAppointmentDisplayTime,
  directAppointmentInviteDraft,
} from "../src/lib/direct-appointment-invite.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const mobile = read("../mobile/src/app/new-job.tsx");
const mobileApi = read("../mobile/src/lib/api.ts");
const mobileWorkSelection = read("../mobile/src/components/job-work-selection.tsx");
const mobileJob = read("../mobile/src/app/job/[id].tsx");
const mobileTypes = read("../mobile/src/lib/types.ts");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const syncRoute = read("../src/app/api/trade-team/sync/route.ts");
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

test("native back gestures move through setup before asking to cancel", () => {
  const previousStep = executableFunction(mobile, "previousSetupStep");
  assert.equal(previousStep(2), 1);
  assert.equal(previousStep(1), 0);
  assert.equal(previousStep(0), null);
  assert.match(mobile, /usePreventRemove\(true/);
  assert.match(mobile, /setStep\(previous\)/);
  assert.match(mobile, /Cancel job setup\?/);
  assert.match(mobile, /Continue booking/);
  assert.match(mobile, /Cancel setup/);
  assert.match(mobile, /allowExit\.current = true/);
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

test("a saved customer can be selected while an intentional new customer can keep matching details", () => {
  assert.match(mobile, /find_field_customer_by_email/);
  assert.match(mobile, /Existing customer found/);
  assert.match(mobile, /customerMode: selectedCustomer \? 'existing' : 'new'/);
  assert.match(mobile, /crmCustomerId: selectedCustomer\?\.customerId/);
  assert.match(mobileApi, /public readonly payload/);
  assert.match(crmRoute, /action === "find_field_customer_by_email"/);
  assert.match(crmRoute, /directCustomerHasEmail/);
  assert.match(dedup, /lower\(c\.email\) = \? OR lower\(cc\.email\) = \?/);
  assert.match(mobile, /duplicateOverride: !selectedCustomer/);
});

test("mobile bookings bind premises-specific activity variants through sync and form opening", () => {
  assert.match(mobileWorkSelection, /label="Premises type"/);
  assert.match(mobileWorkSelection, /const premisesVariantActivityIds = new Set\(\['veu-1', 'veu-3', 'veu-6'\]\)/);
  assert.match(mobileWorkSelection, /variantId\?: string/);
  assert.match(mobileWorkSelection, /fieldActivitiesForBuildingType/);
  assert.match(mobile, /const \[buildingType, setBuildingType\] = useState\('not_sure'\)/);
  assert.match(mobile, /serviceCategory, buildingType, priority/);
  assert.doesNotMatch(mobile, /buildingType: 'house_townhouse'/);
  assert.match(syncRoute, /variantId: String\(activity\.variantId \|\| ""\)/);
  assert.match(mobileTypes, /activityTemplateId: string;\s+variantId\?: string;/);
  assert.match(mobileJob, /variantId=\{complianceIntents\.find/);
});

test("optional TLink invite is requested only after the job and appointment commit", () => {
  assert.match(mobile, /Email the customer a calendar invite/);
  assert.match(mobile, /emailCalendarInvite/);
  const commit = crmRoute.lastIndexOf("await db.batch([", crmRoute.indexOf("...batchStatements"));
  const invite = crmRoute.indexOf("await sendDirectAppointmentCalendarInvite", commit);
  assert.ok(commit > 0 && invite > commit);
  assert.match(inviteServer, /messageType: "tlink_direct_appointment_invite"/);
  assert.match(inviteServer, /text\/calendar; charset=utf-8/);
  assert.match(inviteServer, /sendTradeCustomerEmail\(input\.ownerUid/);
  assert.match(inviteServer, /customer_calendar_invite_\$\{result.status\}/);
  assert.match(inviteServer, /calendar-invite:\$\{input.appointmentId\}:\$\{appointmentRevision\}/);
});

test("appointment email delivery rejects provider redirects with a bounded timeout", async t => {
  const timeouts = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => { timeouts.push(milliseconds); return new AbortController().signal; });
  const emailServer = read("../src/lib/trade-email-server.ts");
  const platformFetch = emailServer.match(/fetchImpl: (\(url, init\) => fetch\(url, \{[^\n]+?\}\))/)?.[1];
  assert.ok(platformFetch, "Exercise the central sender's actual platform fetch wrapper");
  const message = { senderEmail: "business@example.test", senderName: "Trade", recipient: "customer@example.test", subject: "Appointment", text: "Your appointment", messageId: "<appointment@example.test>" };
  for (const status of [301, 302, 303, 307, 308]) {
    for (const provider of ["google", "microsoft", "platform"]) {
      let calls = 0;
      const fetch = async (url, init) => {
        calls++; assert.equal(init.redirect, "manual"); assert.ok(init.signal instanceof AbortSignal);
        assert.notEqual(new URL(url).hostname, "redirect.example.test");
        return new Response("", { status, headers: { Location: "https://redirect.example.test/collect" } });
      };
      const delivery = provider === "platform"
        ? sendServiceReminderProviderMessage({ channel: "email", recipient: message.recipient, subject: message.subject, body: message.text, idempotencyKey: "appointment", callbackUrl: "" }, {
          runtime: { RESEND_API_KEY: "fixture-key", RESEND_FROM_EMAIL: message.senderEmail }, fetchImpl: Function("fetch", `return ${platformFetch};`)(fetch),
        })
        : sendMailboxEmail(provider, "fixture-token", message, fetch);
      await assert.rejects(delivery, error => provider === "platform" ? error.outcome === "definite_failure" : error.code === "email_provider_rejected" && error.outcome === "rejected");
      assert.equal(calls, 1, "No redirect target or retry request may receive the credentials");
    }
  }
  assert.deepEqual(timeouts, Array(15).fill(20_000));
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
