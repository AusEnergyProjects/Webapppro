import test from "node:test";
import assert from "node:assert/strict";
import {
  TradeEmailProviderError,
  buildEmailAuthorizationUrl,
  exchangeEmailCode,
  refreshEmailCredentials,
  getEmailIdentity,
  sendMailboxEmail,
} from "../src/lib/trade-email-provider.ts";

const config = { clientId: "client-id", clientSecret: "client-secret" };
const callback = "https://portal.example.test/api/trade/email/callback";
const input = {
  senderEmail: "john@jelec.com", senderName: "John's Electrical", recipient: "customer@example.test",
  subject: "Your quote", text: "Your quote is ready.", messageId: "<quote-123@tlink.example.test>",
};
const token = { access_token: "access-token", refresh_token: "refresh-token", token_type: "Bearer", expires_in: 3600 };
const code = { code: "code-123", redirectUri: callback, verifier: "v".repeat(43) };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function expectedError(code, outcome) {
  return (error) => error instanceof TradeEmailProviderError && error.code === code && error.outcome === outcome;
}

test("OAuth requests only identity/send access with PKCE and offline access", () => {
  const google = new URL(buildEmailAuthorizationUrl(config, "google", callback, "csrf-state", "a".repeat(43)));
  assert.equal(google.origin, "https://accounts.google.com");
  assert.equal(google.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/gmail.send");
  assert.equal(google.searchParams.get("access_type"), "offline");
  assert.equal(google.searchParams.get("prompt"), "consent select_account");
  assert.equal(google.searchParams.get("code_challenge_method"), "S256");
  assert.equal(google.searchParams.get("state"), "csrf-state");
  assert.equal(google.searchParams.has("client_secret"), false);
  const microsoft = new URL(buildEmailAuthorizationUrl(config, "microsoft", callback, "csrf-state", "a".repeat(43)));
  assert.equal(microsoft.origin, "https://login.microsoftonline.com");
  assert.equal(microsoft.pathname, "/common/oauth2/v2.0/authorize");
  assert.equal(microsoft.searchParams.get("scope"), "openid profile email offline_access User.Read Mail.Send");
  assert.equal(microsoft.searchParams.get("response_mode"), "query");
  assert.throws(() => buildEmailAuthorizationUrl(config, "google", "http://portal.example.test/callback", "state", "a".repeat(43)), expectedError("email_input_invalid", "rejected"));
  assert.throws(() => buildEmailAuthorizationUrl(config, "google", callback, "state", "bad"), expectedError("email_input_invalid", "rejected"));
});

test("OAuth exchanges code with verifier and keeps provider identity out of token logs", async () => {
  const before = Date.now();
  for (const provider of ["google", "microsoft"]) {
    let count = 0;
    const credentials = await exchangeEmailCode(provider, config, code, async (url, init) => {
      count++;
      assert.equal(url, provider === "google" ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "manual");
      assert.equal(init.body.get("code_verifier"), code.verifier);
      assert.equal(init.body.get("grant_type"), "authorization_code");
      assert.equal(init.body.get("redirect_uri"), callback);
      return json(token);
    });
    assert.equal(count, 1);
    assert.equal(credentials.accessToken, token.access_token);
    assert.equal(credentials.refreshToken, token.refresh_token);
    assert.ok(Date.parse(credentials.expiresAt) >= before + 3600000);
  }
  await assert.rejects(exchangeEmailCode("google", config, code, async () => json({ ...token, refresh_token: undefined })), expectedError("email_refresh_token_required", "reconnect"));
  await assert.rejects(exchangeEmailCode("google", config, code, async () => json({ ...token, scope: "openid email" })), expectedError("email_permission_required", "reconnect"));
  await assert.rejects(exchangeEmailCode("google", config, code, async () => json({ ...token, expires_in: "3600" })), expectedError("email_provider_response_invalid", "rejected"));
});

test("Refresh rotates tokens when returned, retains omitted refresh token and detects revoked grants", async () => {
  const old = { accessToken: "old", refreshToken: "existing-refresh", expiresAt: new Date(0).toISOString() };
  const unchanged = await refreshEmailCredentials("google", config, old, async (_url, init) => {
    assert.equal(init.body.get("grant_type"), "refresh_token");
    assert.equal(init.body.get("refresh_token"), old.refreshToken);
    return json({ ...token, refresh_token: undefined });
  });
  assert.equal(unchanged.refreshToken, old.refreshToken);
  const rotated = await refreshEmailCredentials("microsoft", config, old, async () => json({ ...token, scope: "https://graph.microsoft.com/Mail.Send User.Read" }));
  assert.equal(rotated.refreshToken, token.refresh_token);
  await assert.rejects(refreshEmailCredentials("microsoft", config, old, async () => json({ error: "invalid_grant", error_description: "sensitive provider details" }, 400)), (error) => {
    assert.equal(error.outcome, "reconnect");
    assert.equal(error.message, "email_provider_reconnect");
    assert.equal(String(error).includes("sensitive"), false);
    return true;
  });
});

test("Google identity requires a verified email and Microsoft prefers mailbox address", async () => {
  assert.deepEqual(await getEmailIdentity("google", "token", async (url, init) => {
    assert.equal(url, "https://openidconnect.googleapis.com/v1/userinfo");
    assert.equal(init.headers.Authorization, "Bearer token");
    return json({ sub: "google-account", email: "john@jelec.com", email_verified: true, name: "John" });
  }), { id: "google-account", email: "john@jelec.com", name: "John" });
  await assert.rejects(getEmailIdentity("google", "token", async () => json({ sub: "id", email: "john@jelec.com", email_verified: false })), expectedError("email_identity_invalid", "rejected"));
  assert.deepEqual(await getEmailIdentity("microsoft", "token", async (url) => {
    assert.equal(url, "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName");
    return json({ id: "microsoft-account", mail: "office@jelec.com", userPrincipalName: "john@jelec.onmicrosoft.com", displayName: "John" });
  }), { id: "microsoft-account", email: "office@jelec.com", name: "John" });
  assert.equal((await getEmailIdentity("microsoft", "token", async () => json({ id: "id", mail: null, userPrincipalName: "john@jelec.com" }))).email, "john@jelec.com");
  await assert.rejects(getEmailIdentity("microsoft", "token", async () => json({ id: "id", userPrincipalName: "not-a-mailbox" })), expectedError("email_identity_invalid", "rejected"));
  await assert.rejects(getEmailIdentity("microsoft", "token", async () => json({ id: "id", mail: "bad", userPrincipalName: "valid@example.test" })), expectedError("email_identity_invalid", "rejected"));
  await assert.rejects(getEmailIdentity("microsoft", "token", async () => json({ id: "id", mail: null, userPrincipalName: "john_jelec.com#EXT#@tenant.onmicrosoft.com" })), expectedError("email_identity_invalid", "rejected"));
});

test("Gmail sends MIME with Unicode text and subject, HTML alternative and intact PDF attachment", async () => {
  const unicode = { ...input, senderName: "Électricité ⚡", subject: "Votre devis électrique ⚡ ".repeat(8), text: "Hello café ⚡\nSecond line", html: "<p>Hello café ⚡</p>", attachments: [{ filename: "Devis électrique.pdf", content: Buffer.from("%PDF-1.7\nPDF contents\n").toString("base64"), contentType: "application/pdf" }] };
  let raw;
  const result = await sendMailboxEmail("google", "access-token", unicode, async (url, init) => {
    assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, "Bearer access-token");
    const body = JSON.parse(init.body);
    assert.match(body.raw, /^[A-Za-z0-9_-]+$/);
    raw = Buffer.from(body.raw, "base64url").toString("utf8");
    return json({ id: "gmail-message-id" });
  });
  assert.deepEqual(result, { providerMessageId: "gmail-message-id", providerStatus: "accepted" });
  assert.ok(raw.includes(`Message-ID: ${input.messageId}\r\n`));
  assert.match(raw, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary=/);
  assert.match(raw, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(raw, /Content-Type: text\/html; charset=UTF-8/);
  assert.ok(raw.includes(Buffer.from(unicode.text).toString("base64")));
  assert.ok(raw.includes(Buffer.from(unicode.html).toString("base64")));
  assert.ok(raw.includes(unicode.attachments[0].content));
  assert.ok(raw.includes("filename*0*=UTF-8''Devis%20%C3%A9lectrique.pdf"));
  const subject = raw.match(/Subject: ([\s\S]+?)\r\nMessage-ID:/)[1];
  assert.equal([...subject.matchAll(/=\?UTF-8\?B\?(.+?)\?=/g)].map((match) => Buffer.from(match[1], "base64").toString("utf8")).join(""), unicode.subject);
  assert.ok(raw.split("\r\n").every((line) => line.length < 998));
});

test("Microsoft sends connected identity and attachments, keeps sent copy, treats 202 only as accepted", async () => {
  const attachment = { filename: "invoice.pdf", content: Buffer.from("%PDF").toString("base64"), contentType: "application/pdf" };
  const result = await sendMailboxEmail("microsoft", "access-token", { ...input, html: "<p>Quote ready</p>", attachments: [attachment] }, async (url, init) => {
    assert.equal(url, "https://graph.microsoft.com/v1.0/me/sendMail");
    const body = JSON.parse(init.body);
    assert.equal(body.saveToSentItems, true);
    assert.deepEqual(body.message.from, { emailAddress: { address: input.senderEmail, name: input.senderName } });
    assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: input.recipient } }]);
    assert.deepEqual(body.message.body, { contentType: "HTML", content: "<p>Quote ready</p>" });
    assert.deepEqual(body.message.internetMessageHeaders, [{ name: "X-TLink-Message-ID", value: input.messageId }]);
    assert.deepEqual(body.message.attachments, [{ "@odata.type": "#microsoft.graph.fileAttachment", name: attachment.filename, contentType: attachment.contentType, contentBytes: attachment.content }]);
    return new Response(null, { status: 202 });
  });
  assert.deepEqual(result, { providerMessageId: "", providerStatus: "accepted" });
  await assert.rejects(sendMailboxEmail("microsoft", "access-token", input, async () => json({})), expectedError("email_provider_response_invalid", "uncertain"));
});

test("Calendar invites preserve safe MIME charset and method parameters in both providers", async () => {
  const calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:job-123\r\nSUMMARY:Electrical visit\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const attachment = { filename: "appointment.ics", contentType: "text/calendar; charset=utf-8; method=REQUEST", content: Buffer.from(calendar).toString("base64") };
  for (const provider of ["google", "microsoft"]) {
    const result = await sendMailboxEmail(provider, "token", { ...input, attachments: [attachment] }, async (_url, init) => {
      const payload = JSON.parse(init.body);
      if (provider === "google") {
        const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
        assert.ok(mime.includes(`Content-Type: ${attachment.contentType}\r\n`));
        assert.ok(mime.includes(attachment.content.match(/.{1,76}/g).join("\r\n")));
        return json({ id: "calendar-id" });
      }
      assert.equal(payload.message.attachments[0].contentType, attachment.contentType);
      assert.equal(payload.message.attachments[0].contentBytes, attachment.content);
      return new Response(null, { status: 202 });
    });
    assert.equal(result.providerStatus, "accepted");
  }
});

test("Malformed address, header injection and invalid attachment fail before a provider request", async () => {
  const pdf = { filename: "invoice.pdf", content: "cGRm", contentType: "application/pdf" };
  const changes = [
    { senderName: "John\r\nBcc: attacker@example.test" }, { subject: "Quote\nBcc: attacker@example.test" },
    { senderEmail: "John <john@jelec.com>" }, { recipient: "one@example.test,two@example.test" },
    { recipient: ".bad@example.test" }, { recipient: "bad..dots@example.test" }, { recipient: "bad@-domain.test" },
    { messageId: "<id@example.test>\r\nBcc: attacker@example.test" },
    { attachments: [{ ...pdf, filename: "invoice.pdf\r\nX: bad" }] }, { attachments: [{ ...pdf, filename: "../invoice.pdf" }] },
    { attachments: [{ ...pdf, contentType: "application/pdf\r\nBcc: bad" }] },
    { attachments: [{ ...pdf, contentType: "text/calendar; method=REQUEST\r\nBcc: bad" }] },
    { attachments: [{ ...pdf, contentType: "text/calendar; method=\"REQUEST;malformed\"" }] },
    { attachments: [{ ...pdf, content: "bad_base64" }] }, { attachments: [{ ...pdf, content: "AB==" }] },
    { attachments: [{ ...pdf, content: "a=" }] }, { attachments: [{ ...pdf, content: "cGRm\n" }] },
    { attachments: [{ ...pdf, filename: "broken\ud800.pdf" }] },
  ];
  for (const provider of ["google", "microsoft"]) {
    for (const patch of changes) {
      let calls = 0;
      await assert.rejects(sendMailboxEmail(provider, "token", { ...input, ...patch }, async () => { calls++; return json({ id: "bad" }); }), expectedError("email_input_invalid", "rejected"));
      assert.equal(calls, 0);
    }
  }
});

test("Encoded payload size limit includes attachment, MIME and JSON overhead", async () => {
  for (const provider of ["google", "microsoft"]) {
    let calls = 0;
    const fetch = async () => { calls++; return json({ id: "bad" }); };
    await assert.rejects(sendMailboxEmail(provider, "token", { ...input, text: "é".repeat(1600000) }, fetch), expectedError("email_message_too_large", "rejected"));
    await assert.rejects(sendMailboxEmail(provider, "token", { ...input, attachments: [{ filename: "huge.pdf", contentType: "application/pdf", content: Buffer.alloc(3 * 1024 * 1024).toString("base64") }] }, fetch), expectedError("email_message_too_large", "rejected"));
    assert.equal(calls, 0);
  }
  await assert.rejects(sendMailboxEmail("google", "token", { ...input, text: "a".repeat(2000000) }, async () => { throw new Error("should not send"); }), expectedError("email_message_too_large", "rejected"));
});

test("A typical one MiB PDF fits both providers without expensive base64 validation recursion", async () => {
  const attachment = { filename: "invoice.pdf", contentType: "application/pdf", content: Buffer.alloc(1024 * 1024).toString("base64") };
  for (const provider of ["google", "microsoft"]) {
    let calls = 0;
    const result = await sendMailboxEmail(provider, "token", { ...input, attachments: [attachment] }, async () => {
      calls++;
      return provider === "google" ? json({ id: "gmail-id" }) : new Response(null, { status: 202 });
    });
    assert.equal(calls, 1);
    assert.equal(result.providerStatus, "accepted");
  }
});

test("Send failures never retry and distinguish rejection, revoked access and uncertain acceptance", async () => {
  for (const provider of ["google", "microsoft"]) {
    for (const [status, code, outcome] of [
      [400, "email_provider_rejected", "rejected"], [401, "email_provider_reconnect", "reconnect"],
      [403, "email_provider_rejected", "rejected"], [408, "email_provider_unavailable", "uncertain"],
      [429, "email_provider_rejected", "rejected"], [500, "email_provider_unavailable", "uncertain"], [503, "email_provider_unavailable", "uncertain"],
    ]) {
      let calls = 0;
      await assert.rejects(sendMailboxEmail(provider, "sensitive-token", input, async () => { calls++; return json({ error: "sensitive details" }, status); }), expectedError(code, outcome));
      assert.equal(calls, 1);
    }
    let calls = 0;
    await assert.rejects(sendMailboxEmail(provider, "sensitive-token", input, async () => { calls++; throw new Error("network contains sensitive-token"); }), expectedError("email_provider_unavailable", "uncertain"));
    assert.equal(calls, 1);
  }
  for (const response of [new Response("not-json"), json({}), json([])]) {
    await assert.rejects(sendMailboxEmail("google", "token", input, async () => response), expectedError("email_provider_response_invalid", "uncertain"));
  }
});

test("OAuth, refresh, identity and sends reject redirects without forwarding credentials or retrying", async () => {
  for (const provider of ["google", "microsoft"]) {
    for (const status of [301, 302, 303, 307, 308]) {
      for (const operation of [
        fetchImpl => exchangeEmailCode(provider, config, code, fetchImpl),
        fetchImpl => refreshEmailCredentials(provider, config, { accessToken: "token", refreshToken: "refresh", expiresAt: new Date().toISOString() }, fetchImpl),
        fetchImpl => getEmailIdentity(provider, "token", fetchImpl),
        fetchImpl => sendMailboxEmail(provider, "token", input, fetchImpl),
      ]) {
        let calls = 0;
        await assert.rejects(operation(async (url, init) => {
          calls++;
          assert.equal(init.redirect, "manual");
          assert.notEqual(new URL(url).hostname, "redirect.example.test");
          return new Response("Redirect must not be parsed or followed", { status, headers: { Location: "https://redirect.example.test/collect" } });
        }), expectedError("email_provider_rejected", "rejected"));
        assert.equal(calls, 1);
      }
    }
  }
});
