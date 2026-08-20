import assert from "node:assert/strict";
import test from "node:test";
import {
  SURGE_CLIENT_COOKIE_MAX_AGE_SECONDS,
  SURGE_CLIENT_COOKIE_NAME,
  resolveSurgeClientIdentity,
} from "../src/lib/surge-client-identity.ts";

const SECRET = "test-only-surge-identity-secret-with-enough-entropy";
const NOW = Date.parse("2026-08-21T00:00:00.000Z");

function fixedRandom(seed) {
  return (length) => Uint8Array.from({ length }, (_, index) => (seed + index) % 256);
}

function request(headers = {}) {
  return new Request("https://compare.ausenergyassessments.com/api/energy-assistant", {
    method: "POST",
    headers,
  });
}

function cookieHeader(setCookie) {
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

test("a missing cookie receives a signed 30 day secure first-party identity", async () => {
  const identity = await resolveSurgeClientIdentity(request({
    "cf-connecting-ip": "203.0.113.48",
  }), {
    secret: SECRET,
    production: true,
    now: NOW,
    randomBytes: fixedRandom(1),
  });

  assert.equal(identity.ready, true);
  assert.match(identity.clientKey, /^[0-9a-f]{64}$/);
  assert.match(identity.networkKey, /^[0-9a-f]{64}$/);
  assert.match(identity.setCookie, new RegExp(`^${SURGE_CLIENT_COOKIE_NAME}=`));
  assert.match(identity.setCookie, new RegExp(`Max-Age=${SURGE_CLIENT_COOKIE_MAX_AGE_SECONDS}`));
  assert.match(identity.setCookie, /; Path=\//);
  assert.match(identity.setCookie, /; HttpOnly/);
  assert.match(identity.setCookie, /; Secure/);
  assert.match(identity.setCookie, /; SameSite=Lax/);
  assert.doesNotMatch(JSON.stringify(identity), /203\.0\.113\.48/);
});

test("a valid cookie preserves the client key without reissuing the cookie", async () => {
  const first = await resolveSurgeClientIdentity(request({
    "cf-connecting-ip": "203.0.113.48",
  }), {
    secret: SECRET,
    production: true,
    now: NOW,
    randomBytes: fixedRandom(2),
  });
  const second = await resolveSurgeClientIdentity(request({
    cookie: cookieHeader(first.setCookie),
    "cf-connecting-ip": "203.0.113.91",
  }), {
    secret: SECRET,
    production: true,
    now: NOW + 60_000,
    randomBytes: fixedRandom(99),
  });

  assert.equal(second.ready, true);
  assert.equal(second.clientKey, first.clientKey);
  assert.equal(second.networkKey, first.networkKey);
  assert.equal(second.setCookie, null);
});

test("tampered and expired cookies are replaced with fresh signed identities", async (t) => {
  const original = await resolveSurgeClientIdentity(request({
    "cf-connecting-ip": "198.51.100.10",
  }), {
    secret: SECRET,
    production: true,
    now: NOW,
    randomBytes: fixedRandom(3),
  });
  const originalCookie = cookieHeader(original.setCookie);
  const lastCharacter = originalCookie.at(-1);
  const tamperedCookie = `${originalCookie.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;

  await t.test("tampered", async () => {
    const identity = await resolveSurgeClientIdentity(request({
      cookie: tamperedCookie,
      "cf-connecting-ip": "198.51.100.10",
    }), {
      secret: SECRET,
      production: true,
      now: NOW + 1_000,
      randomBytes: fixedRandom(4),
    });
    assert.equal(identity.ready, true);
    assert.notEqual(identity.clientKey, original.clientKey);
    assert.ok(identity.setCookie);
  });

  await t.test("expired", async () => {
    const identity = await resolveSurgeClientIdentity(request({
      cookie: originalCookie,
      "cf-connecting-ip": "198.51.100.10",
    }), {
      secret: SECRET,
      production: true,
      now: NOW + (SURGE_CLIENT_COOKIE_MAX_AGE_SECONDS * 1_000),
      randomBytes: fixedRandom(5),
    });
    assert.equal(identity.ready, true);
    assert.notEqual(identity.clientKey, original.clientKey);
    assert.ok(identity.setCookie);
  });
});

test("production network keys group IPv4 /24 and IPv6 /56 prefixes", async (t) => {
  async function networkKey(ip) {
    return (await resolveSurgeClientIdentity(request({ "cf-connecting-ip": ip }), {
      secret: SECRET,
      production: true,
      now: NOW,
      randomBytes: fixedRandom(6),
    })).networkKey;
  }

  await t.test("IPv4", async () => {
    assert.equal(await networkKey("203.0.113.1"), await networkKey("203.0.113.254"));
    assert.notEqual(await networkKey("203.0.113.1"), await networkKey("203.0.114.1"));
  });

  await t.test("IPv6", async () => {
    assert.equal(
      await networkKey("2001:db8:abcd:1201::1"),
      await networkKey("2001:db8:abcd:12ff:ffff::2"),
    );
    assert.notEqual(
      await networkKey("2001:db8:abcd:1201::1"),
      await networkKey("2001:db8:abcd:1301::1"),
    );
  });
});

test("production ignores forwarded headers and fails closed without a valid Cloudflare address", async () => {
  const first = await resolveSurgeClientIdentity(request({
    "x-forwarded-for": "192.0.2.8",
  }), {
    secret: SECRET,
    production: true,
    now: NOW,
    randomBytes: fixedRandom(7),
  });
  const second = await resolveSurgeClientIdentity(request({
    "x-forwarded-for": "198.51.100.9",
  }), {
    secret: SECRET,
    production: true,
    now: NOW,
    randomBytes: fixedRandom(7),
  });

  assert.equal(first.ready, false);
  assert.equal(first.networkKey, "");
  assert.deepEqual(first, second);
  assert.doesNotMatch(JSON.stringify(first), /192\.0\.2\.8|198\.51\.100\.9/);
});

test("development may use a deterministic coarse forwarded-address fallback", async () => {
  async function localIdentity(ip) {
    return resolveSurgeClientIdentity(request({ "x-forwarded-for": `${ip}, 127.0.0.1` }), {
      secret: SECRET,
      production: false,
      now: NOW,
      randomBytes: fixedRandom(8),
    });
  }

  const first = await localIdentity("192.0.2.1");
  const samePrefix = await localIdentity("192.0.2.240");
  const otherPrefix = await localIdentity("192.0.3.1");
  assert.equal(first.ready, true);
  assert.equal(first.networkKey, samePrefix.networkKey);
  assert.notEqual(first.networkKey, otherPrefix.networkKey);
  assert.doesNotMatch(JSON.stringify(first), /192\.0\.2\.1/);
});

test("a missing signing secret fails closed without issuing an unsigned cookie", async () => {
  const identity = await resolveSurgeClientIdentity(request({
    "cf-connecting-ip": "203.0.113.48",
  }), {
    production: true,
    now: NOW,
    randomBytes: fixedRandom(9),
  });

  assert.deepEqual(identity, {
    ready: false,
    clientKey: "",
    networkKey: "",
    setCookie: null,
  });
  assert.doesNotMatch(JSON.stringify(identity), /203\.0\.113\.48/);
});

test("a short signing secret also fails closed", async () => {
  const identity = await resolveSurgeClientIdentity(request({
    "cf-connecting-ip": "203.0.113.48",
  }), {
    secret: "too-short",
    production: true,
    now: NOW,
    randomBytes: fixedRandom(10),
  });

  assert.equal(identity.ready, false);
  assert.equal(identity.setCookie, null);
});
