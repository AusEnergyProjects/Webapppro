import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL(
    "../integrations/google-apps-script/lead-email-relay.gs",
    import.meta.url,
  ),
  "utf8",
);

function relay() {
  const sent = [];
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Array,
    RegExp,
    isNaN,
    encodeURIComponent,
    MailApp: {
      sendEmail(message) {
        sent.push(message);
      },
    },
    ScriptApp: {
      getService() {
        return {
          getUrl() {
            return "https://script.google.com/macros/s/test/exec";
          },
        };
      },
    },
    Utilities: {
      formatDate() {
        return "14 Jul 2026, 11:02 am AEST";
      },
      getUuid() {
        return "12345678-abcd-4000-8000-123456789abc";
      },
      computeDigest() {
        return [1, 2, 3, 4, 5, 6, 7, 8];
      },
      DigestAlgorithm: { MD5: "MD5" },
    },
    ContentService: {
      MimeType: { TEXT: "text" },
      createTextOutput(value) {
        return {
          value,
          setMimeType() {
            return this;
          },
        };
      },
    },
    HtmlService: {
      createHtmlOutput(value) {
        return value;
      },
    },
  });
  vm.runInContext(source, context);
  return { context, sent };
}

const comparison = {
  schemaVersion: "2",
  eventType: "comparison.results",
  reference: "AEA-20260714-12345678AB",
  submittedAt: "2026-07-14T01:02:03.000Z",
  name: "Test Customer",
  email: "test@example.com",
  postcode: "3000",
  state: "VIC",
  annualKwh: 5164,
  magicLink: "https://example.com/compare?pc=3000&kwh=5164",
  top3: [
    {
      rank: 1,
      brand: "Example Energy",
      plan: "Example Saver",
      offerId: "EX123",
      annual: 1412,
      link: "https://example.com/plan",
    },
    {
      rank: 2,
      brand: "Second Energy",
      plan: "Second Saver",
      offerId: "SE456",
      annual: 1498,
      link: "https://second.example/plan",
    },
  ],
  provenance: {
    sourceFetchedAt: "2026-07-14T00:00:00.000Z",
    annualSource: "manual",
    conditionalDiscountsAssumed: false,
  },
};

test("the relay recognises every versioned event and operational probes", () => {
  const { context } = relay();
  assert.equal(
    context.eventType_({ submissionType: "comparison" }),
    "comparison.results",
  );
  assert.equal(
    context.eventType_({ enquiry: "electricity-battery" }),
    "electricity.upgrade",
  );
  assert.equal(context.eventType_({ enquiry: "gas-hot-water" }), "gas.upgrade");
  assert.match(source, /webhook\.delivery_probe/);
});

test("comparison email includes actual usage, ranked plans and the site visual system", () => {
  const { context, sent } = relay();
  context.sendComparisonEmail_(comparison, "OPAQUE123");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "test@example.com");
  assert.equal(sent[0].replyTo, "info@ausenergyassessments.com");
  assert.match(sent[0].htmlBody, /5,164 kWh/);
  assert.match(sent[0].htmlBody, /Example Saver/);
  assert.match(sent[0].htmlBody, /\$1,412/);
  assert.match(sent[0].htmlBody, /#03192d|#20cbb8|#12a66a/);
  assert.match(sent[0].htmlBody, /Powered by Australian Energy Assessments/);
  assert.doesNotMatch(sent[0].htmlBody, /\? kWh|>\?</);
});

test("new unsubscribe links use only an opaque token", () => {
  const { context } = relay();
  const url = context.unsubscribeUrl_("OPAQUE123");
  assert.match(url, /\?action=unsub&t=OPAQUE123$/);
  assert.doesNotMatch(url, /email|%40|example\.com/i);
});

test("customer and internal acknowledgements are tailored to each workflow", () => {
  const { context, sent } = relay();
  const payloads = [
    {
      ...comparison,
      eventType: "electricity.upgrade",
      enquiry: "electricity-battery",
      type: "Electricity upgrade enquiry: Add a battery",
      solarKw: 6.6,
      batteryKwh: 13.5,
      installedCost: 8900,
      annualSaving: 1280,
    },
    {
      ...comparison,
      eventType: "gas.upgrade",
      enquiry: "gas-hot-water",
      type: "Gas upgrade enquiry: Heat pump hot water",
      annualMj: 58000,
      installedCost: 3200,
      annualSaving: 740,
    },
    {
      ...comparison,
      eventType: "direct_trade.project",
      enquiry: "direct-trade-project",
      projectSource: "gas-heating",
      projectCategories: ["assessment", "solar"],
      propertyType: "house",
      propertyRelationship: "owner-occupier",
      projectPriorities: ["need-advice"],
      projectStage: "researching",
      timeframe: "urgent",
      preferredContact: "phone",
      projectNotes: "Review the home before recommending equipment.",
      directTradeTriage: {
        status: "automatic_privacy_safe_allocation",
        priority: "urgent_allocation_review",
        autoSend: true,
        reviewFlags: ["assessment_or_advice_may_be_needed_first"],
      },
    },
    {
      ...comparison,
      eventType: "direct_trade.partner",
      enquiry: "direct-trade-partner",
      partnerType: "supplier",
      businessName: "Example Supply",
      serviceStates: ["VIC", "NSW"],
      projectCategories: ["battery"],
      partnerNotes: "Local stock and warranty support.",
      participantReview: {
        status: "application_received",
        autoApprove: false,
        publicListing: false,
        checks: [
          {
            id: "product",
            label: "Product specifications and compliance evidence",
            status: "not_started",
          },
        ],
      },
    },
  ];

  payloads.forEach((payload) => {
    context.sendCustomerAcknowledgement_(payload);
    context.sendInternalEnquiry_(payload);
  });
  assert.equal(sent.length, 8);
  assert.match(sent[0].htmlBody, /13\.5 kWh/);
  assert.match(sent[2].htmlBody, /58,000 MJ/);
  assert.match(
    sent[4].htmlBody,
    /Independent energy assessment, Rooftop solar/,
  );
  assert.match(sent[5].htmlBody, /Privacy-safe installer allocation active/);
  assert.match(sent[5].htmlBody, /Gas heating upgrade estimate/);
  assert.match(
    sent[5].htmlBody,
    /On\. Up to six eligible installers; contact details remain withheld\./,
  );
  assert.match(sent[6].htmlBody, /Product supplier or wholesaler/);
  assert.match(sent[7].htmlBody, /Application received for manual review/);
  assert.match(sent[7].htmlBody, /Off\. Direct review required\./);
  for (const message of sent) {
    assert.match(message.subject, /AEA-20260714-12345678AB/);
    assert.ok(message.body);
    assert.ok(message.htmlBody);
    assert.doesNotMatch(message.htmlBody, /[–—]/);
  }
});

test("all untrusted email values are escaped and retailer buttons require HTTPS", () => {
  const { context } = relay();
  const html = context.planCards_([
    {
      rank: 1,
      brand: "<img src=x>",
      plan: "<script>alert(1)</script>",
      annual: 1000,
      link: "javascript:alert(1)",
    },
  ]);
  assert.doesNotMatch(html, /<script>|<img src=x>|javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test("the relay source avoids customer contact details in generated URLs", () => {
  assert.doesNotMatch(source, /unsubUrl_\(email\)|\?action=unsub&email=/);
  assert.match(source, /\?action=unsub&t=/);
});
