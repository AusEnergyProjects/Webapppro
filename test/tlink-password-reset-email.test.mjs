import assert from "node:assert/strict";
import test from "node:test";
import { tlinkPasswordResetEmail } from "../src/lib/tlink-password-reset-email.ts";

const resetUrl = "https://ausenergyassessments.com/direct-trade/reset-password?oobCode=example-code&continuePath=%2Fdirect-trade%2Fteam";

test("reset email has a branded button, safe text fallback and no exposed URL in HTML text", () => {
  const email = tlinkPasswordResetEmail({ email: " Person@Example.com ", resetUrl });
  assert.equal(email.subject, "Reset your TLink password");
  assert.match(email.html, /tlink-icon-192\.png/);
  assert.match(email.html, /href="https:\/\/ausenergyassessments\.com\/direct-trade\/reset-password\?oobCode=example-code&amp;continuePath=[^"]+"[^>]+>Reset password<\/a>/);
  assert.match(email.html, /person@example.com/);
  assert.doesNotMatch(email.html.replace(/<[^>]+>/g, ""), /example-code/);
  assert.match(email.body, /Reset password: https:\/\/ausenergyassessments\.com/);
  assert.match(email.html, /Your password will stay the same/);
});

test("email rendering escapes markup and does not interpret replacement metacharacters", () => {
  const email = tlinkPasswordResetEmail({ email: 'a<"$&%LINK%@example.com', resetUrl });
  assert.match(email.html, /a&lt;&quot;\$&amp;%link%@example.com/);
  assert.doesNotMatch(email.html, /a<"/);
  assert.doesNotMatch(email.html, /%EMAIL%/);
});

test("reset email refuses external, insecure and wrong-path action links", () => {
  for (const value of ["https://example.com/direct-trade/reset-password?oobCode=x", "http://ausenergyassessments.com/direct-trade/reset-password?oobCode=x", "https://ausenergyassessments.com/other?oobCode=x", "https://ausenergyassessments.com/direct-trade/reset-password", "https://user@ausenergyassessments.com/direct-trade/reset-password?oobCode=x", resetUrl + "#private"]) {
    assert.throws(() => tlinkPasswordResetEmail({ email: "person@example.com", resetUrl: value }));
  }
});

test("reset email refuses missing or invalid recipients", () => {
  for (const email of ["", "person", "person\r\n@example.com", "a".repeat(250) + "@example.com"]) {
    assert.throws(() => tlinkPasswordResetEmail({ email, resetUrl }));
  }
});
