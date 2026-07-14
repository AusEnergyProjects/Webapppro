/**
 * Australian Energy Assessments website email relay.
 * Container bound to the lead spreadsheet and deployed as a web app.
 * The repository copy is the source of truth for the deployed script.
 */

const FOLLOW_UP_DAYS = 182;
const BRAND = "Australian Energy Assessments";
const BRAND_PHONE = "1300 241 149";
const BRAND_SITE = "https://www.ausenergyassessments.com";
const REPLY_TO = "info@ausenergyassessments.com";
const TIME_ZONE = "Australia/Sydney";
const LEGACY_SECRET = "CHANGE-ME-to-any-random-phrase";
const OPS_SITE_URL = "https://aea-energy-comparison.info294029.chatgpt.site";
const OPS_ALERT_EMAIL = REPLY_TO;
const OPS_STATE_KEY = "AEA_OPS_HEALTH_STATE_V1";
const OPS_REPEAT_ALERT_MS = 6 * 60 * 60 * 1000;

// Existing column positions are preserved. New operational fields are appended.
const HEADERS = [
  "Timestamp", "Name", "Email", "Postcode", "State", "AnnualKwh", "Solar", "EV",
  "Top3", "MagicLink", "NextSend", "Unsubscribed", "LastSent", "Phone", "Type",
  "Reference", "EventType", "Details", "UnsubscribeToken",
];

const EVENT_TYPES = [
  "comparison.results",
  "electricity.upgrade",
  "gas.upgrade",
  "direct_trade.project",
  "direct_trade.partner",
];

function setup() {
  syncHeaders_(sheet_());
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "sendFollowUps") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("sendFollowUps").timeBased().everyDays(1).atHour(9).create();
  setupOperationalMonitoring();
}

function setupOperationalMonitoring() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "runOperationalHealthCheck") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("runOperationalHealthCheck").timeBased().everyHours(1).create();
}

function runOperationalHealthCheck() {
  const now = Date.now();
  const monitorId = "api-health-" + now;
  const properties = PropertiesService.getScriptProperties();
  const probeToken = properties.getProperty("AEA_LEAD_WEBHOOK_TEST_TOKEN") || "";
  const checks = [
    opsJsonCheck_("site_runtime", OPS_SITE_URL + "/api/health", function(body) {
      return body && body.ok === true && body.service === "aea-energy";
    }),
    opsJsonCheck_("electricity_plans", OPS_SITE_URL + "/api/electricity-plans?postcode=3000&customerType=RESIDENTIAL&monitor=" + encodeURIComponent(monitorId), opsPlanResponseOk_),
    opsJsonCheck_("gas_plans", OPS_SITE_URL + "/api/gas-plans?postcode=3000&annualMj=58000&usageProfile=heating&includeConditional=false&monitor=" + encodeURIComponent(monitorId), opsPlanResponseOk_),
    opsLeadProbe_(probeToken),
  ];
  const status = checks.every(function(check) { return check.ok; }) ? "healthy" : "unhealthy";
  const previous = opsPreviousState_(properties.getProperty(OPS_STATE_KEY));
  const alertDue = !previous
    ? status === "unhealthy"
    : previous.status !== status || status === "unhealthy" && now - Number(previous.lastAlertAt || 0) >= OPS_REPEAT_ALERT_MS;
  let alertSent = false;

  if (alertDue) {
    alertSent = opsSendAlert_(status, checks, monitorId, now);
  }

  properties.setProperty(OPS_STATE_KEY, JSON.stringify({
    status: alertDue && !alertSent ? previous && previous.status || "notification_pending" : status,
    checkedAt: now,
    lastAlertAt: alertSent ? now : previous && previous.lastAlertAt || null,
  }));
  console.log(JSON.stringify({ schemaVersion: "1", event: "monitor.api_health", monitorId: monitorId, status: status, checks: checks, alertSent: alertSent }));
  return { status: status, checks: checks, alertSent: alertSent };
}

function opsJsonCheck_(name, url, validator) {
  const startedAt = Date.now();
  try {
    const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    const status = response.getResponseCode();
    const body = JSON.parse(response.getContentText() || "null");
    return { name: name, ok: status >= 200 && status < 300 && validator(body), status: status, durationMs: Date.now() - startedAt };
  } catch (error) {
    return { name: name, ok: false, status: 0, durationMs: Date.now() - startedAt, errorType: error && error.name || "UnknownError" };
  }
}

function opsPlanResponseOk_(body) {
  return body && Array.isArray(body.plans) && body.plans.length > 0 && body.source
    && Number(body.source.listSourcesSucceeded) > 0
    && Number(body.source.detailPlansSucceeded) > 0
    && Number(body.source.plansWithLastUpdated) > 0
    && String(body.source.detailApiVersion) === "3";
}

function opsLeadProbe_(probeToken) {
  const startedAt = Date.now();
  if (!probeToken) return { name: "lead_delivery", ok: false, status: 0, durationMs: 0, errorType: "ProbeTokenMissing" };
  try {
    const response = UrlFetchApp.fetch(OPS_SITE_URL + "/api/internal/lead-webhook-probe", {
      method: "post",
      muteHttpExceptions: true,
      headers: { Authorization: "Bearer " + probeToken, Accept: "application/json" },
    });
    const status = response.getResponseCode();
    const body = JSON.parse(response.getContentText() || "null");
    return { name: "lead_delivery", ok: status >= 200 && status < 300 && body && body.ok === true, status: status, durationMs: Date.now() - startedAt, probeId: body && body.probeId || "" };
  } catch (error) {
    return { name: "lead_delivery", ok: false, status: 0, durationMs: Date.now() - startedAt, errorType: error && error.name || "UnknownError" };
  }
}

function opsPreviousState_(value) {
  try {
    const state = JSON.parse(value || "null");
    return state && typeof state.status === "string" ? state : null;
  } catch (error) {
    return null;
  }
}

function opsSendAlert_(status, checks, monitorId, occurredAt) {
  try {
    const failed = checks.filter(function(check) { return !check.ok; }).map(function(check) { return check.name; });
    const subject = status === "healthy" ? "AEA Energy services recovered" : "AEA Energy service alert";
    const summary = status === "healthy" ? "All monitored services are healthy." : "Checks requiring attention: " + failed.join(", ") + ".";
    const rows = checks.map(function(check) {
      return check.name + ": " + (check.ok ? "healthy" : "failed") + " | HTTP " + check.status + " | " + check.durationMs + " ms";
    }).join("\n");
    MailApp.sendEmail({
      to: OPS_ALERT_EMAIL,
      name: BRAND + " monitoring",
      subject: subject,
      body: summary + "\n\n" + rows + "\n\nMonitor: " + monitorId + "\nTime: " + new Date(occurredAt).toISOString(),
    });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ schemaVersion: "1", event: "monitor.alert", outcome: "delivery_failed", monitorId: monitorId }));
    return false;
  }
}

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function syncHeaders_(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

function column_(name) {
  return HEADERS.indexOf(name) + 1;
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.eventType === "webhook.delivery_probe" && payload.test === true) return out_("ok");
    if (payload.website) return out_("ok");

    const eventType = eventType_(payload);
    if (EVENT_TYPES.indexOf(eventType) < 0) return out_("unsupported event");
    payload.eventType = eventType;
    payload.reference = validReference_(payload.reference) ? payload.reference : reference_();
    payload.submittedAt = validDate_(payload.submittedAt) ? payload.submittedAt : new Date().toISOString();

    if (eventType === "comparison.results") return handleComparison_(payload);
    return handleEnquiry_(payload);
  } catch (error) {
    return out_("error: " + error.message);
  }
}

function eventType_(payload) {
  if (EVENT_TYPES.indexOf(payload.eventType) >= 0) return payload.eventType;
  if (payload.submissionType === "comparison") return "comparison.results";
  if (payload.enquiry === "direct-trade-project") return "direct_trade.project";
  if (payload.enquiry === "direct-trade-partner") return "direct_trade.partner";
  if (payload.enquiry === "gas-heating" || payload.enquiry === "gas-hot-water") return "gas.upgrade";
  if (["electricity-solar", "electricity-solar-battery", "electricity-battery", "solar", "solar-battery", "battery"].indexOf(payload.enquiry) >= 0) return "electricity.upgrade";
  return "";
}

function handleComparison_(payload) {
  if (!validEmail_(payload.email)) return out_("bad email");
  if (!(number_(payload.annualKwh) > 0) || !Array.isArray(payload.top3) || !payload.top3.length) return out_("incomplete comparison");

  const unsubscribeToken = opaqueToken_();
  writeLead_(payload, {
    nextSend: new Date(Date.now() + FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000),
    unsubscribeToken: unsubscribeToken,
    details: comparisonDetails_(payload),
  });
  sendComparisonEmail_(payload, unsubscribeToken);
  if (payload.upgrades) sendUpgradeInterest_(payload);
  return out_("ok");
}

function handleEnquiry_(payload) {
  if (!payload.name || (!payload.email && !payload.phone)) return out_("need name and email or phone");
  if (payload.email && !validEmail_(payload.email)) return out_("bad email");

  writeLead_(payload, { details: enquiryDetails_(payload) });
  if (payload.email) sendCustomerAcknowledgement_(payload);
  sendInternalEnquiry_(payload);
  return out_("ok");
}

function writeLead_(payload, options) {
  const sheet = sheet_();
  syncHeaders_(sheet);
  const row = new Array(HEADERS.length).fill("");
  setRow_(row, "Timestamp", new Date(payload.submittedAt));
  setRow_(row, "Name", payload.name || "");
  setRow_(row, "Email", payload.email || "");
  setRow_(row, "Postcode", payload.postcode || "");
  setRow_(row, "State", payload.state || "");
  setRow_(row, "AnnualKwh", valueOrBlank_(payload.annualKwh));
  setRow_(row, "Solar", payload.solar || "");
  setRow_(row, "EV", payload.hasEv ? "yes" : "no");
  setRow_(row, "Top3", JSON.stringify(payload.top3 || []));
  setRow_(row, "MagicLink", safeUrl_(payload.magicLink));
  setRow_(row, "NextSend", options.nextSend || "");
  setRow_(row, "Unsubscribed", "");
  setRow_(row, "LastSent", new Date());
  setRow_(row, "Phone", payload.phone || "");
  setRow_(row, "Type", payload.type || payload.eventType);
  setRow_(row, "Reference", payload.reference);
  setRow_(row, "EventType", payload.eventType);
  setRow_(row, "Details", JSON.stringify(options.details || {}));
  setRow_(row, "UnsubscribeToken", options.unsubscribeToken || "");
  sheet.appendRow(row);
}

function setRow_(row, header, value) {
  row[column_(header) - 1] = value;
}

function comparisonDetails_(payload) {
  return {
    annualKwh: valueOrBlank_(payload.annualKwh),
    hasControlledLoad: Boolean(payload.hasControlledLoad),
    hasEv: Boolean(payload.hasEv),
    solar: payload.solar || "",
    recheckMonths: valueOrBlank_(payload.recheckMonths),
    provenance: payload.provenance || null,
  };
}

function enquiryDetails_(payload) {
  return {
    enquiry: payload.enquiry || "",
    projectCategories: payload.projectCategories || [],
    propertyType: payload.propertyType || "",
    propertyRelationship: payload.propertyRelationship || "",
    projectPriorities: payload.projectPriorities || [],
    projectSource: payload.projectSource || "",
    projectStage: payload.projectStage || "",
    timeframe: payload.timeframe || "",
    preferredContact: payload.preferredContact || "",
    projectNotes: payload.projectNotes || "",
    partnerType: payload.partnerType || "",
    businessName: payload.businessName || "",
    businessWebsite: payload.businessWebsite || "",
    serviceStates: payload.serviceStates || [],
    partnerNotes: payload.partnerNotes || "",
    directTradeTriage: payload.directTradeTriage || null,
    participantReview: payload.participantReview || null,
    annualKwh: valueOrBlank_(payload.annualKwh),
    annualMj: valueOrBlank_(payload.annualMj),
    solarKw: valueOrBlank_(payload.solarKw),
    batteryKwh: valueOrBlank_(payload.batteryKwh),
    installedCost: installedCost_(payload),
    annualSaving: valueOrBlank_(payload.annualSaving),
    provenance: payload.provenance || null,
  };
}

function doGet(e) {
  const action = String(e.parameter.action || "").toLowerCase();
  if (action !== "unsub") return html_(servicePage_("Email service active", "The Australian Energy Assessments email service is running."));

  const token = String(e.parameter.t || "").trim();
  if (!token) return html_(servicePage_("Link not recognised", "This unsubscribe link is incomplete."));
  const sheet = sheet_();
  syncHeaders_(sheet);
  const data = sheet.getDataRange().getValues();
  let matched = false;

  for (let row = 1; row < data.length; row++) {
    const opaqueMatch = String(data[row][column_("UnsubscribeToken") - 1]) === token;
    const legacyEmail = String(e.parameter.email || "").trim().toLowerCase();
    const legacyMatch = legacyEmail && String(data[row][column_("Email") - 1]).trim().toLowerCase() === legacyEmail && token === legacyToken_(legacyEmail);
    if (opaqueMatch || legacyMatch) {
      sheet.getRange(row + 1, column_("Unsubscribed")).setValue("yes");
      matched = true;
    }
  }

  return html_(servicePage_(matched ? "Reminders stopped" : "Link not recognised", matched
    ? "You will no longer receive six monthly electricity comparison reminders for this saved request."
    : "This unsubscribe link is no longer valid. Contact us if you still need help."));
}

function sendFollowUps() {
  const sheet = sheet_();
  syncHeaders_(sheet);
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let row = 1; row < data.length; row++) {
    const email = String(data[row][column_("Email") - 1]).trim();
    const nextSend = data[row][column_("NextSend") - 1];
    const unsubscribed = String(data[row][column_("Unsubscribed") - 1]).trim().toLowerCase() === "yes";
    if (!validEmail_(email) || unsubscribed || !(nextSend instanceof Date) || nextSend > now) continue;

    let token = String(data[row][column_("UnsubscribeToken") - 1]).trim();
    if (!token) {
      token = opaqueToken_();
      sheet.getRange(row + 1, column_("UnsubscribeToken")).setValue(token);
    }
    sendFollowUpEmail_({
      name: data[row][column_("Name") - 1],
      email: email,
      postcode: data[row][column_("Postcode") - 1],
      magicLink: data[row][column_("MagicLink") - 1],
      reference: data[row][column_("Reference") - 1] || "Saved comparison",
    }, token);
    sheet.getRange(row + 1, column_("NextSend")).setValue(new Date(now.getTime() + FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000));
    sheet.getRange(row + 1, column_("LastSent")).setValue(now);
  }
}

function sendComparisonEmail_(payload, unsubscribeToken) {
  const firstName = firstName_(payload.name);
  const planHtml = planCards_(payload.top3);
  const planText = planText_(payload.top3);
  const intro = firstName ? "Hi " + firstName + "," : "Hi,";
  const sourceNote = sourceNote_(payload.provenance);
  const content = paragraph_(intro)
    + paragraph_("These are the three lowest estimated annual costs from the priceable offers returned for the details you entered.")
    + summaryGrid_([
      ["Postcode", payload.postcode],
      ["Annual usage", formatNumber_(payload.annualKwh) + " kWh"],
      ["Reference", payload.reference],
    ])
    + planHtml
    + button_(payload.magicLink, "Re-run with current rates")
    + notice_("Indicative comparison", "Annual costs use the tariff rates, usage and assumptions recorded by the comparison. Retail offers can change. Confirm the current price, eligibility, fees and terms with the retailer before switching.")
    + (sourceNote ? muted_(sourceNote) : "")
    + paragraph_("You asked for a fresh comparison reminder in about six months. The reminder link contains comparison inputs only. Meter files and contact details are not included in it.");

  const plain = [
    intro,
    "",
    "Your electricity comparison for postcode " + payload.postcode,
    "Annual usage: " + formatNumber_(payload.annualKwh) + " kWh",
    "Reference: " + payload.reference,
    "",
    planText,
    "",
    "Re-run with current rates: " + safeUrl_(payload.magicLink),
    "",
    "Costs are indicative. Confirm the current price, eligibility, fees and terms with the retailer before switching.",
  ].join("\n");

  sendMail_({
    to: payload.email,
    replyTo: REPLY_TO,
    subject: "Your electricity comparison for " + payload.postcode + " | " + BRAND,
    body: plain,
    htmlBody: wrap_("Your electricity comparison", "CURRENT PLAN ESTIMATES", content, {
      reference: payload.reference,
      unsubscribeToken: unsubscribeToken,
      comparisonFooter: true,
    }),
  });
}

function sendFollowUpEmail_(payload, unsubscribeToken) {
  const intro = firstName_(payload.name) ? "Hi " + firstName_(payload.name) + "," : "Hi,";
  const content = paragraph_(intro)
    + paragraph_("It has been about six months since this electricity comparison was saved. Retail offers and rates are likely to have changed.")
    + summaryGrid_([["Postcode", payload.postcode], ["Original reference", payload.reference]])
    + button_(payload.magicLink, "Run a fresh comparison")
    + notice_("Check your inputs", "Update the usage, solar, battery, electric vehicle and controlled load details before relying on the new result.");
  const plain = [intro, "", "It is time to run a fresh electricity comparison for postcode " + payload.postcode + ".", "Run it here: " + safeUrl_(payload.magicLink)].join("\n");
  sendMail_({
    to: payload.email,
    replyTo: REPLY_TO,
    subject: "Your electricity plan check is due | " + BRAND,
    body: plain,
    htmlBody: wrap_("Time to check your electricity plan", "SIX MONTH REMINDER", content, {
      reference: payload.reference,
      unsubscribeToken: unsubscribeToken,
      comparisonFooter: true,
    }),
  });
}

function sendCustomerAcknowledgement_(payload) {
  const content = acknowledgementContent_(payload);
  const title = acknowledgementTitle_(payload.eventType);
  const subject = acknowledgementSubject_(payload);
  sendMail_({
    to: payload.email,
    replyTo: REPLY_TO,
    subject: subject,
    body: acknowledgementText_(payload),
    htmlBody: wrap_(title, "REQUEST RECEIVED", content, { reference: payload.reference }),
  });
}

function acknowledgementContent_(payload) {
  const intro = paragraph_((firstName_(payload.name) ? "Hi " + firstName_(payload.name) + "," : "Hi,") + " your request has been received by Australian Energy Assessments.");
  if (payload.eventType === "electricity.upgrade") {
    return intro
      + summaryGrid_(electricityRows_(payload))
      + notice_("What happens next", "We will review the comparison and scenario assumptions before discussing assessment, product and direct trade options. This request is not a quote or an installation booking.")
      + button_(payload.magicLink, "Review the comparison");
  }
  if (payload.eventType === "gas.upgrade") {
    return intro
      + summaryGrid_(gasRows_(payload))
      + notice_("Indicative scenario", "The saving and installed cost are the values entered or modelled in the tool. Actual performance, tariffs, site conditions, product selection, rebates and quotes can change the outcome.")
      + paragraph_("We will review the request before connecting it with a suitable direct trade option.");
  }
  if (payload.eventType === "direct_trade.project") {
    return intro
      + summaryGrid_(projectRows_(payload))
      + notice_("Review before matching", "We will review the scope, location, priority and timing before deciding whether a participating trade is suitable. This acknowledgement is not a quote and does not guarantee availability.");
  }
  return intro
    + summaryGrid_(partnerRows_(payload))
    + notice_("Participation review", "We will review the business, service coverage, capability and product support before discussing participation. This acknowledgement is not accreditation or automatic approval.");
}

function acknowledgementText_(payload) {
  const lines = [
    "Hi " + (firstName_(payload.name) || "there") + ",",
    "",
    "Your request has been received by " + BRAND + ".",
    "Reference: " + payload.reference,
    "Received: " + receivedAt_(payload),
    "Request: " + eventLabel_(payload),
  ];
  if (payload.postcode) lines.push("Location: " + payload.postcode + (payload.state ? ", " + stateLabel_(payload.state) : ""));
  lines.push("", "We will review the information before responding. This acknowledgement is not a quote or installation booking.", "", BRAND_PHONE + " | " + BRAND_SITE);
  return lines.join("\n");
}

function sendInternalEnquiry_(payload) {
  const rows = [
    ["Reference", payload.reference],
    ["Received", receivedAt_(payload)],
    ["Request", eventLabel_(payload)],
    ["Name", payload.name],
    ["Email", payload.email || "Not supplied"],
    ["Phone", payload.phone || "Not supplied"],
  ].concat(payload.eventType === "electricity.upgrade" ? electricityRows_(payload)
    : payload.eventType === "gas.upgrade" ? gasRows_(payload)
    : payload.eventType === "direct_trade.project" ? projectRows_(payload)
    : partnerRows_(payload));

  const content = notice_("Action", internalAction_(payload))
    + summaryGrid_(dedupeRows_(rows))
    + internalNotes_(payload)
    + internalPlanSummary_(payload);
  const plain = rows.filter(function(row) { return present_(row[1]); }).map(function(row) { return row[0] + ": " + displayValue_(row[1]); }).join("\n");
  sendMail_({
    to: REPLY_TO,
    replyTo: payload.email || REPLY_TO,
    subject: "[" + payload.reference + "] " + eventLabel_(payload) + " | " + (payload.name || "Website enquiry"),
    body: plain,
    htmlBody: wrap_("New website request", "INTERNAL REVIEW", content, { reference: payload.reference, internal: true }),
  });
}

function sendUpgradeInterest_(payload) {
  const content = notice_("Action", "The customer asked to discuss household energy upgrades while emailing their electricity results. Review the comparison before making contact.")
    + summaryGrid_([
      ["Reference", payload.reference],
      ["Received", receivedAt_(payload)],
      ["Name", payload.name],
      ["Email", payload.email],
      ["Phone", payload.phone || "Not supplied"],
      ["Location", location_(payload)],
      ["Annual usage", formatNumber_(payload.annualKwh) + " kWh"],
      ["Current setup", setupLabel_(payload.solar)],
    ]);
  sendMail_({
    to: REPLY_TO,
    replyTo: payload.email,
    subject: "[" + payload.reference + "] Electricity upgrade interest | " + payload.name,
    body: "Electricity upgrade interest\nReference: " + payload.reference + "\nName: " + payload.name + "\nEmail: " + payload.email + "\nPhone: " + (payload.phone || "Not supplied") + "\nLocation: " + location_(payload),
    htmlBody: wrap_("Electricity upgrade interest", "INTERNAL REVIEW", content, { reference: payload.reference, internal: true }),
  });
}

function electricityRows_(payload) {
  return compactRows_([
    ["Option", upgradeLabel_(payload.enquiry)],
    ["Location", location_(payload)],
    ["Annual electricity usage", numberWithUnit_(payload.annualKwh, "kWh")],
    ["Solar size", numberWithUnit_(payload.solarKw, "kW")],
    ["Battery size", numberWithUnit_(payload.batteryKwh, "kWh")],
    ["Scenario installed cost", currencyOrBlank_(installedCost_(payload))],
    ["Indicative annual bill saving", currencyOrBlank_(payload.annualSaving)],
  ]);
}

function gasRows_(payload) {
  return compactRows_([
    ["Option", payload.enquiry === "gas-hot-water" ? "Gas hot water to heat pump" : "Gas heating to reverse cycle"],
    ["Location", location_(payload)],
    ["Annual gas usage", numberWithUnit_(payload.annualMj, "MJ")],
    ["Installed cost entered", currencyOrBlank_(installedCost_(payload))],
    ["Indicative annual running cost saving", currencyOrBlank_(payload.annualSaving)],
  ]);
}

function projectRows_(payload) {
  const triage = payload.directTradeTriage || {};
  return compactRows_([
    ["Services", listLabels_(payload.projectCategories, categoryLabel_)],
    ["Location", location_(payload)],
    ["Property", propertyLabel_(payload.propertyType)],
    ["Customer role", relationshipLabel_(payload.propertyRelationship)],
    ["Project stage", stageLabel_(payload.projectStage)],
    ["Preferred timing", timeframeLabel_(payload.timeframe)],
    ["Priorities", listLabels_(payload.projectPriorities, priorityLabel_)],
    ["Journey source", projectSourceLabel_(payload.projectSource)],
    ["Preferred contact", contactLabel_(payload.preferredContact)],
    ["Triage status", triageStatusLabel_(triage.status)],
    ["Review priority", triagePriorityLabel_(triage.priority)],
    ["Review flags", listLabels_(triage.reviewFlags, triageFlagLabel_)],
    ["Automatic distribution", triage.autoSend === false ? "Off. Manual approval required." : "Not specified"],
  ]);
}

function triageStatusLabel_(value) {
  const labels = { manual_matching_review: "Ready for manual matching review", hold_for_authority_review: "Hold until property authority is reviewed" };
  return labels[value] || value;
}

function triagePriorityLabel_(value) {
  const labels = { urgent_manual_review: "Urgent manual review", quote_ready_review: "Quote-ready review", standard_review: "Standard review" };
  return labels[value] || value;
}

function triageFlagLabel_(value) {
  const labels = {
    property_authority_unconfirmed: "Property authority is not confirmed",
    custom_scope_requires_clarification: "Custom scope needs clarification",
    assessment_or_advice_may_be_needed_first: "Assessment or advice may be needed first",
    owners_corporation_or_shared_property_checks_may_apply: "Shared property approvals may apply",
  };
  return labels[value] || value;
}

function partnerRows_(payload) {
  const review = payload.participantReview || {};
  return compactRows_([
    ["Participation type", payload.partnerType === "supplier" ? "Product supplier or wholesaler" : "Licensed installer"],
    ["Business", payload.businessName],
    ["Business website", payload.businessWebsite],
    ["Service areas", listLabels_(payload.serviceStates, stateLabel_)],
    ["Capabilities or products", listLabels_(payload.projectCategories, categoryLabel_)],
    ["Application status", review.status === "application_received" ? "Application received for manual review" : review.status],
    ["Review checks", participantReviewChecks_(review.checks)],
    ["Automatic approval", review.autoApprove === false ? "Off. Direct review required." : "Not specified"],
    ["Public listing", review.publicListing === false ? "Off until review and consent are complete." : "Not specified"],
  ]);
}

function participantReviewChecks_(checks) {
  if (!Array.isArray(checks)) return "";
  return checks.filter(function(check) { return check && check.label; }).map(function(check) { return check.label; }).join("; ");
}

function internalNotes_(payload) {
  const notes = payload.eventType === "direct_trade.project" ? payload.projectNotes : payload.eventType === "direct_trade.partner" ? payload.partnerNotes : "";
  return notes ? notice_(payload.eventType === "direct_trade.project" ? "Project notes" : "Business notes", notes) : "";
}

function internalPlanSummary_(payload) {
  return payload.top3 && payload.top3.length ? '<div style="margin-top:22px"><div style="color:#20cbb8;font-size:12px;font-weight:800;letter-spacing:.08em;margin-bottom:10px">COMPARISON CONTEXT</div>' + planCards_(payload.top3) + "</div>" : "";
}

function wrap_(title, kicker, content, options) {
  options = options || {};
  const footerText = options.comparisonFooter
    ? "Electricity costs and savings are indicative. Confirm current rates, eligibility, fees and terms with the retailer."
    : "Australian Energy Assessments reviews each request before responding or connecting it with a participating trade.";
  const unsubscribe = options.unsubscribeToken
    ? '<p style="margin:14px 0 0;font-size:12px"><a style="color:#8bbfb5" href="' + escAttr_(unsubscribeUrl_(options.unsubscribeToken)) + '">Stop these comparison reminders</a></p>'
    : "";
  const internalTag = options.internal ? '<span style="display:inline-block;background:#fff4d6;color:#755100;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:800;letter-spacing:.06em">INTERNAL</span>' : "";
  return '<!doctype html><html><body style="margin:0;background:#eef4f3;padding:24px 10px;color:#092c38;font-family:Arial,Helvetica,sans-serif">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #cfe1dd;box-shadow:0 16px 44px rgba(0,31,52,.14)">'
    + '<tr><td style="background:linear-gradient(135deg,#03192d,#084756);padding:28px 30px;border-bottom:5px solid #20cbb8">'
    + '<table role="presentation" width="100%"><tr><td><div style="color:#55ead6;font-size:12px;font-weight:800;letter-spacing:.12em">' + esc_(kicker) + '</div>'
    + '<div style="color:#ffffff;font-size:24px;font-weight:800;line-height:1.18;margin-top:8px">' + esc_(title) + '</div>'
    + '<div style="color:#bcd9da;font-size:13px;margin-top:8px">Powered by ' + BRAND + '</div></td><td align="right" valign="top">' + internalTag + '</td></tr></table>'
    + '</td></tr><tr><td style="padding:30px">' + content + '</td></tr>'
    + '<tr><td style="background:#03192d;padding:22px 30px;color:#bcd0d3;font-size:12px;line-height:1.55">'
    + '<strong style="color:#ffffff">' + BRAND + '</strong><br>' + esc_(footerText) + '<br>'
    + '<a style="color:#55ead6" href="tel:1300241149">' + BRAND_PHONE + '</a> &nbsp;|&nbsp; <a style="color:#55ead6" href="' + BRAND_SITE + '">ausenergyassessments.com</a>'
    + (options.reference ? '<br>Reference: ' + esc_(options.reference) : "") + unsubscribe
    + '</td></tr></table></td></tr></table></body></html>';
}

function paragraph_(text) {
  return '<p style="font-size:16px;line-height:1.65;margin:0 0 18px;color:#244651">' + esc_(text) + '</p>';
}

function muted_(text) {
  return '<p style="font-size:12px;line-height:1.55;margin:14px 0;color:#657d84">' + esc_(text) + '</p>';
}

function notice_(title, text) {
  return '<div style="margin:20px 0;padding:17px 18px;background:#eaf8f4;border-left:4px solid #12a66a;border-radius:10px">'
    + '<div style="font-size:13px;font-weight:800;color:#08734f;margin-bottom:5px">' + esc_(title) + '</div>'
    + '<div style="font-size:14px;line-height:1.55;color:#31575d">' + esc_(text) + '</div></div>';
}

function summaryGrid_(rows) {
  const visible = compactRows_(rows);
  if (!visible.length) return "";
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d8e7e4;border-radius:12px;overflow:hidden;margin:18px 0">'
    + visible.map(function(row, index) {
      return '<tr><td style="width:38%;padding:11px 14px;background:' + (index % 2 ? "#f8fbfa" : "#eef7f5") + ';font-size:12px;font-weight:800;color:#397069;vertical-align:top">' + esc_(row[0]) + '</td>'
        + '<td style="padding:11px 14px;background:' + (index % 2 ? "#ffffff" : "#fbfdfd") + ';font-size:14px;font-weight:650;color:#092c38;vertical-align:top">' + esc_(displayValue_(row[1])) + '</td></tr>';
    }).join("") + "</table>";
}

function planCards_(plans) {
  return (plans || []).slice(0, 3).map(function(plan) {
    const link = safeUrl_(plan.link);
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0;border:1px solid #cfe1dd;border-radius:13px;overflow:hidden"><tr>'
      + '<td style="width:46px;background:#0b5a63;color:#ffffff;text-align:center;font-weight:800">#' + esc_(plan.rank) + '</td>'
      + '<td style="padding:15px"><div style="font-size:16px;font-weight:800;color:#092c38">' + esc_(plan.plan) + '</div>'
      + '<div style="font-size:12px;color:#647b82;margin-top:4px">' + esc_(plan.brand) + (plan.offerId ? " | Offer ID " + esc_(plan.offerId) : "") + '</div></td>'
      + '<td align="right" style="padding:15px;white-space:nowrap"><div style="font-size:18px;font-weight:800;color:#08734f">' + esc_(formatCurrency_(plan.annual)) + '</div>'
      + '<div style="font-size:11px;color:#647b82">estimated per year</div>' + (link ? '<a style="display:inline-block;margin-top:7px;color:#087f73;font-size:12px;font-weight:800" href="' + escAttr_(link) + '">View retailer plan</a>' : "") + '</td></tr></table>';
  }).join("");
}

function planText_(plans) {
  return (plans || []).slice(0, 3).map(function(plan) {
    return "#" + plan.rank + " " + plan.plan + " | " + plan.brand + " | " + formatCurrency_(plan.annual) + " per year" + (safeUrl_(plan.link) ? " | " + safeUrl_(plan.link) : "");
  }).join("\n");
}

function button_(url, label) {
  const safe = safeUrl_(url);
  return safe ? '<p style="margin:24px 0"><a href="' + escAttr_(safe) + '" style="display:inline-block;background:#12a66a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:13px 20px;border-radius:10px;box-shadow:0 8px 20px rgba(18,166,106,.24)">' + esc_(label) + '</a></p>' : "";
}

function servicePage_(title, message) {
  return '<!doctype html><html><body style="margin:0;background:#03192d;padding:40px 16px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:20px;padding:30px;border-top:5px solid #20cbb8"><h1 style="color:#092c38">' + esc_(title) + '</h1><p style="color:#31575d;line-height:1.6">' + esc_(message) + '</p><p><a style="color:#087f73" href="' + BRAND_SITE + '">Return to ' + BRAND + '</a></p></div></body></html>';
}

function sendMail_(message) {
  MailApp.sendEmail({
    to: message.to,
    name: BRAND,
    replyTo: message.replyTo || REPLY_TO,
    subject: message.subject,
    body: message.body,
    htmlBody: message.htmlBody,
  });
}

function internalAction_(payload) {
  if (payload.eventType === "electricity.upgrade") return "Review the electricity comparison and scenario assumptions, then respond using the preferred contact details.";
  if (payload.eventType === "gas.upgrade") return "Review the gas usage and electrification estimate, then confirm site, product, rebate and trade requirements.";
  if (payload.eventType === "direct_trade.project") return "Qualify the scope, authority, location, timing and trade capability before making a connection.";
  return "Review business credentials, coverage, capability, insurance and product support before discussing participation.";
}

function acknowledgementTitle_(eventType) {
  if (eventType === "electricity.upgrade") return "We received your electricity upgrade enquiry";
  if (eventType === "gas.upgrade") return "We received your gas upgrade enquiry";
  if (eventType === "direct_trade.project") return "Your Direct Trade project brief is in";
  return "Your participation enquiry is in";
}

function acknowledgementSubject_(payload) {
  return "[" + payload.reference + "] " + acknowledgementTitle_(payload.eventType) + " | " + BRAND;
}

function eventLabel_(payload) {
  if (payload.eventType === "electricity.upgrade") return upgradeLabel_(payload.enquiry);
  if (payload.eventType === "gas.upgrade") return payload.enquiry === "gas-hot-water" ? "Heat pump hot water enquiry" : "Reverse cycle heating enquiry";
  if (payload.eventType === "direct_trade.project") return "Direct Trade household project brief";
  return payload.partnerType === "supplier" ? "Direct Trade supplier expression of interest" : "Direct Trade installer expression of interest";
}

function upgradeLabel_(value) {
  if (value === "electricity-battery" || value === "battery") return "Home battery enquiry";
  if (value === "electricity-solar-battery" || value === "solar-battery") return "Rooftop solar and home battery enquiry";
  return "Rooftop solar enquiry";
}

function setupLabel_(value) {
  if (value === "battery" || value === "batt") return "Solar and battery";
  if (value === "solar") return "Solar";
  return "No solar entered";
}

function categoryLabel_(value) {
  const labels = { assessment: "Independent energy assessment", solar: "Rooftop solar", battery: "Home battery", "heating-cooling": "Heating and cooling", "hot-water": "Hot water", "insulation-draughts": "Insulation and draught control", "ev-charging": "EV charging", other: "Other energy upgrade" };
  return labels[value] || value;
}

function propertyLabel_(value) {
  const labels = { house: "House", "townhouse-unit": "Townhouse or unit", apartment: "Apartment", "small-business": "Small business", other: "Other" };
  return labels[value] || value;
}

function relationshipLabel_(value) {
  const labels = { "owner-occupier": "Owner or co-owner", "landlord-manager": "Landlord or authorised property manager", "authorised-tenant": "Tenant with authority to seek options", "organisation-representative": "Authorised organisation representative", "planning-only": "Planning only, authority not yet confirmed" };
  return labels[value] || value;
}

function priorityLabel_(value) {
  const labels = { "lower-running-costs": "Lower running costs", "improve-comfort": "Improve comfort", "replace-equipment": "Replace ageing or failed equipment", "move-from-gas": "Move away from gas", "solar-storage": "Add solar, storage or backup", "assessment-compliance": "Assessment or compliance evidence", "need-advice": "Not sure yet, need advice" };
  return labels[value] || value;
}

function projectSourceLabel_(value) {
  const labels = { "electricity-solar": "Electricity solar scenario", "electricity-battery": "Electricity battery scenario", "gas-heating": "Gas heating upgrade estimate", "gas-hot-water": "Gas hot-water upgrade estimate" };
  return labels[value] || value;
}

function stageLabel_(value) {
  const labels = { researching: "Researching options", "assessment-ready": "Ready for an assessment", "seeking-quotes": "Ready to seek quotes", "replacement-urgent": "Failed equipment needs replacement" };
  return labels[value] || value;
}

function timeframeLabel_(value) {
  const labels = { urgent: "As soon as practical", "one-three-months": "Within 1 to 3 months", "three-six-months": "Within 3 to 6 months", later: "More than 6 months away" };
  return labels[value] || value;
}

function contactLabel_(value) {
  return value === "email" ? "Email" : value === "phone" ? "Phone" : "Email or phone";
}

function stateLabel_(value) {
  const labels = { ACT: "ACT", NSW: "NSW", NT: "NT", QLD: "Qld", Qld: "Qld", SA: "SA", TAS: "Tas", Tas: "Tas", VIC: "Vic", Vic: "Vic", WA: "WA" };
  return labels[value] || value;
}

function sourceNote_(provenance) {
  if (!provenance) return "";
  const parts = [];
  if (provenance.sourceFetchedAt && validDate_(provenance.sourceFetchedAt)) parts.push("Plan data retrieved " + Utilities.formatDate(new Date(provenance.sourceFetchedAt), TIME_ZONE, "d MMM yyyy, h:mm a z"));
  if (provenance.annualSource) parts.push("usage source: " + String(provenance.annualSource).replaceAll("-", " "));
  if (provenance.conditionalDiscountsAssumed) parts.push("conditional discounts were included");
  return parts.join(" | ");
}

function receivedAt_(payload) {
  return Utilities.formatDate(new Date(payload.submittedAt), TIME_ZONE, "d MMM yyyy, h:mm a z");
}

function location_(payload) {
  return [payload.postcode, stateLabel_(payload.state)].filter(Boolean).join(", ");
}

function installedCost_(payload) {
  if (number_(payload.installedCost) !== null) return number_(payload.installedCost);
  if (number_(payload.comboCost) !== null) return number_(payload.comboCost);
  return number_(payload.solarCost);
}

function compactRows_(rows) {
  return (rows || []).filter(function(row) { return present_(row[1]); });
}

function dedupeRows_(rows) {
  const seen = {};
  return compactRows_(rows).filter(function(row) {
    const key = String(row[0]);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function listLabels_(values, mapper) {
  return Array.isArray(values) ? values.map(mapper).filter(Boolean).join(", ") : "";
}

function present_(value) {
  return value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length);
}

function displayValue_(value) {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function valueOrBlank_(value) {
  const number = number_(value);
  return number === null ? "" : number;
}

function number_(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberWithUnit_(value, unit) {
  const number = number_(value);
  return number === null ? "" : formatNumber_(number) + " " + unit;
}

function currencyOrBlank_(value) {
  return number_(value) === null ? "" : formatCurrency_(value);
}

function formatCurrency_(value) {
  const number = number_(value);
  return number === null ? "" : "$" + Math.round(number).toLocaleString("en-AU");
}

function formatNumber_(value) {
  const number = number_(value);
  return number === null ? "" : number.toLocaleString("en-AU", { maximumFractionDigits: Number.isInteger(number) ? 0 : 1 });
}

function firstName_(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function safeUrl_(value) {
  const text = String(value || "").trim();
  return /^https:\/\//i.test(text) ? text : "";
}

function validEmail_(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || "").trim());
}

function validDate_(value) {
  return value && !isNaN(new Date(value).getTime());
}

function validReference_(value) {
  return /^AEA-\d{8}-[A-Z0-9]{6,16}$/.test(String(value || ""));
}

function reference_() {
  return "AEA-" + Utilities.formatDate(new Date(), TIME_ZONE, "yyyyMMdd") + "-" + opaqueToken_().slice(0, 10);
}

function opaqueToken_() {
  return Utilities.getUuid().replace(/-/g, "").toUpperCase();
}

function legacyToken_(email) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email + LEGACY_SECRET);
  return raw.map(function(byte) { return ((byte & 0xff) + 0x100).toString(16).slice(1); }).join("").slice(0, 12);
}

function unsubscribeUrl_(token) {
  return ScriptApp.getService().getUrl() + "?action=unsub&t=" + encodeURIComponent(token);
}

function esc_(value) {
  return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function(character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

function escAttr_(value) {
  return esc_(value);
}

function out_(value) {
  return ContentService.createTextOutput(value).setMimeType(ContentService.MimeType.TEXT);
}

function html_(value) {
  return HtmlService.createHtmlOutput(value);
}
