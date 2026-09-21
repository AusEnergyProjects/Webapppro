import assert from "node:assert/strict";
import test from "node:test";
import { AEA_SERVICES, AEA_BUNDLES, AEA_RESERVED_SERVICE_IDS, requiresAeaDelivery, gstInclusiveCents, audPrice } from "../src/lib/aea-services.mjs";
import { ENERGY_SERVICE_IDS, TRADE_SERVICE_IDS, normalizeTradeServiceIds } from "../src/lib/energy-service-catalogue.mjs";
import { matchedServiceCategories } from "../src/lib/trade-service-matching.mjs";
import { quickUpgradeReceiptDraft } from "../src/lib/quick-upgrade-receipt.mjs";
import { validateLeadPayload } from "../src/lib/lead-validation.mjs";
import { QUICK_UPGRADE_CONSENT_PURPOSE, QUICK_UPGRADE_CONSENT_NOTICE_VERSION } from "../src/lib/quick-upgrade-enquiry.mjs";

test("legacy rental scope survives normalisation before trade routing", () => {
  for (const reserved of ["rental-inspection", " Rental-Inspection ", " ELECTRICAL-SAFETY-CHECK "]) {
    const result = validateLeadPayload({ submissionType: "upgrade", enquiry: "quick-upgrade-options",
      submissionId: "20260914.12345678-abcd-4abc-8def-123456789abc", clientStartedAt: Date.now() - 1000, customerFirstName: "Test", customerLastName: "Customer",
      email: "test@example.com", phone: "0400000000", customerStreetAddress: "15 Example Street", customerSuburb: "MELBOURNE", customerState: "VIC", postcode: "3000",
      projectCategories: [reserved, "solar"], tradeSharing: { email: false, postcode: true, address: true, name: false, phone: false },
      consent: { accepted: true, purpose: QUICK_UPGRADE_CONSENT_PURPOSE, noticeVersion: QUICK_UPGRADE_CONSENT_NOTICE_VERSION, grantedAt: new Date().toISOString() },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(requiresAeaDelivery(result.value.projectCategories), true);
    assert.ok(result.value.projectCategories.includes("solar"));
  }
});

test("AEA standalone prices retain the user-approved scope and GST totals", () => {
  assert.deepEqual(AEA_SERVICES.map(({ id, priceExGstCents }) => [id, priceExGstCents, gstInclusiveCents(priceExGstCents)]), [
    ["smoke-alarm-blind-safety", 10000, 11000], ["gas-safety-check", 25000, 27500],
    ["electrical-safety-check", 25000, 27500], ["minimum-rental-standards", 17000, 18700],
    ["nathers-new", 30000, 33000], ["nathers-existing", 30000, 33000], ["onsite-energy-assessment", 18000, 19800],
  ]);
  assert.equal(new Set(AEA_SERVICES.map(({ path }) => path)).size, 7);
  for (const service of AEA_SERVICES) {
    assert.ok(ENERGY_SERVICE_IDS.includes(service.id));
    assert.ok(service.faqs.length >= 3);
    assert.ok(service.sources.every(({ url }) => new URL(url).protocol === "https:"));
  }
});

test("225 and 350 are annual equivalents, never the complete two-year price", () => {
  assert.deepEqual(AEA_BUNDLES.map((bundle) => ({
    annual: audPrice(bundle.priceExGstCents / 2), total: audPrice(bundle.priceExGstCents),
    consumerTotal: audPrice(gstInclusiveCents(bundle.priceExGstCents)), months: bundle.durationMonths,
  })), [
    { annual: "$225", total: "$450", consumerTotal: "$495", months: 24 },
    { annual: "$350", total: "$700", consumerTotal: "$770", months: 24 },
  ]);
  assert.match(AEA_BUNDLES[1].inclusions.join(" "), /no extra appliance charge/);
});

test("reserved and mixed requests cannot become another trade's capabilities or matching subset", () => {
  for (const id of AEA_RESERVED_SERVICE_IDS) {
    assert.equal(TRADE_SERVICE_IDS.includes(id), false);
    assert.equal(normalizeTradeServiceIds([id]), null);
    assert.equal(normalizeTradeServiceIds(["solar", id]), null);
    assert.equal(requiresAeaDelivery([id, "solar"]), true);
    assert.deepEqual(matchedServiceCategories([id, "solar"], [id, "solar"]), []);
  }
  assert.deepEqual(normalizeTradeServiceIds(["electrical", "plumbing", "solar"]), ["electrical", "plumbing", "solar"]);
  assert.deepEqual(matchedServiceCategories(["solar", "battery"], ["solar"]), ["solar"]);
});

test("assessment testing stays with AEA while ordinary work remains available for trade matching", () => {
  const reserved = ["assessment", "rental-inspection", "blower-door-testing", "thermal-imaging",
    "smoke-alarm-blind-safety", "gas-safety-check", "electrical-safety-check", "minimum-rental-standards",
    "nathers-new", "nathers-existing", "onsite-energy-assessment", "rental-electrical-bundle", "rental-gas-electrical-bundle"];
  assert.deepEqual([...AEA_RESERVED_SERVICE_IDS].sort(), [...reserved].sort());
  for (const id of reserved.filter((service) => service !== "rental-inspection")) {
    assert.ok(ENERGY_SERVICE_IDS.includes(id), `${id} remains a public enquiry choice`);
    assert.ok(AEA_RESERVED_SERVICE_IDS.includes(id), `${id} is AEA-only`);
    assert.equal(requiresAeaDelivery([id]), true);
    assert.equal(requiresAeaDelivery(["insulation", id]), true);
  }
  const ordinary = ["electrical", "plumbing", "solar", "battery", "heating-cooling", "hot-water",
    "electric-cooking", "draught-proofing", "insulation", "glazing", "window-coverings", "ev-charging", "other"];
  assert.deepEqual(TRADE_SERVICE_IDS, ordinary);
  for (const id of ordinary) {
    assert.equal(requiresAeaDelivery([id]), false, id);
    assert.deepEqual(matchedServiceCategories([id], [id]), [id]);
  }
});

test("AEA-only and mixed receipts describe direct handling without a false no-match message", () => {
  for (const services of [["gas-safety-check"], ["solar", "nathers-existing"], ["blower-door-testing"], ["insulation", "thermal-imaging"]]) {
    const receipt = quickUpgradeReceiptDraft({ firstName: "Jamie", reference: "aea-service-test", services, matchingState: "review" });
    assert.match(receipt.body, /handle your service enquiry directly/);
    assert.match(receipt.body, /not distributed to other TLink businesses/);
    assert.doesNotMatch(receipt.body, /not found an available matching business/);
  }
  const upgrade = quickUpgradeReceiptDraft({ firstName: "Jamie", reference: "upgrade-test", services: ["solar"], matchingState: "matched" });
  assert.match(upgrade.body, /available to suitable approved TLink businesses/);
});
