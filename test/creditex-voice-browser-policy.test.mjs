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

test("public pages, neighbouring routes and call APIs retain the microphone prohibition", () => {
  for (const path of ["/", "/account", "/direct-trade/dashboard", "/creditex/compliance-elsewhere", "/api/creditex/audit-calls"]) {
    const response = secureResponse(new Response("page"), new Request(`https://example.test${path}`));
    assert.equal(response.headers.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=()");
  }
});
