import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalFromHtml,
  dmarcRecordSetIsValid,
  evaluateExternalEvidence,
  expectedRedirectUrl,
  extractXmlLocations,
  hasNoindex,
  hasNoindexDirective,
  openGraphUrlFromHtml,
  parseCutoverArguments,
  publicResolverRoutingTtlEvidenceIsValid,
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

  assert.throws(() => parseCutoverArguments([
    "--candidate-origin=https://compare.ausenergyassessments.com",
    "--expected-apex-origin=https://ausenergyassessments.com",
    "--expected-release=0123456789abcdef0123456789abcdef01234567",
    "--dns-baseline=scripts/data/baseline.json",
    "--external-evidence=scripts/data/evidence.json",
    "--phase=attached",
  ]), /phase must be one of: candidate, post-cutover/);
});

test("mail DNS evidence requires one well-formed DMARC record with one policy", () => {
  assert.equal(dmarcRecordSetIsValid(["v=DMARC1; p=none; rua=mailto:dmarc@example.com"]), true);
  assert.equal(dmarcRecordSetIsValid(["v=DMARC1; p=quarantine"]), true);
  assert.equal(dmarcRecordSetIsValid(["v=DMARC1; p=reject"]), true);
  assert.equal(dmarcRecordSetIsValid([]), false);
  assert.equal(dmarcRecordSetIsValid(["v=DMARC1; rua=mailto:dmarc@example.com"]), false);
  assert.equal(dmarcRecordSetIsValid(["v=DMARC1; p=none; p=reject"]), false);
  assert.equal(dmarcRecordSetIsValid(["v=DMARC1; p=none", "v=DMARC1; p=reject"]), false);
  assert.equal(dmarcRecordSetIsValid(["p=none; v=DMARC1"]), false);
  assert.equal(dmarcRecordSetIsValid(["v=DMARC1; p"]), false);
});

test("public resolver TTL evidence requires both resolvers and rejects stale or wrong records", () => {
  const resolvers = ["cloudflare", "google"];
  const record = {
    name: "www.ausenergyassessments.com",
    type: "CNAME",
    ttl: 1800,
    value: "websites.mydurable.com",
  };
  const observation = (resolver, overrides = {}) => ({
    resolver,
    name: record.name,
    type: record.type,
    records: [record],
    ...overrides,
  });
  const expectation = {
    expectedResolvers: resolvers,
    expectedValues: [record.value],
    maxTtl: 1800,
    name: record.name,
    type: record.type,
  };

  assert.equal(publicResolverRoutingTtlEvidenceIsValid(
    resolvers.map((resolver) => observation(resolver)),
    expectation,
  ), true);
  assert.equal(publicResolverRoutingTtlEvidenceIsValid(
    [observation(resolvers[0])],
    expectation,
  ), false, "both independent resolver observations are required");
  assert.equal(publicResolverRoutingTtlEvidenceIsValid([
    observation(resolvers[0]),
    observation(resolvers[1], { records: [{ ...record, ttl: 1801 }] }),
  ], expectation), false, "a remaining cache TTL over the limit must fail");
  assert.equal(publicResolverRoutingTtlEvidenceIsValid([
    observation(resolvers[0]),
    observation(resolvers[1], { records: [{ ...record, value: "unexpected.example" }] }),
  ], expectation), false, "the current record value must match exactly");
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
    destination: {
      apexAttached: true,
      wwwAttached: true,
      tlsVerified: true,
      canonicalAliasRedirectsEnabled: false,
    },
    analytics: {
      legacyMeasurementId: "G-3PGGJ0JX4H",
      destinationMeasurementId: "G-3PGGJ0JX4H",
      destinationConfigured: true,
      manualPageViewsOnly: true,
      historyPageViewsDisabled: true,
    },
    firebase: { authorisedDomains: ["ausenergyassessments.com", "www.ausenergyassessments.com"] },
    criticalFlows: {
      origin: "https://compare.ausenergyassessments.com",
      bookingCalendarAndEmails: true,
      quoteLink: true,
    },
    dns: {
      baselineApproved: true,
      routingTtlControlPlaneVerified: true,
      rollbackReady: true,
    },
    oauthCallbacks: {
      xero: { status: "not-configured", callback: null },
      myob: { status: "not-configured", callback: null },
      quickbooks: { status: "not-configured", callback: null },
      google_calendar: { status: "configured", callback: "https://ausenergyassessments.com/api/trade-integrations/callback/google_calendar" },
      microsoft_calendar: { status: "not-configured", callback: null },
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
    destination: { ...evidence.destination, canonicalAliasRedirectsEnabled: true },
    criticalFlows: { ...evidence.criticalFlows, origin: "https://ausenergyassessments.com" },
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

  const missingCallback = evaluateExternalEvidence({
    ...evidence,
    oauthCallbacks: {
      ...evidence.oauthCallbacks,
      xero: { status: "configured", callback: null },
    },
  }, context);
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
