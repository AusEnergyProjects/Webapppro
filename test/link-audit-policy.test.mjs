import test from "node:test";
import assert from "node:assert/strict";
import {
  isAuditableUrl,
  linkNetworkFailureDisposition,
  linkResponseIsAutomationBlocked,
  linkResponseIsBroken,
} from "../scripts/lib/link-audit-policy.mjs";

test("link audit ignores placeholders, parser sentinels and method-specific service endpoints", () => {
  assert.equal(isAuditableUrl("https://www.example.com/current-source"), false);
  assert.equal(isAuditableUrl("https://creditex.invalid"), false);
  assert.equal(isAuditableUrl("https://.."), false);
  assert.equal(isAuditableUrl("https://oauth2.googleapis.com/token"), false);
  assert.equal(isAuditableUrl("https://identity.xero.com/connect/token"), false);
  assert.equal(isAuditableUrl("https://secure.myob.com/oauth2/v1/authorize"), false);
  assert.equal(isAuditableUrl("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"), false);
  assert.equal(isAuditableUrl("https://login.microsoftonline.com/common/oauth2/v2.0/token"), false);
  assert.equal(isAuditableUrl("https://www.energy.gov.au/"), true);
});

test("link audit fails closed for first-party routes and genuinely removed public pages", () => {
  assert.equal(linkResponseIsBroken("page", 403), true);
  assert.equal(linkResponseIsBroken("page", 204), true);
  assert.equal(linkResponseIsBroken("api", 429), true);
  assert.equal(linkResponseIsBroken("link", 403), false);
  assert.equal(linkResponseIsBroken("link", 400), true);
  assert.equal(
    linkResponseIsBroken("link", 400, true, "https://www.facebook.com/ausenergyassessments/"),
    false,
  );
  assert.equal(
    linkResponseIsBroken("link", 400, true, "https://www.facebook.com/a-deleted-page/"),
    true,
  );
  assert.equal(linkResponseIsBroken("link", 451), true);
  assert.equal(linkResponseIsBroken("link", 410), true);
  assert.equal(linkResponseIsBroken("api", 200, false), true);
});

test("link audit reports only explicitly verified anti-automation responses as blocked", () => {
  assert.equal(linkResponseIsAutomationBlocked("link", 403, "https://www.energy.gov.au/"), true);
  assert.equal(
    linkResponseIsAutomationBlocked("link", 400, "https://www.facebook.com/ausenergyassessments/"),
    true,
  );
  assert.equal(
    linkResponseIsAutomationBlocked("link", 400, "https://www.facebook.com/a-deleted-page/"),
    false,
  );
  assert.equal(linkResponseIsAutomationBlocked("page", 403, "https://compare.ausenergyassessments.com/"), false);
});

test("link audit keeps confirmed DNS and certificate failures fatal", () => {
  assert.equal(linkNetworkFailureDisposition({ cause: { code: "ENOTFOUND" } }), "broken");
  assert.equal(linkNetworkFailureDisposition({ cause: { code: "CERT_HAS_EXPIRED" } }), "broken");
  assert.equal(linkNetworkFailureDisposition({ name: "AbortError" }), "unverified");
  assert.equal(linkNetworkFailureDisposition(new TypeError("fetch failed")), "unverified");
});
