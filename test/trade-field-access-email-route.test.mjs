import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

import { tradeFieldAccessEmail } from "../src/lib/trade-field-access-email.ts";

const source = fs.readFileSync(new URL("../src/app/api/trade-team/field-access/route.ts", import.meta.url), "utf8");

function loadRoute({ configured = true, deliveryFails = false, issueError = "" } = {}) {
  const sent = [];
  const revoked = [];
  let issueCalls = 0;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/app/api/trade-team/field-access/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const mocks = {
    "@/lib/admin-server": {
      adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum),
      sameOrigin: () => true,
    },
    "@/lib/trade-mobile-device-revocation": { abortMemberDeviceUploads: async () => {} },
    "@/lib/trade-field-session-server": {
      issueFieldSetupPin: async () => {
        issueCalls += 1;
        if (issueError) throw new Error(issueError);
        return {
          id: "code-1",
          displayName: "Test Worker",
          username: "test1",
          pin: "123456",
          expiresAt: "2026-08-31T10:00:00.000Z",
          recipientEmail: "worker@example.com",
        };
      },
      revokeIssuedFieldSetupPin: async (ownerUid, memberId, codeId) => revoked.push({ ownerUid, memberId, codeId }),
      revokeMemberFieldAccess: async () => {},
    },
    "@/lib/trade-field-access-email": { tradeFieldAccessEmail },
    "@/lib/service-reminder-delivery": {
      serviceReminderProviderConfiguration: () => ({ email: { configured } }),
      sendServiceReminderProviderMessage: async (message) => {
        sent.push(message);
        if (deliveryFails) throw new Error("provider rejected message");
        return { provider: "resend", providerMessageId: "email-1", providerStatus: "sent" };
      },
    },
    "@/lib/trade-team-server": {
      requireInstallerTeamAccess: async () => ({ ownerUid: "owner-1", actorUid: "owner-1", isOwner: true }),
      canManageTeam: () => true,
    },
  };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return { route: moduleRecord.exports, sent, revoked, issueCalls: () => issueCalls };
}

function issue(route) {
  return route.POST(new Request("https://compare.example/api/trade-team/field-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "issue_pin", memberId: "member-1" }),
  }));
}

test("TLink PIN email contains the exact username, PIN, expiry and app link", () => {
  const email = tradeFieldAccessEmail({
    recipientName: "Test <Worker>",
    username: "test1",
    pin: "123456",
    expiresAt: "2026-08-31T10:00:00.000Z",
    appUrl: "https://compare.example/direct-trade/field-app",
  });
  assert.match(email.subject, /TLink app username and PIN/);
  assert.match(email.body, /Username: test1/);
  assert.match(email.body, /One-time PIN: 123456/);
  assert.match(email.body, /Open or install TLink/);
  assert.match(email.html, /Test &lt;Worker&gt;/);
  assert.doesNotMatch(`${email.subject}\n${email.body}\n${email.html}`, /[\u2013\u2014]/);
});

test("successful PIN creation emails the saved address and returns a one-time display", async () => {
  const context = loadRoute();
  const response = await issue(context.route);
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error);
  assert.equal(payload.setup.username, "test1");
  assert.equal(payload.setup.pin, "123456");
  assert.equal(payload.setup.deliveredTo, "worker@example.com");
  assert.equal("id" in payload.setup, false);
  assert.equal(context.sent.length, 1);
  assert.equal(context.sent[0].recipient, "worker@example.com");
  assert.equal(context.sent[0].messageType, "tlink_field_setup");
  assert.deepEqual(context.revoked, []);
});

test("provider failure cancels the new PIN and returns a clear retryable error", async () => {
  const context = loadRoute({ deliveryFails: true });
  const response = await issue(context.route);
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.code, "FIELD_EMAIL_DELIVERY_FAILED");
  assert.match(payload.error, /PIN was cancelled/);
  assert.deepEqual(context.revoked, [{ ownerUid: "owner-1", memberId: "member-1", codeId: "code-1" }]);
});

test("missing provider configuration fails before a PIN is created", async () => {
  const context = loadRoute({ configured: false });
  const response = await issue(context.route);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.code, "FIELD_EMAIL_NOT_CONFIGURED");
  assert.equal(context.issueCalls(), 0);
  assert.equal(context.sent.length, 0);
});

test("missing worker email is reported without a generic server error", async () => {
  const context = loadRoute({ issueError: "FIELD_EMAIL_REQUIRED" });
  const response = await issue(context.route);
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.code, "FIELD_EMAIL_REQUIRED");
  assert.match(payload.error, /Add and save an email address/);
});
