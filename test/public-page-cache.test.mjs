import test from "node:test";
import assert from "node:assert/strict";
import { publicPageCacheKey, publicPageCacheResponse } from "../src/lib/public-page-cache.mjs";

const environment = { AEA_RELEASE_SHA: "a".repeat(40) };
const document = (path = "/guides/products/hot-water", headers = {}) => new Request(`https://ausenergyassessments.com${path}`, { headers: { Accept: "text/html", ...headers } });

test("public document cache uses a stable representation and exact release", () => {
  const key = publicPageCacheKey(document(), environment);
  assert.equal(key.headers.get("accept"), "text/html");
  assert.equal(new URL(key.url).searchParams.get("__aea_document_release"), environment.AEA_RELEASE_SHA);
  assert.notEqual(key.url, publicPageCacheKey(document(), { AEA_RELEASE_SHA: "b".repeat(40) }).url);
  assert.equal(publicPageCacheKey(document(), {}), null);
});

test("private, signed, query-dependent and RSC requests never share public documents", () => {
  for (const path of ["/account", "/direct-trade/dashboard", "/creditex/compliance", "/council", "/operations", "/customer-hub", "/api/address-localities", "/plan?postcode=3000"]) {
    assert.equal(publicPageCacheKey(document(path), environment), null, path);
  }
  for (const headers of [{ Cookie: "session=example" }, { Authorization: "Bearer example" }, { RSC: "1" }, { "Next-Router-State-Tree": "example" }, { "Next-Router-Prefetch": "1" }, { "Next-Url": "/plan" }, { Accept: "application/json" }]) {
    assert.equal(publicPageCacheKey(document("/", headers), environment), null);
  }
  assert.equal(publicPageCacheKey(new Request("http://localhost:5184/", { headers: { Accept: "text/html" } }), environment), null);
});

test("cache storage rejects errors, cookies and private responses", () => {
  for (const response of [new Response("error", { status: 500 }), Response.json({ private: true }), new Response("private", { headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" } }), new Response("cookie", { headers: { "Content-Type": "text/html", "Set-Cookie": "session=example" } })]) {
    assert.equal(publicPageCacheResponse(response), null);
  }
  const response = new Response("public", { headers: { "Content-Type": "text/html", Vary: "RSC, Accept" } });
  const cached = publicPageCacheResponse(response);
  assert.equal(cached.headers.get("Cache-Control"), "public, max-age=120");
  assert.equal(cached.headers.get("Vary"), null);
  assert.equal(response.headers.get("Vary"), "RSC, Accept");
});

test("edge storage and client delivery can independently consume the document", async () => {
  const response = new Response("complete public document", { headers: { "Content-Type": "text/html" } });
  const cached = publicPageCacheResponse(response.clone());
  assert.deepEqual(await Promise.all([cached.text(), response.text()]), ["complete public document", "complete public document"]);
});
