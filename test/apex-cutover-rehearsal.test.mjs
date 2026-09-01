import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalFromHtml,
  evaluateExternalEvidence,
  expectedRedirectUrl,
  extractXmlLocations,
  hasNoindex,
  hasNoindexDirective,
  openGraphUrlFromHtml,
  parseCutoverArguments,
  robotsBlocksSearchCrawlers,
  summariseCutoverReport,
} from "../scripts/lib/apex-cutover-rehearsal.mjs";

test("cutover rehearsal fails closed when required identity arguments are missing", () => {
  assert.throws(() => parseCutoverArguments([]), /Missing required cutover arguments/);
  assert.throws(() => parseCutoverArguments([
    "--candidate-origin=https://compare.ausenergyassessments.com",
    "--expected-apex-origin=https://ausenergyassessments.com",
    "--expected-release=short",
    "--dns-baseline=scripts/data/baseline.json",
    "--external-evidence=scripts/data/evidence.json",
    "--phase=candidate",
  ]), /40-character Git commit SHA/);

  assert.throws(() => parseCutoverArguments([
    "--candidate-origin=https://staging.example.com",
    "--expected-apex-origin=https://ausenergyassessments.com",
    "--expected-release=0123456789abcdef0123456789abcdef01234567",
    "--dns-baseline=scripts/data/baseline.json",
    "--external-evidence=scripts/data/evidence.json",
    "--phase=post-cutover",
  ]), /candidate-origin must equal expected-apex-origin/);
});

test("canonical, Open Graph, noindex and sitemap evidence are parsed exactly", () => {
  const html = '<link rel="canonical" href="https://ausenergyassessments.com/team"><meta property="og:url" content="https://ausenergyassessments.com/team"><meta name="robots" content="noindex, follow">';
  assert.equal(canonicalFromHtml(html), "https://ausenergyassessments.com/team");
  assert.equal(openGraphUrlFromHtml(html), "https://ausenergyassessments.com/team");
  assert.equal(hasNoindex(html), true);
  assert.equal(hasNoindex('<meta name="googlebot" content="none">'), true);
  assert.equal(hasNoindexDirective("bingbot: noindex, follow"), true);
  assert.equal(robotsBlocksSearchCrawlers("User-agent: *\nDisallow: /"), true);
  assert.equal(robotsBlocksSearchCrawlers("User-agent: Googlebot\nDisallow: /*"), true);
  assert.equal(robotsBlocksSearchCrawlers("User-agent: Bingbot\nDisallow: /"), true);
  assert.equal(robotsBlocksSearchCrawlers("User-agent: *\nDisallow: /account"), false);
  assert.deepEqual(extractXmlLocations("<urlset><url><loc>https://ausenergyassessments.com/</loc></url></urlset>"), [
    "https://ausenergyassessments.com/",
  ]);
});

test("redirect evidence preserves the requested query without creating a chain", () => {
  assert.equal(
    expectedRedirectUrl("https://ausenergyassessments.com", "/guides", "audit=1"),
    "https://ausenergyassessments.com/guides?audit=1",
  );
});

test("external readiness requires every provider, domain and critical flow", () => {
  const evidence = {
    reviewedAt: "2026-09-02T02:00:00.000Z",
    candidateOrigin: "https://compare.ausenergyassessments.com",
    expectedApexOrigin: "https://ausenergyassessments.com",
    expectedRelease: "0123456789abcdef0123456789abcdef01234567",
    searchConsole: { property: "sc-domain:ausenergyassessments.com", ownerVerified: true, newSitemapSubmitted: true },
    googleBusinessProfile: { continuityVerified: true, replacementProfileRequired: false },
    destination: { apexAttached: true, wwwAttached: true, tlsVerified: true },
    analytics: { legacyMeasurementId: "G-3PGGJ0JX4H", destinationMeasurementId: "G-3PGGJ0JX4H", destinationConfigured: true },
    firebase: { authorisedDomains: ["ausenergyassessments.com"] },
    criticalFlows: { bookingCalendarAndEmails: true, apexQuoteLink: true },
    dns: { baselineApproved: true, rollbackReady: true },
    oauthCallbacks: {
      xero: "https://ausenergyassessments.com/api/trade-integrations/callback/xero",
      myob: "https://ausenergyassessments.com/api/trade-integrations/callback/myob",
      quickbooks: "https://ausenergyassessments.com/api/trade-integrations/callback/quickbooks",
      google_calendar: "https://ausenergyassessments.com/api/trade-integrations/callback/google_calendar",
      microsoft_calendar: "https://ausenergyassessments.com/api/trade-integrations/callback/microsoft_calendar",
    },
  };
  const context = {
    candidateOrigin: "https://compare.ausenergyassessments.com",
    expectedApexOrigin: "https://ausenergyassessments.com",
    expectedRelease: "0123456789abcdef0123456789abcdef01234567",
    now: Date.parse("2026-09-02T03:00:00.000Z"),
  };
  const checks = evaluateExternalEvidence(evidence, context);
  assert.equal(checks.every((check) => check.passed), true);

  const postCutoverChecks = evaluateExternalEvidence({
    ...evidence,
    candidateOrigin: "https://ausenergyassessments.com",
    searchConsole: { ...evidence.searchConsole, newSitemapSubmitted: false },
  }, { ...context, candidateOrigin: "https://ausenergyassessments.com", phase: "post-cutover" });
  assert.equal(
    postCutoverChecks.find((check) => check.id === "search_console_apex_sitemap_submitted")?.passed,
    false,
  );

  const staleChecks = evaluateExternalEvidence(evidence, {
    ...context,
    now: Date.parse("2026-09-04T03:00:00.000Z"),
  });
  assert.equal(staleChecks.find((check) => check.id === "evidence_fresh")?.passed, false);

  const missingCallback = checks.map((check) => check.id === "oauth_callback_xero" ? { ...check, passed: false } : check);
  assert.deepEqual(summariseCutoverReport({
    sourceChecks: [{ id: "contract", passed: true }],
    candidateChecks: [{ id: "candidate", passed: true }],
    externalChecks: missingCallback,
    postCutoverChecks: [{ id: "post", passed: true }],
  }), {
    sourceReady: true,
    candidateReady: true,
    externalReady: false,
    postCutoverReady: true,
    readyForDnsChange: false,
    cutoverReady: false,
  });
});
