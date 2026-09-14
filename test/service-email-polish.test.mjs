import assert from "node:assert/strict";
import test from "node:test";
import { quickUpgradeReceiptDraft } from "../src/lib/quick-upgrade-receipt.mjs";
import { rentalReportEmailDraft } from "../src/lib/rental-report-email-template.mjs";

test("AEA acknowledgement links the selected service scope and keeps the booking status explicit", () => {
  const draft = quickUpgradeReceiptDraft({ firstName: "Taylor", reference: "AEA-TEST-01",
    services: ["smoke-alarm-blind-safety", "rental-gas-electrical-bundle"], matchingState: "review" });
  for (const text of [draft.body, draft.html]) {
    assert.match(text, /Booking not yet confirmed|booking not yet confirmed/);
    assert.match(text, /\/services\/smoke-alarm-blind-safety/);
    assert.match(text, /https:\/\/ausenergyassessments.com\/offers/);
    assert.match(text, /shareable report link and a downloadable PDF/);
    assert.match(text, /same day they are finalised/);
    assert.match(text, /not distributed to other TLink businesses/);
    assert.match(text, /privacy-policy/);
    assert.doesNotMatch(text, /enrolment confirmed|booking confirmed|your property is compliant|attached/i);
  }
  assert.doesNotMatch(draft.html, /https?:\/\/[^"\s]*mail.google/);
});

test("assessment receipt explains only the selected certificate pathway", () => {
  const receipt = { firstName: "Taylor", reference: "AEA-TEST-03", matchingState: "review" };
  const advice = quickUpgradeReceiptDraft({ ...receipt, services: ["onsite-energy-assessment"] });
  assert.match(advice.body, /without a certificate/);
  assert.doesNotMatch(advice.body, /Rental safety records|formal energy rating/);
  const rating = quickUpgradeReceiptDraft({ ...receipt, services: ["nathers-new"] });
  assert.match(rating.body, /plans and specifications/);
  assert.match(rating.body, /applicable certificate follow completion/);
  assert.doesNotMatch(rating.body, /without a certificate|Rental safety records/);
});

test("mixed requests retain their upgrade services and private AEA next step", () => {
  const draft = quickUpgradeReceiptDraft({ firstName: "Taylor", reference: "AEA-TEST-02",
    services: ["gas-safety-check", "solar"], matchingState: "matched" });
  assert.match(draft.body, /Rooftop solar/);
  assert.match(draft.body, /Gas safety check/);
  assert.match(draft.body, /handle your service enquiry directly/);
  assert.doesNotMatch(draft.body, /available to suitable approved TLink businesses/);
});

test("ordinary upgrade receipts do not promise AEA assessment delivery or onboarding", () => {
  const draft = quickUpgradeReceiptDraft({ firstName: "Taylor", reference: "UPGRADE-TEST",
    services: ["solar"], matchingState: "matched" });
  assert.match(draft.body, /suitable approved TLink businesses/);
  assert.doesNotMatch(draft.body, /same day|shareable report link|enrolment|attached/i);
  assert.match(draft.body, /You choose whether to proceed/);
});

test("submitted names and references cannot add HTML or active email links", () => {
  const draft = quickUpgradeReceiptDraft({ firstName: '<img src=x onerror="bad">', reference: '<unsafe&"ref>',
    services: ["electrical-safety-check"], matchingState: "review" });
  assert.doesNotMatch(draft.html, /<img src=x|<unsafe/);
  assert.match(draft.html, /&lt;img src=x onerror=&quot;bad&quot;&gt;/);
  assert.match(draft.html, /&lt;unsafe&amp;&quot;ref&gt;/);
});

test("report HTML escapes recipient, report number and the actual secure URL", () => {
  const draft = rentalReportEmailDraft({ recipientName: '<img src=x onerror="bad">', reportNumber: 'RMS-<1>&"',
    shareUrl: 'https://example.test/rental-report/token?a=1&b=%22', hasAttachment: true });
  assert.doesNotMatch(draft.html, /<img src=x|RMS-<1>/);
  assert.match(draft.html, /RMS-&lt;1&gt;&amp;&quot;/);
  assert.match(draft.html, /href="https:\/\/example.test\/rental-report\/token\?a=1&amp;b=%22"/);
  assert.match(draft.body, /A PDF copy is attached/);
  assert.match(draft.html, /Anyone with the link can access the report/);
  assert.doesNotMatch(draft.html, /property (?:passed|is compliant)|certificate of compliance/i);
});

test("large reports have a working download action without claiming a PDF is attached", () => {
  const draft = rentalReportEmailDraft({ recipientName: "Client", reportNumber: "RMS-2",
    shareUrl: "https://example.test/rental-report/token", hasAttachment: false });
  assert.match(draft.body, /^Hello,/);
  assert.match(draft.html, /View report &amp; download PDF/);
  assert.doesNotMatch(draft.body + draft.html, /attached|Hi Client/);
});

test("report email cannot turn an invalid or active-content URL into its action", () => {
  for (const shareUrl of ["javascript:alert(1)", "data:text/html,bad", "/relative", "https://name:secret@example.test/report"]) {
    assert.throws(() => rentalReportEmailDraft({ recipientName: "Client", reportNumber: "RMS-3", shareUrl,
      hasAttachment: false }), /RENTAL_REPORT_EMAIL_CONTENT_INVALID/);
  }
});
