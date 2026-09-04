import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  TRADE_ADDRESS_SELECTION_PROOF_TTL_MS,
  canonicalAustralianAddress,
  issueTradeAddressSelectionProof,
  resolveTradeAddressProvenance,
} from "../src/lib/trade-address-verification.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../src/app/api/trade-address-suggestions/route.ts");
const provider = read("../src/lib/address-suggestions-server.ts");
const lookup = read("../src/components/AustralianAddressLookup.tsx");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0117_trade_service_address_provenance.sql");
const secret = Buffer.alloc(32, 17).toString("base64url");
const ownerUid = "installer-test-owner";
const now = Date.UTC(2026, 7, 3, 2, 0, 0);

const selectedAddress = {
  addressLine1: "100 Collins Street",
  addressLine2: "Level 2",
  suburb: "Melbourne",
  addressState: "VIC",
  postcode: "3000",
  provider: "google-geocoding",
  providerReference: "test-place-reference",
  formattedAddress: "100 Collins Street, Melbourne VIC 3000, Australia",
};

test("canonical Australian addresses require a recognised state range and matching postcode", () => {
  assert.deepEqual(canonicalAustralianAddress({
    ...selectedAddress,
    addressState: " vic ",
    addressLine1: "  100  Collins Street ",
  }), {
    addressLine1: "100 Collins Street",
    addressLine2: "Level 2",
    suburb: "Melbourne",
    addressState: "VIC",
    postcode: "3000",
  });
  assert.throws(
    () => canonicalAustralianAddress({ ...selectedAddress, postcode: "0000" }),
    (error) => error?.code === "ADDRESS_POSTCODE_INVALID",
  );
  for (const malformedPostcode of ["30009", "3000junk"]) {
    assert.throws(
      () => canonicalAustralianAddress({ ...selectedAddress, postcode: malformedPostcode }),
      (error) => error?.code === "ADDRESS_POSTCODE_INVALID",
    );
  }
  assert.throws(
    () => canonicalAustralianAddress({ ...selectedAddress, addressState: "NSW" }),
    (error) => error?.code === "ADDRESS_POSTCODE_STATE_MISMATCH",
  );
});

test("manual addresses remain pending review and cannot claim provider verification", async () => {
  assert.deepEqual(await resolveTradeAddressProvenance({
    ...selectedAddress,
    addressEntryMode: "manual_pending_review",
  }, { ownerUid, secret, now }), {
    addressLine1: selectedAddress.addressLine1,
    addressLine2: selectedAddress.addressLine2,
    suburb: selectedAddress.suburb,
    addressState: selectedAddress.addressState,
    postcode: selectedAddress.postcode,
    addressEntryMode: "manual_pending_review",
    addressProvider: "",
    addressProviderReference: "",
    addressFormatted: "",
    addressVerifiedAt: "",
  });
  await assert.rejects(
    resolveTradeAddressProvenance({
      ...selectedAddress,
      addressEntryMode: "manual_pending_review",
      addressProvider: selectedAddress.provider,
    }, { ownerUid, secret, now }),
    (error) => error?.code === "ADDRESS_PROVENANCE_MISMATCH",
  );
});

test("provider selections are owner bound, expiring and exact across every canonical component", async () => {
  const selectionProof = await issueTradeAddressSelectionProof(selectedAddress, { ownerUid, secret, now });
  const verified = await resolveTradeAddressProvenance({
    ...selectedAddress,
    addressEntryMode: "provider_selected",
    addressProvider: selectedAddress.provider,
    addressProviderReference: selectedAddress.providerReference,
    addressFormatted: selectedAddress.formattedAddress,
    addressSelectionProof: selectionProof,
  }, { ownerUid, secret, now: now + 1_000 });
  assert.equal(verified.addressEntryMode, "provider_selected");
  assert.equal(verified.addressVerifiedAt, new Date(now + 1_000).toISOString());

  await assert.rejects(
    resolveTradeAddressProvenance({
      ...selectedAddress,
      suburb: "Southbank",
      addressEntryMode: "provider_selected",
      addressProvider: selectedAddress.provider,
      addressProviderReference: selectedAddress.providerReference,
      addressFormatted: selectedAddress.formattedAddress,
      addressSelectionProof: selectionProof,
    }, { ownerUid, secret, now: now + 1_000 }),
    (error) => error?.code === "ADDRESS_PROVENANCE_MISMATCH",
  );
  await assert.rejects(
    resolveTradeAddressProvenance({
      ...selectedAddress,
      addressEntryMode: "provider_selected",
      addressProvider: selectedAddress.provider,
      addressProviderReference: selectedAddress.providerReference,
      addressFormatted: selectedAddress.formattedAddress,
      addressSelectionProof: selectionProof,
    }, { ownerUid: "another-installer", secret, now: now + 1_000 }),
    (error) => error?.code === "ADDRESS_SELECTION_PROOF_INVALID",
  );
  await assert.rejects(
    resolveTradeAddressProvenance({
      ...selectedAddress,
      addressEntryMode: "provider_selected",
      addressProvider: selectedAddress.provider,
      addressProviderReference: selectedAddress.providerReference,
      addressFormatted: selectedAddress.formattedAddress,
      addressSelectionProof: selectionProof,
    }, { ownerUid, secret, now: now + TRADE_ADDRESS_SELECTION_PROOF_TTL_MS + 1 }),
    (error) => error?.code === "ADDRESS_SELECTION_PROOF_EXPIRED",
  );
});

test("service-site provenance migration defaults legacy and manual rows to pending review", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_crm_service_sites (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    address_line_1 text NOT NULL DEFAULT '',
    suburb text NOT NULL DEFAULT '',
    address_state text NOT NULL DEFAULT '',
    postcode text NOT NULL DEFAULT ''
  )`);
  database.prepare(`INSERT INTO trade_crm_service_sites
    (id, firebase_uid, address_line_1, suburb, address_state, postcode)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("legacy-site", ownerUid, "100 Collins Street", "Melbourne", "VIC", "3000");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    database.exec(statement);
  }
  const columns = database.prepare("PRAGMA table_info(trade_crm_service_sites)").all().map((row) => row.name);
  for (const column of [
    "address_entry_mode",
    "address_provider",
    "address_provider_reference",
    "address_formatted",
    "address_verified_at",
  ]) assert.ok(columns.includes(column));
  assert.deepEqual({ ...database.prepare(`SELECT address_entry_mode, address_provider,
    address_provider_reference, address_formatted, address_verified_at
    FROM trade_crm_service_sites WHERE id = 'legacy-site'`).get() }, {
    address_entry_mode: "manual_pending_review",
    address_provider: "",
    address_provider_reference: "",
    address_formatted: "",
    address_verified_at: "",
  });
  assert.throws(() => database.prepare(`UPDATE trade_crm_service_sites
    SET address_entry_mode = 'provider_selected' WHERE id = 'legacy-site'`).run());
  database.prepare(`UPDATE trade_crm_service_sites
    SET address_entry_mode = 'provider_selected',
        address_provider = 'google-geocoding',
        address_provider_reference = 'test-place-reference',
        address_formatted = '100 Collins Street, Melbourne VIC 3000, Australia',
        address_verified_at = '2026-08-03T02:00:01.000Z'
    WHERE id = 'legacy-site'`).run();
  assert.equal(
    database.prepare("SELECT address_entry_mode FROM trade_crm_service_sites WHERE id = 'legacy-site'").get().address_entry_mode,
    "provider_selected",
  );
  assert.ok(database.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'index' AND name = 'trade_crm_service_sites_address_verification_idx'`).get());
});

test("shared provider parses safe Australian results before the route signs exact provenance", () => {
  assert.match(route, /fetchAustralianAddressSuggestions/);
  assert.match(provider, /hostname === "maps\.googleapis\.com"/);
  assert.match(provider, /url\.protocol !== "https:"/);
  assert.match(provider, /redirect: "error"/);
  assert.match(provider, /googleComponent\(components, "country", true\)\.toUpperCase\(\) !== "AU"/);
  assert.match(provider, /cleanProviderText\(item\.country, 10\)\.toUpperCase\(\) !== "AU"/);
  assert.match(provider, /canonicalProviderAddressSelection/);
  for (const field of ["provider", "providerReference", "formattedAddress", "selectionProof"]) {
    assert.match(route, new RegExp(`${field}:`));
  }
  assert.match(route, /CRM_INTEGRATION_ENCRYPTION_KEY/);
  assert.match(lookup, /role="combobox"/);
  assert.match(lookup, /role="listbox"/);
  assert.match(lookup, /Address lookup is unavailable\. Enter the address manually\./);
  for (const field of [
    "addressEntryMode",
    "addressProvider",
    "addressProviderReference",
    "addressFormatted",
    "addressVerifiedAt",
  ]) assert.match(schema, new RegExp(`${field}:`));
});

test("every CRM service-address write validates provenance and edited verified addresses cannot retain stale proof", () => {
  assert.match(crmRoute, /const address = await resolvedAddressWrite\(body, identity\)/);
  assert.match(crmRoute, /const address = addressChanged \|\| provenanceWasSubmitted\(body\)/);
  assert.match(crmRoute, /address_entry_mode = \?, address_provider = \?/);
  assert.match(crmRoute, /address_provider_reference = \?, address_formatted = \?, address_verified_at = \?/);
  assert.match(crmRoute, /const resolvedAddress = addressChanged \|\| provenanceWasSubmitted\(body\)/);
  assert.match(crmRoute, /if \(guided && serviceSite\) \{\s*const canonicalSite = canonicalAustralianAddress/);
  assert.match(crmRoute, /const siteLabel = cleanAdminText\(body\.siteLabel, 100\) \|\| "Service address"/);
});
