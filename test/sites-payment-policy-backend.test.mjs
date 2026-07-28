import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const paymentLinksUrl = new URL("../src/app/api/trade-payment-links/route.ts", import.meta.url);
const integrations = read("../src/app/api/trade-integrations/route.ts");
const callback = read("../src/app/api/trade-integrations/callback/[provider]/route.ts");
const stripeWebhook = read("../src/app/api/stripe/webhook/route.ts");
const squareWebhook = read("../src/app/api/square/webhook/route.ts");

test("Sites backend cannot initiate a new financial transaction", () => {
  assert.equal(fs.existsSync(paymentLinksUrl), false);
  const integrationGet = integrations.slice(
    integrations.indexOf("export async function GET"),
    integrations.indexOf("export async function POST"),
  );
  assert.doesNotMatch(integrationGet, /checkout_url|checkoutUrl|external_id|externalId/);
});

test("retired payment providers are absent from OAuth state and token exchange", () => {
  const connectionPost = integrations.slice(
    integrations.indexOf("export async function POST"),
    integrations.indexOf("async function activeXeroRevocationCredentials"),
  );
  assert.doesNotMatch(connectionPost, /stripe|square|PAYMENT_PROVIDERS|SITES_FINANCIAL_TRANSACTIONS_DISABLED/i);
  assert.doesNotMatch(callback, /stripe|square|PAYMENT_PROVIDERS|SITES_FINANCIAL_TRANSACTIONS_DISABLED/i);
});

test("calendar and accounting provider paths remain available", () => {
  const disconnectPatch = integrations.slice(integrations.indexOf("export async function PATCH"));
  assert.match(disconnectPatch, /bestEffortRevoke\(providerValue, row\)/);
  assert.match(disconnectPatch, /DELETE FROM trade_crm_integrations WHERE firebase_uid = \? AND provider = \?/);
  assert.doesNotMatch(integrations, /stripe|square/i);

  for (const provider of ["xero", "myob", "quickbooks", "google_calendar", "microsoft_calendar"]) {
    assert.match(callback, new RegExp(`provider === "${provider}"`));
  }
  assert.match(callback, /INSERT INTO trade_crm_integrations/);
});

test("Stripe and Square webhooks acknowledge safely without reading or mutating state", async () => {
  const forbidden = /cloudflare:workers|getD1|reconcileTradePayment|createAdminNotification|request\.text|request\.json|fetch\(|\.prepare\(/;
  for (const source of [stripeWebhook, squareWebhook]) {
    assert.doesNotMatch(source, forbidden);
    assert.match(source, /ignored: true/);
    assert.match(source, /status: 200/);
    assert.match(source, /SITES_FINANCIAL_TRANSACTIONS_DISABLED/);
  }

  const [stripe, square] = await Promise.all([
    import("../src/app/api/stripe/webhook/route.ts"),
    import("../src/app/api/square/webhook/route.ts"),
  ]);
  for (const route of [stripe, square]) {
    const response = await route.POST();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: true,
      ignored: true,
      code: "SITES_FINANCIAL_TRANSACTIONS_DISABLED",
    });
  }
});
