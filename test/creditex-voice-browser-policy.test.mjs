import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
const start = source.indexOf("function secureResponse(");
const end = source.indexOf("\nfunction queueCustomerOpportunityDispatch(", start);
assert.ok(start >= 0 && end > start);
const secureResponse = new Function("PRIVATE_HTML_CACHE_CONTROL", "releaseIdentityFromEnvironment",
  `${stripTypeScriptTypes(source.slice(start, end))}; return secureResponse;`)("private, no-store, max-age=0", () => "");

test("Creditex audit page permits only same-origin microphone use and keeps other sensors blocked", () => {
  for (const path of ["/creditex/compliance", "/creditex/compliance/"]) {
    const response = secureResponse(new Response("page"), new Request(`https://example.test${path}`));
    assert.equal(response.headers.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=(self)");
    assert.equal(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
});

test("Council portal permits its microphone while public Council pages retain the prohibition", () => {
  for (const path of ["/council", "/council/"]) {
    const response = secureResponse(new Response("page"), new Request(`https://example.test${path}`));
    assert.equal(response.headers.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=(self)");
  }
  for (const path of ["/council/demo", "/council-other", "/wattzun", "/api/wattzun/voice", "/api/wattzun/portal"]) {
    const response = secureResponse(new Response("page"), new Request(`https://example.test${path}`));
    assert.equal(response.headers.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=()");
  }
});

test("public pages, neighbouring routes and call APIs retain the microphone prohibition", () => {
  for (const path of ["/", "/account", "/direct-trade/dashboard-elsewhere", "/direct-trade/team/invite", "/direct-trade/messages/elsewhere", "/creditex/compliance-elsewhere", "/api/creditex/audit-calls", "/api/trade-team-calls"]) {
    const response = secureResponse(new Response("page"), new Request(`https://example.test${path}`));
    assert.equal(response.headers.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=()");
  }
});

test("TLink communication pages allow same-origin camera and microphone, with private HTML", () => {
  for (const path of ["/direct-trade/dashboard", "/direct-trade/team", "/direct-trade/messages", "/direct-trade/messages/"]) {
    const response = secureResponse(new Response("page", {headers:{"Content-Type":"text/html"}}), new Request(`https://example.test${path}`));
    assert.equal(response.headers.get("Permissions-Policy"), "camera=(self), geolocation=(), microphone=(self)");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  }
});

test("edge responses retain stricter route CSP while adding baseline document and HTTPS protections", () => {
  const response = secureResponse(new Response("private file", {
    headers: { "Content-Security-Policy": "sandbox; default-src 'none'" },
  }), new Request("https://example.test/api/private-file"));
  assert.equal(response.headers.get("Content-Security-Policy"),
    "sandbox; default-src 'none', frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000");
  const local = secureResponse(new Response("page"), new Request("http://localhost/account"));
  assert.equal(local.headers.has("Strict-Transport-Security"), false);
});
