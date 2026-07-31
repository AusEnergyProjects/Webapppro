import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  CUSTOMER_MATCHING_NOTICE_VERSION,
  CUSTOMER_MATCHING_RECEIPT_PURPOSE,
  matchingLocalityDisclosure,
  matchingLocalitySnapshot,
} from "../src/lib/customer-matching-locality.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0092_trade_opportunity_matching_locality.sql");
const schema = read("../db/schema.ts");
const projectRoute = read("../src/app/api/customer-projects/route.ts");
const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const notificationServer = read("../src/lib/opportunity-notification-server.ts");
const requestDialog = read("../src/components/CustomerInstallerRequestDialog.tsx");

test("matching locality is bounded and appears only under the current notice version", () => {
  const snapshot = matchingLocalitySnapshot({
    suburb: `  South\u0000bank ${"x".repeat(100)}  `,
    postcode: "3006",
    state: "vic",
    addressLine1: "70 Southbank Boulevard",
    addressLine2: "Unit 6612",
    displayName: "Private Household",
    email: "private@example.com",
    phone: "0400 000 000",
  });
  assert.equal(snapshot.suburb.length, 80);
  assert.doesNotMatch(snapshot.suburb, /[\u0000-\u001f\u007f]/);
  assert.equal(snapshot.postcode, "3006");
  assert.equal(snapshot.state, "VIC");
  assert.deepEqual(
    matchingLocalityDisclosure(snapshot),
    { suburb: "", postcode: "", state: "VIC" },
  );
  assert.deepEqual(
    matchingLocalityDisclosure(snapshot, {
      purpose: CUSTOMER_MATCHING_RECEIPT_PURPOSE,
      noticeVersion: "2026-07-18-quoting-photos",
      grantedAt: "2026-08-01T00:00:00.000Z",
      withdrawnAt: "",
    }),
    { suburb: "", postcode: "", state: "VIC" },
  );
  const disclosed = matchingLocalityDisclosure(
    snapshot,
    {
      purpose: CUSTOMER_MATCHING_RECEIPT_PURPOSE,
      noticeVersion: CUSTOMER_MATCHING_NOTICE_VERSION,
      grantedAt: "2026-08-01T00:00:00.000Z",
      withdrawnAt: "",
    },
  );
  assert.equal(disclosed.suburb, snapshot.suburb);
  assert.equal(disclosed.postcode, "3006");
  assert.equal(disclosed.state, "VIC");
  assert.doesNotMatch(
    JSON.stringify(disclosed),
    /Southbank Boulevard|Unit 6612|Private Household|private@example|0400/,
  );
  assert.deepEqual(
    matchingLocalityDisclosure(snapshot, {
      purpose: CUSTOMER_MATCHING_RECEIPT_PURPOSE,
      noticeVersion: CUSTOMER_MATCHING_NOTICE_VERSION,
      grantedAt: "2026-08-01T00:00:00.000Z",
      withdrawnAt: "2026-08-01T01:00:00.000Z",
    }),
    { suburb: "", postcode: "", state: "VIC" },
  );
});

test("a non-customer opportunity without a project receipt remains state-only", () => {
  assert.deepEqual(
    matchingLocalityDisclosure(
      { suburb: "Sydney", postcode: "2000", state: "NSW" },
      null,
    ),
    { suburb: "", postcode: "", state: "NSW" },
  );
});

test("the current matching notice explicitly describes locality and protected fields", () => {
  for (const value of ["suburb", "postcode", "state"]) {
    assert.match(requestDialog, new RegExp(value, "i"));
  }
  assert.match(requestDialog, /Installers cannot see your name, phone number or street\s+address until you approve a direct contact handover/);
  assert.match(CUSTOMER_MATCHING_NOTICE_VERSION, /^2026-08-01-/);
  assert.match(CUSTOMER_MATCHING_NOTICE_VERSION, /matching-locality/);
});

test("the additive migration leaves every legacy opportunity locality blank", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY NOT NULL,
    postcode text DEFAULT '' NOT NULL,
    state text NOT NULL
  )`);
  database.prepare(
    "INSERT INTO trade_opportunities (id, postcode, state) VALUES (?, ?, ?)",
  ).run("legacy", "3006", "VIC");
  database.exec(migration);
  const legacy = database.prepare(
    "SELECT suburb, postcode, state FROM trade_opportunities WHERE id = ?",
  ).get("legacy");
  assert.deepEqual(
    { ...legacy },
    { suburb: "", postcode: "3006", state: "VIC" },
  );
  database.close();
});

test("submission snapshots validated locality and writes the locality-specific receipt", () => {
  assert.match(schema, /suburb: text\("suburb"\)\.notNull\(\)\.default\(""\)/);
  assert.match(migration, /ALTER TABLE `trade_opportunities`[\s\S]*ADD `suburb` text DEFAULT '' NOT NULL/);
  assert.match(
    projectRoute,
    /matchingLocalitySnapshot\(\{\s*suburb: authoritativeContact\.suburb,[\s\S]*postcode: opportunity\.postcode,[\s\S]*state: opportunity\.state/,
  );
  assert.match(
    projectRoute,
    /INSERT INTO trade_opportunities[\s\S]*\(id, title, project_type, suburb, postcode, state,[\s\S]*matchingLocality\.suburb, matchingLocality\.postcode, matchingLocality\.state/,
  );
  assert.match(
    projectRoute,
    /customer-project-submit:\$\{id\}`[\s\S]*CUSTOMER_MATCHING_NOTICE_VERSION/,
  );
});

test("trade API and notification SQL bind locality to the exact project and current receipt", () => {
  for (const source of [opportunityRoute, notificationServer]) {
    assert.match(
      source,
      /source_reference = 'customer-project:' \|\| (?:p|project)\.id/,
    );
    assert.match(source, /purpose = 'anonymized_installer_matching'/);
    assert.match(
      source,
      /notice_version = '\$\{CUSTOMER_MATCHING_NOTICE_VERSION\}'/,
    );
    assert.match(source, /granted_at <> ''/);
    assert.match(source, /withdrawn_at = ''/);
    assert.match(source, /matchingLocalityDisclosure/);
    assert.doesNotMatch(source, /JOIN customer_accounts|LEFT JOIN customer_accounts/);
  }
});
