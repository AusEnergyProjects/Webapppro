import test from "node:test";
import assert from "node:assert/strict";
import {
  customerContactReadiness,
  validateCustomerProfile,
} from "../src/lib/customer-projects.mjs";

test("installer request contact save derives location and validates the merged profile", () => {

  const merged = validateCustomerProfile({
    displayName: "Jamie Household",
    phone: "0400 000 000",
    addressLine1: "12 Example Street",
    addressLine2: "Unit 2",
    suburb: "Melbourne",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "owner",
    accountUpdates: true,
    consent: true,
  });
  assert.equal(merged.ok, true);
  assert.equal(
    customerContactReadiness(merged.profile, {
      postcode: "3000",
      address_state: "VIC",
    }).ok,
    true,
  );
});

test("contact readiness accepts raw D1 address columns without redirecting the customer", () => {
  assert.deepEqual(
    customerContactReadiness(
      {
        phone: "0421 731 505",
        address_line_1: "70 Southbank Boulevard",
        suburb: "Southbank",
        postcode: "3006",
        address_state: "VIC",
      },
      {
        postcode: "3006",
        address_state: "VIC",
      },
    ),
    { ok: true },
  );
});
