import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const paymentPanel = read("../src/components/TradePaymentPanel.tsx");
const integrationCentre = read("../src/components/TradeIntegrationCentre.tsx");
const integrationsPage = read("../src/app/direct-trade/integrations/page.tsx");

test("the payment panel is a static external-processing boundary", () => {
  assert.match(paymentPanel, /Financial transactions are unavailable while TLink is hosted on ChatGPT Sites/);
  assert.match(paymentPanel, /Payment processing is outside TLink/);
  assert.match(paymentPanel, /Use your own approved process outside TLink/);
  assert.doesNotMatch(paymentPanel, /\/api\/trade-payment-links/);
  assert.doesNotMatch(paymentPanel, /method:\s*"POST"/);
  assert.doesNotMatch(paymentPanel, /createLink|checkoutUrl|Open checkout|Request with Stripe|Request with Square/);
  assert.doesNotMatch(paymentPanel, /<a\s/);
});

test("retired payment providers are absent from the integration centre", () => {
  assert.doesNotMatch(integrationCentre, /stripe|square|paymentIntegration/i);
  const connectStart = integrationCentre.indexOf("async function connect");
  const disconnectStart = integrationCentre.indexOf("async function disconnect");
  assert.ok(connectStart >= 0 && disconnectStart > connectStart);
  assert.match(integrationCentre, /Disconnect \$\{provider\.label\}/);
});

test("the public integrations page states the external payment boundary", () => {
  assert.match(integrationsPage, /does not initiate or process customer payments/);
  assert.match(integrationsPage, /Only calendar and accounting connections are offered/);
  assert.doesNotMatch(integrationsPage, /Stripe|Square|historical payment/i);
  assert.doesNotMatch(integrationsPage, /connect Stripe or Square to create a secure customer checkout link/i);
  assert.doesNotMatch(integrationsPage, /payment requests/);
  assert.doesNotMatch(paymentPanel + integrationCentre + integrationsPage, /[\u2013\u2014]/);
});
