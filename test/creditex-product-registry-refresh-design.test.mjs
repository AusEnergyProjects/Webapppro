import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES,
  CREDITEX_PRODUCT_KIND_REGISTRY,
  CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS,
} from "../src/lib/creditex-official-product-registry.ts";
import {
  CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS,
  creditexCecBatteryConnectorConfigurationIssue,
} from "../src/lib/creditex-official-product-registry-definitions.ts";
import {
  creditexAutomaticProductRegistryMaintenanceTargets,
} from "../src/lib/creditex-product-registry-maintenance.ts";
import {
  WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR,
} from "../src/lib/creditex-wa-product-sources.ts";

test("every calculator product dependency has one exact refresh producer", () => {
  const mapped = [...new Set(Object.values(CREDITEX_PRODUCT_KIND_REGISTRY))]
    .sort();
  assert.deepEqual(CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES, mapped);
  assert.deepEqual(
    Object.keys(CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS).sort(),
    mapped,
  );
  for (const [productKind, registryCode] of Object.entries(
    CREDITEX_PRODUCT_KIND_REGISTRY,
  )) {
    const design = CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode];
    assert.ok(design, `${productKind} has no refresh producer`);
    assert.equal(design.registryCode, registryCode);
    assert.ok(design.producer);
  }
});

test("automatic maintenance covers every executable automatic producer one at a time", () => {
  assert.deepEqual(
    creditexAutomaticProductRegistryMaintenanceTargets().map(
      ({ registryCode }) => registryCode,
    ),
    [
      "gems-products",
      "nsw-tessa-products",
      "veu-approved-products",
      "cer_sres_swh",
    ],
  );
  const configured = {
    [CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS.username]: "platform-user",
    [CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS.password]: "platform-secret",
    [CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS.licenceReference]:
      "CEC platform licence 42",
  };
  assert.deepEqual(
    creditexAutomaticProductRegistryMaintenanceTargets({
      environment: configured,
    }).map(({ registryCode }) => registryCode),
    [
      "gems-products",
      "nsw-tessa-products",
      "veu-approved-products",
      "cec-products",
      "cer_sres_swh",
    ],
  );
});

test("missing CEC credentials and controlled sources are explicit blockers", () => {
  const missingCec = creditexCecBatteryConnectorConfigurationIssue({});
  assert.match(missingCec, /not configured/);
  for (const key of Object.values(CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS)) {
    assert.match(missingCec, new RegExp(key));
  }
  for (const registryCode of [
    "cer-cec-products",
    "wa-synergy-supported-solutions",
  ]) {
    const design = CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode];
    assert.equal(design.refreshMode, "governed_manual");
    assert.equal(
      design.controlledImportPath,
      "/api/creditex/official-products/controlled-import",
    );
    assert.ok(design.requiredConfiguration.length > 0);
  }
  const horizon = CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[
    "wa-horizon-supported-solutions"
  ];
  assert.equal(horizon.producer, "blocked_external_source");
  assert.equal(horizon.refreshMode, "blocked");
  assert.equal(horizon.controlledImportPath, null);
  assert.ok(horizon.requiredConfiguration.length > 0);
  assert.equal(
    WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR.url,
    "https://www.horizonpower.com.au/for-home/solar-battery/community-wave/",
  );
  assert.equal(
    WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR.automatedSyncAvailable,
    false,
  );
});

test("controlled import is executable only through reviewed admin artifacts", () => {
  const route = fs.readFileSync(
    new URL(
      "../src/app/api/creditex/official-products/controlled-import/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /allowedRoles: \["admin"\]/);
  assert.match(route, /governanceIdentityVerified/);
  assert.match(route, /confirmControlledOfficialImport/);
  assert.match(route, /controlledImportReview/);
  assert.match(route, /permissionArtifactId/);
  assert.match(route, /permissionArtifactSha256/);
  assert.match(route, /permissionReviewDecisionId/);
  assert.match(route, /review\.reviewed_by_uid <> artifact\.captured_by_uid/);
  assert.match(route, /review\.reviewed_by_uid <> \?/);
  assert.match(route, /verifyCreditexControlledProductPermissionArtifact/);
  assert.match(route, /sizeBytes: Number\(permission\.size_bytes\)/);
  assert.match(route, /\.EVIDENCE/);
  assert.doesNotMatch(route, /licenceReference/);
  assert.match(route, /Horizon Power does not publish a supported machine export/);

  const registryRoute = fs.readFileSync(
    new URL(
      "../src/app/api/creditex/official-products/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(registryRoute, /creditexCecBatteryConnectorConfigurationIssue/);
  assert.match(registryRoute, /refreshReady:/);
  assert.match(registryRoute, /"OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE"/);
});
