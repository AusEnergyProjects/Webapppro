import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ReminderProviderDeliveryError, reminderProviderFailureOutcome } from "../src/lib/service-reminder-delivery.ts";

const source = fs.readFileSync(new URL("../src/lib/trade-team-invitation-email.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "src/lib/trade-team-invitation-email.ts",
}).outputText;

function loadEmail({ configured = true, error } = {}) {
  const sent = [];
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    assert.equal(specifier, "@/lib/service-reminder-delivery");
    return {
      reminderProviderFailureOutcome,
      serviceReminderProviderConfiguration: () => ({ email: { configured } }),
      sendServiceReminderProviderMessage: async (message) => {
        sent.push(message);
        if (error) throw error;
        return { provider: "resend", providerMessageId: "email-1", providerStatus: "sent" };
      },
    };
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return { ...moduleRecord.exports, sent };
}

const input = {
  requestUrl: "https://tlink.example/api/trade-team",
  inviteId: "invite-123",
  email: "worker@example.com",
  displayName: "Alex <Worker>",
  businessName: "Roof & Solar",
  inviteUrl: "https://tlink.example/direct-trade/team?invite=private-token&view=join",
};

test("team invitation explains new password setup, assigned access and seven-day expiry", () => {
  const { tradeTeamInvitationEmail } = loadEmail();
  const email = tradeTeamInvitationEmail(input);
  assert.equal(email.subject, "You’re invited to Roof & Solar on TLink");
  assert.match(email.body, /create your password/);
  assert.match(email.body, /business has already set up your access/);
  assert.match(email.body, /continue with Google using worker@example.com/);
  assert.match(email.body, /expires in 7 days/);
  assert.match(email.body, /Join team: https:\/\/tlink.example\/direct-trade\/team\?invite=private-token&view=join/);
  assert.equal((email.html.match(/<a /g) || []).length, 2);
  assert.match(email.html, /href="https:\/\/tlink.example\/direct-trade\/team"[^>]*>TLink portal login<\/a>/);
  assert.match(email.body, /After joining, use this portal login for everyday access:\nhttps:\/\/tlink.example\/direct-trade\/team\n/);
  assert.match(email.html, /Alex &lt;Worker&gt;/);
  assert.match(email.html, /Roof &amp; Solar/);
  assert.match(email.html, /invite=private-token&amp;view=join/);
  assert.doesNotMatch(email.html, /<img|<script|Alex <Worker>/);
  assert.doesNotMatch(`${email.subject}\n${email.body}\n${email.html}`, /[\u2013\u2014]/);
});

test("invitation subject removes control characters and HTML escapes business-supplied text", () => {
  const { tradeTeamInvitationEmail } = loadEmail();
  const email = tradeTeamInvitationEmail({ ...input, businessName: 'Trade\r\n<img src="bad">' });
  assert.doesNotMatch(email.subject, /[\r\n]/);
  assert.doesNotMatch(email.html, /<img/);
  assert.match(email.html, /&lt;img src=&quot;bad&quot;&gt;/);
});

test("sender uses saved recipient, per-invite idempotency and existing Resend callback", async () => {
  const context = loadEmail();
  const result = await context.sendTradeTeamInvitationEmail(input);
  assert.equal(result.status, "sent");
  assert.match(result.message, /submitted to worker@example.com/);
  assert.doesNotMatch(result.message, /delivered|private-token/);
  assert.equal(context.sent.length, 1);
  assert.equal(context.sent[0].recipient, input.email);
  assert.equal(context.sent[0].channel, "email");
  assert.equal(context.sent[0].idempotencyKey, "tlink-team-invitation:invite-123");
  assert.equal(context.sent[0].callbackUrl, "https://tlink.example/api/service-reminder-provider-events/resend");
  assert.equal(context.sent[0].messageType, "tlink_team_invitation");
  assert.match(context.sent[0].html, /Join team/);
});

test("unconfigured email returns a clear failure without sending or losing saved membership", async () => {
  const context = loadEmail({ configured: false });
  const result = await context.sendTradeTeamInvitationEmail(input);
  assert.equal(result.status, "failed");
  assert.match(result.message, /Team member saved/);
  assert.match(result.message, /not configured/);
  assert.equal(context.sent.length, 0);
});

for (const outcome of ["definite_failure", "indeterminate"]) {
  test(`provider ${outcome} returns truthful status without leaking sensitive error text`, async () => {
    const context = loadEmail({ error: new ReminderProviderDeliveryError(outcome, "SECRET private-token API key") });
    const result = await context.sendTradeTeamInvitationEmail(input);
    assert.equal(result.status, outcome === "indeterminate" ? "unknown" : "failed");
    assert.match(result.message, /Team member saved/);
    assert.doesNotMatch(result.message, /SECRET|private-token|API key/);
    if (outcome === "indeterminate") assert.match(result.message, /Check their inbox before resending/);
  });
}

test("unexpected failures remain safe and do not throw after member creation", async () => {
  const context = loadEmail({ error: new Error("sensitive provider detail") });
  const result = await context.sendTradeTeamInvitationEmail(input);
  assert.equal(result.status, "failed");
  assert.doesNotMatch(result.message, /sensitive provider detail/);
});

test("invalid or external invitation links cannot be sent", async () => {
  for (const inviteUrl of [
    "javascript:alert(1)",
    "https://external.example/direct-trade/team?invite=token",
    "https://user:password@tlink.example/direct-trade/team?invite=token",
    "https://tlink.example/direct-trade/dashboard?invite=token",
    "https://tlink.example/direct-trade/team",
  ]) {
    const context = loadEmail();
    const result = await context.sendTradeTeamInvitationEmail({ ...input, inviteUrl });
    assert.equal(result.status, "failed");
    assert.equal(context.sent.length, 0);
  }
});
