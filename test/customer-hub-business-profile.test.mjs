import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as googleProfiles from "../src/lib/trade-google-business-profile.mjs";
import * as consent from "../src/lib/public-plan-enquiry.mjs";
import * as catalogue from "../src/lib/energy-service-catalogue.mjs";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { certificateTestDependency } from "./helpers/creditex-training-fixture.mjs";

function load(path, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  Function("require", "exports", source)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const profiles = load("../src/lib/customer-hub-business-profile.ts", { "./trade-google-business-profile.mjs": googleProfiles });
const env = { TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT: "https://places.googleapis.com/v1/places:autocomplete", TLINK_ADDRESS_AUTOCOMPLETE_TOKEN: "synthetic-provider-key" };
const placeId = "ChIJabcdefghijk123456789", cid = "11885663895765773631";
const googleUrl = `https://maps.google.com/?cid=${cid}`;
const location = { suburb: "Melbourne", addressState: "VIC", postcode: "3000" };
const profile = { id: "match-one", name: "Example Solar", websiteUrl: "https://example.test/", googleProfileUrl: `https://www.google.com/maps/search/?api=1&query=Example&query_place_id=${placeId}` };
const place = { id: placeId, googleMapsUri: googleUrl, rating: 4.7, userRatingCount: 152, attributions: [{ provider: "Example provider", providerUri: "https://provider.example.test/" }] };
const lookup = (value, fetchImpl, options = {}) => profiles.fetchCustomerHubBusinessRating(value, location, { env, fetchImpl, ...options });

test("public business projection includes only safe public links and excludes account/contact data", () => {
  assert.deepEqual(profiles.customerHubBusinessProfile({ business_id: "match-one", business_name: " Example Solar ",
    business_website: "https://example.test", google_business_profile_url: profile.googleProfileUrl,
    email: "PRIVATE", firebase_uid: "PRIVATE", customer_email: "PRIVATE" }), { ...profile, name: "Example Solar" });
  for (const url of ["javascript:alert(1)", "http://example.test", "https://user:pass@example.test", "https://example.test\\@attacker.test", "https://exam\nple.test/"])
    assert.equal(profiles.customerHubBusinessProfile({ business_website: url }).websiteUrl, "");
  assert.equal(profiles.customerHubBusinessProfile({ google_business_profile_url: "https://google.com.attacker.test/maps/place/test" }).googleProfileUrl, "");
});

test("exact Place ID details use the protected key only at the fixed API and return source attribution", async () => {
  const calls = [];
  const result = await lookup(profile, async (url, init) => { calls.push({ url, init }); return Response.json(place); });
  assert.deepEqual(result, { status: "available", rating: 4.7, reviewCount: 152, googleMapsUrl: googleUrl,
    attributions: [{ name: "Example provider", url: "https://provider.example.test/" }] });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, `/v1/places/${placeId}`);
  assert.equal(calls[0].init.headers["X-Goog-Api-Key"], env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN);
  assert.equal(calls[0].init.headers["X-Goog-FieldMask"], "id,rating,userRatingCount,googleMapsUri,attributions");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.body, undefined);
});

test("mismatched IDs, invalid ratings and unusable attributions never become apparent zero-star ratings", async () => {
  for (const mutation of [{ id: "another-business" }, { rating: 0 }, { rating: 5.1 }, { userRatingCount: -1 },
    { userRatingCount: 2.5 }, { userRatingCount: 0 }, { googleMapsUri: "https://attacker.test" },
    { attributions: [{ provider: "Source", providerUri: "javascript:alert(1)" }] }, { attributions: {} }]) {
    assert.deepEqual(await lookup(profile, async () => Response.json({ ...place, ...mutation })), { status: "unavailable" });
  }
});

test("CID lookup ignores the first name match and compares exact 64-bit identifiers", async () => {
  const calls = [];
  const selected = { ...profile, googleProfileUrl: googleUrl };
  const result = await lookup(selected, async (url, init) => {
    calls.push({ url, init });
    return Response.json({ places: [{ ...place, id: "wrong", googleMapsUri: "https://maps.google.com/?cid=11885663895765773630", rating: 5 }, place] });
  });
  assert.equal(result.status, "available"); assert.equal(result.rating, 4.7);
  assert.equal(calls[0].url, "https://places.googleapis.com/v1/places:searchText");
  assert.deepEqual(JSON.parse(calls[0].init.body), { textQuery: "Example Solar Melbourne VIC 3000 Australia", regionCode: "au", languageCode: "en-AU", includePureServiceAreaBusinesses: true, pageSize: 10 });
  assert.match(calls[0].init.headers["X-Goog-FieldMask"], /places\.attributions/);
  for (const places of [[{ ...place, googleMapsUri: "https://maps.google.com/?cid=11885663895765773630" }], [place, place]])
    assert.deepEqual(await lookup(selected, async () => Response.json({ places })), { status: "unavailable" });
});

test("Google Maps hex CID URLs preserve identity without floating-point conversion", async () => {
  const hex = BigInt(cid).toString(16);
  const result = await lookup({ ...profile, googleProfileUrl: `https://www.google.com/maps/place/Example/data=!4m2!3m1!1s0x1234:0x${hex}!8m2` },
    async () => Response.json({ places: [place] }));
  assert.equal(result.status, "available");
});

test("short link redirects are manually bounded and never send credentials to a profile or external host", async () => {
  const calls = [];
  const result = await lookup({ ...profile, googleProfileUrl: "https://maps.app.goo.gl/Example123" }, async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: profile.googleProfileUrl } }) : Response.json(place);
  });
  assert.equal(result.status, "available"); assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].init.headers, { Accept: "text/html" });
  assert.equal(calls[0].init.credentials, "omit"); assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  for (const redirect of ["https://attacker.test/maps/place/test", "https://google.com.attacker.test/maps/place/test", "http://www.google.com/maps/place/test", "https://www.google.com/url?url=https://attacker.test"] ) {
    let count = 0;
    assert.deepEqual(await lookup({ ...profile, googleProfileUrl: "https://g.page/Example123" }, async () => {
      count++; return new Response(null, { status: 302, headers: { location: redirect } });
    }), { status: "unavailable" });
    assert.equal(count, 1);
  }
  let count = 0;
  assert.deepEqual(await lookup({ ...profile, googleProfileUrl: "https://g.page/Example123" }, async () => {
    count++; return new Response(null, { status: 302, headers: { location: `https://g.page/redirect${count}` } });
  }), { status: "unavailable" });
  assert.equal(count, 4);
});

test("unsupported configuration, ambiguous listing and provider failures degrade without an additional lookup", async () => {
  const noFetch = async () => { assert.fail("No provider request was expected"); };
  for (const options of [{ env: {} }, { env: { ...env, TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT: "https://maps.googleapis.com/maps/api/geocode/json" } }])
    assert.deepEqual(await lookup(profile, noFetch, options), { status: "unavailable" });
  assert.deepEqual(await lookup({ ...profile, googleProfileUrl: "https://www.google.com/maps/search/?query=Example" }, noFetch), { status: "unavailable" });
  for (const googleProfileUrl of [`${profile.googleProfileUrl}&query_place_id=ChIJdifferent123456789`,
    `${googleUrl}&cid=11885663895765773630`, `${googleUrl}&query_place_id=malformed`])
    assert.deepEqual(await lookup({ ...profile, googleProfileUrl }, noFetch), { status: "unavailable" });
  for (const fetchImpl of [async () => { throw new Error("synthetic timeout"); }, async () => Response.json({ error: "denied" }, { status: 403 }),
    async () => new Response("not-json"), async () => new Response("x".repeat(65537))])
    assert.deepEqual(await lookup(profile, fetchImpl), { status: "unavailable" });
});

async function routeFixture(t) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  const now = new Date().toISOString(), future = "2099-12-31T00:00:00.000Z";
  const insert = (table, input) => {
    const row = {};
    for (const column of sqlite.prepare(`PRAGMA table_info(${table})`).all())
      if (column.notnull && column.dflt_value === null) row[column.name] = /INT/i.test(column.type) ? 0 : "";
    Object.assign(row, input);
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  };
  const statement = (sql, values = []) => ({ bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: sqlite.prepare(sql).run(...values) }) });
  const db = { prepare: statement };
  const protection = { encryptProtectedPayload: async value => JSON.stringify(value), decryptProtectedPayload: async value => JSON.parse(value) };
  const quoteLinks = load("../src/lib/trade-quote-links.ts", { "@/lib/trade-integration-crypto": protection });
  const links = load("../src/lib/customer-hub-links.ts", { "./trade-integration-crypto": protection, "./trade-quote-links": quoteLinks, "./public-plan-enquiry.mjs": consent });
  const server = load("../src/lib/customer-quote-hub-server.ts", {
    "./trade-access-server": certificateTestDependency("trade-access-server"), "./aea-trade-owner-server": certificateTestDependency("aea-trade-owner-server"),
    "./trade-certificate-leads": certificateTestDependency("trade-certificate-leads"), "./public-plan-enquiry.mjs": consent,
    "./energy-service-catalogue.mjs": catalogue, "./customer-hub-links": links, "./trade-quote-links": quoteLinks,
    "./trade-quote-decision-server": {}, "./customer-hub-business-profile": profiles,
  });
  for (const project of ["one", "other"]) {
    insert("trade_opportunities", { id: project, title: "PRIVATE project", project_type: "residential", state: "VIC", postcode: "3000", status: "open", service_categories: '["solar"]', source_reference: project, expires_at: future, created_at: now, updated_at: now });
    insert("public_trade_lead_contact_releases", { id: `release-${project}`, opportunity_id: project, source_reference: project, customer_email: "private@example.test", postcode: "3000",
      notice_version: consent.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent_purpose: consent.PUBLIC_PLAN_CONSENT_PURPOSE,
      disclosed_fields: '["customer_email","postcode","service_categories"]', granted_at: now, created_at: now, updated_at: now });
  }
  insert("trade_accounts", { firebase_uid: "owner", email: "PRIVATE BUSINESS EMAIL", business_name: profile.name, business_website: profile.websiteUrl,
    google_business_profile_url: profile.googleProfileUrl, suburb: location.suburb, address_state: location.addressState, postcode: location.postcode,
    partner_type: "installer", account_status: "active", abn: "51824753556", verified_abn: "51824753556", verification_status: "approved",
    verification_review_id: "review", verification_reviewed_at: now, verification_reviewed_by_uid: "reviewer",
    capabilities: '["solar"]', service_states: '["VIC"]', created_at: now, updated_at: now });
  insert("trade_team_members", { id: "member-owner", owner_uid: "owner", member_uid: "owner", email: "synthetic@example.test", role: "owner", status: "active", created_at: now, updated_at: now });
  insert("trade_account_verification_reviews", { id: "review", firebase_uid: "owner", abn: "51824753556", business_name: profile.name,
    partner_type: "installer", decision: "approved", review_method: "official_abr_lookup", reviewed_by_uid: "reviewer", reviewed_at: now });
  insert("creditex_business_onboarding", { owner_uid: "owner", status: "approved", application_json: "{}", business_abn: "51824753556", business_name: profile.name,
    insurance_expires_on: "2099-12-31", agreement_reference: "synthetic", reviewed_by_uid: "reviewer", reviewed_at: now, updated_at: now });
  for (const project of ["one", "other"]) insert("trade_opportunity_matches", { id: `match-${project}`, opportunity_id: project, firebase_uid: "owner",
    status: "interested", matched_categories: '["solar"]', matched_at: now, updated_at: now });
  const token = decodeURIComponent(new URL(await links.customerHubEmailUrl(db, "one", "private@example.test")).pathname.split("/").at(-1));
  let limit = { allowed: true }, duringLookup = () => {}, lookups = 0;
  const rateKeys = [], received = [];
  const route = load("../src/app/api/customer-hub/[token]/businesses/[id]/route.ts", {
    "../../../../../../../db": { getD1: () => db }, "@/lib/customer-hub-links": links, "@/lib/customer-quote-hub-server": server,
    "@/lib/customer-hub-business-profile": { ...profiles, fetchCustomerHubBusinessRating: async (...args) => {
      lookups++; received.push(args); duringLookup(); return { status: "available", rating: 4.7, reviewCount: 152, googleMapsUrl: googleUrl, attributions: [] };
    } },
    "@/lib/lead-rate-limit.mjs": { createSharedLeadRateLimiter: () => ({ check: async key => { rateKeys.push(key); return limit; } }) },
  });
  return { sqlite, rateKeys, received, lookups: () => lookups, setLimit: value => { limit = value; }, during: callback => { duringLookup = callback; },
    get: (id = "match-one", credential = token) => route.GET(new Request("https://example.test/api/customer-hub/private/businesses/match-one"), { params: Promise.resolve({ token: credential, id }) }) };
}

test("rating route exposes only the current hub participant and sends only public business data to lookup", async t => {
  const f = await routeFixture(t), response = await f.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json(); assert.equal(body.business.id, "match-one"); assert.equal(body.rating.rating, 4.7);
  assert.deepEqual(f.received[0], [profile, location]);
  assert.doesNotMatch(JSON.stringify(body) + JSON.stringify(f.received), /PRIVATE|private@example|release-one|firebase_uid/);
  assert.match(f.rateKeys[0], /^customer-hub-business-rating:/);
  assert.equal((await f.get("match-other")).status, 404);
  assert.equal((await f.get("match-one", "invalid-token")).status, 404);
  assert.equal(f.lookups(), 1);
});

test("hub revocation and participant withdrawal during a provider request suppress the result", async t => {
  for (const mutation of ["UPDATE customer_quote_hubs SET revoked_at='revoked'", "UPDATE trade_opportunity_matches SET status='declined'",
    "UPDATE public_trade_lead_contact_releases SET withdrawn_at='withdrawn'", "UPDATE trade_accounts SET account_status='suspended'"]) {
    const f = await routeFixture(t); f.during(() => f.sqlite.exec(mutation));
    const response = await f.get(); assert.equal(response.status, 404); assert.equal(f.lookups(), 1);
    assert.doesNotMatch(await response.text(), /4\.7|152|Example Solar/);
  }
});

test("changed listing metadata during a lookup does not attach the previous listing's rating", async t => {
  const f = await routeFixture(t); f.during(() => f.sqlite.exec("UPDATE trade_accounts SET google_business_profile_url='https://maps.google.com/?cid=1234567'"));
  const body = await (await f.get()).json();
  assert.equal(body.business.googleProfileUrl, "https://maps.google.com/?cid=1234567");
  assert.deepEqual(body.rating, { status: "unavailable" });
});

test("shared rate-limit denial and unavailable storage prevent Google requests", async t => {
  for (const [limit, status] of [[{ allowed: false, retryAfterSeconds: 17 }, 429], [{ allowed: false, unavailable: true }, 503]]) {
    const f = await routeFixture(t); f.setLimit(limit);
    const response = await f.get(); assert.equal(response.status, status); assert.equal(f.lookups(), 0);
    assert.equal(response.headers.get("retry-after"), String(limit.retryAfterSeconds || 60));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
