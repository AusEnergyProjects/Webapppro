import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeSurgeCustomerOfficialCitation,
  sanitizeSurgeCustomerOfficialUrl,
} from "../src/lib/surge-official-citation.ts";

test("customer citation policy accepts official public sources and canonicalises their URLs", () => {
  assert.equal(
    sanitizeSurgeCustomerOfficialUrl(
      "https://www.energy.gov.au/households?utm_source=test#details",
    ),
    "https://www.energy.gov.au/households",
  );
  assert.equal(
    sanitizeSurgeCustomerOfficialUrl("https://www2.education.vic.gov.au/pal/energy"),
    "https://www2.education.vic.gov.au/pal/energy",
  );
  assert.equal(
    sanitizeSurgeCustomerOfficialUrl("https://www.standards.org.au/standards-catalogue"),
    "https://www.standards.org.au/standards-catalogue",
  );
  assert.equal(
    sanitizeSurgeCustomerOfficialUrl("https://www.aemo.com.au/energy-systems"),
    "https://www.aemo.com.au/energy-systems",
  );
  assert.equal(
    sanitizeSurgeCustomerOfficialUrl("https://www.energy.gov.au./households"),
    "https://www.energy.gov.au/households",
  );
});

test("customer citation policy rejects commercial, lookalike and redirecting links", () => {
  const rejected = [
    "http://www.energy.gov.au/households",
    "https://user:password@www.energy.gov.au/households",
    "https://www.energy.gov.au:8443/households",
    "https://energy.gov.au.example.com/households",
    "https://unreviewed.example.org/advice",
    "https://unreviewed.energy.gov.au/advice",
    "https://student-pages.example.edu.au/advice",
    "https://www.secvictoria.com.au/energy",
    "https://www.energy.gov.au/households?a=1&b=2",
    "https://www.energy.gov.au/redirect?url=https%3A%2F%2Fevil.example",
    "https://www.energy.gov.au/redirect?next=%2F%2Fevil.example",
    "https://www.energy.gov.au/redirect?redirect_uri=https%3A%2F%2Fevil.example",
    "https://www.energy.gov.au/redirect?return_url=https%3A%2F%2Fevil.example",
    "https://www.energy.gov.au\\@evil.example/households",
    "https://www.energy.gov.au/" + "a".repeat(1_001),
  ];
  for (const value of rejected) {
    assert.equal(sanitizeSurgeCustomerOfficialUrl(value), null, value);
  }
});

test("customer citation policy derives the publisher and removes private metadata", () => {
  const citation = sanitizeSurgeCustomerOfficialCitation({
    id: "private-source-map-id",
    title: "  Official\u202E energy\u200F guidance  ",
    publisher: "Trusted Government",
    url: "https://www.energy.gov.au/households#private-anchor",
    sourceTier: "primary_official",
    stale: false,
  }, 2);
  assert.deepEqual(citation, {
    id: "official-source-3",
    title: "Official energy guidance",
    publisher: "www.energy.gov.au",
    url: "https://www.energy.gov.au/households",
  });
  assert.equal(sanitizeSurgeCustomerOfficialCitation({
    title: "Opinion",
    url: "https://www.energy.gov.au/households",
    sourceTier: "independent_link_only",
  }), null);
  assert.equal(sanitizeSurgeCustomerOfficialCitation({
    title: "Stale official page",
    url: "https://www.energy.gov.au/households",
    sourceTier: "primary_official",
    stale: true,
  }), null);
});
