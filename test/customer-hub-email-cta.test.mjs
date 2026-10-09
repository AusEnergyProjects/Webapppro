import test from "node:test";
import assert from "node:assert/strict";
import { customerHubEmailCta, customerHubUpdateEmailHtml } from "../src/lib/customer-hub-email.mjs";

const url = "https://ausenergyassessments.com/customer-hub/private-test-link?section=qa";
test("customer hub CTA is prominent, explains future quotes and questions, and provides a plain-text link", () => {
  const cta = customerHubEmailCta(url);
  assert.match(cta.html, /Open my quotes &amp; questions/);
  assert.match(cta.html, /display:block;padding:18px 16px/);
  assert.match(cta.html, /font-size:19px;line-height:27px/);
  assert.match(cta.html, /As businesses send quotes or ask questions/);
  assert.match(cta.html, /share photos or documents, all in one place/);
  assert.match(cta.text, /Use this same link for every update/);
  assert.match(cta.html, /No account or extra form is needed/);
  assert.doesNotMatch(cta.html, /private customer hub/);
  assert.ok(cta.text.includes(url));
});
test("shared update email escapes customer-controlled content and rejects unsafe destinations", () => {
  const html = customerHubUpdateEmailHtml('Question about <img src=x onerror=alert(1)>', url);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /Open my quotes &amp; questions/);
  for (const invalid of ["javascript:alert(1)", "https://example.com/customer-hub/token", "https://ausenergyassessments.com/other", "https://user:password@ausenergyassessments.com/customer-hub/token"]) {
    assert.throws(() => customerHubEmailCta(invalid), /CUSTOMER_HUB_EMAIL_URL_INVALID/);
  }
});
