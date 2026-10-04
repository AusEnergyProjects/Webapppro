import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTradeBusinessFetch, readTradeBusinessSelection, resolveTradeBusinessSelection, saveTradeBusinessSelection } from "../src/lib/trade-business-client.ts";

const business = (ownerUid, role = "member") => ({ ownerUid, role, businessName: `Business ${ownerUid}`, memberId: `member-${ownerUid}`, displayName: "Installer" });
const store = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };

test("business selection is scoped to the signed-in UID and browser tab", () => {
  const tabOne = store(), tabTwo = store();
  saveTradeBusinessSelection("person-a", "business-one", tabOne);
  saveTradeBusinessSelection("person-b", "business-two", tabOne);
  saveTradeBusinessSelection("person-a", "business-three", tabTwo);
  assert.equal(readTradeBusinessSelection("person-a", tabOne), "business-one");
  assert.equal(readTradeBusinessSelection("person-b", tabOne), "business-two");
  assert.equal(readTradeBusinessSelection("person-a", tabTwo), "business-three");
  saveTradeBusinessSelection("person-a", "", tabOne);
  assert.equal(readTradeBusinessSelection("person-a", tabOne), "");
  assert.equal(readTradeBusinessSelection("person-b", tabOne), "business-two");
  assert.equal(readTradeBusinessSelection("person-a", tabTwo), "business-three");
});

test("a single business opens automatically while multiple businesses need an authorised choice", () => {
  const choices = [business("own", "owner"), business("other"), business("third")];
  assert.equal(resolveTradeBusinessSelection(choices, ""), null);
  assert.equal(resolveTradeBusinessSelection(choices, "other"), choices[1]);
  assert.equal(resolveTradeBusinessSelection(choices, "foreign-business"), null);
  assert.equal(resolveTradeBusinessSelection([choices[0]], "revoked"), choices[0]);
  assert.equal(resolveTradeBusinessSelection([], "own"), null);
});

test("blocked session storage does not prevent choosing a business", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(readTradeBusinessSelection("person", blocked), "");
  assert.doesNotThrow(() => saveTradeBusinessSelection("person", "owner", blocked));
  assert.doesNotThrow(() => saveTradeBusinessSelection("person", "", blocked));
});

test("captured tenant fetch sets the explicit business without changing bearer identity or caller headers", async () => {
  const requests = [];
  const scoped = createTradeBusinessFetch("selected-business", "https://tlink.test", async (url, init) => { requests.push({ url, init }); return Response.json({ ok: true }); });
  const headers = { Authorization: "Bearer original-token", "X-TLink-Business": "stale-business", "Content-Type": "application/json" };
  await scoped("/api/trade-quotes", { method: "POST", headers, body: '{"action":"save"}' });
  assert.equal(requests[0].init.headers.get("X-TLink-Business"), "selected-business");
  assert.equal(requests[0].init.headers.get("Authorization"), "Bearer original-token");
  assert.equal(requests[0].init.headers.get("Content-Type"), "application/json");
  assert.equal(requests[0].init.body, '{"action":"save"}');
  assert.equal(headers["X-TLink-Business"], "stale-business");
});

test("a delayed operation keeps its original business after another business is selected", async () => {
  const recorded = [];
  const request = async (_url, init) => { recorded.push(init.headers.get("X-TLink-Business")); return Response.json({ ok: true }); };
  const originalFetch = globalThis.fetch;
  const first = createTradeBusinessFetch("first", "https://tlink.test", request);
  const second = createTradeBusinessFetch("second", "https://tlink.test", request);
  const auth = { headers: { Authorization: "Bearer same-person" } };
  await second("/api/trade-team-calls", auth);
  await first("/api/trade-team-calls", auth);
  assert.deepEqual(recorded, ["second", "first"]);
  assert.equal(globalThis.fetch, originalFetch, "business selection never replaces global fetch");
});

test("business context is never added to external requests or public unauthenticated requests", async () => {
  const requests = [];
  const scoped = createTradeBusinessFetch("private-business", "https://tlink.test", async (url, init) => { requests.push({ url, init }); return Response.json({}); });
  await scoped("https://outside.test/api/trade-team", { headers: { Authorization: "Bearer external-provider" } });
  await scoped("/api/public-postcodes");
  await scoped("/assets/map.png", { headers: { Authorization: "Bearer token" } });
  for (const { init } of requests) assert.equal(new Headers(init?.headers).has("X-TLink-Business"), false);
});

test("Request inputs preserve their method and body and receive the selected context", async () => {
  let captured;
  const scoped = createTradeBusinessFetch("owner", "https://tlink.test", async (input, init) => { captured = new Request(input, init); return Response.json({}); });
  await scoped(new Request("https://tlink.test/api/trade-stock", { method: "POST", headers: { Authorization: "Bearer token" }, body: "stock-change" }));
  assert.equal(captured.method, "POST");
  assert.equal(await captured.text(), "stock-change");
  assert.equal(captured.headers.get("X-TLink-Business"), "owner");
});

test("revoked business access refreshes selection once without replaying or consuming the response", async () => {
  const calls = [];
  let accessLost = 0;
  const scoped = createTradeBusinessFetch("revoked", "https://tlink.test", async (_input, init) => {
    calls.push(init.headers.get("X-TLink-Business"));
    return Response.json({ code: "BUSINESS_ACCESS_REQUIRED", error: "Choose an active business." }, { status: 403 });
  }, () => { accessLost++; });
  const response = await scoped("/api/trade-team", { headers: { Authorization: "Bearer unchanged-token" } });
  assert.equal(accessLost, 1);
  assert.deepEqual(calls, ["revoked"]);
  assert.equal((await response.json()).code, "BUSINESS_ACCESS_REQUIRED");
});

test("ordinary permission and MFA failures do not change the selected business", async () => {
  for (const code of ["MFA_REQUIRED", "PERMISSION_REQUIRED"]) {
    let accessLost = 0;
    const scoped = createTradeBusinessFetch("selected", "https://tlink.test", async () => Response.json({ code }, { status: 403 }), () => { accessLost++; });
    await scoped("/api/trade-team", { headers: { Authorization: "Bearer token" } });
    assert.equal(accessLost, 0);
  }
});

test("owner and team entry points gate tenant mounts and invitation acceptance selects its returned business", () => {
  const dashboard = readFileSync(new URL("../src/components/DirectTradeDashboard.tsx", import.meta.url), "utf8");
  const portal = readFileSync(new URL("../src/components/TradeTeamPortal.tsx", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../src/components/TradeBusinessProvider.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /TradeBusinessGate destination="owner"><DirectTradeDashboardContent/);
  assert.match(portal, /TradeBusinessGate destination="member"><TradeTeamPortalContent/);
  assert.match(portal, /if \(accepted\.ownerUid && onInvitationAccepted\)/);
  assert.match(portal, /saveTradeBusinessSelection\(user\.uid, accepted\.ownerUid\)/);
  assert.match(provider, /if \(!selected\) return <>\{portalEntry\}<section/);
  assert.match(provider, /key=\{`\$\{user\.uid\}:\$\{selected\.ownerUid\}`\}/);
  assert.match(provider, /Switch business/);
  assert.doesNotMatch(provider, /localStorage|document\.cookie|globalThis\.fetch\s*=/);
});
