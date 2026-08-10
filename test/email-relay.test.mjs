import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
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
  const mailControl = { attempts: 0, failOnAttempt: 0 };
  const rows = [];
  const scriptProperties = new Map([
    ["AEA_LEAD_WEBHOOK_SIGNING_SECRET", "test-lead-signing-secret-with-32-bytes-minimum"],
  ]);
  const sheet = {
    getRange(row, column, rowCount, columnCount) {
      return {
        setValues(values) {
          for (let offset = 0; offset < rowCount; offset += 1) {
            const target = rows[row - 1 + offset] || [];
            for (let index = 0; index < columnCount; index += 1) {
              target[column - 1 + index] = values[offset][index];
            }
            rows[row - 1 + offset] = target;
          }
        },
        setValue(value) {
          const target = rows[row - 1] || [];
          target[column - 1] = value;
          rows[row - 1] = target;
        },
        getValue() {
          return rows[row - 1]?.[column - 1];
        },
        createTextFinder(query) {
          let exact = false;
          let caseSensitive = false;
          return {
            matchEntireCell(value) {
              exact = value === true;
              return this;
            },
            matchCase(value) {
              caseSensitive = value === true;
              return this;
            },
            findNext() {
              const limit = row + (rowCount || 1) - 1;
              for (let rowNumber = row; rowNumber <= limit; rowNumber += 1) {
                const candidate = String(rows[rowNumber - 1]?.[column - 1] || "");
                const left = caseSensitive ? candidate : candidate.toLowerCase();
                const right = caseSensitive ? query : String(query).toLowerCase();
                if (exact ? left === right : left.includes(right)) {
                  return { getRow: () => rowNumber };
                }
              }
              return null;
            },
          };
        },
      };
    },
    appendRow(row) {
      rows.push([...row]);
    },
    getLastRow() {
      return rows.length;
    },
    getDataRange() {
      return { getValues: () => rows.map((row) => [...row]) };
    },
  };
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
        mailControl.attempts += 1;
        if (mailControl.failOnAttempt === mailControl.attempts) {
          throw new Error("simulated mail failure");
        }
        sent.push(message);
      },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return { getSheets: () => [sheet] };
      },
    },
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return scriptProperties.get(key) || "";
          },
          setProperty(key, value) {
            scriptProperties.set(key, String(value));
          },
          getProperties() {
            return Object.fromEntries(scriptProperties);
          },
          deleteProperty(key) {
            scriptProperties.delete(key);
          },
        };
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
      computeDigest(algorithm, input) {
        const name = algorithm === "SHA_256" ? "sha256" : "md5";
        const bytes = Array.isArray(input)
          ? Buffer.from(input.map((value) => value & 255))
          : Buffer.from(String(input || ""));
        return [...createHash(name).update(bytes).digest()].map((value) =>
          value > 127 ? value - 256 : value
        );
      },
      base64Decode(value) {
        return [...Buffer.from(value, "base64")].map((byte) =>
          byte > 127 ? byte - 256 : byte
        );
      },
      base64DecodeWebSafe(value) {
        return [...Buffer.from(value, "base64url")].map((byte) =>
          byte > 127 ? byte - 256 : byte
        );
      },
      base64EncodeWebSafe(value) {
        return Buffer.from(value.map((byte) => byte & 255)).toString("base64url");
      },
      computeHmacSha256Signature(value, secret) {
        return [...createHmac("sha256", secret).update(value).digest()].map((byte) =>
          byte > 127 ? byte - 256 : byte
        );
      },
      newBlob(bytes, mimeType, name) {
        return {
          bytes,
          mimeType,
          name,
          getDataAsString() {
            return Buffer.from(bytes.map((byte) => byte & 255)).toString("utf8");
          },
        };
      },
      DigestAlgorithm: { MD5: "MD5", SHA_256: "SHA_256" },
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
  return { context, sent, rows, mailControl, scriptProperties };
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
    /Privacy-safe matching is active; customer contact details remain withheld until release is authorised\./,
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

test("public plan enquiries use customer-friendly titles and category labels", () => {
  const { context, sent } = relay();
  const payload = {
    ...comparison,
    eventType: "direct_trade.project",
    enquiry: "home-plan-upgrade",
    sourceJourney: "public-home-energy-plan",
    customerFirstName: "Jamie",
    customerLastName: "Customer",
    projectCategories: [
      "draught-proofing",
      "insulation",
      "glazing",
      "window-coverings",
    ],
    customerUnitNumber: "Unit 4",
    customerStreetAddress: "15 Example Street",
    customerSuburb: "MELBOURNE",
    customerState: "VIC",
    tradeSharing: { email: true, postcode: true, name: false, phone: false, address: false },
    directTradeTriage: {
      status: "automatic_verified_area_allocation",
      priority: "standard_allocation",
      autoSend: true,
      reviewFlags: [],
    },
  };

  context.sendCustomerAcknowledgement_(payload);
  context.sendInternalEnquiry_(payload);

  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /personalised home energy plan is attached/i);
  assert.doesNotMatch(sent[0].subject, /Direct Trade project brief/i);
  assert.match(sent[0].htmlBody, /matching request is being processed/i);
  assert.match(sent[0].htmlBody, /email, postcode, selected services and any message you wrote will be shared with all approved TLink trades/i);
  assert.match(sent[0].htmlBody, /name, phone and full service address are shared only when you selected each one/i);
  assert.match(sent[0].htmlBody, /private plan PDF is not shared with trades/i);
  assert.match(sent[0].body, /email, postcode, selected services and any message you wrote will be shared with all approved TLink trades/i);
  assert.match(sent[0].body, /name, phone and full service address are shared only when you selected each one/i);
  assert.doesNotMatch(sent[0].htmlBody, /enquiry is open to matching trades/i);
  assert.match(sent[1].subject, /Home energy plan upgrade enquiry/);
  assert.match(
    sent[1].htmlBody,
    /Draught proofing, Insulation, Windows and glazing, Blinds, shutters or external shading/,
  );
  assert.match(sent[1].htmlBody, /Open matching to active verified trades/);
  assert.match(sent[1].htmlBody, /every active, verified matching trade servicing the area/i);
  assert.match(sent[1].htmlBody, /Unit 4 15 Example Street, MELBOURNE, VIC, 3000/);
});

function publicPlanPdfDelivery() {
  const bytes = Buffer.alloc(20_100, 32);
  bytes.write("%PDF-1.7\n", 0, "ascii");
  bytes.write("\n%%EOF", bytes.length - 6, "ascii");
  return {
    version: "customer-only-home-plan-pdf-v1",
    filename: "personalised-home-energy-plan-2026-08-10.pdf",
    mimeType: "application/pdf",
    encoding: "base64",
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    content: bytes.toString("base64"),
  };
}

function publicPlanRelayPayload() {
  return {
    ...comparison,
    schemaVersion: "7",
    reference: "AEA-20260810-12345678ABCD4ABC",
    eventType: "direct_trade.project",
    enquiry: "home-plan-upgrade",
    sourceJourney: "public-home-energy-plan",
    customerFirstName: "Jamie",
    customerLastName: "Customer",
    submissionFingerprint: "a".repeat(64),
    projectCategories: ["heating-cooling"],
    customerUnitNumber: "Unit 4",
    customerStreetAddress: "15 Example Street",
    customerSuburb: "MELBOURNE",
    customerState: "VIC",
    tradeSharing: { email: true, postcode: true, name: false, phone: false, address: false },
    projectNotes: "Please contact me about replacing the main system.",
    directTradeTriage: {
      status: "automatic_verified_area_allocation",
      priority: "standard_allocation",
      autoSend: true,
      reviewFlags: [],
    },
    customerPlanDelivery: publicPlanPdfDelivery(),
  };
}

function signedLeadWebhook(payload, {
  sentAt = new Date().toISOString(),
  secret = "test-lead-signing-secret-with-32-bytes-minimum",
} = {}) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    schemaVersion: "1",
    eventType: "lead.webhook",
    sentAt,
    payload: encodedPayload,
    signature: createHmac("sha256", secret)
      .update(`${sentAt}.${encodedPayload}`)
      .digest("base64url"),
  };
}

function postEvent(context, payload) {
  return context.doPost({ postData: { contents: JSON.stringify(payload) } });
}

test("public enquiry delivery attaches one verified PDF only to the customer and dedupes completed retries", () => {
  const { context, sent, rows } = relay();
  const payload = publicPlanRelayPayload();

  assert.equal(context.handleEnquiry_(payload).value, "ok");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, payload.email);
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(sent[0].attachments[0].mimeType, "application/pdf");
  assert.equal(sent[1].to, "info@ausenergyassessments.com");
  assert.equal("attachments" in sent[1], false);
  assert.equal(rows.length, 2);
  const details = JSON.parse(rows[1][rows[0].indexOf("Details")]);
  assert.equal(details.customerFirstName, "Jamie");
  assert.equal(details.customerLastName, "Customer");
  assert.equal(details.customerUnitNumber, "Unit 4");
  assert.equal(details.customerStreetAddress, "15 Example Street");
  assert.equal(details.customerSuburb, "MELBOURNE");
  assert.equal(details.customerState, "VIC");

  assert.equal(context.handleEnquiry_(payload).value, "ok");
  assert.equal(sent.length, 2);
  assert.equal(rows.length, 2);
});

test("a partial relay failure resumes only the missing stage without another sheet row or customer PDF", () => {
  const { context, sent, rows, mailControl } = relay();
  const payload = publicPlanRelayPayload();
  mailControl.failOnAttempt = 2;

  assert.throws(() => context.handleEnquiry_(payload), /simulated mail failure/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, payload.email);
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(rows.length, 2);

  assert.equal(context.handleEnquiry_(payload).value, "ok");
  assert.equal(sent.length, 2);
  assert.equal(sent[1].to, "info@ausenergyassessments.com");
  assert.equal("attachments" in sent[1], false);
  assert.equal(rows.length, 2);
});

test("the relay rejects a changed payload replay using the same stable reference", () => {
  const { context, sent, rows } = relay();
  const payload = publicPlanRelayPayload();
  assert.equal(context.handleEnquiry_(payload).value, "ok");

  assert.throws(
    () => context.handleEnquiry_({
      ...payload,
      projectNotes: "A different request under the same reference.",
      submissionFingerprint: "b".repeat(64),
    }),
    /does not match its original submission/,
  );
  assert.equal(sent.length, 2);
  assert.equal(rows.length, 2);
});

test("lead webhooks require a current valid HMAC envelope before routing", () => {
  const { context, sent, rows } = relay();
  const payload = publicPlanRelayPayload();
  assert.equal(postEvent(context, signedLeadWebhook(payload)).value, "ok");
  assert.equal(sent.length, 2);
  assert.equal(rows.length, 2);

  const unsigned = postEvent(context, payload);
  assert.match(unsigned.value, /Invalid lead webhook envelope/);

  const probe = {
    schemaVersion: "1",
    eventType: "webhook.delivery_probe",
    test: true,
    probeId: "probe-1",
    sentAt: new Date().toISOString(),
    source: "aea-energy",
  };
  assert.equal(postEvent(context, signedLeadWebhook(probe)).value, "ok");
  assert.match(postEvent(context, probe).value, /Invalid lead webhook envelope/);

  const stale = postEvent(context, signedLeadWebhook({ ...payload, reference: "AEA-20260810-STALE1234567890" }, {
    sentAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
  }));
  assert.match(stale.value, /Expired lead webhook envelope/);

  const invalidSignature = signedLeadWebhook({ ...payload, reference: "AEA-20260810-BADSIG123456789" });
  invalidSignature.signature = "A".repeat(43);
  assert.match(postEvent(context, invalidSignature).value, /Invalid lead webhook signature/);

  const tampered = signedLeadWebhook({ ...payload, reference: "AEA-20260810-TAMPER12345678" });
  tampered.payload = Buffer.from(JSON.stringify({ ...payload, name: "Tampered Customer" })).toString("base64url");
  assert.match(postEvent(context, tampered).value, /Invalid lead webhook signature/);
  assert.equal(sent.length, 2);
  assert.equal(rows.length, 2);
});

test("the relay source avoids customer contact details in generated URLs", () => {
  assert.doesNotMatch(source, /unsubUrl_\(email\)|\?action=unsub&email=/);
  assert.match(source, /\?action=unsub&t=/);
  const lookup = source.match(/function leadRecordByReference_\([\s\S]+?\n\}/)?.[0] || "";
  assert.match(lookup, /createTextFinder\(reference\)/);
  assert.match(lookup, /matchEntireCell\(true\)/);
  assert.doesNotMatch(lookup, /getDataRange\(\)/);
});
