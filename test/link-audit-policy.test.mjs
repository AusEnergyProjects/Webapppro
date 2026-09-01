import test from "node:test";
import assert from "node:assert/strict";
import {
  isAuditableUrl,
  linkNetworkFailureDisposition,
  linkResponseIsBroken,
} from "../scripts/lib/link-audit-policy.mjs";

test("link audit ignores placeholders, parser sentinels and method-specific service endpoints", () => {
  assert.equal(isAuditableUrl("https://www.example.com/current-source"), false);
  assert.equal(isAuditableUrl("https://creditex.invalid"), false);
  assert.equal(isAuditableUrl("https://.."), false);
  assert.equal(isAuditableUrl("https://oauth2.googleapis.com/token"), false);
  assert.equal(isAuditableUrl("https://www.energy.gov.au/"), true);
});

test("link audit fails closed for first-party routes and genuinely removed public pages", () => {
  assert.equal(linkResponseIsBroken("page", 403), true);
  assert.equal(linkResponseIsBroken("page", 204), true);
  assert.equal(linkResponseIsBroken("api", 429), true);
  assert.equal(linkResponseIsBroken("link", 403), false);
  assert.equal(linkResponseIsBroken("link", 400), true);
  assert.equal(linkResponseIsBroken("link", 451), true);
  assert.equal(linkResponseIsBroken("link", 410), true);
  assert.equal(linkResponseIsBroken("api", 200, false), true);
});

test("link audit keeps confirmed DNS and certificate failures fatal", () => {
  assert.equal(linkNetworkFailureDisposition({ cause: { code: "ENOTFOUND" } }), "broken");
  assert.equal(linkNetworkFailureDisposition({ cause: { code: "CERT_HAS_EXPIRED" } }), "broken");
  assert.equal(linkNetworkFailureDisposition({ name: "AbortError" }), "unverified");
  assert.equal(linkNetworkFailureDisposition(new TypeError("fetch failed")), "unverified");
});
