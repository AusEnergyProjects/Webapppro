import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalAliasRedirectsEnabled,
  canonicalPublicTarget,
  publicRedirectTarget,
  shouldApplyCanonicalHostRedirect,
} from "../src/lib/public-redirects.mjs";

test("legacy public redirects are one-hop apex URLs and preserve the full query", () => {
  assert.equal(
    publicRedirectTarget("https://compare.ausenergyassessments.com/blog?cutover_audit=1&topic=solar&topic=battery"),
    "https://ausenergyassessments.com/guides?cutover_audit=1&topic=solar&topic=battery",
  );
  assert.equal(
    publicRedirectTarget("https://compare.ausenergyassessments.com/sitemap?source=legacy"),
    "https://ausenergyassessments.com/sitemap.xml?source=legacy",
  );
});

test("approved article redirects tolerate a trailing slash and unknown paths fail closed", () => {
  assert.equal(
    publicRedirectTarget("https://compare.ausenergyassessments.com/blog/heat-pumps-in-australia--a-comprehensive-guide-for-homeowners/?ref=old"),
    "https://ausenergyassessments.com/guides/heat-pumps?ref=old",
  );
  assert.equal(
    publicRedirectTarget("https://compare.ausenergyassessments.com/blog/unreviewed-article"),
    null,
  );
  assert.equal(
    publicRedirectTarget("https://compare.ausenergyassessments.com/not-a-real-page"),
    null,
  );
});

test("public aliases and plain HTTP apex canonicalise in one hop", () => {
  for (const source of [
    "https://www.ausenergyassessments.com/faq?from=www",
    "https://compare.ausenergyassessments.com/faq?from=compare",
    "https://aea-energy-comparison.info294029.chatgpt.site/faq?from=sites",
    "http://ausenergyassessments.com/faq?from=http",
  ]) {
    const target = canonicalPublicTarget(source);
    assert.equal(new URL(target).origin, "https://ausenergyassessments.com");
    assert.equal(new URL(target).pathname, "/faq");
    assert.equal(new URL(target).search, new URL(source).search);
  }
});

test("canonical host redirects never absorb API posts or unknown hosts", () => {
  assert.equal(canonicalPublicTarget("https://ausenergyassessments.com/faq"), null);
  assert.equal(canonicalPublicTarget("https://compare.ausenergyassessments.com/api/leads"), null);
  assert.equal(canonicalPublicTarget("https://compare.ausenergyassessments.com/faq", "POST"), null);
  assert.equal(canonicalPublicTarget("https://attacker.example/faq"), null);
});

test("alias redirects remain off during candidate testing and turn on only with the exact cutover flag", () => {
  assert.equal(canonicalAliasRedirectsEnabled(undefined), false);
  assert.equal(canonicalAliasRedirectsEnabled({ APEX_CANONICAL_REDIRECTS_ENABLED: "false" }), false);
  assert.equal(canonicalAliasRedirectsEnabled({ APEX_CANONICAL_REDIRECTS_ENABLED: "TRUE" }), true);
  assert.equal(
    shouldApplyCanonicalHostRedirect("https://compare.ausenergyassessments.com/faq", {}),
    false,
  );
  assert.equal(
    shouldApplyCanonicalHostRedirect("https://compare.ausenergyassessments.com/faq", {
      APEX_CANONICAL_REDIRECTS_ENABLED: "true",
    }),
    true,
  );
  assert.equal(
    shouldApplyCanonicalHostRedirect("http://ausenergyassessments.com/faq", {}),
    true,
  );
});
